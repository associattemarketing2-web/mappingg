import { randomUUID, randomBytes } from 'crypto';
import { getDb, type Db } from './mongodb';

// =============================================================================
// Partners intake engine (MongoDB)
// -----------------------------------------------------------------------------
// Reproduces, on MongoDB, the Supabase schema + RPCs + triggers the original
// "partners.mappingg.com" intake app relied on. The browser app runs verbatim
// against partners-shim.js, which serialises every call into one of:
//   - a generic db op    -> runPartnersDb()          (/api/partners/db)
//   - an RPC             -> RPCS[name]()             (/api/partners/rpc/[name])
//   - a storage/fn call  -> handled by their routes
//
// Collections (mirror the old Postgres tables 1:1, string uuid _id === id):
//   builders, project_submissions, submission_links, submission_events,
//   projects, counters
// =============================================================================

type AnyDoc = { _id: string; [k: string]: any };
function coll(db: Db, name: string) { return db.collection<AnyDoc>(name); }
const now = () => new Date().toISOString();
const genId = () => randomUUID();

export const PARTNER_TABLES = new Set([
  'builders', 'project_submissions', 'submission_links', 'submission_events', 'projects',
]);

function clean<T extends Record<string, any>>(doc: T | null): T | null {
  if (!doc) return doc;
  const { _id, ...rest } = doc as Record<string, any>;
  return rest as T;
}

// ------------------------------------------------------------------ sequences
async function nextSeq(db: Db, key: string): Promise<number> {
  // mongodb driver v6 returns the updated document directly (no ModifyResult
  // wrapper), so the counter lives at doc.value.
  const doc = await coll(db, 'counters').findOneAndUpdate(
    { _id: key },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  return ((doc as any) && (doc as any).value) || 1;
}

function pad(n: number, width: number) { return String(n).padStart(width, '0'); }

async function genBuilderCode(db: Db, companyName: string): Promise<string> {
  const prefix = (String(companyName || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)) || 'BLDR';
  const seq = await nextSeq(db, 'builder_code');
  return `${prefix}-${pad(seq, 3)}`;
}
async function genRefCode(db: Db): Promise<string> {
  const seq = await nextSeq(db, 'submission_ref');
  return `MAP-SUB-${pad(seq, 5)}`;
}
async function genLinkTag(db: Db): Promise<string> {
  const seq = await nextSeq(db, 'link_tag');
  return `LNK-${pad(seq, 4)}`;
}
function genToken(): string {
  // url-safe, ~22 chars
  return randomBytes(18).toString('base64').replace(/[+/=]/g, '').slice(0, 22);
}

function slugify(s: string): string {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'project';
}
async function uniqueSlug(db: Db, base: string, ownId?: string): Promise<string> {
  let slug = slugify(base);
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const hit = await coll(db, 'projects').findOne({ slug });
    if (!hit || hit.id === ownId) return slug;
    i += 1;
    slug = `${slugify(base)}-${i}`;
  }
}

// --------------------------------------------------------------------- events
type Actor = 'admin' | 'builder' | 'system';
async function logEvent(db: Db, submissionId: string, action: string, actor: Actor, details: any = {}) {
  await coll(db, 'submission_events').insertOne({
    _id: genId(), id: genId(), submission_id: submissionId, action, actor, details, created_at: now(),
  } as AnyDoc);
}

// ------------------------------------------------------------- embedded joins
// Relationship map for the handful of embedded selects the app issues, e.g.
// project_submissions.select('*, builder:builders(...), link:submission_links(...)')
type Rel = { table: string; local: string; foreign: string; many: boolean };
const JOINS: Record<string, Record<string, Rel>> = {
  project_submissions: {
    builder: { table: 'builders', local: 'builder_id', foreign: 'id', many: false },
    link: { table: 'submission_links', local: 'link_id', foreign: 'id', many: false },
  },
  builders: {
    links: { table: 'submission_links', local: 'id', foreign: 'builder_id', many: true },
    subs: { table: 'project_submissions', local: 'id', foreign: 'builder_id', many: true },
  },
};

