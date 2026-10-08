import { createHash, randomUUID } from 'node:crypto';
import dns from 'node:dns';
import { MongoClient, type Db as MongoDb, type Document } from 'mongodb';
import { getDb as getPgDb, MEDIA_DIGEST_PREFIX, type Db, type MediaDigest } from './mongo-compat';

export type { Db } from './mongo-compat';

// Data layer switch. Every call site uses `getDb()` with the MongoDB driver's
// API, so the same code runs on either backend:
//   - PostgreSQL by default (lib/mongo-compat.ts, the Mongo-compatible layer)
//   - MongoDB    only when DB_PROVIDER=mongodb is set explicitly
// A stray MONGODB_URI alone no longer switches the app off Postgres.
// The few modules that used raw SQL check `usingMongo()` and have a Mongo path.

export function usingMongo(): boolean {
  const p = (process.env.DB_PROVIDER || '').toLowerCase();
  return p === 'mongodb' || p === 'mongo';
}

// Atlas SRV lookups fail on some networks whose only DNS server is loopback.
const isLoopback = (s: string) => s === '::1' || s.startsWith('127.');
function fixDns() {
  try {
    if (dns.getServers().every(isLoopback)) {
      dns.setServers(['8.8.8.8', '1.1.1.1']);
      dns.promises.setServers(['8.8.8.8', '1.1.1.1']);
    }
  } catch { /* keep the system resolver */ }
}

declare global {
  // eslint-disable-next-line no-var
  var _mongoClient: Promise<MongoClient> | undefined;
}

/** The raw MongoDB database (one pooled client per server process). */
export async function getMongoDb(): Promise<MongoDb> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  if (!global._mongoClient) {
    fixDns();
    global._mongoClient = new MongoClient(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
    }).connect().catch((e) => { global._mongoClient = undefined; throw e; });
  }
  return (await global._mongoClient).db(process.env.MONGODB_DB || 'mappingg');
}

/* ------------------------------------------------------------------------- */
/* Inline-image fingerprints (parity with the Postgres layer)                */
/* ------------------------------------------------------------------------- */
// Postgres list queries return `data:mg-digest;md5,<hex>` instead of each
// ~250 KB base64 image, computed in SQL. MongoDB can't hash, so every write
// keeps the md5 of each inline image in a hidden `_media_md5` field, and reads
// that ask for a digest project the fingerprint instead of the image — the
// base64 never crosses the network. `_media_md5` is never returned to callers.

const MEDIA: Record<string, readonly string[]> = {
  pins: ['image', 'brochure_image'],
  infra_markers: ['icon_image'],
  pins_history: ['row_data.image', 'row_data.brochure_image'],
};
const HIDDEN = '_media_md5';
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const keyOf = (path: string) => path.replace(/\./g, '__');

function getPath(doc: Document, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Document)[k] : undefined), doc);
}

/** md5 entries for every media path present in a full document. */
function digestsFor(table: string, doc: Document): Document {
  const out: Document = {};
  for (const path of MEDIA[table] || []) {
    const v = getPath(doc, path);
    if (typeof v === 'string' && v.startsWith('data:')) out[keyOf(path)] = md5(v);
  }
  return out;
}

/** Adds `_media_md5.*` to a $set (and $unset for media replaced by non-inline values). */
function withDigestUpdate(table: string, update: Document): Document {
  const paths = MEDIA[table];
  if (!paths || !update || Array.isArray(update)) return update;
  const set = { ...(update.$set || {}) };
  const unset = { ...(update.$unset || {}) };
  let touched = false;
  for (const path of paths) {
    let v: unknown;
    if (path in set) v = set[path];
    else {
      const [top, ...rest] = path.split('.');
      if (!rest.length || !(top in set)) continue;
      v = getPath(set[top] as Document, rest.join('.'));
    }
    touched = true;
    const hk = `${HIDDEN}.${keyOf(path)}`;
    if (typeof v === 'string' && v.startsWith('data:')) set[hk] = md5(v);
    else unset[hk] = '';
  }
  if (!touched) return update;
  const out: Document = { ...update, $set: set };
  if (Object.keys(unset).length) out.$unset = unset;
  return out;
}

function prepInsert(table: string, doc: Document): Document {
  const d = digestsFor(table, doc);
  // Same id policy as the Postgres layer: string ids, never ObjectIds.
  const out: Document = { _id: doc._id ?? randomUUID(), ...doc };
  if (Object.keys(d).length) out[HIDDEN] = d;
  return out;
}

const strip = <T extends Document | null>(d: T): T => {
  if (d && HIDDEN in d) delete (d as Document)[HIDDEN];
  return d;
};

/** Aggregation expression: the fingerprint if the value is an inline image, else the value. */
function digestExpr(path: string): Document {
  const v = `$${path}`;
  return {
    $cond: [
      { $and: [{ $eq: [{ $type: v }, 'string'] }, { $eq: [{ $substrBytes: [v, 0, 5] }, 'data:'] }] },
      { $concat: [MEDIA_DIGEST_PREFIX, { $ifNull: [`$${HIDDEN}.${keyOf(path)}`, 'missing'] }] },
      v,
    ],
  };
}

