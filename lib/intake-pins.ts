import { randomUUID } from 'node:crypto';
import { getDb } from './mongodb';
import { runDbOp } from './db-engine';
import { developerLogo } from './developers';
import { resolveMapsLink } from './maps-link';

// Projects published from "Projects Intake" (the bulk-upload / builder-link
// system) live in their own `projects` table, but the live map and the Map
// Editor only read `pins`. This keeps a map pin in step with each published
// project: publishing creates or updates its pin, unpublishing hides it.
//
// Pin fields the super admin sets later in the Map Editor (pin size, highlight,
// card visibility, custom fields, number) are kept when a project is re-published.

type Doc = Record<string, any>;
export interface PinSyncResult { pinId: string | null; number: number | null; onMap: boolean; note: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-12" → "Dec 2026"; anything else is shown as typed. */
function prettyMonth(v: unknown): string {
  const s = String(v ?? '').trim();
  const m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s);
  return m && +m[2] >= 1 && +m[2] <= 12 ? `${MONTHS[+m[2] - 1]} ${m[1]}` : s;
}

/** Public-map status from the intake's free-text construction / sales status. */
function mapStatus(p: Doc): 'available' | 'construction' | 'upcoming' | 'sold' {
  const sales = String(p.sales_status || '').toLowerCase();
  const build = String(p.construction_status || '').toLowerCase();
  if (/sold\s*out/.test(sales) && !/\d+\s*%/.test(sales)) return 'sold';
  if (/new launch|upcoming|pre[- ]?launch|launching|non[- ]?construction|bhoomi/.test(build)) return 'upcoming';
  if (/ready|completed|possession/.test(build) && !/under/.test(build)) return 'available';
  return 'construction';
}

const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
const validLatLng = (lat: number | null, lng: number | null) =>
  lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/** The pin fields that come from the intake project. */
function pinFieldsFrom(p: Doc, lat: number, lng: number): Doc {
  const unit = String(p.area_unit || 'sq ft').replace(/\.$/, '');
  const a = num(p.carpet_area_min), b = num(p.carpet_area_max);
  const sqft = a != null && b != null && a !== b ? `${a} – ${b} ${unit}` : a ?? b ? `${a ?? b} ${unit}` : '';
  const rera = (Array.isArray(p.rera_numbers) ? p.rera_numbers : [])
    .map((x: unknown) => String(x).trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
  return {
    title: String(p.project_name || '').trim(),
    developer: String(p.developer_name || '').trim(),
    location: [p.locality, p.city].map((x) => String(x || '').trim()).filter(Boolean).join(', '),
    type: String(p.project_type || '').trim(),
    status: mapStatus(p),
    price: String(p.price_label || '').trim(),
    configuration: (Array.isArray(p.configurations) ? p.configurations : []).map(String).filter(Boolean).join(' / '),
    sqft,
    possession_timeline: prettyMonth(p.possession_date_target || p.possession_date_rera),
    launch_date: prettyMonth(p.launch_date),
    rera_number: rera,
    key_usp: String(p.key_usps || '').trim(),
    description: String(p.short_description || '').trim(),
    youtube_video_url: String(p.youtube_url || '').trim(),
    image: p.cover_image_url || null,
    brochure_url: p.brochure_url || null,
    lat, lng,
    intake_project_id: String(p.id),
    source: 'intake',
    hidden: false, pending_review: false, rejected: false,
  };
}

async function nextPinNumber(): Promise<number> {
  const db = await getDb();
  const rows = await db.collection<Doc>('pins').find({}, { projection: { number: 1 } }).toArray();
  const used = new Set(rows.map((r) => Number(r.number)).filter((n) => Number.isInteger(n) && n > 0));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/** Create or update the map pin for a published intake project. */
export async function syncProjectPin(project: Doc, googleMapsLink?: string): Promise<PinSyncResult> {
  const db = await getDb();
  const pins = db.collection<Doc>('pins');
  const existing = (project.pin_id && (await pins.findOne({ id: project.pin_id })))
    || (await pins.findOne({ intake_project_id: String(project.id) }));

  let lat = num(project.lat), lng = num(project.lng);
  if (!validLatLng(lat, lng) && googleMapsLink) {
    const hit = await resolveMapsLink(googleMapsLink);
    if (hit) { lat = hit.lat; lng = hit.lng; }
  }
  if (!validLatLng(lat, lng)) {
    // No usable location: keep any old pin off the map rather than misplacing it.
    if (existing && existing.hidden !== true) {
      await runDbOp({ table: 'pins', action: 'update', filters: [{ op: 'eq', col: 'id', val: existing.id }], values: { hidden: true } }, true);
    }
    return {
      pinId: existing?.id ?? null, number: existing?.number ?? null, onMap: false,
      note: 'Not on the map yet — add the latitude & longitude (or a Google Maps link) and publish again.',
    };
  }

  const fields = pinFieldsFrom(project, lat as number, lng as number);
  // The developer's logo (Super admin → Developers) is the pin picture; the cover photo only if there is none.
  const logo = await developerLogo(fields.developer);
  if (logo) fields.image = logo;
  if (existing) {
    const res = await runDbOp({ table: 'pins', action: 'update', filters: [{ op: 'eq', col: 'id', val: existing.id }], values: fields }, true);
    if (res.error) throw new Error(res.error.message);
    await db.collection<Doc>('projects').updateOne({ id: project.id }, { $set: { pin_id: existing.id, lat, lng } });
    return { pinId: existing.id, number: existing.number ?? null, onMap: true, note: `Updated on the live map as pin #${existing.number ?? '—'}.` };
  }

  const id = randomUUID();
  const number = await nextPinNumber();
  const res = await runDbOp({ table: 'pins', action: 'insert', values: { id, number, highlighted: false, ...fields } }, true);
  if (res.error) throw new Error(res.error.message);
  await db.collection<Doc>('projects').updateOne({ id: project.id }, { $set: { pin_id: id, lat, lng } });
  return { pinId: id, number, onMap: true, note: `Added to the live map as pin #${number}.` };
}

/** Take a project's pin off the live map (on unpublish). */
export async function hideProjectPin(projectId: string): Promise<void> {
  const db = await getDb();
  const pin = await db.collection<Doc>('pins').findOne({ intake_project_id: String(projectId) }, { projection: { id: 1 } });
  if (pin) await runDbOp({ table: 'pins', action: 'update', filters: [{ op: 'eq', col: 'id', val: pin.id }], values: { hidden: true } }, true);
}

/** Remove a project's pin from the map (when its intake project is deleted).
 *  The delete goes through pins_history, so Backups can still restore it. */
export async function deleteProjectPin(projectId: string): Promise<void> {
  const db = await getDb();
  const pin = await db.collection<Doc>('pins').findOne({ intake_project_id: String(projectId) }, { projection: { id: 1 } });
  if (pin) await runDbOp({ table: 'pins', action: 'delete', filters: [{ op: 'eq', col: 'id', val: pin.id }] }, true);
}
