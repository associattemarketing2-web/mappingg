import { createHash, randomUUID } from 'node:crypto';
import { query } from './pg';
import { getDb, usingMongo } from './mongodb';
import { runDbOp } from './db-engine';
import { MEDIA_DIGEST_PREFIX, mediaUrl } from './pin-media';

// The developer directory: one record per real-estate developer (builder brand)
// with ONE logo. The map editor's "Developer" box suggests names from here, and
// picking one puts that logo on the pin automatically — so a developer's logo is
// uploaded once instead of on every project. Super admin → Developers manages it.
//
// The first time it is read it fills itself from the pins already on the map:
// one entry per developer name, using the logo most of their pins already use.
// Logos are stored like pin logos (base64 data: URL in the doc) and served as
// cacheable images by /api/media/developers/<id>?f=logo (see MEDIA_FIELDS).

export interface Developer {
  id: string;
  name: string;
  /** base64 data: URL (or an http URL) — never sent to the browser as-is, see toClient(). */
  logo?: string | null;
  created_at: string;
  updated_at: string;
}
export interface DeveloperRow {
  id: string; name: string; logo: string | null; projects: number; logoInUse: number; updated_at: string;
  /** Every map project of this developer, for the card and the project list. */
  list: ProjectInfo[];
}
/** A map project's key facts, as shown in the Developers section. */
export interface ProjectInfo {
  id: string; title: string; number: number | null; hasLogo: boolean;
  location: string; status: string; type: string; configuration: string; price: string; possession: string; hidden: boolean;
}
type PinFacts = { id: string; developer?: string; image?: string; title?: string; number?: number; location?: string; status?: string; type?: string; configuration?: string; price?: string; possession_timeline?: string; hidden?: boolean };
const PIN_FACTS = { id: 1, developer: 1, image: 1, title: 1, number: 1, location: 1, status: 1, type: 1, configuration: 1, price: 1, possession_timeline: 1, hidden: 1 };
const factsOf = (p: PinFacts) => ({
  title: p.title || 'Untitled project', number: p.number ?? null, location: p.location || '', status: p.status || '', type: p.type || '',
  configuration: p.configuration || '', price: p.price || '', possession: p.possession_timeline || '', hidden: p.hidden === true,
});

/** "Lodha Group " / "LODHA-group" → "lodha group" — how names are matched. */
export const normDev = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

let ready: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (usingMongo()) return Promise.resolve();
  ready ??= query(`
    CREATE TABLE IF NOT EXISTS "developers" (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
  `).then(() => undefined).catch((e) => { ready = null; throw e; });
  return ready;
}

const coll = async () => (await getDb()).collection<Developer & { _id: string }>('developers');
const pinsColl = async () => (await getDb()).collection<{ _id: string; id: string; developer?: string; image?: string }>('pins');

// Inline images are compared by md5 fingerprint: Postgres hands back
// MEDIA_DIGEST_PREFIX + md5 instead of the base64 (megabytes across all pins).
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const fingerprint = (img: unknown) => (typeof img !== 'string' || !img ? '' : img.startsWith(MEDIA_DIGEST_PREFIX) ? img.slice(MEDIA_DIGEST_PREFIX.length) : img.startsWith('data:') ? md5(img) : img);
/** Every pin's id, developer and image fingerprint — no image data. */
const pinSummaries = async () => (await (await pinsColl()).find({}, { projection: PIN_FACTS, mediaDigest: { fields: ['image'] } } as never).toArray() as unknown as PinFacts[])
  .map((p) => ({ id: p.id, developer: p.developer, logo: fingerprint(p.image), ...factsOf(p) }));

