# SEO audit reports

Each run writes to its own dated folder here (`<date>` or `<date>-<label>`); earlier runs are kept.

## Rerun

```bash
npm run seo:audit                                   # live site: crawl + DB report + summary
npm run seo:audit -- --label=after --compare=reports/seo-audit/2026-10-20-baseline-live
npm run seo:audit -- --base=http://localhost:3000 --label=local   # against `npm run start`
```

Focused checks (same crawler, printed to the console, saved under `<date>-focus-<name>`):

```bash
npm run seo:links      # broken internal links, links to redirects, orphans
npm run seo:metadata   # titles, descriptions, canonicals, H1s, Open Graph
npm run seo:schema     # JSON-LD validity and required properties
npm run seo:sitemap    # sitemap.xml + robots.txt checks, indexable pages missing from the sitemap
npm run seo:projects   # read-only DB report only (projects, keywords, blog content)
```

Options for the crawler: `--base=<origin>`, `--limit=<n>` (cap pages), `--concurrency=<n>` (default 4), `--label=<name>`, `--out=<dir>`.

## What each step does

| Step | Script | Reads | Writes |
| --- | --- | --- | --- |
| Crawl | `scripts/seo-audit/crawl.mjs` | robots.txt, sitemap.xml, every static route in `app/`, then every internal link found (GET only, 4 at a time) | `PAGE-BY-PAGE-SEO.csv`, `TECHNICAL-SEO-ISSUES.csv`, `BLOG-SEO-REPORT.csv`, `seo-audit-results.json` |
| Projects | `scripts/seo-audit/projects.mts` | Postgres in a **read-only transaction** (public pins + posts), through the same `lib/seo/*` helpers the pages use | `PROJECT-SEO-REPORT.csv`, `KEYWORD-URL-MAPPING.csv`, `BLOG-CONTENT-REPORT.csv`, `projects-summary.json` |
| Summary | `scripts/seo-audit/summary.mjs` | the two outputs above (+ a baseline folder with `--compare`) | `SEO-AUDIT-SUMMARY.md` |

The projects step needs `DATABASE_URL` (from `.env`). Nothing is ever written to the database.

## Reading the results

- **Indexable** = HTTP 200, no `noindex`, canonical points to itself. It does **not** mean Google has indexed the page — only Search Console can say that.
- **Severity**: `critical` blocks crawling/indexing site-wide; `high` hurts a page's indexing or creates duplicates (404 links, duplicate titles, sitemap URLs that redirect); `medium` weakens a page (thin content, missing alt text, orphan); `low` is polish (long titles, heading order).
- **Thin content** counts visible words inside `<main>`. Project pages with few facts on record will stay short until the data is filled in — the fix is data, not filler text.
- **Keywords**: every row is marked `site data (no search data)`. No search volumes or rankings are invented; once Search Console is connected, replace the evidence column with real queries.

## Not covered (needs other tools)

- Core Web Vitals / Lighthouse — run PageSpeed Insights or Lighthouse on the URLs in the summary.
- Google index status, impressions, clicks — needs the Search Console API (see REMAINING-ACTIONS in the latest run).
- JavaScript-only content — the crawler reads server HTML (what Google indexes first). The live map itself is JS.
