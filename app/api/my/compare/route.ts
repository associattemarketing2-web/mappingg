import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { logActivity } from '@/lib/activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A buyer's compare cart on the live map: up to MAX_COMPARE project (pin) ids,
// saved on their `users` document so it follows them across devices.
const MAX_COMPARE = 3;

// Fields shown for each project in the buyer's profile, keyed by the
// field_visibility id the admin uses to hide them on the public card (the live
// map's compare table follows the same rule).
const DETAIL_FIELDS: { key: string; visibility: string }[] = [
  { key: 'developer', visibility: 'developer' },
  { key: 'location', visibility: 'location' },
  { key: 'status', visibility: 'status' },
  { key: 'type', visibility: 'type' },
  { key: 'rera_number', visibility: 'rera' },
  { key: 'configuration', visibility: 'configuration' },
  { key: 'sqft', visibility: 'configuration' },
  { key: 'price', visibility: 'price' },
  { key: 'possession_timeline', visibility: 'possession' },
  { key: 'launch_date', visibility: 'possession' },
  { key: 'key_usp', visibility: 'key_usp' },
];

/** The compare-list projects with the details their public card shows. */
async function details(ids: string[]) {
  if (!ids.length) return [];
  const db = await getDb();
  const projection: Record<string, 1> = { id: 1, number: 1, title: 1, field_visibility: 1 };
  DETAIL_FIELDS.forEach((f) => { projection[f.key] = 1; });
  const rows = await db.collection('pins').find({ id: { $in: ids }, hidden: { $ne: true } }, { projection }).toArray() as Record<string, any>[];
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map((r) => {
    const vis = (r!.field_visibility || {}) as Record<string, unknown>;
    const out: Record<string, unknown> = { id: String(r!.id), number: r!.number ?? null, title: String(r!.title || '') };
    DETAIL_FIELDS.forEach((f) => { out[f.key] = vis[f.visibility] === false ? '' : String(r![f.key] || ''); });
    return out;
  });
}

const putSchema = z.object({
  pins: z.array(z.string().trim().min(1).max(100)).max(MAX_COMPARE),
});

/** Only buyer accounts have a compare cart. */
async function buyer() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'buyer') return null;
  return user;
}

const unauthorized = () => NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });

export async function GET(req: NextRequest) {
  const user = await buyer();
  if (!user) return unauthorized();

  const db = await getDb();
  const doc = await db.collection('users').findOne({ email: user.email.toLowerCase() }, { projection: { compare_pins: 1 } });
  const pins = Array.isArray(doc?.compare_pins) ? doc.compare_pins.map(String).slice(0, MAX_COMPARE) : [];
  // ?details=1 (the buyer's profile page) also returns each project's details.
  if (req.nextUrl.searchParams.get('details')) {
    return NextResponse.json({ pins, max: MAX_COMPARE, projects: await details(pins) }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  return NextResponse.json({ pins, max: MAX_COMPARE });
}

export async function PUT(req: NextRequest) {
  const user = await buyer();
  if (!user) return unauthorized();

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: `Choose up to ${MAX_COMPARE} projects to compare.` } }, { status: 400 });
  }
  const ids = Array.from(new Set(parsed.data.pins));

  // Keep only projects that exist and are public, so the cart can't hold hidden pins.
  const db = await getDb();
  const live = ids.length
    ? await db.collection('pins').find({ id: { $in: ids }, hidden: { $ne: true } }, { projection: { id: 1 } }).toArray()
    : [];
  const liveIds = new Set(live.map((p) => String(p.id)));
  const pins = ids.filter((id) => liveIds.has(id));

  await db.collection('users').updateOne({ email: user.email.toLowerCase() }, { $set: { compare_pins: pins } });
  await logActivity({
    user_id: user.id, email: user.email, role: user.role, type: 'compare',
    detail: pins.length ? `Compare list updated — ${pins.length} project${pins.length === 1 ? '' : 's'}` : 'Cleared compare list',
  });
  return NextResponse.json({ pins, max: MAX_COMPARE });
}
