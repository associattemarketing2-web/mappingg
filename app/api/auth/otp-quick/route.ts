import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '@/lib/mongodb';
import { PUBLIC_ROLES, createSessionToken, homePathFor, setSessionCookie } from '@/lib/auth';
import { logActivity, recordLogin } from '@/lib/activity';
import { homeForAccount, verificationOf } from '@/lib/verification';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { roleOrDefault } from '@/lib/auth-role';
import { checkOtp } from '@/lib/otp';
import { PHONE_ERROR, normalizePhone } from '@/lib/phone';
import { findAccountByMobile, quickOtpBind } from '@/lib/mobile-account';
import { placeholderEmail, visibleEmail } from '@/lib/phone-email';
import { addBuyerSignupLead } from '@/lib/signup-leads';
import { whatsappBuyerWelcome } from '@/lib/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/auth/otp-quick — "Create account with WhatsApp OTP": the mobile
// number + the code from /api/auth/otp (purpose 'quick'). If an account already
// has the number it signs in (like /api/auth/otp-login); otherwise it creates a
// buyer account with only the number and signs in. Name, email and what they're
// looking for are asked later on the live map (see prefAsk in the map script).
const schema = z.object({
  mobile: z.string().trim().max(24),
  otp: z.string().trim().max(12),
  ticket: z.string().max(1000),
});

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { message: 'Enter your mobile number and the 6-digit code.' } }, { status: 400 });
  const ip = clientIp(req);
  const limited = rateLimit(`otp-quick:${ip}:${parsed.data.mobile}`, 8, 15 * 60_000) || rateLimit(`otp-quick-ip:${ip}`, 30, 15 * 60_000);
  if (limited) return limited;

  const found = await findAccountByMobile(parsed.data.mobile);
  if (!found.ok && found.status !== 404) return NextResponse.json({ error: { message: found.message } }, { status: found.status });

  // ---- Existing account: sign in ----
  if (found.ok) {
    const { user, mobile } = found;
    const bad = checkOtp(parsed.data.ticket, parsed.data.otp, mobile, 'quick', quickOtpBind(user));
    if (bad) return NextResponse.json({ error: { message: bad } }, { status: 400 });
    const sessionUser = { id: String(user.id || user._id), email: String(user.email), role: roleOrDefault(user.role) };
    setSessionCookie(await createSessionToken(sessionUser));
    // last_login_at changes on every sign-in, which makes the code single-use.
    if ((PUBLIC_ROLES as readonly string[]).includes(sessionUser.role)) {
      await recordLogin({ ...sessionUser, name: String(user.name || '') }, 'whatsapp');
    } else {
      await (await getDb()).collection('users').updateOne({ id: sessionUser.id }, { $set: { last_login_at: new Date().toISOString() } });
    }
    return NextResponse.json({
      user: { ...sessionUser, email: visibleEmail(sessionUser.email), name: String(user.name || ''), verified: verificationOf(user) === 'approved' },
      redirect: homeForAccount(user, homePathFor(sessionUser.role)),
      created: false,
    });
  }

  // ---- New number: create a buyer account ----
  const mobile = normalizePhone(parsed.data.mobile, { required: true });
  if (!mobile) return NextResponse.json({ error: { message: PHONE_ERROR } }, { status: 400 });
  const bad = checkOtp(parsed.data.ticket, parsed.data.otp, mobile, 'quick', quickOtpBind(null));
  if (bad) return NextResponse.json({ error: { message: bad } }, { status: 400 });

  const id = randomUUID();
  const now = new Date().toISOString();
  const email = placeholderEmail(mobile);
  try {
    await (await getDb()).collection<{ _id: string; [key: string]: unknown }>('users').insertOne({
      _id: id, id, email, name: '', mobile, role: 'buyer', profile: {},
      mobile_verified: true, signup_method: 'whatsapp',
      verified: true, verification: 'approved',
      created_at: now, updated_at: now, last_login_at: now,
    });
  } catch (e) {
    // The same number signing up twice at once: the unique email index rejects the second.
    const code = (e as { code?: string | number }).code;
    if (code === '23505' || code === 11000) {
      return NextResponse.json({ error: { message: 'An account with this number already exists — please request a new code.' } }, { status: 409 });
    }
    throw e;
  }

  await addBuyerSignupLead({ id, name: mobile, email: '', mobile, profile: {}, provider: 'whatsapp', created_at: now });
  // Congratulations message on WhatsApp. Never throws — a failed send does not block sign-up.
  await whatsappBuyerWelcome(mobile);
  await logActivity({ user_id: id, email, name: mobile, role: 'buyer', type: 'signup', detail: 'Buyer account created with a WhatsApp code' });

  const sessionUser = { id, email, role: 'buyer' as const };
  setSessionCookie(await createSessionToken(sessionUser));
  return NextResponse.json({ user: { ...sessionUser, email: '', name: '', verified: true }, redirect: homePathFor('buyer'), created: true });
}
