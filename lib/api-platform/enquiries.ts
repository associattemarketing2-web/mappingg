import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '../mongodb';
import { query } from '../pg';
import { normalizePhone } from '../phone';
import { pushToCrm } from '../crm';
import { esc, notifyAdmin } from '../mailer';
import { optInSummary, type ConsentRecord } from '../consent';
import { LIMITS } from './config';
import { ApiError } from './handler';
import * as store from './store';
import type { ApiApp, Sql } from './store';
import { findProject } from './data';
import { developerNameOf, visible, type PinRow } from './serializers';

// POST /api/v1/enquiries — a partner website sends a visitor's enquiry into the
// Mappingg CRM. The lead is written to the SAME `leads` collection, in the same
// shape, as the live-map enquiry form (app/api/db → lib/db-engine), and goes
// through the same follow-up: phone rule (lib/phone), consent shape
// (lib/consent), sales-CRM webhook (lib/crm pushToCrm) and admin email. It then
// appears in Super admin → Leads (map enquiries) like any other enquiry, under
// the CRM's existing status / assignment rules: status "new", unassigned.
//
// Partners can never set lead ids, status, notes, assignment, ownership or any
// other internal field: the body schema is strict and the stored row is built
// here field by field.
//
// CONSENT: Mappingg cannot see the partner's form, so the consent stored here is
// consent the PARTNER ASSERTS it obtained (with the exact wording and version it
// showed, and when). It is recorded as such (`asserted_by_partner: true`); the
// partner is responsible for having actually obtained it (see /developer-api).

// ---- request schema -------------------------------------------------------------------

const text = (max: number) => z.string().trim().max(max);
const SAFE = /^[\p{L}\p{N} .,'&()₹\-–+/#:]*$/u;
export const BHK_OPTIONS = ['1 RK', '1 BHK', '1.5 BHK', '2 BHK', '2.5 BHK', '3 BHK', '3.5 BHK', '4 BHK', '4.5 BHK', '5+ BHK', 'Villa', 'Plot', 'Shop', 'Office'] as const;

export const enquirySchema = z.object({
  submissionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'use 8–64 letters, digits, "-" or "_" (unique per enquiry; reuse it when retrying)'),
  name: text(120).min(2).regex(/\p{L}/u, 'must contain letters'),
  phone: text(24).min(10),
  email: z.string().trim().toLowerCase().max(200).email().optional(),
  projectId: z.number().int().min(1).max(9_999_999).optional(),
  projectName: text(160).optional(),
  locality: text(120).regex(SAFE, 'contains unsupported characters').optional(),
  budget: text(40).regex(SAFE, 'contains unsupported characters').optional(),
  bhk: z.enum(BHK_OPTIONS).optional(),
  message: text(1000).optional(),
  consent: z.object({
    // The enquiry itself must have been requested by the visitor.
    enquiry: z.literal(true, { errorMap: () => ({ message: 'must be true: the visitor asked to be contacted about this enquiry' }) }),
    // Separate, optional marketing opt-ins — only a literal true counts.
    call: z.boolean().optional(),
    whatsapp: z.boolean().optional(),
    /** The exact consent wording shown to the visitor next to the checkbox. */
    text: text(1000).min(20),
    /** Your version label for that wording (change it whenever the wording changes). */
    textVersion: z.string().regex(/^[A-Za-z0-9._-]{1,60}$/),
    /** When the visitor ticked the box / submitted (ISO 8601 with time zone). */
    capturedAt: z.string().datetime({ offset: true }),
  }).strict(),
  /** The page of YOUR website the form was on (https, on your registered domain). */
  sourcePage: z.string().trim().max(500).url().refine((u) => u.startsWith('https://'), 'must be an https URL'),
  campaign: z.object({
    source: text(100).regex(SAFE).optional(), medium: text(100).regex(SAFE).optional(), name: text(100).regex(SAFE).optional(),
    term: text(100).regex(SAFE).optional(), content: text(100).regex(SAFE).optional(),
  }).strict().optional(),
}).strict();

