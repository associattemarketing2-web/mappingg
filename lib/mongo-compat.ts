import { randomUUID } from 'crypto';
import { query } from './pg';

// -----------------------------------------------------------------------------
// MongoDB-compatible layer over PostgreSQL JSONB.
//
// The app was written against the MongoDB driver (getDb().collection(name)...).
// Rather than rewrite 20+ call sites, this module reproduces the exact subset of
// that API the code uses, translated to parameterized SQL against tables shaped
// as `(id text primary key, doc jsonb)`. One table mirrors each old collection;
// the whole document lives in `doc` (its `_id` is dropped on write and re-added
// on read, so existing `clean()` helpers keep working).
//
// Supported, because that is all the code uses:
//   collection methods: find, findOne, insertOne, insertMany, updateOne,
//     updateMany, replaceOne, deleteOne, deleteMany, findOneAndUpdate,
//     countDocuments, createIndex (no-op)
//   cursor: sort, skip, limit, toArray
//   query operators: implicit-eq, $in, $ne, $exists, $regex, $or, $and, _id
//   update operators: $set, $inc, $setOnInsert (upsert only)
//   projection: inclusion ({f:1}) and exclusion ({f:0})
// Datasets are small (hundreds of rows); a GIN index per table keeps it fast.
// -----------------------------------------------------------------------------

// Tables that use the generic (id, doc) shape. `backups` and `partners_media`
// are special (binary columns) and handled by their own modules, not here.
export const DOC_TABLES = new Set([
  'pins', 'infra_markers', 'roads', 'area_boundaries', 'infra_types', 'map_settings',
  'leads', 'pins_history', 'users', 'builders', 'submission_links', 'project_submissions',
  'submission_events', 'projects', 'counters', 'posts', 'contact_leads',
]);

type Doc = Record<string, any>;
type Query = Record<string, any>;
type UpdateSpec = { $set?: Doc; $inc?: Record<string, number>; $setOnInsert?: Doc };

function assertTable(name: string): string {
  if (!DOC_TABLES.has(name)) {
    throw new Error(`[mongo-compat] unknown table "${name}"`);
  }
  return `"${name}"`;
}

/** Collects bind values and hands back the matching `$n` placeholder. */
class Params {
  readonly values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
  json(v: unknown): string {
    return `${this.add(JSON.stringify(v ?? null))}::jsonb`;
  }
  // A JSON *key* placeholder. Must be cast to text, otherwise `doc->$n` is an
  // ambiguous operator (jsonb->text vs jsonb->int) and Postgres rejects it.
  key(k: string): string {
    return `(${this.add(k)})::text`;
  }
}

function hasOps(v: unknown): v is Doc {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).some((k) => k.startsWith('$'));
}

