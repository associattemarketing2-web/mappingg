import { revalidateTag, unstable_cache } from 'next/cache';

// Shared cache for public website data (projects, blog posts, site settings).
//
// Prisma Postgres bills every query as an "operation". Pages that read
// ?page= (blog, projects, developers, status, property, cities) are rendered on
// every request in Next 14, so without this each visit — and each crawler hit —
// re-ran the same queries. unstable_cache keeps the result in Next's data cache,
// which on Vercel is shared by every server instance, so the database is read
// about once per `revalidate` window instead of once per page view.
//
// Every write to a table clears its tag right away (bustTable, called from
// invalidateTable in lib/db-engine.ts and from the blog/settings writers), so
// admin edits still show up at once. `revalidate` is only the safety net for
// writes made outside the app (e.g. migration/seed-blogs.mjs).

const tagOf = (table: string) => `db:${table}`;

/**
 * Wraps a public data loader in the shared cache. `fn` must throw on a failed
 * read (never return a fallback), so an outage is never cached as "no data".
 * Outside a Next.js request (scripts, tests) it just calls `fn`.
 */
export function cachedRead<A extends unknown[], R>(
  key: string,
  tables: string[],
  revalidate: number,
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  const cached = unstable_cache(fn, [key], { tags: tables.map(tagOf), revalidate });
  return async (...args: A) => {
    try {
      return await cached(...args);
    } catch (e) {
      // No Next.js cache in this context (script/test): read directly.
      if (/incrementalCache missing|static generation store missing/i.test(String((e as Error)?.message))) return fn(...args);
      throw e;
    }
  };
}

/** Drops cached public reads of `table` everywhere. Safe to call from any context. */
export function bustTable(table: string): void {
  try {
    revalidateTag(tagOf(table));
  } catch {
    /* outside a Next.js request (script/test) — nothing cached to clear */
  }
}
