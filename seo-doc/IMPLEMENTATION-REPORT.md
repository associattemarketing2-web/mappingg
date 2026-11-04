# Implementation report — 4 Nov 2026

Checkpoint: work started from a clean tree at commit `4be39a2` on `main`. All changes below are
**uncommitted** in the working tree. No database records were changed (every DB access in this
pass was read-only).

## What was already working (kept as is)

Technical foundation from the October passes: unique metadata and canonicals, real-`updated_at`
sitemap, robots rules, thin-page noindex rules, pagination, 404/308 handling, duplicate-pin
redirects, JSON-LD (0 errors), data-only project text that respects hidden fields, WebP covers,
delayed and consent-gated GTM. Details in SEO-AUDIT.md §2.

## What was broken or missing

1. No pages for BHK and budget searches — the highest-intent clusters.
2. A blog link to a 404 (`/locations/taloja`) and 50 blog links through redirects.
3. Thin index pages `/property` (38 words) and `/cities` (96 words); `/buyer-requirement` orphaned.
4. No public explanation of data sources, RERA meaning, prices or corrections.
5. No GA4 events for leads, project views or searches.
6. No working Search Console, Keyword Planner or field CWV data (all access issues, see below).

## What was changed

### New BHK and budget landing pages (71 pages)
- `/cities/<city>/<facet>` (28) and `/locations/<locality>/<facet>` (43). Facets: 1, 2, 3, 4+ BHK flats; flats under ₹50 lakh, ₹1 crore, ₹2 crore; luxury above ₹2 crore.
- A project counts only when its own configuration or published price matches; hidden prices are never used; sold-out projects are left out; implausible prices (above ₹20 Cr for a home of at most 3 BHK — a lakh/crore typo) are ignored.
- A page exists only with ≥ 6 matching projects; otherwise a real 404. Pages appear and disappear automatically as data changes (ISR, hourly).
- Content per page, all computed: project count, status mix, listed starting-price range with “N of M publish a price”, locality breakdown (linking locality facet pages), RERA verification note with the state registry link, FAQs, paired blog guide, buyer-requirement link.
- Linked from: city pages, locality pages, project pages (up to 6 facets each), `/cities`, `/property`, the paired blog guides, and the sitemap.

### Blog link hygiene (no stored post edited)
- `lib/seo/resolve-links.ts` rewrites `/projects/…` links in post HTML to the final URL (renamed or merged duplicates) and drops links to localities with no public project, at render time, using the cached pin list.
- BHK/budget guides show a “Live list” box linking their facet page; facet pages link back.

### Trust
- New `/data-sources` page: sources, review before publish, what a RERA number does and does not mean (with MahaRERA, Karnataka RERA, UP RERA, HARERA, TG RERA links), how prices/possession are shown, editorial policy, commercial relationship, corrections. Linked from the site footer, the landing footer, every project page (“How we source and check project data”) and every facet page. **Please read it once to confirm each statement matches how the team works.**

### Thin pages
- `/property`: explanatory copy with real counts, status links, BHK/budget index.
- `/cities`: BHK/budget index per city.

### GA4 events (no personal data sent)
`lib/analytics.ts` + `components/TrackOnView.tsx`:

| Event | Where | Parameters |
| --- | --- | --- |
| `view_item` | project page | item_id (pin number), item_name, locality, city |
| `view_item_list` | BHK/budget page | item_list_id (path), item_list_name, results |
| `search` | `/projects` with filters | search_term (filter labels), results |
| `generate_lead` | contact form, project quick-view enquiry, buyer-requirement form (on success) | form, topic / project_number / city / bhk / budget |
| `login` | sign-in prompt success | method |

**GTM setup needed (site owner):** the live site loads GA4 through GTM, so for each event name above add a *Custom Event* trigger and a *GA4 Event* tag (pass the parameters as event parameters), publish the container, and mark `generate_lead` as a key event in GA4. Organic landings need no event (GA4 source/medium). Map interactions and buyer Google sign-up are not tracked yet (legacy map app and server-side OAuth flow).

### Tooling
- `npm run seo:gsc` — Search Console export (16 months, all rows, dated folder, quick-win list).
- `npm run seo:keywords` — rebuilds `seo-doc/keyword-research.csv` from the DB; `--gsc=<Queries.csv>` merges real GSC numbers.
- `scripts/seo-audit/facet-counts.mts` — read-only counts per city/locality facet.
- Crawler labels the new pages `bhk-budget`.

## Files modified

