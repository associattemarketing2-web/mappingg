# Mappingg — Performance & Architecture Audit

_Audit date: 2026-10-03. Based on direct source inspection, not assumptions._

> **Read this first.** Several assumptions in the brief do not match the actual
> codebase. The app is already well past the "naive" stage — a lot of
> performance work has already been done (expression + GIN indexes, media
> externalised to cacheable URLs, an in-process read cache, HTTP cache headers,
> ETag/304 bundle loading, a network-first service worker, a lightweight pin
> projection). The audit below documents what is really there and where the
> genuine scaling risks are for 5,000+ pins.

---

## 0. Assumptions in the brief vs. reality

| Brief says | Reality in the code |
| --- | --- |
| "Real Google Maps integrated" | The **public map is Leaflet** (`public/legacy/public-map.json`, 43 `leaflet` refs). Google Maps is only used in the **admin team-editor** (`team-editor.json`). |
| "Pins are React components / markers" | The map is **not React**. It is the original standalone HTML/JS Supabase app, injected into the DOM at runtime by `components/LegacyApp.tsx` from a ~150 KB JSON bundle. React.memo/useMemo/Server-Component advice **does not apply** to the markers. |
| "Property cards use images/video; optimize with next/image" | `next.config.mjs` sets `images: { unoptimized: true }` on purpose, because the ported markup uses raw `<img>`/`data:` URLs. `next/image` is not in play on the map. |
| "Database/data loading slow, map lags" | For ~200 pins the DB is **not** the bottleneck (small tables, cached, indexed). The real 5,000-scale risks are (a) **initial pin payload size** and (b) **Leaflet rendering all markers as DOM nodes with no clustering**. |
| "MongoDB code may be unused" | MongoDB is **gone at runtime**. `lib/mongodb.ts` re-exports `lib/mongo-compat.ts`, a Mongo-shaped API implemented **over Postgres JSONB**. The `mongodb` npm dep is only used by migration scripts. |

---

## 1. Current architecture

```
Browser
 ├─ Next.js 14.2.15 (App Router, Node runtime)
 │   ├─ Public pages (/, /about, /blog, ... ) — mostly server components + CSS
 │   ├─ /map, /mundhwa-map-3d  → <LegacyApp slug> injects a legacy HTML/JS app
 │   │       bundle from /public/legacy/*.json into the live document
 │   ├─ /s-admin, /dashboard   → React admin/dashboard components
 │   └─ /intake, /submit        → static vanilla-JS apps under /public/partners
 │
 ├─ Data access: ALL table traffic goes through ONE generic endpoint
 │      /api/db?op={table,action,columns,filters,order,limit}
 │   - Client legacy JS uses a Supabase-compatibility shim (/public/db-shim.js)
 │   - Server validates the op with zod, authorizes by table/role, runs it
 │
 └─ Service worker (/public/sw.js): network-first, cache fallback, PWA install
        ↓
Next.js API routes (app/api/**)  ──>  lib/db-engine.ts  (Mongo-style ops)
        ↓                                      ↓
  lib/auth.ts (JWT cookie)             lib/mongo-compat.ts  (Mongo API → SQL)
                                               ↓
                                         lib/pg.ts  (pg Pool, max 5)
                                               ↓
                                 Prisma Postgres (pooled, JSONB doc tables)
```

Every former Mongo collection is a Postgres table shaped `(id text PK, doc jsonb)`.
The whole record lives in `doc`; filtering/sorting happen on `doc->>'field'`.

**Auth:** custom — bcrypt passwords in `users`, a signed JWT (`jose`, HS256) in
an HttpOnly/SameSite=Lax cookie (`mg_session`). Roles: `admin`/`employee`
(staff) and `buyer`/`developer`/`agent` (public). There is **no Next.js
middleware**; each route/page guards itself via `getStaffUser()`/`getCurrentUser()`.

---

## 2. Main performance bottlenecks (ranked by real impact at 5,000 pins)

