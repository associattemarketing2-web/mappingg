import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getDb } from '@/lib/mongodb';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { esc, layout, notifyAdmin, queueMail } from '@/lib/mailer';
import { pageOf, pushToCrm, visitorIp } from '@/lib/crm';
import { parseContactSubmission } from '@/lib/contact-submission';
import { optInSummary } from '@/lib/consent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public contact form → a lead in the `contact_leads` collection, shown in the
// s-admin CRM. No auth (anyone can write a lead); reads are admin-only.
// Validation lives in lib/contact-submission.ts.

/** The response a successful submission gets. Bots that trip the honeypot get the
 *  same one, so they can't tell they were filtered — but nothing is saved or sent. */
const accepted = () => NextResponse.json({ data: { ok: true } }, { status: 201 });

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const result = parseContactSubmission(raw);
  if (result.kind === 'spam') return accepted();

  const limited = rateLimit(`contact:${clientIp(req)}`, 8, 10 * 60_000);
  if (limited) return limited;
  if (result.kind === 'invalid') return NextResponse.json({ error: { message: result.message } }, { status: 400 });

  const d = result.lead;
  const now = d.consent.captured_at;
  const id = randomUUID();
  const channels = optInSummary(d.consent);
  try {
    const db = await getDb();
    await db.collection<{ _id: string; [k: string]: any }>('contact_leads').insertOne({
      _id: id, id, ...d,
      source: 'contact-form', status: 'new', notes: '',
      created_at: now, updated_at: now,
    });
  } catch {
    return NextResponse.json({ error: { message: 'Something went wrong. Please try again.' } }, { status: 500 });
  }
  pushToCrm({
    name: d.name, mobile: d.phone, email: d.email, source: 'Contact form', page: pageOf(req),
    extra: [['Subject', d.subject], ['Opted in to', channels]], message: d.message, ip: visitorIp(req),
  });
  notifyAdmin(`Contact form:${d.subject} — ${d.name}`, {
    title: 'New message from the contact form',
    body: [esc(d.message).replace(/\n/g, '<br>')],
    rows: [['Name', d.name], ['Email', d.email], ['Phone', d.phone], ['Subject', d.subject], ['Opted in to', channels]],
  }, d.email || undefined);
  if (d.email) {
    queueMail({
      to: d.email,
      subject: 'We received your message — Mappingg',
      html: layout({ title: 'Thanks for getting in touch', body: [`Hi ${esc(d.name.split(' ')[0])},`, 'We received your message and will get back to you shortly.'] }),
    });
  }
  return accepted();
}
