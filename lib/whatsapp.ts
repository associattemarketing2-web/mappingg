import { logMessage, updateStatus, type OtpPurpose, type WaAuthor, type WaKind, type WaMessage, type WaStatus } from './wa-store';

// WhatsApp messages through the WhatsApp Business API provider. Two providers:
//   - whatapi.in (Meta Cloud API format) — used whenever WHATSAPP_META_TOKEN and
//     WHATSAPP_PHONE_NUMBER_ID are set. POST {API_URL}/{version}/{phone id}/messages
//     with a Bearer token; approved templates are listed from the WABA.
//   - GABS (older) — WHATSAPP_API_URL + WHATSAPP_API_KEY, used otherwise.
// What is sent:
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
// whatapi.in (Meta format):
//   WHATSAPP_META_API_URL      default https://crmapi1.whatapi.in/api/meta
//   WHATSAPP_META_API_VERSION  default v19.0
//   WHATSAPP_META_TOKEN        access token (required)
//   WHATSAPP_PHONE_NUMBER_ID   phone number id (required)
//   WHATSAPP_WABA_ID           WhatsApp Business Account id (template list for Bulk send)
//   WHATSAPP_OTP_TEMPLATE      OTP template, default otp
//   WHATSAPP_OTP_TEMPLATE_LANG default en

/** 'meta' = whatapi.in (Meta Cloud API format), 'gabs' = the older GABS API. */
export function whatsappProvider(): 'meta' | 'gabs' {
  return process.env.WHATSAPP_META_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID ? 'meta' : 'gabs';
}

export function whatsappConfigured(): boolean {
  return whatsappProvider() === 'meta' || Boolean(process.env.WHATSAPP_API_URL && process.env.WHATSAPP_API_KEY);
}

const metaBase = () =>
  `${(process.env.WHATSAPP_META_API_URL || 'https://crmapi1.whatapi.in/api/meta').replace(/\/+$/, '')}/${process.env.WHATSAPP_META_API_VERSION || 'v19.0'}`;
const metaHeaders = () => ({ Authorization: `Bearer ${process.env.WHATSAPP_META_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' });

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
interface LogAs { author: WaAuthor; kind: WaKind; body: string; by?: string; template?: string; purpose?: WaMessage['purpose']; campaign?: string }

export interface SendResult { ok: boolean; message: WaMessage | null; error?: string }

type Recorder = (status: WaStatus, error?: string, waId?: string) => Promise<WaMessage | null>;

/** POSTs one message (Meta Cloud API format) to whatapi.in and logs it. Resolves (never throws). */
async function postMeta(to: string, payload: Record<string, unknown>, log: LogAs, record: Recorder): Promise<SendResult> {
  try {
    const res = await fetch(`${metaBase()}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: metaHeaders(),
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload }),
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    });
    const text = await res.text();
    let json: Record<string, any> = {};
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    // Meta answers { messages: [{ id }] }; whatapi.in answers { message: { queue_id, message_status: "queued" } }.
    // whatapi.in queues even a wrong template name — that failure only shows up later (webhook / its dashboard).
    const msg = json.message && typeof json.message === 'object' ? json.message : {};
    const id = (json.messages as { id?: string }[] | undefined)?.[0]?.id || msg.id || msg.wamid || msg.queue_id;
    const refused = /fail|error|reject/i.test(String(msg.message_status || ''));
    if (!res.ok || json.error || refused || !id) {
      console.error('[whatsapp] send failed', log.template || log.kind, res.status, text.slice(0, 500));
      const e = json.error && typeof json.error === 'object' ? json.error : {};
      const reason = String(e.error_data?.details || e.message || (typeof json.error === 'string' ? json.error : '') || (typeof json.message === 'string' ? json.message : msg.error || msg.message_status) || '').trim().slice(0, 300);
      return {
        ok: false,
        message: await record('failed', reason || text.slice(0, 300) || `HTTP ${res.status}`),
        error: reason ? `WhatsApp provider: ${reason}` : 'WhatsApp did not accept the message',
      };
    }
    console.log('[whatsapp] accepted', log.template || log.kind, to.slice(0, 4) + '…' + to.slice(-2), id);
    // Delivered / read / failed arrive later on the webhook (statuses[]).
    return { ok: true, message: await record('accepted', undefined, id) };
  } catch (e) {
    console.error('[whatsapp] send error', (e as Error).message);
    return { ok: false, message: await record('failed', (e as Error).message), error: 'Could not reach WhatsApp' };
  }
}

