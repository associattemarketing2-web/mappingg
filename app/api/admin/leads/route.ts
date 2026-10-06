import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/mongodb';
import { hasPermission } from '@/lib/staff';
import { localitiesOf } from '@/lib/locality';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// CRM leads. Admin-only; needs the 'leads' permission (the owner always has it).
// Three sources:
//   contact (default) → contact-form submissions (`contact_leads`)
//   map               → "Enquire" requests from project cards on the live map
//                       (`leads`), from buyers/investors, agents and developers.
//   signup            → buyers who created an account (also in `contact_leads`,
//                       marked source "Buyer sign-up" — see lib/signup-leads.ts)
const STATUSES = ['new', 'contacted', 'won', 'lost'] as const;
const SOURCES = { contact: 'contact_leads', map: 'leads', signup: 'contact_leads' } as const;
type Source = keyof typeof SOURCES;
const SIGNUP = 'Buyer sign-up';
/** Which rows of the table belong to each source. */
const SOURCE_FILTER: Record<Source, Record<string, unknown>> = {
  contact: { source: { $ne: SIGNUP } },
  map: {},
  signup: { source: SIGNUP },
};

// The CRM filters and counts in the browser, so it loads the newest leads in one go.
const LEADS_LIMIT = 5000;

const sourceOf = (v: string | null | undefined): Source => (v === 'map' ? 'map' : v === 'signup' ? 'signup' : 'contact');
const unauthorized = () => NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });

function strip<T extends Record<string, any>>(doc: T) {
  const { _id, ...rest } = doc;
  return rest;
}

type Pin = { id: string; title?: string; number?: number; location?: string };

/** A map enquiry in the CRM's lead shape, with the project it was about. */
function mapLead(doc: Record<string, any>, pin?: Pin) {
  const l = strip(doc);
  return {
    ...l,
    source: 'map',
    status: STATUSES.includes(l.status) ? l.status : 'new',
    phone: l.whatsapp || l.phone || '',
    role: ['buyer', 'agent', 'developer'].includes(l.role) ? l.role : 'buyer',
    project: pin ? { id: pin.id, title: pin.title || '', number: pin.number ?? null, location: pin.location || '' } : null,
    locations: localitiesOf(pin?.location),
  };
}

async function withProjects(rows: Record<string, any>[]) {
  const db = await getDb();
  const ids = Array.from(new Set(rows.map((r) => String(r.pin_id || '')).filter(Boolean)));
  const pins = ids.length
    ? ((await db.collection('pins').find({ id: { $in: ids } }, { projection: { id: 1, title: 1, number: 1, location: 1 } }).toArray()) as unknown as Pin[])
    : [];
  const byId = new Map(pins.map((p) => [String(p.id), p]));
  return rows.map((r) => mapLead(r, byId.get(String(r.pin_id))));
}

export async function GET(req: NextRequest) {
  if (!(await hasPermission('leads'))) return unauthorized();
  const source = sourceOf(req.nextUrl.searchParams.get('source'));
  const db = await getDb();
  const coll = db.collection(SOURCES[source]);
  const [rows, total] = await Promise.all([
    coll.find(SOURCE_FILTER[source]).sort({ created_at: -1 }).limit(LEADS_LIMIT).toArray() as Promise<Record<string, any>[]>,
    coll.countDocuments(SOURCE_FILTER[source]),
  ]);
  const data = source === 'map' ? await withProjects(rows) : rows.map((r) => strip(r));
  // `total` lets the panel say so if older leads were left out (never silently).
  return NextResponse.json({ data, total, truncated: total > rows.length });
}

const patchSchema = z.object({
  id: z.string().min(1),
  source: z.enum(['contact', 'map', 'signup']).optional(),
  status: z.enum(STATUSES).optional(),
  notes: z.string().max(4000).optional(),
});

export async function PATCH(req: NextRequest) {
  if (!(await hasPermission('leads'))) return unauthorized();
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: 'Invalid request' } }, { status: 400 });
  }
  const { id, status, notes } = parsed.data;
  const source = sourceOf(parsed.data.source);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status) patch.status = status;
  if (typeof notes === 'string') patch.notes = notes;

  const db = await getDb();
  const coll = db.collection(SOURCES[source]);
  const res = await coll.updateOne({ id }, { $set: patch });
  if (!res.matchedCount) return NextResponse.json({ error: { message: 'Lead not found' } }, { status: 404 });
  const row = (await coll.findOne({ id })) as Record<string, any> | null;
  if (!row) return NextResponse.json({ data: null });
  const data = source === 'map' ? (await withProjects([row]))[0] : strip(row);
  return NextResponse.json({ data });
}

export async function DELETE(req: NextRequest) {
  if (!(await hasPermission('leads'))) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: { message: 'Missing id' } }, { status: 400 });
  const source = sourceOf(req.nextUrl.searchParams.get('source'));
  const db = await getDb();
  await db.collection(SOURCES[source]).deleteOne({ id });
  return NextResponse.json({ data: { ok: true } });
}
