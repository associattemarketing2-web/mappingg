import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { normalizePhone } from '@/lib/phone';
import { getCurrentUser, isStaffRole } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { esc, layout, notifyAdmin, queueMail } from '@/lib/mailer';
import { pageOf, pushToCrm, visitorIp } from '@/lib/crm';
import { parseEnquireRequest } from '@/lib/enquire-request';
import { optInSummary } from '@/lib/consent';
import { siteVisitSlot } from '@/lib/site-visit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// "Enquire now" on the live map for someone who is already signed in: instead
// of asking for their name / WhatsApp / email again, the lead is created from
// their account (read here on the server, so it can't be spoofed) and the map
// opens the project's details straight away. One lead per account per project.
// Consent is recorded from the request (lib/enquire-request.ts), never assumed.

/** The account's number as "+91 9876543210" (as typed if it isn't a valid number). */
function whatsappOf(mobile: unknown): string {
  return normalizePhone(mobile) || String(mobile || '').trim();
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: { message: 'Please sign in' } }, { status: 401 });
  const parsed = parseEnquireRequest(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: { message: 'Invalid request' } }, { status: 400 });
  const { pin_id, consent, site_visit, visit_date, visit_time } = parsed;

  // Staff browsing the map just see the details — they aren't leads.
  if (isStaffRole(user.role)) return NextResponse.json({ data: { ok: true, lead: false } });

  const db = await getDb();
  const pin = await db.collection('pins').findOne({ id: pin_id, hidden: { $ne: true } }, { projection: { id: 1, title: 1, number: 1, developer: 1 } });
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
  // "Book Site Visit": the picked day + time are saved on the same lead so the CRM
  // shows the appointment next to the project (a new booking replaces the old one).
  const visit = site_visit ? { site_visit_requested_at: now, site_visit_date: visit_date || null, site_visit_time: visit_time || null } : {};
  const slot = siteVisitSlot(visit_date, visit_time);
  if (existing) {
    // Tapped Enquire now again on the same project: keep the one lead, but record
    // the repeat so the CRM shows how often (and when last) they asked.
    // A new explicit opt-in is saved; a repeat without one never removes an earlier choice.
    const optIn = consent.call || consent.whatsapp ? { consent } : {};
    await leads.updateOne({ id: existing.id }, { $set: { last_enquired_at: now, updated_at: now, ...optIn, ...visit }, $inc: { enquiry_clicks: 1 } });
  } else {
    const id = randomUUID();
    await leads.insertOne({
      _id: id, id, pin_id, role, name, whatsapp, email, consent,
      source: 'Signed-in account', account_id: user.id, status: 'new', notes: '',
      enquiry_clicks: 1, last_enquired_at: now, ...visit,
      created_at: now, updated_at: now,
    });
  }
  const project = String(pin.title || `#${pin.number ?? ''}`);
  if (!existing || site_visit) {
    pushToCrm({ name, mobile: whatsapp, email, project, builder: String(pin.developer || ''), source: site_visit ? 'Map "Book Site Visit" (signed-in account)' : 'Map "Enquire now" (signed-in account)', page: pageOf(req), extra: [['Account type', role], ['Opted in to', optInSummary(consent)], ...(site_visit ? [['Site visit', slot || 'Not chosen'] as [string, string]] : [])], ip: visitorIp(req) });
    notifyAdmin(`${site_visit ? 'Site visit request' : 'New enquiry'}: ${project} — ${name}`, {
      title: site_visit ? 'Site visit request from the live map' : 'New enquiry from the live map',
      body: [site_visit ? `${esc(name)} booked a site visit to <b>${esc(project)}</b>${slot ? ` for <b>${esc(slot)}</b>` : ''}. Call them to confirm.` : `${esc(name)} asked about <b>${esc(project)}</b>.`],
      rows: [['Name', name], ['Email', email], ['WhatsApp', whatsapp], ['Account type', role], ['Project', project], ...(site_visit ? [['Site visit', slot || 'Not chosen'] as [string, string]] : [])],
      cta: { label: 'Open leads', href: '/dashboard/s-admin' },
    }, email);
    queueMail({
      to: email,
      subject: site_visit ? `Your site visit request for ${project} — Mappingg` : `Your enquiry for ${project} — Mappingg`,
      html: layout({
        title: site_visit ? 'We received your site visit request' : 'We received your enquiry',
        body: [`Hi ${esc(name.split(' ')[0])},`, site_visit
          ? `Thanks for booking a site visit to <b>${esc(project)}</b>${slot ? ` on <b>${esc(slot)}</b>` : ''}. Our team will contact you shortly to confirm it.`
          : `Thanks for your interest in <b>${esc(project)}</b>. Our team will contact you on WhatsApp shortly.`],
      }),
    });
  }
  return NextResponse.json({
    data: {
      ok: true, lead: true, already: site_visit ? false : !!existing, site_visit, name, whatsapp, email, role, project: String(pin.title || `#${pin.number ?? ''}`),
      consent: { enquiry: consent.enquiry, call: consent.call, whatsapp: consent.whatsapp },
    },
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
