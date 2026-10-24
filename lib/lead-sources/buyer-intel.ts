import { getDb } from '../mongodb';
import { localitiesOf } from '../locality';

// Buyer leads intelligence: every lead in the CRM tables, in one shape, with
// what the buyer wants (area, BHK, budget, timeline), where they came from and
// what they consented to. Read-only; working a lead (status, notes, follow-up)
// stays in Super admin → Leads. Only real stored records — nothing inferred
// beyond what the buyer or the project they asked about says.

export interface BuyerRow {
  id: string;
  /** Which Leads tab holds it: contact | map | signup. */
  crm_tab: 'contact' | 'map' | 'signup';
  source_id: string;
  source_label: string;
  name: string;
  phone: string;
  email: string;
  city: string;
  area: string;
  /** True when the area is the asked-about project's locality, not something the buyer typed. */
  area_from_project: boolean;
  bhk: string;
  budget: string;
  timeline: string;
  project: string;
  consent: { enquiry: boolean; call: boolean; whatsapp: boolean; source: string; recorded: boolean };
  status: string;
  created_at: string;
}

const LIMIT = 5000;
const s = (v: unknown) => String(v ?? '').trim();

function consentOf(c: any) {
  return c && typeof c === 'object'
    ? { enquiry: c.enquiry === true, call: c.call === true, whatsapp: c.whatsapp === true, source: s(c.source), recorded: true }
    : { enquiry: false, call: false, whatsapp: false, source: '', recorded: false };
}

/** "Looking for: 3 BHK · Budget: … · Preferred area: … · Planning to buy: …" back into fields (older rows only store this line). */
export function parseNeeds(message: string) {
  const grab = (label: string) => (new RegExp(`${label}:\\s*([^·\\n]+)`, 'i').exec(message)?.[1] || '').trim();
  return { bhk: grab('Looking for'), budget: grab('Budget'), area: grab('Preferred area'), timeline: grab('Planning to buy') };
}

export async function loadBuyerRows(): Promise<BuyerRow[]> {
  const db = await getDb();
  const [contact, leads] = await Promise.all([
    db.collection('contact_leads').find({}).sort({ created_at: -1 }).limit(LIMIT).toArray() as Promise<Record<string, any>[]>,
    db.collection('leads').find({}).sort({ created_at: -1 }).limit(LIMIT).toArray() as Promise<Record<string, any>[]>,
  ]);
  const pinIds = Array.from(new Set(leads.map((l) => s(l.pin_id)).filter(Boolean)));
  const accountIds = Array.from(new Set(contact.filter((c) => c.source === 'Buyer sign-up').map((c) => s(c.account_id)).filter(Boolean)));
  const [pins, users] = await Promise.all([
    pinIds.length ? db.collection('pins').find({ id: { $in: pinIds } }, { projection: { id: 1, title: 1, location: 1 } }).toArray() : [],
    accountIds.length ? db.collection('users').find({ id: { $in: accountIds } }, { projection: { id: 1, profile: 1 } }).toArray() : [],
  ]) as [Record<string, any>[], Record<string, any>[]];
  const pinById = new Map(pins.map((p) => [s(p.id), p]));
  const userById = new Map(users.map((u) => [s(u.id), u]));

  const rows: BuyerRow[] = [];
  for (const c of contact) {
    const signup = c.source === 'Buyer sign-up';
    const requirement = c.source === 'buyer-requirement';
    const prof = signup ? (userById.get(s(c.account_id))?.profile || {}) : {};
    const parsed = parseNeeds(s(c.message));
    rows.push({
      id: s(c.id), crm_tab: signup ? 'signup' : 'contact',
      source_id: signup ? 'website_signup' : requirement ? 'website_requirement' : 'website_contact',
      source_label: signup ? 'Buyer account' : requirement ? 'Requirement form' : 'Contact form',
      name: s(c.name), phone: s(c.phone), email: s(c.email),
      city: s(c.city), area: s(c.locality) || s(prof.area) || (signup || requirement ? '' : parsed.area), area_from_project: false,
      bhk: s(c.bhk) || s(prof.configuration) || parsed.bhk,
      budget: s(c.budget) || s(prof.budget) || parsed.budget,
      timeline: s(c.timeline) || s(prof.timeline) || parsed.timeline,
      project: '', consent: consentOf(c.consent), status: s(c.status) || 'new', created_at: s(c.created_at),
    });
  }
  for (const l of leads) {
    const pin = pinById.get(s(l.pin_id));
    const ingest = s(l.ingest_source);
    const partner = !!l.integration_app_id;
    const typedArea = s(l.locality);
    const projectArea = pin ? localitiesOf(pin.location)[0] || '' : '';
    rows.push({
      id: s(l.id), crm_tab: 'map',
      source_id: ingest || (partner ? 'partner_api' : 'website_map'),
      source_label: ingest ? s(l.source) : partner ? s(l.source) || 'Partner API' : 'Live-map enquiry',
      name: s(l.name), phone: s(l.whatsapp) || s(l.phone) || s(l.phone_raw), email: s(l.email),
      city: s(l.city), area: typedArea || projectArea, area_from_project: !typedArea && !!projectArea,
      bhk: s(l.bhk), budget: s(l.budget), timeline: s(l.timeline),
      project: pin ? s(pin.title) : '', consent: consentOf(l.consent), status: s(l.status) || 'new', created_at: s(l.created_at),
    });
  }
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

const tally = (rows: BuyerRow[], f: (r: BuyerRow) => string) => {
  const m = new Map<string, number>();
  for (const r of rows) { const k = f(r); if (k) m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
};

export function summarize(rows: BuyerRow[], now = Date.now()) {
  const open = rows.filter((r) => !['won', 'lost', 'spam'].includes(r.status));
  return {
    total: rows.length,
    last_30_days: rows.filter((r) => now - Date.parse(r.created_at) < 30 * 86_400_000).length,
    open: open.length,
    with_requirement: rows.filter((r) => r.bhk || r.budget || r.timeline || (r.area && !r.area_from_project)).length,
    opted_in_call: rows.filter((r) => r.consent.call).length,
    opted_in_whatsapp: rows.filter((r) => r.consent.whatsapp).length,
    no_consent_record: rows.filter((r) => !r.consent.recorded).length,
    by_source: tally(rows, (r) => r.source_label),
    by_area: tally(rows, (r) => r.area),
    by_bhk: tally(rows, (r) => r.bhk),
    by_budget: tally(rows, (r) => r.budget),
    by_timeline: tally(rows, (r) => r.timeline),
  };
}
