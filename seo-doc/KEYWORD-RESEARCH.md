# Keyword research — 4 Nov 2026

**Read this first:** no search-volume, keyword-difficulty, CPC or ranking numbers are in this
report, because none of the sources that hold them could be reached on 4 Nov 2026. Those columns
in `keyword-research.csv` are deliberately empty. Nothing was estimated.

## 1. Data sources checked

| Source | Status on 4 Nov 2026 | What it would add | How to unlock |
| --- | --- | --- | --- |
| Google Search Console API | **Blocked** — credentials work (token issued) but the API returns 403 *“Google Search Console API has not been used in project 847257037149 before or it is disabled”* | Real queries, clicks, impressions, CTR, position, per page/device/country, 16 months | Enable the API (link in GSC-OPPORTUNITY-REPORT.md), then `npm run seo:gsc` |
| Google Ads Keyword Planner (via Windsor.ai) | **Blocked** — 3 Google Ads accounts are connected (Direct by Developer, Magarpatta City Group, Mantra Realtor) and the connector exposes `avg_monthly_searches`, but reads are paused: *“you have 4 accounts connected and your Free plan includes 1 account”* | Average monthly searches, competition, CPC, and real **search terms** that triggered real-estate ads in Pune | Disconnect 3 accounts at onboard.windsor.ai (keep the Pune one with most spend) or upgrade the plan |
| Google Ads search-terms report | Blocked (same Windsor limit) | Exact buyer queries with impressions, clicks and conversions | Same as above |
| Google Trends | Not available (no API access in this environment) | Relative interest by locality over time | Manual: trends.google.com, region India → Maharashtra, export CSV per term |
| Bing Webmaster Tools | Not connected (Windsor has a `bing_webmaster` connector) | Bing queries and backlinks | Verify the site in Bing (import from GSC), connect |
| GA4 | Tag is configured via GTM; no API access in this session | Landing pages, organic sessions, conversions | Connect GA4 (Windsor `googleanalytics4`, or GA4 Data API) |
| Live search results | **Used** — 8 live web searches (US-based search API, not google.co.in, so treat positions as indicative) | Which page types and competitors rank | — |
| Mappingg database (read-only) | **Used** | How many real projects back each page | — |

## 2. How keywords were chosen without volume data

1. **Intent from the live results.** For each query family, the top results show what Google rewards. Listing pages (Square Yards, Housing.com, Housiey, Homebazaar, PropertyPistol) rank for “projects/flats in <locality>”, “2 BHK flats in <locality>” and “flats under 1 crore in Pune”; lender/developer blogs rank for stamp duty and MahaRERA how-tos; blogs rank for “Kharadi vs Mundhwa”.
2. **Real inventory.** A page is only targeted when Mappingg has enough projects for it (≥ 3 for a locality page, ≥ 6 for a BHK/budget page). Example: “flats under 50 lakh in Pune” is **not** targeted — only 5 Pune projects publish a starting price under ₹50 L.
3. **One primary keyword per URL**, secondary keywords as natural variants, and no two URLs with the same primary keyword.

`priority` in the CSV is therefore an inventory-and-intent ranking (P1 = transactional with 40+ projects or a top locality), **not** a demand score. Re-rank once GSC/Keyword Planner data arrives.

## 3. Clusters (139 rows in `keyword-research.csv`)

| Cluster | Rows | Example primary keyword → page | Projects on page |
| --- | --- | --- | --- |
| A. Transactional (city) | 5 | new projects in pune → `/cities/pune` | 273 |
| B. Location | 41 | flats in mundhwa → `/locations/mundhwa` | 50 |
| C. BHK (city) | 18 | 3 bhk flats in pune → `/cities/pune/3-bhk-flats` | 133 |
| D. Budget (city) | 10 | flats under 1 crore in pune → `/cities/pune/flats-under-1-crore` | 45 |
| E. Long-tail (locality × BHK/budget) | 43 | 3 bhk flats in mundhwa → `/locations/mundhwa/3-bhk-flats` | 25 |
| F. Informational | 15 | how to check maharera registration → `/blog/how-to-check-maharera-registration-number` | — |
| G. Comparison | 6 | kharadi vs mundhwa → *no page yet* | — |
| H. Branded | 1 | mappingg → `/` | — |

