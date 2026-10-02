import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public contact form → a lead in the `contact_leads` collection, shown in the
// s-admin CRM. No auth (anyone can write a lead); reads are admin-only.
const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().max(200).optional().default(''),
  phone: z.string().trim().max(40).optional().default(''),
  subject: z.string().trim().max(120).optional().default(''),
  message: z.string().trim().min(1).max(4000),
  // Honeypot: real users never see/fill this; bots do.
  company: z.string().max(0).optional().default(''),
});

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: 'Please fill in your name and a message.' } }, { status: 400 });
  }
  const d = parsed.data;

  // Silently accept (but drop) spam that trips the honeypot.
  if (d.company) return NextResponse.json({ data: { ok: true } }, { status: 200 });

  if (!d.email && !d.phone) {
    return NextResponse.json({ error: { message: 'Add an email or phone so we can reply.' } }, { status: 400 });
  }
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) {
    return NextResponse.json({ error: { message: 'That email address looks invalid.' } }, { status: 400 });
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  try {
    const db = await getDb();
    await db.collection<{ _id: string; [k: string]: any }>('contact_leads').insertOne({
      _id: id, id,
      name: d.name, email: d.email, phone: d.phone,
      subject: d.subject || 'General enquiry', message: d.message,
      source: 'contact-form', status: 'new', notes: '',
      created_at: now, updated_at: now,
    });
  } catch {
    return NextResponse.json({ error: { message: 'Something went wrong. Please try again.' } }, { status: 500 });
  }
  return NextResponse.json({ data: { ok: true } }, { status: 201 });
}
