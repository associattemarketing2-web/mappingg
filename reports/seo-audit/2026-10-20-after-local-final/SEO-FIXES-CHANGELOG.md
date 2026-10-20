# SEO fixes changelog — 20 Oct 2026

Branch `seo-consent-perf-2026-10`. All changes are local and **not yet committed or deployed**. No database records were changed; every DB read in the audit ran in a read-only transaction.

## What was wrong and what changed

### 1. Valid pages could return 404 during a database hiccup (critical)
The SEO data loaders turned any DB error into "nothing found". A brief connection problem made valid pages 404 (seen live: `/blog?page=2` returned 404, then 200 on retry), produced empty listings, and could cache a sitemap without projects or articles for an hour.

- `lib/seo/entities.ts` — `getPublicPins` / `getPinByNumber` now separate "no such project" (404) from "read failed" (throw → Next keeps serving the last good page, or a 5xx that crawlers retry). During `next build` the old fallback stays, so a deploy never fails on a DB blip.
- `lib/blog.ts` — `listPublished({ strict: true })` and new `getPublishedPost()` for the website and sitemap. The developer API keeps the old lenient behaviour (unchanged).
- `app/blog/page.tsx`, `app/blog/[slug]/layout.tsx`, `app/blog/[slug]/page.tsx`, `app/sitemap.ts` — use the strict loaders.

### 2. Locality, city and property-type pages added after a deploy returned 404 (high)
These routes were prerender-only (`dynamicParams = false`), so a locality that appeared after the last build 404'd while `/locations` linked to it (live: `/locations/wanowri`).

- `app/locations/[slug]/page.tsx`, `app/cities/[city]/page.tsx`, `app/property/[type]/page.tsx` — `dynamicParams = true` (render on first request, then ISR).
- Matching `layout.tsx` files (+ `app/status/[status]/layout.tsx`) — unknown slugs call `notFound()` before streaming, so they are real 404s, not soft 200s.

### 3. Half the site's projects had no city hub, and hub copy said "Pune & MMR" (high)
965 projects: Bengaluru 491, Pune 259, Mumbai & MMR 120, Delhi NCR 81, Hyderabad 12. Only Pune and Mumbai had hubs; `/cities/bengaluru` was linked from a blog post and returned 404.

- `lib/seo/city.ts` — hubs for Bengaluru, Delhi NCR and Hyderabad (rule: 10+ projects); `citiesPhrase()` names the cities a set of projects is actually in.
- `lib/seo/entities.ts` — `citiesPhrase(pins)` wrapper.
- Titles, descriptions, H1s and FAQ answers now use real coverage: `app/projects/*`, `app/developers/*`, `app/status/[status]/*`, `app/property/*`, `app/locations/layout.tsx`, `app/cities/*`.
- `app/cities/page.tsx` — intro paragraph with per-city counts (was ~4 words).
- `app/cities/[city]/page.tsx` — removed "one of two regions"; links to the other city hubs.
- `lib/seo/config.ts`, `app/map/layout.tsx`, `app/map/page.tsx` (hidden H1 text only), `app/faq/page.tsx`, `components/landing/body.ts` (FAQ "Which areas are covered?"), `app/how-it-works/layout.tsx`, `app/blog/layout.tsx`, `app/blog/page.tsx`, `app/page.tsx`, `lib/seo/schema.ts` (`areaServed`).

### 4. Project pages: generic titles, hidden RERA, no facts on most pages (high)
926 titles ran past ~70 characters ("… | Price, Location & Details — Mappingg" on every project, even without a price). 808 projects have a RERA number that the page never showed. 574 project pages had under 150 words.

- New `lib/seo/project-meta.ts` (shared by the page and the audit):
  - `projectTitle()` — name + locality + city, then only the facets the page shows (Price, BHK, RERA, Possession), trimmed to fit ~70 characters.
  - `projectDescription()` — facts only, ≤160 characters, no ".…" endings.
  - `projectFaqs()` — a question is asked only when the page has the answer (price, configuration, RERA, possession added).
  - `projectSummary()` — a short overview built only from filled fields and map counts.
  - `applyFieldVisibility()` — honours the admin's per-field "hide on public card" switches (the live map and API already did; SEO pages didn't — 4 projects affected).
