# Mappingg — complete technical audit

**Date:** 22 Nov 2026 (IST)
**Site:** https://www.mappingg.com
**Codebase:** `main` at `f8d10ca` (working tree clean)
**Type:** audit only. No website code, database record, configuration or deployment was changed.

The only repository changes:
- these reports
- the previous `seo-doc/SEO-AUDIT.md`, renamed to `seo-doc/SEO-AUDIT-2026-11-04.md` so it was not overwritten
- the evidence folder `reports/seo-audit/2026-11-22-complete-audit/`

| Detailed report | Covers |
| --- | --- |
| [SEO-AUDIT.md](SEO-AUDIT.md) | On-page and technical SEO, project-wise status, competitive gaps |
| [PERFORMANCE-AUDIT.md](PERFORMANCE-AUDIT.md) | Lighthouse lab metrics, TTFB, map loading, database |
| [SECURITY-AUDIT.md](SECURITY-AUDIT.md) | Defensive code and configuration review |
| [PROJECT-DATA-AUDIT.md](PROJECT-DATA-AUDIT.md) | Completeness and consistency of every live project |
| [INDEXING-AUDIT.md](INDEXING-AUDIT.md) | Sitemap, status codes, robots, rendering, crawl efficiency |

## How the evidence was gathered (and what could not be)

| Source | What it gave | Status |
| --- | --- | --- |
| Live crawl (`scripts/seo-audit/crawl.mjs`, GET only) | 1,068 URLs: status, metadata, headings, schema, links, words, response time | Done |
| Production Postgres (read-only transactions) | Row counts, sizes, indexes, every pin's fields, duplicates | Done |
| Lighthouse 12.8.2 (local Chrome, simulated throttling) | Lab CWV for home, map, project, projects list, blog (mobile; desktop for home and map) | Done |
| Headless Chrome at 360, 768 and 1366 px | Horizontal overflow, tap targets, small text, screenshots for 10 pages | Done |
| `npm audit`, `curl -I`, anonymous public-API reads | Dependency vulnerabilities, headers, data exposure | Done |
| Source code review | Auth, API guards, data layer, caching, map | Done |
| Google Search Console | Index status, clicks, impressions, CTR, position, queries, field CWV | **Unavailable.** The API is disabled on GCP project 847257037149 (HTTP 403). Windsor.ai has no Search Console source |
| PageSpeed Insights / CrUX field data | Real-user CWV | **Unavailable.** HTTP 429, daily quota exhausted |

**Measured vs estimated:** every number in this report is measured unless it is labelled "estimate". Lighthouse figures are lab data from one machine, not field data. INP cannot be measured in a lab run, so TBT is the proxy.

---

## A. Executive summary

**What is in good shape:**
- The site is technically clean for indexing: 1,064 of 1,068 URLs are indexable. There are 0 broken internal links, 0 server errors and 0 schema errors, and every page has a unique title, description and self-canonical.
- The sitemap is accurate: 1,007 URLs, all returning 200, with real `lastmod` dates.
- Project, listing and blog pages are server-rendered and fast in the lab (Lighthouse mobile 91–97).

**The main problems fall into four groups.**

1. **Search architecture.** On 4 Nov the locality, city and developer pages (about 840 URLs) were removed and 301-redirected to `/projects`.
   - Mappingg now has no page that can rank for "flats in Kharadi", "new projects in Wakad" or "Lodha projects in Pune". Only blog articles cover those topics.
   - In addition, `robots.txt` blocks `/api/`, which is where every project image and `og:image` is served from (928 of 932 project pages). Google cannot index any project image.
   - Project pages show the developer logo rather than the official photos the database already holds for 330 projects.
2. **Speed of the two most important pages.**
   - **Map:** mobile Lighthouse 28, LCP 14.4 s, TBT 7.5 s. It downloads every pin (1.17 MB of JSON) and draws one DOM marker per pin, with no clustering. A clustered viewport API (`/api/map/pins`) already exists, but the map does not use it.
   - **Home page:** mobile Lighthouse 53, LCP 11.0 s, 6.1 MB, of which 4.1 MB is a video. It also opens a full-screen sign-in pop-up 1 second after landing.
   - **Caching:** project, blog and listing pages are served `private, no-store` and never cached at the CDN, so every Googlebot hit is a fresh server render (project p90 2.0 s, max 7.7 s).
