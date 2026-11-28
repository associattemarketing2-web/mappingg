import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb, usingMongo } from './mongodb';
import { query } from './pg';
import { parseLatLng } from './maps-link';

// Land listings added by channel partners (CPs).
//
//   • A CP can add land only after the super admin switches it on for them
//     (Accounts → partner → "Can add land" → users.can_add_land = true).
//   • A CP sees and edits only the land they added. Every new listing — and every
//     edit — waits for super-admin approval (status 'pending').
//   • Approved land is shown to approved developers (Developer panel → Land),
//     with the CP's name and number so the developer can reach them.
//   • The super admin (and employees with the Accounts permission) see all land;
//     only the super admin approves, rejects or switches CP access.

export const LAND_TYPES = ['Agricultural', 'NA (Non-agricultural)', 'Residential', 'Commercial', 'Industrial', 'Mixed use'] as const;
export const AREA_UNITS = ['acre', 'guntha', 'hectare', 'sq ft', 'sq m'] as const;
export const DEAL_TYPES = ['Outright sale', 'Joint development (JD)', 'Joint venture (JV)', 'Lease'] as const;
export const TITLE_STATUS = ['Clear title', 'Under process', 'Not known'] as const;
export type LandStatus = 'pending' | 'approved' | 'rejected';

export interface Land {
  id: string;
  title: string;
  location: string;
  city: string;
  land_type: string;
  area: string;
  area_unit: string;
  price: string;
  deal_type: string;
  survey_no: string;
  title_status: string;
  zone: string;
  road_access: string;
  maps_link: string;
  lat: number | null;
  lng: number | null;
  description: string;
  status: LandStatus;
  review_note: string;
  reviewed_at?: string;
  reviewed_by?: string;
  cp_id: string;
  cp_name: string;
  cp_email: string;
  cp_mobile: string;
  cp_agency: string;
  created_at: string;
  updated_at: string;
}

const s = (max: number) => z.string().trim().max(max).optional().default('');
/** What a CP (or the super admin) can fill in. */
export const landInput = z.object({
  title: z.string().trim().min(3, 'Give the land a short title').max(160),
  location: z.string().trim().min(2, 'Location is required').max(200),
  city: s(80),
  land_type: s(60),
  area: s(40),
  area_unit: s(20),
  price: s(80),
  deal_type: s(60),
  survey_no: s(120),
  title_status: s(40),
  zone: s(120),
  road_access: s(200),
  maps_link: s(600),
  description: s(3000),
});
export type LandInput = z.infer<typeof landInput>;

let ready: Promise<void> | null = null;
async function ensure() {
  if (usingMongo()) return;
  ready ??= query(`
    CREATE TABLE IF NOT EXISTS "lands" (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
    CREATE INDEX IF NOT EXISTS lands_cp ON "lands" ((doc->>'cp_id'));
    CREATE INDEX IF NOT EXISTS lands_status ON "lands" ((doc->>'status'));
  `).then(() => undefined).catch((e) => { ready = null; throw e; });
  await ready;
}
export async function landsCol() {
  await ensure();
  return (await getDb()).collection<Land & { _id: string }>('lands');
}

function clean(doc: Record<string, unknown>): Land {
  const { _id, ...rest } = doc as unknown as Land & { _id?: string };
  void _id;
  return rest as Land;
}

const coordsOf = (link: string) => (link ? parseLatLng(link) : null);

/** Is this user an approved channel partner the super admin has allowed to add land? */
export async function cpLandAccess(userId: string): Promise<{ ok: boolean; reason?: string; user?: Record<string, unknown> }> {
  const db = await getDb();
  const u = await db.collection('users').findOne({ id: userId });
  if (!u || u.role !== 'agent') return { ok: false, reason: 'Only channel partners can add land.' };
  const verified = u.verification === 'approved' || (u.verification === undefined && u.verified === true);
  if (!verified) return { ok: false, reason: 'Your account is waiting for approval.', user: u };
  if (u.can_add_land !== true) return { ok: false, reason: 'Adding land is not switched on for your account yet. Ask the Mappingg team to enable it.', user: u };
  return { ok: true, user: u };
}

export async function listLands(filter: Record<string, unknown> = {}): Promise<Land[]> {
  const col = await landsCol();
  const rows = await col.find(filter).sort({ created_at: -1 }).limit(5000).toArray();
  return rows.map((r) => clean(r as unknown as Record<string, unknown>));
}

export async function getLand(id: string): Promise<Land | null> {
  const col = await landsCol();
  const r = await col.findOne({ id });
  return r ? clean(r as unknown as Record<string, unknown>) : null;
}

export async function createLand(input: LandInput, cp: Record<string, unknown>, opts: { status?: LandStatus; by?: string } = {}): Promise<Land> {
  const col = await landsCol();
  const now = new Date().toISOString();
  const id = randomUUID();
  const c = coordsOf(input.maps_link);
  const profile = (cp.profile as Record<string, string>) || {};
  const status = opts.status || 'pending';
  const doc: Land & { _id: string } = {
    _id: id, id, ...input,
    lat: c?.lat ?? null, lng: c?.lng ?? null,
    status, review_note: '',
    ...(status === 'approved' ? { reviewed_at: now, reviewed_by: opts.by } : {}),
    cp_id: String(cp.id || ''), cp_name: String(cp.name || ''), cp_email: String(cp.email || ''),
    cp_mobile: String(cp.mobile || ''), cp_agency: String(profile.agency || ''),
    created_at: now, updated_at: now,
  };
  await col.insertOne(doc);
  return clean(doc as unknown as Record<string, unknown>);
}

/** Edits the details. A CP's edit goes back for approval; staff edits keep the status. */
export async function updateLand(id: string, input: LandInput, opts: { resetReview: boolean }): Promise<Land | null> {
  const col = await landsCol();
  const c = coordsOf(input.maps_link);
  const patch: Record<string, unknown> = { ...input, lat: c?.lat ?? null, lng: c?.lng ?? null, updated_at: new Date().toISOString() };
  if (opts.resetReview) Object.assign(patch, { status: 'pending', review_note: '' });
  const res = await col.updateOne({ id }, { $set: patch });
  if (!res.matchedCount) return null;
  return getLand(id);
}

export async function reviewLand(id: string, decision: 'approve' | 'reject' | 'reset', note: string, by: string): Promise<Land | null> {
  const col = await landsCol();
  const now = new Date().toISOString();
  const status: LandStatus = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'pending';
  const res = await col.updateOne({ id }, {
    $set: {
      status, review_note: decision === 'reject' ? note : '',
      reviewed_at: decision === 'reset' ? '' : now, reviewed_by: decision === 'reset' ? '' : by, updated_at: now,
    },
  });
  if (!res.matchedCount) return null;
  return getLand(id);
}

/** What a developer sees: approved land with the CP's contact, no review internals. */
export function forDeveloper(l: Land) {
  const { review_note, reviewed_by, cp_email, ...rest } = l;
  void review_note; void reviewed_by; void cp_email;
  return rest;
}