// Split a PostgREST-style select list at top level, respecting parentheses.
function splitSelect(columns: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = '';
  for (const ch of columns) {
    if (ch === '(') { depth++; cur += ch; }
    else if (ch === ')') { depth--; cur += ch; }
    else if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

type Embed = { alias: string; cols: string };
function parseEmbeds(columns: string | undefined): Embed[] {
  if (!columns || columns === '*') return [];
  const embeds: Embed[] = [];
  for (const seg of splitSelect(columns)) {
    const m = /^([a-z0-9_]+)\s*(?::\s*([a-z0-9_]+))?\s*\((.*)\)$/i.exec(seg);
    if (m) embeds.push({ alias: m[2] ? m[1] : m[1], cols: m[3] });
  }
  return embeds;
}

async function attachJoins(db: Db, table: string, rows: AnyDoc[], columns?: string): Promise<AnyDoc[]> {
  const embeds = parseEmbeds(columns);
  const relMap = JOINS[table] || {};
  for (const e of embeds) {
    const rel = relMap[e.alias];
    if (!rel) { rows.forEach((r) => { r[e.alias] = null; }); continue; }
    const keys = Array.from(new Set(rows.map((r) => r[rel.local]).filter((v) => v != null)));
    if (!keys.length) { rows.forEach((r) => { r[e.alias] = rel.many ? [] : null; }); continue; }
    const related = (await coll(db, rel.table).find({ [rel.foreign]: { $in: keys } }).toArray())
      .map((d) => clean(d as AnyDoc)!);
    if (rel.many) {
      const grouped = new Map<any, any[]>();
      for (const rr of related) {
        const k = (rr as any)[rel.foreign];
        if (!grouped.has(k)) grouped.set(k, []);
        grouped.get(k)!.push(rr);
      }
      rows.forEach((r) => { r[e.alias] = grouped.get(r[rel.local]) || []; });
    } else {
      const byKey = new Map(related.map((rr) => [(rr as any)[rel.foreign], rr]));
      rows.forEach((r) => { r[e.alias] = byKey.get(r[rel.local]) || null; });
    }
  }
  return rows;
}

// ------------------------------------------------------------- generic db ops
export type Filter = { op: 'eq'; col: string; val: unknown } | { op: 'in'; col: string; vals: unknown[] };
export interface DbOp {
  table: string;
  action: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  columns?: string;
  filters?: Filter[];
  order?: { col: string; ascending: boolean };
  limit?: number;
  single?: boolean;
  values?: Record<string, unknown> | Record<string, unknown>[];
  returning?: boolean;
}
export interface DbResult { data: unknown; error: { message: string; code?: string } | null; status: number; }
const err = (message: string, status: number, code?: string): DbResult => ({ data: null, error: { message, code }, status });

function buildQuery(filters?: Filter[]): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  for (const f of filters || []) {
    if (f.op === 'eq') q[f.col] = f.val;
    else if (f.op === 'in') q[f.col] = { $in: f.vals };
  }
  return q;
}

async function prepareInsertDoc(db: Db, table: string, v: Record<string, any>): Promise<AnyDoc> {
  const doc: Record<string, any> = { ...v };
  if (doc.id == null) doc.id = genId();
  doc._id = String(doc.id);
  if (doc.created_at == null) doc.created_at = now();
  doc.updated_at = now();

  if (table === 'project_submissions') {
    if (!doc.ref_code) doc.ref_code = await genRefCode(db);
    if (!doc.status) doc.status = 'draft';
    if (!doc.source) doc.source = 'admin';
    if (doc.flags == null) doc.flags = {};
    if (doc.has_unpublished_changes == null) doc.has_unpublished_changes = false;
  } else if (table === 'builders') {
    if (!doc.code) doc.code = await genBuilderCode(db, doc.company_name || '');
    if (!doc.country) doc.country = 'India';
  } else if (table === 'submission_links') {
    if (!doc.token) doc.token = genToken();
    if (!doc.tag) doc.tag = await genLinkTag(db);
    if (doc.is_active == null) doc.is_active = true;
    if (doc.open_count == null) doc.open_count = 0;
  }
  return doc as AnyDoc;
}

export async function runPartnersDb(op: DbOp): Promise<DbResult> {
  if (!PARTNER_TABLES.has(op.table)) return err('Unknown table', 400);
  const db = await getDb();
  const c = coll(db, op.table);
  try {
    switch (op.action) {
      case 'select': {
        const query = buildQuery(op.filters);
        let cursor = c.find(query);
        if (op.order) cursor = cursor.sort({ [op.order.col]: op.order.ascending ? 1 : -1 });
        if (op.limit != null) cursor = cursor.limit(op.limit);
        let rows = (await cursor.toArray()).map((d) => clean(d as AnyDoc)!) as AnyDoc[];
        rows = await attachJoins(db, op.table, rows, op.columns);
        if (op.single) {
          if (!rows.length) return err('No rows found', 406, 'PGRST116');
          return { data: rows[0], error: null, status: 200 };
        }
        return { data: rows, error: null, status: 200 };
      }
      case 'insert': {
        const input = Array.isArray(op.values) ? op.values : [op.values || {}];
        const docs: AnyDoc[] = [];
        for (const v of input) docs.push(await prepareInsertDoc(db, op.table, v as Record<string, any>));
        await c.insertMany(docs);
        if (op.table === 'project_submissions') {
          for (const d of docs) {
            const actor: Actor = d.source === 'link' ? 'builder' : 'admin';
            await logEvent(db, d.id, 'created', actor, { source: d.source });
          }
        }
        if (op.returning || op.single) {
          const out = docs.map((d) => clean(d));
          return { data: op.single ? out[0] : out, error: null, status: 201 };
        }
        return { data: null, error: null, status: 201 };
      }
      case 'update': {
        const query = buildQuery(op.filters);
        const patch = { ...(op.values as Record<string, any>) };
        delete patch.id; delete patch._id;
        patch.updated_at = now();

        if (op.table === 'project_submissions') {
          const affected = await c.find(query).toArray();
          for (const existing of affected) {
            const changed: Record<string, unknown> = {};
            for (const [k, nv] of Object.entries(patch)) {
              if (k === 'updated_at' || k === 'flags') continue;
              if (JSON.stringify((existing as any)[k]) !== JSON.stringify(nv)) changed[k] = nv;
            }
            if (Object.keys(changed).length) await logEvent(db, (existing as any).id, 'edited', 'admin', changed);
          }
        }
        await c.updateMany(query, { $set: patch });
        if (op.returning || op.single) {
          let rows = (await c.find(query).toArray()).map((d) => clean(d as AnyDoc)!) as AnyDoc[];
          rows = await attachJoins(db, op.table, rows, op.columns);
          return { data: op.single ? rows[0] ?? null : rows, error: null, status: 200 };
        }
        return { data: null, error: null, status: 200 };
      }
      case 'delete': {
        await c.deleteMany(buildQuery(op.filters));
        return { data: null, error: null, status: 200 };
      }
      case 'upsert': {
        const input = Array.isArray(op.values) ? op.values : [op.values || {}];
        for (const v of input) {
          const doc = await prepareInsertDoc(db, op.table, v as Record<string, any>);
          await c.replaceOne({ _id: doc._id }, doc, { upsert: true });
        }
        return { data: null, error: null, status: 200 };
      }
      default:
        return err('Unsupported action', 400);
    }
  } catch (e) {
    console.error('[partners-engine]', op.table, op.action, e);
    return err('Database error', 500);
  }
}

// ================================================================= RPCs =======
export interface RpcCtx { authed: boolean; userEmail?: string | null; }
type RpcFn = (params: any, ctx: RpcCtx) => Promise<DbResult>;

function formatPrice(sub: any): string {
  if (sub.price_on_request) return 'Price on request';
  const sym: Record<string, string> = { INR: '₹', AED: 'AED', USD: '$', GBP: '£', EUR: '€' };
  const s = sym[sub.currency || 'INR'] || (sub.currency || '');
  const unit: Record<string, string> = { Crore: 'Cr', Lakh: 'L', Million: 'M', Thousand: 'K' };
  const u = unit[sub.price_unit as string] || (sub.price_unit || '');
  const a = sub.price_min, b = sub.price_max;
  if (a == null && b == null) return '';
  if (a != null && b != null && +a !== +b) return `${s} ${+a} – ${+b} ${u}`.trim();
  return `${s} ${+(a ?? b)} ${u}${b == null ? ' onwards' : ''}`.trim();
}

const BUILDER_KEYS = [
  'project_name', 'project_type', 'construction_status', 'sales_status', 'developer_name',
  'country', 'state', 'city', 'locality', 'address', 'google_maps_link',
  'currency', 'price_min', 'price_max', 'price_unit', 'price_on_request',
  'configurations', 'area_unit', 'carpet_area_min', 'carpet_area_max',
  'launch_date', 'possession_date_rera', 'possession_date_target', 'rera_numbers',
  'key_usps', 'youtube_url', 'cover_image_path', 'gallery_paths', 'brochure_path',
  'rera_qr_path', 'media_folder_link', 'additional_details', 'builder_remarks',
  'lat', 'lng', 'declaration_accepted',
];

async function findActiveLink(db: Db, token: string) {
  if (!token) return null;
  const link = await coll(db, 'submission_links').findOne({ token });
  return link ? (clean(link as AnyDoc) as any) : null;
}
function linkError(link: any): string | null {
  if (!link) return 'This link could not be found. Ask the Mappingg team for a new one.';
  if (!link.is_active) return 'This link has been switched off. Please contact the Mappingg team.';
  if (link.expires_at && new Date(link.expires_at) < new Date()) return 'This link has expired. Please ask the Mappingg team for a new one.';
  return null;
}

const RPCS: Record<string, RpcFn> = {
  // -------------------------------------------------------------- is_admin
  async is_admin(_p, ctx) {
    return { data: !!ctx.authed, error: null, status: 200 };
  },

  // -------------------------------------------------------------- admin_counts
  async admin_counts(_p, _ctx) {
    const db = await getDb();
    const subs = await coll(db, 'project_submissions').find({}, { projection: { status: 1, has_unpublished_changes: 1 } }).toArray();
    const by_status: Record<string, number> = {};
    let pending_updates = 0;
    for (const s of subs) {
      const st = (s as any).status || 'draft';
      by_status[st] = (by_status[st] || 0) + 1;
      if ((s as any).has_unpublished_changes) pending_updates += 1;
    }
    const builders = await coll(db, 'builders').countDocuments({});
    const live = await coll(db, 'projects').countDocuments({ is_live: true });
    const links = await coll(db, 'submission_links').find({ is_active: true }).toArray();
    const nowTs = Date.now();
    const active_links = links.filter((l) => !(l as any).expires_at || new Date((l as any).expires_at).getTime() > nowTs).length;
    return { data: { by_status, builders, live, pending_updates, active_links }, error: null, status: 200 };
  },

  // -------------------------------------------------------- admin_set_status
  async admin_set_status(p, _ctx) {
    const db = await getDb();
    const c = coll(db, 'project_submissions');
    const sub = await c.findOne({ id: p.p_id });
    if (!sub) return err('Submission not found', 404);
    const from = (sub as any).status;
    await c.updateOne({ id: p.p_id }, { $set: { status: p.p_status, updated_at: now() } });
    await logEvent(db, p.p_id, 'status_changed', 'admin', { from, to: p.p_status, note: p.p_note || null });
    if (p.p_note) await logEvent(db, p.p_id, 'note', 'admin', { note: p.p_note });
    const updated = clean(await c.findOne({ id: p.p_id }) as AnyDoc);
    return { data: updated, error: null, status: 200 };
  },

  // ---------------------------------------------------- admin_request_changes
  async admin_request_changes(p, _ctx) {
    const db = await getDb();
    const c = coll(db, 'project_submissions');
    const sub = await c.findOne({ id: p.p_id });
    if (!sub) return err('Submission not found', 404);
    await c.updateOne({ id: p.p_id }, {
      $set: {
        status: 'changes_requested',
        flags: p.p_flags || {},
        previous_flags: p.p_flags || {},
        change_request_message: p.p_message || null,
        updated_at: now(),
      },
    });
    await logEvent(db, p.p_id, 'changes_requested', 'admin', { flags: p.p_flags || {}, message: p.p_message || null });
    return { data: true, error: null, status: 200 };
  },

  // -------------------------------------------------------------- admin_publish
  async admin_publish(p, _ctx) {
    const db = await getDb();
    const c = coll(db, 'project_submissions');
    const sub = clean(await c.findOne({ id: p.p_id }) as AnyDoc) as any;
    if (!sub) return err('Submission not found', 404);
    if (!sub.project_name) return err('Project name is required before publishing.', 422);

    const media = p.p_media || {};
    const projectId = sub.published_project_id || genId();
    const existingProject = await coll(db, 'projects').findOne({ id: projectId });
    const slug = sub.slug || (existingProject as any)?.slug || (await uniqueSlug(db, `${sub.project_name}-${sub.city || ''}`, projectId));
    const nowTs = now();

    const projectDoc: AnyDoc = {
      _id: projectId, id: projectId, submission_id: sub.id, slug, is_live: true,
      featured: !!sub.featured,
      project_name: sub.project_name, project_type: sub.project_type,
      developer_name: sub.developer_name,
      construction_status: sub.construction_status, sales_status: sub.sales_status,
      country: sub.country, state: sub.state, city: sub.city, locality: sub.locality, address: sub.address,
      lat: sub.lat ?? null, lng: sub.lng ?? null,
      currency: sub.currency, price_min: sub.price_min ?? null, price_max: sub.price_max ?? null,
      price_unit: sub.price_unit, price_on_request: !!sub.price_on_request, price_label: formatPrice(sub),
      configurations: sub.configurations || [], area_unit: sub.area_unit,
      carpet_area_min: sub.carpet_area_min ?? null, carpet_area_max: sub.carpet_area_max ?? null,
      launch_date: sub.launch_date, possession_date_rera: sub.possession_date_rera, possession_date_target: sub.possession_date_target,
      rera_numbers: sub.rera_numbers || [], rera_verified_on: sub.rera_verified_on || null,
      short_description: sub.short_description, key_usps: sub.key_usps, amenities: sub.amenities || [],
      green_certification: sub.green_certification, green_rating: sub.green_rating,
      land_area_acres: sub.land_area_acres ?? null, towers: sub.towers ?? null, floors: sub.floors ?? null, total_units: sub.total_units ?? null,
      sales_contact_name: sub.sales_contact_name, sales_contact_phone: sub.sales_contact_phone,
      youtube_url: sub.youtube_url, media_folder_link: sub.media_folder_link,
      cover_image_url: media.cover_image_url || null, gallery_urls: media.gallery_urls || [],
      brochure_url: media.brochure_url || null, rera_qr_url: media.rera_qr_url || null,
      additional_details: sub.additional_details || [],
      published_at: (existingProject as any)?.published_at || nowTs, updated_at: nowTs,
    };
    await coll(db, 'projects').replaceOne({ _id: projectId }, projectDoc, { upsert: true });

    await c.updateOne({ id: sub.id }, {
      $set: {
        status: 'published', published_project_id: projectId, published_at: nowTs,
        has_unpublished_changes: false, flags: {}, slug, updated_at: nowTs,
      },
    });
    await logEvent(db, sub.id, 'published', 'admin', {});
    return { data: { project_id: projectId }, error: null, status: 200 };
  },

  // ------------------------------------------------------------ admin_unpublish
  async admin_unpublish(p, _ctx) {
    const db = await getDb();
    const c = coll(db, 'project_submissions');
    const sub = await c.findOne({ id: p.p_id });
    if (!sub) return err('Submission not found', 404);
    const pid = (sub as any).published_project_id;
    if (pid) await coll(db, 'projects').updateOne({ id: pid }, { $set: { is_live: false, updated_at: now() } });
    await c.updateOne({ id: p.p_id }, { $set: { updated_at: now() } });
    await logEvent(db, p.p_id, 'unpublished', 'admin', { note: p.p_note || null });
    return { data: true, error: null, status: 200 };
  },

  // --------------------------------------------------------- admin_find_duplicates
  async admin_find_duplicates(p, _ctx) {
    const db = await getDb();
    const sub = clean(await coll(db, 'project_submissions').findOne({ id: p.p_id }) as AnyDoc) as any;
    if (!sub) return { data: [], error: null, status: 200 };
    const name = (sub.project_name || '').trim();
    const rera: string[] = Array.isArray(sub.rera_numbers) ? sub.rera_numbers : [];
    const out: any[] = [];

    const nameRe = name ? new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') : null;
    const subOr: any[] = [];
    if (nameRe) subOr.push({ project_name: { $regex: nameRe } });
    if (rera.length) subOr.push({ rera_numbers: { $in: rera } });
    if (subOr.length) {
      const subs = await coll(db, 'project_submissions').find({ id: { $ne: p.p_id }, $or: subOr }).limit(10).toArray();
      for (const s of subs) {
        const sc = clean(s as AnyDoc) as any;
        const reason = nameRe && nameRe.test(sc.project_name || '') ? 'Same project name' : 'Shared RERA number';
        out.push({ id: sc.id, name: sc.project_name, city: sc.city, reason, kind: 'submission', ref: sc.ref_code, status: sc.status });
      }
      const projs = await coll(db, 'projects').find({ submission_id: { $ne: p.p_id }, $or: subOr }).limit(10).toArray();
      for (const pr of projs) {
        const pc = clean(pr as AnyDoc) as any;
        const reason = nameRe && nameRe.test(pc.project_name || '') ? 'Same project name' : 'Shared RERA number';
        out.push({ id: pc.id, name: pc.project_name, city: pc.city, reason, kind: 'project', ref: pc.slug, status: pc.is_live ? 'live' : 'offline' });
      }
    }
    return { data: out.slice(0, 12), error: null, status: 200 };
  },

  // ------------------------------------------------------- admin_regenerate_link
  async admin_regenerate_link(p, _ctx) {
    const db = await getDb();
    const c = coll(db, 'submission_links');
    const link = await c.findOne({ id: p.p_link_id });
    if (!link) return err('Link not found', 404);
    await c.updateOne({ id: p.p_link_id }, {
      $set: {
        token: genToken(), is_active: true, open_count: 0,
        first_opened_at: null, last_opened_at: null, updated_at: now(),
      },
    });
    const updated = clean(await c.findOne({ id: p.p_link_id }) as AnyDoc);
    return { data: updated, error: null, status: 200 };
  },

  // -------------------------------------------------------------- link_open
  async link_open(p, _ctx) {
    const db = await getDb();
    const link = await findActiveLink(db, p.p_token);
    const e = linkError(link);
    if (e) return { data: null, error: { message: `LINK_INVALID: ${e}` }, status: 403 };

    const nowTs = now();
    await coll(db, 'submission_links').updateOne({ id: link.id }, {
      $set: { last_opened_at: nowTs, last_activity_at: nowTs, updated_at: nowTs, ...(link.first_opened_at ? {} : { first_opened_at: nowTs }) },
      $inc: { open_count: 1 },
    });
    const builder = clean(await coll(db, 'builders').findOne({ id: link.builder_id }) as AnyDoc);
    const subs = (await coll(db, 'project_submissions').find({ builder_id: link.builder_id })
      .sort({ updated_at: -1 }).toArray()).map((d) => clean(d as AnyDoc));
    const linkOut = clean(await coll(db, 'submission_links').findOne({ id: link.id }) as AnyDoc);
    return { data: { link: linkOut, builder, submissions: subs }, error: null, status: 200 };
  },

  // ------------------------------------------------------- link_save_submission
  async link_save_submission(p, _ctx) {
    const db = await getDb();
    const link = await findActiveLink(db, p.p_token);
    const e = linkError(link);
    if (e) return { data: null, error: { message: `LINK_INVALID: ${e}` }, status: 403 };

    const c = coll(db, 'project_submissions');
    const data: Record<string, any> = {};
    for (const k of BUILDER_KEYS) if (k in (p.p_data || {})) data[k] = p.p_data[k];

    let sub: any;
    if (p.p_id) {
      sub = clean(await c.findOne({ id: p.p_id }) as AnyDoc);
      if (!sub || sub.builder_id !== link.builder_id) return err('This project is not available on your link.', 403);
      const editable = ['draft', 'changes_requested', 'published'].includes(sub.status);
      if (!editable) return err('This project is being reviewed and cannot be edited right now.', 409);
    }

    const nowTs = now();
    if (!sub) {
      const doc = await prepareInsertDoc(db, 'project_submissions', {
        ...data, source: 'link', status: 'draft', builder_id: link.builder_id, link_id: link.id,
      });
      await c.insertOne(doc);
      await logEvent(db, doc.id, 'created', 'builder', { source: 'link' });
      sub = clean(doc);
    } else {
      await c.updateOne({ id: sub.id }, { $set: { ...data, link_id: sub.link_id || link.id, updated_at: nowTs } });
      await logEvent(db, sub.id, 'edited', 'builder', data);
      sub = clean(await c.findOne({ id: sub.id }) as AnyDoc);
    }

    if (p.p_submit) {
      const wasPublished = sub.status === 'published' || !!sub.published_project_id;
      const patch: Record<string, any> = {
        status: 'submitted', submitted_at: nowTs, flags: {}, updated_at: nowTs,
      };
      if (wasPublished) patch.has_unpublished_changes = true;
      await c.updateOne({ id: sub.id }, { $set: patch });
      await logEvent(db, sub.id, 'status_changed', 'builder', { from: sub.status, to: 'submitted' });
      sub = clean(await c.findOne({ id: sub.id }) as AnyDoc);
    }

    await coll(db, 'submission_links').updateOne({ id: link.id }, { $set: { last_activity_at: nowTs, updated_at: nowTs } });
    return { data: sub, error: null, status: 200 };
  },

  // --------------------------------------------------------- link_delete_draft
  async link_delete_draft(p, _ctx) {
    const db = await getDb();
    const link = await findActiveLink(db, p.p_token);
    const e = linkError(link);
    if (e) return { data: null, error: { message: `LINK_INVALID: ${e}` }, status: 403 };
    const c = coll(db, 'project_submissions');
    const sub = await c.findOne({ id: p.p_id });
    if (!sub || (sub as any).builder_id !== link.builder_id) return err('Draft not found.', 404);
    if ((sub as any).status !== 'draft') return err('Only drafts can be deleted.', 409);
    await c.deleteOne({ id: p.p_id });
    await coll(db, 'submission_events').deleteMany({ submission_id: p.p_id });
    return { data: true, error: null, status: 200 };
  },
};

export const ADMIN_RPCS = new Set([
  'is_admin', 'admin_counts', 'admin_set_status', 'admin_request_changes', 'admin_publish',
  'admin_unpublish', 'admin_find_duplicates', 'admin_regenerate_link',
]);
export const PUBLIC_RPCS = new Set(['link_open', 'link_save_submission', 'link_delete_draft']);

export async function runPartnersRpc(name: string, params: any, ctx: RpcCtx): Promise<DbResult> {
  const fn = RPCS[name];
  if (!fn) return err('Unknown function', 404);
  return fn(params, ctx);
}

// A builder (no login) proves ownership of an upload target by supplying a
// valid active link token whose builder owns the submission path.
export async function tokenIsValid(token: string | null): Promise<boolean> {
  if (!token) return false;
  const db = await getDb();
  const link = await findActiveLink(db, token);
  return !linkError(link);
}
