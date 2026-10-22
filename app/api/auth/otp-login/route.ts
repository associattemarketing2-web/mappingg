import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/mongodb';
import { PUBLIC_ROLES, createSessionToken, homePathFor, setSessionCookie } from '@/lib/auth';
import { recordLogin } from '@/lib/activity';
import { homeForAccount, verificationOf } from '@/lib/verification';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { roleOrDefault } from '@/lib/auth-role';
import { checkOtp } from '@/lib/otp';
import { findAccountByMobile } from '@/lib/mobile-account';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/auth/otp-login — sign in with the mobile number + the WhatsApp code
// from /api/auth/otp (purpose 'login'). Same session as a password sign-in.
const schema = z.object({
  mobile: z.string().trim().max(24),
  otp: z.string().trim().max(12),
  ticket: z.string().max(1000),
});

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { message: 'Enter your mobile number and the 6-digit code.' } }, { status: 400 });
  const ip = clientIp(req);
  const limited = rateLimit(`otp-login:${ip}:${parsed.data.mobile}`, 8, 15 * 60_000) || rateLimit(`otp-login-ip:${ip}`, 30, 15 * 60_000);
  if (limited) return limited;

  const found = await findAccountByMobile(parsed.data.mobile);
  if (!found.ok) return NextResponse.json({ error: { message: found.message } }, { status: found.status });
  const { user, mobile } = found;
  const bad = checkOtp(parsed.data.ticket, parsed.data.otp, mobile, 'login', `${String(user.id || user._id)}|${String(user.last_login_at || '')}`);
  if (bad) return NextResponse.json({ error: { message: bad } }, { status: 400 });

  const sessionUser = { id: String(user.id || user._id), email: String(user.email), role: roleOrDefault(user.role) };
  setSessionCookie(await createSessionToken(sessionUser));
  // last_login_at changes on every sign-in, which makes the code single-use.
  if ((PUBLIC_ROLES as readonly string[]).includes(sessionUser.role)) {
    await recordLogin({ ...sessionUser, name: String(user.name || '') }, 'whatsapp');
  } else {
    await (await getDb()).collection('users').updateOne({ email: sessionUser.email }, { $set: { last_login_at: new Date().toISOString() } });
  }
  return NextResponse.json({
    user: { ...sessionUser, name: String(user.name || ''), verified: verificationOf(user) === 'approved' },
    redirect: homeForAccount(user, homePathFor(sessionUser.role)),
  });
}
