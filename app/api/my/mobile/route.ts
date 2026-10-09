import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PHONE_ERROR, normalizePhone } from '@/lib/phone';
import { PUBLIC_ROLES, getCurrentUser, homePathFor } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { homeForAccount } from '@/lib/verification';
import { notifyAdmin } from '@/lib/mailer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/my/mobile — saves the signed-in account's mobile number. Used by
// the "Add your mobile number" step that Google sign-in (which gives us no
// phone) and older accounts without one go through. Any public role may call it.
const schema = z.object({ mobile: z.string().trim().max(24) });

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !(PUBLIC_ROLES as readonly string[]).includes(user.role)) {
    return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  const mobile = parsed.success ? normalizePhone(parsed.data.mobile, { required: true }) : null;
  if (!mobile) return NextResponse.json({ error: { message: PHONE_ERROR } }, { status: 400 });

  const db = await getDb();
  const now = new Date().toISOString();
  await db.collection('users').updateOne({ id: user.id }, { $set: { mobile, updated_at: now } });
  // A buyer's lead in the super admin's Leads section gets the number too.
  await db.collection('contact_leads').updateOne({ account_id: user.id }, { $set: { phone: mobile, updated_at: now } }).catch(() => {});

  const doc = await db.collection('users').findOne({ id: user.id }, { projection: { name: 1, provider: 1, role: 1, mobile: 1, access: 1, verification: 1, verified: 1 } });
  // Google sign-ups reach the team without a number — send it on once it's added.
  notifyAdmin(`Mobile number added: ${String(doc?.name || user.email)}`, {
    title: 'Mobile number added',
    body: [doc?.provider === 'google' ? 'This account signed up with Google and has now added a mobile number.' : 'This account added a mobile number.'],
    rows: [['Name', doc?.name], ['Email', user.email], ['Mobile', mobile], ['Account type', user.role]],
    cta: { label: 'Open admin', href: '/dashboard/s-admin' },
  }, user.email);
  return NextResponse.json({ data: { ok: true, mobile }, redirect: homeForAccount(doc, homePathFor(user.role)) });
}
