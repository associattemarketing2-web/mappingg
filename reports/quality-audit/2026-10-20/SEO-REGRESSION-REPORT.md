# SEO regression report — 20 Oct 2026

Full crawl of the final production build (`npm run seo:audit -- --base=http://localhost:3100 --label=after-quality --compare=reports/seo-audit/2026-10-20-baseline-live-final`), compared with the live site before the SEO pass. Full output: `reports/seo-audit/2026-10-20-after-quality/` (summary, per-page CSV, issues, `ISSUES-BEFORE-AFTER.csv`, project and keyword reports).

| Metric | Live before | Final build |
| --- | --- | --- |
| URLs crawled | 1,759 | 1,835 (+77 paginated list pages) |
| Indexable pages | 1,102 | 1,179 |
| Sitemap URLs | 1,098 | 1,102 |
| HTTP 404 / 5xx | 2 / 0 | **0 / 0** |
| Broken internal links | 2 | **0** |
| Pages with schema errors | 1 | **0** |
| Missing title / description / canonical | 0 / 0 / 0 | 0 / 0 / 0 |
| Duplicate title groups | 8 | 6 (the duplicate records, DUPLICATE-RECORDS.csv) |
| Titles over ~70 chars | 926 | 68 (mostly "… — Page N of M" on the new list pages) |
| Descriptions over 170 chars | 119 | 4 |
| Thin pages | 640 | 50 |
| Orphan pages | 1 | 0 |
| Issues high / medium / low | 18 / 671 / 1233 | 12 / 65 / 76 |

## Checked specifically for this pass

- **Pagination**: `/projects?page=N`, `/status/*`, `/property/*`, `/cities/*`, `/developers?page=N` — own title ("… — Page 2 of 21"), own description, **self-canonical**, crawlable `<a href>` pager, past-the-end pages return **404**. Every project remains linked (from list pages and from its locality/developer page); sitemap still lists all 936 indexable projects.
- **/map**: crawler-only hidden lists removed; one screen-reader heading + description remain (accessibility, not keyword text). Title/description/canonical unchanged.
- **Project pages**: RERA spec row now names the registry ("RERA Karnataka registration"); FAQ answer names the right registry website; structured data unchanged in shape.
- **Pin 116**: both `/projects/yoo-one-116` and `/projects/codename-autobiography-by-jhamtani-116` return 200 with their own content (previously the second redirected to the first).
- **No URL changed**; no page became noindex; robots.txt unchanged.

## Open SEO items (unchanged from the SEO pass)

Search Console API still disabled (no index/ranking data); 5 duplicate records and 3 same-name pairs need data decisions; Bengaluru projects lack prices and descriptions; legal pages still name only MahaRERA. See REMAINING-ISSUES.
