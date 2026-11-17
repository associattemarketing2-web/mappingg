import { createHmac, timingSafeEqual } from 'node:crypto';

// Payment gateway abstraction. Razorpay is the default provider; another
// provider only needs to implement PaymentProvider and be returned by
// getGateway() for its PAYMENT_GATEWAY value — nothing else changes.
//
// Razorpay is called through its documented REST API (api.razorpay.com/v1) with
// HTTP Basic auth — the same endpoints the official Node SDK wraps — so no extra
// npm dependency is needed. Signatures follow Razorpay's documented schemes:
//   checkout:  HMAC_SHA256(order_id + "|" + payment_id, KEY_SECRET)
//   webhook:   HMAC_SHA256(raw request body, WEBHOOK_SECRET)
// Secrets are read on the server only; only the key id is ever sent to a browser.

export interface GatewayPayment {
  id: string;
  order_id: string | null;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed' | string;
  amount: number;
  currency: string;
  method: string | null;
  error_reason: string | null;
}

export interface WebhookEvent {
  eventId: string | null;
  event: string;
  paymentId: string | null;
  orderId: string | null;
  refundId: string | null;
  amount: number | null;
  status: string | null;
  method: string | null;
  errorReason: string | null;
}

export interface PaymentProvider {
  name: string;
  configured(): boolean;
  webhookConfigured(): boolean;
  mode(): 'test' | 'live' | null;
  publicKey(): string | null;
  createOrder(o: { amount: number; currency: string; receipt: string; notes: Record<string, string> }): Promise<{ id: string; amount: number; currency: string }>;
  verifyCheckoutSignature(o: { orderId: string; paymentId: string; signature: string }): boolean;
  fetchPayment(paymentId: string): Promise<GatewayPayment>;
  capturePayment(paymentId: string, amount: number, currency: string): Promise<GatewayPayment>;
  listOrderPayments(orderId: string): Promise<GatewayPayment[]>;
  refund(paymentId: string, amount: number, notes: Record<string, string>): Promise<{ id: string; status: string; amount: number }>;
  verifyWebhook(rawBody: string, signature: string | null): boolean;
  parseWebhook(body: unknown, eventIdHeader: string | null): WebhookEvent;
}

export class GatewayNotConfigured extends Error {
  constructor() { super('Online payments are not configured yet.'); }
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export const hmacHex = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('hex');

const RZP_API = 'https://api.razorpay.com/v1';

function toPayment(p: Record<string, any>): GatewayPayment {
  return {
    id: String(p.id), order_id: p.order_id ? String(p.order_id) : null, status: String(p.status || ''),
    amount: Number(p.amount) || 0, currency: String(p.currency || 'INR'), method: p.method ? String(p.method) : null,
    error_reason: p.error_description || p.error_reason || null,
  };
}

export function razorpay(env: NodeJS.ProcessEnv = process.env): PaymentProvider {
  const keyId = () => (env.RAZORPAY_KEY_ID || '').trim();
  const secret = () => (env.RAZORPAY_KEY_SECRET || '').trim();
  const whSecret = () => (env.RAZORPAY_WEBHOOK_SECRET || '').trim();

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (!keyId() || !secret()) throw new GatewayNotConfigured();
    const res = await fetch(`${RZP_API}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId()}:${secret()}`).toString('base64')}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data as { error?: { description?: string } })?.error?.description || `Razorpay ${res.status}`;
      throw new Error(msg);
    }
    return data as T;
  }

  return {
    name: 'razorpay',
    configured: () => !!keyId() && !!secret(),
    webhookConfigured: () => !!whSecret(),
    mode: () => (keyId() ? (keyId().startsWith('rzp_live_') ? 'live' : 'test') : null),
    // The checkout widget needs the key id; prefer the explicitly public copy.
    publicKey: () => (env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '').trim() || keyId() || null,
    async createOrder(o) {
      const r = await call<{ id: string; amount: number; currency: string }>('POST', '/orders', {
        amount: o.amount, currency: o.currency, receipt: o.receipt.slice(0, 40), notes: o.notes, payment_capture: 1,
      });
      return { id: r.id, amount: Number(r.amount), currency: r.currency };
    },
    verifyCheckoutSignature({ orderId, paymentId, signature }) {
      if (!secret() || !orderId || !paymentId || !signature) return false;
      return safeEqualHex(hmacHex(secret(), `${orderId}|${paymentId}`), signature);
    },
    async fetchPayment(id) {
      return toPayment(await call<Record<string, any>>('GET', `/payments/${encodeURIComponent(id)}`));
    },
    async capturePayment(id, amount, currency) {
      return toPayment(await call<Record<string, any>>('POST', `/payments/${encodeURIComponent(id)}/capture`, { amount, currency }));
    },
    async listOrderPayments(orderId) {
      const r = await call<{ items?: Record<string, any>[] }>('GET', `/orders/${encodeURIComponent(orderId)}/payments`);
      return (r.items || []).map(toPayment);
    },
    async refund(paymentId, amount, notes) {
      const r = await call<{ id: string; status: string; amount: number }>('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, { amount, notes, speed: 'normal' });
      return { id: r.id, status: r.status, amount: Number(r.amount) };
    },
    verifyWebhook(rawBody, signature) {
      if (!whSecret() || !signature) return false;
      return safeEqualHex(hmacHex(whSecret(), rawBody), signature);
    },
    parseWebhook(body, eventIdHeader) {
      const b = (body || {}) as Record<string, any>;
      const pay = b.payload?.payment?.entity || null;
      const refund = b.payload?.refund?.entity || null;
      const order = b.payload?.order?.entity || null;
      return {
        eventId: eventIdHeader || null,
        event: String(b.event || ''),
        paymentId: pay?.id || refund?.payment_id || null,
        orderId: pay?.order_id || order?.id || null,
        refundId: refund?.id || null,
        amount: pay ? Number(pay.amount) : refund ? Number(refund.amount) : null,
        status: pay?.status || refund?.status || null,
        method: pay?.method || null,
        errorReason: pay?.error_description || pay?.error_reason || null,
      };
    },
  };
}

let override: PaymentProvider | null = null;
/** Tests swap in a fake provider; production never calls this. */
export function setGatewayForTests(p: PaymentProvider | null) { override = p; }

export function getGateway(): PaymentProvider {
  if (override) return override;
  const name = (process.env.PAYMENT_GATEWAY || 'razorpay').trim().toLowerCase();
  if (name !== 'razorpay') {
    console.warn(`[subscriptions] PAYMENT_GATEWAY=${name} is not supported; using razorpay`);
  }
  return razorpay();
}