1. **No marker clustering / viewport culling in the Leaflet map.** All pins
   become DOM markers at once. ~200 is fine; 5,000 DOM markers will jank on
   pan/zoom, especially on tablets/phones. **This is the #1 scaling risk.**
2. **Initial pin payload is "light" but still fat.** `PIN_LIGHT_COLS` (in the
   legacy bundle) includes `description`, `key_usp`, `custom_fields`,
   `whats_available`, `configuration`, `location`, etc. At 5,000 rows that is a
   multi-MB JSON download before a single marker appears — directly against the
   brief's "don't send descriptions in the initial map payload."
3. **No viewport/bounds API.** `/api/db` can only do `select *`-style ops with
   `eq`/`in` filters — it cannot do a `lat/lng BETWEEN bounds` query. Every
   visitor fetches *every* pin regardless of what's on screen.
4. **Service worker has no navigation timeout.** Network-first with no timeout
   means on a slow/flaky mobile link a navigation hangs on the network round
   trip → the exact "PWA pages sometimes don't load / blank" symptom reported.
5. **Full-table duplicate of the repo** under `mapping/` (199 files, identical
   to root) inflates the repo, slows tooling, and risks editing the wrong copy.

---

## 3. Database bottlenecks

- **JSONB-only schema.** Good general choice given the migration, and GIN +
  expression indexes already exist (`migration/pg-schema.sql`). Containment and
  single-key equality lookups are fast.
- **No range index usable for map bounds.** There is no index on
  `(doc->>'lat')::float, (doc->>'lng')::float`, and the query engine
  (`mongo-compat.ts`) can only emit `=`, `IN`, `!=`, `exists`, `regex` — **no
  `BETWEEN`/`<`/`>`**. So a viewport query is not expressible today.
- **Projection still reads whole rows.** `projectExpr()` builds the subset with
  `jsonb_build_object(...)` but Postgres still reads the full `doc` (including
  big base64 fields if any remain inline) before projecting. Media is already
  externalised (`lib/pin-media.ts`), which mitigates the worst of this.
- **`countDocuments` = `COUNT(*)` with a WHERE** on `doc->>'...'`. Fine at
  hundreds of rows; for large admin tables (leads) it will need the expression
  index to exist for the filtered column.
- **Connection pool `max: 5`.** Reasonable for a pooled Prisma Postgres, but
  worth revisiting under real concurrency.
- The in-process read cache (`db-engine.ts`, 30 s TTL, public tables only) is a
  solid mitigation and is correctly invalidated on write.

## 4. Map (Leaflet) bottlenecks

- **No clustering** (no `markercluster`/`supercluster`) and **no canvas
  renderer** (`preferCanvas`/`L.canvas` absent). Default DOM markers.
- **No bounds-based loading** — see §3.
- Pins are fetched once with `PIN_LIGHT_COLS`; full `image`/`brochure_image`
  are correctly lazy-loaded per id on demand (`select('id,...,image,...').in('id', ids)`).
  That lazy-media design is good and should be preserved.

## 5. API bottlenecks

- **Single generic `/api/db` endpoint** is flexible but prevents purpose-built,
  cacheable, bounds-aware endpoints. No pagination primitive beyond `limit`.
- Admin screens (leads, submissions, stats) each hit `/api/db` with `select *`
  then filter/sort client-side in some cases — fine now, won't scale to
  thousands of leads without server-side pagination.
- Good: zod validation on every op; table-name regex whitelist blocks SQL
  injection on identifiers; values are parameterised.

## 6. Frontend rendering bottlenecks

- `LegacyApp` injects ~150 KB of HTML/JS/CSS and dispatches synthetic
  `DOMContentLoaded`/`load`. It is already guarded against Strict-Mode double
  boot and uses ETag/304 revalidation for the bundle. Good.
- Public info pages are light. The heaviest client payload is the legacy map
  bundle itself.

## 7. Image / video bottlenecks

