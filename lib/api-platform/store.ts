import { randomUUID } from 'node:crypto';
import { query } from '../pg';
import { usingMongo } from '../mongodb';
import { APP_STATUSES, LIMITS, SCOPE_LIST, type AppStatus, type Scope } from './config';
import { generateKey, keyMatches, parseKey } from './keys';

// Storage for the Developer API: applications, hashed keys, shared rate-limit
// counters, request logs and the admin audit trail. Plain relational tables
// (not the app's JSONB documents) because counters need atomic increments.
//
// Additive only — nothing here touches existing tables. The tables are created
// on first use (like site_events / developers); migration/pg-api-platform.sql
// holds the same DDL plus rollback notes. Postgres only: with DB_PROVIDER=mongodb
// the API answers 503 (see handler.ts).

export type Sql = (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
const defaultSql: Sql = (text, params = []) => query(text, params);

export const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS api_apps (
    id text PRIMARY KEY,
    name text NOT NULL,
    organization text NOT NULL DEFAULT '',
    contact_email text NOT NULL DEFAULT '',
    website text NOT NULL DEFAULT '',
    purpose text NOT NULL DEFAULT '',
    scopes text[] NOT NULL DEFAULT '{}',
    status text NOT NULL DEFAULT 'active',
    rate_per_minute integer NOT NULL DEFAULT ${LIMITS.defaultRatePerMinute},
    daily_quota integer NOT NULL DEFAULT ${LIMITS.defaultDailyQuota},
    max_page_size integer NOT NULL DEFAULT ${LIMITS.defaultMaxPageSize},
    expires_at timestamptz,
    created_by text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz
  )`,
  `CREATE TABLE IF NOT EXISTS api_keys (
    id text PRIMARY KEY,
    app_id text NOT NULL REFERENCES api_apps(id) ON DELETE CASCADE,
    secret_hash text NOT NULL,
    last4 text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    revoked_at timestamptz,
    last_used_at timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS api_keys_app ON api_keys (app_id)`,
  `CREATE TABLE IF NOT EXISTS api_counters (
    k text PRIMARY KEY,
    n integer NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS api_counters_exp ON api_counters (expires_at)`,
  `CREATE TABLE IF NOT EXISTS api_request_log (
    id bigserial PRIMARY KEY,
    at timestamptz NOT NULL DEFAULT now(),
    app_id text,
    key_id text,
    method text NOT NULL,
    route text NOT NULL,
    status integer NOT NULL,
    duration_ms integer NOT NULL DEFAULT 0,
    records integer NOT NULL DEFAULT 0,
    event text NOT NULL,
    request_id text NOT NULL,
    client text
  )`,
  `CREATE INDEX IF NOT EXISTS api_request_log_at ON api_request_log (at DESC)`,
  `CREATE INDEX IF NOT EXISTS api_request_log_app_at ON api_request_log (app_id, at DESC)`,
  `CREATE INDEX IF NOT EXISTS api_request_log_event_at ON api_request_log (event, at DESC)`,
  `CREATE TABLE IF NOT EXISTS api_audit (
    id bigserial PRIMARY KEY,
    at timestamptz NOT NULL DEFAULT now(),
    actor text NOT NULL,
    app_id text,
    action text NOT NULL,
    detail jsonb NOT NULL DEFAULT '{}'::jsonb
  )`,
  `CREATE INDEX IF NOT EXISTS api_audit_app_at ON api_audit (app_id, at DESC)`,
];

const ready = new WeakMap<Sql, Promise<void>>();
export function ensureSchema(sql: Sql = defaultSql): Promise<void> {
  if (usingMongo()) return Promise.reject(new Error('The Developer API requires the PostgreSQL backend.'));
  let p = ready.get(sql);
  if (!p) {
    p = (async () => { for (const stmt of SCHEMA_SQL) await sql(stmt); })();
    p.catch(() => ready.delete(sql));
    ready.set(sql, p);
  }
  return p;
}

// ---- applications -------------------------------------------------------------

export interface ApiApp {
  id: string;
  name: string;
  organization: string;
  contact_email: string;
  website: string;
  purpose: string;
  scopes: Scope[];
  status: AppStatus;
  rate_per_minute: number;
  daily_quota: number;
  max_page_size: number;
  expires_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export interface ApiKeySummary {
  id: string;
  app_id: string;
  last4: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  state: 'active' | 'expired' | 'revoked';
}

export interface AppInput {
  name: string;
  organization?: string;
  contact_email?: string;
  website?: string;
  purpose?: string;
  scopes?: string[];
  rate_per_minute?: number;
  daily_quota?: number;
  max_page_size?: number;
  expires_at?: string | null;
}

const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
const clampInt = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : dflt;
};
const cleanScopes = (s?: string[]) => [...new Set((s || []).filter((x) => (SCOPE_LIST as string[]).includes(x)))] as Scope[];

function toApp(r: any): ApiApp {
  return {
    id: r.id, name: r.name, organization: r.organization, contact_email: r.contact_email, website: r.website,
    purpose: r.purpose, scopes: cleanScopes(r.scopes), status: r.status, rate_per_minute: Number(r.rate_per_minute),
    daily_quota: Number(r.daily_quota), max_page_size: Number(r.max_page_size), expires_at: iso(r.expires_at),
    created_by: r.created_by, created_at: iso(r.created_at)!, updated_at: iso(r.updated_at)!, last_used_at: iso(r.last_used_at),
  };
}

function toKey(r: any, now = Date.now()): ApiKeySummary {
  const expired = r.expires_at && new Date(r.expires_at).getTime() <= now;
  return {
    id: r.id, app_id: r.app_id, last4: r.last4, created_at: iso(r.created_at)!, expires_at: iso(r.expires_at),
    revoked_at: iso(r.revoked_at), last_used_at: iso(r.last_used_at),
    state: r.revoked_at ? 'revoked' : expired ? 'expired' : 'active',
  };
}

function appValues(input: AppInput) {
  return {
    name: input.name.trim().slice(0, 120),
    organization: (input.organization || '').trim().slice(0, 160),
    contact_email: (input.contact_email || '').trim().toLowerCase().slice(0, 200),
    website: (input.website || '').trim().slice(0, 300),
    purpose: (input.purpose || '').trim().slice(0, 1000),
    scopes: cleanScopes(input.scopes),
    rate_per_minute: clampInt(input.rate_per_minute, 1, LIMITS.maxRatePerMinute, LIMITS.defaultRatePerMinute),
    daily_quota: clampInt(input.daily_quota, 1, LIMITS.maxDailyQuota, LIMITS.defaultDailyQuota),
    max_page_size: clampInt(input.max_page_size, 1, LIMITS.maxPageSize, LIMITS.defaultMaxPageSize),
    expires_at: input.expires_at ? new Date(input.expires_at).toISOString() : null,
  };
}

async function audit(sql: Sql, actor: string, appId: string | null, action: string, detail: Record<string, unknown> = {}) {
  await sql(`INSERT INTO api_audit (actor, app_id, action, detail) VALUES ($1, $2, $3, $4::jsonb)`, [actor, appId, action, JSON.stringify(detail)]);
}

/** Creates an application and its first key. The returned `secret` must be shown once and never stored. */
export async function createApp(input: AppInput, actor: string, sql: Sql = defaultSql): Promise<{ app: ApiApp; key: ApiKeySummary; secret: string }> {
  await ensureSchema(sql);
  const v = appValues(input);
  const id = `app_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const { rows } = await sql(
    `INSERT INTO api_apps (id, name, organization, contact_email, website, purpose, scopes, rate_per_minute, daily_quota, max_page_size, expires_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8,$9,$10,$11,$12) RETURNING *`,
    [id, v.name, v.organization, v.contact_email, v.website, v.purpose, v.scopes, v.rate_per_minute, v.daily_quota, v.max_page_size, v.expires_at, actor],
  );
  const { key, secret } = await insertKey(sql, id, v.expires_at);
  await audit(sql, actor, id, 'app.create', { name: v.name, scopes: v.scopes, key_id: key.id });
  return { app: toApp(rows[0]), key, secret };
}

async function insertKey(sql: Sql, appId: string, expiresAt: string | null) {
  const k = generateKey();
  const { rows } = await sql(
    `INSERT INTO api_keys (id, app_id, secret_hash, last4, expires_at) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [k.id, appId, k.hash, k.last4, expiresAt],
  );
  return { key: toKey(rows[0]), secret: k.secret };
}

export async function updateApp(id: string, input: AppInput, actor: string, sql: Sql = defaultSql): Promise<ApiApp | null> {
  await ensureSchema(sql);
  const v = appValues(input);
  const { rows } = await sql(
    `UPDATE api_apps SET name=$2, organization=$3, contact_email=$4, website=$5, purpose=$6, scopes=$7::text[],
       rate_per_minute=$8, daily_quota=$9, max_page_size=$10, expires_at=$11, updated_at=now()
     WHERE id=$1 RETURNING *`,
    [id, v.name, v.organization, v.contact_email, v.website, v.purpose, v.scopes, v.rate_per_minute, v.daily_quota, v.max_page_size, v.expires_at],
  );
  if (!rows[0]) return null;
  await audit(sql, actor, id, 'app.update', { scopes: v.scopes, rate_per_minute: v.rate_per_minute, daily_quota: v.daily_quota, max_page_size: v.max_page_size, expires_at: v.expires_at });
  return toApp(rows[0]);
}

/** active / disabled (reversible) / revoked (permanent — also revokes every key). */
export async function setAppStatus(id: string, status: AppStatus, actor: string, sql: Sql = defaultSql): Promise<ApiApp | null> {
  await ensureSchema(sql);
  if (!(APP_STATUSES as readonly string[]).includes(status)) throw new Error('bad status');
  const cur = await getApp(id, sql);
  if (!cur) return null;
  if (cur.status === 'revoked' && status !== 'revoked') throw new Error('A revoked application cannot be re-enabled. Create a new one.');
  const { rows } = await sql(`UPDATE api_apps SET status=$2, updated_at=now() WHERE id=$1 RETURNING *`, [id, status]);
  if (status === 'revoked') await sql(`UPDATE api_keys SET revoked_at=now() WHERE app_id=$1 AND revoked_at IS NULL`, [id]);
  await audit(sql, actor, id, `app.${status === 'active' ? 'enable' : status === 'disabled' ? 'disable' : 'revoke'}`);
  return toApp(rows[0]);
}

/**
 * Issues a new key. Old active keys keep working for `graceHours` (so the
 * integration can switch over without downtime), then expire; 0 = immediately.
 */
export async function rotateKey(appId: string, graceHours: number, actor: string, sql: Sql = defaultSql): Promise<{ key: ApiKeySummary; secret: string } | null> {
  await ensureSchema(sql);
  const app = await getApp(appId, sql);
  if (!app || app.status === 'revoked') return null;
  const grace = clampInt(graceHours, 0, LIMITS.maxRotationGraceHours, LIMITS.defaultRotationGraceHours);
  if (grace === 0) {
    await sql(`UPDATE api_keys SET revoked_at=now() WHERE app_id=$1 AND revoked_at IS NULL`, [appId]);
  } else {
    await sql(
      `UPDATE api_keys SET expires_at = LEAST(coalesce(expires_at, 'infinity'::timestamptz), now() + ($2::int * interval '1 hour'))
       WHERE app_id=$1 AND revoked_at IS NULL`,
      [appId, grace],
    );
  }
  const out = await insertKey(sql, appId, app.expires_at);
  await audit(sql, actor, appId, 'key.rotate', { new_key_id: out.key.id, grace_hours: grace });
  return out;
}

export async function revokeKey(appId: string, keyId: string, actor: string, sql: Sql = defaultSql): Promise<boolean> {
  await ensureSchema(sql);
  const res = await sql(`UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND app_id=$2 AND revoked_at IS NULL`, [keyId, appId]);
  const ok = (res.rowCount ?? res.rows.length) > 0;
  if (ok) await audit(sql, actor, appId, 'key.revoke', { key_id: keyId });
  return ok;
}

export async function getApp(id: string, sql: Sql = defaultSql): Promise<ApiApp | null> {
  await ensureSchema(sql);
  const { rows } = await sql(`SELECT * FROM api_apps WHERE id=$1`, [id]);
  return rows[0] ? toApp(rows[0]) : null;
}

export async function listApps(sql: Sql = defaultSql): Promise<(ApiApp & { keys: ApiKeySummary[] })[]> {
  await ensureSchema(sql);
  const [apps, keys] = await Promise.all([
    sql(`SELECT * FROM api_apps ORDER BY created_at DESC`),
    sql(`SELECT id, app_id, last4, created_at, expires_at, revoked_at, last_used_at FROM api_keys ORDER BY created_at DESC`),
  ]);
  const byApp = new Map<string, ApiKeySummary[]>();
  for (const k of keys.rows) byApp.set(k.app_id, [...(byApp.get(k.app_id) || []), toKey(k)]);
  return apps.rows.map((r) => ({ ...toApp(r), keys: byApp.get(r.id) || [] }));
}

// ---- authentication -----------------------------------------------------------

export type AuthFailure = 'invalid_key' | 'revoked_key' | 'expired_key' | 'app_disabled' | 'app_revoked' | 'app_expired';
export type AuthResult = { ok: true; app: ApiApp; keyId: string } | { ok: false; reason: AuthFailure; appId?: string; keyId?: string };

/** Validates a presented key: format, hash (constant-time), key + application state and expiry. */
export async function authenticate(presented: string, sql: Sql = defaultSql, now = new Date()): Promise<AuthResult> {
  const parsed = parseKey(presented);
  if (!parsed) return { ok: false, reason: 'invalid_key' };
  await ensureSchema(sql);
  const { rows } = await sql(
    `SELECT k.id AS key_id, k.secret_hash, k.expires_at AS key_expires_at, k.revoked_at, a.*
     FROM api_keys k JOIN api_apps a ON a.id = k.app_id WHERE k.id = $1`,
    [parsed.id],
  );
  const r = rows[0];
  if (!r || !keyMatches(presented, r.secret_hash)) return { ok: false, reason: 'invalid_key' };
  const ids = { appId: r.id as string, keyId: r.key_id as string };
  if (r.status === 'revoked') return { ok: false, reason: 'app_revoked', ...ids };
  if (r.revoked_at) return { ok: false, reason: 'revoked_key', ...ids };
  if (r.status !== 'active') return { ok: false, reason: 'app_disabled', ...ids };
  if (r.key_expires_at && new Date(r.key_expires_at) <= now) return { ok: false, reason: 'expired_key', ...ids };
  if (r.expires_at && new Date(r.expires_at) <= now) return { ok: false, reason: 'app_expired', ...ids };
  return { ok: true, app: toApp(r), keyId: r.key_id };
}

/** Marks an app + key as used (at most once a minute, so it isn't a write per request). */
export async function touch(appId: string, keyId: string, sql: Sql = defaultSql) {
  await sql(`UPDATE api_apps SET last_used_at=now() WHERE id=$1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`, [appId]);
  await sql(`UPDATE api_keys SET last_used_at=now() WHERE id=$1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`, [keyId]);
}

// ---- shared counters (rate limits, quotas, abuse blocks) ----------------------

/**
 * Atomically adds 1 to each counter and returns the new values. Counters live
 * in Postgres, so the limits hold across restarts and across several server
 * instances; expired rows are swept by sweep().
 */
export async function hit(entries: { key: string; ttlSec: number }[], sql: Sql = defaultSql): Promise<Record<string, number>> {
  await ensureSchema(sql);
  const params: unknown[] = [];
  const values = entries.map((e) => {
    params.push(e.key, e.ttlSec);
    return `($${params.length - 1}, 1, now() + ($${params.length}::int * interval '1 second'))`;
  });
  const { rows } = await sql(
    `INSERT INTO api_counters (k, n, expires_at) VALUES ${values.join(', ')}
     ON CONFLICT (k) DO UPDATE SET n = api_counters.n + 1 RETURNING k, n`,
    params,
  );
  return Object.fromEntries(rows.map((r) => [r.k, Number(r.n)]));
}

export async function peek(key: string, sql: Sql = defaultSql): Promise<number> {
  await ensureSchema(sql);
  const { rows } = await sql(`SELECT n FROM api_counters WHERE k=$1 AND expires_at > now()`, [key]);
  return rows[0] ? Number(rows[0].n) : 0;
}

/** Deletes expired counters and request logs past the retention window. */
export async function sweep(sql: Sql = defaultSql) {
  await ensureSchema(sql);
  await sql(`DELETE FROM api_counters WHERE expires_at < now()`);
  await sql(`DELETE FROM api_request_log WHERE at < now() - ($1::int * interval '1 day')`, [LIMITS.logRetentionDays]);
}

// ---- request log + usage ------------------------------------------------------

export type LogEvent = 'ok' | 'client_error' | 'server_error' | 'auth_missing' | 'auth_failed' | 'forbidden' | 'rate_limited' | 'quota_exceeded' | 'blocked';

export interface LogEntry {
  appId?: string | null;
  keyId?: string | null;
  method: string;
  route: string;
  status: number;
  durationMs: number;
  records: number;
  event: LogEvent;
  requestId: string;
  client?: string | null;
}

/** Operational metadata only: no keys, headers, IPs (a one-way fingerprint) or bodies. */
export async function logRequest(e: LogEntry, sql: Sql = defaultSql) {
  await ensureSchema(sql);
  await sql(
    `INSERT INTO api_request_log (app_id, key_id, method, route, status, duration_ms, records, event, request_id, client)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [e.appId || null, e.keyId || null, e.method, e.route.slice(0, 120), e.status, Math.round(e.durationMs), e.records, e.event, e.requestId, e.client || null],
  );
}

export interface UsageSummary {
  app_id: string;
  today: number;
  last_7_days: number;
  errors_7_days: number;
  rate_limited_7_days: number;
  avg_ms_7_days: number;
}

export async function usageSummary(sql: Sql = defaultSql): Promise<UsageSummary[]> {
  await ensureSchema(sql);
  const { rows } = await sql(
    `SELECT app_id,
            count(*) FILTER (WHERE at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS today,
            count(*)::int AS last_7_days,
            count(*) FILTER (WHERE status >= 400)::int AS errors_7_days,
            count(*) FILTER (WHERE event IN ('rate_limited','quota_exceeded'))::int AS rate_limited_7_days,
            coalesce(round(avg(duration_ms)), 0)::int AS avg_ms_7_days
     FROM api_request_log WHERE app_id IS NOT NULL AND at >= now() - interval '7 days' GROUP BY app_id`,
  );
  return rows.map((r) => ({ ...r, app_id: r.app_id }));
}

/** Requests per UTC day for one application (for the admin chart and CSV export). */
export async function dailyUsage(appId: string | null, days: number, sql: Sql = defaultSql) {
  await ensureSchema(sql);
  const { rows } = await sql(
    `SELECT app_id, to_char(date_trunc('day', at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, route,
            count(*)::int AS requests,
            count(*) FILTER (WHERE status >= 400)::int AS errors,
            count(*) FILTER (WHERE event IN ('rate_limited','quota_exceeded'))::int AS rate_limited,
            coalesce(sum(records), 0)::int AS records,
            coalesce(round(avg(duration_ms)), 0)::int AS avg_ms
     FROM api_request_log
     WHERE app_id IS NOT NULL AND ($1::text IS NULL OR app_id = $1) AND at >= now() - ($2::int * interval '1 day')
     GROUP BY 1, 2, 3 ORDER BY 2 DESC, 1, 3`,
    [appId, Math.min(Math.max(days, 1), LIMITS.logRetentionDays)],
  );
  return rows as { app_id: string; day: string; route: string; requests: number; errors: number; rate_limited: number; records: number; avg_ms: number }[];
}

/** Recent requests for one app, or recent auth failures / blocks / rate limits across all apps. */
export async function recentEvents(opts: { appId?: string; securityOnly?: boolean; limit?: number }, sql: Sql = defaultSql) {
  await ensureSchema(sql);
  const { rows } = await sql(
    `SELECT at, app_id, key_id, method, route, status, duration_ms, records, event, request_id, client
     FROM api_request_log
     WHERE ($1::text IS NULL OR app_id = $1)
       AND (NOT $2::boolean OR event IN ('auth_missing','auth_failed','forbidden','rate_limited','quota_exceeded','blocked'))
     ORDER BY at DESC LIMIT $3`,
    [opts.appId || null, !!opts.securityOnly, Math.min(opts.limit || 50, 200)],
  );
  return rows.map((r) => ({ ...r, at: iso(r.at) }));
}

export async function auditTrail(appId: string, sql: Sql = defaultSql) {
  await ensureSchema(sql);
  const { rows } = await sql(`SELECT at, actor, action, detail FROM api_audit WHERE app_id=$1 ORDER BY at DESC LIMIT 50`, [appId]);
  return rows.map((r) => ({ ...r, at: iso(r.at) }));
}
