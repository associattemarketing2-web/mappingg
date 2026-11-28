import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getDb } from '@/lib/mongodb';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { esc, layout, notifyAdmin, sendMail } from '@/lib/mailer';
import { whatsappConfigured, whatsappEventConfirmation } from '@/lib/whatsapp';
import { optInSummary } from '@/lib/consent';
import { EVENT_SOURCE, EVENT_WHEN, EVENT_WHERE, parseEventRegistration } from '@/lib/event-registration';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Room for the email + WhatsApp sends that run before the reply.
export const maxDuration = 30;

// Public registration form of the Mappingg Events landing page (/event, static
// files in public/event, copied from the `mappinggevent` folder) → a lead in `contact_leads`
// with source "Event registration". Shown only in the admin's "Event
// registrations" tab — not in the CRM leads list and not sent to the B2BBricks
// CRM. No auth and cross-origin (no cookies are sent);
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

  const limited = rateLimit(`event:${clientIp(req)}`, 20, 10 * 60_000);
  if (limited) return reply(req, { error: { message: 'Too many attempts. Please try again in a few minutes.' } }, 429);
  if (result.kind === 'invalid') return reply(req, { error: { message: result.message } }, 400);

  const d = result.registration;
  const now = d.consent.captured_at;
  const id = randomUUID();
  let leads;
  try {
    const db = await getDb();
    leads = db.collection<{ _id: string; [k: string]: any }>('contact_leads');
    // One seat per email per event — a second submit just confirms the first.
    const existing = await leads.findOne({ source: EVENT_SOURCE, email: d.email, event: d.event });
    if (existing) return reply(req, { data: { ok: true, already: true } }, 200);
    // Saved first: the registration is never lost, whatever happens to the messages below.
    await leads.insertOne({
      _id: id, id, ...d,
      source: EVENT_SOURCE, status: 'new', notes: '',
      created_at: now, updated_at: now,
    });
  } catch (e) {
    console.error('[event-registration] could not save', d.email, (e as Error)?.message);
    return reply(req, { error: { message: 'Something went wrong. Please try again.' } }, 500);
  }

  // Confirmation email + WhatsApp to the attendee, and a copy to the team inbox.
  // Awaited (not fire-and-forget): a serverless function is frozen as soon as it
  // replies, which silently dropped emails that were still being sent.
  const channels = optInSummary(d.consent);
  const rows: [string, string][] = [['Name', d.name], ['Email', d.email], ['Phone', d.phone], ['Attendee type', d.attendee_type], ['City', d.city || '—'], ['Event', d.event], ['Opted in to', channels]];
  const first = d.name.split(' ')[0];
  const sendWa = d.consent.whatsapp && whatsappConfigured();
  const [userMail, adminMail, wa] = await Promise.all([
    sendMail({
      to: d.email,
      subject: `You're registered — ${d.event}`,
      html: layout({
        title: 'Your seat is reserved 🎉',
        body: [
          `Hi ${esc(first)},`,
          `Thanks for registering for <b>${esc(d.event)}</b>.`,
          `<b>When:</b> ${esc(EVENT_WHEN)}<br><b>Where:</b> ${esc(EVENT_WHERE)}`,
          'We will send you the livestream links before we go live. The Mappingg app is launching soon — stay tuned!',
        ],
      }),
    }),
    notifyAdmin(`Event registration — ${d.name} (${d.attendee_type})`, {
      title: 'New event registration', body: [esc(d.message)], rows,
      cta: { label: 'Open Event registrations', href: '/dashboard/s-admin?tab=events' },
    }, d.email),
    sendWa
      ? whatsappEventConfirmation(d.phone, d.name,
        `you're registered for ${d.event}: ${EVENT_WHEN}, ${EVENT_WHERE.toLowerCase()}. We will send you the livestream links before we go live.`)
        .then((r) => ({ ok: r.ok, error: r.error }))
      : Promise.resolve({ ok: false, error: d.consent.whatsapp ? 'WhatsApp is not set up on the server' : 'Not opted in to WhatsApp' }),
  ]);
  const notified = {
    email: userMail, admin_email: adminMail, whatsapp: wa.ok,
    ...(wa.ok || !sendWa ? {} : { whatsapp_error: wa.error || 'failed' }),
    at: new Date().toISOString(),
  };
  if (!userMail || !adminMail || (sendWa && !wa.ok)) console.warn('[event-registration] some notifications failed', d.email, notified);
  await leads.updateOne({ _id: id }, { $set: { notified } }).catch(() => { /* the registration itself is saved */ });
  return reply(req, { data: { ok: true } }, 201);
}
