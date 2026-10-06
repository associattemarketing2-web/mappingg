import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PHONE_ERROR, normalizePhone } from '@/lib/phone';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { buyerNeeds } from '@/lib/signup-leads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A buyer's own profile (the "My profile" page): name, WhatsApp number and what
// they're looking for. Saving also refreshes their lead in the super admin's
// Leads → Buyer sign-ups, so the sales team always sees current preferences.
const pref = () => z.string().trim().max(200).optional().default('');
const schema = z.object({
  name: z.string().trim().min(1).max(120),
  mobile: z.string().trim().max(20).optional().default(''),
  profile: z.object({ area: pref(), configuration: pref(), budget: pref(), timeline: pref(), purpose: pref() }),
});

async function buyer() {
  const user = await getCurrentUser();
  return user && user.role === 'buyer' ? user : null;
}

export async function GET() {
  const user = await buyer();
  if (!user) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  const db = await getDb();
  const doc = await db.collection('users').findOne({ id: user.id }, { projection: { name: 1, email: 1, mobile: 1, profile: 1, created_at: 1, provider: 1 } });
  if (!doc) return NextResponse.json({ error: { message: 'Account not found' } }, { status: 404 });
  return NextResponse.json({
    data: {
      name: String(doc.name || ''), email: String(doc.email || ''), mobile: String(doc.mobile || ''),
      profile: (doc.profile as Record<string, string>) || {}, created_at: String(doc.created_at || ''), google: doc.provider === 'google',
    },
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function PUT(req: NextRequest) {
  const user = await buyer();
  if (!user) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { message: 'Please enter your name.' } }, { status: 400 });
  const { name, profile } = parsed.data;
  const mobile = normalizePhone(parsed.data.mobile);
  if (mobile === null) return NextResponse.json({ error: { message: PHONE_ERROR } }, { status: 400 });

  const db = await getDb();
  const now = new Date().toISOString();
  const cur = await db.collection('users').findOne({ id: user.id }, { projection: { profile: 1, provider: 1 } });
  const merged = { ...((cur?.profile as Record<string, string>) || {}), ...profile };
  await db.collection('users').updateOne({ id: user.id }, { $set: { name, mobile, profile: merged, updated_at: now } });
  // Keep their lead current (name, phone, what they're looking for).
  await db.collection('contact_leads').updateOne(
    { account_id: user.id },
    { $set: { name, phone: mobile, message: buyerNeeds(merged, cur?.provider === 'google' ? 'google' : 'password'), updated_at: now } },
  ).catch(() => {});
  return NextResponse.json({ data: { ok: true } });
}
