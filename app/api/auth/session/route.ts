import { NextResponse } from 'next/server';
import { createSessionToken, getCurrentUser, homePathFor, setSessionCookie } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { homeForAccount, needsMobile, verificationOf } from '@/lib/verification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ session: null });

  // Rolling session: every time we confirm a valid session, re-issue the cookie
  // with a fresh expiry. This endpoint is polled by the app, so an active user
  // effectively stays signed in until they explicitly log out.
  try { setSessionCookie(await createSessionToken(user)); } catch { /* non-fatal */ }

  // Name / verification status for the header chip; the JWT only carries id+email+role.
  let name = '', verified = true, mobile = '', missingMobile = false, home = homePathFor(user.role);
  try {
    const db = await getDb();
    const doc = await db.collection('users').findOne({ email: user.email.toLowerCase() }, { projection: { name: 1, role: 1, mobile: 1, verified: 1, verification: 1, access: 1 } });
    name = String(doc?.name || '');
    verified = verificationOf(doc) === 'approved';
    mobile = String(doc?.mobile || '');
    missingMobile = needsMobile(doc);
    home = homeForAccount(doc, home);
  } catch { /* the session itself is still valid */ }

  return NextResponse.json({ session: { user: { ...user, name, verified, mobile, needsMobile: missingMobile }, home } });
}
