# Mappingg SEO audit — 4 Nov 2026

Scope: the whole repository and the live site (https://www.mappingg.com). This audit builds on the
crawls already in `reports/seo-audit/` (baseline 20 Oct, live re-crawl 3 Nov), a read-only database
pass, and live Google result checks. Nothing in this file is estimated: every number comes from the
crawler, the database or a named source.

## 1. Current architecture

| Layer | What it is |
| --- | --- |
| Framework | Next.js 14.2 App Router, React 18, server components + ISR (`revalidate = 3600` on SEO pages) |
| Data | Postgres (JSONB `doc` per row: `pins`, `posts`, …) read through `lib/db-ops` / `lib/pg`; Mongo code paths still exist; shared data cache in `lib/data-cache.ts` |
| Hosting | Vercel (`vercel.json`), canonical host `https://www.mappingg.com` (`lib/seo/config.ts`) |
| Map | `/map` interactive map (client), `/mundhwa-map-3d` |
| Auth | Buyer sign-in (`/signin`, Google OAuth), developer dashboard (`/dashboard`), staff admin (`/s-admin`) — all disallowed in robots.txt |
| Analytics | GTM / GA4 IDs from admin Settings, loaded after first interaction and gated by Consent Mode v2 (`app/layout.tsx`, `components/CookieConsent.tsx`) |
| Search Console | Service-account client in `lib/search-console.ts`, used by the admin “SEO & Health” tab |

### Public URL families

| Route | Source | Count (3 Nov crawl) |
| --- | --- | --- |
| `/` | home | 1 |
| `/projects`, `/projects?page=N` | all projects, 48 per page | 20 |
| `/projects/<title>-<locality>-<number>` | one per public pin (`lib/seo/slug.ts`) | 963 |
| `/locations`, `/locations/<slug>` | locality hubs from pin locations | 179 |
| `/developers`, `/developers/<slug>` | developer hubs | 566 |
| `/cities`, `/cities/<city>` | Pune, Mumbai & MMR, Bengaluru, Delhi NCR, Hyderabad (`HUB_CITIES`) | 22 incl. pages |
| `/status/<status>` | upcoming / under-construction / ready-to-move | 20 incl. pages |
| `/property`, `/property/<type>` | property-type hubs | 22 incl. pages |
| `/blog`, `/blog/<slug>` | DB posts | 40 posts |
| Static | about, contact, faq, features, how-it-works, legal pages, advertise, careers, developer-api | 16 |
| **New (this pass)** | `/cities/<city>/<facet>`, `/locations/<locality>/<facet>`, `/data-sources` | 71 + 1 |

## 2. Existing SEO implementation (already working — kept)

- One metadata builder (`lib/seo/metadata.ts`): unique title, description, self-canonical, OG and Twitter card per page; root `%s — Mappingg` template.
- `app/sitemap.ts`: only indexable URLs; `lastmod` from real `updated_at` values (never “now”); hourly ISR.
- `app/robots.ts`: blocks `/s-admin`, `/dashboard`, `/intake`, `/submit`, `/signin`, `/partners/`, `/api/`, `/rest/`; points to the sitemap.
- Indexing rules (`lib/seo/indexing.ts`): localities and developers need ≥ 3 projects (or a written area guide); empty placeholder projects are `noindex, follow` and out of the sitemap.
- Pagination: `?page=N` with self-canonical and its own title (`lib/seo/paginate.ts`, `listing-meta.ts`).
- Real 404 and 308 status codes from layouts before streaming starts; hidden duplicates 308 to the kept pin (`duplicateRedirectSlug`).
- JSON-LD: Organization + WebSite (root), BreadcrumbList (every SEO page), ItemList + FAQPage (listings), project schema, BlogPosting, VideoObject. 0 schema errors in the 3 Nov crawl.
- Project text from data only (`lib/seo/project-meta.ts`), respecting admin `field_visibility` (hidden prices never leak into titles, schema or lists).
- Images: covers served as resized WebP via `/api/media`, explicit width/height, `fetchPriority="high"` on the LCP cover.
- Consent-gated, interaction-delayed GTM to protect INP/LCP.
- Audit tooling: `npm run seo:audit` (crawl + DB report + summary with before/after).

3 Nov live crawl versus the 20 Oct baseline: indexable pages 1,102 → 1,130; duplicate titles 8 → 0; duplicate descriptions 9 → 0; schema errors 1 → 0; thin indexable pages 640 → 26; issues high/medium/low 18/671/1,233 → 1/78/124.

## 3. Technical problems found (3 Nov crawl + code review)

| # | Severity | Issue | Status after this pass |
| --- | --- | --- | --- |
| T1 | high | `/locations/taloja` linked from `/blog/new-projects-in-navi-mumbai` returns 404 (Taloja has no public project now) | **Fixed** — blog HTML is post-processed at render (`lib/seo/resolve-links.ts`); links to localities that no longer exist become plain text |
| T2 | low ×50 | Blog posts link to hidden duplicate / renamed project URLs, costing crawlers one 308 hop each | **Fixed** — same resolver rewrites to the final project URL using the cached public-pin list (no stored post edited) |
| T3 | medium ×50 | Hidden duplicates canonicalise to the kept pin | Intended (31 Oct dedupe) — no change |
| T4 | medium ×26 | Thin indexable pages (`/property` 38 words, `/cities` 96 words, 4 small developer pages, last listing pages) | **Improved** `/property` and `/cities` (data-driven copy + status and BHK/budget link sections). Small developer pages are real 3-project lists — left indexable |
| T5 | low ×65 | Titles over ~70 characters (mostly long project names) | Open — names come from RERA records; truncation would hurt accuracy |
| T6 | medium | 1 orphan page (`/buyer-requirement`) | **Fixed** — linked from every BHK/budget page. (`/delete-account` and `/developer-api/reference` are intentionally not in the sitemap) |
| T7 | low | `/developer-api/reference` skips a heading level | Open (Swagger UI markup) |
| T8 | — | Search Console API disabled on the Google Cloud project (403 on 4 Nov) | **Needs owner action** — see GSC-OPPORTUNITY-REPORT.md |

## 4. Indexing problems

- No Google index data is available (Search Console API disabled), so “indexable” here means technically indexable, not indexed.
- 29 placeholder projects are correctly `noindex`. 37 projects have a location the locality parser does not recognise — they still get pages but fall back to city-level links.
- The brand query “mappingg.com” did not return the site in a live web search on 4 Nov. Treat brand visibility as low until GSC confirms otherwise.

## 5. Duplicate content risks

| Risk | Handling |
| --- | --- |
| Duplicate pins (phases/towers) | Hidden + 308 to the kept pin (31 Oct); 5 open duplicate records listed in `reports/quality-audit/2026-10-20/DUPLICATE-RECORDS.csv`; pin number 116 shared by two projects |
| Same query, two URL types (new) | `/blog/2-bhk-flats-in-pune` (price guide) vs `/cities/pune/2-bhk-flats` (live list). They now link to each other, the guide shows a “Live list” box, and titles differ (guide = “… 2026: New Projects & Prices”; list = “2 BHK Flats in Pune: N Projects”). Watch both in GSC — if they swap positions for the same query for 4+ weeks, consolidate |
| Overlapping budget pages | “Under ₹1 Cr” is a subset of “Under ₹2 Cr” by design (separate searches). Each page exists only with ≥ 6 projects |
| Locality aliases (e.g. Mulshi/Hinjewadi, Haveli) | Talukas and localities both come from the pins’ location text; both are real place names buyers use. Monitor |
| `?page=N` | Self-canonical, unique title — correct for distinct lists |

## 6. Keyword targeting gaps (before this pass)

- **No BHK or budget landing pages.** The highest-intent clusters (“2 BHK flats in Pune”, “flats under 1 crore in Pune”, “3 BHK flats in Mundhwa”) were only served by blog posts, while Google ranks listing pages for these queries (Square Yards, Housing.com, Housiey, Homebazaar — see COMPETITOR-ANALYSIS.md). **Fixed:** 71 pages from real inventory (28 city-level, 43 locality-level).
- No page for “RERA verified / data sources” trust queries — **fixed** with `/data-sources`.
- Comparison queries (“Kharadi vs Mundhwa”, “Wakad vs Hinjewadi”) have no page. Ranking results are blogs (e.g. punerealityhub.pages.dev). Planned in CONTENT-ROADMAP.md.
- Mumbai, Delhi NCR and Hyderabad coverage is thin per locality (most localities < 6 projects), so most locality-level BHK pages there do not qualify yet.

## 7. Content quality gaps

- Price is missing on 695 of 913 projects, configuration on 170, possession on 219, carpet area on 702, description on 693 (3 Nov DB report). Budget pages therefore cover only projects that publish a price; each page says how many are priced. Filling prices is the single biggest content lever.
- Bengaluru (447 projects) has only 2 projects with a parsed price under ₹1 Cr — the registry imports carry no prices. Bengaluru budget pages mostly do not qualify.
- Blog: 40 posts; 14 older posts linked to hidden duplicates (now rewritten at render). Posts are authored as “Mappingg Team” (Organization) — accurate; no individual author bios exist (see section 10 of the prompt — not invented).

## 8. Performance

- No field (CrUX) data was retrievable in this session; the PageSpeed Insights API quota without a key is regularly exhausted (noted 20 Oct). Lighthouse-only numbers are not reported as Core Web Vitals.
- Code-level: GTM delayed until interaction or 10 s; cover images resized WebP with dimensions; listings paginated (the old `/projects` page was ~1.2 MB HTML). No regressions introduced: new pages reuse the same server-rendered listing template.

## 9. Internal linking

Before: city → localities/status/guides; locality → nearby localities/developers/guides; project → developer/status/type/locality/city.

Added in this pass:
- City page → its BHK and budget pages (first in “By BHK, budget & locality”).
- Locality page → its BHK and budget pages.
- City facet page → a locality breakdown, linking each locality’s matching facet page where it exists.
- Facet page ↔ other facets in the same place, the same facet in other cities, the parent hub, and the matching blog guide.
- Project page → up to 6 BHK/budget pages it appears on (e.g. “3 BHK Flats in Mundhwa”).
- `/cities` and `/property` → every city facet page (“Browse by BHK and budget”).
- Blog guide → its live list (“Live list” box).
- Footer (legal) and project pages → `/data-sources`.

## 10. Prioritised roadmap

| Priority | Action | Owner | Status |
| --- | --- | --- | --- |
| P0 | Enable Search Console API on GCP project 847257037149 and add the service account to the GSC property | Site owner | Pending |
| P0 | Deploy this change set; submit `sitemap.xml` in GSC; inspect 3 new URLs | Site owner | Pending |
| P0 | Reduce Windsor.ai to 1 connected account (or upgrade) to unlock Google Ads search-term + Keyword Planner data | Site owner | Pending |
| P1 | Fill prices on the most-viewed Pune/Mumbai projects (695 missing) — unlocks more budget pages | Data team | Open |
| P1 | Rerun `npm run seo:audit -- --label=after-deploy --compare=reports/seo-audit/2026-11-03-live-nov02` | Dev | After deploy |
| P2 | Comparison guides (Kharadi vs Mundhwa, Wakad vs Hinjewadi, Baner vs Balewadi) from live data | Content | Roadmap |
| P2 | Resolve 5 duplicate records and the shared pin number 116 | Data team | Open |
| P3 | GA4 key events for project view / enquiry / registration (see IMPLEMENTATION-REPORT.md) | Dev | Open |