- `app/projects/[slug]/layout.tsx`, `page.tsx` — use the above; RERA row in the spec table; RERA as `identifier` in the Residence schema (`lib/seo/schema.ts`); main image `fetchPriority="high"`.
- `lib/seo/developer-name.ts` — ALL-CAPS imported names shown in title case (466 projects): `Pvt./Ltd.`, `M/s.` prefixes and small words handled; new `displayPlaceName()` for capitalised localities ("VILLAGE- GADAULI KALAN" → "Village Gadauli Kalan"). Display only: slugs ignore case and spacing, verified for every project (0 URL changes).

### 5. FAQ page schema answered every question with the question (high)
`app/faq/page.tsx` used the question text as `acceptedAnswer` because the answers are JSX. New `lib/seo/node-text.ts` extracts the visible answer text.

### 6. Developer pages (medium)
- `app/developers/[slug]/page.tsx` — facts paragraph from the developer's own projects (cities, localities, status split, price range, BHK, possession years, RERA count). 61 indexable developer pages had under 150 words.
- `app/developers/[slug]/layout.tsx` — title falls back to "<Name> Projects" when the city list would overflow; description clipped to 160.

### 7. Blog articles (medium)
- `app/blog/[slug]/page.tsx` — `Home › All articles` breadcrumb (visible, same style as the old back link) + `BreadcrumbList` schema; visible "Updated" date when the post was edited later; cover image `fetchPriority="high"`; CTA no longer claims "MahaRERA-verified" on non-Maharashtra guides; publisher linked to the site Organization.
- `app/blog/[slug]/layout.tsx` — Open Graph `siteName`, `locale`, `modifiedTime`, `tags`; Twitter image fallback.
- `app/blog/blog.css` — hover colour for the breadcrumb links.

### 8. Internal linking (medium)
- `components/SiteHeader.tsx` — mobile menu adds All projects, Cities, Localities (`/locations` had no inbound links). Desktop nav unchanged.
- New `lib/seo/blog-links.ts` — locality and city pages link to their matching blog guides (whole-word slug match, max 3).
- `app/locations/[slug]/page.tsx` — status links say "All under construction projects" (they open the all-cities page, not the locality).
- `app/projects/page.tsx` — links to every city hub.

