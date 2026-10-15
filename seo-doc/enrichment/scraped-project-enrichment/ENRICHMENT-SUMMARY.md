# Scraped project enrichment — summary

Generated 2026-10-15T07:31:40.241Z from the production `scraped_projects` table (read back after writing).

**Nothing was published.** Enriched rows keep their registry `original`, id, key and source fields, their
location check (`pin_check`) and their Projects links. No row in `pins`, `projects`, `project_submissions`
or leads was read for writing or changed. Enriched rows are listed in Super admin → Scraped data →
**Enriched — Review Pending**.

## Counts

| | Records |
|---|---|
| Total scraped records | 7,704 |
| Processed in this run | 7,704 |
| Successfully enriched (saved and verified by read-back), all runs | **1,742** |
| Enriched in this run | 1,742 |
| Skipped in this run | 5,962 |
| Write failed / row changed during the run | 0 |
| Pending review (Enriched — Review Pending tab) | **1,742** |
| Enriched records with a value needing review (conflict, not overwritten) | 403 |

| Saved values | Count |
|---|---|
| Enrichment fields saved (`doc.enrichment.fields`) | 25,526 |
| Blank working-copy fields filled (`doc.data`) | 2,223 |
| **Total fields saved** | **27,749** |

### Enriched by regulator

- RERA Karnataka: 828
- HARERA Gurugram: 914

### Fields added (records)

| Field | Records |
|---|---|
| full_address | 1,742 |
| registry_project_status | 1,742 |
| registry_promoter_name | 1,742 |
| project_cost | 1,739 |
| land_area | 1,689 |
| project_start_date | 1,554 |
| proposed_completion | 1,554 |
| tehsil | 914 |
| dtcp_license | 914 |
| developer_website | 865 |
| taluk | 828 |
| approving_authority | 827 |
| project_description | 784 |
| total_units | 749 |
| layout_plan_approval_date | 720 |
| pincode | 685 |
| building_plan_approval_date | 668 |
| configurations | 627 |
| towers | 615 |
| amenities | 591 |
| unit_mix | 581 |
| carpet_area | 574 |
| total_plots | 352 |
| approved_plan_number | 334 |
| plan_approval_date | 334 |
| water_source | 334 |
| registry_latitude | 333 |
| registry_longitude | 333 |
| plot_sizes | 318 |
| total_carpet_area | 246 |
| project_sub_type | 238 |

### Skipped in this run, by reason

| Reason | Records |
|---|---|
| registry detail page not available (not in the official Bengaluru Urban list or fetch failed) | 3,307 |
| MahaRERA project pages need a CAPTCHA/login; not read automatically | 2,197 |
| no registration number on the registry list | 288 |
| registry name … differs from … | 76 |
| too little reliable information on the registry page  | 47 |
| no official project link on the registry list | 37 |
| registry page shows a different number | 7 |
| registry page not parsed: project section not found | 2 |
| registration number not shown on the registry page | 1 |

## Sources and rules

- **RERA Karnataka:** the official "View Project Details" page for the exact registration number (rera.karnataka.gov.in).
- **HARERA Gurugram:** the official project page and the promoter's registration application, Form REP-I Parts A–C (haryanarera.gov.in). Part G (the promoter's earlier projects) is never used.
- **MahaRERA:** project pages on the new MahaRERA portal require a CAPTCHA and login, so they were not read; MahaRERA rows are skipped.
- A record is enriched only if the registry page shows the same registration number **and** the same project name, and at least 3 useful facts were found. Values are copied as declared to the regulator; nothing is estimated.
- Prices are not published by the regulators and were not added. "Project cost" is the cost declared to RERA, not a sale price.
- Carpet areas are RERA carpet areas (sq m, with sq ft conversions). Karnataka figures are per-type averages (total carpet ÷ units).
- Coordinates from the Karnataka registry are kept as `registry_latitude/longitude` in the enrichment only; the record's location and its "location verified" check are unchanged.
- Working-copy (`data`) fields are only filled when blank. Where the registry differs from an existing value, the value is not changed and the record lists it under "review required".

## Files

- `PROJECT-CHANGE-LOG.csv` — one line per saved value: record id, field, old and new value, source, confidence, date, save status.
- `REVIEW-PENDING.csv` — the Enriched — Review Pending list.
- Raw registry pages (evidence): `migration/backup/scraped-enrichment-cache/` (local, git-ignored).
- Backup taken before writing: `migration/backup/pg-snapshot-*-before-enrichment/scraped_projects.json` (local, git-ignored).
