import sharp from 'sharp';
import { query } from './pg';
import { getMongoDb, usingMongo } from './mongodb';
import { decodeDataUrl, mediaVersion } from './pin-media';

// -----------------------------------------------------------------------------
// Encoded-image cache behind /api/media.
//
// Every first-time visitor of the map requests ~240 marker thumbnails. Without
// this, each request re-read that pin's full base64 document from Postgres and
// re-ran sharp, and the browser's ~6 parallel connections turned that into a
// ~10 s wait for all logos on a cold server.
//
//  - Entries are keyed by the URL's content version (?v=) and stored only when
//    that version matches the image's real hash, so they can never be stale.
//  - Concurrent requests for the same image share one encode (in-flight dedupe).
//  - warmPinThumbs() pre-encodes every public pin's marker thumbnail in a few
//    batched queries as soon as the map asks for its pin list, so the
//    thumbnail requests that follow are answered from memory.
// Bounded by total bytes; least-recently-used entries are evicted first.
// -----------------------------------------------------------------------------

export type Encoded = { bytes: Uint8Array<ArrayBuffer>; mime: string };

/** Marker thumbnails on the public map are requested at this width (see public-map.json pinThumb). */
export const MARKER_THUMB_WIDTH = 96;
const MAX_CACHE_BYTES = 24 * 1024 * 1024;
const WARM_EVERY_MS = 10 * 60_000;
const WARM_BATCH = 25;

type Store = {
  cache: Map<string, Encoded>;
  bytes: number;
  inflight: Map<string, Promise<Encoded | null>>;
  warming: Promise<void> | null;
  lastWarm: number;
};
const g = globalThis as unknown as { __mediaStore?: Store };
const store: Store = g.__mediaStore || (g.__mediaStore = { cache: new Map(), bytes: 0, inflight: new Map(), warming: null, lastWarm: 0 });

export function mediaKey(table: string, id: string, field: string, version: string, width: number): string {
  return `${table}/${id}/${field}/${version}/${width}`;
}

export function cacheGet(key: string): Encoded | undefined {
  const hit = store.cache.get(key);
  if (hit) { store.cache.delete(key); store.cache.set(key, hit); } // refresh LRU position
  return hit;
}

function cacheSet(key: string, val: Encoded) {
  if (val.bytes.length > MAX_CACHE_BYTES / 8 || store.cache.has(key)) return;
  store.cache.set(key, val);
  store.bytes += val.bytes.length;
  for (const [k, v] of store.cache) {
    if (store.bytes <= MAX_CACHE_BYTES) break;
    store.cache.delete(k);
    store.bytes -= v.bytes.length;
  }
}

/** Decodes a data: URL and, for raster images with a width, resizes to a WebP thumbnail. */
async function encode(dataUrl: string, width: number): Promise<Encoded | null> {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return null;
  let { bytes, mime } = decoded;
  if (width && mime.startsWith('image/') && mime !== 'image/svg+xml') {
    try {
      bytes = await sharp(bytes).rotate().resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 }).toBuffer();
      mime = 'image/webp';
    } catch { /* not resizable — serve the original */ }
  }
  return { bytes: new Uint8Array(bytes), mime };
}

/**
 * Encodes `dataUrl` for `key`, sharing the work with any concurrent request for
 * the same key. The result is cached only if `cacheable` (public image whose
 * real hash matches the version in the key).
 */
export function encodeShared(key: string, dataUrl: string, width: number, cacheable: boolean): Promise<Encoded | null> {
  const running = store.inflight.get(key);
  if (running) return running;
  const p = encode(dataUrl, width)
    .then((enc) => { if (enc && cacheable) cacheSet(key, enc); return enc; })
    .finally(() => store.inflight.delete(key));
  store.inflight.set(key, p);
  return p;
}

/** True if `version` is the real content hash of `dataUrl` (i.e. safe to cache under it). */
export function versionMatches(dataUrl: string, version: string): boolean {
  return !!version && mediaVersion(dataUrl) === version;
}

/**
 * Fire-and-forget: pre-encode the marker thumbnail of every public pin that has
 * an inline logo. Runs at most once per WARM_EVERY_MS and never concurrently;
 * failures are ignored (requests then just encode on demand, as before).
 */
export function warmPinThumbs(): void {
  if (store.warming || Date.now() - store.lastWarm < WARM_EVERY_MS) return;
  store.warming = (async () => {
    const mongo = usingMongo() ? (await getMongoDb()).collection('pins') : null;
    // Public pins with an inline logo (ids first, then images in small batches).
    const ids = mongo
      ? (await mongo.find({ hidden: { $ne: true }, image: { $regex: '^data:' } }, { projection: { id: 1 } }).toArray()).map((d) => String(d.id))
      : (await query<{ id: string }>(
        `SELECT id FROM pins
          WHERE (doc->>'hidden') IS DISTINCT FROM 'true' AND left(doc->>'image', 5) = 'data:'`,
      )).rows.map((r) => r.id);
    for (let i = 0; i < ids.length; i += WARM_BATCH) {
      const batch = ids.slice(i, i + WARM_BATCH);
      const rows = mongo
        ? (await mongo.find({ id: { $in: batch.flatMap((x) => [x, Number(x)]) }, hidden: { $ne: true } }, { projection: { id: 1, image: 1 } }).toArray())
          .map((d) => ({ id: String(d.id), img: String(d.image || '') }))
        : (await query<{ id: string; img: string }>(
          `SELECT id, doc->>'image' AS img FROM pins
            WHERE id = ANY($1::text[]) AND (doc->>'hidden') IS DISTINCT FROM 'true'`,
          [batch],
        )).rows;
      await Promise.all(rows.map((r) => {
        if (!r.img || !r.img.startsWith('data:')) return null;
        const key = mediaKey('pins', r.id, 'image', mediaVersion(r.img), MARKER_THUMB_WIDTH);
        return store.cache.has(key) ? null : encodeShared(key, r.img, MARKER_THUMB_WIDTH, true);
      }));
    }
  })()
    .catch(() => { /* best effort */ })
    .finally(() => { store.lastWarm = Date.now(); store.warming = null; });
}
