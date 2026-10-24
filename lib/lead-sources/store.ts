import { query } from '../pg';
import { usingMongo } from '../mongodb';

// Storage for external lead sources. Plain relational tables (not the JSONB
// documents) because ingestion needs an atomic "claim this external id" step.
// Additive only: created on first use; migration/pg-lead-sources.sql holds the
// same DDL plus rollback notes. Postgres only.
//
//   lead_ingest_keys  one row per external record ever received (idempotency).
//                     Holds ids and a payload hash, never personal data.
//   lead_sync_log     every webhook, sync, connection test and import, with
//                     counts and the error (if any). Never personal data.
//   lead_portals      the registry of public property portals and whether
//                     their owner has permitted automated access.

export type Sql = (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
const defaultSql: Sql = (text, params = []) => query(text, params);

export const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS lead_ingest_keys (
    source text NOT NULL,
    external_id text NOT NULL,
    payload_hash text NOT NULL DEFAULT '',
    lead_id text,
    outcome text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source, external_id)
  )`,
  `CREATE TABLE IF NOT EXISTS lead_sync_log (
    id bigserial PRIMARY KEY,
    at timestamptz NOT NULL DEFAULT now(),
    source text NOT NULL,
    action text NOT NULL,
    ok boolean NOT NULL,
    imported integer NOT NULL DEFAULT 0,
    merged integer NOT NULL DEFAULT 0,
    skipped integer NOT NULL DEFAULT 0,
    is_test boolean NOT NULL DEFAULT false,
    error text,
    detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    actor text
  )`,
  `CREATE INDEX IF NOT EXISTS lead_sync_log_source_at ON lead_sync_log (source, at DESC)`,
  `CREATE TABLE IF NOT EXISTS lead_portals (
    id text PRIMARY KEY,
    name text NOT NULL,
    url text NOT NULL DEFAULT '',
    data_scope text NOT NULL DEFAULT '',
    terms_url text NOT NULL DEFAULT '',
    permission text NOT NULL DEFAULT 'not_reviewed',
    permission_note text NOT NULL DEFAULT '',
    evidence_url text NOT NULL DEFAULT '',
    reviewed_by text NOT NULL DEFAULT '',
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
];

const ready = new WeakMap<Sql, Promise<void>>();
export function ensureSchema(sql: Sql = defaultSql): Promise<void> {
  if (usingMongo()) return Promise.reject(new Error('Lead sources need the PostgreSQL backend.'));
  let p = ready.get(sql);
  if (!p) {
    p = (async () => { for (const s of SCHEMA_SQL) await sql(s); })();
    p.catch(() => ready.delete(sql));
    ready.set(sql, p);
  }
  return p;
}

const run = (sql?: Sql): Sql => sql || defaultSql;

// ---- idempotency -----------------------------------------------------------------------

/** Claims (source, externalId). Returns null when this call claimed it, else the earlier row. */
export async function claimKey(source: string, externalId: string, payloadHash: string, sql?: Sql): Promise<{ lead_id: string | null; outcome: string; payload_hash: string } | null> {
  await ensureSchema(sql);
  const claimed = await run(sql)(
    `INSERT INTO lead_ingest_keys (source, external_id, payload_hash) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING external_id`,
    [source, externalId, payloadHash],
  );
  if (claimed.rows.length) return null;
  const prior = (await run(sql)(`SELECT lead_id, outcome, payload_hash FROM lead_ingest_keys WHERE source=$1 AND external_id=$2`, [source, externalId])).rows[0];
  return prior || { lead_id: null, outcome: 'pending', payload_hash: '' };
}

export async function settleKey(source: string, externalId: string, leadId: string | null, outcome: string, sql?: Sql) {
  await run(sql)(`UPDATE lead_ingest_keys SET lead_id=$3, outcome=$4 WHERE source=$1 AND external_id=$2`, [source, externalId, leadId, outcome]);
}

export async function releaseKey(source: string, externalId: string, sql?: Sql) {
  await run(sql)(`DELETE FROM lead_ingest_keys WHERE source=$1 AND external_id=$2 AND outcome='pending'`, [source, externalId]).catch(() => {});
}

export async function knownKeys(source: string, ids: string[], sql?: Sql): Promise<Set<string>> {
  if (!ids.length) return new Set();
  await ensureSchema(sql);
  const r = await run(sql)(`SELECT external_id FROM lead_ingest_keys WHERE source=$1 AND external_id = ANY($2::text[]) AND outcome <> 'pending'`, [source, ids]);
  return new Set(r.rows.map((x) => String(x.external_id)));
}

