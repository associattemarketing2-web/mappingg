# Mappingg optimisation report (22 Nov 2026)

- **Plan:** `seo-doc/IMPLEMENTATION-PLAN.md`
- **Evidence:** `reports/seo-audit/2026-11-22-after-optimization-local/`, which holds:
  - the crawl and project report from the final build;
  - `ISSUES-BEFORE-AFTER.csv`;
  - `lighthouse-before/` and `lighthouse-after/`;
  - `tests/`.

**Status:**
- All changes are uncommitted and nothing has been deployed.
- No database records were changed.
- No DDL was run.

**Measurement setup:**
- Every number below comes from local `next start` production builds run against the production database (read-only use).
- "Before" is `HEAD` (`f8d10ca`); "after" is the working tree.
- These are lab results only. There is no field data, because Search Console returns 403 and PageSpeed Insights returns 429.

## 1. Issues fixed

| Audit item | Fix | Verified |
| --- | --- | --- |
| SEO-4: 928 project images blocked by `/api/` in robots.txt | Crawlable public addresses: `/media/pins/<id>` (rewrite to `/api/media`) and `app/media/project/[...path]` (public `project-media` bucket, image files only, PDFs return 404). `/api/` stays disallowed. | `og:image` under `/api/`: 928 → 0. HTTP 200 with `image/webp` / `image/jpeg`. |
| Photo CDN caching | `s-maxage` added for the public `project-media` bucket only. Private buckets stay `private, no-store`. | Response headers checked |
| SEO-5: logos instead of photos | Official cover and gallery from `projects.gallery_urls` (`lib/seo/project-media.ts`). Used in OG/Twitter images and in the schema `image[]`. Alt text: "<project>, <locality> — project photo N". The logo remains the fallback. | 330 projects have photos |
| SEO-1: locality and developer pages | Restored `/locations`, `/locations/[slug]`, `/developers`, `/developers/[slug]`. Only indexable hubs are listed or linked (≥3 projects, or a written area guide). Titles follow "Flats & New Projects in X, City". Old facet URLs now 308 to their hub; `/cities/*` still goes to `/projects`. | 44 locality and 56 developer hubs in the sitemap |
| SEO-6: internal linking | Project pages: breadcrumb Home › Locality › Project, plus "All projects in X" and "More by <developer>" links. Header gets a "Localities" link; mobile home gets "Top Developers". | Projects with ≤3 inbound links: 285 → 16 |
| SEO-2 / PERF-3: SEO pages not cached | **Cause found:** list pages read `searchParams` (`?page=N`), and Next 14 built the detail pages as dynamic. **Fix:** `force-static` + ISR on detail pages, which a `dynamic = 'error'` production build confirmed is safe. `?page=N` is rewritten (`beforeFiles`) to internal `…/p/N` routes, so public URLs and canonicals are unchanged. | Every listing and detail route is ○/● in the build. `x-nextjs-cache: HIT`, `s-maxage=600`. |
| SEO-7: `llms.txt` stale | Now generated from live data (`app/llms.txt/route.ts`); `public/llms.txt` removed. | Counts match the database |
| SEO-8: schema | Added `offers` (`AggregateOffer`, INR), only when the page shows a cleanly parsed price; prices above ₹50 Cr are skipped as suspected data errors. Added `image[]`. | 0 schema errors in the crawl |
| SEO-10/11 | `noindex, follow` on `/delete-account`, `/developer-api/reference` and property-type hubs with fewer than 3 projects (these also leave the sitemap). | Crawl |
| PERF-1: map | Viewport culling plus grid clustering below zoom 13, with debounced updates. All data stays in memory, so search, filters, cards, share links and deep links are unchanged. Applied by `migration/patch-map-viewport.mjs` (idempotent). `?vp=0` restores the old behaviour. | 390 px: 932 → 136 DOM markers, 6,216 → 1,394 nodes. Search, filters, marker click, suggestion fly-to, `?pin=` deep link and cluster click all work; 0 JS errors. |
| SEO-3 / PERF-2: home pop-up and 4 MB video | Auto sign-in pop-up removed. The video plays only on wide screens and only once sign-in is opened. Mobile hero served as WebP. Blog card covers use 640 px WebP thumbnails (8.6 MB → 1.1 MB set; `scripts/build-blog-thumbs.mjs`). | Home page weight 6.4 MB → 1.6 MB, and no mp4 request on load |
| Guest map wall | Guests on `/map` explore freely and get 3 free project cards, the same rule the home page already used. Developer/agent approval and share links are unchanged. | Browser test |
| SEC-3 / SEC-4 | Anonymous `/api/db` accepts only plain filter values (operator objects return 400). Internal pin fields are stripped for visitors. | Tests plus a live check |
| SEC-2 | `rateLimitShared()` keeps counters in Postgres (`api_counters`), so per-account limits on login, OTP, reset and sign-up hold across serverless instances. Falls back to in-memory if the database is down. | PGlite tests |
| SEC-5 | `poweredByHeader: false` and a `Permissions-Policy` header | Response headers checked |
| SEC-1 (part) | `nodemailer` 6 → 10.6.1, verified offline with a stream transport | Prod audit: 24 → 23 findings |