/** POSTs one message to the provider and logs it. Resolves (never throws) with ok false on any failure. */
async function post(url: string, mobile: string, name: string | undefined, payload: Record<string, unknown>, log: LogAs): Promise<SendResult> {
  const to = toWaNumber(mobile);
  const record: Recorder = (status, error, waId) =>
    logMessage({ phone: to, direction: 'out', status, error, wa_id: waId, ...log });
  if (!whatsappConfigured()) return { ok: false, message: null, error: 'WhatsApp is not set up on the server' };
  if (to.length < 11) return { ok: false, message: null, error: 'Invalid WhatsApp number' };
  if (whatsappProvider() === 'meta') return postMeta(to, payload, log, record);
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

const PURPOSE_LABEL: Record<OtpPurpose, string> = { signup: 'sign-up', login: 'WhatsApp sign-in', reset: 'password reset', quick: 'WhatsApp sign-up' };

/** The OTP template's name for the active provider. */
export function otpTemplate(): string {
  return whatsappProvider() === 'meta'
    ? process.env.WHATSAPP_OTP_TEMPLATE || 'otp'
    : process.env.WHATSAPP_TEMPLATE || 'mapping_mobile_verification';
}

/** Sends the 6-digit code on WhatsApp. Resolves false (never throws) on any failure. */
export async function whatsappOtp(mobile: string, code: string, name?: string, purpose: OtpPurpose = 'signup'): Promise<boolean> {
  const template = otpTemplate();
  const meta = whatsappProvider() === 'meta';
  const r = await post(templateUrl(), mobile, name, {
    type: 'template',
    template: {
      name: template,
      language: meta ? { policy: 'deterministic', code: process.env.WHATSAPP_OTP_TEMPLATE_LANG || 'en' } : lang(),
      components: [
        { type: meta ? 'body' : 'BODY', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: meta ? 'url' : 'URL', index: 0, parameters: [{ type: 'text', text: code }] },
      ],
    },
  }, { author: 'system', kind: 'otp', template, purpose, body: `Verification code for ${PURPOSE_LABEL[purpose]} (code hidden)` });
  return r.ok;
}

/** The buyer welcome template's name (also what Bulk send shoots). */
export function buyerWelcomeTemplate(): string {
  // "byres_account_created" was the old welcome template — never send it, even if the server env still names it.
  const fromEnv = process.env.WHATSAPP_BUYER_WELCOME_TEMPLATE;
  return fromEnv && fromEnv !== 'byres_account_created' ? fromEnv : 'buyers_account_created';
}

/** "Congratulations — your account is fully created" message to a new buyer (no variables). */
export async function whatsappBuyerWelcome(mobile: string, name?: string): Promise<boolean> {
  const template = buyerWelcomeTemplate();
  const r = await post(templateUrl(), mobile, name, { type: 'template', template: { name: template, language: lang() } },
    { author: 'system', kind: 'template', template, purpose: 'buyer_welcome', body: 'Buyer account created — congratulations message' });
  return r.ok;
}

/** Free-text chat reply (AI or staff). Only delivered within 24 hours of the customer's last message. */
export function whatsappText(mobile: string, text: string, author: 'ai' | 'staff', by?: string): Promise<SendResult> {
  const body = text.trim().slice(0, 4096);
  return post(textUrl(), mobile, undefined, { type: 'text', text: { preview_url: true, body } }, { author, by, kind: 'text', body });
}

/** Photo with a caption (project card). Same 24-hour rule as text. WhatsApp takes JPEG/PNG up to 5 MB. */
export function whatsappImage(mobile: string, link: string, caption: string, author: 'ai' | 'staff', by?: string): Promise<SendResult> {
  const body = caption.trim().slice(0, 1024);
  return post(textUrl(), mobile, undefined, { type: 'image', image: { link, caption: body } }, { author, by, kind: 'media', body });
}

/** Bulk send: the buyer welcome template (no variables) to one number, logged under its batch. Resolves (never throws). */
export function whatsappBulkWelcome(mobile: string, name: string | undefined, campaign: string, by?: string): Promise<SendResult> {
  const template = buyerWelcomeTemplate();
  return post(templateUrl(), mobile, name, { type: 'template', template: { name: template, language: lang() } },
    { author: 'system', kind: 'template', template, purpose: 'bulk', campaign, by, body: `Bulk send: ${template}` });
}

/* ------------------------- Approved templates (whatapi.in) ------------------------- */

/** An approved template Bulk send can shoot. `vars` = {{n}} count in the body; `urlVars` = in the URL button. */
export interface WaTemplate {
  name: string; language: string; category: string; body: string; vars: number; urlVars: number;
  /** Header type: NONE, TEXT (headerVars = its {{n}} count), or a media header that needs a file link. */
  header: 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT'; headerVars: number; headerText: string;
}

let tplCache: { at: number; list: WaTemplate[] } | null = null;
const countVars = (t: unknown) => new Set(String(t || '').match(/\{\{\s*\d+\s*\}\}/g) || []).size;

/**
 * Approved, non-OTP templates of the WhatsApp Business Account (whatapi.in only; empty for GABS).
 * Cached for 5 minutes. Throws when the provider can't be reached.
 */
export async function approvedTemplates(fresh = false): Promise<WaTemplate[]> {
  if (whatsappProvider() !== 'meta' || !process.env.WHATSAPP_WABA_ID) return [];
  if (!fresh && tplCache && Date.now() - tplCache.at < 5 * 60_000) return tplCache.list;
  const out: WaTemplate[] = [];
  let url: string | null = `${metaBase()}/${process.env.WHATSAPP_WABA_ID}/message_templates?limit=100`;
  for (let page = 0; url && page < 10; page++) {
    const res: Response = await fetch(url, { headers: metaHeaders(), signal: AbortSignal.timeout(20_000), cache: 'no-store' });
    const json = (await res.json().catch(() => ({}))) as { data?: any[]; paging?: { next?: string }; error?: any };
    if (!res.ok || !Array.isArray(json.data)) throw new Error(`Could not load templates (${json.error?.message || json.error || `HTTP ${res.status}`})`);
    for (const t of json.data) {
      if (String(t.status).toUpperCase() !== 'APPROVED' || String(t.category).toUpperCase() === 'AUTHENTICATION') continue;
      const comps = (t.components || []) as any[];
      // Image / video / document headers take a file link when sending; location headers are not supported.
      const header = comps.find((c) => c.type === 'HEADER');
      const hf = String(header?.format || (header ? 'TEXT' : 'NONE')).toUpperCase();
      if (!['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'].includes(hf)) continue;
      const body = String(comps.find((c) => c.type === 'BODY')?.text || '');
      const buttons = (comps.find((c) => c.type === 'BUTTONS')?.buttons || []) as any[];
      const urlVars = buttons.filter((b) => b.type === 'URL' && countVars(b.url)).length;
      out.push({
        name: String(t.name), language: String(t.language || 'en'), category: String(t.category || ''), body, vars: countVars(body), urlVars,
        header: hf as WaTemplate['header'], headerVars: hf === 'TEXT' ? countVars(header?.text) : 0, headerText: hf === 'TEXT' ? String(header?.text || '') : '',
      });
    }
    url = json.paging?.next || null;
  }
  tplCache = { at: Date.now(), list: out };
  return out;
}

/** Values for a template header: text variables, or the file of an image / video / document header. */
export type TemplateHeader = { type: 'text'; params: string[] } | { type: 'image' | 'video' | 'document'; link: string; filename?: string };

function headerComponents(h?: TemplateHeader): Record<string, unknown>[] {
  if (!h) return [];
  if (h.type === 'text') return h.params.length ? [{ type: 'header', parameters: h.params.map((text) => ({ type: 'text', text: text || '-' })) }] : [];
  if (!h.link) return [];
  return [{ type: 'header', parameters: [{ type: h.type, [h.type]: { link: h.link, ...(h.type === 'document' && h.filename ? { filename: h.filename } : {}) } }] }];
}

/** Bulk send: one approved template with its {{1}}… values to one number, logged under its batch. Resolves (never throws). */
export function whatsappBulkTemplate(
  mobile: string, name: string | undefined, tpl: { name: string; language: string; params: string[]; urlParam?: string; header?: TemplateHeader },
  campaign: string, by?: string,
): Promise<SendResult> {
  const components: Record<string, unknown>[] = headerComponents(tpl.header);
  if (tpl.params.length) components.push({ type: 'body', parameters: tpl.params.map((text) => ({ type: 'text', text: text || '-' })) });
  if (tpl.urlParam) components.push({ type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: tpl.urlParam }] });
  return post(templateUrl(), mobile, name, {
    type: 'template',
    template: { name: tpl.name, language: { code: tpl.language }, ...(components.length ? { components } : {}) },
  }, {
    author: 'system', kind: 'template', template: tpl.name, purpose: 'bulk', campaign, by,
    body: `Bulk send: ${tpl.name}${tpl.params.length ? ` (${tpl.params.join(' | ').slice(0, 200)})` : ''}`,
  });
}

