# Mappingg — Performance Report (20 Nov 2026)

Companion to the earlier `PERFORMANCE_AUDIT.md` / `PERFORMANCE_OPTIMIZATION_REPORT.md`
(3 Oct). Every number below was measured in this pass. Nothing was estimated, and no
artificial delays or fake loading states were added.

## 1. What the audit found

The app has already had a lot of performance work done. That includes in-process and
Vercel data caching (`lib/data-cache.ts`), CDN headers on public reads, ISR on most
public pages, lazy popup cards, single-flight cache refreshes, and polling at 2 to 5
minutes instead of 15 s. The remaining real bottlenecks were these:

| # | Bottleneck | Evidence |
|---|---|---|
| 1 | **Every pin read unpacks ~35 KB of base64 per row.** Logos and brochures live inside `pins.doc` (32 of 33 MB). Postgres must fetch and decompress the whole document for *any* field, then md5-hash the base64 on every list query. `developers` has the same problem (34 KB/row, 69k sequential scans). | Map pin list: **1,130–1,280 ms in the DB**. Production cold TTFB **3.6 s** (4.4 s total, 1 MB / 192 KB gz). Warm CDN hit: 70 ms. |
| 2 | Staff and admin reads bypass the CDN (by design: fresh, unhidden data). So the editor and dashboards pay cost #1 on every load. | Same 1.1 s+ per pin list for staff |
| 3 | The map loads every marker logo at once: ~887 `/api/media` thumbnails, even for markers off-screen. | 0.73 s per cold thumbnail on the CDN |
| 4 | **Home → "Projects near you" jumps.** The locality picker unmounted while loading. Switching locality replaced the cards with a skeleton. A slow older response could overwrite a newer one (no abort). | Code inspection (`NearbyProjects.tsx`) |
| 5 | **Admin tables flash and lose scroll.** Blog posts, Employees and Leads replaced the whole table with a "Loading…" spinner on every reload, including after each save, delete or Refresh. | Code inspection (`AdminApp.tsx`) |

Things I checked that are **not** bottlenecks at the current scale:
- **Bundle size:** 87 KB shared, `/map` 91 KB, home 109 KB. Only the staff-only admin dashboard is large (236 KB).
- **Home page:** ISR, 40 ms TTFB locally.
- **Connection pool, N+1s:** none found on hot paths.
- **Duplicate fetches:** the map's parallel `Promise.all` boot is already correct.

## 2. Changes made

### A. Database: `doc_lite` light column (biggest win; needs one command from you)
- `migration/pg-doc-lite.sql` adds a **STORED generated column** `doc_lite` to `pins` and
  `developers`. It holds the same document, with each inline image replaced by the exact
  md5 digest the app already computed on the fly. Postgres keeps it in sync on every
  write, and the app never writes it. The change is additive: no record changes and no
  data is lost.
- `lib/mongo-compat.ts` sends any read that doesn't need raw image bytes to `doc_lite`.
  That includes all list reads, counts, the map's change-poll and the developer
  directory. Reads that *do* need the bytes still use `doc`: the media route, copying a
  logo with `autoLogo`, filters on an image field, and backups/history.
- The code detects the column, so behaviour before the migration is exactly as it is
  today. `DOC_LITE=off` is a kill switch.
- `/api/admin/pins-data` and `/api/map/pins` (raw SQL) use it too.
- **Output is byte-identical.** The image URLs (`?v=<md5>`) don't change, so browser and
  CDN caches stay valid.

Measured on production data (session-only TEMP copy, median of 5 runs, includes ~57 ms network round-trip):

| Query | Before | After | Identical output |
|---|---|---|---|
| Map pin list (`/api/db` pins) | **1,280 ms** | **215 ms** | ✅ |
| Map change-poll (`id,updated_at`) | 181 ms | 95 ms | ✅ |
| Admin Pins Data list | 156 ms | 79 ms | ✅ |
| Stored size read | 33 MB | 1.16 MB | — |

### B. Map: lazy marker logos
`public/legacy/public-map.json`: marker `<img>` now has `loading="lazy" decoding="async"`.
Off-screen markers no longer download their logos at load. Markers have a fixed CSS size,
so there's no layout shift. This is the only change in the bundle; I verified it with a
semantic diff and a syntax check.