3. **Security hygiene.**
   - The framework version has a critical advisory (`next@14.2.35`), and production dependencies carry 18 high advisories in total.
   - Rate limiting is in-memory while the site runs on serverless instances, so login, OTP and lead brute-force protection is weak.
   - The public data API accepts query operators.
   - There is no Content-Security-Policy.
   - No secrets are committed, and admin APIs are correctly guarded.
4. **Data completeness.**
   - 392 of 932 projects are complete on the core fields.
   - 366 have no price, and 599 of 929 have no project photos.
   - There are a handful of real errors: a duplicate project, `LAUNCHING-SOON` stored as a RERA number, implausible "Cr" prices, 3 empty pins visible on the map, and 90 stale `is_live` records.

## B. Actual website statistics (verified)

### Pages and routes

| Item | Count | How verified |
| --- | --- | --- |
| `page.tsx` routes in `app/` | 43 (28 public, 15 dashboard / admin; 11 dynamic) | `find app -name page.tsx` |
| API route handlers | 107 (27 `/api/admin/*`, 17 public `/api/v1/*` developer API, 1 `/rest/v1`) | `find app/api app/rest -name route.ts` |
| Live crawlable URLs | 1,068 (1,067 × 200, 1 × 404) | crawl |
| Indexable URLs | 1,064 | crawl |
| Sitemap files and URLs | 1 (`/sitemap.xml`), 1,007 URLs | crawl |
| `robots.txt` / `llms.txt` | 1 each (`app/robots.ts`, `public/llms.txt`; `llms.txt` is out of date) | live |
| City / locality / area pages | **0 live** (removed 4 Nov; 301 to `/projects`) | `next.config.mjs` |
| Developer pages | **0 live** (removed 4 Nov) | `next.config.mjs` |
| Category / listing pages | 20 `/projects` pages, 20 status pages (3 hubs), 26 property-type URLs (9 in the sitemap) | crawl |
| Blog articles | 44 published, 44 live | DB + crawl |

### Projects

| Item | Count |
| --- | --- |
| Rows in `pins` | 937 |
| Public pins | 935 |
| Property projects | 932 |
| Indexable project pages | 929 |
| Projects by city | Bengaluru 447, Pune 281, MMR 115, Delhi NCR 72, Hyderabad 15, Dubai 1, Nashik 1 |
| Localities | 191 |
| Developer names on public pins | 585 |

### Database

- **Engine:** Postgres, 60 tables, JSONB `doc` per row. The main ones:

  | Table | Rows / size |
  | --- | --- |
  | `pins` | 937 (44 MB) |
  | `projects` | 1,021 |
  | `project_submissions` | 1,085 |
  | `developers` | 960 (37 MB) |
  | `scraped_projects` | 8,693 |
  | `posts` | 44 |
  | `users` | 61 (38 buyer, 12 agent, 4 developer, 5 employee, 2 admin) |
  | `site_events` | 31,031 |
  | `partners_media` | 4,808 (934 MB) |
  | `backups` | 14 (601 MB) |

- **Relationships:**
  - `pins.intake_project_id` → `projects.id`
  - `projects.submission_id` → `project_submissions.id`
  - `pins.owner_user_id` → `users.id`
  - `pins_history.pin_id` → `pins.id`
  - developers are linked by name

### Integrations

| Area | Integrations |
| --- | --- |
| Google | OAuth sign-in, Maps JS key, Search Console client (disabled), GTM/GA4 (consent-gated) |
| Lead sources | Meta Lead Ads webhook, Google Ads lead webhook, CRM webhook (B2BBricks) |
| Messaging | WhatsApp (GABS) API + webhook, Gmail SMTP (nodemailer) |
| Payments | Razorpay (keys pending; subscriptions switched off) |
| Other | AWS S3 SDK, Anthropic SDK (WhatsApp auto-reply), OpenStreetMap tiles, Leaflet (unpkg), Font Awesome (cdnjs), Google Fonts |
| Hosting | Vercel (production, with a daily cron); a `render.yaml` blueprint is also kept |

## C. SEO score: **69 / 100**

