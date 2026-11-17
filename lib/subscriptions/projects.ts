import { getDb } from '../mongodb';
import { invalidateTable } from '../db-engine';
import { cityFrom, CITY_LABELS, type CityKey } from '../seo/city';

// Project (pin) facts the subscription engine needs: which city/state a pin is
// in (CP city plans, developer multi-state limits), a developer's eligible
// projects, and the promotion flag paid developer plans put on their pins.

export const CITY_STATE: Record<CityKey, string> = {
  pune: 'Maharashtra', mumbai: 'Maharashtra', nashik: 'Maharashtra',
  bengaluru: 'Karnataka', hyderabad: 'Telangana', delhi: 'Delhi NCR', dubai: 'UAE',
};

export const CITY_OPTIONS = (Object.keys(CITY_LABELS) as CityKey[]).map((k) => ({ key: k, label: CITY_LABELS[k], state: CITY_STATE[k] }));
export const isCityKey = (v: unknown): v is CityKey => typeof v === 'string' && v in CITY_LABELS;

type PinLite = { id: string; title?: string; location?: string; lat?: unknown; lng?: unknown; owner_user_id?: string; hidden?: boolean; rejected?: boolean; pending_review?: boolean; number?: number };

export function pinCity(p: { location?: string; lat?: unknown; lng?: unknown }): CityKey | null {
  try {
    return cityFrom(p.location, p.lat as number, p.lng as number) || null;
  } catch {
    return null;
  }
}

/** A public pin's id, title and city (null when the pin doesn't exist or is hidden from the public). */
export async function publicPin(pinId: string): Promise<{ id: string; title: string; cityKey: CityKey | null; owner: string | null } | null> {
  const db = await getDb();
  const p = await db.collection('pins').findOne({ id: pinId, hidden: { $ne: true } }, { projection: { id: 1, title: 1, location: 1, lat: 1, lng: 1, owner_user_id: 1 } }) as PinLite | null;
  if (!p) return null;
  return { id: String(p.id), title: String(p.title || ''), cityKey: pinCity(p), owner: p.owner_user_id ? String(p.owner_user_id) : null };
}

export async function publicPinByNumber(n: number) {
  const db = await getDb();
  const p = await db.collection('pins').findOne({ number: n, hidden: { $ne: true } }, { projection: { id: 1 } });
  return p ? publicPin(String(p.id)) : null;
}

export interface DevProject { id: string; number: number | null; title: string; location: string; city: CityKey | null; state: string | null; review: 'pending' | 'rejected' | 'live' }

/** Projects a developer owns that can be put on a paid plan (not rejected). */
export async function developerProjects(userId: string): Promise<DevProject[]> {
  const db = await getDb();
  const rows = (await db.collection('pins').find({ owner_user_id: userId }, { projection: { id: 1, number: 1, title: 1, location: 1, lat: 1, lng: 1, pending_review: 1, rejected: 1 } }).toArray()) as PinLite[];
  return rows.map((p) => {
    const city = pinCity(p);
    return {
      id: String(p.id), number: typeof p.number === 'number' ? p.number : null, title: String(p.title || 'Untitled project'), location: String(p.location || ''),
      city, state: city ? CITY_STATE[city] : null, review: p.rejected ? 'rejected' : p.pending_review ? 'pending' : 'live',
    };
  });
}

/** How many projects a developer has listed (for the plan's project-listing limit). */
export async function developerProjectCount(userId: string): Promise<number> {
  return (await getDb()).collection('pins').countDocuments({ owner_user_id: userId });
}

/**
 * Promotion flag on a developer's pins: 'priority' (Large Bulk), 'enhanced'
 * (Large) or null. A system field — the admin's own `highlighted` flag is
 * never touched. Listings sort promoted projects first (lib/home/cards.ts).
 */
export async function syncPromotion(userId: string, covered: string[], level: 'priority' | 'enhanced' | null): Promise<void> {
  const db = await getDb();
  const pins = db.collection('pins');
  const owned = (await pins.find({ owner_user_id: userId }, { projection: { id: 1, sub_promotion: 1 } }).toArray()) as { id: string; sub_promotion?: string | null }[];
  let changed = false;
  for (const p of owned) {
    const want = level && covered.includes(String(p.id)) ? level : null;
    if ((p.sub_promotion || null) !== want) {
      await pins.updateOne({ id: p.id, owner_user_id: userId }, { $set: { sub_promotion: want } });
      changed = true;
    }
  }
  if (changed) invalidateTable('pins');
}
