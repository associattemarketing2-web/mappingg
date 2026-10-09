import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/mongodb';
import { hasPermission } from '@/lib/staff';
import { localitiesOf } from '@/lib/locality';
import { getCurrentUser } from '@/lib/auth';
import { idsParam, moveToTrash } from '@/lib/trash';
import { syncBuyerLeads } from '@/lib/signup-leads';
import { listEmployees } from '@/lib/staff';

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

type Pin = {
  id: string; title?: string; number?: number; location?: string; developer?: string; status?: string; type?: string;
  price?: string; configuration?: string; sqft?: string; possession_timeline?: string;
};
// Project fields shown with a map enquiry in the CRM.
const PIN_FIELDS = { id: 1, title: 1, number: 1, location: 1, developer: 1, status: 1, type: 1, price: 1, configuration: 1, sqft: 1, possession_timeline: 1 };

/** A map enquiry in the CRM's lead shape, with the project it was about. */
function mapLead(doc: Record<string, any>, pin?: Pin) {
  const l = strip(doc);
  return {
    ...l,
    source: 'map',
    status: STATUSES.includes(l.status) ? l.status : 'new',
    phone: l.whatsapp || l.phone || '',
    role: ['buyer', 'agent', 'developer'].includes(l.role) ? l.role : 'buyer',
    project: pin ? {
      id: pin.id, title: pin.title || '', number: pin.number ?? null, location: pin.location || '',
      developer: pin.developer || '', status: pin.status || '', type: pin.type || '', price: pin.price || '',
      configuration: pin.configuration || '', sqft: pin.sqft || '', possession: pin.possession_timeline || '',
    } : null,
    enquiry_clicks: Number(l.enquiry_clicks) || 1,
    last_enquired_at: l.last_enquired_at || l.created_at || null,
    locations: localitiesOf(pin?.location),
  };
}

async function withProjects(rows: Record<string, any>[]) {
  const db = await getDb();
  const ids = Array.from(new Set(rows.map((r) => String(r.pin_id || '')).filter(Boolean)));
  const pins = ids.length
    ? ((await db.collection('pins').find({ id: { $in: ids } }, { projection: PIN_FIELDS }).toArray()) as unknown as Pin[])
    : [];
  const byId = new Map(pins.map((p) => [String(p.id), p]));
  return withAccounts(rows.map((r) => mapLead(r, byId.get(String(r.pin_id)))));
}

/** Map enquiries from people with an account (buyer, agent or developer — matched
 *  by account or email) get that account's details, login data and preferences;
 *  everyone else is a guest. */
async function withAccounts(rows: Record<string, any>[]) {
  const db = await getDb();
  const ids = Array.from(new Set(rows.map((r) => String(r.account_id || '')).filter(Boolean)));
  const emails = Array.from(new Set(rows.map((r) => String(r.email || '').trim().toLowerCase()).filter(Boolean)));
  if (!ids.length && !emails.length) return rows.map((r) => ({ ...r, account: null }));
  const users = await db.collection('users').find(
    { role: { $in: ['buyer', 'agent', 'developer'] }, $or: [{ id: { $in: ids } }, { email: { $in: emails } }] },
    { projection: { id: 1, email: 1, name: 1, mobile: 1, role: 1, last_login_at: 1, login_count: 1, profile: 1, compare_pins: 1, created_at: 1 } },
  ).toArray() as Record<string, any>[];
  const byId = new Map(users.map((u) => [String(u.id), u]));
  const byEmail = new Map(users.map((u) => [String(u.email || '').toLowerCase(), u]));
  // How many map enquiries each buyer has made in total.
  const countFor = (u: Record<string, any>) => rows.filter((r) => String(r.account_id || '') === String(u.id) || String(r.email || '').toLowerCase() === String(u.email || '').toLowerCase()).length;
  return rows.map((r) => {
    const u = byId.get(String(r.account_id || '')) || byEmail.get(String(r.email || '').trim().toLowerCase());
    return {
      ...r,
      account: u ? {
        id: String(u.id), signed_in: !!r.account_id, role: String(u.role || 'buyer'), name: String(u.name || ''),
        email: String(u.email || ''), mobile: String(u.mobile || ''),
        last_login_at: u.last_login_at || null, login_count: Number(u.login_count || 0),
        profile: u.profile || {}, compare_count: Array.isArray(u.compare_pins) ? u.compare_pins.length : 0,
        enquiry_count: countFor(u), member_since: u.created_at || null,
      } : null,
    };
  });
}

