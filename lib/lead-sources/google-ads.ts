import { timingSafeEqual } from 'node:crypto';
import { googleAdsToLead, sha256, type GoogleAdsPayload } from './normalize';
import { ingestLead } from './ingest';
import { logRun, logRunThrottled, type Sql } from './store';

// Google Ads lead form webhook. In Google Ads (lead form asset → "Lead delivery
// option" → Webhook integration) you paste our webhook URL and a key. Google
// sends that key inside every request body as `google_key`; we compare it in
// constant time with GOOGLE_ADS_LEAD_WEBHOOK_KEY. "Send test data" sends a
// request with is_test: true — it proves the connection but is never saved as a lead.

export const GOOGLE_SOURCE = 'google_ads';
export const googleKey = () => (process.env.GOOGLE_ADS_LEAD_WEBHOOK_KEY || '').trim();
export const googleConfigured = () => googleKey().length >= 16;

export function keyMatches(given: unknown, expected = googleKey()): boolean {
  if (!expected || typeof given !== 'string' || !given) return false;
  const a = Buffer.from(sha256(given)), b = Buffer.from(sha256(expected));
  return timingSafeEqual(a, b);
}

export type GoogleResult =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 401 | 500 | 503; body: Record<string, unknown> };

/** Handles one webhook body. Never puts personal data in the log. */
export async function handleGoogleWebhook(body: unknown, sql?: Sql): Promise<GoogleResult> {
  if (!googleConfigured()) {
    await logRunThrottled({ source: GOOGLE_SOURCE, action: 'webhook', ok: false, error: 'Webhook received but GOOGLE_ADS_LEAD_WEBHOOK_KEY is not set on the server.' }, 'gads:not-configured', 60_000, sql);
    return { status: 503, body: { error: 'not_configured' } };
  }
  const p = (body && typeof body === 'object' ? body : {}) as GoogleAdsPayload;
  if (!keyMatches(p.google_key)) {
    await logRunThrottled({ source: GOOGLE_SOURCE, action: 'webhook', ok: false, error: 'Rejected a webhook with a missing or wrong key. Check that the key in Google Ads matches GOOGLE_ADS_LEAD_WEBHOOK_KEY.', detail: { form_id: String(p.form_id || '') } }, 'gads:bad-key', 60_000, sql);
    return { status: 401, body: { error: 'invalid_key' } };
  }
  const detail = { form_id: String(p.form_id || ''), campaign_id: String(p.campaign_id || ''), lead_id: String(p.lead_id || '') };
  if (p.is_test === true) {
    await logRun({ source: GOOGLE_SOURCE, action: 'webhook', ok: true, is_test: true, detail: { ...detail, note: 'Test data from Google Ads — not saved as a lead.' } }, sql);
    return { status: 200, body: { ok: true, test: true } };
  }
  let parsed;
  try {
    parsed = googleAdsToLead(p);
  } catch (e) {
    await logRun({ source: GOOGLE_SOURCE, action: 'webhook', ok: false, error: `Malformed lead: ${e instanceof Error ? e.message : 'unreadable body'}`, detail }, sql);
    return { status: 400, body: { error: 'invalid_payload' } };
  }
  try {
    // The key is left out of the hash, so rotating it doesn't change a lead's fingerprint.
    const { google_key: _key, ...rest } = p;
    void _key;
    const r = await ingestLead(GOOGLE_SOURCE, parsed.externalId, parsed.lead, { payloadHash: sha256(JSON.stringify(rest)), sql });
    await logRun({
      source: GOOGLE_SOURCE, action: 'webhook', ok: true,
      imported: r.outcome === 'created' ? 1 : 0, merged: r.outcome === 'merged' ? 1 : 0, skipped: r.outcome === 'replayed' ? 1 : 0,
      detail: { ...detail, outcome: r.outcome },
    }, sql);
    return { status: 200, body: { ok: true } };
  } catch (e) {
    await logRun({ source: GOOGLE_SOURCE, action: 'webhook', ok: false, error: `Could not save the lead: ${e instanceof Error ? e.message : 'database error'}`, detail }, sql);
    // Non-200 makes Google retry; the lead id claim was released, so the retry is safe.
    return { status: 500, body: { error: 'storage_failed' } };
  }
}
