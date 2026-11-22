# Mappingg — performance audit (22 Nov 2026)

Audit only; nothing was changed.

**Evidence:** `reports/seo-audit/2026-11-22-complete-audit/`
- `lighthouse/` holds the raw Lighthouse JSON
- `page-weight-ttfb.jsonl` holds the page-weight and TTFB measurements

**Measured vs estimated.** Every number in §1–§2 was measured on 22 Nov 2026 from this Windows machine against production:
- Lighthouse 12.8.2 with simulated throttling (mobile = Moto G Power profile, slow 4G).
- `fetch` timings.
- Read-only database statistics.

Lab results are not field data. There is no CrUX or Core Web Vitals field data:
- PageSpeed Insights returned 429 (daily quota exhausted).
- Search Console is unavailable.

**INP** cannot be measured in a lab run. TBT is shown as the lab proxy.

---

## 1. Lighthouse (lab, measured)

| Page | Form | Perf | FCP | LCP | TBT | CLS | Speed Index | Page weight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | mobile | **53** | 5.0 s | **11.0 s** | 250 ms | 0.001 | 8.6 s | **6,147 KiB** |
| `/` | desktop | 81 | 0.9 s | 2.3 s | 10 ms | 0.011 | 2.6 s | 5,738 KiB |
| `/map` | mobile | **28** | 5.3 s | **14.4 s** | **7,500 ms** | 0.002 | 7.7 s | 1,731 KiB |
| `/map` | desktop | 50 | 1.0 s | 2.5 s | 2,230 ms | 0 | 2.5 s | 3,323 KiB |
| `/projects/1-residency-by-burgundy-mundhwa-2` | mobile | 91 | 2.5 s | 2.9 s | 80 ms | 0 | 2.5 s | 398 KiB |
| `/projects` | mobile | 93 | 1.2 s | 1.6 s | 290 ms | 0 | 2.0 s | 176 KiB |
| `/blog/flat-prices-in-pune-by-locality-and-bhk` | mobile | 97 | 1.3 s | 1.6 s | 190 ms | 0 | 2.1 s | 280 KiB |

Accessibility, best-practice and SEO categories (mobile):

| Page | Accessibility | Best practices | SEO |
| --- | --- | --- | --- |
| Home | 92 | 100 | 100 |
| Map | 98 | 96 | 92 |
| Project, projects list, blog | 100 | 100 | 100 |

## 2. Server and delivery (measured)

| Page | CDN cache | TTFB (two consecutive hits) | HTML (raw / brotli) | First-party JS (brotli) |
| --- | --- | --- | --- | --- |
| `/` | HIT | 146 / 25 ms | 278 KB / 34 KB | 132 KB |
| `/map` | HIT | 249 / 21 ms | 33 KB / 6 KB | 135 KB |
| `/projects` | **MISS / MISS** | 289 / 370 ms | 102 KB / 12 KB | 122 KB |
| `/blog`, blog post | **MISS / MISS** | ~260–320 ms | 71–103 KB | 124 KB |
| `/status/*`, `/property/*` sub-pages | **MISS / MISS** | ~270–340 ms | 47–102 KB | 122 KB |
| Project page | **MISS** (`private, no-store`) | crawl p50 563 ms, p90 2,031 ms, max 7,690 ms | 46–69 KB | 132 KB |

Database facts (read-only, `pg_stat_user_tables` and `pg_column_size`):

| Fact | Value |
| --- | --- |
| `pins` | 937 rows, 44 MB. The `doc` column averages 35.8 KB per row (max 290 KB) because base64 developer logos are stored inline |
| `developers` | 960 rows, 37 MB |
| `partners_media` | 934 MB |
| `backups` | 601 MB |
| `pins_history` | 80 MB |
| `doc_lite` generated column | **not present**: `pins` has only `id` and `doc` (fix coded on 20 Nov, never applied) |
| `pins_latlng` / `pins_latlng_visible` indexes (`migration/pg-indexes-map.sql`) | **not present** |
| Lifetime sequential scans | `map_settings` 347,003 (a 1-row table), `pins` 300,744, `posts` 138,733, `users` 112,954 |

---

## 3. Findings

### PERF-1 — Critical (map): every pin is loaded, and every pin becomes a DOM marker
- **Where:**
  - `public/legacy/public-map.json`, the inline map app (171 KB). It uses Leaflet 1.9.4 from unpkg.
  - It loads all pins through `public/db-shim.js` → `GET /api/db` `from('pins').select(PIN_LIGHT_COLS)`.
  - `PIN_LIGHT_COLS` includes `description`, `key_usp`, `custom_fields`, `field_visibility`, `image` and `brochure_*`. That is most of the record.
- **Evidence:**
  - The pins response is 1,170,981 bytes raw and 229,731 bytes brotli. It took 2.0 s on a cache miss.
  - Each pin is an `L.divIcon` DOM marker, with no clustering library (`markercluster` is absent).
  - Lighthouse mobile counted 6,198 DOM elements and 316 requests (one image request per marker logo).
  - Main-thread work was 20.2 s. The longest task was 2,214 ms, and TBT was 7.5 s.
  - `app/api/map/pins/route.ts` is a server-clustered, viewport-bounded endpoint that already exists. **The map does not use it.**