/** Buyer sign-up leads + that buyer's account activity: logins, enquiries, compare list. */
async function withBuyerActivity(rows: Record<string, any>[]) {
  const db = await getDb();
  const ids = Array.from(new Set(rows.map((r) => String(r.account_id || '')).filter(Boolean)));
  if (!ids.length) return rows.map((r) => strip(r));
  const users = await db.collection('users').find({ id: { $in: ids } }, {
    projection: { id: 1, last_login_at: 1, login_count: 1, compare_pins: 1, profile: 1, mobile: 1, created_at: 1 },
  }).toArray() as Record<string, any>[];
  const byUser = new Map(users.map((u) => [String(u.id), u]));
  // Their map enquiries: made while signed in (account_id) or with the same email.
  const emails = rows.map((r) => String(r.email || '').toLowerCase()).filter(Boolean);
  const enq = await db.collection('leads').find(
    { $or: [{ account_id: { $in: ids } }, { email: { $in: emails } }] },
    { projection: { account_id: 1, email: 1, pin_id: 1, created_at: 1 } },
  ).sort({ created_at: -1 }).toArray() as Record<string, any>[];
  const pinIds = Array.from(new Set([...enq.map((e) => String(e.pin_id)), ...users.flatMap((u) => (Array.isArray(u.compare_pins) ? u.compare_pins.map(String) : []))]));
  const pins = pinIds.length
    ? (await db.collection('pins').find({ id: { $in: pinIds } }, { projection: { id: 1, title: 1, number: 1, location: 1 } }).toArray() as unknown as Pin[])
    : [];
  const pinById = new Map(pins.map((p) => [String(p.id), p]));
  const proj = (id: string) => { const p = pinById.get(id); return p ? { id: p.id, title: p.title || 'Untitled project', number: p.number ?? null, location: p.location || '' } : null; };
  return rows.map((r) => {
    const u = byUser.get(String(r.account_id));
    const email = String(r.email || '').toLowerCase();
    const mine = enq.filter((e) => String(e.account_id) === String(r.account_id) || (email && String(e.email || '').toLowerCase() === email));
    return {
      ...strip(r),
      buyer: {
        last_login_at: u?.last_login_at || r.last_login_at || null,
        login_count: Number(u?.login_count ?? r.login_count ?? 0),
        profile: u?.profile || {},
        enquiries: mine.map((e) => ({ at: e.created_at, project: proj(String(e.pin_id)) })).filter((e) => e.project),
        compare: (Array.isArray(u?.compare_pins) ? u!.compare_pins.map(String) : []).map(proj).filter(Boolean),
        account_exists: !!u,
      },
    };
  });
}

export async function GET(req: NextRequest) {
  if (!(await hasPermission('leads'))) return unauthorized();
  // Who a lead can be transferred to: employees who can open Leads.
  if (req.nextUrl.searchParams.get('staff')) {
    const staff = (await listEmployees()).filter((e) => e.permissions.includes('leads'));
    return NextResponse.json({ data: staff.map((e) => ({ id: e.id, name: e.name || e.email, email: e.email })) });
  }
  const source = sourceOf(req.nextUrl.searchParams.get('source'));
  // Every buyer account is a lead — add any that are missing (older accounts etc.).
  if (source === 'signup') await syncBuyerLeads();
  const db = await getDb();
  const coll = db.collection(SOURCES[source]);
  const [rows, total] = await Promise.all([
    coll.find(SOURCE_FILTER[source]).sort({ created_at: -1 }).limit(LEADS_LIMIT).toArray() as Promise<Record<string, any>[]>,
    coll.countDocuments(SOURCE_FILTER[source]),
  ]);
  const data = source === 'map' ? await withProjects(rows) : source === 'signup' ? await withBuyerActivity(rows) : rows.map((r) => strip(r));
  // `total` lets the panel say so if older leads were left out (never silently).
  return NextResponse.json({ data, total, truncated: total > rows.length });
}

const patchSchema = z.object({
  id: z.string().min(1),
  source: z.enum(['contact', 'map', 'signup']).optional(),
  status: z.enum(STATUSES).optional(),
  notes: z.string().max(4000).optional(),
  // Transfer the lead to an employee (their user id), or null to unassign.
  assigned_to: z.string().min(1).nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  if (!(await hasPermission('leads'))) return unauthorized();
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: 'Invalid request' } }, { status: 400 });
  }
  const { id, status, notes, assigned_to } = parsed.data;
  const source = sourceOf(parsed.data.source);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status) patch.status = status;
  if (typeof notes === 'string') patch.notes = notes;

  const db = await getDb();
  if (assigned_to !== undefined) {
    const me = await getCurrentUser();
    if (assigned_to === null) {
      Object.assign(patch, { assigned_to: null, assigned_name: null, assigned_email: null, assigned_at: null, assigned_by: me?.email || null });
    } else {
      const emp = await db.collection('users').findOne({ id: assigned_to, role: 'employee' }, { projection: { id: 1, name: 1, email: 1, permissions: 1 } });
      if (!emp) return NextResponse.json({ error: { message: 'That employee no longer exists.' } }, { status: 404 });
      if (!(Array.isArray(emp.permissions) && emp.permissions.includes('leads'))) {
        return NextResponse.json({ error: { message: 'This employee has no access to Leads — give them the Leads permission first.' } }, { status: 400 });
      }
      Object.assign(patch, {
        assigned_to: String(emp.id), assigned_name: String(emp.name || emp.email), assigned_email: String(emp.email),
        assigned_at: patch.updated_at, assigned_by: me?.email || null,
      });
    }
  }
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
  const ids = idsParam(req.nextUrl.searchParams);
  if (!ids.length) return NextResponse.json({ error: { message: 'Missing id' } }, { status: 400 });
  const source = sourceOf(req.nextUrl.searchParams.get('source'));
  const db = await getDb();
  const coll = db.collection(SOURCES[source]);
  const actor = (await getCurrentUser())?.email;
  let deleted = 0;
  for (const id of ids) {
    const lead = await coll.findOne({ id });
    if (!lead) continue;
    // Kept in Backups → Recycle bin so it can be restored.
    await moveToTrash({
      kind: 'lead', label: String(lead.name || lead.email || lead.phone || 'Lead'),
      sub: [lead.email, lead.phone || lead.mobile, lead.project_title || lead.project].filter(Boolean).map(String).join(' · '),
      docs: [{ collection: SOURCES[source], doc: lead }], deletedBy: actor,
    });
    await coll.deleteOne({ id });
    deleted++;
  }
  return NextResponse.json({ data: { ok: true, deleted } });
}
