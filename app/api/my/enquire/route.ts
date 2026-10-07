import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { normalizePhone } from '@/lib/phone';
import { getCurrentUser, isStaffRole } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// "Enquire now" on the live map for someone who is already signed in: instead
// of asking for their name / WhatsApp / email again, the lead is created from
// their account (read here on the server, so it can't be spoofed) and the map
// opens the project's details straight away. One lead per account per project.
const schema = z.object({ pin_id: z.string().min(1).max(100) });

/** The account's number as "+91 9876543210" (as typed if it isn't a valid number). */
function whatsappOf(mobile: unknown): string {
  return normalizePhone(mobile) || String(mobile || '').trim();
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: { message: 'Please sign in' } }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { message: 'Invalid request' } }, { status: 400 });
  const { pin_id } = parsed.data;

  // Staff browsing the map just see the details — they aren't leads.
  if (isStaffRole(user.role)) return NextResponse.json({ data: { ok: true, lead: false } });

  const db = await getDb();
  const pin = await db.collection('pins').findOne({ id: pin_id, hidden: { $ne: true } }, { projection: { id: 1, title: 1, number: 1 } });
  if (!pin) return NextResponse.json({ error: { message: 'Project not found' } }, { status: 404 });

  const me = await db.collection('users').findOne({ id: user.id }, { projection: { name: 1, email: 1, mobile: 1, role: 1 } });
  if (!me) return NextResponse.json({ error: { message: 'Account not found' } }, { status: 404 });
  const name = String(me.name || user.email.split('@')[0]);
  const email = String(me.email || user.email);
  const whatsapp = whatsappOf(me.mobile);
  const role = ['buyer', 'agent', 'developer'].includes(String(me.role)) ? String(me.role) : 'buyer';

  const leads = db.collection<{ _id: string; [k: string]: unknown }>('leads');
  const existing = await leads.findOne({ account_id: user.id, pin_id }, { projection: { id: 1 } });
  const now = new Date().toISOString();
  if (existing) {
    // Tapped Enquire now again on the same project: keep the one lead, but record
    // the repeat so the CRM shows how often (and when last) they asked.
    await leads.updateOne({ id: existing.id }, { $set: { last_enquired_at: now, updated_at: now }, $inc: { enquiry_clicks: 1 } });
  } else {
    const id = randomUUID();
    await leads.insertOne({
      _id: id, id, pin_id, role, name, whatsapp, email, consent: true,
      source: 'Signed-in account', account_id: user.id, status: 'new', notes: '',
      enquiry_clicks: 1, last_enquired_at: now,
      created_at: now, updated_at: now,
    });
  }
  return NextResponse.json({
    data: { ok: true, lead: true, already: !!existing, name, whatsapp, email, role, project: String(pin.title || `#${pin.number ?? ''}`) },
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