### 9. Metadata polish (low)
- Descriptive titles: `app/about`, `careers`, `faq`, `features`, `how-it-works`, `contact`, `developer-api` layouts.
- `app/map/layout.tsx` — 330-character description and keyword list replaced with `buildMetadata()`.
- `app/page.tsx` — description 243 → 158 characters; meta keywords removed.
- `app/sitemap.ts` — `/developer-api` added.
- `app/blog/page.tsx` — `/blog?page=2`, `?page=3` get their own meta description (they shared /blog's).

### 11. Fixed after the final crawl
The crawl of this folder flagged five issues introduced by my own edits; four were fixed and re-checked on a fresh production build (spot-check below): over-long descriptions on `/cities`, `/locations`, `/how-it-works`, and a 72-character title on `/status/under-construction` (now falls back to two cities). The fifth — `/cities/bengaluru` is a heavy page (662 KB, 491 project cards) — is the same pagination question as `/projects` (REMAINING-ACTIONS C1).

### 10. Audit tooling (new)
- `scripts/seo-audit/crawl.mjs`, `projects.mts`, `summary.mjs`, `run.mjs`, `common.mjs`; `reports/seo-audit/README.md`.
- `package.json` — `seo:audit`, `seo:projects`, `seo:summary`, `seo:metadata`, `seo:sitemap`, `seo:links`, `seo:schema`.
- `tests/seo-project-meta.test.ts` — 13 tests for the new rules.

## Tests run

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Pass |
| `npm run lint` (`next lint`) | Pass, no warnings |
| `npm test` | 91 pass, 1 fail — `api-enquiries` "one CRM push" is timing-dependent: fails in the full parallel run, passes alone (16/16). Not touched by these changes. |
| SEO unit tests (`seo-project-meta`, `seo-rules`) | 23 / 23 pass |
| `npm run build` | Pass (all 5 city hubs and 170 localities prerendered; no DB fallback used) |
| Full crawl of the production build (`next start`) | See before/after below |
| Final spot-check (fresh build after section 11) | tsc, lint, 28 SEO/blog tests pass; build clean; `/cities`, `/locations`, `/how-it-works`, `/status/*`, a developer page, `/` return 200 with titles ≤70 and descriptions ≤160; sitemap 1,102 URLs incl. all 5 city hubs; `/blog?page=2`/`3` 200 with own descriptions, `?page=4` 404 |
| Lighthouse / PageSpeed / Core Web Vitals | **Not run** — PageSpeed API daily quota exhausted; Lighthouse not installed; changes not deployed, so live before/after would not be comparable |
| Google Rich Results Test | **Not run** (needs a public URL after deploy); JSON-LD checked by the crawler for validity and required fields |
| Search Console URL Inspection | **Not run** — API disabled for the Google Cloud project |
| Mobile rendering / map interaction | **Not run in a browser.** Map code (`/map` app) was not changed except the hidden H1 text; desktop nav unchanged |

## Files

Modified (45): `app/about/layout.tsx`, `app/blog/[slug]/layout.tsx`, `app/blog/[slug]/page.tsx`, `app/blog/blog.css`, `app/blog/layout.tsx`, `app/blog/page.tsx`, `app/careers/layout.tsx`, `app/cities/[city]/layout.tsx`, `app/cities/[city]/page.tsx`, `app/cities/layout.tsx`, `app/cities/page.tsx`, `app/contact/layout.tsx`, `app/developer-api/layout.tsx`, `app/developers/[slug]/layout.tsx`, `app/developers/[slug]/page.tsx`, `app/developers/layout.tsx`, `app/faq/layout.tsx`, `app/faq/page.tsx`, `app/features/layout.tsx`, `app/how-it-works/layout.tsx`, `app/locations/[slug]/layout.tsx`, `app/locations/[slug]/page.tsx`, `app/locations/layout.tsx`, `app/map/layout.tsx`, `app/map/page.tsx`, `app/page.tsx`, `app/projects/[slug]/layout.tsx`, `app/projects/[slug]/page.tsx`, `app/projects/layout.tsx`, `app/projects/page.tsx`, `app/property/[type]/layout.tsx`, `app/property/[type]/page.tsx`, `app/property/layout.tsx`, `app/sitemap.ts`, `app/status/[status]/layout.tsx`, `app/status/[status]/page.tsx`, `components/SiteHeader.tsx`, `components/landing/body.ts`, `lib/blog.ts`, `lib/seo/city.ts`, `lib/seo/config.ts`, `lib/seo/developer-name.ts`, `lib/seo/entities.ts`, `lib/seo/schema.ts`, `package.json`.

New: `lib/seo/project-meta.ts`, `lib/seo/node-text.ts`, `lib/seo/blog-links.ts`, `scripts/seo-audit/{common,crawl,run,summary}.mjs`, `scripts/seo-audit/projects.mts`, `tests/seo-project-meta.test.ts`, `reports/seo-audit/`.

Not changed: authentication, payments, the developer API, the live map app (`public/legacy`), database records, URLs (all project, locality and developer slugs are identical — checked for every project).

## Before / after

| Metric | Before | After |
| --- | --- | --- |
| URLs crawled | 1759 | 1761 |
| Indexable pages (200, no noindex, self-canonical) | 1102 | 1105 |
| Sitemap URLs | 1098 | 1102 |
| HTTP 404 / 5xx | 2 / 0 | 0 / 0 |
| Duplicate title groups | 8 | 6 |
| Duplicate description groups | 9 | 8 |
| Missing title / description / canonical | 0 / 0 / 0 | 0 / 0 / 0 |
| Pages with schema errors | 1 | 0 |
| Broken internal links | 2 | 0 |
| Titles over ~70 chars | 926 | 25 |
| Descriptions over 170 chars | 119 | 20 |
| Thin pages (<150 words, indexable) | 640 | 49 |
| Orphan pages | 1 | 0 |
| Titles with ALL-CAPS names | 178 | 1 |
| Issues: high / medium / low | 18 / 671 / 1233 | 12 / 72 / 56 |

"Before" is the live site (crawled 20 Oct 2026); "after" is the production build of this branch served locally with the same database, crawled with the same tool and settings. Remaining high issues are the 6 same-name project pairs (data decision). Performance was not measured before or after.
