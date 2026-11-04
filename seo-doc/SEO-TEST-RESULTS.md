# SEO test results — 4 Nov 2026

Environment: local production build (`npm run build` + `next start -p 3100`) against the
production database (read-only access by the pages; no writes). Canonical origin checked:
`https://www.mappingg.com`.

## Build and code checks

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit -p .` | Pass, 0 errors |
| ESLint | `npx next lint` | Pass, 0 warnings |
| Production build | `npm run build` | Pass. 28 `/cities/[city]/[facet]` + 43 `/locations/[slug]/[facet]` pages prerendered; `/data-sources` static |
| Unit tests | `npm test` | **157 / 157 pass** (9 new in `tests/seo-facets.test.ts`: BHK parsing, budget bands, hidden prices, sold-out exclusion, 6-project minimum, price summary, unique slugs, guide pairing, implausible-price guard) |

## Full crawl (`npm run seo:audit`)

Before = live site 3 Nov (`reports/seo-audit/2026-11-03-live-nov02`); after = local build 4 Nov (`reports/seo-audit/2026-11-04-after-local-nov04-final`).

| Metric | Before | After |
| --- | --- | --- |
| URLs crawled | 1,865 | 1,913 |
| Indexable pages (200, no noindex, self-canonical) | 1,130 | 1,230 |
| Sitemap URLs (well-formed, 0 duplicates, 0 off-origin) | 1,054 | 1,126 |
| HTTP 404 / 5xx | 2 / 0 | 0 / 0 |
| Broken internal links | 1 | 0 |
| Internal links through a redirect | 50 | 0 |
| Duplicate titles / descriptions | 0 / 0 | 0 / 0 |
| Missing title / description / canonical | 0 / 0 / 0 | 0 / 0 / 0 |
| Pages with schema errors | 0 | 0 |
| Orphan pages | 1 | 0 |
| Thin indexable pages (< 150 words) | 26 | 24 |
| Issues high / medium / low | 1 / 78 / 124 | **0 / 26 / 74** |

“Before” included 50 hidden-duplicate URLs reached through blog links (canonical-other-url); after the
link rewrite the crawler no longer reaches them, so the project page count is 913 instead of 963.

Open issues on the new pages: 1 — `/cities/delhi/3-bhk-flats?page=2` holds a single project (105 words).

## Spot checks (curl, server-rendered HTML)

| URL | Status | Title | Robots | Canonical |
| --- | --- | --- | --- | --- |
| /cities/pune/2-bhk-flats | 200 | 2 BHK Flats in Pune: 94 Projects — Mappingg | index, follow | self |
| /cities/pune/flats-under-1-crore | 200 | Flats Under 1 Crore in Pune: 45 Projects — Mappingg | index, follow | self |
| /cities/pune/luxury-flats-above-2-crore | 200 | Luxury Flats Above 2 Crore in Pune: 42 Projects — Mappingg | index, follow | self |
| /locations/mundhwa/3-bhk-flats | 200 | 3 BHK Flats in Mundhwa, Pune: 25 Projects — Mappingg | index, follow | self |
| /locations/kharadi/3-bhk-flats | 200 | 3 BHK Flats in Kharadi, Pune: 9 Projects — Mappingg | index, follow | self |
| /cities/pune/3-bhk-flats?page=2 | 200 | … — Page 2 — Mappingg | index, follow | self (?page=2) |
| /cities/pune/3-bhk-flats?page=9 | 404 | | | |
| /cities/pune/flats-under-50-lakh (5 projects) | 404 | | | |
| /cities/hyderabad/1-bhk-flats (0 projects) | 404 | | | |
| /cities/pune/nonsense | 404 | | | |
| /data-sources | 200 | Data Sources, RERA Checks & Editorial Policy — Mappingg | — | self |

JSON-LD on a facet page: Organization, WebSite, BreadcrumbList, ItemList (one ListItem per project), FAQPage (3–4 Q&A on page 1 only).

Blog checks:
- `/blog/new-projects-in-navi-mumbai`: 0 links to `/locations/taloja` (was 1, a 404).
- `/blog/new-projects-in-sarjapur-anekal-bengaluru`: 53 project links, all return 200 directly (before: several 308s).
- `/blog/2-bhk-flats-in-pune`: “Live list” box links `/cities/pune/2-bhk-flats` (94 projects).

Price guard: before the guard, the Pune luxury page listed 43 projects with a top price of “₹103.96 Cr”
(pin 257 Belmont Skydale, a 3 BHK stored as “₹ 103.96 – 111.2 Cr”). After: 42 projects, top ₹15.58 Cr.

## Not tested / not measurable today

| Item | Why |
| --- | --- |
| Core Web Vitals field data | PageSpeed Insights API 429 (daily quota, no key) |
| Search Console coverage / indexing | API disabled (403) |
| GA4 events reaching GA | Needs a browser with consent granted and GTM triggers configured; code paths type-check and only push to `dataLayer` when tags exist |
| Mobile layout of new pages | Not opened in a browser. They reuse the existing responsive SEO templates (`EntityListing`, `seo.css`) with no new CSS; the only new blog style is a bordered paragraph |
| Live (deployed) behaviour | Not deployed — changes are uncommitted in the working tree |