export type EnquiryInput = z.infer<typeof enquirySchema>;

const URL_RE = /(https?:\/\/|www\.)\S+/gi;
const host = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };

/**
 * Checks that need no database: phone, consent age, source domain, spam heuristics.
 * Returns the normalised phone. Throws ApiError(422) — always with a generic, value-free message.
 */
export function checkEnquiry(e: EnquiryInput, app: Pick<ApiApp, 'website'>, now = new Date()): { phone: string; sourceHost: string } {
  const phone = normalizePhone(e.phone, { required: true });
  if (!phone) throw new ApiError(422, 'invalid_phone', 'phone must be a valid mobile number: country code + 10 digits, e.g. "+91 9876543210".');

  const at = Date.parse(e.consent.capturedAt);
  if (at > now.getTime() + 5 * 60_000) throw new ApiError(422, 'invalid_consent', 'consent.capturedAt is in the future.');
  if (now.getTime() - at > LIMITS.maxConsentAgeHours * 3_600_000) throw new ApiError(422, 'invalid_consent', `consent.capturedAt is older than ${LIMITS.maxConsentAgeHours} hours. Send enquiries when they are made.`);

  const registered = host(app.website || '');
  if (!registered) throw new ApiError(422, 'website_not_registered', 'Your application has no registered website. Ask Mappingg to add the domain your forms are on.');
  const sourceHost = host(e.sourcePage);
  if (sourceHost !== registered && !sourceHost.endsWith(`.${registered}`)) {
    throw new ApiError(422, 'source_not_allowed', 'sourcePage must be on the website registered for your application.');
  }

  // Spam heuristics: links in a name, link-stuffed messages.
  if (URL_RE.test(e.name)) throw new ApiError(422, 'content_rejected', 'The enquiry was rejected as likely spam.');
  URL_RE.lastIndex = 0;
  if ((e.message?.match(URL_RE) || []).length > 2) throw new ApiError(422, 'content_rejected', 'The enquiry was rejected as likely spam.');
  return { phone, sourceHost };
}

/** Stable hash of the submitted fields, to tell a retry from a reused submissionId. */
export const payloadHash = (e: EnquiryInput) => createHash('sha256').update(JSON.stringify(e)).digest('hex');
const newReference = () => `enq_${randomBytes(12).toString('base64url')}`;
const norm = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ---- per-application enquiry limits (shared Postgres counters) ----------------------------

const minuteKey = (app: string, t: number) => `em:${app}:${Math.floor(t / 60_000)}`;
const dayKey = (app: string, t: number) => `ed:${app}:${new Date(t).toISOString().slice(0, 10)}`;
const invalidKey = (app: string, t: number) => `ei:${app}:${Math.floor(t / 3_600_000)}`;

export async function enforceEnquiryLimits(app: ApiApp, sql?: Sql, now = Date.now()) {
  if ((await store.peek(invalidKey(app.id, now), sql)) >= LIMITS.maxInvalidEnquiriesPerHour) {
    throw new ApiError(429, 'enquiries_paused', 'Too many rejected enquiries from this application in the last hour. Fix the integration and try again later.', undefined, { 'Retry-After': String(3600 - Math.floor((now / 1000) % 3600)) });
  }
  const m = minuteKey(app.id, now), d = dayKey(app.id, now);
  const c = await store.hit([{ key: m, ttlSec: 120 }, { key: d, ttlSec: 2 * 86_400 }], sql);
  if (c[d] > app.enquiry_daily_quota) throw new ApiError(429, 'quota_exceeded', 'Daily enquiry quota exceeded. It resets at 00:00 UTC.', undefined, { 'Retry-After': String(86_400 - Math.floor((now / 1000) % 86_400)) });
  if (c[m] > app.enquiry_rate_per_minute) throw new ApiError(429, 'rate_limited', 'Enquiry rate limit exceeded. Retry after the number of seconds in Retry-After.', undefined, { 'Retry-After': String(60 - Math.floor((now / 1000) % 60)) });
}

