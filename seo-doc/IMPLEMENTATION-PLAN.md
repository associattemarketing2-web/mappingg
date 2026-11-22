# Mappingg — implementation plan (22 Nov 2026)

This plan is based on the 22 Nov audit (`MAPPINGG-COMPLETE-TECHNICAL-AUDIT.md` and its five sub-reports). It also uses the evidence in `reports/seo-audit/2026-11-22-complete-audit/`.

Every recommendation was re-checked against the code at `main` `f8d10ca`. Nothing has been committed since the audit, so no recommendation was already done.

## Ground rules for this work

- **No production database writes, DDL or deployment.** These are prepared and documented, then wait for explicit approval.
- **Builds and production-mode tests run in a scratch copy.** A dev server is running on `:3000` (PID 11744), and a build in the repo would overwrite its `.next` folder. The scratch copy lives at `<scratchpad>/build` and links to the repo's `node_modules`.
- **Measure before and after in the same way.** Lighthouse 12.8.2 runs on the same machine against the same local `next start` build. These are lab numbers, not field data.
- **Keep every change small and reversible.** Map changes ship as a script-based patch with a kill switch (`?vp=0`).

## Facts verified before planning

| Audit item | Verified now | Effect on the plan |
| --- | --- | --- |
| SEO-4: images blocked by `Disallow: /api/` | Pin images are served by `app/api/media/[table]/[id]/route.ts`. Gallery photos are served by `app/api/partners/storage/route.ts` (`bucket=project-media&public=1`, which is public by design). The `project-media` response sends `public, max-age=86400` with **no `s-maxage`**, so Vercel's CDN never caches it and every view reads image bytes from Postgres (`partners_media`). | Add crawlable `/media/...` rewrites for **public images only**, and add `s-maxage` to the public media response. `/api/` stays disallowed in robots.txt. |
| SEO-5: project pages show logos | `projects.gallery_urls` exists for 330 linked projects and `cover_image_url` for 361. All are `/api/partners/storage?...&public=1` URLs. | Join on `pins.intake_project_id → projects.id` (live rows only), through a cached reader. |
| SEO-1: locality and developer pages removed | They were removed on purpose by a collaborator in `11c7dac` (pages deleted) and `d6032e0` (links and sitemap entries removed, redirects added), on 4 Nov. The group builders (`getLocalityGroups`, `getDeveloperGroups`), the thin-page rules (`lib/seo/indexing.ts`), the area guides and `EntityListing` all still exist. | Restore `/locations/*` and `/developers/*` from `11c7dac^`, adapted to current code. City and facet pages stay redirected. |
| PERF-1: map loads every pin as a DOM marker | `public/legacy/public-map.json`: `renderPin()` creates an `L.marker(...).addTo(map)` for every pin. Filters and search show and hide markers through `map.addLayer`, `map.hasLayer`, `map.removeLayer` and `marker.addTo(map)`. Search, filters, the area lists, "nearby", compare and share all work on the in-memory `pins` array. | Use **viewport culling plus clustering on the client**. Moving the data fetch to `/api/map/pins` is not safe; see Phase 2. |
| `/api/map/pins` | It returns only id, lat, lng, title, status, type, developer, locality and thumb, and filters status/type/developer/locality in memory after the SQL step. It has no price, configuration, sqft, description or card fields, so it cannot feed the existing cards, search or filters. | Do not switch the data source. Keep the endpoint as it is. |
| Home: 4.1 MB video | The video downloads because `promptSignIn()` (`public/landing.js:1087`) auto-opens the auth modal after 1 s, and `openModal()` sets `authVideo.preload = 'auto'` and plays it (`:748-751`). | Remove the auto-open, and preload or play the video only when its panel is actually visible. |
| Guests blocked on `/map` | `components/MapAuthGate.tsx` sends guests straight to the `guest` gate (the sign-in wall). The free-projects trial already exists, but only for `?trial=home`. | Give plain `/map` guests the same trial: browse freely, the first 3 project cards are free, then sign in. |
| SEO-2: SEO pages not cached | Baseline `next build` (scratch): `/projects`, `/projects/[slug]`, `/blog` and `/blog/[slug]` build as ƒ (dynamic). `/status/[status]` and `/property/[type]` are listed as ● but are **not** in `prerender-manifest.json`, because their render reads `searchParams` (`?page=N`). Cause for the detail pages: see Phase 5. | Phase 5 |
| `doc_lite` and map indexes | Not applied in production (`pins` has only `id` and `doc`; no `pins_latlng*` indexes). | Approval needed (Phase 4) |
| Internal fields in the public pins API | The public map never reads `source`, `rejected`, `pending_review`, `intake_project_id` or `owner_user_id`. Only the staff editor reads `pending_review`. | Strip these fields for non-staff reads. |
| Next.js advisories | 14.2.35 is the last 14.x release. The fixes are in **15.5.29** (the `backport` tag) or 16.4.6. Next 15 needs React 19. Synchronous `params` / `searchParams` / `cookies()` still work in 15 (with warnings). | Phase 7: try 15.5.29 in a separate scratch copy first. |

