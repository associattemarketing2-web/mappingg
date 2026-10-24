import { createHash } from 'node:crypto';
import { normalizePhone } from '../phone';
import type { ConsentRecord } from '../consent';

// Pure helpers shared by every external lead source (Google Ads, Meta, CSV):
// one incoming-lead shape, field classification for free-form questions, and
// consent parsing. No I/O here, so it is all unit-tested.

export interface IncomingLead {
  name: string;
  /** Stored form "+91 9876543210", or '' when missing/invalid (raw value kept in phone_raw). */
  phone: string;
  phone_raw?: string;
  email: string;
  city?: string;
  locality?: string;
  bhk?: string;
  budget?: string;
  timeline?: string;
  message?: string;
  project_name?: string;
  consent: ConsentRecord & Record<string, unknown>;
  /** Source-specific ids (form, campaign, ad, broker…) kept on the lead for reporting. */
  meta: Record<string, unknown>;
  /** When the person submitted, per the source (ISO), if it says. */
  submitted_at?: string;
}

export type NeedField = 'city' | 'locality' | 'bhk' | 'budget' | 'timeline';

const clip = (v: unknown, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Which requirement a free-form question is about, from its key or label. */
export function classifyQuestion(key: string): NeedField | null {
  const k = key.toLowerCase().replace(/[_-]+/g, ' ');
  if (/\b(bhk|bedroom|configuration|unit type|flat type|apartment type)\b/.test(k)) return 'bhk';
  if (/\b(budget|price range|price)\b/.test(k)) return 'budget';
  if (/\b(when|timeline|time frame|timeframe|purchase time|planning to buy|move in)\b/.test(k)) return 'timeline';
  if (/\b(locality|location|area|neighbou?rhood|micro market|preferred place)\b/.test(k)) return 'locality';
  if (/\bcity\b/.test(k)) return 'city';
  return null;
}

/** "Looking for: 3 BHK · Budget: … · Preferred area: … · Planning to buy: …" (same layout as the website forms). */
export function needsLine(l: Pick<IncomingLead, NeedField>): string {
  return [
    l.bhk && `Looking for: ${l.bhk}`, l.budget && `Budget: ${l.budget}`,
    (l.locality || l.city) && `Preferred area: ${[l.locality, l.city].filter(Boolean).join(', ')}`,
    l.timeline && `Planning to buy: ${l.timeline}`,
  ].filter(Boolean).join(' · ');
}

export function phoneFields(raw: unknown): Pick<IncomingLead, 'phone' | 'phone_raw'> {
  const s = clip(raw, 40);
  if (!s) return { phone: '' };
  const n = normalizePhone(s);
  return n ? { phone: n } : { phone: '', phone_raw: s };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const cleanEmail = (v: unknown) => { const e = clip(v, 200).toLowerCase(); return EMAIL_RE.test(e) ? e : ''; };

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// ---- Google Ads lead form webhook -------------------------------------------------------

export interface GoogleAdsPayload {
  lead_id?: string;
  api_version?: string;
  form_id?: number | string;
  campaign_id?: number | string;
  adgroup_id?: number | string;
  creative_id?: number | string;
  gcl_id?: string;
  google_key?: string;
  is_test?: boolean;
  lead_submit_time?: string;
  user_column_data?: { column_id?: string; column_name?: string; string_value?: string }[];
}

/** A Google Ads lead-form webhook body → the incoming lead. Throws on a body without a lead id. */
export function googleAdsToLead(p: GoogleAdsPayload, receivedAt = new Date()): { externalId: string; lead: IncomingLead } {
  const externalId = clip(p.lead_id, 200);
  if (!externalId) throw new Error('missing lead_id');
  const cols = Array.isArray(p.user_column_data) ? p.user_column_data : [];
  const byId = (id: string) => clip(cols.find((c) => String(c.column_id || '').toUpperCase() === id)?.string_value);
  const name = byId('FULL_NAME') || [byId('FIRST_NAME'), byId('LAST_NAME')].filter(Boolean).join(' ');
  const needs: Partial<Record<NeedField, string>> = { city: byId('CITY') || undefined };
  const other: string[] = [];
  const KNOWN = new Set(['FULL_NAME', 'FIRST_NAME', 'LAST_NAME', 'EMAIL', 'WORK_EMAIL', 'PHONE_NUMBER', 'WORK_PHONE', 'CITY']);
  for (const c of cols) {
    const id = String(c.column_id || '').toUpperCase();
    const value = clip(c.string_value, 300);
    if (!value || KNOWN.has(id)) continue;
    const field = classifyQuestion(`${c.column_name || ''} ${id}`);
    if (field && !needs[field]) needs[field] = value;
    else other.push(`${clip(c.column_name || id, 80)}: ${value}`);
  }
  const submitted = p.lead_submit_time && !Number.isNaN(Date.parse(p.lead_submit_time)) ? new Date(p.lead_submit_time).toISOString() : undefined;
  return {
    externalId,
    lead: {
      name: name || 'Google Ads lead',
      ...phoneFields(byId('PHONE_NUMBER') || byId('WORK_PHONE')),
      email: cleanEmail(byId('EMAIL') || byId('WORK_EMAIL')),
      ...needs,
      message: other.join('\n'),
      consent: {
        // Submitting the lead form is the person's request for the advertiser to contact them.
        enquiry: true, call: false, whatsapp: false,
        text: `Submitted a Google Ads lead form (form ${clip(p.form_id, 40) || 'unknown'}) asking Associatte PropTech (Mappingg) to contact them.`,
        version: `google-ads-lead-form:${clip(p.form_id, 40) || 'unknown'}`,
        captured_at: submitted || receivedAt.toISOString(),
        source: 'Google Ads lead form',
        asserted_by: 'google_ads',
      },
      meta: {
        form_id: clip(p.form_id, 40), campaign_id: clip(p.campaign_id, 40), adgroup_id: clip(p.adgroup_id, 40),
        creative_id: clip(p.creative_id, 40), gcl_id: clip(p.gcl_id, 200), api_version: clip(p.api_version, 20),
      },
      submitted_at: submitted,
    },
  };
}

// ---- Meta (Facebook / Instagram) lead ads ----------------------------------------------

export interface MetaLead {
  id: string;
  created_time?: string;
  form_id?: string;
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  platform?: string;
  is_organic?: boolean;
  field_data?: { name: string; values?: string[] }[];
  custom_disclaimer_responses?: { checkbox_key?: string; is_checked?: boolean | string }[];
}

/** A lead from the Graph API (/{lead-id}) → the incoming lead. */
export function metaToLead(m: MetaLead, receivedAt = new Date()): IncomingLead {
  const fields = Array.isArray(m.field_data) ? m.field_data : [];
  const get = (...names: string[]) => clip(fields.find((f) => names.includes(String(f.name).toLowerCase()))?.values?.[0]);
  const name = get('full_name', 'name') || [get('first_name'), get('last_name')].filter(Boolean).join(' ');
  const KNOWN = new Set(['full_name', 'name', 'first_name', 'last_name', 'email', 'work_email', 'phone_number', 'phone', 'work_phone_number', 'city']);
  const needs: Partial<Record<NeedField, string>> = { city: get('city') || undefined };
  const other: string[] = [];
  for (const f of fields) {
    const key = String(f.name || '').toLowerCase();
    const value = clip((f.values || []).join(', '), 300);
    if (!value || KNOWN.has(key)) continue;
    const field = classifyQuestion(key);
    if (field && !needs[field]) needs[field] = value;
    else other.push(`${clip(key.replace(/_/g, ' '), 80)}: ${value}`);
  }
  // Optional consent checkboxes the advertiser added to the form ("custom disclaimer").
  const checked = (re: RegExp) => (m.custom_disclaimer_responses || []).some((d) => re.test(String(d.checkbox_key || '')) && (d.is_checked === true || d.is_checked === '1' || d.is_checked === 'true'));
  const submitted = m.created_time && !Number.isNaN(Date.parse(m.created_time)) ? new Date(m.created_time).toISOString() : undefined;
  return {
    name: name || 'Meta lead',
    ...phoneFields(get('phone_number', 'phone', 'work_phone_number')),
    email: cleanEmail(get('email', 'work_email')),
    ...needs,
    message: other.join('\n'),
    consent: {
      enquiry: true,
      call: checked(/call|phone/i),
      whatsapp: checked(/whatsapp|sms|message/i),
      text: `Submitted a Meta lead form (form ${clip(m.form_id, 40) || 'unknown'}) asking Associatte PropTech (Mappingg) to contact them.`,
      version: `meta-lead-form:${clip(m.form_id, 40) || 'unknown'}`,
      captured_at: submitted || receivedAt.toISOString(),
      source: `Meta lead form${m.platform ? ` (${clip(m.platform, 20)})` : ''}`,
      asserted_by: 'meta',
    },
    meta: {
      form_id: clip(m.form_id, 40), ad_id: clip(m.ad_id, 40), adset_id: clip(m.adset_id, 40),
      campaign_id: clip(m.campaign_id, 40), platform: clip(m.platform, 20), is_organic: m.is_organic === true,
    },
    submitted_at: submitted,
  };
}

// ---- CSV import -----------------------------------------------------------------------

export const CSV_FIELDS = [
  ['name', 'Full name'], ['first_name', 'First name'], ['last_name', 'Last name'], ['phone', 'Phone / WhatsApp'], ['email', 'Email'],
  ['city', 'City'], ['locality', 'Preferred area'], ['bhk', 'BHK'], ['budget', 'Budget'], ['timeline', 'Buying timeline'],
  ['project', 'Project'], ['message', 'Notes / message'], ['consent', 'Consent (yes/no)'], ['consent_date', 'Consent date'],
  ['referred_by', 'Referred by'], ['external_id', 'Their record id'],
] as const;
export type CsvField = (typeof CSV_FIELDS)[number][0];
export type CsvMapping = Partial<Record<CsvField, number>>;

/** Suggested column → field mapping from the header names. */
export function suggestMapping(headers: string[]): CsvMapping {
  const rules: [CsvField, RegExp][] = [
    ['first_name', /^first ?name$/], ['last_name', /^(last ?name|surname)$/], ['name', /^(full ?name|name|customer ?name|buyer ?name|client ?name|lead ?name)$/],
    ['phone', /(phone|mobile|whatsapp|contact ?no|contact ?number)/], ['email', /e-?mail/],
    ['consent_date', /consent.*(date|time|on)|opt.?in.*(date|time)/], ['consent', /(consent|opt.?in|agreed|permission)/],
    ['city', /^city$/], ['locality', /(locality|location|preferred ?area|^area$|micro ?market)/], ['bhk', /(bhk|config|bedroom|unit ?type)/],
    ['budget', /budget|price/], ['timeline', /(timeline|time ?frame|when|possession ?need)/], ['project', /project/],
    ['referred_by', /(referred|broker|channel ?partner|agent|source ?name)/], ['external_id', /^(id|lead ?id|record ?id|ref(erence)?)$/],
    ['message', /(note|remark|comment|message|requirement)/],
  ];
  const out: CsvMapping = {};
  headers.forEach((h, i) => {
    const k = h.toLowerCase().trim();
    const hit = rules.find(([f, re]) => out[f] === undefined && re.test(k));
    if (hit) out[hit[0]] = i;
  });
  return out;
}

/** "yes" / "no" / unknown for a consent cell. Only clear, affirmative words count as yes. */
export function consentCell(v: string): 'yes' | 'no' | 'unknown' {
  const s = v.trim().toLowerCase();
  if (!s) return 'unknown';
  if (/^(y|yes|true|1|agreed|agree|opted in|opt in|opt-in|consented|given)$/.test(s)) return 'yes';
  if (/^(n|no|false|0|declined|opted out|opt out|opt-out|not given|refused)$/.test(s)) return 'no';
  return 'unknown';
}

export interface CsvProvenance {
  kind: 'broker_referral' | 'buyer_enquiry';
  /** Who supplied the file: broker / firm / team member. */
  supplied_by: string;
  supplier_rera?: string;
  /** How the people in the file agreed to be contacted by Mappingg (shown with every lead). */
  consent_basis: string;
  /** The uploader confirms the basis is true for every row they import. */
  attest: boolean;
}

export type CsvRowResult =
  | { ok: true; row: number; key: string; lead: IncomingLead }
  | { ok: false; row: number; reason: string };

/** Validates and converts one CSV row (row = 1-based line number in the file, header = 1). */
export function csvRowToLead(cells: string[], row: number, map: CsvMapping, prov: CsvProvenance, uploader: string, now = new Date()): CsvRowResult {
  const cell = (f: CsvField) => (map[f] === undefined ? '' : clip(cells[map[f]!], 300));
  const name = cell('name') || [cell('first_name'), cell('last_name')].filter(Boolean).join(' ');
  if (!name) return { ok: false, row, reason: 'No name' };
  const phone = phoneFields(cell('phone'));
  const rawEmail = cell('email');
  const email = cleanEmail(rawEmail);
  if (rawEmail && !email) return { ok: false, row, reason: 'Email looks invalid' };
  if (phone.phone_raw) return { ok: false, row, reason: 'Phone is not a valid 10-digit mobile number' };
  if (!phone.phone && !email) return { ok: false, row, reason: 'No phone or email' };

  // Consent: if the file has a consent column, every row must say yes. Otherwise the
  // uploader's attested basis covers the file (recorded as asserted by them).
  let capturedAt = now.toISOString();
  if (map.consent !== undefined) {
    const c = consentCell(cell('consent'));
    if (c === 'no') return { ok: false, row, reason: 'Consent column says no' };
    if (c === 'unknown') return { ok: false, row, reason: 'Consent column is blank or unclear' };
  }
  if (map.consent_date !== undefined && cell('consent_date')) {
    const t = Date.parse(cell('consent_date'));
    if (Number.isNaN(t)) return { ok: false, row, reason: 'Consent date is not a date' };
    if (t > now.getTime() + 86_400_000) return { ok: false, row, reason: 'Consent date is in the future' };
    capturedAt = new Date(t).toISOString();
  }

  const kindLabel = prov.kind === 'broker_referral' ? 'Broker referral' : 'Buyer enquiry';
  const key = `${prov.kind}:${sha256(`${phone.phone}|${email}`)}`;
  return {
    ok: true, row, key,
    lead: {
      name, ...phone, email,
      city: cell('city') || undefined, locality: cell('locality') || undefined, bhk: cell('bhk') || undefined,
      budget: cell('budget') || undefined, timeline: cell('timeline') || undefined,
      project_name: cell('project') || undefined,
      message: [cell('message'), cell('referred_by') && `Referred by: ${cell('referred_by')}`].filter(Boolean).join('\n'),
      consent: {
        enquiry: true, call: false, whatsapp: false,
        text: clip(prov.consent_basis, 1000),
        version: `csv-import:${prov.kind}`,
        captured_at: capturedAt,
        source: `CSV import · ${kindLabel} · supplied by ${clip(prov.supplied_by, 120)}`,
        asserted_by: 'uploader',
        asserted_by_user: uploader,
        consent_column: map.consent !== undefined,
      },
      meta: {
        kind: prov.kind, supplied_by: clip(prov.supplied_by, 120), supplier_rera: clip(prov.supplier_rera, 60),
        referred_by: cell('referred_by'), their_id: cell('external_id'), file_row: row,
      },
    },
  };
}