- **Impact:** the map is the core product, and it is the slowest page:
  - mobile Performance 28
  - LCP 14.4 s
  - INP will be poor while the markers build.

### PERF-2 — High: the home page downloads a 4.1 MB video, has render-blocking CSS, and loads two icon fonts
- **Where:** the home markup (`app/page.tsx` → `heroHtml`/`restHtml`, `public/landing.js`).
- **Evidence (Lighthouse mobile):** 118 requests totalling 6.1 MB.

  | Resource | Size |
  | --- | --- |
  | `/video/how-mappingg-works-v1.mp4` | 4,141 KiB |
  | `/img/mobile-hero.jpg` | 235 KiB |
  | Font Awesome solid and brands fonts from cdnjs | 147 + 106 KiB |
  | 160 `<img>` tags (142 lazy) | — |

  Lighthouse savings estimates:
  - Render-blocking resources: 1,010 ms
  - Modern image formats: 530 KiB
  - Responsive images: 265 KiB
  - Off-screen images: 136 KiB

  The LCP element is the hero copy block. LCP is 11.0 s.

### PERF-3 — High: SEO pages are never cached at the CDN
- Same finding as SEO-2.
- **Effect:**
  - Every project, blog and listing view is a server render plus DB reads (the in-process `cachedRead` still saves the DB).
  - A cold render takes up to 7.7 s.
- **Fix direction:** find what makes these routes dynamic (`next build` route table) and restore ISR.

### PERF-4 — High: the pin and developer rows are heavy, and the light-column fix was never applied
- **Where:** `migration/pg-doc-lite.sql` (`npm run db:doc-lite`) and `lib/mongo-compat.ts` `liteColumn()`.
- **Evidence:** no `doc_lite` column exists. The 20 Nov test on a temporary copy measured the pin list read dropping from 1,280 ms to 215 ms.
- **Impact:** every non-image read of `pins` or `developers` de-TOASTs about 35 KB per row.

### PERF-5 — Medium: the map coordinate indexes are missing
- `migration/pg-indexes-map.sql` (`pins_latlng`, `pins_latlng_visible`) is not applied.
- It matters as soon as the map switches to viewport queries (PERF-1).

### PERF-6 — Medium: image optimisation is switched off
- `next.config.mjs` sets `images: { unoptimized: true }`, so images go out without AVIF/WebP or responsive sizes.
- Lighthouse estimates 530 KiB (home) and 472 KiB (map) of modern-format savings.
- The map also loses 383 KiB to off-screen images.

### PERF-7 — Medium: third-party scripts and tiles on the critical path
- Leaflet JS/CSS come from `unpkg.com`, and Font Awesome from `cdnjs`.
- On mobile, `leaflet.js` boot-up took 4,736 ms. Third-party code blocked the main thread for 2,320 ms (map, desktop).
- Map tiles come directly from `{a,b,c}.tile.openstreetmap.org`. The OSM tile usage policy does not allow heavy production use. This is a reliability and blocking risk, not only a speed one.

### PERF-8 — Medium: large inline scripts
- The home page has 166 KB of inline script and the map 171 KB (`public/legacy/*.json` inline code).
- Inline code is re-parsed on every visit and cannot be cached separately.

### PERF-9 — Low: database bloat
- `partners_media` (934 MB) and `backups` (601 MB) sit in the primary Postgres database.
- They add to backup and restore time and to plan storage. They do not slow the public pages.

### PERF-10 — Low: hot reads on tiny tables (historic)
- `map_settings` (1 row) has 347k sequential scans and `posts` 138k.
- These are lifetime counters, so they include the period before the October caching fix (`lib/data-cache.ts`).
- To confirm the fix holds, take before/after deltas around a crawl.

### What already works
- Brotli compression is on.
- Static assets carry long cache headers (`img`, `icons`, `video`, `og`: 7 days plus SWR).
- Public `/api/db` reads are cached at the CDN (`s-maxage=300`, HIT observed).
- `lib/data-cache.ts` caches public reads across requests.
- CLS is about 0 on every tested page.
- Project, listing and blog pages score 91–97 on mobile.

## 4. Map and filter checks (from the code)

| Check | State |
| --- | --- |
| Initial map load | Full pin set (PERF-1), then a marker per pin |
| Pin clustering | None on the public map (a server-side grid exists only in the unused `/api/map/pins`) |
| Viewport-based fetching | Not used |
| Marker images | Lazy-loaded logos through `/api/media` (CDN-cached, but one request per marker) |
| Filters and search | Client-side over the in-memory pin array, with no network calls. Cost scales with DOM marker updates. |
| Full-page reloads | Not observed. Navigation uses Next `<Link>`; the home page embeds `/map?embed=home` in an iframe (a second app boot) |
| Memory leaks | Not measured. The legacy code registers listeners with `__cleanups`; no heap profiling was done |