/** Builds the $project/$addFields stages a digest read needs. */
function digestStages(projection: Document | undefined, digest: MediaDigest): Document[] {
  const top = [...(digest.fields || [])];
  const nested = digest.nested ? digest.nested.keys.map((k) => `${digest.nested!.field}.${k}`) : [];
  const entries = Object.entries(projection || {});
  const include = entries.some(([, v]) => v === 1 || v === true);
  if (include) {
    const proj: Document = { id: 1 };
    for (const [k, v] of entries) if (v === 1 || v === true) proj[k] = top.includes(k) ? digestExpr(k) : 1;
    return [{ $project: proj }];
  }
  const excluded = new Set(entries.filter(([, v]) => v === 0 || v === false).map(([k]) => k));
  const add: Document = {};
  for (const k of top) if (!excluded.has(k)) add[k] = digestExpr(k);
  for (const k of nested) add[k] = digestExpr(k);
  const stages: Document[] = [];
  if (Object.keys(add).length) stages.push({ $addFields: add });
  // Inline images inside row_data are only replaced when row_data is an object.
  stages.push({ $project: { [HIDDEN]: 0, ...Object.fromEntries([...excluded].map((k) => [k, 0])) } });
  return stages;
}

class DigestCursor {
  private s?: Document; private sk?: number; private lim?: number;
  constructor(private coll: ReturnType<MongoDb['collection']>, private q: Document, private projection: Document | undefined, private digest: MediaDigest) {}
  sort(s: Document) { this.s = s; return this; }
  skip(n: number) { this.sk = n; return this; }
  limit(n: number) { this.lim = n; return this; }
  async toArray(): Promise<Document[]> {
    const pipeline: Document[] = [{ $match: this.q }];
    if (this.s) pipeline.push({ $sort: this.s });
    if (this.sk) pipeline.push({ $skip: this.sk });
    if (this.lim) pipeline.push({ $limit: this.lim });
    pipeline.push(...digestStages(this.projection, this.digest));
    return (await this.coll.aggregate(pipeline).toArray()).map(strip);
  }
}

/** A MongoDB collection behaving like the Postgres layer's (string ids, digests, hidden fields). */
function wrapCollection(db: MongoDb, table: string) {
  const coll = db.collection(table);
  const hideProjection = (projection?: Document) => {
    if (!projection) return { [HIDDEN]: 0 };
    const include = Object.values(projection).some((v) => v === 1 || v === true);
    return include ? projection : { ...projection, [HIDDEN]: 0 };
  };
  return new Proxy(coll, {
    get(target, prop, recv) {
      switch (prop) {
        case 'find':
          return (q: Document = {}, opts: Document = {}) => {
            const { mediaDigest, projection, ...rest } = opts;
            if (mediaDigest) return new DigestCursor(target, q, projection, mediaDigest);
            const cur = target.find(q, { ...rest, projection: hideProjection(projection) });
            const toArray = cur.toArray.bind(cur);
            (cur as unknown as { toArray: () => Promise<Document[]> }).toArray = async () => (await toArray()).map(strip);
            return cur;
          };
        case 'findOne':
          return async (q: Document = {}, opts: Document = {}) => {
            const { mediaDigest, projection, ...rest } = opts;
            if (mediaDigest) return (await new DigestCursor(target, q, projection, mediaDigest).limit(1).toArray())[0] ?? null;
            return strip(await target.findOne(q, { ...rest, projection: hideProjection(projection) }));
          };
        case 'insertOne':
          return (doc: Document, o?: Document) => target.insertOne(prepInsert(table, doc), o);
        case 'insertMany':
          return (docs: Document[], o?: Document) => target.insertMany(docs.map((d) => prepInsert(table, d)), o);
        case 'replaceOne':
          return (q: Document, doc: Document, o?: Document) => {
            const d = digestsFor(table, doc);
            const { _id: _ignored, ...rest } = doc;
            return target.replaceOne(q, Object.keys(d).length ? { ...rest, [HIDDEN]: d } : rest, o);
          };
        case 'updateOne':
        case 'updateMany':
          return (q: Document, u: Document, o: Document = {}) => {
            const upd = withDigestUpdate(table, u);
            // Upserts get a string _id like every other insert.
            if (o.upsert && !(upd.$setOnInsert && '_id' in upd.$setOnInsert) && q._id == null) {
              upd.$setOnInsert = { _id: q.id != null ? String(q.id) : randomUUID(), ...(upd.$setOnInsert || {}) };
            }
            return (target[prop] as (a: Document, b: Document, c: Document) => unknown)(q, upd, o);
          };
        case 'findOneAndUpdate':
          return async (q: Document, u: Document, o: Document = {}) => {
            const upd = withDigestUpdate(table, u);
            if (o.upsert && q._id == null && !(upd.$setOnInsert && '_id' in upd.$setOnInsert)) {
              upd.$setOnInsert = { _id: q.id != null ? String(q.id) : randomUUID(), ...(upd.$setOnInsert || {}) };
            }
            // The Postgres layer returns the document itself (driver v6 default).
            const r = await target.findOneAndUpdate(q, upd, { returnDocument: 'after', ...o, includeResultMetadata: false });
            return strip(r as Document | null);
          };
        default: {
          const v = Reflect.get(target, prop, recv);
          return typeof v === 'function' ? v.bind(target) : v;
        }
      }
    },
  });
}

let mongoFacade: Db | null = null;

/** The app's database, on whichever backend is configured. */
export async function getDb(): Promise<Db> {
  if (!usingMongo()) return getPgDb();
  if (!mongoFacade) {
    const db = await getMongoDb();
    mongoFacade = { collection: (name: string) => wrapCollection(db, name) } as unknown as Db;
  }
  return mongoFacade;
}
