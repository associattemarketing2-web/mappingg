# Technical SEO report — 4 Nov 2026

Measured with `npm run seo:audit` on the live site (3 Nov, before) and on a local production build
of this change set (4 Nov, after). Local runs use the production database read-only and the
canonical origin `https://www.mappingg.com`. Full per-URL data: `reports/seo-audit/2026-11-04-after-local-nov04-final/`.

## Indexability

| Check | Result |
| --- | --- |
| robots.txt | 200; blocks `/s-admin`, `/dashboard`, `/intake`, `/submit`, `/signin`, `/partners/`, `/api/`, `/rest/`; references the sitemap. Unchanged |
| Accidental noindex on important pages | None. New BHK/budget pages set `index, follow` explicitly (the parent locality layout can mark thin localities noindex; a facet page only exists with ≥ 6 projects) |
| Internal search / filter URLs | `/projects?q=…&bhk=…` keeps its existing handling; the new pages are path-based, not parameter combinations |
| Soft 404s | Facet pages below 6 projects, unknown facets and out-of-range `?page=N` return a real **404** (checked: `/cities/pune/flats-under-50-lakh`, `/cities/hyderabad/1-bhk-flats`, `/cities/pune/nonsense`, `/cities/pune/3-bhk-flats?page=9`) |
| Broken internal links | 1 → **0** |
| Links through a redirect | 50 → **0** (blog links rewritten to the final project URL at render) |
| Redirect chains | None found |
| Duplicate URL variants | Canonical host www + HTTPS everywhere; 0 off-origin canonicals or sitemap URLs |

## Sitemap

- One `sitemap.xml` (Next.js metadata route), hourly ISR, 1,054 → **1,126** URLs: + 71 BHK/budget pages, + `/data-sources`.
- Only indexable URLs; `lastmod` from the newest `updated_at` among the page’s own projects (never “now”).
- Well-formed, 0 duplicates, 0 off-origin (crawler check).
- Size is far below the 50,000-URL limit, so no sitemap index is needed yet. Split by type (projects / hubs / blog) when it passes ~10,000 URLs.
- Image sitemap: not added. Project covers are served from `/api/media` and already referenced in project schema; revisit if Search Console shows image search demand.

## Canonicals and metadata

- Self-canonical on every indexable page, including `?page=N` (own title “— Page N”).
- New pages: unique titles such as “3 BHK Flats in Mundhwa, Pune: 25 Projects — Mappingg”, descriptions with the real count and listed price range, OG/Twitter cards via `buildMetadata`.
- Duplicate titles 0, duplicate descriptions 0, missing title/description/canonical 0.
- Long titles: mostly long project names from RERA records (left as is); paginated facet titles shortened.

## Structured data

| Page type | JSON-LD |
| --- | --- |
| All | Organization (with ContactPoint), WebSite |
| Listings incl. new pages | BreadcrumbList, ItemList (projects on the page), FAQPage (page 1 only; every answer is computed from the listed projects) |
| Project | project schema, BreadcrumbList, FAQPage, VideoObject when a video exists |
| Blog | BlogPosting (author = Organization “Mappingg Team”), BreadcrumbList |

0 schema errors in the crawl. No ratings, reviews or aggregate ratings anywhere. FAQ rich results are
currently limited by Google to authoritative government/health sites, so FAQPage is kept for
meaning, not expected to show as a rich result.

## Core Web Vitals

- **Field data: not available today.** The PageSpeed Insights API returned *429 quota exceeded* (no API key) on 4 Nov for `/`, `/locations/mundhwa` and `/projects`. No lab score is reported as a Core Web Vital.
- To get field data: create a free API key (Google Cloud → APIs → PageSpeed Insights API or Chrome UX Report API) and run PSI with `&key=…`, or read Search Console → *Core Web Vitals* once connected.
- Code-level state (unchanged, no regressions): GTM loaded on first interaction or after 10 s; covers as resized WebP with width/height and `fetchPriority="high"`; listings paginated at 48; shared JS 87.4 kB first load. New routes add 299 B of page JS (server-rendered; one tiny client component for the analytics event).

## Server-rendered content

All new pages are server components: H1, the facts paragraph, locality breakdown, project cards, related links and FAQs are in the initial HTML (verified with `curl`, no JavaScript). Googlebot does not need to run scripts to see any of it.