export async function countInvalid(app: ApiApp, sql?: Sql, now = Date.now()) {
  await store.hit([{ key: invalidKey(app.id, now), ttlSec: 7200 }], sql).catch(() => {});
}

// ---- submission -----------------------------------------------------------------------------

export interface Receipt { submissionId: string; reference: string; status: 'received' }

/**
 * Stores the enquiry once per (application, submissionId).
 * - Same submissionId + same payload → the original receipt again (replayed = true).
 * - Same submissionId + different payload → 409.
 * - Same phone + same project from this application within 24 h (or more than 3 leads for one
 *   phone in 24 h) → the existing lead is updated like a repeat "Enquire now" instead of creating
 *   another. The response is identical either way, so it never reveals whether a number is known.
 */
export async function submitEnquiry(e: EnquiryInput, app: ApiApp, checked: { phone: string; sourceHost: string }, sql?: Sql, now = new Date()): Promise<{ receipt: Receipt; replayed: boolean }> {
  await store.ensureSchema(sql);
  const hash = payloadHash(e);
  const run: Sql = sql || ((t, p = []) => query(t, p));

  const prior = (await run(`SELECT reference, payload_hash, outcome FROM api_enquiry_submissions WHERE app_id=$1 AND submission_id=$2`, [app.id, e.submissionId])).rows[0];
  if (prior) {
    if (prior.payload_hash !== hash) throw new ApiError(409, 'submission_id_reused', 'This submissionId was already used for a different enquiry. Use a new submissionId for each enquiry.');
    if (prior.outcome === 'pending') throw new ApiError(409, 'submission_in_progress', 'This submission is still being processed. Retry in a few seconds.', undefined, { 'Retry-After': '2' });
    return { receipt: { submissionId: e.submissionId, reference: prior.reference, status: 'received' }, replayed: true };
  }

  // Project reference: must be a public, published property project.
  let pin: PinRow | null = null;
  if (e.projectId != null) {
    pin = await findProject(String(e.projectId));
    if (!pin) throw new ApiError(422, 'project_not_found', 'projectId does not match a published Mappingg project.');
    if (e.projectName && visible(pin, 'name') && norm(e.projectName) !== norm(pin.title)) {
      throw new ApiError(422, 'project_mismatch', 'projectName does not match the project with this projectId.');
    }
  }

  const reference = newReference();
  // Claim the submissionId first (primary key): a concurrent retry can't create a second lead.
  const claimed = await run(
    `INSERT INTO api_enquiry_submissions (app_id, submission_id, reference, payload_hash) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING reference`,
    [app.id, e.submissionId, reference, hash],
  );
  if (!claimed.rows.length) return submitEnquiry(e, app, checked, sql, now); // lost the race → replay path

  try {
    const db = await getDb();
    const leads = db.collection<{ _id: string; [k: string]: unknown }>('leads');
    const nowIso = now.toISOString();
    const windowStart = now.getTime() - LIMITS.enquiryDuplicateWindowHours * 3_600_000;
    const recent = (await leads.find({ integration_app_id: app.id, whatsapp: checked.phone }, { projection: { id: 1, pin_id: 1, created_at: 1 } }).toArray())
      .filter((l) => Date.parse(String(l.created_at)) >= windowStart)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const same = recent.find((l) => (l.pin_id || null) === (pin?.id || null)) || (recent.length >= 3 ? recent[0] : null);

    const consent: ConsentRecord & Record<string, unknown> = {
      enquiry: true,
      call: e.consent.call === true,
      whatsapp: e.consent.whatsapp === true,
      text: e.consent.text,
      version: `${app.id}:${e.consent.textVersion}`,
      captured_at: new Date(e.consent.capturedAt).toISOString(),
      source: `Partner website ${checked.sourceHost} (Developer API application ${app.id})`,
      asserted_by_partner: true,
      application_id: app.id,
      received_at: nowIso,
    };

    let leadId: string, outcome: 'created' | 'merged';
    if (same) {
      leadId = String(same.id);
      outcome = 'merged';
      // A repeat, like tapping "Enquire now" again: keep one lead, record how often. A new opt-in
      // is saved; a repeat without one never removes an earlier choice (same rule as /api/my/enquire).
      const optIn = consent.call || consent.whatsapp ? { consent } : {};
      await leads.updateOne({ id: leadId }, { $set: { last_enquired_at: nowIso, updated_at: nowIso, ...optIn }, $inc: { enquiry_clicks: 1 } });
    } else {
      leadId = randomUUID();
      outcome = 'created';
      const needs = [e.bhk && `Looking for: ${e.bhk}`, e.budget && `Budget: ${e.budget}`, e.locality && `Preferred area: ${e.locality}`].filter(Boolean).join(' · ');
      const page = e.sourcePage.split(/[?#]/)[0]; // the query string can carry personal data
      await leads.insertOne({
        _id: leadId, id: leadId,
        ...(pin ? { pin_id: pin.id } : {}),
        role: 'buyer',
        name: e.name,
        whatsapp: checked.phone,
        email: e.email || '',
        message: [needs, e.message].filter(Boolean).join('\n\n'),
        ...(e.locality ? { locality: e.locality } : {}), ...(e.budget ? { budget: e.budget } : {}), ...(e.bhk ? { bhk: e.bhk } : {}),
        consent,
        source: `Partner API · ${app.name}`,
        status: 'new', notes: '',
        enquiry_clicks: 1, last_enquired_at: nowIso,
        integration_app_id: app.id,
        integration: { app_id: app.id, app_name: app.name, website: checked.sourceHost, source_page: page, campaign: e.campaign || null, reference, received_at: nowIso },
        created_at: nowIso, updated_at: nowIso,
      });
    }
    await run(`UPDATE api_enquiry_submissions SET lead_id=$3, outcome=$4 WHERE app_id=$1 AND submission_id=$2`, [app.id, e.submissionId, leadId, outcome]);

    if (outcome === 'created') {
      const project = pin ? String(pin.title || `#${pin.number}`) : e.projectName || '';
      const builder = pin ? developerNameOf(pin) || '' : '';
      pushToCrm({
        name: e.name, mobile: checked.phone, email: e.email || '', project, builder,
        source: `Partner website (${checked.sourceHost}) via Mappingg API`, page: e.sourcePage.split(/[?#]/)[0],
        extra: [['Integration', app.name], ['Looking for', e.bhk], ['Budget', e.budget], ['Area', e.locality], ['Opted in to', optInSummary(consent)],
          ['Campaign', e.campaign ? [e.campaign.source, e.campaign.medium, e.campaign.name].filter(Boolean).join(' / ') : '']],
        message: e.message || '',
      });
      notifyAdmin(`New partner enquiry${project ? `: ${project}` : ''} — ${e.name}`, {
        title: `New enquiry from ${esc(checked.sourceHost)} (Developer API)`,
        body: [],
        rows: [['Name', e.name], ['WhatsApp', checked.phone], ['Email', e.email || ''], ['Project', project], ['Integration', app.name], ['Message', e.message || '']],
        cta: { label: 'Open leads', href: '/dashboard/s-admin' },
      }, e.email || undefined);
    }
    return { receipt: { submissionId: e.submissionId, reference, status: 'received' }, replayed: false };
  } catch (err) {
    // Release the claim so the partner can retry the same submissionId.
    await run(`DELETE FROM api_enquiry_submissions WHERE app_id=$1 AND submission_id=$2 AND outcome='pending'`, [app.id, e.submissionId]).catch(() => {});
    throw err;
  }
}