New: `lib/seo/facets.ts`, `lib/seo/facet-pages.ts`, `lib/seo/resolve-links.ts`, `lib/analytics.ts`,
`components/seo/FacetListing.tsx`, `components/seo/FacetIndex.tsx`, `components/TrackOnView.tsx`,
`app/cities/[city]/[facet]/page.tsx`, `app/locations/[slug]/[facet]/page.tsx`,
`app/data-sources/{layout,page}.tsx`, `tests/seo-facets.test.ts`,
`scripts/seo-audit/{facet-counts.mts,keyword-sheet.mts,gsc-export.mjs}`, `seo-doc/*` (9 reports + CSV).

Changed: `app/sitemap.ts`, `app/layout.tsx` (one flag in the tag loader), `app/blog/[slug]/page.tsx`,
`app/blog/blog.css`, `app/cities/page.tsx`, `app/cities/[city]/page.tsx`, `app/locations/[slug]/page.tsx`,
`app/projects/page.tsx`, `app/projects/[slug]/page.tsx`, `app/property/page.tsx`,
`components/{ContactForm,BuyerRequirementForm,SignInPrompt,InfoPage}.tsx`,
`components/landing/{ProjectQuickView.tsx,body.ts}`, `scripts/seo-audit/crawl.mjs`, `package.json`
(2 scripts). `components/icons/fa-subset.css` is regenerated by the build.

## Keyword clusters implemented
C (BHK, city), D (budget, city), E (locality × BHK/budget) as new pages; B and A strengthened with
links; F paired with live lists; G (comparisons) planned, not built. See KEYWORD-RESEARCH.md.

## Issues that remain

| Issue | Owner |
| --- | --- |
| Pin 257 “Belmont Skydale” price stored as “₹ 103.96 – 111.2 Cr” for a 3 BHK in Lohegaon — very likely lakh. Not changed (add-only rule); guarded on the new pages but still shown on the project page | Data team: confirm with developer and fix |
| 695 projects without a price, 702 without carpet area — limits budget pages (Bengaluru almost none) | Data team |
| `seed-blogs.mjs` still references Taloja and old duplicate pin numbers — a full re-seed would fail | Dev |
| 5 duplicate records, shared pin number 116 | Data team |
| 65 long titles (long RERA project names), 20 small developer pages under 150 words | Accept / monitor |
| `/cities/delhi/3-bhk-flats?page=2` holds one project | Accept (fixes itself as inventory grows) |
| Comparison guides (Kharadi vs Mundhwa etc.) | Content (roadmap) |

## Integrations that need credentials or owner action

| Integration | Action |
| --- | --- |
| Search Console API | Enable API in GCP project 847257037149; add the service account to the property. Then `npm run seo:gsc` |
| Google Ads / Keyword Planner via Windsor.ai | Free plan allows 1 account; 4 are connected (Meta + 3 Google Ads). Disconnect 3 or upgrade, then ask me to pull search terms and volumes |
| PageSpeed / CrUX field data | Create an API key; or use GSC Core Web Vitals report |
| GA4 | Add GTM triggers/tags for the 5 events; mark `generate_lead` as key event |
| Bing Webmaster Tools | Import the site from GSC; submit sitemap |

## Search Console actions pending (after deploy)
Resubmit sitemap; request indexing for 5 new hubs; check *Not indexed* reasons; confirm duplicate
URLs show as redirects; check the brand query. Details in GSC-OPPORTUNITY-REPORT.md.

## 90-day growth plan

| Days | Focus | Done when |
| --- | --- | --- |
| 1–15 | Deploy this set; connect GSC, Windsor (1 account), PSI key; GTM events; resubmit sitemap; rerun `npm run seo:audit -- --label=after-deploy --compare=reports/seo-audit/2026-11-03-live-nov02`; fix pin 257 and seed-blogs links | Live audit has 0 high issues; GSC export exists; first baseline recorded |
| 16–30 | Use the real GSC/Keyword Planner data to re-rank `keyword-research.csv`; fill prices for top Pune/Mumbai projects; first comparison guide (Kharadi vs Mundhwa) | Baseline KPIs written into this file |
| 31–60 | More locality inventory where facet pages are just below 6 (Wakad, Baner, Balewadi, Hadapsar, Kothrud, Wagholi); 3 more comparison guides; stamp-duty refresh; quick-win reviews from `opportunities.csv` | New facet pages appear automatically as inventory grows |
| 61–90 | CTR work on reviewed quick wins; infrastructure and IT-commute guides; check cannibalisation between guides and live lists; conversion review of enquiry/lead events by landing page | Before/after comparison per changed page |

KPIs (baselines must come from GSC/GA4 once connected — none are invented here): search
impressions; organic clicks; non-branded clicks; valid indexed pages (GSC Pages report); average
position; CTR; keywords in top 10 and top 20; organic `generate_lead` events; organic buyer
registrations (needs a sign-up event first).
