import { randomUUID } from 'node:crypto';
import { query } from './pg';
import { getDb, usingMongo } from './mongodb';

// Recycle bin for the super-admin panels. Before anything is deleted from an
// admin list (accounts, employees, leads, blogs, intake projects, developer
// projects) a full copy of its documents is put here. Backups → Recycle bin
// can then restore it exactly as it was, or delete it forever.
//
// Map pins also keep their own change history (pins_history, shown as "Deleted
// pins" in Backups). A pin deleted together with a project is stored here too,
// so the whole project comes back in one click.

export type TrashKind = 'account' | 'employee' | 'lead' | 'blog' | 'intake_project' | 'dev_project' | 'builder';

export const TRASH_KIND_LABEL: Record<TrashKind, string> = {
  account: 'Account', employee: 'Employee', lead: 'Lead', blog: 'Blog post',
  intake_project: 'Intake project', dev_project: 'Developer project', builder: 'Builder',
};

/** One stored document: the collection it came from and its full contents. */
export interface TrashDoc { collection: string; doc: Record<string, unknown> }

export interface TrashItem {
  id: string;
  kind: TrashKind;
  label: string;
  /** Extra line for the list, e.g. an email or a locality. */
  sub?: string;
  docs: TrashDoc[];
  deleted_at: string;
  deleted_by?: string;
}

let ready: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (usingMongo()) return Promise.resolve();
  ready ??= query(`
    CREATE TABLE IF NOT EXISTS "trash" (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
    CREATE INDEX IF NOT EXISTS trash_deleted_at ON "trash" ((doc->>'deleted_at') DESC);
  `).then(() => undefined).catch((e) => { ready = null; throw e; });
  return ready;
}

/** `?id=x` or `?ids=x,y,z` → list of ids (bulk deletes from the admin lists). */
export function idsParam(sp: URLSearchParams): string[] {
  const all = [sp.get('id') || '', ...(sp.get('ids') || '').split(',')].map((s) => s.trim()).filter(Boolean);
  return [...new Set(all)].slice(0, 500);
}

/** Copy documents into the recycle bin. Call this *before* deleting them. */
export async function moveToTrash(item: { kind: TrashKind; label: string; sub?: string; docs: TrashDoc[]; deletedBy?: string }): Promise<string> {
  await ensureTable();
  const id = randomUUID();
  const doc: TrashItem = {
    id, kind: item.kind, label: item.label || TRASH_KIND_LABEL[item.kind], sub: item.sub,
    docs: item.docs.filter((d) => d.doc), deleted_at: new Date().toISOString(), deleted_by: item.deletedBy,
  };
  await (await getDb()).collection('trash').insertOne({ _id: id, ...doc });
  return id;
}

/** Bin entries for the list (no document bodies). `pin_ids` lets Backups hide
 *  those pins from "Deleted projects", so each delete shows up only once. */
export async function listTrash(): Promise<(Omit<TrashItem, 'docs'> & { count: number; pin_ids: string[] })[]> {
  await ensureTable();
  const rows = (await (await getDb()).collection('trash').find({}).toArray()) as unknown as TrashItem[];
  return rows
    .map(({ docs, ...rest }) => ({
      ...rest,
      count: docs?.length || 0,
      pin_ids: (docs || []).filter((d) => d.collection === 'pins').map((d) => String(d.doc.id)),
    }))
    .sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)));
}

const pk = (d: Record<string, unknown>) => String(d._id ?? d.id ?? '');

/**
 * Put every document of a bin entry back. Refuses (and changes nothing) if any
 * of them already exists again, e.g. an account re-registered with the same email.
 * Returns the restored entry so callers can refresh caches.
 */
export async function restoreFromTrash(id: string): Promise<{ ok: true; item: TrashItem } | { ok: false; message: string }> {
  await ensureTable();
  const db = await getDb();
  const item = (await db.collection('trash').findOne({ id })) as unknown as TrashItem | null;
  if (!item) return { ok: false, message: 'Already restored or deleted' };

  for (const { collection, doc } of item.docs) {
    const key = pk(doc);
    if (key && (await db.collection(collection).findOne({ id: doc.id ?? key }))) {
      return { ok: false, message: `“${item.label}” can’t be restored — it already exists again.` };
    }
    if (collection === 'users' && doc.email && (await db.collection('users').findOne({ email: doc.email }))) {
      return { ok: false, message: `Another account now uses ${String(doc.email)} — delete or rename it first.` };
    }
  }
  for (const { collection, doc } of item.docs) {
    const back: Record<string, unknown> = { ...doc, _id: pk(doc) };
    // A map pin keeps its number unless a newer pin took it — then the next free one.
    if (collection === 'pins' && back.number != null && (await db.collection('pins').findOne({ number: back.number }))) {
      const [top] = await db.collection('pins').find({}, { projection: { number: 1 } }).sort({ number: -1 }).limit(1).toArray();
      back.number = (Number(top?.number) || 0) + 1;
    }
    await db.collection(collection).insertOne(back);
  }
  await db.collection('trash').deleteOne({ id });
  return { ok: true, item };
}

/** Delete bin entries forever. */
export async function purgeTrash(ids: string[]): Promise<number> {
  await ensureTable();
  if (!ids.length) return 0;
  const res = await (await getDb()).collection('trash').deleteMany({ id: { $in: ids } });
  return res.deletedCount;
}

