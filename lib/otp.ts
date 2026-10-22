import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

// 6-digit codes, sent on WhatsApp (lib/whatsapp.ts), for creating an account,
// signing in with a mobile number and resetting a password.
//
// Stateless: nothing is stored. Sending a code returns a signed ticket
// (identity + purpose + expiry, HMAC'd together with the code) that the
// browser sends back with the code the user typed. The identity is the email
// (sign-up, reset by email) or the stored mobile ("+91 9876543210").
// The server re-computes the HMAC, so only someone who received the message
// can produce a matching pair. `bind` ties a ticket to extra state — the
// sign-up ticket to the WhatsApp number it went to, the reset ticket to the
// current password hash (so it stops working once the password changes).
// Guessing is capped by rate limits on the verify endpoints.

export type OtpPurpose = 'signup' | 'reset' | 'login';
const TTL_MS = 10 * 60_000;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set');
  return s;
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const sign = (payload: string, code: string, bind: string) =>
  createHmac('sha256', secret()).update(`${payload}|${code}|${bind}`).digest('base64url');

export function issueOtp(identity: string, purpose: OtpPurpose, bind = ''): { code: string; ticket: string } {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const payload = b64(JSON.stringify({ e: identity.toLowerCase(), p: purpose, x: Date.now() + TTL_MS }));
  return { code, ticket: `${payload}.${sign(payload, code, bind)}` };
}

/** Error message, or null when the code matches the ticket for this identity and purpose. */
export function checkOtp(ticket: unknown, code: unknown, identity: string, purpose: OtpPurpose, bind = ''): string | null {
  const c = String(code ?? '').replace(/\D/g, '');
  if (c.length !== 6) return 'Enter the 6-digit code we sent you on WhatsApp.';
  const [payload, mac] = String(ticket ?? '').split('.');
  if (!payload || !mac) return 'Please request a verification code first.';
  let data: { e?: string; p?: string; x?: number };
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return 'Please request a new code.'; }
  if (data.e !== identity.toLowerCase() || data.p !== purpose) return 'Please request a new code.';
  if (!data.x || Date.now() > data.x) return 'That code has expired — please request a new one.';
  const want = Buffer.from(sign(payload, c, bind));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return 'That code is not correct.';
  return null;
}
