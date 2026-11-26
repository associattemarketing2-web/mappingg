import { Pool, type QueryResult, type QueryResultRow } from 'pg';

// Pooled PostgreSQL connection for the whole app. Replaces the MongoDB client.
//
// The data lives in a Prisma Postgres database (pooled.db.prisma.io). We talk to
// it directly with a small pg pool rather than a generated ORM client: the data
// layer reproduces a tiny subset of the MongoDB API against JSONB (see
// lib/mongo-compat.ts), which is easiest to express as parameterized SQL.
//
// The pool is cached on the Node global so dev hot-reloads don't exhaust
// connections (same pattern the old Mongo client used).
//
// The pool is created lazily on first use, not at import time, so `next build`
// (which imports route modules to collect page data) works without
// DATABASE_URL — e.g. on Vercel, where env vars may be runtime-only.

declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var _pgDirectUntil: number | undefined;
}

// Prisma's connection pooler (pooled.db.prisma.io) sometimes fails every new
// connection with "Failed to connect to upstream database" while the database
// itself is fine and reachable on the direct host (db.prisma.io) — every save
// then failed with "Database error". When that happens we switch this server
// instance to the direct host for a while, then go back to the pooler.
//
// Not on Vercel: the direct host allows only a few connections per database
// user, and every serverless instance (paused ones keep their sockets) opening
// its own direct pool used them all up — which in turn made the pooler fail
// with the same error for everyone. Serverless always stays on the pooler; a
// long-running server falls back with a pool of 2.
const DIRECT_FALLBACK = !process.env.VERCEL;
const DIRECT_POOL_MAX = 2;
const POOLED_HOST = 'pooled.db.prisma.io';
const DIRECT_HOST = 'db.prisma.io';
const DIRECT_FOR_MS = 10 * 60_000;
const POOLER_DOWN = /failed to connect to upstream database/i;

/** DATABASE_URL, or its direct-host form while the pooler is down. */
function databaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url || !global._pgDirectUntil || Date.now() > global._pgDirectUntil) return url;
  try {
    const u = new URL(url);
    if (u.hostname === POOLED_HOST) { u.hostname = DIRECT_HOST; return u.toString(); }
  } catch { /* not a URL — use it as is */ }
  return url;
}

/** On a pooler outage, move to the direct host. True when the query is worth retrying there. */
function switchToDirectHost(e: unknown): boolean {
  if (!DIRECT_FALLBACK || !POOLER_DOWN.test(String((e as Error)?.message || ''))) return false;
  try { if (new URL(process.env.DATABASE_URL || '').hostname !== POOLED_HOST) return false; } catch { return false; }
  const wasDirect = !!global._pgDirectUntil && Date.now() <= global._pgDirectUntil;
  global._pgDirectUntil = Date.now() + DIRECT_FOR_MS;
  if (wasDirect) return false; // already on the direct host — this is a real failure
  console.warn('[pg] connection pooler is down — using the direct database host for 10 minutes');
  resetPool();
  return true;
}

function resetPool() {
  const old = global._pgPool;
  global._pgPool = undefined;
  old?.end().catch(() => { /* already closed */ });
}

/**
 * Prisma Postgres requires TLS. When the URL carries sslmode=require/prefer/
 * verify-ca/verify-full, node-postgres already verifies the server certificate
 * (it treats them all as verify-full, overriding any `ssl` option passed here)
 * and prints a deprecation warning on every boot about that aliasing. We keep
 * exactly that behaviour — verified TLS — but state it explicitly, so the
 * warning goes away and no future pg upgrade silently weakens it.
 * URLs without sslmode keep the previous unverified-TLS default; sslmode=disable
 * (e.g. a local database) is left untouched.
 */
function tlsConfig(connectionString: string): { connectionString: string; ssl?: boolean | { rejectUnauthorized: boolean } } {
  try {
    const url = new URL(connectionString);
    const mode = url.searchParams.get('sslmode');
    if (mode === 'disable') return { connectionString };
    if (mode && ['prefer', 'require', 'verify-ca', 'verify-full'].includes(mode)) {
      url.searchParams.delete('sslmode');
      return { connectionString: url.toString(), ssl: true };
    }
  } catch { /* not a URL form pg can't also parse — fall through */ }
  return { connectionString, ssl: { rejectUnauthorized: false } };
}

function makePool(): Pool {
  const connectionString = databaseUrl();
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Add it to .env.local (server-only).');
  }
  const pool = new Pool({
    ...tlsConfig(connectionString),
    max: connectionString === process.env.DATABASE_URL ? 5 : DIRECT_POOL_MAX,
    // The hosted database drops idle connections on its side; closing ours
    // sooner (and keeping live ones warm) avoids handing out a dead socket.
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  });
  // An idle client being cut off must not crash the server — just drop it.
  pool.on('error', (e) => console.warn('[pg] idle client error:', e.message));
  return pool;
}

export function getPool(): Pool {
  // The direct-host window has ended: back to the pooler on a fresh pool.
  if (global._pgPool && global._pgDirectUntil && Date.now() > global._pgDirectUntil) {
    global._pgDirectUntil = undefined;
    resetPool();
  }
  return (global._pgPool ??= makePool());
}

// Network blips (a pooled connection reset by the database, a dropped TLS
// socket) are retried on a fresh connection instead of failing the request.
const TRANSIENT = /ECONNRESET|EPIPE|ETIMEDOUT|ECONNREFUSED|Connection terminated|connection error|server closed the connection|socket hang up|timeout exceeded when trying to connect/i;
const TRANSIENT_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED', '57P01', '57P02', '57P03', '08000', '08003', '08006']);
function isTransient(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return !!err && (TRANSIENT_CODES.has(String(err.code)) || TRANSIENT.test(String(err.message || '')));
}

/** Run a parameterized query. Thin wrapper so callers don't import `pool` directly. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const attempts = 3;
  for (let i = 1; ; i++) {
    try {
      return await getPool().query<T>(text, params as never[]);
    } catch (e) {
      if (switchToDirectHost(e)) continue;
      if (i >= attempts || !isTransient(e)) throw e;
      console.warn(`[pg] ${(e as Error).message} — retrying (${i}/${attempts - 1})`);
      await new Promise((r) => setTimeout(r, 150 * i));
    }
  }
}
