// WhatsApp OTP messages through the WhatsApp Business API provider, using the
// approved "mapping_mobile_verification" template. The template has the code
// in its BODY and again in its URL button (copy-code / autofill link).
//
// Env (server-only):
//   WHATSAPP_API_URL      provider endpoint the JSON below is POSTed to (required)
//   WHATSAPP_API_KEY      api_key (required)
//   WHATSAPP_SENDER       sender number, default 918228828200
//   WHATSAPP_CAMPAIGN_ID  campaign_id (optional)
//   WHATSAPP_TEMPLATE     template name, default mapping_mobile_verification
//   WHATSAPP_TEMPLATE_LANG  default en_US

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

/** Logs GABS' delivery status for a sent message (sent / delivered / failed + reason). */
async function logDelivery(messageId: string): Promise<void> {
  try {
    const res = await fetch('https://app.getgabs.com/whatsappbusiness/getmessgageinfobyid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.WHATSAPP_API_KEY, message_id: messageId }),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    console.log('[whatsapp] delivery', messageId, (await res.text()).slice(0, 300));
  } catch (e) {
    console.error('[whatsapp] delivery check error', (e as Error).message);
  }
}

/** Sends the 6-digit code on WhatsApp. Resolves false (never throws) on any failure. */
export async function whatsappOtp(mobile: string, code: string, name?: string): Promise<boolean> {
  if (!whatsappConfigured()) return false;
  const to = toWaNumber(mobile);
  if (to.length < 11) return false;
  const body = {
    api_key: process.env.WHATSAPP_API_KEY,
    sender: process.env.WHATSAPP_SENDER || '918228828200',
    campaign_id: process.env.WHATSAPP_CAMPAIGN_ID || '',
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    receiver_name: (name || 'Mappingg user').slice(0, 60),
    type: 'template',
    template: {
      name: process.env.WHATSAPP_TEMPLATE || 'mapping_mobile_verification',
      language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en_US' },
      components: [
        { type: 'BODY', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'URL', index: 0, parameters: [{ type: 'text', text: code }] },
      ],
    },
  };
  try {
    const res = await fetch(process.env.WHATSAPP_API_URL as string, {
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
      console.error('[whatsapp] send failed', res.status, text.slice(0, 500));
      return false;
    }
    // "accepted" only means GABS queued it — log the real delivery result a bit later.
    const id = (json.messages as { id?: string }[] | undefined)?.[0]?.id;
    console.log('[whatsapp] accepted', to.slice(0, 4) + '…' + to.slice(-2), id || text.slice(0, 200));
    if (id) setTimeout(() => { void logDelivery(id); }, 15_000);
    return true;
  } catch (e) {
    console.error('[whatsapp] send error', (e as Error).message);
    return false;
  }
}
