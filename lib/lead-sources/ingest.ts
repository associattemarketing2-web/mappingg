import { randomUUID } from 'node:crypto';
import { getDb } from '../mongodb';
import { pushToCrm } from '../crm';
import { esc, notifyAdmin } from '../mailer';
import { optInSummary } from '../consent';
import { needsLine, type IncomingLead } from './normalize';
import { claimKey, releaseKey, settleKey, type Sql } from './store';

// One way in for every external lead (Google Ads, Meta, CSV import):
//  1. Claim (source, external id) in lead_ingest_keys, so a retried webhook,
//     a re-run sync or a re-uploaded file never creates a second lead.
//  2. The same phone/email from the same source within 24 h is treated like a
//     repeat "Enquire now": the existing lead is updated, not duplicated.
//  3. Otherwise a new row goes into `leads` — the same collection and shape as
//     live-map and partner-API enquiries — so it shows up in Super admin →
//     Leads and the Buyer leads panel, status "new", unassigned.
//  4. New leads go to the sales CRM webhook and the admin email, like the website forms.

export type IngestOutcome = 'created' | 'merged' | 'replayed';
const REPEAT_WINDOW_MS = 24 * 3_600_000;

export const SOURCE_LABEL: Record<string, string> = {
  google_ads: 'Google Ads lead form',
  meta_lead_ads: 'Meta lead ads',
  csv_import: 'CSV import',
};

export async function ingestLead(
  source: string, externalId: string, lead: IncomingLead,
  opts: { payloadHash?: string; label?: string; /** Push new leads to the sales CRM (default true). */ crm?: boolean; /** Email the admins about each new lead (default true). */ email?: boolean; sql?: Sql; now?: Date } = {},
): Promise<{ outcome: IngestOutcome; leadId: string | null }> {
  const now = opts.now || new Date();
  const prior = await claimKey(source, externalId, opts.payloadHash || '', opts.sql);
  if (prior) return { outcome: 'replayed', leadId: prior.lead_id };

  try {
    const db = await getDb();
    const leads = db.collection<{ _id: string; [k: string]: unknown }>('leads');
    const nowIso = now.toISOString();
    const label = opts.label || SOURCE_LABEL[source] || source;

    // A repeat from the same person through the same source, shortly after.
    const who: Record<string, string>[] = [];
    if (lead.phone) who.push({ whatsapp: lead.phone });
    if (lead.email) who.push({ email: lead.email });
    const recent = who.length
      ? (await leads.find({ ingest_source: source, $or: who }, { projection: { id: 1, created_at: 1 } }).toArray())
        .filter((l) => now.getTime() - Date.parse(String(l.created_at)) < REPEAT_WINDOW_MS)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      : [];

    let leadId: string;
    let outcome: IngestOutcome;
    if (recent[0]) {
      leadId = String(recent[0].id);
      outcome = 'merged';
      const optIn = lead.consent.call || lead.consent.whatsapp ? { consent: lead.consent } : {};
      await leads.updateOne({ id: leadId }, { $set: { last_enquired_at: nowIso, updated_at: nowIso, ...optIn }, $inc: { enquiry_clicks: 1 } });
    } else {
      leadId = randomUUID();
      outcome = 'created';
      const needs = needsLine(lead);
      await leads.insertOne({
        _id: leadId, id: leadId,
        role: 'buyer',
        name: lead.name,
        whatsapp: lead.phone,
        ...(lead.phone_raw ? { phone_raw: lead.phone_raw } : {}),
        email: lead.email,
        message: [needs, lead.project_name && `Project: ${lead.project_name}`, lead.message].filter(Boolean).join('\n\n'),
        ...(lead.city ? { city: lead.city } : {}), ...(lead.locality ? { locality: lead.locality } : {}),
        ...(lead.bhk ? { bhk: lead.bhk } : {}), ...(lead.budget ? { budget: lead.budget } : {}),
        ...(lead.timeline ? { timeline: lead.timeline } : {}),
        consent: lead.consent,
        source: label,
        status: 'new', notes: '',
        enquiry_clicks: 1, last_enquired_at: nowIso,
        ingest_source: source,
        ingest: { source, external_id: externalId, received_at: nowIso, submitted_at: lead.submitted_at || null, ...lead.meta },
        created_at: lead.submitted_at && Date.parse(lead.submitted_at) < now.getTime() ? lead.submitted_at : nowIso,
        updated_at: nowIso,
      });
    }
    await settleKey(source, externalId, leadId, outcome, opts.sql);

    if (outcome === 'created' && opts.crm !== false) {
      pushToCrm({
        name: lead.name, mobile: lead.phone || lead.phone_raw || '', email: lead.email, project: lead.project_name || '',
        source: label, page: '',
        extra: [['Looking for', lead.bhk], ['Budget', lead.budget], ['Area', [lead.locality, lead.city].filter(Boolean).join(', ')],
          ['Timeline', lead.timeline], ['Opted in to', optInSummary(lead.consent)]],
        message: lead.message || '',
      });
    }
    if (outcome === 'created' && opts.email !== false) {
      notifyAdmin(`New lead (${label}) — ${lead.name}`, {
        title: `New lead from ${esc(label)}`,
        body: [],
        rows: [['Name', lead.name], ['Phone', lead.phone || lead.phone_raw || ''], ['Email', lead.email], ['Looking for', needsLine(lead)]],
        cta: { label: 'Open buyer leads', href: '/dashboard/s-admin?tab=buyerleads' },
      }, lead.email || undefined);
    }
    return { outcome, leadId };
  } catch (err) {
    await releaseKey(source, externalId, opts.sql);
    throw err;
  }
}