## 2. Not fixed, and why

1. **Next 14 → 15.5.29 is not applied.**
   - A trial in a separate copy built after the official codemod (30 files).
   - It still leaves 47 type errors. Most are in the auth layer: `cookies()`/`headers()` become async in `lib/auth.ts`, `google-oauth`, `google-signup` and `activity`, and `req.ip` is gone from `rate-limit`. The rest are the `/api/v1` handler typing.
   - Real sign-ins can't be regression-tested without a staging database.
   - Current exposure: there are no Server Actions and no middleware, and `/_next/image` returns 404 in production. The other advisories still apply.
   - Do this upgrade on a branch with a preview deployment.
2. **`zod` 4 is deferred.** It is a major version used across many routes, and our schemas already cap collection sizes, which is what the advisory is about.
3. **The remaining highs are tooling.** They come from the ESLint toolchain and the Prisma 8 release-candidate CLI.
4. **An attempted `npm audit fix` was rolled back.** It downgraded `prisma` to a dev build outside the declared range, so I restored the original lockfile before applying only the nodemailer change.
5. **Database changes are not run (approval needed).** `doc_lite` and the map coordinate indexes; see §5.
6. **Data issues are not changed.** Examples: duplicate #24/#86, `LAUNCHING-SOON` stored as a RERA number, Cr/Lakh price errors, 3 empty pins, 90 stale `is_live` records, and 6 images in `/blog/flat-prices-in-pune-by-locality-and-bhk` pointing at a deleted Supabase project (broken on the live site too).
7. **The two-hop apex redirect** needs a Vercel domain setting, which is infrastructure.
8. **Content Security Policy is not added.** The legacy inline scripts need a report-only rollout first.

## 3. Lighthouse (mobile unless noted; same machine, same settings)

| Page | Perf | LCP | TBT | Weight | DOM |
| --- | --- | --- | --- | --- | --- |
| Home | 48 → 55 | 7.3 → 8.1 s | 640 → 268 ms | 6,414 → 1,663 KB | 1,584 → 1,589 |
| Home (desktop) | 86 → 89 | 1.8 → 1.9 s | 23 → 27 ms | 5,758 → 1,585 KB | |
| Map | 29 → 42 | 19.3 → 18.3 s | **7,466 → 688 ms** | 2,652 → 2,572 KB | 6,162 → 1,222 |
| Map (desktop) | 50 → 78 | 2.4 → 2.7 s | 1,429 → 0 ms | 4,627 → 4,189 KB | 6,210 → 1,115 |
| Project (no photos) | 82 → 83 | 3.6 → 3.6 s | 164 → 180 ms | 405 → 315 KB | |
| Project with gallery | 88 → 81 | 3.2 → 3.9 s | 1 → 181 ms | 388 → 435 KB | |
| Projects list | 87 → 91 | 2.8 → 2.7 s | | 206 → 153 KB | |
| Blog post | 88 → 91 | 3.0 → 2.9 s | | | |
| Kharadi locality (new) | 93 | 2.5 s | | 152 KB | |

