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

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Add it to .env.local (server-only).');
}

declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

function makePool(): Pool {
  return new Pool({
    connectionString,
    // Prisma Postgres requires TLS. It uses a managed cert; we don't pin a CA.
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

const pool: Pool =
  process.env.NODE_ENV === 'development'
    ? (global._pgPool ??= makePool())
    : (global._pgPool ??= makePool());

export function getPool(): Pool {
  return pool;
}

/** Run a parameterized query. Thin wrapper so callers don't import `pool` directly. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as never[]);
}
