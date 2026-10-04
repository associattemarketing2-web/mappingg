import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { logActivity } from '@/lib/activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A developer's own projects. Each is stored as a normal map `pin` so it shows
// on the public map once approved — but stamped with `owner_user_id` (so the
// developer only ever sees their own) and held as `pending_review` + `hidden`
// until the super-admin approves it.
type PinDoc = { _id?: string; [k: string]: unknown };

const STATUSES = ['available', 'under_construction', 'upcoming', 'sold'] as const;

const createSchema = z.object({
  title: z.string().trim().min(2).max(160),
  location: z.string().trim().max(160).optional().default(''),
  type: z.string().trim().max(60).optional().default('Residential'),
  status: z.enum(STATUSES).optional().default('upcoming'),
  price: z.string().trim().max(80).optional().default(''),
  configuration: z.string().trim().max(120).optional().default(''),
  description: z.string().trim().max(4000).optional().default(''),
  // Optional precise location; if omitted the admin can place it on review.
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  image: z.string().max(3_000_000).optional().default(''), // data: URL or image URL
});

/** Only developers manage their own projects here. */
async function developer() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'developer') return null;
  return user;
}

function statusOf(p: PinDoc): 'pending' | 'rejected' | 'live' {
  if (p.rejected) return 'rejected';
  if (p.pending_review) return 'pending';
  return 'live';
}

// Build a review-pending, owner-stamped pin from a validated create payload.
// `number` is the map pin number, assigned by the caller (see nextNumberAllocator)
// so a developer's project gets the next free number exactly like the admin editor.
function buildPin(d: z.infer<typeof createSchema>, ownerId: string, company: string, now: string, number: number): PinDoc {
  const id = randomUUID();
  return {
    _id: id, id, number,
    title: d.title, location: d.location, type: d.type, status: d.status,
    price: d.price, configuration: d.configuration, description: d.description,
    image: d.image || null, developer: company,
    ...(d.lat != null ? { lat: d.lat } : {}), ...(d.lng != null ? { lng: d.lng } : {}),
    owner_user_id: ownerId,
    pending_review: true, rejected: false, hidden: true, // not on the public map until approved
    created_at: now, updated_at: now,
  };
}

// Allocator for map pin numbers: returns the lowest unused positive integer,
// filling gaps — the exact scheme the admin map editor uses. Built once per
// request from the current pins, then hands out consecutive free numbers so a
// bulk upload gets 206, 207, 208… The pin id (not the number) is the unique key,
// and the super-admin can renumber on review, so this non-atomic read-then-assign
// (identical to the editor's) is safe at this scale.
async function nextNumberAllocator(db: Awaited<ReturnType<typeof getDb>>): Promise<() => number> {
  const rows = (await db.collection<PinDoc>('pins').find({}, { projection: { number: 1 } }).toArray()) as PinDoc[];
  const used = new Set<number>();
  for (const r of rows) { const n = Number(r.number); if (Number.isInteger(n) && n > 0) used.add(n); }
  return () => { let n = 1; while (used.has(n)) n++; used.add(n); return n; };
}

// Up to 500 projects can be bulk-uploaded from an Excel/CSV in one request.
const bulkSchema = z.object({ projects: z.array(createSchema).min(1).max(500) });

