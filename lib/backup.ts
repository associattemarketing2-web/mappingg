import { gzipSync, gunzipSync } from 'node:zlib';
import { getDb } from './mongodb';
import { DOC_TABLES } from './mongo-compat';
import { query } from './pg';

// Whole-database backups for the super-admin "Backups" tab.
//
// - A snapshot is every table's documents as one gzipped JSON blob, stored in
//   the `backups` table (bytea column) in the same Postgres database. (This used
//   to be a MongoDB GridFS bucket.)
// - One is taken automatically per day (when an admin opens the tab — no cron
//   needed) and on demand. The newest KEEP_SNAPSHOTS are kept.
// - Password hashes are never written into a backup or a download.

export const KEEP_SNAPSHOTS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
type AnyDoc = { _id?: unknown; [k: string]: unknown };

export interface SnapshotInfo {
  id: string;
  created_at: string;
  reason: 'auto' | 'manual';
  size: number;
  counts: Record<string, number>;
}
export type BackupData = Record<string, Record<string, unknown>[]>;

/** Tables included in a backup: every document table (not the blob tables). */
const BACKUP_TABLES: string[] = [...DOC_TABLES].sort();

function sanitize(table: string, doc: AnyDoc): Record<string, unknown> {
  const { _id, ...out } = doc;
  if (table === 'users') delete (out as Record<string, unknown>).password_hash;
  return out;
}

/** Every table's documents, as plain JSON-safe objects. */
export async function collectAll(): Promise<{ data: BackupData; counts: Record<string, number> }> {
  const db = await getDb();
  const data: BackupData = {};
  const counts: Record<string, number> = {};
  for (const name of BACKUP_TABLES) {
    const rows = (await db.collection(name).find({}).toArray()) as AnyDoc[];
    data[name] = rows.map((r) => sanitize(name, r));
    counts[name] = rows.length;
  }
  return { data, counts };
}

export async function liveCounts(): Promise<Record<string, number>> {
  const db = await getDb();
  const counts: Record<string, number> = {};
  for (const name of BACKUP_TABLES) counts[name] = await db.collection(name).countDocuments({});
  return counts;
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

type BackupRow = {
  id: string;
  created_at: Date;
  reason: string;
  size: number;
  counts: Record<string, number>;
};

function toInfo(r: BackupRow): SnapshotInfo {
  return {
    id: String(r.id),
    created_at: new Date(r.created_at).toISOString(),
    reason: r.reason === 'auto' ? 'auto' : 'manual',
    size: Number(r.size) || 0,
    counts: r.counts || {},
  };
}

export async function listSnapshots(): Promise<SnapshotInfo[]> {
  const res = await query<BackupRow>(
    `SELECT id, created_at, reason, size, counts FROM "backups" ORDER BY created_at DESC`,
  );
  return res.rows.map(toInfo);
}

export async function createSnapshot(reason: 'auto' | 'manual'): Promise<SnapshotInfo> {
  const { data, counts } = await collectAll();
  const created_at = new Date().toISOString();
  const gz = gzipSync(Buffer.from(JSON.stringify({ created_at, reason, data })));
  const filename = `mappingg-backup-${created_at.replace(/[:.]/g, '-')}.json.gz`;

  const res = await query<{ id: string }>(
    `INSERT INTO "backups" (filename, created_at, reason, size, counts, gz)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id`,
    [filename, created_at, reason, gz.length, JSON.stringify(counts), gz],
  );

  // Retention: keep only the newest KEEP_SNAPSHOTS.
  await query(
    `DELETE FROM "backups" WHERE id NOT IN (
       SELECT id FROM "backups" ORDER BY created_at DESC LIMIT $1
     )`,
    [KEEP_SNAPSHOTS],
  );

  return { id: String(res.rows[0]?.id), created_at, reason, size: gz.length, counts };
}

/** Takes the daily automatic backup if the newest one is more than a day old. */
export async function ensureDailySnapshot(): Promise<SnapshotInfo | null> {
  const [latest] = await listSnapshots();
  if (latest && Date.now() - new Date(latest.created_at).getTime() < DAY_MS) return null;
  return createSnapshot('auto');
}

export async function readSnapshotGz(id: string): Promise<{ gz: Buffer; info: SnapshotInfo } | null> {
  if (!isUuid(id)) return null;
  const res = await query<BackupRow & { gz: Buffer }>(
    `SELECT id, created_at, reason, size, counts, gz FROM "backups" WHERE id = $1`,
    [id],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { gz: row.gz, info: toInfo(row) };
}

export async function readSnapshot(id: string): Promise<{ data: BackupData; info: SnapshotInfo } | null> {
  const r = await readSnapshotGz(id);
  if (!r) return null;
  const parsed = JSON.parse(gunzipSync(r.gz).toString('utf8')) as { data: BackupData };
  return { data: parsed.data || {}, info: r.info };
}
