import { logMessage, updateStatus, type OtpPurpose, type WaAuthor, type WaKind, type WaMessage, type WaStatus } from './wa-store';

// WhatsApp messages through the WhatsApp Business API provider (GABS):
//   - OTP codes: approved "mapping_mobile_verification" template, with the code
//     in its BODY and again in its URL button (copy-code / autofill link).
//   - Buyer welcome: "buyers_account_created" template, no variables.
//   - Chat replies (AI or staff): free text. WhatsApp only delivers these within
//     24 hours of the customer's last message; outside that, use a template.
// Every send is logged for the s-admin WhatsApp panel (lib/wa-store.ts); OTP
// codes themselves are never logged.
//
// Env (server-only):
//   WHATSAPP_API_URL      template endpoint the JSON below is POSTed to (required)
//   WHATSAPP_API_KEY      api_key (required)
//   WHATSAPP_SENDER       sender number, default 918228828200
//   WHATSAPP_CAMPAIGN_ID  campaign_id (optional)
//   WHATSAPP_TEMPLATE     template name, default mapping_mobile_verification
//   WHATSAPP_TEMPLATE_LANG  default en_US
//   WHATSAPP_BUYER_WELCOME_TEMPLATE  sent after a buyer signs up, default buyers_account_created
//   WHATSAPP_TEXT_API_URL free-text (session) message endpoint, default
//                         https://app.getgabs.com/whatsappbusiness/send-message

export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_API_URL && process.env.WHATSAPP_API_KEY);
}

/** "+91 9876543210" → "919876543210" (the format the API wants). */
const toWaNumber = (mobile: string) => String(mobile || '').replace(/\D/g, '');

/** "+91 9876543210" → "+91 98XXXXXX10" for "code sent to …" messages. */
export function maskPhone(mobile: string): string {
  const m = /^(\+\d{1,4})\s*(\d+)$/.exec(String(mobile || '').trim());
  if (!m) return 'your WhatsApp number';
  const n = m[2];
  return `${m[1]} ${n.slice(0, 2)}${'X'.repeat(Math.max(0, n.length - 4))}${n.slice(-2)}`;
}

