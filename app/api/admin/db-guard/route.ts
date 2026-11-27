import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/pg';
import { GUARD_LOG_SQL } from '@/lib/db-guard.mjs';

// Database safety alerts for the s-admin banner (lib/db-guard.mjs, migration/db-guard.mjs).
//   GET            unseen alerts from the last 14 days
//   POST {seen:1}  mark them as seen (the banner hides until a new one comes)
// A "missing table" alert only counts when that table was in the last good snapshot —
// optional tables that were never created are not an alert.

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

async function isAdmin() {
  const s = await getCurrentUser();
  return s?.role === 'admin';
}

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ data: [] }, { headers });
  try {
    await query(GUARD_LOG_SQL);
    const rows = (await query<{ id: string; at: string; source: string; kind: string; detail: string }>(
      `SELECT id::text, at, source, kind, detail FROM db_guard_log
        WHERE NOT seen AND at > now() - interval '14 days' ORDER BY at DESC LIMIT 20`,
    )).rows;
    let known = new Set<string>();
    if (rows.some((r) => r.kind === 'missing-table')) {
      const b = await query<{ t: string }>(`SELECT jsonb_object_keys(value->'tables') t FROM db_guard_baseline WHERE key = 'main'`).catch(() => ({ rows: [] as { t: string }[] }));
      known = new Set(b.rows.map((r) => r.t));
    }
    const data = rows.filter((r) => {
      if (r.kind !== 'missing-table') return true;
      const m = /relation "(?:[^".]+\.)?([^"]+)" does not exist/.exec(r.detail);
      return !!m && known.has(m[1]);
    });
    return NextResponse.json({ data }, { headers });
  } catch {
    return NextResponse.json({ data: [] }, { headers });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401, headers });
  const body = (await req.json().catch(() => ({}))) as { seen?: unknown };
  if (body.seen) await query('UPDATE db_guard_log SET seen = true WHERE NOT seen').catch(() => undefined);
  return NextResponse.json({ ok: true }, { headers });
}
