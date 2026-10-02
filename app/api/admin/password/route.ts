import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb } from '@/lib/mongodb';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  current: z.string().min(1).max(200),
  next: z.string().min(8).max(200),
});

export async function POST(req: NextRequest) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: 'New password must be at least 8 characters.' } }, { status: 400 });
  }

  const db = await getDb();
  const users = db.collection('users');
  const user = await users.findOne({ email: session.email.toLowerCase() });
  if (!user) return NextResponse.json({ error: { message: 'Account not found' } }, { status: 404 });

  const ok = await bcrypt.compare(parsed.data.current, String(user.password_hash || ''));
  if (!ok) return NextResponse.json({ error: { message: 'Current password is incorrect.' } }, { status: 401 });

  const password_hash = await bcrypt.hash(parsed.data.next, 12);
  await users.updateOne({ _id: user._id }, { $set: { password_hash } });
  return NextResponse.json({ data: { ok: true } });
}