## Phases and exact changes

### Phase 1 — Technical SEO

1. **Crawlable public media**
   - `next.config.mjs` `rewrites()`:
     - `/media/pins/:id` → `/api/media/pins/:id` (pin images; the handler already serves only `image` / `brochure_image` of public pins, and hidden pins return 404 to non-staff).
     - `/media/project/:path*` → `/api/partners/storage?bucket=project-media&path=:path*&public=1`, restricted to image extensions so brochure PDFs never get a crawlable alias.
   - `app/api/partners/storage/route.ts`: public cache becomes `public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000`.
   - New `lib/seo/public-media.ts`: converts `/api/media/pins/…` and project-media storage URLs into `/media/…` URLs. Used only by SEO pages: OG, Twitter, schema and `<img>`.
   - Verify: live HTTP 200, `Content-Type: image/*`, cache headers; `robots.txt` unchanged apart from an explicit `Allow: /media/`.
2. **Official photos on project pages**
   - New cached reader `getProjectMedia()` in `lib/seo/project-media.ts`. It uses `cachedRead` with tags `projects` and `pins` and reads `projects.cover_image_url` and `gallery_urls` for live projects only, in one query for all pins.
   - `app/projects/[slug]/page.tsx`: hero cover (aspect-ratio box, so no CLS) plus a lazy gallery (up to 8 images, `?w=640` thumbnails, alt text = "<project> — photo N").
   - `layout.tsx`: `og:image` and `twitter:image` = cover (`?w=1200`), with the developer logo as fallback.
   - `projectSchema`: `image` becomes an array.
3. **Locality and developer pages**
   - Restore `app/locations/{layout,page}.tsx`, `app/locations/[slug]/{layout,page}.tsx` and `app/developers/...`.
   - Index rules (unchanged code):
     - Locality: ≥3 projects, or a written guide.
     - Developer: ≥3 projects.
   - Pages that fail the rules stay reachable with `noindex, follow`, are left out of the sitemap, and are linked only from hubs that pass.
   - The developer index lists only indexable developers, without `?page`, so it can be cached.
   - `next.config.mjs`: drop the `/locations*` and `/developers*` → `/projects` redirects. The `/cities*` redirects stay.
   - Project pages:
     - Breadcrumb Home › Locality (when indexable) › Project.
     - "All projects in <locality>" and "More by <developer>" pills (when indexable).
   - `components/SiteHeader.tsx`: add a "Localities" link.
4. **Project-level SEO**
   - Everything uses facts that are already verified on the page.
   - `projectSchema` gains `offers` (`AggregateOffer`, INR low/high), only when the price parses cleanly with the same parsers the cards use.
   - No invented facts. URLs and IDs stay the same.
5. **Sitemap and llms.txt**
   - `app/sitemap.ts` gains the indexable localities and developers (with the latest `updated_at` of their projects).
   - `public/llms.txt` is replaced by a generated `app/llms.txt/route.ts` (counts, cities, top localities, key URLs; cached for 1 h).
   - `noindex` is added to `/delete-account` and `/developer-api/reference`.

### Phase 2 — Map performance (`public/legacy/public-map.json`, applied by `migration/patch-map-viewport.mjs`)

**Why viewport fetching is not safe.** It would break search across all projects, filter counts, area lists and the "nearby" feature, and it would need a second API shape. The rendering cost is the DOM markers, not the data: the pins call is 230 KB brotli and cached at the CDN.

**What changes instead:**
- Pin markers become **culled** markers.
- `map.addLayer`, `map.removeLayer` and `map.hasLayer` are wrapped **for pin markers only**:
  - "show" or "hide" from filters and search sets a *wanted* flag;
  - only wanted markers inside the padded viewport get a DOM element.