| Area | Weight | Score | Basis |
| --- | --- | --- | --- |
| Crawlability and indexability | 20 | 18 | 1,064/1,068 indexable, clean sitemap and robots; 2 indexable pages missing from the sitemap; 2-hop apex redirect |
| On-page metadata | 15 | 13 | 0 missing; 1 duplicate title group; 51 long titles |
| Structured data | 10 | 8 | 0 errors; Residence schema has no offers or size; FAQPage brings no rich result |
| Content depth | 15 | 9 | Projects: 416 words median, but 540 have data gaps; logo instead of photos; 5 thin pages |
| Architecture and internal links | 15 | 7 | No locality or developer hubs; flat breadcrumb; 285 projects with ≤3 inbound links |
| Page experience | 15 | 8 | Home mobile 53 with an intrusive pop-up; map 28; project and blog pages 91–97 |
| Crawl efficiency and media access | 10 | 6 | SEO pages not CDN-cached; images blocked by robots |
| **Total** | **100** | **69** | |

## D. Performance score: **53 / 100**

The score is half lab results and half delivery checks.

**Lab half: 66.5 / 100.** Weighted Lighthouse mobile scores:

| Page | Weight | Lighthouse mobile |
| --- | --- | --- |
| Home | 25% | 53 |
| Map | 25% | 28 |
| Project page | 30% | 91 |
| Projects list | 10% | 93 |
| Blog post | 10% | 97 |

**Delivery half: 40 / 100** (4 of 10 checks pass).

| Check | Result |
| --- | --- |
| Compression | ✔ |
| Static-asset caching | ✔ |
| Data-layer cache | ✔ |
| Low CLS | ✔ |
| CDN caching of SEO pages | ✘ |
| `doc_lite` light column | ✘ |
| Map coordinate index | ✘ |
| Viewport/clustered map loading | ✘ |
| Image optimisation | ✘ |
| Home media weight | ✘ |

**Total:** 0.5 × 66.5 + 0.5 × 40 = **53**.

## E. Security score: **68 / 100**