/** Bulk send: a typed message to one number. Free text, so WhatsApp only delivers it within 24 hours of the customer's last message. */
export function whatsappBulkText(mobile: string, name: string | undefined, text: string, campaign: string, by?: string): Promise<SendResult> {
  const body = text.trim().slice(0, 4096);
  return post(textUrl(), mobile, name, { type: 'text', text: { preview_url: true, body } }, { author: 'staff', by, kind: 'text', purpose: 'bulk', campaign, body });
}

/* ------------------------- Any message (Send / Schedule) ------------------------- */

export type MediaKind = 'image' | 'video' | 'document';

/** One message of a send or schedule: typed text, a file (with caption), or an approved template. */
export interface WaPayload {
  kind: 'text' | MediaKind | 'template';
  /** Text, or the caption of a file. */
  text?: string;
  media?: { url: string; filename?: string };
  template?: TemplateRef;
  /**
   * Text / file only: the approved template sent instead to anyone who has not messaged in the last 24 hours
   * (WhatsApp drops typed messages and files then). {message} in its values = this message's text / caption;
   * a header with an empty link takes this message's file.
   */
  fallback?: TemplateRef;
}

export interface TemplateRef { name: string; language: string; params: string[]; url_param?: string; header?: TemplateHeader }

/** Template values may not contain line breaks, tabs or 4+ spaces in a row (WhatsApp rule). */
export const templateSafe = (v: string) => v.replace(/\s*[\r\n]+\s*/g, ' · ').replace(/\t/g, ' ').replace(/ {4,}/g, '   ').trim();

