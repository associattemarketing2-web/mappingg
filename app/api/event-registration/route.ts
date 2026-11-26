import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getDb } from '@/lib/mongodb';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { esc, layout, notifyAdmin, queueMail } from '@/lib/mailer';
import { pageOf, pushToCrm, visitorIp } from '@/lib/crm';
import { optInSummary } from '@/lib/consent';
import { EVENT_SOURCE, parseEventRegistration } from '@/lib/event-registration';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public registration form of the Mappingg Events landing site (the separate
// `mappinggevent` folder, hosted on its own domain) → a lead in `contact_leads`
// with source "Event registration". Shown in the s-admin CRM and in the
// "Event registrations" tab. No auth and cross-origin (no cookies are sent);
// reads are admin-only (app/api/admin/event-registrations).
//
// EVENT_SITE_ORIGINS (comma-separated) limits which sites may post; unset = any.

function cors(req: NextRequest): Record<string, string> {
  const allowed = (process.env.EVENT_SITE_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get('origin') || '';
  const allow = !allowed.length ? '*' : allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const reply = (req: NextRequest, body: unknown, status: number) => {
  const res = NextResponse.json(body, { status });
  for (const [k, v] of Object.entries(cors(req))) res.headers.set(k, v);
  return res;
};

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(req) });
}

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const result = parseEventRegistration(raw);
  // Bots that trip the honeypot get the normal answer, but nothing is saved.
  if (result.kind === 'spam') return reply(req, { data: { ok: true } }, 201);

  const limited = rateLimit(`event:${clientIp(req)}`, 6, 10 * 60_000);
  if (limited) return reply(req, { error: { message: 'Too many attempts. Please try again in a few minutes.' } }, 429);
  if (result.kind === 'invalid') return reply(req, { error: { message: result.message } }, 400);

  const d = result.registration;
  const now = d.consent.captured_at;
  try {
    const db = await getDb();
    const leads = db.collection<{ _id: string; [k: string]: any }>('contact_leads');
    // One seat per email per event — a second submit just confirms the first.
    const existing = await leads.findOne({ source: EVENT_SOURCE, email: d.email, event: d.event });
    if (existing) return reply(req, { data: { ok: true, already: true } }, 200);
    const id = randomUUID();
    await leads.insertOne({
      _id: id, id, ...d,
      source: EVENT_SOURCE, status: 'new', notes: '',
      created_at: now, updated_at: now,
    });
  } catch {
    return reply(req, { error: { message: 'Something went wrong. Please try again.' } }, 500);
  }

  const channels = optInSummary(d.consent);
  const rows: [string, string][] = [['Name', d.name], ['Email', d.email], ['Phone', d.phone], ['Attendee type', d.attendee_type], ['City', d.city || '—'], ['Event', d.event], ['Opted in to', channels]];
  pushToCrm({
    name: d.name, mobile: d.phone, email: d.email, source: 'Event registration', page: pageOf(req),
    extra: rows.slice(3), message: d.message, ip: visitorIp(req),
  });
  notifyAdmin(`Event registration — ${d.name} (${d.attendee_type})`, {
    title: 'New event registration', body: [esc(d.message)], rows,
  }, d.email);
  queueMail({
    to: d.email,
    subject: `You're registered — ${d.event}`,
    html: layout({
      title: 'Your seat is reserved 🎉',
      body: [
        `Hi ${esc(d.name.split(' ')[0])},`,
        `Thanks for registering for <b>${esc(d.event)}</b>. We'll share the date, time and venue details with you soon.`,
        'Also — the Mappingg app is launching soon. Stay tuned!',
      ],
    }),
  });
  return reply(req, { data: { ok: true } }, 201);
}