**Notes:**
- Run-to-run noise on this machine is about ±4 points.
- **Gallery page:** the drop is the cost of showing real photos. I first trimmed them to a cover plus 4 thumbnails, placed below the overview.
- **Home LCP:** still dominated by render-blocking CSS, Font Awesome (`font-display: block`, 253 KB from cdnjs) and 166 KB of inline script.
- **Map LCP:** still the OpenStreetMap tile load.
- **CLS** is ≤ 0.02 everywhere.

## 4. Tests

- `npm test`: **217/217 pass**, including 9 new ones in `tests/optimization-nov22.test.ts`.
- `tsc`: 0 errors. Production build (lint + types): passes.
- **Browser runs, 15 pages × 5 widths (360/390/768/1024/1366):**
  - 70/75 pass: no horizontal overflow and no JS errors.
  - The 5 failures are the pre-existing broken Supabase images in one blog post.
- **Guests:** `/dashboard` and `/dashboard/s-admin` redirect to sign-in.
- **SEO crawl of the final build:** 1,167 URLs, 1,162 indexable, 0 broken links, 0 schema errors.
  - Issues: 66 → 36. 37 fixed; the open ones are listed in `ISSUES-BEFORE-AFTER.csv`.
  - New: 6 developer hubs with exactly 3 projects and the `/locations` index are just under 150 words.

## 5. Database steps prepared (each needs your approval)

Production data was checked read-only: all 937 pins have numeric lat/lng.

1. Back up the database (`backups` admin, or `pg_dump`).
2. `npm run db:doc-lite`
   - Idempotent. It rewrites `pins` (44 MB) and `developers` (37 MB) with a brief lock, so run it off-peak.
   - It must print `mismatches=0`.
   - Revert with `--revert`, or turn it off with `DOC_LITE=off`.
3. Optional: `migration/pg-indexes-map.sql`
   - `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, one statement at a time, outside a transaction.
   - It only helps `/api/map/pins`, which the map does not use.

## 6. Files

**Changed:**
- `next.config.mjs`, `app/sitemap.ts`, `app/page.tsx`, `app/mobile-home.css`, `app/seo.css`
- `app/projects/{page,[slug]/page,[slug]/layout}.tsx`, `app/blog/{page,[slug]/page}.tsx`, `app/status/[status]/page.tsx`, `app/property/[type]/{page,layout}.tsx`
- `app/delete-account/page.tsx`, `app/developer-api/reference/page.tsx`
- `app/api/db/route.ts`, `app/api/partners/storage/route.ts`, `app/api/auth/{login,otp,otp-login,otp-quick,reset-password,signup}/route.ts`
- `components/{MapAuthGate,SiteHeader,SocialLinks}.tsx`, `components/landing/mobile-sections.ts`
- `lib/rate-limit.ts`, `lib/seo/{entities,indexing,resolve-links,schema}.ts`
- `public/landing.js`, `public/legacy/public-map.json`, `package.json`, `package-lock.json`

**New:**
- `app/{locations,developers}/**`, `app/media/project/[...path]/route.ts`, `app/llms.txt/route.ts`
- `app/*/listing.tsx` and `app/*/p/[page]/page.tsx`
- `lib/seo/{public-media,project-media}.ts`, `lib/blog-thumb.ts`, `lib/blog-thumbs.ts`
- `migration/patch-map-viewport.mjs`, `scripts/build-blog-thumbs.mjs`
- `public/img/mobile-hero.webp`, `public/img/blog/thumbs/*`
- `tests/optimization-nov22.test.ts`

**Removed:** `public/llms.txt`

## 7. Remaining recommendations

1. Deploy to a preview and run a Search Console URL inspection on a locality page and a project page.
2. Enable the Search Console API.
3. Approve and run the `doc_lite` step.
4. Next 15 upgrade on a branch with a staging database.
5. Home page: self-host a subset of the Font Awesome font, and move the inline scripts to cacheable files.
6. Map tiles: move to a provider with an SLA.
7. Fix the D-items in the data.
8. Re-upload the 6 missing blog images.
