import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/staff';
import { query } from '@/lib/pg';
import { runDbOp } from '@/lib/db-engine';
import { baseName } from '@/lib/pin-names';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/admin/pins-data — every map pin (hidden ones too) in number order, for
// the super-admin "Pins Data" section: what each pin holds, which details are
// missing, which pin numbers are unused or used twice, which pins look like the
// same project, and which pins were deleted. Pictures and brochures come back
// only as yes/no, never the (base64) files themselves.
//
// DELETE /api/admin/pins-data?id=… — remove one pin (from the Duplicates list).
// It goes through runDbOp, so a full copy lands in pins_history and Deleted pins /
// Backups can restore it.

/** The details a complete project pin should have, in the order the admin sees them. */
const FIELDS = [
  ['title', 'Name'], ['developer', 'Developer'], ['location', 'Location'], ['image', 'Photo'],
  ['price', 'Price'], ['configuration', 'Configuration'], ['sqft', 'Area (sq ft)'],
  ['possession', 'Possession'], ['rera', 'RERA no.'], ['description', 'Description'],
] as const;

const PIN_COLUMNS = `
  doc->>'number' AS number, doc->>'title' AS title, doc->>'developer' AS developer,
  doc->>'location' AS location, doc->>'type' AS type, doc->>'status' AS status,
  doc->>'price' AS price, doc->>'configuration' AS configuration, doc->>'sqft' AS sqft,
  doc->>'possession_timeline' AS possession, doc->>'rera_number' AS rera,
  doc->>'description' AS description, doc->>'key_usp' AS key_usp,
  doc->>'lat' AS lat, doc->>'lng' AS lng, doc->>'created_at' AS created_at, doc->>'updated_at' AS updated_at,
  doc->>'source' AS source, doc->>'intake_project_id' AS intake, doc->>'owner_user_id' AS owner,
  (doc->>'hidden') = 'true' AS hidden, (doc->>'pending_review') = 'true' AS pending, (doc->>'rejected') = 'true' AS rejected,
  coalesce(doc->>'image', doc->>'image_url', doc->'image_meta'->>'thumbnailUrl', '') <> '' AS image,
  coalesce(doc->>'brochure_url', doc->>'brochure_image', '') <> '' AS brochure,
  coalesce(doc->>'youtube_video_url', '') <> '' AS video`;

type Row = {
  id: string; number: string | null; title: string | null; developer: string | null; location: string | null;
  type: string | null; status: string | null; price: string | null; configuration: string | null; sqft: string | null;
  possession: string | null; rera: string | null; description: string | null; key_usp: string | null;
  lat: string | null; lng: string | null; created_at: string | null; updated_at: string | null; source: string | null;
  intake: string | null; owner: string | null; hidden: boolean; pending: boolean; rejected: boolean;
  image: boolean; brochure: boolean; video: boolean;
};
type HistoryRow = Row & { history_id: string; deleted_at: string | null; duplicate_of: string | null; hidden_reason: string | null };

const txt = (v: string | null) => (v ?? '').trim();
/** Name / RERA compared without spaces, case or punctuation. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** A real RERA number (not "Launching soon" or a stub). */
const reraKey = (s: string) => { const k = norm(s); return k.length > 6 && !/launch|applied|na$/.test(k) ? k : ''; };

/** Distance in metres between two points. */
function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

