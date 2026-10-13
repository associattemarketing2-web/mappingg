import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { PHONE_ERROR, normalizePhone } from '@/lib/phone';
import { getDb } from '@/lib/mongodb';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { esc, layout, notifyAdmin, queueMail } from '@/lib/mailer';
import { pageOf, pushToCrm, visitorIp } from '@/lib/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public contact form → a lead in the `contact_leads` collection, shown in the
// s-admin CRM. No auth (anyone can write a lead); reads are admin-only.
const opt = (max: number) => z.string().trim().max(max).optional().default('');
const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: opt(200),
  phone: opt(40),
  subject: opt(120),
  message: opt(4000),
  // What a home buyer is looking for (all optional; sent by the "Buying a home" topic).
  city: opt(40),
  locality: opt(120),
  budget: opt(40),
  bhk: opt(40),
  timeline: opt(40),
  // Separate, unticked opt-ins. Replying to this enquiry itself needs neither.
  consent_call: z.boolean().optional().default(false),
  consent_whatsapp: z.boolean().optional().default(false),
  // Honeypot: real users never see/fill this; bots do.
  company: z.string().max(0).optional().default(''),
});

/** The opt-in wording shown on the form (components/ContactForm.tsx), stored with each lead. */
const CONSENT_VERSION = 'contact-form-2026-10';
const CONSENT_TEXT = {
  call: 'Associatte PropTech (Mappingg) may call me about matching projects.',
  whatsapp: 'Associatte PropTech (Mappingg) may message me on WhatsApp about matching projects.',
};

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: 'Please fill in your name and a message.' } }, { status: 400 });
  }
  const d = parsed.data;
  // "Looking for: 3 BHK · Budget: ₹1 – 2 Cr · …", the same layout as buyer sign-up leads.
  const needs = [
    d.bhk && `Looking for: ${d.bhk}`, d.budget && `Budget: ${d.budget}`,
    (d.locality || d.city) && `Preferred area: ${[d.locality, d.city].filter(Boolean).join(', ')}`,
    d.timeline && `Planning to buy: ${d.timeline}`,
  ].filter(Boolean).join(' · ');
  if (!d.message && !needs) {
    return NextResponse.json({ error: { message: 'Please add a message or tell us what you’re looking for.' } }, { status: 400 });
  }
  const message = [needs, d.message].filter(Boolean).join('\n\n');

  // Silently accept (but drop) spam that trips the honeypot.
  if (d.company) return NextResponse.json({ data: { ok: true } }, { status: 200 });

  const limited = rateLimit(`contact:${clientIp(req)}`, 8, 10 * 60_000);
  if (limited) return limited;

  const phone = normalizePhone(d.phone);
  if (phone === null) return NextResponse.json({ error: { message: PHONE_ERROR } }, { status: 400 });
  d.phone = phone;
  if (!d.email && !d.phone) {
    return NextResponse.json({ error: { message: 'Add an email or phone so we can reply.' } }, { status: 400 });
  }
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) {
    return NextResponse.json({ error: { message: 'That email address looks invalid.' } }, { status: 400 });
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const channels = [d.consent_call && 'Call', d.consent_whatsapp && 'WhatsApp'].filter(Boolean).join(' + ') || 'None (reply to this enquiry only)';
  try {
    const db = await getDb();
    await db.collection<{ _id: string; [k: string]: any }>('contact_leads').insertOne({
      _id: id, id,
      name: d.name, email: d.email, phone: d.phone,
      subject: d.subject || 'General enquiry', message,
      ...(needs ? { city: d.city, locality: d.locality, budget: d.budget, bhk: d.bhk, timeline: d.timeline } : {}),
      consent: {
        call: d.consent_call, whatsapp: d.consent_whatsapp,
        text: [d.consent_call && CONSENT_TEXT.call, d.consent_whatsapp && CONSENT_TEXT.whatsapp].filter(Boolean).join(' '),
        version: CONSENT_VERSION, captured_at: now, source: 'Contact form (/contact)',
      },
      source: 'contact-form', status: 'new', notes: '',
      created_at: now, updated_at: now,
    });
  } catch {
    return NextResponse.json({ error: { message: 'Something went wrong. Please try again.' } }, { status: 500 });
  }
  pushToCrm({
    name: d.name, mobile: d.phone, email: d.email, source: 'Contact form', page: pageOf(req),
    extra: [['Subject', d.subject || 'General enquiry'], ['Opted in to', channels]], message, ip: visitorIp(req),
  });
  notifyAdmin(`Contact form:${d.subject || 'General enquiry'} — ${d.name}`, {
    title: 'New message from the contact form',
    body: [esc(message).replace(/\n/g, '<br>')],
    rows: [['Name', d.name], ['Email', d.email], ['Phone', d.phone], ['Subject', d.subject || 'General enquiry'], ['Opted in to', channels]],
  }, d.email || undefined);
  if (d.email) {
    queueMail({
      to: d.email,
      subject: 'We received your message — Mappingg',
      html: layout({ title: 'Thanks for getting in touch', body: [`Hi ${esc(d.name.split(' ')[0])},`, 'We received your message and will get back to you shortly.'] }),
    });
  }
  return NextResponse.json({ data: { ok: true } }, { status: 201 });
}
