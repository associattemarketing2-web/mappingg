import { NextResponse } from 'next/server';
import { getCurrentUser, homePathFor } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { verificationOf } from '@/lib/verification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ session: null });

  // Name / verification status for the header chip; the JWT only carries id+email+role.
  let name = '', verified = true;
  try {
    const db = await getDb();
    const doc = await db.collection('users').findOne({ email: user.email.toLowerCase() }, { projection: { name: 1, role: 1, verified: 1, verification: 1 } });
    name = String(doc?.name || '');
    verified = verificationOf(doc) === 'approved';
  } catch { /* the session itself is still valid */ }

  return NextResponse.json({ session: { user: { ...user, name, verified }, home: homePathFor(user.role) } });
}
