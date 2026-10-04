import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { logActivity } from '@/lib/activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A buyer's compare cart on the live map: up to MAX_COMPARE project (pin) ids,
// saved on their `users` document so it follows them across devices.
const MAX_COMPARE = 4;

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

export async function GET() {
  const user = await buyer();
  if (!user) return unauthorized();

  const db = await getDb();
  const doc = await db.collection('users').findOne({ email: user.email.toLowerCase() }, { projection: { compare_pins: 1 } });
  const pins = Array.isArray(doc?.compare_pins) ? doc.compare_pins.map(String).slice(0, MAX_COMPARE) : [];
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