let seeding: Promise<void> | null = null;
/** Adds a directory entry for every developer on the map that doesn't have one yet. */
export function syncFromPins(): Promise<void> {
  seeding ??= (async () => {
    await ensureTable();
    const c = await coll();
    const have = new Set((await c.find({}, { projection: { name: 1 } }).toArray()).map((d) => normDev(d.name)));
    // Per developer: the spelling used most, and the logo (by fingerprint) used most, with a pin that has it.
    const groups = new Map<string, { names: Map<string, number>; logos: Map<string, { n: number; pin: string }> }>();
    for (const p of await pinSummaries()) {
      const key = normDev(p.developer);
      if (!key || have.has(key)) continue;
      const g = groups.get(key) || { names: new Map(), logos: new Map() };
      const name = String(p.developer).trim();
      g.names.set(name, (g.names.get(name) || 0) + 1);
      if (p.logo) { const l = g.logos.get(p.logo); if (l) l.n++; else g.logos.set(p.logo, { n: 1, pin: p.id }); }
      groups.set(key, g);
    }
    if (!groups.size) return;
    const picks = [...groups.values()].map((g) => ({
      name: [...g.names.entries()].sort((a, b) => b[1] - a[1])[0][0],
      pin: [...g.logos.values()].sort((a, b) => b.n - a.n)[0]?.pin,
    }));
    // Only now load actual image data — one picture per developer.
    const want = picks.map((x) => x.pin).filter(Boolean) as string[];
    const images = new Map((want.length ? await (await pinsColl()).find({ id: { $in: want } }, { projection: { id: 1, image: 1 } }).toArray() : []).map((p) => [p.id, p.image || null]));
    const now = new Date().toISOString();
    await c.insertMany(picks.map((x) => {
      const id = randomUUID();
      return { _id: id, id, name: x.name, logo: (x.pin && images.get(x.pin)) || null, created_at: now, updated_at: now };
    }));
  })().finally(() => { seeding = null; logoIdx = null; });
  return seeding;
}

/** All developers, with inline logos as fingerprints (enough to build their media URLs). */
const devDocs = async () => (await coll()).find({}, { mediaDigest: { fields: ['logo'] } } as never).toArray();

/** Media URL for a stored logo (or the URL itself if it is already a link). */
function logoUrl(d: Developer, width?: number): string | null {
  if (!d.logo) return null;
  if (!d.logo.startsWith('data:')) return d.logo; // a plain link (the digest prefix starts with data: too)
  return mediaUrl('developers', d.id, 'logo', d.logo, width);
}

/** Every developer with its logo URL and how many map projects use the name (and this logo). */
export async function listDevelopers(): Promise<DeveloperRow[]> {
  await syncFromPins();
  const [devs, pins] = await Promise.all([devDocs(), pinSummaries()]);
  const projects = new Map<string, number>();
  const sameLogo = new Map<string, number>();
  const lists = new Map<string, DeveloperRow['list']>();
  const logoOf = new Map(devs.map((d) => [normDev(d.name), fingerprint(d.logo)]));
  for (const p of pins) {
    const k = normDev(p.developer);
    if (!k) continue;
    projects.set(k, (projects.get(k) || 0) + 1);
    const hasLogo = !!p.logo && p.logo === logoOf.get(k);
    if (hasLogo) sameLogo.set(k, (sameLogo.get(k) || 0) + 1);
    lists.set(k, [...(lists.get(k) || []), {
      id: p.id, hasLogo, title: p.title, number: p.number, location: p.location, status: p.status, type: p.type,
      configuration: p.configuration, price: p.price, possession: p.possession, hidden: p.hidden,
    }]);
  }
  return devs
    .map((d) => ({
      id: d.id, name: d.name, logo: logoUrl(d), projects: projects.get(normDev(d.name)) || 0, logoInUse: sameLogo.get(normDev(d.name)) || 0, updated_at: d.updated_at,
      list: (lists.get(normDev(d.name)) || []).sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9) || a.title.localeCompare(b.title)),
    }))
    .sort((a, b) => b.projects - a.projects || a.name.localeCompare(b.name));
}