function summarise(r: Row) {
  const has: Record<string, boolean> = {
    title: !!txt(r.title), developer: !!txt(r.developer), location: !!txt(r.location), image: r.image,
    price: !!txt(r.price), configuration: !!txt(r.configuration), sqft: !!txt(r.sqft),
    possession: !!txt(r.possession), rera: !!reraKey(txt(r.rera)), description: !!txt(r.description),
  };
  const missing = FIELDS.filter(([k]) => !has[k]).map(([k]) => k);
  const n = Number(r.number);
  const lat = Number(r.lat), lng = Number(r.lng);
  return {
    id: r.id,
    number: r.number != null && Number.isInteger(n) && n > 0 ? n : null,
    title: txt(r.title), developer: txt(r.developer), location: txt(r.location),
    type: txt(r.type), status: txt(r.status), price: txt(r.price), configuration: txt(r.configuration),
    sqft: txt(r.sqft), possession: txt(r.possession), rera: txt(r.rera), description: txt(r.description).slice(0, 300),
    key_usp: txt(r.key_usp).slice(0, 200),
    image: !!r.image, brochure: !!r.brochure, video: !!r.video,
    lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null,
    // A pin with no usable position cannot show on the map.
    located: Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0),
    hidden: !!r.hidden, pending: !!r.pending, rejected: !!r.rejected,
    origin: (r.intake || r.source === 'intake' ? 'intake' : r.owner ? 'developer' : 'map') as 'intake' | 'developer' | 'map',
    created_at: txt(r.created_at), updated_at: txt(r.updated_at),
    missing,
    score: Math.round(((FIELDS.length - missing.length) / FIELDS.length) * 100),
  };
}
type Pin = ReturnType<typeof summarise>;

/**
 * Pins that look like the same project, grouped. Two pins are linked when they
 * share a real RERA number, have the same name within 5 km, or sit on the same
 * spot (within 30 m). Each group says which of these matched.
 */
function duplicateGroups(pins: Pin[]) {
  const parent = pins.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const why = new Map<string, Set<string>>(); // "i|j" → reasons
  const link = (i: number, j: number, reason: string) => {
    const [a, b] = i < j ? [i, j] : [j, i];
    const k = `${a}|${b}`;
    (why.get(k) ?? why.set(k, new Set()).get(k)!).add(reason);
    parent[find(a)] = find(b);
  };
  const near = (a: Pin, b: Pin, m: number) => a.located && b.located && metres(a as { lat: number; lng: number }, b as { lat: number; lng: number }) <= m;

  const byRera = new Map<string, number[]>();
  const byName = new Map<string, number[]>();
  const byBase = new Map<string, number[]>();
  pins.forEach((p, i) => {
    // A pin can list several RERA numbers ("P521… P521…"); any shared one links them.
    for (const part of p.rera.split(/[\s,;/|]+/)) { const k = reraKey(part); if (k) (byRera.get(k) ?? byRera.set(k, []).get(k)!).push(i); }
    const n = norm(p.title);
    if (n.length >= 3) (byName.get(n) ?? byName.set(n, []).get(n)!).push(i);
    const b = norm(baseName(p.title));
    if (b.length >= 6) (byBase.get(b) ?? byBase.set(b, []).get(b)!).push(i);
  });
  for (const list of byRera.values()) for (let x = 1; x < list.length; x++) link(list[0], list[x], 'Same RERA number');
  const closeBy = (a: Pin, b: Pin) => near(a, b, 5000) || !a.located || !b.located;
  for (const list of byName.values()) {
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      if (closeBy(pins[list[x]], pins[list[y]])) link(list[x], list[y], 'Same name');
    }
  }
  // "Dosti Eastern Bay - Phase 1" and "… Phase 3": one project in parts.
  for (const list of byBase.values()) {
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      const [a, b] = [pins[list[x]], pins[list[y]]];
      if (norm(a.title) !== norm(b.title) && closeBy(a, b)) link(list[x], list[y], 'Phases of one project');
    }
  }
  // Same spot: sort by latitude so only close neighbours are compared.
  const placed = pins.map((p, i) => i).filter((i) => pins[i].located).sort((a, b) => (pins[a].lat as number) - (pins[b].lat as number));
  for (let x = 0; x < placed.length; x++) {
    for (let y = x + 1; y < placed.length && (pins[placed[y]].lat as number) - (pins[placed[x]].lat as number) < 0.0003; y++) {
      if (near(pins[placed[x]], pins[placed[y]], 30)) link(placed[x], placed[y], 'Same location');
    }
  }

  const groups = new Map<number, number[]>();
  pins.forEach((_, i) => { const r = find(i); (groups.get(r) ?? groups.set(r, []).get(r)!).push(i); });
  const out: { key: string; reasons: string[]; ids: string[] }[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const set = new Set(members);
    const reasons = new Set<string>();
    for (const [k, r] of why) { const [a, b] = k.split('|').map(Number); if (set.has(a) && set.has(b)) r.forEach((x) => reasons.add(x)); }
    const ids = members.sort((a, b) => (pins[a].number ?? Infinity) - (pins[b].number ?? Infinity)).map((i) => pins[i].id);
    out.push({ key: ids[0], reasons: [...reasons], ids });
  }
  // Strongest evidence first, then by the lowest pin number.
  const rank = (g: { reasons: string[] }) => ['Same RERA number', 'Same name', 'Phases of one project', 'Same location']
    .findIndex((r) => g.reasons.includes(r));
  return out.sort((a, b) => rank(a) - rank(b));
}

