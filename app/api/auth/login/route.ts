import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb } from '@/lib/mongodb';
import { PUBLIC_ROLES, createSessionToken, homePathFor, setSessionCookie } from '@/lib/auth';
import { recordLogin } from '@/lib/activity';
import { homeForAccount, verificationOf } from '@/lib/verification';
import { clientIp, rateLimit, rateLimitShared } from '@/lib/rate-limit';
import { roleOrDefault } from '@/lib/auth-role';
import { findAccountByMobile } from '@/lib/mobile-account';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// `email` is what the person typed in the sign-in box: an email address or a
// mobile number (10 digits, optionally with a country code). `mobile` works too.
const schema = z.object({
  email: z.string().trim().max(200).optional(),
  mobile: z.string().trim().max(24).optional(),
  password: z.string().min(1).max(200),
});

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: 'Enter your email or mobile number and password.' } }, { status: 400 });
  }
  const { password } = parsed.data;
  const login = (parsed.data.email || parsed.data.mobile || '').toLowerCase();
  const byEmail = login.includes('@');
  if (byEmail ? !z.string().email().safeParse(login).success : login.replace(/\D/g, '').length < 10) {
    return NextResponse.json({ error: { message: 'Enter a valid email or 10-digit mobile number.' } }, { status: 400 });
  }

  // Brute-force brake: per account+IP, a cap per account across ALL IPs (shared
  // between server instances), and a looser cap per IP across accounts.
  const ip = clientIp(req);
  const limited =
    (await rateLimitShared(`login:${ip}:${login}`, 10, 15 * 60_000)) ||
    (await rateLimitShared(`login-acct:${login.toLowerCase()}`, 30, 15 * 60_000)) ||
    rateLimit(`login-ip:${ip}`, 40, 15 * 60_000);
  if (limited) return limited;

  let user: Record<string, unknown> | null;
  if (byEmail) {
    user = await (await getDb()).collection('users').findOne({ email: login });
  } else {
    const found = await findAccountByMobile(login);
    // Two accounts sharing a number can't be told apart: they must use their email.
    if (!found.ok && found.status === 409) return NextResponse.json({ error: { message: found.message } }, { status: 409 });
    user = found.ok ? found.user : null;
  }

  // Constant-ish response: always run a hash compare to avoid user enumeration.
  const hash = (user?.password_hash as string) || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
  const ok = await bcrypt.compare(password, hash);

  if (!user || !ok) {
    return NextResponse.json({ error: { message: 'Invalid login credentials' } }, { status: 401 });
  }

  const sessionUser = {
    id: String(user.id || user._id),
    email: String(user.email),
    role: roleOrDefault(user.role),
  };
  const token = await createSessionToken(sessionUser);
  setSessionCookie(token);
  if ((PUBLIC_ROLES as readonly string[]).includes(sessionUser.role)) {
    await recordLogin({ ...sessionUser, name: String(user.name || '') }, 'password');
  }

  return NextResponse.json({
    user: { ...sessionUser, name: String(user.name || ''), verified: verificationOf(user) === 'approved' },
    redirect: homeForAccount(user, homePathFor(sessionUser.role)),
  });
}
