import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb } from '@/lib/mongodb';
import { checkOtp } from '@/lib/otp';
import { logActivity } from '@/lib/activity';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/auth/reset-password — "Forgot password?": the 6-digit code from
// /api/auth/otp (purpose 'reset') + a new password. The user then signs in
// with the new password as usual.
const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  otp: z.string().trim().max(12),
  ticket: z.string().max(1000),
  password: z.string().min(8).max(200),
});

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { message: 'Enter the code and a new password of at least 8 characters.' } }, { status: 400 });
  const { email, otp, ticket, password } = parsed.data;

  const limited = rateLimit(`reset:${email}`, 8, 15 * 60_000) || rateLimit(`reset-ip:${clientIp(req)}`, 30, 15 * 60_000);
  if (limited) return limited;

  const users = (await getDb()).collection('users');
  const user = await users.findOne({ email });
  if (!user) return NextResponse.json({ error: { message: 'No account found with this email.' } }, { status: 404 });
  const bad = checkOtp(ticket, otp, email, 'reset', String(user.password_hash || 'none'));
  if (bad) return NextResponse.json({ error: { message: bad } }, { status: 400 });

  await users.updateOne({ email }, { $set: { password_hash: await bcrypt.hash(password, 12), updated_at: new Date().toISOString() } });
  await logActivity({
    user_id: String(user.id || user._id), email, name: user.name ? String(user.name) : undefined, role: String(user.role || 'buyer'),
    type: 'password_reset', detail: 'Password reset with an email code',
  });
  return NextResponse.json({ data: { ok: true } });
}
