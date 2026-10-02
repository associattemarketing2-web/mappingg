import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { runDbOp, restorePinFromHistory } from '@/lib/db-engine';
import {
  KEEP_SNAPSHOTS, collectAll, createSnapshot, ensureDailySnapshot, listSnapshots, liveCounts, readSnapshot, readSnapshotGz,
} from '@/lib/backup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Super-admin "Backups": automatic daily + on-demand snapshots of the whole
// database, downloads, a "what's missing since this backup?" comparison, and
// one-click restore of individual missing / deleted project pins.
// Owner (role 'admin') only — backups contain every lead and account.

type Row = Record<string, unknown>;
const unauthorized = () => NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });

async function isOwner() {
  const u = await getCurrentUser();
  return !!u && u.role === 'admin';
}

/** The fields shown in lists — never images or other bulky data. */
function pinSummary(p: Row) {
  return {
    id: String(p.id || ''),
    number: typeof p.number === 'number' ? p.number : Number(p.number) || null,
    title: String(p.title || ''),
    developer: String(p.developer || ''),
    location: String(p.location || ''),
    status: String(p.status || ''),
    updated_at: String(p.updated_at || ''),
  };
}

/** Pins that were deleted (per the change history) and are still not on the map. */
async function deletedPins() {
  const db = await getDb();
  const current = new Set((await db.collection('pins').find({}, { projection: { id: 1 } }).toArray()).map((p) => String(p.id)));
  const rows = await db.collection('pins_history').find({ operation: 'delete' }).sort({ changed_at: -1 }).toArray();
  const seen = new Set<string>();
  const out: Array<ReturnType<typeof pinSummary> & { history_id: string; deleted_at: string; blank: boolean }> = [];
  for (const h of rows) {
    const pinId = String(h.pin_id || (h.row_data as Row | undefined)?.id || '');
    if (!pinId || current.has(pinId) || seen.has(pinId)) continue;
    seen.add(pinId);
    const s = pinSummary((h.row_data as Row) || {});
    out.push({ ...s, id: pinId, history_id: String(h.history_id), deleted_at: String(h.changed_at || ''), blank: !s.title && !s.developer && !s.location });
  }
  return out;
}

/** Summary of the change history (every pin edit/deletion, with a full copy). */
async function historySummary() {
  const db = await getDb();
  const h = db.collection('pins_history');
  const [total, deletes, first, last] = await Promise.all([
    h.countDocuments({}),
    h.countDocuments({ operation: 'delete' }),
    h.find({}, { projection: { changed_at: 1 } }).sort({ changed_at: 1 }).limit(1).toArray(),
    h.find({}, { projection: { changed_at: 1 } }).sort({ changed_at: -1 }).limit(1).toArray(),
  ]);
  return { total, edits: total - deletes, deletes, first: first[0]?.changed_at || null, last: last[0]?.changed_at || null };
}

export async function GET(req: NextRequest) {
  if (!(await isOwner())) return unauthorized();
  const download = req.nextUrl.searchParams.get('download');

  // Download just the change history (full copies, newest first).
  if (download === 'history') {
    const db = await getDb();
    const rows = await db.collection('pins_history').find({}).sort({ changed_at: -1 }).toArray();
    const stamp = new Date().toISOString();
    return new NextResponse(JSON.stringify({ created_at: stamp, count: rows.length, pins_history: rows.map(({ _id, ...r }) => r) }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="mappingg-change-history-${stamp.slice(0, 10)}.json"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  // Download everything as it is right now (plain JSON).
  if (download === 'current') {
    const { data, counts } = await collectAll();
    const stamp = new Date().toISOString();
    const body = JSON.stringify({ created_at: stamp, counts, data });
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="mappingg-full-backup-${stamp.slice(0, 10)}.json"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }
  // Download a stored snapshot (gzipped JSON — opens with any unzip tool).
  if (download) {
    const snap = await readSnapshotGz(download);
    if (!snap) return NextResponse.json({ error: { message: 'Backup not found' } }, { status: 404 });
    return new NextResponse(new Uint8Array(snap.gz), {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="mappingg-backup-${snap.info.created_at.slice(0, 16).replace(/[:T]/g, '-')}.json.gz"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  let autoError: string | null = null;
  try { await ensureDailySnapshot(); } catch (e) { autoError = e instanceof Error ? e.message : 'Automatic backup failed'; }
  const [live, snapshots, deleted, history] = await Promise.all([liveCounts(), listSnapshots(), deletedPins(), historySummary()]);
  return NextResponse.json({ data: { live, snapshots, deleted, history, keep: KEEP_SNAPSHOTS, autoError } });
}

const postSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('snapshot') }),
  z.object({ action: z.literal('compare'), id: z.string().min(1) }),
  z.object({ action: z.literal('restore-pin'), id: z.string().min(1), pinId: z.string().min(1) }),
  z.object({ action: z.literal('restore-deleted'), historyId: z.string().min(1) }),
]);

export async function POST(req: NextRequest) {
  if (!(await isOwner())) return unauthorized();
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { message: 'Invalid request' } }, { status: 400 });
  const body = parsed.data;
  const db = await getDb();

  if (body.action === 'snapshot') {
    return NextResponse.json({ data: await createSnapshot('manual') });
  }

  if (body.action === 'compare') {
    const snap = await readSnapshot(body.id);
    if (!snap) return NextResponse.json({ error: { message: 'Backup not found' } }, { status: 404 });
    const then = (snap.data.pins || []) as Row[];
    const now = (await db.collection('pins').find({}, { projection: { image: 0, brochure_image: 0 } }).toArray()) as Row[];
    const nowById = new Map(now.map((p) => [String(p.id), p]));
    const thenIds = new Set(then.map((p) => String(p.id)));
    return NextResponse.json({
      data: {
        snapshot: snap.info,
        missing: then.filter((p) => !nowById.has(String(p.id))).map(pinSummary),
        added: now.filter((p) => !thenIds.has(String(p.id))).map(pinSummary),
        changed: then.filter((p) => { const n = nowById.get(String(p.id)); return n && String(n.updated_at || '') !== String(p.updated_at || ''); }).length,
      },
    });
  }

  if (body.action === 'restore-pin') {
    const snap = await readSnapshot(body.id);
    const pin = (snap?.data.pins || []).find((p) => String(p.id) === body.pinId) as Row | undefined;
    if (!pin) return NextResponse.json({ error: { message: 'That pin is not in this backup' } }, { status: 404 });
    if (await db.collection('pins').findOne({ id: body.pinId })) {
      return NextResponse.json({ error: { message: 'This pin is already on the map' } }, { status: 409 });
    }
    // Keep its number unless another pin took it meanwhile — then use the next free one.
    let renumbered = false;
    const doc: Row = { ...pin };
    delete doc._id;
    if (doc.number != null && (await db.collection('pins').findOne({ number: doc.number }))) {
      const [top] = await db.collection('pins').find({}, { projection: { number: 1 } }).sort({ number: -1 }).limit(1).toArray();
      doc.number = (Number(top?.number) || 0) + 1;
      renumbered = true;
    }
    const res = await runDbOp({ table: 'pins', action: 'insert', values: doc, returning: false }, true);
    if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ data: { restored: pinSummary(doc), renumbered } });
  }

  // restore-deleted: bring back a pin from the change history.
  const res = await restorePinFromHistory(body.historyId, true);
  if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ data: { restored: pinSummary((res.data as Row) || {}) } });
}