// ---- sync log --------------------------------------------------------------------------

export interface LogEntry {
  source: string;
  action: 'webhook' | 'sync' | 'test' | 'import';
  ok: boolean;
  imported?: number;
  merged?: number;
  skipped?: number;
  is_test?: boolean;
  error?: string | null;
  /** Ids, counts and reasons only — never names, phones or emails. */
  detail?: Record<string, unknown>;
  actor?: string | null;
}

export async function logRun(e: LogEntry, sql?: Sql): Promise<void> {
  try {
    await ensureSchema(sql);
    await run(sql)(
      `INSERT INTO lead_sync_log (source, action, ok, imported, merged, skipped, is_test, error, detail, actor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
      [e.source, e.action, e.ok, e.imported || 0, e.merged || 0, e.skipped || 0, !!e.is_test, e.error ? String(e.error).slice(0, 1000) : null, JSON.stringify(e.detail || {}), e.actor || null],
    );
  } catch (err) {
    console.warn('[lead-sources] could not write sync log:', err instanceof Error ? err.message : err);
  }
}

export interface SourceStats {
  source: string;
  last_ok_at: string | null;
  last_ok_test: boolean | null;
  last_any_at: string | null;
  last_any_ok: boolean | null;
  last_any_action: string | null;
  last_error: string | null;
  last_error_at: string | null;
  last_error_kind: string | null;
  imported_total: number;
  real_events: number;
}

/** Per-source summary of the sync log. */
export async function statsBySource(sql?: Sql): Promise<Map<string, SourceStats>> {
  await ensureSchema(sql);
  const r = await run(sql)(`
    SELECT s.source,
      (SELECT at FROM lead_sync_log WHERE source=s.source AND ok ORDER BY at DESC LIMIT 1) AS last_ok_at,
      (SELECT is_test FROM lead_sync_log WHERE source=s.source AND ok ORDER BY at DESC LIMIT 1) AS last_ok_test,
      (SELECT at FROM lead_sync_log WHERE source=s.source ORDER BY at DESC LIMIT 1) AS last_any_at,
      (SELECT ok FROM lead_sync_log WHERE source=s.source ORDER BY at DESC LIMIT 1) AS last_any_ok,
      (SELECT action FROM lead_sync_log WHERE source=s.source ORDER BY at DESC LIMIT 1) AS last_any_action,
      (SELECT error FROM lead_sync_log WHERE source=s.source AND NOT ok ORDER BY at DESC LIMIT 1) AS last_error,
      (SELECT at FROM lead_sync_log WHERE source=s.source AND NOT ok ORDER BY at DESC LIMIT 1) AS last_error_at,
      (SELECT detail->>'kind' FROM lead_sync_log WHERE source=s.source AND NOT ok ORDER BY at DESC LIMIT 1) AS last_error_kind,
      (SELECT COALESCE(SUM(imported),0) FROM lead_sync_log WHERE source=s.source AND NOT is_test) AS imported_total,
      (SELECT COUNT(*) FROM lead_sync_log WHERE source=s.source AND ok AND NOT is_test AND action <> 'test') AS real_events
    FROM (SELECT DISTINCT source FROM lead_sync_log) s`);
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return new Map(r.rows.map((x) => [String(x.source), {
    source: String(x.source), last_ok_at: iso(x.last_ok_at), last_ok_test: x.last_ok_test ?? null,
    last_any_at: iso(x.last_any_at), last_any_ok: x.last_any_ok ?? null, last_any_action: x.last_any_action ?? null,
    last_error: x.last_error ?? null, last_error_at: iso(x.last_error_at), last_error_kind: x.last_error_kind ?? null,
    imported_total: Number(x.imported_total) || 0, real_events: Number(x.real_events) || 0,
  }]));
}

export async function recentLog(source: string | null, limit = 50, sql?: Sql) {
  await ensureSchema(sql);
  const r = source
    ? await run(sql)(`SELECT * FROM lead_sync_log WHERE source=$1 ORDER BY at DESC LIMIT $2`, [source, limit])
    : await run(sql)(`SELECT * FROM lead_sync_log ORDER BY at DESC LIMIT $1`, [limit]);
  return r.rows.map((x) => ({ ...x, id: String(x.id), at: new Date(x.at).toISOString() }));
}

/** Leads stored per ingest source (the `leads` rows tagged by ingestLead). */
export async function leadCountsBySource(sql?: Sql): Promise<Map<string, { n: number; last: string | null }>> {
  const r = await run(sql)(`SELECT doc->>'ingest_source' AS s, COUNT(*)::int AS n, MAX(doc->>'created_at') AS last FROM leads WHERE doc ? 'ingest_source' GROUP BY 1`);
  return new Map(r.rows.map((x) => [String(x.s), { n: Number(x.n) || 0, last: x.last || null }]));
}

// ---- portal registry -------------------------------------------------------------------

export const PORTAL_PERMISSIONS = ['not_reviewed', 'permission_required', 'permitted', 'denied'] as const;
export type PortalPermission = (typeof PORTAL_PERMISSIONS)[number];

export interface Portal {
  id: string; name: string; url: string; data_scope: string; terms_url: string;
  permission: PortalPermission; permission_note: string; evidence_url: string;
  reviewed_by: string; reviewed_at: string | null; created_at: string; updated_at: string;
}

const portalRow = (x: any): Portal => ({
  ...x, reviewed_at: x.reviewed_at ? new Date(x.reviewed_at).toISOString() : null,
  created_at: new Date(x.created_at).toISOString(), updated_at: new Date(x.updated_at).toISOString(),
});

export async function listPortals(sql?: Sql): Promise<Portal[]> {
  await ensureSchema(sql);
  return (await run(sql)(`SELECT * FROM lead_portals ORDER BY name`)).rows.map(portalRow);
}

export async function upsertPortal(p: Omit<Portal, 'created_at' | 'updated_at' | 'reviewed_at' | 'reviewed_by'>, actor: string, sql?: Sql): Promise<Portal> {
  await ensureSchema(sql);
  const r = await run(sql)(
    `INSERT INTO lead_portals (id, name, url, data_scope, terms_url, permission, permission_note, evidence_url, reviewed_by, reviewed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $6 = 'not_reviewed' THEN NULL ELSE now() END)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, url=EXCLUDED.url, data_scope=EXCLUDED.data_scope, terms_url=EXCLUDED.terms_url,
       permission=EXCLUDED.permission, permission_note=EXCLUDED.permission_note, evidence_url=EXCLUDED.evidence_url,
       reviewed_by=CASE WHEN lead_portals.permission IS DISTINCT FROM EXCLUDED.permission OR lead_portals.permission_note IS DISTINCT FROM EXCLUDED.permission_note THEN EXCLUDED.reviewed_by ELSE lead_portals.reviewed_by END,
       reviewed_at=CASE WHEN lead_portals.permission IS DISTINCT FROM EXCLUDED.permission OR lead_portals.permission_note IS DISTINCT FROM EXCLUDED.permission_note THEN EXCLUDED.reviewed_at ELSE lead_portals.reviewed_at END,
       updated_at=now()
     RETURNING *`,
    [p.id, p.name, p.url, p.data_scope, p.terms_url, p.permission, p.permission_note, p.evidence_url, actor],
  );
  return portalRow(r.rows[0]);
}

export async function deletePortal(id: string, sql?: Sql): Promise<boolean> {
  await ensureSchema(sql);
  return ((await run(sql)(`DELETE FROM lead_portals WHERE id=$1`, [id])).rowCount || 0) > 0;
}

/** When `action` last succeeded for `source` (real runs only), or null. */
export async function lastOk(source: string, action: LogEntry['action'], sql?: Sql): Promise<string | null> {
  await ensureSchema(sql);
  const r = await run(sql)(`SELECT at FROM lead_sync_log WHERE source=$1 AND action=$2 AND ok ORDER BY at DESC LIMIT 1`, [source, action]);
  return r.rows[0] ? new Date(r.rows[0].at).toISOString() : null;
}

const lastLogged = new Map<string, number>();
/** Like logRun, but at most once per `ms` per key — for rejected webhooks, so junk traffic can't flood the log. */
export async function logRunThrottled(e: LogEntry, key: string, ms = 60_000, sql?: Sql): Promise<void> {
  const now = Date.now();
  if (now - (lastLogged.get(key) || 0) < ms) return;
  lastLogged.set(key, now);
  await logRun(e, sql);
}
