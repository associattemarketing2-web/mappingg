import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';

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

export async function GET() {
  const user = await developer();
  if (!user) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });

  const db = await getDb();
  const rows = (await db
    .collection<PinDoc>('pins')
    .find(
      { owner_user_id: user.id },
      { projection: { id: 1, number: 1, title: 1, location: 1, status: 1, type: 1, price: 1, pending_review: 1, rejected: 1, hidden: 1, created_at: 1 } },
    )
    .sort({ created_at: -1 })
    .toArray()) as PinDoc[];

  const projects = rows.map((p) => ({
    id: String(p.id), title: String(p.title || ''), location: String(p.location || ''),
    status: String(p.status || ''), type: String(p.type || ''), price: String(p.price || ''),
    review: statusOf(p), created_at: String(p.created_at || ''),
  }));
  return NextResponse.json({ data: projects }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req: NextRequest) {
  const user = await developer();
  if (!user) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: 'Please fill in a project name and the details.' } }, { status: 400 });
  }
  const d = parsed.data;

  const db = await getDb();
  // Stamp the developer's company (from their profile) as the pin's developer.
  const me = await db.collection('users').findOne({ id: user.id }, { projection: { profile: 1 } });
  const company = String((me?.profile as Record<string, string> | undefined)?.company || '');

  const id = randomUUID();
  const now = new Date().toISOString();
  const doc: PinDoc = {
    _id: id, id,
    title: d.title, location: d.location, type: d.type, status: d.status,
    price: d.price, configuration: d.configuration, description: d.description,
    image: d.image || null, developer: company,
    ...(d.lat != null ? { lat: d.lat } : {}), ...(d.lng != null ? { lng: d.lng } : {}),
    owner_user_id: user.id,
    pending_review: true, rejected: false, hidden: true, // not on the public map until approved
    created_at: now, updated_at: now,
  };
  await db.collection<PinDoc>('pins').insertOne(doc);

  return NextResponse.json({ data: { id, review: 'pending' } }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}
