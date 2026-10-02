// The app has moved from MongoDB to PostgreSQL. This module used to open a
// MongoDB connection; it now re-exports the Postgres-backed, Mongo-compatible
// data layer so the ~20 existing `import { getDb } from '@/lib/mongodb'` call
// sites keep working unchanged. See lib/mongo-compat.ts for the implementation
// and lib/pg.ts for the connection pool.

export { getDb } from './mongo-compat';
export type { Db } from './mongo-compat';