/** Asks GABS for a sent message's delivery status (sent / delivered / failed + reason) and records it. */
async function checkDelivery(messageId: string): Promise<void> {
  try {
    const res = await fetch('https://app.getgabs.com/whatsappbusiness/getmessgageinfobyid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.WHATSAPP_API_KEY, message_id: messageId }),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    const text = await res.text();
    console.log('[whatsapp] delivery', messageId, text.slice(0, 300));
    const st = /"(?:status|message_status)"\s*:\s*"(read|delivered|sent|failed)"/i.exec(text)?.[1]?.toLowerCase() as WaStatus | undefined;
    if (st) await updateStatus(messageId, st, st === 'failed' ? text.slice(0, 300) : undefined);
  } catch (e) {
    console.error('[whatsapp] delivery check error', (e as Error).message);
  }
}

/** What to record in the WhatsApp panel for a send. */
interface LogAs { author: WaAuthor; kind: WaKind; body: string; by?: string; template?: string; purpose?: WaMessage['purpose'] }

export interface SendResult { ok: boolean; message: WaMessage | null; error?: string }

/** POSTs one message to GABS and logs it. Resolves (never throws) with ok false on any failure. */
async function post(url: string, mobile: string, name: string | undefined, payload: Record<string, unknown>, log: LogAs): Promise<SendResult> {
  const to = toWaNumber(mobile);
  const record = (status: WaStatus, error?: string, waId?: string) =>
    logMessage({ phone: to, direction: 'out', status, error, wa_id: waId, ...log });
  if (!whatsappConfigured()) return { ok: false, message: null, error: 'WhatsApp is not set up on the server' };
  if (to.length < 11) return { ok: false, message: null, error: 'Invalid WhatsApp number' };
  const body = {
    api_key: process.env.WHATSAPP_API_KEY,
    sender: process.env.WHATSAPP_SENDER || '918228828200',
    campaign_id: process.env.WHATSAPP_CAMPAIGN_ID || '',
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    receiver_name: (name || 'Mappingg user').slice(0, 60),
    ...payload,
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    const text = await res.text();
    // Some providers answer HTTP 200 with { status: false / "error" } — treat those as failures too.
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    const st = String(json.status ?? json.success ?? '').toLowerCase();
    const failed = !res.ok || st === 'false' || st === 'error' || st === 'failed' || Boolean(json.error);
    if (failed) {
      console.error('[whatsapp] send failed', log.template || log.kind, res.status, text.slice(0, 500));
      // GABS explains refusals in `msg` (e.g. "…only available in Pro Plan.") — show that, not a generic error.
      const reason = String(json.msg ?? json.message ?? (json.error as { message?: string } | undefined)?.message ?? '').trim().slice(0, 300);
      return {
        ok: false,
        message: await record('failed', reason || text.slice(0, 300) || `HTTP ${res.status}`),
        error: reason ? `WhatsApp provider: ${reason}` : 'WhatsApp did not accept the message',
      };
    }
    // "accepted" only means GABS queued it — check the real delivery result a bit later.
    const id = (json.messages as { id?: string }[] | undefined)?.[0]?.id;
    console.log('[whatsapp] accepted', log.template || log.kind, to.slice(0, 4) + '…' + to.slice(-2), id || text.slice(0, 200));
    const message = await record('accepted', undefined, id);
    if (id) setTimeout(() => { void checkDelivery(id); }, 15_000);
    return { ok: true, message };
  } catch (e) {
    console.error('[whatsapp] send error', (e as Error).message);
    return { ok: false, message: await record('failed', (e as Error).message), error: 'Could not reach WhatsApp' };
  }
}

const templateUrl = () => process.env.WHATSAPP_API_URL as string;
const textUrl = () => process.env.WHATSAPP_TEXT_API_URL || 'https://app.getgabs.com/whatsappbusiness/send-message';
const lang = () => ({ code: process.env.WHATSAPP_TEMPLATE_LANG || 'en_US' });

const PURPOSE_LABEL: Record<OtpPurpose, string> = { signup: 'sign-up', login: 'WhatsApp sign-in', reset: 'password reset' };

/** Sends the 6-digit code on WhatsApp. Resolves false (never throws) on any failure. */
export async function whatsappOtp(mobile: string, code: string, name?: string, purpose: OtpPurpose = 'signup'): Promise<boolean> {
  const template = process.env.WHATSAPP_TEMPLATE || 'mapping_mobile_verification';
  const r = await post(templateUrl(), mobile, name, {
    type: 'template',
    template: {
      name: template,
      language: lang(),
      components: [
        { type: 'BODY', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'URL', index: 0, parameters: [{ type: 'text', text: code }] },
      ],
    },
  }, { author: 'system', kind: 'otp', template, purpose, body: `Verification code for ${PURPOSE_LABEL[purpose]} (code hidden)` });
  return r.ok;
}

/** "Congratulations — your account is fully created" message to a new buyer (no variables). */
export async function whatsappBuyerWelcome(mobile: string, name?: string): Promise<boolean> {
  // "byres_account_created" was the old welcome template — never send it, even if the server env still names it.
  const fromEnv = process.env.WHATSAPP_BUYER_WELCOME_TEMPLATE;
  const template = fromEnv && fromEnv !== 'byres_account_created' ? fromEnv : 'buyers_account_created';
  const r = await post(templateUrl(), mobile, name, { type: 'template', template: { name: template, language: lang() } },
    { author: 'system', kind: 'template', template, purpose: 'buyer_welcome', body: 'Buyer account created — congratulations message' });
  return r.ok;
}

/** Free-text chat reply (AI or staff). Only delivered within 24 hours of the customer's last message. */
export function whatsappText(mobile: string, text: string, author: 'ai' | 'staff', by?: string): Promise<SendResult> {
  const body = text.trim().slice(0, 4096);
  return post(textUrl(), mobile, undefined, { type: 'text', text: { preview_url: true, body } }, { author, by, kind: 'text', body });
}