function isScalar(v: unknown): v is string | number | boolean | null {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

// Tables whose primary key always equals String(doc.id): every write goes
// through db-engine (which sets _id = String(doc.id)) or uses the id as _id.
// Verified against the live data. NOT true for e.g. submission_events/counters,
// so those keep the plain document match.
const PK_IS_DOC_ID = new Set(['pins', 'infra_markers', 'roads', 'area_boundaries', 'infra_types', 'map_settings']);

/**
 * Scalar equality on a document key. Emitted as JSONB containment
 * (`doc @> {"k": v}`), which is semantically identical to `doc->'k' = v` for
 * scalars but can use the table's `jsonb_path_ops` GIN index — the old form
 * could not use any index, so every lookup scanned (and de-TOASTed) the table.
 * Arrays/objects keep exact equality (containment would differ for them).
 */
function eqClause(table: string, key: string, val: unknown, p: Params): string {
  if (!isScalar(val)) return `doc->${p.key(key)} = ${p.json(val)}`;
  const contains = `doc @> ${p.json({ [key]: val })}`;
  if (key === 'id' && val !== null && PK_IS_DOC_ID.has(table)) {
    // Primary-key index first; the containment check keeps the exact semantics.
    return `(id = ${p.add(String(val))} AND ${contains})`;
  }
  return contains;
}

/** Translate a Mongo query object into a SQL boolean expression. */
function buildWhere(q: Query, p: Params, table = ''): string {
  const clauses: string[] = [];
  for (const [key, val] of Object.entries(q || {})) {
    if (key === '$or' || key === '$and') {
      const parts = (val as Query[]).map((sub) => `(${buildWhere(sub, p, table)})`);
      if (!parts.length) { clauses.push('TRUE'); continue; }
      clauses.push(`(${parts.join(key === '$or' ? ' OR ' : ' AND ')})`);
    } else if (key === '_id') {
      clauses.push(`id = ${p.add(String(val))}`);
    } else if (hasOps(val)) {
      for (const [op, ov] of Object.entries(val)) {
        if (op === '$in') {
          const arr = ov as unknown[];
          if (!arr.length) { clauses.push('FALSE'); continue; }
          if (key === 'id' && PK_IS_DOC_ID.has(table) && arr.every((x) => typeof x === 'string' || typeof x === 'number')) {
            // Index-backed id IN (...) with the exact document check kept.
            clauses.push(`(id = ANY(${p.add(arr.map(String))}::text[]) AND doc->${p.key(key)} IN (${arr.map((x) => p.json(x)).join(', ')}))`);
          } else {
            clauses.push(`doc->${p.key(key)} IN (${arr.map((x) => p.json(x)).join(', ')})`);
          }
        } else if (op === '$ne') {
          clauses.push(`doc->${p.key(key)} IS DISTINCT FROM ${p.json(ov)}`);
        } else if (op === '$exists') {
          clauses.push(ov ? `jsonb_exists(doc, ${p.key(key)})` : `NOT jsonb_exists(doc, ${p.key(key)})`);
        } else if (op === '$regex') {
          const isRe = ov instanceof RegExp;
          const pattern = isRe ? (ov as RegExp).source : String(ov);
          const flags = isRe ? (ov as RegExp).flags : String((val as Doc).$options || '');
          clauses.push(`doc->>${p.key(key)} ${flags.includes('i') ? '~*' : '~'} ${p.add(pattern)}`);
        } else if (op === '$options') {
          // handled alongside $regex
        } else {
          clauses.push(`doc->${p.key(key)} = ${p.json(val)}`);
        }
      }
    } else {
      clauses.push(eqClause(table, key, val, p));
    }
  }
  return clauses.length ? clauses.join(' AND ') : 'TRUE';
}

/**
<<<<<<< HEAD
 * Inline images (base64 data: URLs, up to ~250 KB each) are replaced in the
 * result by `data:mg-digest;md5,<hex>` — their md5 computed INSIDE Postgres —
 * so a list query no longer drags megabytes of base64 from the database just
 * so lib/pin-media.ts can turn each one into a versioned /api/media URL.
 * The digest still starts with `data:`, so existing `startsWith('data:')`
 * checks keep working; it is never sent to a browser (callers convert it).
 */
export const MEDIA_DIGEST_PREFIX = 'data:mg-digest;md5,';

export interface MediaDigest {
  /** Top-level keys holding inline images. */
  fields?: readonly string[];
  /** Keys holding inline images inside a nested object (e.g. pins_history.row_data). */
  nested?: { field: string; keys: readonly string[] };
}

function digestOf(src: string, k: string): string {
  return `CASE WHEN left(${src}->>${k}, 5) = 'data:' THEN to_jsonb(${`'${MEDIA_DIGEST_PREFIX}'`} || md5(${src}->>${k})) END`;
}

/** Merges digests over `expr` for the given keys; keys that aren't inline images are left untouched. */
function overlayDigests(expr: string, src: string, keys: string[], p: Params): string {
  if (!keys.length) return expr;
  const pairs = keys.map((k) => { const kp = p.key(k); return `${kp}, ${digestOf(src, kp)}`; });
  return `(${expr} || jsonb_strip_nulls(jsonb_build_object(${pairs.join(', ')})))`;
}

/** SQL expression producing the (optionally projected) document to return. */
function projectExpr(projection: Doc | undefined, p: Params, digest?: MediaDigest): string {
  const entries = Object.entries(projection || {});
=======
 * For each of `mediaRefs` (image fields holding big base64 data: URLs), return a
 * short "media-ref:<hash>" marker instead of the image itself. The hash is
 * computed inside Postgres, so megabytes of image data never cross the network
 * just to be turned into an /api/media URL (see lib/pin-media.ts).
 */
function withMediaRefs(expr: string, mediaRefs: readonly string[] | undefined, included: (k: string) => boolean, p: Params): string {
  for (const k of mediaRefs || []) {
    if (!included(k)) continue;
    const key = p.key(k);
    expr = `(CASE WHEN left(doc->>${key}, 5) = 'data:' THEN jsonb_set(${expr}, ARRAY[${key}], to_jsonb('media-ref:' || left(md5(doc->>${key}), 12))) ELSE ${expr} END)`;
  }
  return expr;
}

/** SQL expression producing the (optionally projected) document to return. */
function projectExpr(projection: Doc | undefined, p: Params, mediaRefs?: readonly string[]): string {
  if (!projection) return withMediaRefs('doc', mediaRefs, () => true, p);
  const entries = Object.entries(projection);
>>>>>>> a1a147b5dd8036a22b7bdd4501dcec888e5b7954
  const include = entries.some(([, v]) => v === 1 || v === true);
  const media = new Set(digest?.fields || []);
  let expr: string;
  if (include) {
    const keys = new Set<string>(['id']); // always keep the primary key
    for (const [k, v] of entries) if (v === 1 || v === true) keys.add(k);
<<<<<<< HEAD
    const pairs = [...keys].map((k) => {
      const kp = p.key(k);
      return media.has(k) ? `${kp}, coalesce(${digestOf('doc', kp)}, doc->${kp})` : `${kp}, doc->${kp}`;
    });
    expr = `jsonb_build_object(${pairs.join(', ')})`;
  } else {
    expr = 'doc';
    const excluded = new Set<string>();
    for (const [k, v] of entries) if (v === 0 || v === false) { expr = `${expr} - ${p.key(k)}`; excluded.add(k); }
    expr = overlayDigests(expr, 'doc', [...media].filter((k) => !excluded.has(k)), p);
  }
  if (digest?.nested) {
    const f = p.key(digest.nested.field);
    const inner = overlayDigests(`(doc->${f})`, `(doc->${f})`, [...digest.nested.keys], p);
    expr = `CASE WHEN jsonb_typeof(${expr}->${f}) = 'object' THEN jsonb_set(${expr}, ARRAY[${f}], ${inner}) ELSE ${expr} END`;
  }
  return expr;
=======
    const pairs = [...keys].map((k) => `${p.key(k)}, doc->${p.key(k)}`);
    return withMediaRefs(`jsonb_build_object(${pairs.join(', ')})`, mediaRefs, (k) => keys.has(k), p);
  }
  let expr = 'doc';
  const excluded = new Set<string>();
  for (const [k, v] of entries) if (v === 0 || v === false) { expr = `${expr} - ${p.key(k)}`; excluded.add(k); }
  return withMediaRefs(expr, mediaRefs, (k) => !excluded.has(k), p);
>>>>>>> a1a147b5dd8036a22b7bdd4501dcec888e5b7954
}

function orderExpr(sort: Record<string, 1 | -1> | undefined, p: Params): string {
  if (!sort) return '';
  const parts = Object.entries(sort).map(
    ([k, dir]) => `doc->${p.key(k)} ${dir === 1 ? 'ASC' : 'DESC'} NULLS LAST`,
  );
  return parts.length ? ` ORDER BY ${parts.join(', ')}` : '';
}

/** Row shape coming back from SELECTs: the (projected) doc plus the pk. */
function reattachId(row: { d: Doc; id: string }): Doc {
  return { ...row.d, _id: row.id };
}

<<<<<<< HEAD
type FindOptions = { projection?: Doc; sort?: Record<string, 1 | -1>; mediaDigest?: MediaDigest };
=======
type FindOptions = { projection?: Doc; sort?: Record<string, 1 | -1>; mediaRefs?: readonly string[] };
>>>>>>> a1a147b5dd8036a22b7bdd4501dcec888e5b7954

class Cursor<T extends Doc = Doc> {
  private _sort?: Record<string, 1 | -1>;
  private _limit?: number;
  private _skip?: number;
  constructor(
    private table: string,
    private q: Query,
    private options: FindOptions = {},
  ) {
    this._sort = options.sort;
  }
  sort(spec: Record<string, 1 | -1>) { this._sort = spec; return this; }
  limit(n: number) { this._limit = n; return this; }
  skip(n: number) { this._skip = n; return this; }
  async toArray(): Promise<T[]> {
    const p = new Params();
<<<<<<< HEAD
    const sel = projectExpr(this.options.projection, p, this.options.mediaDigest);
    const where = buildWhere(this.q, p, this.table);
=======
    const sel = projectExpr(this.options.projection, p, this.options.mediaRefs);
    const where = buildWhere(this.q, p);
>>>>>>> a1a147b5dd8036a22b7bdd4501dcec888e5b7954
    let sql = `SELECT ${sel} AS d, id FROM ${assertTable(this.table)} WHERE ${where}`;
    sql += orderExpr(this._sort, p);
    if (this._limit != null) sql += ` LIMIT ${p.add(this._limit)}`;
    if (this._skip != null) sql += ` OFFSET ${p.add(this._skip)}`;
    const res = await query<{ d: Doc; id: string }>(sql, p.values);
    return res.rows.map(reattachId) as T[];
  }
}

/** Build the document inserted when an upsert/insert finds no existing row. */
function buildInsertDoc(seed: Doc, update?: UpdateSpec): Doc {
  const doc: Doc = { ...seed };
  if (update?.$setOnInsert) Object.assign(doc, update.$setOnInsert);
  if (update?.$set) Object.assign(doc, update.$set);
  if (update?.$inc) for (const [f, d] of Object.entries(update.$inc)) doc[f] = (Number(doc[f]) || 0) + d;
  return doc;
}

/** Plain equality fields from a query (ignoring operators), used to seed upserts. */
function eqSeed(q: Query): Doc {
  const seed: Doc = {};
  for (const [k, v] of Object.entries(q || {})) {
    if (k === '_id' || k === '$or' || k === '$and') continue;
    if (!hasOps(v)) seed[k] = v;
  }
  return seed;
}

/**
 * SQL expression that applies $set/$inc to a document column. `col` defaults to
 * the bare `doc`, but inside an ON CONFLICT DO UPDATE it must be table-qualified
 * (e.g. `"counters".doc`), otherwise `doc` is ambiguous (target vs EXCLUDED).
 */
function updateExpr(update: UpdateSpec, p: Params, col = 'doc'): string {
  let expr = col;
  if (update.$set) expr = `${expr} || ${p.json(update.$set)}`;
  if (update.$inc) {
    for (const [f, d] of Object.entries(update.$inc)) {
      const path = p.add([f]);
      const dv = p.add(d);
      expr = `jsonb_set(${expr}, ${path}::text[], to_jsonb(coalesce((${col}->>${p.key(f)})::numeric, 0) + ${dv}::numeric))`;
    }
  }
  return expr;
}

class Collection<T extends Doc = Doc> {
  constructor(private table: string) {}

  find(q: Query = {}, options: FindOptions = {}): Cursor<T> {
    return new Cursor<T>(this.table, q, options);
  }

  async findOne(q: Query = {}, options: FindOptions = {}): Promise<T | null> {
    const rows = await new Cursor<T>(this.table, q, options).limit(1).toArray();
    return rows[0] ?? null;
  }

  async countDocuments(q: Query = {}): Promise<number> {
    const p = new Params();
    const where = buildWhere(q, p, this.table);
    const res = await query<{ n: string }>(
      `SELECT count(*)::int AS n FROM ${assertTable(this.table)} WHERE ${where}`,
      p.values,
    );
    return Number(res.rows[0]?.n || 0);
  }

  private pkOf(doc: Doc): string {
    return String(doc._id ?? doc.id ?? randomUUID());
  }

  private strip(doc: Doc): Doc {
    const pk = this.pkOf(doc);
    const { _id, ...rest } = doc;
    if (rest.id == null) rest.id = pk;
    return rest;
  }

  async insertOne(doc: Doc): Promise<{ insertedId: string }> {
    const pk = this.pkOf(doc);
    const body = this.strip(doc);
    await query(
      `INSERT INTO ${assertTable(this.table)} (id, doc) VALUES ($1, $2::jsonb)`,
      [pk, JSON.stringify(body)],
    );
    return { insertedId: pk };
  }

  async insertMany(docs: Doc[]): Promise<{ insertedCount: number }> {
    if (!docs.length) return { insertedCount: 0 };
    const p = new Params();
    const rows = docs.map((d) => `(${p.add(this.pkOf(d))}, ${p.json(this.strip(d))})`);
    await query(
      `INSERT INTO ${assertTable(this.table)} (id, doc) VALUES ${rows.join(', ')}`,
      p.values,
    );
    return { insertedCount: docs.length };
  }

  private async runUpdate(q: Query, update: UpdateSpec, limitOne: boolean): Promise<number> {
    const p = new Params();
    const setExpr = updateExpr(update, p);
    const where = buildWhere(q, p, this.table);
    const t = assertTable(this.table);
    const sql = limitOne
      ? `UPDATE ${t} SET doc = ${setExpr} WHERE id IN (SELECT id FROM ${t} WHERE ${where} LIMIT 1)`
      : `UPDATE ${t} SET doc = ${setExpr} WHERE ${where}`;
    const res = await query(sql, p.values);
    return res.rowCount || 0;
  }

  async updateMany(q: Query, update: UpdateSpec): Promise<{ matchedCount: number; modifiedCount: number }> {
    const n = await this.runUpdate(q, update, false);
    return { matchedCount: n, modifiedCount: n };
  }

  async updateOne(
    q: Query,
    update: UpdateSpec,
    options: { upsert?: boolean } = {},
  ): Promise<{ matchedCount: number; modifiedCount: number; upsertedId: string | null }> {
    const n = await this.runUpdate(q, update, true);
    if (n === 0 && options.upsert) {
      const seed = { ...eqSeed(q), ...(q._id != null ? { _id: q._id } : {}) };
      const doc = buildInsertDoc(seed, update);
      const { insertedId } = await this.insertOne(doc);
      return { matchedCount: 0, modifiedCount: 0, upsertedId: insertedId };
    }
    return { matchedCount: n, modifiedCount: n, upsertedId: null };
  }

  async replaceOne(
    q: Query,
    doc: Doc,
    options: { upsert?: boolean } = {},
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    const pk = q._id != null ? String(q._id) : this.pkOf(doc);
    const body = this.strip({ ...doc, _id: pk });
    if (options.upsert) {
      await query(
        `INSERT INTO ${assertTable(this.table)} (id, doc) VALUES ($1, $2::jsonb)
         ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc`,
        [pk, JSON.stringify(body)],
      );
      return { matchedCount: 1, modifiedCount: 1 };
    }
    const res = await query(
      `UPDATE ${assertTable(this.table)} SET doc = $2::jsonb WHERE id = $1`,
      [pk, JSON.stringify(body)],
    );
    return { matchedCount: res.rowCount || 0, modifiedCount: res.rowCount || 0 };
  }

  async findOneAndUpdate(
    q: Query,
    update: UpdateSpec,
    options: { upsert?: boolean; returnDocument?: 'before' | 'after' } = {},
  ): Promise<T | null> {
    const pk = q._id != null ? String(q._id) : (eqSeed(q).id != null ? String(eqSeed(q).id) : null);
    if (pk != null && options.upsert) {
      // Fast path for the counters pattern: upsert by primary key, return after.
      const p = new Params();
      const seed = buildInsertDoc({ ...eqSeed(q), _id: pk }, update);
      const idP = p.add(pk);
      const docP = p.json(this.strip({ ...seed, _id: pk }));
      const t = assertTable(this.table);
      const setExpr = updateExpr(update, p, `${t}.doc`);
      const res = await query<{ d: Doc; id: string }>(
        `INSERT INTO ${t} (id, doc) VALUES (${idP}, ${docP})
         ON CONFLICT (id) DO UPDATE SET doc = ${setExpr}
         RETURNING ${t}.doc AS d, ${t}.id`,
        p.values,
      );
      return (res.rows[0] ? reattachId(res.rows[0]) : null) as T | null;
    }
    // General path: update the matching row, then read it back.
    await this.runUpdate(q, update, true);
    return this.findOne(q);
  }

  async deleteOne(q: Query): Promise<{ deletedCount: number }> {
    const p = new Params();
    const where = buildWhere(q, p, this.table);
    const t = assertTable(this.table);
    const res = await query(
      `DELETE FROM ${t} WHERE id IN (SELECT id FROM ${t} WHERE ${where} LIMIT 1)`,
      p.values,
    );
    return { deletedCount: res.rowCount || 0 };
  }

  async deleteMany(q: Query): Promise<{ deletedCount: number }> {
    const p = new Params();
    const where = buildWhere(q, p, this.table);
    const res = await query(`DELETE FROM ${assertTable(this.table)} WHERE ${where}`, p.values);
    return { deletedCount: res.rowCount || 0 };
  }

  // The old code created Mongo indexes lazily; our indexes live in the schema,
  // so this is a no-op that accepts (and ignores) the old index arguments.
  async createIndex(_keys?: unknown, _options?: unknown): Promise<string> { return 'noop'; }
}

export interface Db {
  collection<T extends Doc = Doc>(name: string): Collection<T>;
}

const db: Db = {
  collection<T extends Doc = Doc>(name: string) {
    return new Collection<T>(name);
  },
};

/** Drop-in replacement for the old Mongo getDb(). */
export async function getDb(): Promise<Db> {
  return db;
}
