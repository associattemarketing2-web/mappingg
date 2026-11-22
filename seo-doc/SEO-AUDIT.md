# Mappingg — SEO audit (22 Nov 2026)

Audit only. Nothing in the code, the database or the deployment was changed. The previous audit (4 Nov) is kept as `SEO-AUDIT-2026-11-04.md`.

**Evidence folder:** `reports/seo-audit/2026-11-22-complete-audit/`
- `PAGE-BY-PAGE-SEO.csv`: one row per crawled URL (1,068 rows)
- `TECHNICAL-SEO-ISSUES.csv`: every crawler issue
- `PROJECT-SEO-REPORT.csv`: project-wise SEO status, one row per public pin (935 rows)
- `KEYWORD-URL-MAPPING.csv`: one target query per indexable URL
- `lighthouse/*.json`: Lighthouse 12.8.2 lab runs
- `responsive/*.png`: 360 px screenshots

**How the data was collected**
- Live crawl of `https://www.mappingg.com` with `scripts/seo-audit/crawl.mjs`. It sends GET requests only, 4 at a time, and ran from 07:15 to 07:19 UTC on 22 Nov 2026.
- A read-only database pass (`BEGIN READ ONLY`) with `scripts/seo-audit/projects.mts` and extra SQL.
- Local Lighthouse runs on the installed Chrome.
- Reading the source code.

**Search data:** none is included. The Search Console API returns 403 because the API is disabled for GCP project 847257037149. Windsor.ai has no Search Console account connected (only Meta Ads and Google Ads). No rankings, impressions or search volumes are reported or estimated anywhere in this audit.

---

## 1. What was measured