export async function GET() {
  if (!(await hasPermission('map'))) {
    return NextResponse.json({ data: null, error: { message: 'Not authorized' } }, { status: 401 });
  }

  const [{ rows }, { rows: history }] = await Promise.all([
    query<Row>(`SELECT id, ${PIN_COLUMNS} FROM pins`),
    // Latest deletion of each pin (with the pin as it was), newest first.
    query<HistoryRow>(
      `SELECT * FROM (
         SELECT DISTINCT ON (h.doc->>'pin_id')
                h.doc->>'pin_id' AS id, h.doc->>'history_id' AS history_id, h.doc->>'changed_at' AS deleted_at,
                h.doc->'row_data'->>'duplicate_of' AS duplicate_of, h.doc->'row_data'->>'hidden_reason' AS hidden_reason,
                ${PIN_COLUMNS.replace(/doc->/g, "h.doc->'row_data'->")}
         FROM pins_history h
         WHERE h.doc->>'operation' = 'delete' AND NOT EXISTS (SELECT 1 FROM pins p WHERE p.id = h.doc->>'pin_id')
         ORDER BY h.doc->>'pin_id', h.doc->>'changed_at' DESC
       ) d ORDER BY deleted_at DESC`,
    ),
  ]);

  const pins = rows.map(summarise)
    .sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.title.localeCompare(b.title));

  // The pin-number series: unused numbers between 1 and the highest, and numbers on more than one pin.
  const count = new Map<number, number>();
  for (const p of pins) if (p.number != null) count.set(p.number, (count.get(p.number) || 0) + 1);
  const maxNumber = Math.max(0, ...count.keys());
  const gaps: number[] = [];
  for (let n = 1; n <= maxNumber; n++) if (!count.has(n)) gaps.push(n);
  const repeated = [...count].filter(([, c]) => c > 1).map(([n]) => n).sort((a, b) => a - b);

  // Deleted pins: why each went (a duplicate of which pin, an empty pin, or removed by hand).
  const titleOf = new Map<string, string>([...pins.map((p) => [p.id, `#${p.number ?? '—'} ${p.title}`] as const)]);
  for (const h of history) if (!titleOf.has(h.id)) titleOf.set(h.id, `#${h.number ?? '—'} ${txt(h.title)} (deleted)`);
  const deleted = history.map((h) => {
    const p = summarise(h);
    const blank = !p.title && !p.developer && !p.location;
    return {
      ...p, history_id: h.history_id, deleted_at: txt(h.deleted_at),
      reason: /^merged/.test(txt(h.hidden_reason)) ? 'merged' : h.duplicate_of ? 'duplicate' : blank ? 'empty' : 'deleted',
      duplicate_of: h.duplicate_of ? titleOf.get(h.duplicate_of) || 'another pin' : '',
    };
  });

  return NextResponse.json({
    data: {
      pins, fields: FIELDS.map(([key, label]) => ({ key, label })), maxNumber, gaps, repeated,
      duplicates: duplicateGroups(pins), deleted,
    },
    error: null,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

/** Fields the Pins Data quick editor may change (form key → pin field). */
const EDITABLE: Record<string, string> = {
  title: 'title', developer: 'developer', location: 'location', price: 'price', configuration: 'configuration',
  sqft: 'sqft', possession: 'possession_timeline', rera: 'rera_number', description: 'description', key_usp: 'key_usp',
};

// PATCH /api/admin/pins-data  { id, values: { title?, …, number?, live? } } — quick fixes
// from Pins Data: fill in missing details, give a pin a free number, put it on the map.
// Goes through runDbOp, so the old version is kept in pins_history.
export async function PATCH(req: NextRequest) {
  if (!(await hasPermission('map'))) {
    return NextResponse.json({ data: null, error: { message: 'Not authorized' } }, { status: 401 });
  }
  const body = await req.json().catch(() => null) as { id?: unknown; values?: Record<string, unknown> } | null;
  const id = typeof body?.id === 'string' ? body.id : '';
  const values = body?.values && typeof body.values === 'object' ? body.values : null;
  if (!id || !values) return NextResponse.json({ data: null, error: { message: 'id and values are required' } }, { status: 400 });

  const patch: Record<string, unknown> = {};
  for (const [k, field] of Object.entries(EDITABLE)) {
    if (typeof values[k] === 'string') patch[field] = (values[k] as string).trim();
  }
  if ('title' in patch && !patch.title) return NextResponse.json({ data: null, error: { message: 'The project name cannot be empty' } }, { status: 400 });

  if (values.number !== undefined) {
    const n = Number(values.number);
    if (!Number.isInteger(n) || n < 1 || n > 99999) {
      return NextResponse.json({ data: null, error: { message: 'Pin number must be a whole number from 1' } }, { status: 400 });
    }
    const { rows } = await query<{ id: string; title: string | null }>(
      `SELECT id, doc->>'title' AS title FROM pins WHERE doc->>'number' = $1 AND id <> $2 LIMIT 1`, [String(n), id],
    );
    if (rows[0]) {
      return NextResponse.json({ data: null, error: { message: `Pin #${n} is already used by "${rows[0].title || 'another pin'}"` } }, { status: 409 });
    }
    patch.number = n;
  }

  if (values.live === true) {
    const { rows } = await query<{ lat: string | null; lng: string | null }>(`SELECT doc->>'lat' AS lat, doc->>'lng' AS lng FROM pins WHERE id = $1`, [id]);
    const lat = Number(rows[0]?.lat), lng = Number(rows[0]?.lng);
    if (!rows[0]) return NextResponse.json({ data: null, error: { message: 'Pin not found' } }, { status: 404 });
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
      return NextResponse.json({ data: null, error: { message: 'This pin has no map position yet — place it from Edit all details first' } }, { status: 400 });
    }
    patch.hidden = false; // runDbOp also clears pending_review / rejected
  } else if (values.live === false) {
    patch.hidden = true;
  }

  if (!Object.keys(patch).length) return NextResponse.json({ data: null, error: { message: 'Nothing to change' } }, { status: 400 });
  const res = await runDbOp({ table: 'pins', action: 'update', filters: [{ op: 'eq', col: 'id', val: id }], values: patch }, true);
  return NextResponse.json({ data: res.error ? null : { id }, error: res.error ?? null }, { status: res.error ? 400 : 200 });
}

/** Details copied from the merged pins onto the kept pin when the kept pin has none. */
const MERGE_FILL = [
  'developer', 'location', 'type', 'price', 'configuration', 'sqft', 'possession_timeline', 'launch_date',
  'description', 'key_usp', 'whats_available', 'youtube_video_url', 'brochure_url',
] as const;
/** Picture fields travel together, so a copied photo keeps its own metadata. */
const PHOTO = ['image', 'image_url', 'image_meta'] as const;
const BROCHURE = ['brochure_image', 'brochure_width', 'brochure_height'] as const;
const filled = (v: unknown) => v != null && v !== '' && !(typeof v === 'object' && !Object.keys(v as object).length);

// POST /api/admin/pins-data  { action: 'merge', keep, merge: [ids], title?, combineRera?, fillMissing? }
// Merges pins that are one project (e.g. its phases) into the kept pin: empty details
// on the kept pin are filled from the others, RERA numbers are combined, and the other
// pins are deleted as duplicates of it — each one stays restorable from Deleted pins.
export async function POST(req: NextRequest) {
  if (!(await hasPermission('map'))) {
    return NextResponse.json({ data: null, error: { message: 'Not authorized' } }, { status: 401 });
  }
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const keepId = typeof body?.keep === 'string' ? body.keep : '';
  const others = Array.isArray(body?.merge) ? [...new Set(body!.merge.filter((x): x is string => typeof x === 'string' && x !== keepId))] : [];
  if (body?.action !== 'merge' || !keepId || !others.length || others.length > 50) {
    return NextResponse.json({ data: null, error: { message: 'Choose the pin to keep and at least one pin to merge into it' } }, { status: 400 });
  }

  const { rows } = await query<{ id: string; doc: Record<string, unknown> }>(`SELECT id, doc FROM pins WHERE id = ANY($1::text[])`, [[keepId, ...others]]);
  const keep = rows.find((r) => r.id === keepId)?.doc;
  const merged = others.map((id) => rows.find((r) => r.id === id)?.doc).filter(Boolean) as Record<string, unknown>[];
  if (!keep || merged.length !== others.length) {
    return NextResponse.json({ data: null, error: { message: 'Some of these pins no longer exist — refresh and try again' } }, { status: 404 });
  }

  const patch: Record<string, unknown> = {};
  if (body!.fillMissing !== false) {
    // Lowest pin number first, so the oldest phase wins when several have a value.
    const donors = [...merged].sort((a, b) => Number(a.number ?? Infinity) - Number(b.number ?? Infinity));
    for (const f of MERGE_FILL) {
      if (filled(keep[f])) continue;
      const from = donors.find((d) => typeof d[f] === 'string' ? (d[f] as string).trim() : filled(d[f]));
      if (from) patch[f] = from[f];
    }
    for (const group of [PHOTO, BROCHURE]) {
      if (group.some((f) => filled(keep[f]))) continue;
      const from = donors.find((d) => group.some((f) => filled(d[f])));
      if (from) for (const f of group) if (filled(from[f])) patch[f] = from[f];
    }
  }
  if (body!.combineRera !== false) {
    const seen = new Set<string>();
    const all: string[] = [];
    for (const d of [keep, ...merged]) {
      for (const part of String(d.rera_number ?? '').split(/[\s,;|]+/)) {
        const k = reraKey(part);
        if (k && !seen.has(k)) { seen.add(k); all.push(part.trim()); }
      }
    }
    if (all.length) patch.rera_number = all.join(' ');
  }
  const title = typeof body!.title === 'string' ? body!.title.trim() : '';
  if (title) patch.title = title;
  const stamp = new Date().toISOString();
  patch.merged_from = [
    ...(Array.isArray(keep.merged_from) ? keep.merged_from : []),
    ...merged.map((d) => ({ id: d.id, number: d.number ?? null, title: d.title ?? '', at: stamp })),
  ];

  const up = await runDbOp({ table: 'pins', action: 'update', filters: [{ op: 'eq', col: 'id', val: keepId }], values: patch }, true);
  if (up.error) return NextResponse.json({ data: null, error: up.error }, { status: 400 });

  // Mark each merged pin as a duplicate of the kept one (so Deleted pins says so), then delete it.
  for (const d of merged) {
    const id = String(d.id);
    const mark = await runDbOp({
      table: 'pins', action: 'update', filters: [{ op: 'eq', col: 'id', val: id }],
      values: { duplicate_of: keepId, hidden: true, hidden_at: stamp, hidden_reason: `merged-${stamp.slice(0, 10)}` },
    }, true);
    const del = mark.error ? mark : await runDbOp({ table: 'pins', action: 'delete', filters: [{ op: 'eq', col: 'id', val: id }] }, true);
    if (del.error) return NextResponse.json({ data: null, error: del.error }, { status: 400 });
  }
  return NextResponse.json({ data: { kept: keepId, merged: others.length, filled: Object.keys(patch).filter((k) => k !== 'merged_from') }, error: null });
}

export async function DELETE(req: NextRequest) {
  if (!(await hasPermission('map'))) {
    return NextResponse.json({ data: null, error: { message: 'Not authorized' } }, { status: 401 });
  }
  const id = req.nextUrl.searchParams.get('id') || '';
  if (!id) return NextResponse.json({ data: null, error: { message: 'id is required' } }, { status: 400 });
  const res = await runDbOp({ table: 'pins', action: 'delete', filters: [{ op: 'eq', col: 'id', val: id }] }, true);
  return NextResponse.json({ data: res.error ? null : { id }, error: res.error ?? null }, { status: res.error ? 400 : 200 });
}
