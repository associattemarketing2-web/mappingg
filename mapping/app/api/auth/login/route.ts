import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb } from '@/lib/mongodb';
import { createSessionToken, homePathFor, setSessionCookie } from '@/lib/auth';
import { verificationOf } from '@/lib/verification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: 'Enter a valid email and password.' } }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const db = await getDb();
  const user = await db.collection('users').findOne({ email: email.toLowerCase() });

  // Constant-ish response: always run a hash compare to avoid user enumeration.
  const hash = (user?.password_hash as string) || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
  const ok = await bcrypt.compare(password, hash);

  if (!user || !ok) {
    return NextResponse.json({ error: { message: 'Invalid login credentials' } }, { status: 401 });
  }

  const sessionUser = {
    id: String(user.id || user._id),
    email: String(user.email),
    role: String(user.role || 'admin'),
  };
  const token = await createSessionToken(sessionUser);
  setSessionCookie(token);

  return NextResponse.json({
    user: { ...sessionUser, name: String(user.name || ''), verified: verificationOf(user) === 'approved' },
    redirect: homePathFor(sessionUser.role),
  });
}