| Metric | Value | Source |
| --- | --- | --- |
| URLs crawled | 1,068 | crawl |
| HTTP 200 / 404 / 5xx | 1,067 / 1 / 0 | crawl (the 404 is `/pricing`; subscriptions are switched off and the page is not linked) |
| Indexable (200, no noindex, self-canonical) | 1,064 | crawl |
| Sitemap URLs | 1,007; valid XML, 0 duplicates, 0 off-origin, 991 with `lastmod`, 0 future dates | crawl |
| Broken internal links | 0 | crawl |
| Redirects met while crawling | 0 | crawl |
| Missing title / description / canonical | 0 / 0 / 0 | crawl |
| Duplicate title groups | 1 (Trump World Center, pins #24 and #86) | crawl |
| Duplicate description groups | 0 | crawl |
| Pages without exactly one H1 | 0 | crawl |
| Heading-level skips | 3 pages | crawl |
| JSON-LD parse or required-property errors | 0 pages | crawl |
| Images without `alt` | 0. A further 121 have `alt=""` (decorative) out of 1,432 | crawl |
| Pages without `og:image` | 0 | crawl |
| Titles longer than ~70 characters | 51 | crawl |
| Thin indexable pages (<150 words) | 5 | crawl |
| Orphan pages | 1 (`/buyer-requirement`) | crawl |
| Crawler issues: high / medium / low | 2 / 8 / 56 (66 in total) | crawl |

### Page families (live)

| Family | Count | Schema on the page |
| --- | --- | --- |
| Home `/` | 1 | Organization, WebSite |
| Project detail `/projects/<name>-<locality>-<n>` | 932 crawled, all indexable | Organization, WebSite, BreadcrumbList, Residence, FAQPage, plus VideoObject on 140 |
| Projects listing `/projects`, `?page=2..20` | 20 | BreadcrumbList, ItemList (and FAQPage on page 1) |
| Status hubs `/status/<s>` and their pages | 20 (3 hubs) | BreadcrumbList, ItemList, FAQPage |
| Property-type hubs `/property/<t>` and their pages | 25, plus the `/property` index | BreadcrumbList, ItemList |
| Blog `/blog`, its pages, and 44 posts | 5 + 44 | Blog; BlogPosting and BreadcrumbList on posts |
| Static pages (about, faq, legal, etc.) | 18 | Organization, WebSite (+ FAQPage on `/faq`) |
| Map `/map` | 1 | Organization, WebSite |
| Removed on 4 Nov (commit `d6032e0`): `/cities/*`, `/locations/*`, `/developers/*` and their facet pages | 0. Each now 301s to `/projects` (`next.config.mjs` `redirects()`) | — |

---

## 2. Findings

Severity scale: **Critical** blocks indexing site-wide; **High** materially limits rankings or crawl; **Medium** weakens pages; **Low** is polish.

### SEO-1 — High: there are no locality, city or developer landing pages
- **Where:** `next.config.mjs` `redirects()`:
  - `/:dir(developers|cities|locations)/:rest*` → `/projects` (permanent)
  - `/cities/:city(pune|mumbai)/:rest*` → `/projects?city=:city`
- **Evidence:**
  - `app/cities`, `app/locations` and `app/developers` were deleted in commit `d6032e0` (4 Nov 2026).
  - On 4 Nov these families made up 179 locality, 566 developer, 22 city and 71 BHK/budget facet URLs (`SEO-AUDIT-2026-11-04.md` §1). All of them now 301 to one generic page.
  - `/projects?city=pune` is not a separate indexable page. Its canonical points to `/projects` (`app/projects/page.tsx` `dropFilters`).
- **Impact:**
  - Transactional queries such as "flats in Kharadi", "new projects in Wakad" and "Lodha projects in Pune" have no matching URL. The only locality-level pages are blog articles, which are informational.
  - Every link and every index entry the old URLs had earned is folded into `/projects`. Google normally treats many-to-one 301s like this as soft-404s.
  - This is the largest structural SEO gap on the site.
- **Data available today for rebuilding them** (DB, public projects): Mundhwa 69, Kharadi 29, Andheri 15, Thane 13, Hinjewadi 12, Kalyan 11, Hadapsar 8, Wakad 6, Balewadi 6, Kothrud 6, Dombivli 6, Viman Nagar 5, Kharghar 5, Baner 4. There are 191 localities and 585 developer names in total.

### SEO-2 — High: project, blog and listing pages are rendered on every request and never cached at the CDN
- **Where:**
  - `app/projects/[slug]/page.tsx`, `app/projects/page.tsx`, `app/blog/*`, `app/status/*` and `app/property/*` all declare `revalidate = 3600`.
  - The live responses still send `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` and `X-Vercel-Cache: MISS`.
  - The home page, `/faq` and `/map` are served `HIT`.
- **Evidence:** `curl -I` on 22 Nov (see `INDEXING-AUDIT.md` §3). Crawler response times for project pages:

  | Percentile | Response time |
  | --- | --- |
  | p50 | 563 ms |
  | p90 | 2,031 ms |
  | max | 7,690 ms |

  The home page took 7,594 ms on a cold hit.
- **Cause:** not confirmed. Only a dev build exists locally (`.next` has no `prerender-manifest.json`). Something in the render path makes Next mark these routes dynamic (ƒ). Run `next build` and look at the route table to find it. Do not touch `.next` while dev is running.
- **Impact:**
  - Every Googlebot fetch costs a server render plus database reads, which hurts crawl rate.
  - TTFB is slow for real users.
  - Prisma operations scale with crawl volume (see the 25 Oct incident in `db-operations-caching`).

### SEO-3 — High: a full-screen sign-in pop-up opens on the home page, and the map is gated
- **Where:**
  - `public/landing.js:1087-1100` `promptSignIn()` opens the sign-in modal 1 s after the first home-page view in each browser session.
  - `components/MapAuthGate.tsx` blocks `/map` for guests after a short peek.
- **Evidence:**
  - The 360 px screenshot (`responsive/shot-_-360.png`) shows the sign-in modal covering the whole viewport.
  - Lighthouse's LCP element on desktop sits under `body.mpg-auth-open`.
  - The `/map` screenshot shows "Sign in to explore the live map".
- **Impact:**
  - Google's page-experience guidance treats interstitials that hide the main content right after arriving from search as intrusive.
  - It also cuts engagement from brand searches (users who searched for the brand and land on the home page).
  - Googlebot does not log in, so it never sees map content. The `sr-only` summary on `/map` is the only text it gets there.

### SEO-4 — Medium (affects 928 pages): project images and `og:image` sit under a path `robots.txt` blocks
- **Where:**
  - `app/robots.ts` disallows `/api/`.
  - Project images and `og:image` are `/api/media/pins/<id>?f=image…`, built in `lib/pin-media.ts` and `app/projects/[slug]/layout.tsx`.
- **Evidence:** 928 of 932 project pages have an `og:image` under `/api/`. `robots.txt` was fetched live and includes `Disallow: /api/`.
- **Impact:**
  - Google Images cannot index any project image.
  - Rendered pages lose their main image.
  - Social crawlers (Facebook, LinkedIn, WhatsApp) do not read robots.txt, so share previews still work.

### SEO-5 — Medium: project pages show the developer logo, not project photos
- **Where:**
  - `app/projects/[slug]/page.tsx` renders `pin.image`, a 160×160 image.
  - For 886 of 935 public pins, `pin.image` is a `data:` developer logo (DB).
  - The `projects` table holds official `gallery_urls` for 330 of the 929 linked projects and `cover_image_url` for 361. Neither is used on the SEO page; the only use is `lib/home/quickview.ts`.
- **Impact:**
  - Weak image-search presence.
  - Logo share previews.
  - No visual content to support "photos" or "gallery" queries.

### SEO-6 — Medium: internal linking is shallow
- **Breadcrumbs:** the trail is `Home › Project` only (`app/projects/[slug]/page.tsx`, `crumbs`). It has no city or locality level because those pages no longer exist (SEO-1).
- **Inbound links per project page:** p50 = 4. 285 of 932 project pages have ≤3 internal links pointing to them. Most links come from paginated `/projects?page=N`, status and type lists.
- **Related projects:** each page links up to 6 "related" projects (same locality first). That is good, but the locality itself is not a link target.

### SEO-7 — Medium: `llms.txt` is out of date
- **Where:** `public/llms.txt`.
- **Evidence:** it says "As of September 2026: 184 projects mapped". It lists only Pune and MMR localities and says details "unlock after a visitor shares their name, WhatsApp number and email".
- **Reality:** 932 property projects across Bengaluru 447, Pune 281, MMR 115, Delhi NCR 72, Hyderabad 15, Dubai 1 and Nashik 1. The site also has public project pages.
- **Impact:** AI assistants and answer engines quote wrong coverage numbers.

### SEO-8 — Medium: project structured data is minimal
- **Where:** `lib/seo/schema.ts` `projectSchema()`.
- **What is emitted:** `Residence` with name, description, url, image, address, geo and a RERA identifier.
- **What is missing:** no `offers` or price (even though 570 projects show a price), no `numberOfRooms`, no `floorSize`, no `RealEstateListing` / `Accommodation` / `ApartmentComplex` modelling, and no developer link (`brand` / `provider`).
- **FAQPage:** emitted on all 932 project pages. Since Aug 2023 FAQ rich results are limited to authoritative government and health sites, so this markup brings no SERP feature. It is harmless, but it is not a lever.

### SEO-9 — Medium: duplicate project (title duplicate)
- **Pages:** `/projects/trump-world-center-mundhwa-24` and `-86` share the title "Trump World Center in Mundhwa, Pune | Price, Office Spaces — Mappingg".
- **Cause:** pins #24 and #86 are the same project, with different location text ("Mundhwa / Old Passport Of…" and "Mundhwa, Pune").

### SEO-10 — Low: the property-type taxonomy is fragmented, which creates thin hubs
- **Evidence:**
  - The pin `type` field has 14 spellings for about 5 real types: "Residential/Group Housing" 388, "Residential" 318, "Mixed-Use" 39, "Mixed" 10, "Mixed Development" 9, "Residential / Commercial" 2, "Residential/ Commercial" 1, and others. 68 pins have no type.
  - This produces 25 `/property/*` URLs, including thin ones: `/property/3-bed-suites-retail` (117 words), `/property/villa-plot` (133 words) and `/property/residentialgroup-housing?page=9` (92 words).

### SEO-11 — Low: other crawler findings
- **Long titles:** 51 are over ~70 characters (list in `TECHNICAL-SEO-ISSUES.csv`, code `title-long`).
- **Pages missing from the sitemap:** two indexable pages are not listed: `/delete-account` and `/developer-api/reference`. The latter has 0 visible words (client-rendered), so it should probably be `noindex`.
- **Weak pages in the sitemap:** `/mundhwa-map-3d` is listed but has 11 visible words. `/buyer-requirement` has no internal links pointing to it.
- **Redirect chain:** `http://mappingg.com/` → `https://mappingg.com/` → `https://www.mappingg.com/` takes 2 hops. `http://www…` and `https://mappingg.com/*` each take 1 hop (308).
- **Heading skips:** 3 pages. One title has an ALL-CAPS name.

### What already works (keep it)
- Every page has a unique title, description and self-canonical, built in one place (`lib/seo/metadata.ts`).
- The sitemap lists indexable URLs only and uses real `lastmod` dates.
- Placeholder projects get `noindex, follow` (`lib/seo/indexing.ts`).
- Old slugs 308 to the canonical slug, and hidden duplicates 308 to the project that was kept.
- The site has 0 broken internal links, 0 5xx responses and 0 JSON-LD errors.
- Project pages are server-rendered with 416 visible words (median), real facts, an FAQ and related projects.
- Lighthouse SEO scores 100 on the project, projects, blog and home pages.

---

## 3. Project-wise SEO status

The full per-project table is `reports/seo-audit/2026-11-22-complete-audit/PROJECT-SEO-REPORT.csv`. Its columns are url, generated title and description, indexable, data gaps, keywords and live status.

| Status | Count | Meaning |
| --- | --- | --- |
| SEO-ready (indexable, 200, unique title and description, no data gaps among the tracked fields) | **392** | Ready to rank on their facts |
| Indexable but with data gaps (price, carpet area, possession, RERA or configuration missing) | **540** | Indexable, but the page is thinner and does not answer price or size queries |
| Noindex placeholder (no title, location, price, configuration or description) | **3** (pins #920, #921, #936) | These pins are still visible on the public map with no title |
| Not a project (an office marker and land parcels; no page) | 3 (#1, #73, #74) | Intended |
| Duplicate title | 2 (#24, #86) | Same project twice |
| Uses a logo as its image / image blocked by robots.txt | 886 / 928 | See SEO-4 and SEO-5 |

How many projects have 0, 1, 2… tracked data gaps:

| Data gaps | Projects |
| --- | --- |
| 0 | 392 |
| 1 | 368 |
| 2 | 125 |
| 3 | 29 |
| 4 | 13 |
| 5 | 5 |
| 9 | 3 |

---

## 4. Competitive opportunities (Pune and Mumbai)

These come from site data only. No search volumes or rankings were available.

| Query family | Current best URL | Gap |
| --- | --- | --- |
| Flats / new projects in Mundhwa (69 projects) | `/blog/new-projects-in-mundhwa-pune`, `/mundhwa-map-3d` (11 words) | No transactional locality hub. The 3D map page has almost no text. |
| Flats in Kharadi (29) | `/blog/new-projects-in-kharadi-pune`, `/blog/kharadi-vs-mundhwa-pune` | Same: no hub |
| Flats in Hinjewadi (12) / Wakad (6) | `/blog/new-projects-in-hinjewadi-baner-balewadi-pune`, `/blog/hinjewadi-vs-wakad-pune` | No Wakad-specific page. No hubs. |
| 1 BHK flats in Pune | none | Missing. `/blog/2-bhk-flats-in-pune` and `/blog/3-bhk-flats-in-pune` exist. |
| 2 / 3 BHK by locality | none (the facet pages were removed on 4 Nov) | Missing |
| Property prices by locality | `/blog/flat-prices-in-pune-by-locality-and-bhk` (one article) | No per-locality price pages. 362 projects have no price, which limits this. |
| RERA-registered projects | none (874 projects carry a RERA number) | Missing a "RERA registered projects in Pune/Mumbai" listing |
| Developer + city ("Lodha projects in Pune") | none (developer pages were removed) | Missing |
| Mumbai localities: Powai, Chembur, Mira Road | none (0 projects in the DB) | This is a data-coverage gap, not a page gap |

**Cannibalisation risk:** with the hubs gone, the blog posts are now the only locality pages. The overlaps are:
- `new-projects-in-mundhwa-pune` and `kharadi-vs-mundhwa-pune`
- `new-projects-in-hinjewadi-baner-balewadi-pune` and `hinjewadi-vs-wakad-pune`

Rebuilt hubs would need clear intent splits: hub = listing, blog = guide. `KEYWORD-URL-MAPPING.csv` has a cannibalisation-risk column for each URL.
