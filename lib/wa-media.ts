import { randomUUID } from 'node:crypto';
import { getMongoDb, usingMongo } from './mongodb';
import { query } from './pg';
import { SITE_URL } from './seo/config';

// Files sent on WhatsApp (photos, videos, documents) from s-admin → WhatsApp.
// WhatsApp fetches a file from a public link, so uploads are kept in the
// database and served at /api/wa-media/<id>/<file name> (an unguessable id).
// Uploads arrive in parts of up to 3 MB because Vercel refuses request bodies
// over 4.5 MB; the file is streamed back out part by part.
//   Postgres: wa_media (id, doc jsonb) + wa_media_parts (id, idx, data bytea)
//   MongoDB:  wa_media + wa_media_parts (data as base64)

export const PART_BYTES = 3 * 1024 * 1024;

/** WhatsApp's own limits per kind. */
export const MEDIA_RULES = {
  image: { max: 5 * 1024 * 1024, types: ['image/jpeg', 'image/png'] },
  video: { max: 16 * 1024 * 1024, types: ['video/mp4', 'video/3gpp'] },
  document: { max: 16 * 1024 * 1024, types: [] as string[] }, // any type
} as const;
export type MediaKind = keyof typeof MEDIA_RULES;

export interface WaMediaMeta { id: string; kind: MediaKind; name: string; mime: string; size: number; parts: number; received: number[]; complete: boolean; by?: string; created_at: string }

let ready: Promise<void> | null = null;
function ensure(): Promise<void> {
  if (usingMongo()) return Promise.resolve();
  ready ??= query(`
    CREATE TABLE IF NOT EXISTS "wa_media" (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
    CREATE TABLE IF NOT EXISTS "wa_media_parts" (id text NOT NULL, idx int NOT NULL, data bytea NOT NULL, PRIMARY KEY (id, idx));
  `).then(() => undefined).catch((e) => { ready = null; throw e; });
  return ready;
}

/** "My Photo (1).JPG" → "my-photo-1.jpg" (safe in a URL path). */
export function safeName(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'file';
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : '';
  return ext ? `${base}.${ext}` : base;
}

/** Checks a file against WhatsApp's limits. Returns an error message, or '' when it is fine. */
export function checkMedia(kind: MediaKind, mime: string, size: number): string {
  const rule = MEDIA_RULES[kind];
  if (!rule) return 'Unknown file type';
  if (size <= 0) return 'The file is empty';
  if (size > rule.max) return `Too large: WhatsApp takes ${kind === 'image' ? 'photos' : `${kind}s`} up to ${rule.max / 1024 / 1024} MB`;
  if (rule.types.length && !(rule.types as readonly string[]).includes(mime.toLowerCase())) {
    return kind === 'image' ? 'Photos must be JPG or PNG' : 'Videos must be MP4 (H.264) or 3GP';
  }
  return '';
}

export const mediaUrl = (m: Pick<WaMediaMeta, 'id' | 'name'>) => `${SITE_URL.replace(/\/+$/, '')}/api/wa-media/${m.id}/${safeName(m.name)}`;

export async function getMediaMeta(id: string): Promise<WaMediaMeta | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  if (usingMongo()) return (await (await getMongoDb()).collection('wa_media').findOne({ id })) as unknown as WaMediaMeta | null;
  await ensure();
  const r = await query<{ doc: WaMediaMeta }>('SELECT doc FROM "wa_media" WHERE id = $1', [id]);
  return r.rows[0]?.doc ?? null;
}

async function saveMeta(m: WaMediaMeta) {
  if (usingMongo()) { await (await getMongoDb()).collection('wa_media').replaceOne({ id: m.id }, m, { upsert: true }); return; }
  await query('INSERT INTO "wa_media" (id, doc) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc', [m.id, JSON.stringify(m)]);
}

/** Starts an upload; the parts follow with savePart. */
export async function startUpload(kind: MediaKind, name: string, mime: string, size: number, by?: string): Promise<WaMediaMeta> {
  const err = checkMedia(kind, mime, size);
  if (err) throw new Error(err);
  await ensure();
  const m: WaMediaMeta = {
    id: randomUUID(), kind, name: name.slice(0, 120) || 'file', mime: mime || 'application/octet-stream', size,
    parts: Math.ceil(size / PART_BYTES), received: [], complete: false, by, created_at: new Date().toISOString(),
  };
  await saveMeta(m);
  return m;
}

/** Stores part `idx` (0-based). Resolves the updated meta; complete once every part has arrived with the right total size. */
export async function savePart(id: string, idx: number, bytes: Buffer): Promise<WaMediaMeta> {
  const m = await getMediaMeta(id);
  if (!m) throw new Error('Upload not found');
  if (!Number.isInteger(idx) || idx < 0 || idx >= m.parts) throw new Error('Bad part number');
  const expected = idx === m.parts - 1 ? m.size - idx * PART_BYTES : PART_BYTES;
  if (bytes.length !== expected) throw new Error(`Part ${idx + 1} has the wrong size`);
  if (usingMongo()) {
    await (await getMongoDb()).collection('wa_media_parts').replaceOne({ id, idx }, { id, idx, data: bytes.toString('base64') }, { upsert: true });
  } else {
    await query('INSERT INTO "wa_media_parts" (id, idx, data) VALUES ($1, $2, $3) ON CONFLICT (id, idx) DO UPDATE SET data = EXCLUDED.data', [id, idx, bytes]);
  }
  const received = [...new Set([...m.received, idx])].sort((a, b) => a - b);
  const next = { ...m, received, complete: received.length === m.parts };
  await saveMeta(next);
  return next;
}

/** The file's bytes, one part at a time (for a streamed response). */
export async function* readParts(m: WaMediaMeta): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < m.parts; i++) {
    if (usingMongo()) {
      const d = await (await getMongoDb()).collection('wa_media_parts').findOne({ id: m.id, idx: i });
      if (!d) throw new Error('missing part');
      yield new Uint8Array(Buffer.from(String(d.data), 'base64'));
    } else {
      const r = await query<{ data: Buffer }>('SELECT data FROM "wa_media_parts" WHERE id = $1 AND idx = $2', [m.id, i]);
      if (!r.rows[0]) throw new Error('missing part');
      yield new Uint8Array(r.rows[0].data);
    }
  }
}