/** The template version of a text / file message (see WaPayload.fallback), or null when there is none. */
export function fallbackPayload(p: WaPayload): WaPayload | null {
  if (p.kind === 'template' || !p.fallback) return null;
  const msg = templateSafe(p.text || '').slice(0, 1000) || '-';
  const fill = (v: string) => v.replace(/\{message\}/gi, msg);
  const t = p.fallback;
  let header = t.header;
  if (header?.type === 'text') header = { type: 'text', params: header.params.map(fill) };
  else if (header && !header.link && p.media?.url && header.type === p.kind) header = { ...header, link: p.media.url, ...(p.media.filename ? { filename: p.media.filename } : {}) };
  return { kind: 'template', template: { ...t, params: t.params.map(fill), ...(t.url_param ? { url_param: fill(t.url_param) } : {}), ...(header ? { header } : {}) } };
}

const MEDIA_LABEL: Record<MediaKind, string> = { image: 'Photo', video: 'Video', document: 'Document' };

/** Short text for logs, history and the chat view. */
export function payloadSummary(p: WaPayload): string {
  if (p.kind === 'text') return String(p.text || '');
  if (p.kind === 'template') return `Template: ${p.template?.name || ''}${p.template?.params.length ? ` (${p.template.params.join(' | ').slice(0, 200)})` : ''}`;
  return `[${MEDIA_LABEL[p.kind]}${p.media?.filename ? `: ${p.media.filename}` : ''}]${p.text ? ` ${p.text}` : ''}`;
}

