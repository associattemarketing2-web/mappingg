# Pune + Mumbai — gap report and 40-record verified sample (stage 1)

Checked 18 Oct 2026. **Read-only work:** no database writes, and no change to `lib/scraped.ts`, go-live rules, map, or APIs.
Thane and Kalyan-Dombivli are not included.

**Backup:** `migration/backup/pg-snapshot-2026-10-18T05-10-29-889Z-pune-mumbai-before-sample/`, which holds all 8,422 `scraped_projects` rows and 694 `developers` rows. The folder is git-ignored.

## Files
| File | What it is |
|---|---|
| `GAP_REPORT.xlsx` / `Gap_Report_Records.csv` | All 1,719 Pune + Mumbai records, with field-by-field gaps, location review, duplicate review and the developer list |
| `SAMPLE_40_Verified.xlsx` / `Sample_40_Records.csv` | 20 Pune + 20 Mumbai records checked by hand, with a status, source and date for each field |
| `research/sample-evidence.json` | The evidence used for each sample record, plus the sources that were rejected and why |
| `gap_summary.json`, `sample_summary.json` | The numbers behind both reports |
| `scripts/` | `gap-report.js`, `build-sample.js`, `osm-reverse.js`, `probe.js`, `check-outputs.js` |

## Gap report: all 1,719 records
| | Pune | Mumbai | Total |
|---|---|---|---|
| Records (all with a unique RERA no.) | 586 | 1,133 | 1,719 |
| Unique developers (legal suffixes ignored) | 487 | 903 | 1,383 |
| Registry point inside the declared district + pincode | 397 | 718 | 1,115 |
| Point approximate / mismatch / missing | 143 / 44 / 2 | 360 / 18 / 34 | 503 / 62 / 36 |
| A logo already in the app matches the name (any source) | 30 | 39 | 69 |
| BHK, units, land area, project cost, completion date | 0 | 0 | **0** (pending MahaRERA) |
| Go-live eligible | 0 | 0 | **0** |

- **Duplicates:** no RERA number appears twice. One name + developer pair has two different RERA numbers (likely phases, so both are kept). 36 developers are written more than one way.
- **Shared points:** 115 points are used by projects of *different* developers (533 records). These are placeholders, not project sites.
- **Point in the sea:** one record (P51900008925) is at 72.08°E, which is in the Arabian Sea. It is already flagged as `mismatch`.
- **PP numbers:** 17 records use the `PP` RERA prefix.

## Sample: 20 Pune + 20 Mumbai
These are the newest MahaRERA registrations by company promoters. Individual landowners and closed registrations were left out.

| | Pune | Mumbai | Total |
|---|---|---|---|
| Developer has an official site we could read | 7 | 2 | 9 |
| Developer identity confirmed on that site | 6 | 1 | 7 |
| Project listed on the official site | 4 | 0 | 4 |
| RERA no. shown on the official project page | 2 | 0 | 2 (Mahindra Rivenza Ph 1 + 2) |
| **Logo verified_official** (link loads) | 6 | 1 | **7** |
| Logo candidate, company identity not confirmed | 1 | 1 | 2 (Malpani, Lotus) |
| Logo missing | 13 | 18 | 31 |
| Developer office address verified | 3 | 1 | 4 |
| Developer office coordinates | 0 | 1 | 1 (Lotus, only if it is the same company) |
| Registry point consistent (pincode / official locality, checked with OSM) | 16 | 14 | 30 |
| Registry point is a shared placeholder | 4 | 0 | 4 |
| Registry point area differs from the declared pincode (needs a check) | 0 | 6 | 6 |
| **Exact project-site coordinates verified** | 0 | 0 | **0** |
| Registry BHK / units / land / cost / completion | 0 | 0 | 0 |
| record_status `verified_official` / `partially_verified` | 0 / 20 | 0 / 20 | 0 / 40 |
| **Go-live eligible** | 0 | 0 | **0** |

**Rejected:** some websites belonged to other companies with similar names: uniquepune.com (a cab firm), rachanagroup.com (Warangal) and shethrealty.com (a Pune firm). Their logos were **not** used.

## What this means
- Most of the newest registrations are small SPVs and redevelopment firms with no website. Logos and office details cannot be verified for them.
- No record can reach the go-live tab without the MahaRERA project page: units, land area, cost and completion date are not published anywhere else, and none of them was guessed.
- Registry points come from the promoter and were checked only for consistency, using OpenStreetMap at area level. None is marked as an exact site.

## Re-run
```
NODE_PATH=<folder with exceljs>/node_modules node scripts/gap-report.js
node scripts/osm-reverse.js
NODE_PATH=... node scripts/build-sample.js
NODE_PATH=... node scripts/check-outputs.js   # 18 Oct 2026: all checks passed
```
ExcelJS is installed only in a scratch folder, not in the project.
