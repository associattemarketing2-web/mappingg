import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/mongodb';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { esc, layout, notifyAdmin, queueMail } from '@/lib/mailer';
import { pageOf, pushToCrm, visitorIp } from '@/lib/crm';
import { parseRequirement } from '@/lib/buyer-requirement';
import { optInSummary } from '@/lib/consent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public Buyer Requirement form → a lead in `contact_leads` (source
// "buyer-requirement"), shown in Leads → Contact and the Buyer leads panel.
// Validation and the consent rule live in lib/buyer-requirement.ts.

const accepted = () => NextResponse.json({ data: { ok: true } }, { status: 201 });

export async function POST(req: NextRequest) {
  const result = parseRequirement(await req.json().catch(() => null));
  if (result.kind === 'spam') return accepted(); // bots can't tell they were filtered
  const limited = rateLimit(`requirement:${clientIp(req)}`, 6, 10 * 60_000);
  if (limited) return limited;
  if (result.kind === 'invalid') return NextResponse.json({ error: { message: result.message } }, { status: 400 });

  const d = result.lead;
  const now = d.consent.captured_at;
  const id = randomUUID();
  try {
    const db = await getDb();
    await db.collection<{ _id: string; [k: string]: unknown }>('contact_leads').insertOne({
      _id: id, id, ...d, source: 'buyer-requirement', status: 'new', notes: '', created_at: now, updated_at: now,
    });
  } catch {
    return NextResponse.json({ error: { message: 'Something went wrong. Please try again.' } }, { status: 500 });
  }
  const channels = optInSummary(d.consent);
  pushToCrm({
    name: d.name, mobile: d.phone, email: d.email, source: 'Buyer requirement form', page: pageOf(req),
    extra: [['Looking for', d.bhk], ['Budget', d.budget], ['Area', `${d.locality}, ${d.city}`], ['Timeline', d.timeline], ['Purpose', d.purpose], ['Also opted in to', channels]],
    message: d.message, ip: visitorIp(req),
  });
  notifyAdmin(`Buyer requirement: ${d.bhk} in ${d.locality} — ${d.name}`, {
    title: 'New buyer requirement',
    body: [esc(d.message).replace(/\n/g, '<br>')],
    rows: [['Name', d.name], ['Phone', d.phone], ['Email', d.email], ['Also opted in to', channels]],
    cta: { label: 'Open buyer leads', href: '/dashboard/s-admin?tab=buyerleads' },
  }, d.email || undefined);
  if (d.email) {
    queueMail({
      to: d.email,
      subject: 'We received your home requirement — Mappingg',
      html: layout({
        title: 'Thanks — we have your requirement',
        body: [`Hi ${esc(d.name.split(' ')[0])},`, `We'll look for ${esc(d.bhk)} homes in ${esc(d.locality)} within ${esc(d.budget)} and get back to you.`],
        rows: [['Looking for', d.bhk], ['Area', `${d.locality}, ${d.city}`], ['Budget', d.budget], ['Timeline', d.timeline]],
      }),
    });
  }
  return accepted();
}