### C. Home page "Projects near you": no more jumping
`components/landing/NearbyProjects.tsx` and `app/home-finder.css`:
- The picker stays mounted at all times.
- When switching locality, the current cards stay in place (dimmed, `aria-busy`) until
  the new ones arrive. The carousel isn't remounted, so its scroll position is kept.
- Each new request aborts the previous one (AbortController plus a sequence guard).
  A late geolocation fix can't override a locality the visitor just picked.

### D. Admin dashboard: no flashing tables
`components/admin/AdminApp.tsx`: Blog posts, Employees and Leads show the spinner only
before the first load. On a refresh the rows stay where they are, the Refresh icon spins,
and the leads pager stays visible.

### E. Regression test
`tests/doc-lite.test.ts` runs on real Postgres (PGlite) and checks:
- light reads equal full reads (public list, staff list, single row, count, `$or`);
- the light path is really taken, and no md5 runs over base64;
- raw-image reads and image filters still use `doc`;
- a normal app write updates the light copy and gives a new versioned image URL;
- the revert is clean.

## 3. Verification

| Check | Result |
|---|---|
| `npm test` | **204 / 204 pass** (203 before, plus the new test) |
| `tsc --noEmit` | clean |
| ESLint on changed files | clean |
| `next build` | passes; bundle sizes unchanged |
| Local prod server smoke test | `/`, `/map`, `/projects`, `/blog`, `/api/db` pins (934 pins, same image URLs as production), `/api/map/pins`, `/api/nearby` all return 200 |

**Not measured:** browser LCP, INP and CLS. I didn't drive a real browser in this pass,
so I'm not reporting numbers for them. The CLS fixes in C and D remove the mount/unmount
swaps that caused the jumps. Please check them with Lighthouse or the Web Vitals panel
after deploying.

## 4. To finish (needs you)

1. **Apply the DB migration** (the permission system stopped me from changing the live
   database myself):
   ```
   npm run db:doc-lite
   ```
   It applies the SQL, checks every row for mismatches (it should print
   `mismatches=0`), and prints before/after timings. Undo it with
   `node --env-file=.env migration/apply-doc-lite.mjs --revert`, then redeploy. The
   change briefly locks `pins` and `developers` while each table is rewritten (seconds),
   so run it at a quiet time.
2. Deploy. Nothing else needs to be in a particular order: the code works with or
   without the column.

## 5. Deliberately not done, and why

- **Viewport-only pin loading / server clustering on the public map.** There are 934
  pins. Map search, suggestions and locality filters all run over the full in-memory
  list, so viewport loading would break search unless search moves server-side. Once
  the pin list is fast and cached at the CDN, the full list is the right design at this
  size. Revisit at ~5,000 pins. `/api/map/pins` (bounds plus grid clustering) already
  exists for that.
- **Marker clustering.** This is a visible design change (pins would merge into bubbles)
  and needs a real-browser test on the legacy Leaflet app. It's out of scope under
  "don't redesign".
- **Moving images out of `doc` entirely** (to the CDN, using the existing
  `image_meta` migration path). That's the long-term fix and would also shrink backups,
  but it's a data migration. `doc_lite` gets most of the read-side benefit with no data
  change.
- **`/projects` and `/blog` are dynamic** (~0.3–0.4 s TTFB) because they read
  `searchParams`. Their data is already cached, so the time is render time. That's
  acceptable, and the fix (static paginated routes) changes URLs and SEO.

## 6. Remaining bottlenecks

1. Cold `/api/media` thumbnails (~0.7 s each, server-side resize) until the images move to the CDN.
2. The public pin list is still ~1 MB raw / 190 KB gzipped (descriptions, USPs and custom
   fields are included for search and cards). Splitting those out needs changes to the
   legacy bundle's search.
3. `partners_media` (934 MB) and `backups` (600 MB) dominate storage. They aren't on hot
   paths, but they affect backup and restore times.

## Files changed
- `lib/mongo-compat.ts`: `doc_lite` routing (`LITE_MEDIA`, `liteTables`, `liteColumn`)
- `app/api/admin/pins-data/route.ts`, `app/api/map/pins/route.ts`: light reads
- `migration/pg-doc-lite.sql`, `migration/apply-doc-lite.mjs`, `package.json` (`db:doc-lite`): new
- `public/legacy/public-map.json`: lazy marker logos
- `components/landing/NearbyProjects.tsx`, `app/home-finder.css`: stable section, abortable requests
- `components/admin/AdminApp.tsx`: tables stay mounted on refresh
- `tests/doc-lite.test.ts`: new
