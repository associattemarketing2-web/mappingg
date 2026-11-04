# Search Console opportunity report — 4 Nov 2026

## Status: no Search Console data could be retrieved

Tested on 4 Nov 2026 with the service account in `.env` (`GSC_SERVICE_ACCOUNT_JSON`):

- OAuth token: **issued** (the key is valid).
- `GET /webmasters/v3/sites`: **HTTP 403** — *“Google Search Console API has not been used in project 847257037149 before or it is disabled.”*

So there are no real figures for top queries, top pages, CTR, positions, devices or countries in
this report, and none were invented. Windsor.ai (connected to this workspace) also has no Search
Console account connected, and its reads are paused by the free-plan account limit.

## Connect it (about 5 minutes, site owner)

1. Open https://console.developers.google.com/apis/api/searchconsole.googleapis.com/overview?project=847257037149 while signed in to the Google account that owns that Cloud project, and click **Enable**.
2. In Search Console → the `mappingg.com` property → **Settings → Users and permissions → Add user**, add the service-account email (the `client_email` in `GSC_SERVICE_ACCOUNT_JSON`) with **Restricted** permission. It is read-only.
3. Optional: set `GSC_SITE_URL=sc-domain:mappingg.com` (Domain property) in `.env` and in Vercel.
4. Wait a few minutes, then run:

   ```
   npm run seo:gsc
   ```

   It writes a **new dated folder** each run (`reports/gsc/<date>/`), so history is never overwritten: `queries.csv`, `pages.csv`, `query-page.csv`, `devices.csv`, `countries.csv`, `daily.csv`, `opportunities.csv`, `summary.json` — 16 months, all rows (paged 25,000 at a time).
5. Merge into the keyword sheet: `npm run seo:keywords -- --gsc=reports/gsc/<date>/queries.csv`.
6. The admin **SEO & Health** tab (`lib/search-console.ts`) starts showing live data with the same credentials.

Manual alternative (no API): Search Console → Performance → 16 months → Export → CSV, then step 5 with the exported `Queries.csv`.

## What the export will analyse (built in `scripts/seo-audit/gsc-export.mjs`)

| Analysis | Rule |
| --- | --- |
| Quick wins | Queries at average position 5–30 with ≥ 50 impressions and CTR at or below the median for that band, with the page that ranks for each → `opportunities.csv` |
| Branded vs non-branded | Queries containing “mapping” are counted separately in `summary.json` |
| Device / country split | `devices.csv`, `countries.csv` |
| Trend | `daily.csv` |

Review steps for each quick win (do not change a title just because CTR is low):

1. Open the live result for that query — what intent does page 1 serve (lists, guides, project pages)?
2. Does the ranking Mappingg page match that intent? If a guide ranks for a listing query, link it prominently to the list (now done for BHK/budget guides) rather than rewriting it.
3. Only then adjust title/description, keeping the real project count and price range in it.
4. Note the date of each change and compare 28 days before vs after in the next export.

## Pending GSC actions after deploying this change set

- Resubmit `https://www.mappingg.com/sitemap.xml` (now 1,126 URLs, 71 of them new BHK/budget pages and `/data-sources`).
- URL Inspection → *Request indexing* for a few new hubs: `/cities/pune/2-bhk-flats`, `/cities/pune/3-bhk-flats`, `/cities/pune/flats-under-1-crore`, `/locations/mundhwa/3-bhk-flats`, `/cities/mumbai/2-bhk-flats`.
- Check Pages → *Not indexed* reasons for project pages (the site has 884 indexable project pages; Google may index only part of them at first).
- Confirm the 50 hidden-duplicate URLs show as *Page with redirect*, not *Not found*.
- Look at the brand query “mappingg”: a 4 Nov web search for “mappingg.com” did not return the site.