The scope was a defensive code and configuration review with no intrusive testing. The breakdown is in [SECURITY-AUDIT.md](SECURITY-AUDIT.md#score):

| Area | Score |
| --- | --- |
| Authentication | 15/20 |
| Authorisation | 15/20 |
| Input validation | 12/15 |
| Rate limiting | 3/10 |
| Dependencies | 6/15 |
| Headers | 7/10 |
| Secrets | 10/10 |

## F. Project data quality score: **71 / 100**

| Component | Score | Basis |
| --- | --- | --- |
| Completeness | 49/60 | 82.3% of the 8 core fields filled across 932 projects |
| Consistency | 22/40 | Duplicates, invalid or shared RERA numbers, price-unit errors, placeholders, taxonomy, stale flags |

The breakdown is in [PROJECT-DATA-AUDIT.md](PROJECT-DATA-AUDIT.md#5-score).

## G. Google indexing readiness

- **Ready:**
  - sitemap accuracy: 929 of 929 indexable projects and 44 of 44 blogs listed
  - 0 redirect or 404 URLs in the sitemap
  - self-canonicals everywhere
  - server-rendered content
  - noindex used correctly on placeholders
  - dashboards and intake kept out of the index
- **Blocked:** image indexing. `Disallow: /api/` covers `/api/media/*`, which serves 928 project images.
- **Weak:**
  - crawl efficiency (no CDN cache on 1,000+ SEO URLs)
  - topical depth (no locality or developer hubs)
  - discovery depth (flat breadcrumb; 285 projects with ≤3 inbound links)
- **Unknown until Search Console is connected:** real index coverage, rankings, queries and field CWV. Enabling the API is a 5-minute task (P0-6).

## H. Critical issues

| ID | Issue | File / component | Evidence | Severity | Impact |
| --- | --- | --- | --- | --- | --- |
| PERF-1 | Map loads every pin and draws one DOM marker per pin; no clustering; the existing viewport API is unused | `public/legacy/public-map.json` (`PIN_LIGHT_COLS`, `L.divIcon` markers), `public/db-shim.js`, unused `app/api/map/pins/route.ts` | 1.17 MB raw / 230 KB br pin payload; 6,198 DOM nodes; 316 requests; TBT 7.5 s; LCP 14.4 s; LH mobile 28 | **Critical** | The core product is slow and janky on phones; poor INP; bounces |
| SEO-1 | Locality, city and developer pages removed and 301'd to `/projects` | `next.config.mjs` `redirects()`; commit `d6032e0` | ~840 URLs (4 Nov audit) now collapse into one page | **High** | No URLs for the main transactional queries; lost link equity |
| SEO-2 / PERF-3 | SEO pages served `private, no-store`; ISR not effective | `app/projects/[slug]/page.tsx`, `app/projects/page.tsx`, `app/blog/*`, `app/status/*`, `app/property/*` (cause not yet traced) | `X-Vercel-Cache: MISS` on every request; project p90 2.0 s, max 7.7 s | **High** | Slow TTFB, crawl budget, DB operations scale with crawling |
| SEO-4 | Project images under a robots-blocked path | `app/robots.ts` (`/api/`), `lib/pin-media.ts` | 928/932 `og:image` under `/api/media/` | **High** | No Google Images presence; incomplete render |
| SEO-3 | Full-screen sign-in pop-up 1 s after landing; map gated | `public/landing.js:1087-1100` `promptSignIn`, `components/MapAuthGate.tsx` | 360 px screenshot; LCP element under `body.mpg-auth-open` | **High** | Intrusive-interstitial risk; lost brand-search engagement |
| PERF-2 | Home page is 6.1 MB (4.1 MB video), LCP 11 s | `app/page.tsx` (hero / rest HTML), `public/video/how-mappingg-works-v1.mp4`, Font Awesome CDN | Lighthouse mobile 53, render-blocking 1,010 ms | **High** | Slow first impression; ranking signal |
| SEC-1 | `next@14.2.35` critical advisory; 18 high advisories | `package.json` | `npm audit --omit=dev` | **High** | DoS and request-smuggling exposure |
| SEC-2 | In-memory rate limiter on serverless instances | `lib/rate-limit.ts` (assumes the Render single-instance setup) | `vercel.json`, `Server: Vercel` | **High** | Brute-force and spam limits do not hold |
| PERF-4 | `doc_lite` light column never applied | `migration/pg-doc-lite.sql`, `lib/mongo-compat.ts` | `pins` columns are only `id`, `doc`; 35.8 KB average row | **High** | ~1.2 s DB reads for pin lists (20 Nov measurement) |
| SEO-5 | Project pages show the logo, not official photos | `app/projects/[slug]/page.tsx`, `layout.tsx` | 886 logo images; 330 projects with unused `gallery_urls` | Medium | Weak visuals, image SEO and sharing |
| SEC-3 | Anonymous queries accept `$regex`/`$ne`/`$in` filters, limit up to 10k | `app/api/db/route.ts` `filterSchema`, `lib/mongo-compat.ts` `buildWhere` | Code (SQL is parameterised) | Medium | CPU / DoS; arbitrary query shaping |
| SEC-4 | Public pin API returns internal fields and 4 admin-hidden fields | `app/api/db/route.ts`, `lib/db-engine.ts` | Anonymous read compared with `field_visibility` | Medium | Information disclosure |
| SEC-5 | No CSP or Permissions-Policy; `X-Powered-By` sent | `next.config.mjs` `headers()` | `curl -I` | Medium | Weaker XSS containment |
| SEC-6 | Unverified sign-ups while OTP is paused | `app/api/auth/signup/route.ts:49-85`, `lib/otp.ts` | `signup_method: 'password-no-otp'` | Medium | Number squatting; junk CRM leads |
| SEO-7 | `llms.txt` out of date | `public/llms.txt` | Says 184 projects (Sep 2026) vs 932 | Medium | AI answers quote wrong coverage |
| SEO-8 | Minimal project schema (no offers or size) | `lib/seo/schema.ts` `projectSchema` | Crawl schema types | Medium | Fewer rich signals |
| PERF-5 | Map coordinate indexes not applied | `migration/pg-indexes-map.sql` | `pg_indexes` | Medium | Needed for viewport queries |
| PERF-6 | Image optimisation off | `next.config.mjs` `images.unoptimized` | Lighthouse: 530 KiB home, 472 KiB map savings | Medium | Bytes / LCP |
| PERF-7 | OSM public tiles and unpkg Leaflet on the critical path | `public/legacy/public-map.json` | Lighthouse third-party 2.3 s; OSM tile policy | Medium | Reliability and policy risk |
| D-1…D-11 | Duplicate project, `LAUNCHING-SOON` RERA, Cr/Lakh errors, empty pins, 90 stale `is_live` rows, type taxonomy | Database (see PROJECT-DATA-AUDIT) | SQL | Medium | Wrong facts on public pages |
| SEO-9 | Duplicate title (#24 / #86) | Data | Crawl | Medium | Duplicate page |
| SEO-6 | Flat breadcrumb; 285 weakly linked projects | `app/projects/[slug]/page.tsx` `crumbs` | Crawl inbound links | Medium | Discovery and relevance |
| SEO-10/11, SEC-7…10, PERF-8…10 | Long titles, thin property-type pages, redirect chain, account enumeration, unsanitised blog HTML, keys in research cache, DB bloat | See the detailed reports | — | Low | Polish |

## I. Improvement roadmap

Each item is a recommendation only. None of them has been implemented.

### P0 — critical (do first)

| # | What | Why | Files | SEO impact | Perf impact | Security | Regression risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P0-1 | Switch the public map to the viewport + cluster API, and cut the initial pin columns to what markers need | Map mobile 28 / TBT 7.5 s | `public/legacy/public-map.json` (map app), `app/api/map/pins/route.ts`, `migration/pg-indexes-map.sql` | Indirect (engagement) | **Very high**: payload, DOM and TBT | Smaller public data surface | **High.** The legacy map is large; filters, search and quick view must keep working. Ship behind a flag and test against the current map |
| P0-2 | Find why SEO routes render dynamically and restore ISR / CDN caching | Every crawl is a full render; 7.7 s worst case | `app/projects/**`, `app/blog/**`, `app/status/**`, `app/property/**`, root `app/layout.tsx` (check with the `next build` route table) | **High** (crawl rate, TTFB) | **High** | None | Medium: stale content until revalidation; writes must keep busting caches |
| P0-3 | Let Googlebot fetch images: `Allow: /api/media/` (or move media off `/api/`) | 928 images blocked | `app/robots.ts` (or a media path rewrite in `next.config.mjs`) | **High** (Google Images, rendering) | None | None (the media is already public) | Low |
| P0-4 | Apply `doc_lite` (`npm run db:doc-lite`, verify mismatches = 0) and the map indexes | Measured 1,280 → 215 ms | `migration/pg-doc-lite.sql`, `migration/pg-indexes-map.sql` | Indirect | **High** on DB reads | None | Low to medium: tested on a copy; `--revert` and `DOC_LITE=off` kill switch exist. Owner must run it |
| P0-5 | Upgrade `next` past the critical advisory, plus `nodemailer`, `zod` and `undici` | Critical and high advisories | `package.json`, then a full regression pass | None | Possibly positive | **High** | **High** for a Next major version (14 → 15/16 changes caching and request APIs). Test on a preview deploy |
| P0-6 | Enable the Search Console API on GCP 847257037149 and grant the service account | Every ranking and indexing decision is blind without it | GCP console; then `npm run seo:gsc` | Enables measurement | — | Read-only scope | None |

### P1 — high

| # | What | Why | Files | SEO | Perf | Security | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1-1 | Rebuild indexable **locality** hubs (≥3 projects; ~30 Pune/MMR localities qualify) and **developer** hubs; replace the blanket 301s with these targets | Recover transactional queries ("flats in Kharadi") | New `app/locations/[slug]`, `app/developers/[slug]`; `next.config.mjs` `redirects()`; `app/sitemap.ts`; `lib/seo/indexing.ts` (rules already exist) | **Very high** | Neutral if ISR works (P0-2) | None | Medium: thin-page rules must hold; this reverses the 4 Nov decision, so confirm why it was made first |
| P1-2 | Remove the auto sign-in pop-up on landing (trigger on intent instead), and let guests see the map | Intrusive interstitial; engagement | `public/landing.js` `promptSignIn`, `components/MapAuthGate.tsx` | **High** (page experience) | Improves LCP / INP | None | Business trade-off: fewer forced sign-ups |
| P1-3 | Home page diet: no autoplay or preload of the 4.1 MB video (load on click, use a poster), subset or self-host the icons, preload the hero image, defer non-critical CSS | LCP 11 s | `app/page.tsx` hero markup, `public/landing.js`, `components/IconFont.tsx` | High (CWV) | **High** | None | Low to medium (visual parity) |
| P1-4 | Use official galleries on project pages (cover as main image and `og:image`, gallery with alt text) | Logos instead of photos | `app/projects/[slug]/page.tsx`, `layout.tsx`, `lib/seo/entities.ts` (join `projects.gallery_urls`) | High (images, CTR) | Neutral (lazy-load) | None | Low |
| P1-5 | Shared rate limiter (Postgres / KV table) for auth, OTP, leads and the public `/api/db` | Limits do not survive serverless | `lib/rate-limit.ts` | None | Small | **High** | Low to medium (DB ops cost; key design) |
| P1-6 | Restrict anonymous `/api/db` filters to scalar `eq`/`in` on known columns, a column allow-list and a lower limit | SEC-3 / SEC-4 | `app/api/db/route.ts`, `lib/db-engine.ts` | None | Small | **Medium** | Medium: the legacy map and editors use this API; check every caller |
| P1-7 | Correct the D-items (duplicate #24/#86, `LAUNCHING-SOON`, Cr/Lakh errors, empty pins #920/#921/#936, stale `is_live`) after checking official sources | Wrong public facts | Data only (add-only rule, backups first) | Medium | — | — | Low with backups |

### P2 — medium

| # | What | Files | Notes |
| --- | --- | --- | --- |
| P2-1 | Enrich project schema: `offers` from the parsed price, `numberOfRooms` / `floorSize` from configuration and carpet area, developer as `brand` | `lib/seo/schema.ts`, `lib/home/cards.ts` parsers | Only for fields shown on the page |
| P2-2 | Breadcrumbs Home › City › Locality › Project (after P1-1) plus "more in <locality>" links | `app/projects/[slug]/page.tsx` | Fixes the 285 weakly linked projects |
| P2-3 | Update `llms.txt` (coverage, cities, counts, how details work) | `public/llms.txt` | Ideally generate it from data |
| P2-4 | Security headers: CSP (report-only first), Permissions-Policy, `poweredByHeader: false`, HSTS `includeSubDomains` | `next.config.mjs` | CSP must allow GTM, Maps, OSM, unpkg, cdnjs and YouTube |
| P2-5 | Turn image optimisation back on for Next-rendered pages (keep the legacy `<img>` tags as they are) | `next.config.mjs`, components | Vercel image-optimisation cost |
| P2-6 | Normalise the property-type taxonomy (about 5 canonical types), noindex type hubs with fewer than 6 projects | Data + `lib/seo/entities.ts` type groups | Removes 3 thin pages |
| P2-7 | Use a tile provider with an SLA or a cache instead of `tile.openstreetmap.org`; self-host Leaflet | Map bundle | Policy and reliability |
| P2-8 | Re-enable OTP or add email verification for sign-ups; generic "if an account exists" reset message | `lib/otp.ts`, `app/api/auth/signup`, `reset-password` | Business decision (WhatsApp provider) |
| P2-9 | Price and carpet-area enrichment for the 366 / 168 gaps, from official or RERA sources | Data (add-only) | Biggest content-depth win |

### P3 — long term

| # | What |
| --- | --- |
| P3-1 | Move `partners_media` (934 MB) and `backups` (601 MB) to object storage (S3 is already a dependency) |
| P3-2 | Replace the inline legacy bundles (171 KB / 166 KB inline JS) with cacheable modules, then a React map component |
| P3-3 | Sanitise blog HTML at save time; remove `data/pune-research/cache/*.bin` from the repo |
| P3-4 | Locality price pages ("property prices in Kharadi") once price coverage is above 80% |
| P3-5 | A 1 BHK Pune guide, a RERA-registered-projects listing and Mumbai coverage (Powai, Chembur, Mira Road have 0 projects) |
| P3-6 | RUM: send `web-vitals` to GA4 (consent-gated) for field LCP / INP |

## J. Final recommendations: what to fix first, and why

1. **Enable Search Console (P0-6) today.** It takes minutes, carries no risk, and every later decision needs real query and index data.
2. **Unblock images in robots.txt (P0-3).** It is a one-line change with low risk and an immediate gain in Google Images and rendering, across 928 pages.
3. **Apply `doc_lite` and the map indexes (P0-4).** The fix is already built and tested. It cuts DB time for every pin read and is a prerequisite for P0-1.
4. **Restore CDN/ISR caching for SEO pages (P0-2).** This is the biggest crawl-efficiency and TTFB gain for the whole site. Find the dynamic trigger with a local production build (not while `npm run dev` is using `.next`).
5. **Fix the map (P0-1)**, then **the home page and the pop-up (P1-2, P1-3).** These two pages carry the product, and both score under 55 on mobile.
6. **Decide on locality and developer hubs (P1-1).** This is the largest ranking opportunity for Pune and Mumbai queries. Reverse the 4 Nov removal only with the thin-page rules in place.
7. **Plan the Next.js security upgrade (P0-5) on a preview deployment.** Fix the shared rate limiter (P1-5) and the public-API filters (P1-6) alongside it.
8. **Data corrections (P1-7) and price/photo enrichment (P1-4, P2-9).** Run these as a continuous track under the add-only rule.