- Below zoom 13, wanted markers in view are **grid-clustered** into one bubble per cell. Clicking a bubble zooms to its bounds. Highlighted pins are never clustered.
- Updates run on `moveend` / `zoomend`, debounced with `requestAnimationFrame` plus 120 ms.
- `marker.openPopup()` attaches a wanted marker immediately, so search jump-to-project, share links and "nearby" still open cards.
- Marker logos load only for attached markers.
- **Kill switch:** `?vp=0` restores the old behaviour.
- **Tests:** zoom 10/12/14/16, search, filter toggles, share link, nearby, card open, live reload of pins.

### Phase 3 — Home page and guest experience

- `public/landing.js`:
  - No automatic sign-in modal.
  - The modal video plays and preloads only when the modal is open **and** the video is visible (not on phones, not with Save-Data).
- `components/MapAuthGate.tsx`: plain `/map` guests get the 3-free-projects trial instead of an immediate wall. Share links, developer/agent approval and the mobile-number requirement are unchanged.
- Mobile hero image: WebP version via `sharp` plus `image-set()` in `app/mobile-home.css`.

### Phase 4 — Database (prepared only; production execution needs approval)

| Item | State | Action |
| --- | --- | --- |
| `migration/pg-doc-lite.sql` | Idempotent (`ADD COLUMN IF NOT EXISTS`, generated STORED), tested 20 Nov on a temporary copy | Re-check, then document the commands: backup → apply → verify (`mismatches=0`) → revert |
| `migration/pg-indexes-map.sql` | `CREATE INDEX CONCURRENTLY IF NOT EXISTS` | Same |
| Public pin payload | Strip internal fields for non-staff; no new indexes needed | Code |

### Phase 5 — Page caching

- **Listings** (`/projects`, `/status/*`, `/property/*`, `/blog`, `/developers`):
  - Stop reading `searchParams` in the page render.
  - A `?page=N` request is rewritten in `next.config.mjs` (`has: query page`) to an internal path segment (`.../p/N`), so every page is ISR and CDN-cacheable.
  - Public URLs, canonicals and pager links stay exactly the same (`?page=N`).
  - Unknown query parameters on `/projects` are still redirected by the existing rule.
- **Detail pages:** fix whatever the probe build finds. Never `force-static` on anything user-specific.

### Phase 6 — Core Web Vitals

Lighthouse is run before and after on the same machine against the same local production builds. Lab numbers only; there is no field data because Search Console and PSI are unavailable.

### Phase 7 — Security and dependencies

- **Code fixes:**
  - Anonymous `/api/db` filters accept scalar `eq`/`in` values only (no operator objects), with an anonymous limit of ≤2000.
  - Internal pin fields are stripped for non-staff.
  - `poweredByHeader: false` and `Permissions-Policy`.
  - A shared, database-backed rate limit for login, OTP, sign-up and reset, using the existing `api_counters` table and `INSERT … ON CONFLICT`. The in-memory limiter stays as the first gate.
- **Dependencies:**
  - Next 14.2.35 → 15.5.29 plus React 19, tried in a separate scratch copy (build + tests + smoke tests) before touching the repo.
  - `nodemailer` 6 → current major (the API calls used are `createTransport` and `sendMail`).
  - `npm audit fix` for non-breaking transitive fixes.
  - `zod` 4 is deferred unless it is low-risk. It is used in many routes, and the advisory only concerns oversized collections, which our schemas cap.

### Phase 8 — Regression

`npm test`, scratch `next build`, then `next start` with:
- route status checks (old and new);
- headless Chrome at 360 / 390 / 768 / 1024 / 1366 (overflow, broken images, JS errors);
- map scenarios;
- auth endpoints (validation-level only; no real accounts created in production);
- API smoke tests.

### Phase 9 — Reports

`seo-doc/MAPPINGG-OPTIMIZATION-REPORT.md` and a refreshed evidence folder.

## Risks

| Change | Risk | Mitigation |
| --- | --- | --- |
| Map culling and clustering | Medium-high: a large legacy script | Targeted wraps only, a kill switch, scenario tests |
| Restored hubs | Medium: reverses a teammate's decision | Thin-page rules; only indexable hubs linked or listed |
| Pagination rewrite | Medium | Same public URLs; tested for every listing |
| Next 15 upgrade | High | Separate copy first; abandoned and reported if anything regresses |
| Media rewrites | Low | Images only; same handlers |
| Guest trial on `/map` | Business: more open access | Same 3-free-projects rule the home page already uses |
