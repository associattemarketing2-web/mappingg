import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/mongodb';
import { OTP_PAUSED, issueOtp, otpEnabled } from '@/lib/otp';
import { clientIp, rateLimit, rateLimitShared } from '@/lib/rate-limit';
import { PHONE_ERROR, normalizePhone } from '@/lib/phone';
import { maskPhone, whatsappConfigured, whatsappOtp } from '@/lib/whatsapp';
import { findAccountByMobile, quickOtpBind } from '@/lib/mobile-account';
import { esc, layout, mailConfigured, sendMail } from '@/lib/mailer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/auth/otp — sends a 6-digit code on WhatsApp and returns the signed
// ticket the browser sends back with it (see lib/otp.ts).
//   purpose 'signup' → before creating an account (email must be new); the
//                      code goes to the WhatsApp number on the form.
//   purpose 'login'  → sign in with a mobile number.
//   purpose 'quick'  → "Create account with WhatsApp OTP": just a mobile number.
//                      Signs in if an account has it, else creates a buyer
//                      account (verified by /api/auth/otp-quick).
//   purpose 'reset'  → "Forgot password?": by email or by mobile; the code
//                      goes to the account's email (also while WhatsApp codes
//                      are paused), or to its WhatsApp number when the app asks
//                      for channel 'whatsapp' and WhatsApp codes are on.
const schema = z.object({
  email: z.string().trim().toLowerCase().email().optional(),
  mobile: z.string().trim().max(24).optional(),
  purpose: z.enum(['signup', 'reset', 'login', 'quick']),
  name: z.string().trim().max(120).optional(),
  channel: z.enum(['whatsapp', 'email']).optional(),
});

const fail = (message: string, status: number) => NextResponse.json({ error: { message } }, { status });
const sent = (ticket: string, to: string, channel: 'whatsapp' | 'email' = 'whatsapp') =>
  NextResponse.json({ data: { sent: true, ticket, channel, to } }, { headers: { 'Cache-Control': 'private, no-store' } });

/** "ab****@gmail.com" */
function maskEmail(email: string): string {
  const [name = '', domain = ''] = email.split('@');
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`;
}

/** Password-reset code by email (works while WhatsApp codes are paused). */
function emailResetCode(to: string, code: string, name?: string): Promise<boolean> {
  return sendMail({
    to,
    subject: `${code} is your Mappingg password reset code`,
    html: layout({
      title: 'Reset your password',
      body: [
        `Hi ${esc(name || 'there')},`,
        `Your Mappingg password reset code is <b style="font-size:22px;letter-spacing:4px">${esc(code)}</b>`,
        'It is valid for 10 minutes. If you did not ask to reset your password, you can ignore this email.',
      ],
    }),
  });
}

// Also shown when the WhatsApp provider itself is down — Google sign-in needs no WhatsApp code.
const SEND_FAILED = 'Could not send the WhatsApp code right now. Please check the number and try again in a few minutes, or continue with Google.';

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('Enter a valid email address or mobile number.', 400);
  const { email, purpose } = parsed.data;
  const ip = clientIp(req);
  // Codes cost money to send: per recipient across all IPs (shared), and per IP.
  const limited = rateLimit(`otp-ip:${ip}`, 20, 60 * 60_000) || (await rateLimitShared(`otp:${email || parsed.data.mobile || ''}`, 5, 15 * 60_000));
  if (limited) return limited;
  if (purpose === 'reset') return sendResetCode(parsed.data);
  if (!otpEnabled()) return fail(OTP_PAUSED, 503);
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

  // ---- Quick sign-up / sign-in with just a WhatsApp number ----
  if (purpose === 'quick') {
    const found = await findAccountByMobile(parsed.data.mobile);
    if (!found.ok && found.status !== 404) return fail(found.message, found.status);
    const mobile = found.ok ? found.mobile : normalizePhone(parsed.data.mobile, { required: true });
    if (!mobile) return fail(PHONE_ERROR, 400);
    const { code, ticket } = issueOtp(mobile, 'quick', quickOtpBind(found.ok ? found.user : null));
    if (!(await whatsappOtp(mobile, code, found.ok && found.user.name ? String(found.user.name) : undefined, 'quick'))) return fail(SEND_FAILED, 502);
    return sent(ticket, maskPhone(mobile));
  }

  // ---- Sign in with a mobile number ----
  const found = await findAccountByMobile(parsed.data.mobile);
  if (!found.ok) return fail(found.message, found.status);
  const user = found.user;
  const to = normalizePhone(user.mobile);
  if (!to) return fail('This account has no WhatsApp number saved. Please contact us.', 400);
  // Single-use — last_login_at changes on every sign-in.
  const { code, ticket } = issueOtp(found.mobile, 'login', `${String(user.id || user._id)}|${String(user.last_login_at || '')}`);
  if (!(await whatsappOtp(to, code, user.name ? String(user.name) : undefined, 'login'))) return fail(SEND_FAILED, 502);
  return sent(ticket, maskPhone(to));
}

// ---- Forgot password: account by email or mobile; code by email, or WhatsApp when asked and available ----
async function sendResetCode(input: z.infer<typeof schema>) {
  let user: Record<string, unknown>;
  let identity: string;
  if (input.email) {
    const u = await (await getDb()).collection('users').findOne({ email: input.email }, { projection: { name: 1, role: 1, email: 1, mobile: 1, password_hash: 1 } });
    if (!u || !['buyer', 'developer', 'agent', 'admin', 'employee'].includes(String(u.role || 'buyer'))) return fail('No account found with this email.', 404);
    user = u; identity = input.email;
  } else {
    const found = await findAccountByMobile(input.mobile);
    if (!found.ok) return fail(found.message, found.status);
    user = found.user; identity = found.mobile;
  }
  // Single-use — bound to the current password.
  const { code, ticket } = issueOtp(identity, 'reset', String(user.password_hash || 'none'));
  const name = user.name ? String(user.name) : undefined;
  const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
  const phone = normalizePhone(user.mobile);
  const whatsappUp = otpEnabled() && whatsappConfigured() && !!phone;

  if (input.channel === 'whatsapp' && whatsappUp && (await whatsappOtp(phone!, code, name, 'reset'))) return sent(ticket, maskPhone(phone!));
  if (email && mailConfigured() && (await emailResetCode(email, code, name))) return sent(ticket, maskEmail(email), 'email');
  // Email couldn't go out: try WhatsApp if it's on.
  if (input.channel !== 'whatsapp' && whatsappUp && (await whatsappOtp(phone!, code, name, 'reset'))) return sent(ticket, maskPhone(phone!));
  if (!email && !whatsappUp) return fail('This account has no email address we can send a code to. Please contact us to reset your password.', 400);
  return fail('Could not send the reset code right now. Please try again in a few minutes or contact us.', 502);
}