export async function GET() {
  const user = await developer();
  if (!user) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });

  const db = await getDb();
  const rows = (await db
    .collection<PinDoc>('pins')
    .find(
      { owner_user_id: user.id },
      { projection: { id: 1, number: 1, title: 1, location: 1, status: 1, type: 1, price: 1, configuration: 1, description: 1, lat: 1, lng: 1, pending_review: 1, rejected: 1, hidden: 1, created_at: 1 } },
    )
    .sort({ created_at: -1 })
    .toArray()) as PinDoc[];

  const projects = rows.map((p) => ({
    id: String(p.id), number: p.number ?? null, title: String(p.title || ''), location: String(p.location || ''),
    status: String(p.status || ''), type: String(p.type || ''), price: String(p.price || ''),
    configuration: String(p.configuration || ''), description: String(p.description || ''),
    lat: p.lat ?? null, lng: p.lng ?? null,
    review: statusOf(p), created_at: String(p.created_at || ''),
  }));
  return NextResponse.json({ data: projects }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req: NextRequest) {
  const user = await developer();
  if (!user) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });

  const raw = await req.json().catch(() => null);

  const db = await getDb();
  // Stamp the developer's company (from their profile) as the pin's developer.
  const me = await db.collection('users').findOne({ id: user.id }, { projection: { profile: 1 } });
  const company = String((me?.profile as Record<string, string> | undefined)?.company || '');
  const now = new Date().toISOString();

  // Bulk mode: { projects: [...] } from the Excel/CSV uploader. Every row is
  // owner-scoped and held for review, exactly like a single add.
  if (raw && typeof raw === 'object' && Array.isArray((raw as { projects?: unknown }).projects)) {
    const parsed = bulkSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: { message: 'Some rows are missing a project name or have invalid details. Please check the file and try again.' } }, { status: 400 });
    }
    const alloc = await nextNumberAllocator(db);
    const docs = parsed.data.projects.map((d) => buildPin(d, user.id, company, now, alloc()));
    await db.collection<PinDoc>('pins').insertMany(docs);
    await logActivity({ user_id: user.id, email: user.email, role: user.role, type: 'project_added', detail: `Uploaded ${docs.length} project${docs.length === 1 ? '' : 's'} from a file — sent for review` });
    return NextResponse.json({ data: { inserted: docs.length, review: 'pending' } }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
  }

  // Single add.
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: { message: 'Please fill in a project name and the details.' } }, { status: 400 });
  }
  const alloc = await nextNumberAllocator(db);
  const doc = buildPin(parsed.data, user.id, company, now, alloc());
  await db.collection<PinDoc>('pins').insertOne(doc);
  await logActivity({ user_id: user.id, email: user.email, role: user.role, type: 'project_added', detail: `Added “${String(doc.title || 'Untitled project')}” (#${doc.number}) — sent for review` });

  return NextResponse.json({ data: { id: doc.id, number: doc.number, review: 'pending' } }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}

const editSchema = createSchema.partial().extend({ id: z.string().min(1) });

export async function PATCH(req: NextRequest) {
  const user = await developer();
  if (!user) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });

  const parsed = editSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { message: 'Invalid request.' } }, { status: 400 });
  const { id, ...fields } = parsed.data;

  const db = await getDb();
  // Ownership is enforced in the filter: a developer can only edit their own pin.
  const existing = await db.collection<PinDoc>('pins').findOne({ id, owner_user_id: user.id });
  if (!existing) return NextResponse.json({ error: { message: 'Project not found' } }, { status: 404 });

  const patch: Record<string, unknown> = { ...fields, updated_at: new Date().toISOString() };
  delete (patch as { id?: unknown }).id;
  // Any edit goes back through the super-admin review queue before it is live again.
  patch.pending_review = true;
  patch.rejected = false;
  patch.hidden = true;

  await db.collection<PinDoc>('pins').updateOne({ id, owner_user_id: user.id }, { $set: patch });
  await logActivity({ user_id: user.id, email: user.email, role: user.role, type: 'project_edited', detail: `Edited “${String(patch.title || existing.title || 'Untitled project')}” — sent for review` });
  return NextResponse.json({ data: { id, review: 'pending' } }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function DELETE(req: NextRequest) {
  const user = await developer();
  if (!user) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: { message: 'Missing id' } }, { status: 400 });

  const db = await getDb();
  // Scoped to the owner so a developer can never delete someone else's project.
  const gone = await db.collection<PinDoc>('pins').findOne({ id, owner_user_id: user.id }, { projection: { title: 1 } });
  const res = await db.collection<PinDoc>('pins').deleteOne({ id, owner_user_id: user.id });
  if (!res.deletedCount) return NextResponse.json({ error: { message: 'Project not found' } }, { status: 404 });
  await logActivity({ user_id: user.id, email: user.email, role: user.role, type: 'project_deleted', detail: `Deleted “${String(gone?.title || 'a project')}”` });
  return NextResponse.json({ data: { ok: true } }, { headers: { 'Cache-Control': 'private, no-store' } });
}
