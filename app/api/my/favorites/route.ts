import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { logActivity } from '@/lib/activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// An agent / channel partner's favourite projects: pin ids they heart on the
// live map's project cards, saved on their `users` document (`favorite_pins`)
// so the list follows them across devices and shows on their dashboard.
const MAX_FAVORITES = 200;

const putSchema = z.object({
  pins: z.array(z.string().trim().min(1).max(100)).max(MAX_FAVORITES),
});

/** Only agent / channel-partner accounts have favourites. */
async function agent() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'agent') return null;
  return user;
}

const unauthorized = () => NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });

export async function GET() {
  const user = await agent();
  if (!user) return unauthorized();

  const db = await getDb();
  const doc = await db.collection('users').findOne({ email: user.email.toLowerCase() }, { projection: { favorite_pins: 1 } });
  const pins = Array.isArray(doc?.favorite_pins) ? doc.favorite_pins.map(String).slice(0, MAX_FAVORITES) : [];
  return NextResponse.json({ pins, max: MAX_FAVORITES }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function PUT(req: NextRequest) {
  const user = await agent();
  if (!user) return unauthorized();

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: `You can save up to ${MAX_FAVORITES} favourite projects.` } }, { status: 400 });
  }
  const ids = Array.from(new Set(parsed.data.pins));

  // Keep only projects that exist and are public, so the list can't hold hidden pins.
  const db = await getDb();
  const live = ids.length
    ? await db.collection('pins').find({ id: { $in: ids }, hidden: { $ne: true } }, { projection: { id: 1 } }).toArray()
    : [];
  const liveIds = new Set(live.map((p) => String(p.id)));
  const pins = ids.filter((id) => liveIds.has(id));

  const before = await db.collection('users').findOne({ email: user.email.toLowerCase() }, { projection: { favorite_pins: 1 } });
  const prev = Array.isArray(before?.favorite_pins) ? before.favorite_pins.map(String) : [];
  await db.collection('users').updateOne({ email: user.email.toLowerCase() }, { $set: { favorite_pins: pins } });

  const added = pins.filter((id) => !prev.includes(id));
  const removed = prev.filter((id: string) => !pins.includes(id));
  if (added.length || removed.length) {
    const names = await db.collection('pins').find({ id: { $in: [...added, ...removed] } }, { projection: { id: 1, title: 1, number: 1 } }).toArray();
    const name = (id: string) => {
      const p = names.find((x) => String(x.id) === id);
      return p ? String(p.title || `#${p.number ?? ''}`) : 'a project';
    };
    await logActivity({
      user_id: user.id, email: user.email, role: user.role, type: 'favorite',
      detail: added.length
        ? `Added ${added.map(name).join(', ')} to favourites`
        : `Removed ${removed.map(name).join(', ')} from favourites`,
    });
  }
  return NextResponse.json({ pins, max: MAX_FAVORITES });
}
