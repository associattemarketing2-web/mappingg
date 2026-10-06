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
}

function makePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Add it to .env.local (server-only).');
  }
  const pool = new Pool({
    connectionString,
    // Prisma Postgres requires TLS. It uses a managed cert; we don't pin a CA.
    ssl: { rejectUnauthorized: false },
    max: 5,
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
      if (i >= attempts || !isTransient(e)) throw e;
      console.warn(`[pg] ${(e as Error).message} — retrying (${i}/${attempts - 1})`);
      await new Promise((r) => setTimeout(r, 150 * i));
    }
  }
}
