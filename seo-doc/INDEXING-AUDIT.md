# Mappingg — indexing readiness audit (22 Nov 2026)

**What this covers:** the site's *technical* readiness for Google. It does not report actual index status. The Search Console API returns 403 (`searchconsole.googleapis.com` is not enabled on GCP project 847257037149), and no Search Console source is connected in Windsor.ai.

**Not available, and not estimated:**
- indexed / not-indexed counts
- impressions, clicks, CTR, average position
- queries
- Core Web Vitals field data

**To unlock them:** enable the Search Console API on that GCP project, add the service account as a user on the `sc-domain:mappingg.com` property, then run `npm run seo:gsc`.

## 1. Sitemap against the live site

| Check | Result |
| --- | --- |
| `/sitemap.xml` | 200, well-formed, 1,007 URLs, 192 KB, one file (well under the 50k limit) |
| Composition | 22 static pages, 929 projects, 3 status hubs, 9 property types, 44 blog posts |
| Sitemap URLs that redirect, 404 or 5xx | 0 |
| Duplicates / off-origin / future `lastmod` | 0 / 0 / 0 |
| `lastmod` present | 991 of 1,007 (real `updated_at` values, never "now") |
| Projects missing from the sitemap | 0 indexable ones. The 3 placeholders (#920, #921, #936) are left out on purpose (`noindex`) |
| Blogs missing from the sitemap | 0 of 44 |
| Indexable pages missing from the sitemap | `/delete-account`, `/developer-api/reference` |
| Paginated list pages (`/projects?page=N`, `/status/*?page=N`, `/property/*?page=N`) | Not listed. They self-canonicalise and are reached by links, which is fine |

## 2. Status codes (crawl of 1,068 URLs)

| Code | Count | Notes |
| --- | --- | --- |
| 200 | 1,067 | |
| 301/302/307/308 met on internal links | 0 | Internal links point straight at canonical URLs |
| 404 | 1 | `/pricing`. Found from source routes; not linked; subscriptions are off |
| 5xx | 0 | |

Redirects that exist (tested separately):

| From | Result |
| --- | --- |
| `/developers*`, `/cities*`, `/locations*` | 301 → `/projects` |
| `/signin` | 307 → `/?signin=1` |
| `http://mappingg.com/` | 2-hop chain |
| `https://mappingg.com/*` | 308 → `www` |
| An old or variant project slug | 308 → canonical slug |
| A hidden duplicate pin | 308 → the pin that was kept |

## 3. Crawl efficiency

| Page type | CDN | Response time in the crawl |
| --- | --- | --- |
| Project pages | `private, no-store`, MISS | p50 563 ms, p90 2.0 s, max 7.7 s |
| `/projects` + pages, `/blog` + posts, `/status/*`, `/property/*` | `private, no-store`, MISS | ~260–450 ms |
| `/`, `/faq`, `/map`, `/mundhwa-map-3d`, `/property` | HIT | 13–250 ms |

Every Googlebot fetch of a project page is a fresh server render. Restoring ISR (SEO-2) is the main crawl-budget fix.

## 4. Robots and indexability

- **`robots.txt`:**
  - allows `/`
  - disallows `/s-admin`, `/dashboard`, `/intake`, `/submit`, `/signin`, `/partners/`, `/api/`, `/rest/`
  - declares the sitemap
- **`X-Robots-Tag: noindex, nofollow`** on the dashboards, intake, submit and partners paths (`next.config.mjs`).
- **Noindex pages found:** 1 static page, plus the 3 placeholder projects (not linked, so not crawled).
- **Blocking problem:** `/api/` is disallowed, but the site serves its images from `/api/media/...`. That covers project images and the `og:image` on **928 of 932 project pages**, plus `/api/brochure`. Google can neither fetch nor index those images (SEO-4). The fix is to let `/api/media/` through (`Allow: /api/media/`) or serve media from a non-API path.
- **Canonicals:**
  - self-referencing on every indexable page
  - no canonical points to a redirecting or non-200 URL
  - origin is consistently `https://www.mappingg.com`

## 5. Rendering and JavaScript dependence

| Page | Server HTML content | JS-only content |
| --- | --- | --- |
| Project pages | Full: 416 words (median), specs, FAQ, related projects, schema | Enquiry and quick-view actions |
| Listings and blog | Full | — |
| `/map` | `sr-only` H1 and paragraph only | The whole map. It also reads its data from `/api/db`, which robots.txt blocks, so Google renders an empty map. Acceptable, because `/projects` carries the content |
| `/mundhwa-map-3d` | 11 words | Everything else |
| `/developer-api/reference` | 0 words | Everything (should be noindex or server-rendered) |

## 6. Orphans and discovery

| Item | Value |
| --- | --- |
| Orphan pages | 1 (`/buyer-requirement`) |
| Inbound internal links per project | min 2, p50 4, p90 16, max 150 |
| Projects with ≤3 inbound links | 285 |
| Locality / developer hub links | None; those pages were removed (SEO-1) |

## 7. Readiness summary

| Area | Status |
| --- | --- |
| Crawlability | Ready |
| Sitemap accuracy | Ready |
| Canonicalisation / duplicates | Ready (1 duplicate project) |
| Image indexing | **Blocked** (robots `/api/`) |
| Crawl performance | **Weak** (no CDN cache on SEO pages) |
| Topical hubs (locality / developer) | **Missing** |
| Search Console visibility | **Unavailable** (API disabled) |