/** Small list for the map editor's suggestions: name + logo thumbnail URL. */
export async function directory(): Promise<{ id: string; name: string; logo: string | null }[]> {
  await syncFromPins();
  return (await devDocs())
    .map((d) => ({ id: d.id, name: d.name, logo: logoUrl(d) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export class DeveloperError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const cleanName = (s: unknown) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 120);
const isLogo = (s: unknown): s is string => typeof s === 'string' && /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/.test(s) && s.length < 3_000_000;

async function assertUniqueName(name: string, exceptId?: string) {
  const all = await (await coll()).find({}, { projection: { id: 1, name: 1 } }).toArray();
  const clash = all.find((d) => d.id !== exceptId && normDev(d.name) === normDev(name));
  if (clash) throw new DeveloperError(`“${clash.name}” is already in the list`, 409);
}

// ---------------------------------------------------------------- auto logo
// Whenever a pin is saved with a developer name (Map Editor, Projects Intake,
// developer dashboard), the developer's logo from this directory goes on the
// pin automatically — so typing the name is enough.

let logoIdx: { at: number; byName: Map<string, { logo: string; fp: string }>; fps: Set<string> } | null = null;
async function logoIndex() {
  if (logoIdx && Date.now() - logoIdx.at < 60_000) return logoIdx;
  await ensureTable();
  const devs = await (await coll()).find({}, { projection: { name: 1, logo: 1 } }).toArray();
  const byName = new Map<string, { logo: string; fp: string }>();
  for (const d of devs) if (d.logo && normDev(d.name)) byName.set(normDev(d.name), { logo: d.logo, fp: fingerprint(d.logo) });
  logoIdx = { at: Date.now(), byName, fps: new Set([...byName.values()].map((x) => x.fp)) };
  return logoIdx;
}

/** The directory logo for a developer name (matched loosely: case, spaces and punctuation ignored). */
export async function developerLogo(developer: unknown): Promise<string | null> {
  if (!normDev(developer)) return null;
  try { return (await logoIndex()).byName.get(normDev(developer))?.logo || null; } catch { return null; }
}

/**
 * The image a pin should get for `developer`, or undefined to leave it as is.
 * Fills an empty picture, and swaps another developer's directory logo (the
 * name was changed) — but never replaces a picture someone uploaded themselves.
 * `currentImage` may be a data: URL, its md5 digest or a link.
 */
export async function autoLogo(developer: unknown, currentImage: unknown): Promise<string | undefined> {
  if (!normDev(developer)) return undefined;
  let idx;
  try { idx = await logoIndex(); } catch { return undefined; }
  const hit = idx.byName.get(normDev(developer));
  if (!hit) return undefined;
  const cur = fingerprint(currentImage);
  if (!cur) return hit.logo;
  if (cur === hit.fp) return undefined;
  return idx.fps.has(cur) ? hit.logo : undefined;
}

/** A pin's current picture as a fingerprint (no image data), for autoLogo(). */
export async function pinImageDigest(id: string): Promise<string> {
  const p = await (await pinsColl()).findOne({ id }, { projection: { image: 1 }, mediaDigest: { fields: ['image'] } } as never);
  return fingerprint(p?.image);
}

export async function createDeveloper(input: { name: unknown; logo?: unknown }): Promise<void> {
  await ensureTable();
  const name = cleanName(input.name);
  if (!name) throw new DeveloperError('Enter the developer’s name');
  if (input.logo != null && !isLogo(input.logo)) throw new DeveloperError('Logo must be a PNG, JPG, WebP, GIF or SVG image under 2 MB');
  await assertUniqueName(name);
  const id = randomUUID(), now = new Date().toISOString();
  await (await coll()).insertOne({ _id: id, id, name, logo: (input.logo as string) || null, created_at: now, updated_at: now });
  logoIdx = null;
}

export async function updateDeveloper(id: string, input: { name?: unknown; logo?: unknown }): Promise<void> {
  await ensureTable();
  const set: Partial<Developer> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    if (!name) throw new DeveloperError('Enter the developer’s name');
    await assertUniqueName(name, id);
    set.name = name;
  }
  if (input.logo !== undefined) {
    if (input.logo !== null && !isLogo(input.logo)) throw new DeveloperError('Logo must be a PNG, JPG, WebP, GIF or SVG image under 2 MB');
    set.logo = input.logo as string | null;
  }
  const r = await (await coll()).updateOne({ id }, { $set: set });
  logoIdx = null;
  if (!r.matchedCount) throw new DeveloperError('Developer not found', 404);
}

export async function deleteDeveloper(id: string): Promise<void> {
  await ensureTable();
  await (await coll()).deleteOne({ id });
  logoIdx = null;
}

/**
 * Puts the developer's logo on every map project with that developer name.
 * Goes through the normal pin update, so each change lands in pin history
 * (restorable from Backups) and the live map refreshes.
 */
export async function applyLogoToPins(id: string, onlyPins?: string[]): Promise<number> {
  await ensureTable();
  const dev = await (await coll()).findOne({ id });
  if (!dev) throw new DeveloperError('Developer not found', 404);
  if (!dev.logo) throw new DeveloperError('Add a logo first');
  const key = normDev(dev.name), want = fingerprint(dev.logo);
  // Optional: just the projects the admin ticked (still only this developer's).
  const picked = onlyPins ? new Set(onlyPins) : null;
  const ids = (await pinSummaries()).filter((p) => normDev(p.developer) === key && p.logo !== want && (!picked || picked.has(p.id))).map((p) => p.id);
  if (!ids.length) return 0;
  const r = await runDbOp({ table: 'pins', action: 'update', filters: [{ op: 'in', col: 'id', vals: ids }], values: { image: dev.logo } }, true);
  if (r.error) throw new DeveloperError(r.error.message, r.status || 500);
  return ids.length;
}

/**
 * Puts a different logo (not the developer's own) on some of the developer's
 * projects — e.g. a project with its own branding. Same pin update as above, so
 * the old picture stays in pin history.
 */
export async function setPinsLogo(id: string, pinIds: string[], logo: unknown): Promise<number> {
  await ensureTable();
  if (!isLogo(logo)) throw new DeveloperError('Logo must be a PNG, JPG, WebP, GIF or SVG image under 2 MB');
  const dev = await (await coll()).findOne({ id }, { projection: { name: 1 } });
  if (!dev) throw new DeveloperError('Developer not found', 404);
  const key = normDev(dev.name), picked = new Set(pinIds);
  const ids = (await pinSummaries()).filter((p) => normDev(p.developer) === key && picked.has(p.id)).map((p) => p.id);
  if (!ids.length) throw new DeveloperError('Select at least one of this developer’s projects');
  const r = await runDbOp({ table: 'pins', action: 'update', filters: [{ op: 'in', col: 'id', vals: ids }], values: { image: logo } }, true);
  if (r.error) throw new DeveloperError(r.error.message, r.status || 500);
  return ids.length;
}

/** This developer's map projects, each with its current picture and whether it already shows the developer logo. */
export async function developerProjects(id: string): Promise<(ProjectInfo & { image: string | null })[]> {
  await ensureTable();
  const dev = await (await coll()).findOne({ id }, { mediaDigest: { fields: ['logo'] } } as never);
  if (!dev) throw new DeveloperError('Developer not found', 404);
  const key = normDev(dev.name), want = fingerprint(dev.logo);
  const pins = await (await pinsColl()).find({}, { projection: PIN_FACTS, mediaDigest: { fields: ['image'] } } as never).toArray() as unknown as PinFacts[];
  return pins
    .filter((p) => normDev(p.developer) === key)
    .map((p) => ({
      id: p.id, ...factsOf(p),
      image: !p.image ? null : p.image.startsWith('data:') ? mediaUrl('pins', p.id, 'image', p.image, 160) : p.image,
      hasLogo: !!want && fingerprint(p.image) === want,
    }))
    .sort((a, b) => Number(a.hasLogo) - Number(b.hasLogo) || (a.number ?? 1e9) - (b.number ?? 1e9));
}

/** The stored logo exactly as saved (data: URL), so pins get an identical copy. */
export async function logoData(id: string): Promise<string | null> {
  await ensureTable();
  const d = await (await coll()).findOne({ id }, { projection: { logo: 1 } });
  return d?.logo || null;
}