- Already strong: inline `data:` images are stripped server-side and served as
  content-versioned, long-cached URLs via `/api/media/[table]/[id]`
  (`lib/pin-media.ts`). Initial pin list no longer ships base64.
- `youtube_video_url` is a field, so video is embedded on demand, not
  auto-downloaded. Good.
- Gap: no explicit width/height on legacy `<img>` → potential layout shift;
  `images: { unoptimized: true }` means no responsive `srcset`.

## 8. PWA bottlenecks

- `sw.js` is network-first with cache fallback — correct for freshness, but
  **no timeout** on the network fetch (see §2.4). On slow links a navigation can
  appear to hang/blank.
- App shell precache is minimal (`/`, `/map`, `/mundhwa-map-3d`, shims,
  manifest). Reasonable.
- Correctly never caches `/api/` or `/rest/` (private/dynamic). Good — no
  stale-admin-data risk.

## 9. SEO issues

- Good foundation: `app/sitemap.ts`, `app/robots.ts`, `app/manifest.ts`,
  per-page metadata, `X-Robots-Tag: noindex` on `/s-admin`, `/intake`,
  `/submit`, `/signin`, `/partners/*` (via `next.config.mjs`).
- Gaps to verify per page: canonical tags, OpenGraph/Twitter coverage, and
  whether individual property/project pages exist as crawlable URLs (the map is
  a single JS app — individual pins are `?pin=<id>` state, not indexable routes).

## 10. Responsive issues

- Legacy map CSS already uses `clamp()` for the property card width and
  viewport-fixed WhatsApp/Call buttons — mobile-aware.
- Not yet verified at every breakpoint (320–1920px) across admin tables and
  dashboard — flagged for a dedicated pass (Phase 11).

## 11. Admin / S-admin issues

- Admin screens read via `/api/db` with broad selects; no server-side
  pagination/search for large lead/submission tables → will not scale to
  thousands of rows.
- No real-time mechanism yet; data refreshes on navigation/manual reload.

## 12. Recommended architecture (incremental, non-rewrite)

1. **Add a purpose-built, bounds-aware map endpoint** `GET /api/map/pins`
   returning only marker essentials (`id, lat, lng, title, type, status, price,
   highlighted`). Keep `/api/db` for everything else. This requires a small raw
   SQL query (bypassing the `eq/in`-only shim) — additive, no rewrite.
2. **Trim `PIN_LIGHT_COLS`** in the legacy bundle to true marker fields; move
   `description`/`key_usp`/`custom_fields` to the existing per-pin click fetch.
3. **Add Leaflet clustering** (`Leaflet.markercluster`) or a canvas renderer in
   the legacy bundle — the single biggest 5k-pin win.
4. **Add a lat/lng expression index** to support (1).
5. **Give the service worker a navigation timeout** → fixes the blank-PWA bug.
6. **Server-side pagination/search** for admin lead/submission tables.
7. **Google OAuth** layered onto the existing JWT-cookie session (not a
   replacement).
8. **Delete the duplicate `mapping/` tree** (after confirmation).

## 13. Changes actually implemented in this pass

See `PERFORMANCE_OPTIMIZATION_REPORT.md`. Implemented so far (safe, no UI/business
change, no prod data touched):

- Service worker navigation timeout + smarter offline fallback (PWA blank-page fix).
- `.env.example` documenting all required/optional env vars (incl. Google OAuth).
- `migration/pg-indexes-map.sql` — additive lat/lng expression index for a future
  bounds query (delivered as a migration, **not** auto-applied to production).

Larger items (clustering, bounds endpoint, OAuth, admin pagination, real-time,
repo de-dup) are **proposed with a prioritized plan** and await your go-ahead
because each touches the frozen legacy bundle, production data, or a product
decision.

## 14. Before/after measurements

Not yet measured against production. Load testing and Lighthouse require a safe
test environment and your confirmation (the DB is a managed Prisma Postgres; I
will **not** run load tests or `EXPLAIN ANALYZE` against production without
explicit approval, and will **not** insert fake production records). Measurement
plan is in the optimization report.
