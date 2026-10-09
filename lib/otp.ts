import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { layout, sendMail } from './mailer';

// 6-digit email codes for creating an account and resetting a password.
//
// Stateless: nothing is stored. Sending a code returns a signed ticket
// (email + purpose + expiry, HMAC'd together with the code) that the browser
// sends back with the code the user typed. The server re-computes the HMAC, so
// only someone who received the email can produce a matching pair. `bind` ties
// a ticket to the account's state — the reset ticket is bound to the current
// password hash, so it stops working the moment the password is changed.
// Guessing is capped by rate limits on the verify endpoints.

export type OtpPurpose = 'signup' | 'reset';
const TTL_MS = 10 * 60_000;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set');
  return s;
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const sign = (payload: string, code: string, bind: string) =>
  createHmac('sha256', secret()).update(`${payload}|${code}|${bind}`).digest('base64url');

export function issueOtp(email: string, purpose: OtpPurpose, bind = ''): { code: string; ticket: string } {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const payload = b64(JSON.stringify({ e: email.toLowerCase(), p: purpose, x: Date.now() + TTL_MS }));
  return { code, ticket: `${payload}.${sign(payload, code, bind)}` };
}

/** Error message, or null when the code matches the ticket for this email and purpose. */
export function checkOtp(ticket: unknown, code: unknown, email: string, purpose: OtpPurpose, bind = ''): string | null {
  const c = String(code ?? '').replace(/\D/g, '');
  if (c.length !== 6) return 'Enter the 6-digit code we emailed you.';
  const [payload, mac] = String(ticket ?? '').split('.');
  if (!payload || !mac) return 'Please request a verification code first.';
  let data: { e?: string; p?: string; x?: number };
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return 'Please request a new code.'; }
  if (data.e !== email.toLowerCase() || data.p !== purpose) return 'Please request a new code for this email.';
  if (!data.x || Date.now() > data.x) return 'That code has expired — please request a new one.';
  const want = Buffer.from(sign(payload, c, bind));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return 'That code is not correct.';
  return null;
}

export async function emailOtp(email: string, code: string, purpose: OtpPurpose, name?: string): Promise<boolean> {
  const what = purpose === 'signup' ? 'create your Mappingg account' : 'reset your Mappingg password';
  return sendMail({
    to: email,
    subject: `${code} is your Mappingg ${purpose === 'signup' ? 'verification' : 'password reset'} code`,
    html: layout({
      title: purpose === 'signup' ? 'Verify your email' : 'Reset your password',
      body: [
        `Hi${name ? ` ${name.split(' ')[0].replace(/[<>&"']/g, '')}` : ''}, use this code to ${what}:`,
        `<span style="display:inline-block;font-size:30px;letter-spacing:8px;font-weight:700;color:#111827;background:#f1f5f9;padding:10px 18px;border-radius:10px">${code}</span>`,
        'The code is valid for 10 minutes. If you didn’t ask for it, you can ignore this email.',
      ],
    }),
  });
}