/** {name} → the recipient's name and {link} → their own share link, everywhere in a payload. */
export function fillPayload(p: WaPayload, name?: string, vars: { link?: string } = {}): WaPayload {
  const fill = (v: string) => v.replace(/\{name\}/gi, name || 'there').replace(/\{link\}/gi, vars.link || '');
  const t = p.template;
  // Template values must be one line (the name is too).
  const tfill = (v: string) => templateSafe(fill(v));
  return {
    ...p,
    ...(p.text != null ? { text: fill(p.text) } : {}),
    ...(t ? {
      template: {
        ...t, params: t.params.map(tfill), ...(t.url_param ? { url_param: fill(t.url_param) } : {}),
        ...(t.header?.type === 'text' ? { header: { type: 'text' as const, params: t.header.params.map(tfill) } } : {}),
      },
    } : {}),
  };
}

/**
 * Sends one payload to one number and logs it. With a campaign it is logged as purpose 'bulk' so it shows under
 * Bulk send history. {name} becomes the recipient's name. Resolves (never throws).
 */
export function whatsappSend(
  mobile: string, name: string | undefined, payload: WaPayload,
  log: { author: 'staff' | 'system'; by?: string; campaign?: string },
  vars: { link?: string } = {},
): Promise<SendResult> {
  const p = fillPayload(payload, name, vars);
  const purpose = log.campaign ? ('bulk' as const) : undefined;
  const base = { author: log.author, by: log.by, purpose, campaign: log.campaign };
  if (p.kind === 'template') {
    const t = p.template!;
    const components = headerComponents(t.header);
    if (t.params.length) components.push({ type: 'body', parameters: t.params.map((x) => ({ type: 'text', text: x || '-' })) });
    if (t.url_param) components.push({ type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: t.url_param }] });
    return post(templateUrl(), mobile, name, { type: 'template', template: { name: t.name, language: { code: t.language }, ...(components.length ? { components } : {}) } },
      { ...base, author: 'system', kind: 'template', template: t.name, body: payloadSummary(p) });
  }
  if (p.kind === 'text') {
    const body = String(p.text || '').trim().slice(0, 4096);
    return post(textUrl(), mobile, name, { type: 'text', text: { preview_url: true, body } }, { ...base, kind: 'text', body });
  }
  const caption = String(p.text || '').trim().slice(0, 1024);
  const media: Record<string, unknown> = { link: p.media?.url || '' };
  if (caption) media.caption = caption;
  if (p.kind === 'document' && p.media?.filename) media.filename = p.media.filename;
  return post(textUrl(), mobile, name, { type: p.kind, [p.kind]: media }, { ...base, kind: 'media', body: payloadSummary({ ...p, text: caption }) });
}
