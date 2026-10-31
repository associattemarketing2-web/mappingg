import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PHONE_ERROR, normalizePhone } from '@/lib/phone';
import { createSessionToken, getCurrentUser, setSessionCookie } from '@/lib/auth';
import { isPlaceholderEmail, visibleEmail } from '@/lib/phone-email';
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
      // '' for an account made with just a WhatsApp code (stand-in email, lib/phone-email.ts).
      name: String(doc.name || ''), email: visibleEmail(doc.email), mobile: String(doc.mobile || ''),
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
  // Every account must keep a mobile number (it can be changed, not removed).
  const mobile = normalizePhone(parsed.data.mobile, { required: true });
  if (!mobile) return NextResponse.json({ error: { message: PHONE_ERROR } }, { status: 400 });

  const db = await getDb();
  const now = new Date().toISOString();
  const cur = await db.collection('users').findOne({ id: user.id }, { projection: { profile: 1, provider: 1, signup_method: 1 } });
  const merged = { ...((cur?.profile as Record<string, string>) || {}), ...profile };
  await db.collection('users').updateOne({ id: user.id }, { $set: { name, mobile, profile: merged, updated_at: now } });
  // Keep their lead current (name, phone, what they're looking for).
  await db.collection('contact_leads').updateOne(
    { account_id: user.id },
    { $set: { name, phone: mobile, message: buyerNeeds(merged, leadSource(cur)), updated_at: now } },
  ).catch(() => {});
  return NextResponse.json({ data: { ok: true } });
}

// What's still missing — the live map asks a buyer for this after a few project
// clicks or a site-visit booking: what they're looking for and, for accounts
// made with just a WhatsApp code, their name and email. Blank answers keep what
// was saved before. A new email becomes their sign-in email.
const prefsSchema = z.object({
  name: z.string().trim().max(120).optional().default(''),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email()]).optional().default(''),
  profile: z.object({ area: pref(), configuration: pref(), budget: pref(), timeline: pref(), purpose: pref() }),
});

const leadSource = (doc: Record<string, unknown> | null) =>
  doc?.provider === 'google' ? 'google' : doc?.signup_method === 'whatsapp' ? 'whatsapp' : 'password';

export async function PATCH(req: NextRequest) {
  const user = await buyer();
  if (!user) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  const parsed = prefsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { message: 'Please enter a valid email address.' } }, { status: 400 });

  const db = await getDb();
  const users = db.collection('users');
  const now = new Date().toISOString();
  const cur = await users.findOne({ email: user.email.toLowerCase() }, { projection: { id: 1, name: 1, email: 1, mobile: 1, profile: 1, provider: 1, signup_method: 1 } });
  if (!cur) return NextResponse.json({ error: { message: 'Account not found' } }, { status: 404 });

  const set: Record<string, unknown> = { updated_at: now };
  const given = Object.fromEntries(Object.entries(parsed.data.profile).filter(([, v]) => v));
  const merged = { ...((cur.profile as Record<string, string>) || {}), ...given };
  set.profile = merged;
  if (parsed.data.name) set.name = parsed.data.name;
  // Only a stand-in email is replaced here; a real one is changed by the team.
  const newEmail = parsed.data.email && isPlaceholderEmail(cur.email) && parsed.data.email !== cur.email ? parsed.data.email : '';
  if (newEmail) {
    if (await users.findOne({ email: newEmail }, { projection: { id: 1 } })) {
      return NextResponse.json({ error: { message: 'Another account already uses this email.' } }, { status: 409 });
    }
    set.email = newEmail;
  }
  try {
    await users.updateOne({ email: user.email.toLowerCase() }, { $set: set });
  } catch (e) {
    const code = (e as { code?: string | number }).code;
    if (code === '23505' || code === 11000) return NextResponse.json({ error: { message: 'Another account already uses this email.' } }, { status: 409 });
    throw e;
  }
  // The session carries the email, so sign them in again under the new one.
  if (newEmail) setSessionCookie(await createSessionToken({ ...user, email: newEmail }));

  const name = String(set.name || cur.name || '');
  await db.collection('contact_leads').updateOne(
    { account_id: String(cur.id || user.id) },
    { $set: {
      ...(name ? { name } : {}), ...(newEmail ? { email: newEmail } : {}),
      message: buyerNeeds(merged, leadSource(cur)), updated_at: now,
    } },
  ).catch(() => {});
  return NextResponse.json({ data: { ok: true } });
}