Grouping requested in the brief:

- **High commercial intent:** clusters C, D, E and the BHK/budget rows in A.
- **Medium commercial intent:** B (locality hubs), G (comparisons), luxury pages.
- **Informational:** F.
- **Local intent:** B and E (every row names a locality).
- **Long-tail opportunities:** E (e.g. “2 bhk flats in thane”, “1 bhk flats in kalyan”, “flats under 1 crore in dombivli”).
- **Branded:** H.

### Pune — what the inventory supports today (4 Nov)

| Page | Projects | Note |
| --- | --- | --- |
| 1 BHK flats in Pune | 13 | |
| 2 BHK flats in Pune | 94 | Guide `/blog/2-bhk-flats-in-pune` linked both ways |
| 3 BHK flats in Pune | 133 | Guide `/blog/3-bhk-flats-in-pune` linked both ways |
| 4+ BHK flats in Pune | 81 | |
| Flats under ₹1 crore in Pune | 45 | Guide `/blog/flats-under-1-crore-in-pune` linked both ways |
| Flats under ₹2 crore in Pune | 99 | |
| Luxury flats above ₹2 crore in Pune | 42 | Guide `/blog/luxury-flats-villas-in-pune` linked both ways |
| Flats under ₹50 lakh in Pune | 5 | **Not created** (below 6) |
| Mundhwa: 2 BHK 6 · 3 BHK 25 · 4+ BHK 22 · under ₹2 Cr 13 · ₹2 Cr+ 15 | | Locality pages |
| Kharadi: 3 BHK 9 · 4+ BHK 6 · under ₹2 Cr 9 | | |
| Hinjewadi: 2 BHK 6 · 3 BHK 8 · under ₹2 Cr 9 | | |
| Mulshi: 2 BHK 12 · 3 BHK 8; Tathawade: 2 BHK 6 | | |
| Wakad, Baner, Balewadi, Hadapsar, Kothrud, Wagholi | < 6 per facet | Locality hub only; grow inventory first |

Mumbai & MMR: 1 BHK 19, 2 BHK 43, 3 BHK 39, 4+ BHK 18, under ₹50 L 9, under ₹1 Cr 17, under ₹2 Cr 25, ₹2 Cr+ 8; locality pages for Thane, Kalyan and Dombivli.
Bengaluru: BHK pages (58 / 229 / 310 / 139) and zone pages (East, South, North, Anekal, Yelahanka); budget pages barely qualify because registry imports carry no prices.

## 4. Cannibalisation rules

| Query | Primary URL | Secondary URL and its job |
| --- | --- | --- |
| 2 / 3 BHK flats in Pune | `/cities/pune/<n>-bhk-flats` (live list) | `/blog/<n>-bhk-flats-in-pune` — “2026 prices + how to choose” guide. Shows a “Live list” box linking the list |
| flats under 1 crore in Pune | `/cities/pune/flats-under-1-crore` | `/blog/flats-under-1-crore-in-pune` (guide) |
| new projects in Kharadi | `/locations/kharadi` | `/blog/new-projects-in-kharadi-pune` (guide; already linked from the hub) |
| flat prices in Pune | `/blog/flat-prices-in-pune-by-locality-and-bhk` | city/facet pages mention prices but target “flats/projects” |

If GSC shows the two URLs of a pair alternating for the same query for 4+ weeks, keep the one with the higher CTR as primary and change the other’s title to the other intent.

## 5. Manual import workflow (until the APIs are on)

1. Search Console → Performance → Search results → last 16 months → **Export → CSV**. Save `Queries.csv`.
2. Run `npm run seo:keywords -- --gsc=path/to/Queries.csv`. Clicks, impressions, CTR and position are merged into `seo-doc/keyword-research.csv` for exact-match keywords. Data source column changes to “Search Console export + Mappingg DB”.
3. Keyword Planner (Google Ads → Tools → Keyword Planner → *Get search volume and forecasts*): paste the `keyword` column, location **India** (and separately **Pune**), language English, export. Paste `Avg. monthly searches`, `Competition`, `Top of page bid` into the matching CSV columns. Do not fill a cell without a source.
