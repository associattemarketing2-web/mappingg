import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/mongodb';
import { issueOtp } from '@/lib/otp';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { PHONE_ERROR, normalizePhone } from '@/lib/phone';
import { maskPhone, whatsappConfigured, whatsappOtp } from '@/lib/whatsapp';
import { findAccountByMobile } from '@/lib/mobile-account';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/auth/otp — sends a 6-digit code on WhatsApp and returns the signed
// ticket the browser sends back with it (see lib/otp.ts).
//   purpose 'signup' → before creating an account (email must be new); the
//                      code goes to the WhatsApp number on the form.
//   purpose 'login'  → sign in with a mobile number.
//   purpose 'reset'  → "Forgot password?": by email or by mobile; the code
//                      goes to the WhatsApp number on the account.
const schema = z.object({
  email: z.string().trim().toLowerCase().email().optional(),
  mobile: z.string().trim().max(24).optional(),
  purpose: z.enum(['signup', 'reset', 'login']),
  name: z.string().trim().max(120).optional(),
});

const fail = (message: string, status: number) => NextResponse.json({ error: { message } }, { status });
const sent = (ticket: string, to: string) =>
  NextResponse.json({ data: { sent: true, ticket, channel: 'whatsapp', to } }, { headers: { 'Cache-Control': 'private, no-store' } });
const SEND_FAILED = 'Could not send the WhatsApp code. Please check the number and try again in a minute.';

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('Enter a valid email address or mobile number.', 400);
  const { email, purpose } = parsed.data;
  const ip = clientIp(req);
  const limited = rateLimit(`otp-ip:${ip}`, 20, 60 * 60_000) || rateLimit(`otp:${ip}:${email || parsed.data.mobile || ''}`, 5, 15 * 60_000);
  if (limited) return limited;
  if (!whatsappConfigured()) return fail('WhatsApp codes are not set up on the server yet. Please contact us.', 503);

  // ---- Sign-up: verify the WhatsApp number on the form ----
  if (purpose === 'signup') {
    if (!email) return fail('Enter a valid email address.', 400);
    const mobile = normalizePhone(parsed.data.mobile, { required: true });
    if (!mobile) return fail(PHONE_ERROR, 400);
    if (await (await getDb()).collection('users').findOne({ email }, { projection: { id: 1 } })) {
      return fail('An account with this email already exists — please sign in.', 409);
    }
    // Bound to the number, so the account is created with the number that got the code.
    const { code, ticket } = issueOtp(email, 'signup', mobile);
    if (!(await whatsappOtp(mobile, code, parsed.data.name, 'signup'))) return fail(SEND_FAILED, 502);
    return sent(ticket, maskPhone(mobile));
  }

  // ---- Find the account (by email for reset, else by mobile) ----
  let user: Record<string, unknown>;
  let identity: string;
  if (purpose === 'reset' && email) {
    const u = await (await getDb()).collection('users').findOne({ email }, { projection: { name: 1, role: 1, mobile: 1, password_hash: 1 } });
    if (!u || !['buyer', 'developer', 'agent', 'admin', 'employee'].includes(String(u.role || 'buyer'))) return fail('No account found with this email.', 404);
    user = u; identity = email;
  } else {
    const found = await findAccountByMobile(parsed.data.mobile);
    if (!found.ok) return fail(found.message, found.status);
    user = found.user; identity = found.mobile;
  }
  const to = normalizePhone(user.mobile);
  if (!to) return fail('This account has no WhatsApp number saved. Please contact us to reset your password.', 400);

  // login: single-use — last_login_at changes on every sign-in.
  // reset: single-use — bound to the current password.
  const bind = purpose === 'login'
    ? `${String(user.id || user._id)}|${String(user.last_login_at || '')}`
    : String(user.password_hash || 'none');
  const { code, ticket } = issueOtp(identity, purpose, bind);
  if (!(await whatsappOtp(to, code, user.name ? String(user.name) : undefined, purpose))) return fail(SEND_FAILED, 502);
  return sent(ticket, maskPhone(to));
}
