# Scraped project enrichment — summary

Generated 2026-10-15T09:12:46.731Z from the production `scraped_projects` table (read back after writing).

**Nothing was published.** Enriched rows keep their registry `original`, id, key and source fields, their
location check (`pin_check`) and their Projects links. No row in `pins`, `projects`, `project_submissions`
or leads was read for writing or changed. Enriched rows are listed in Super admin → Scraped data →
**Enriched — Review Pending**.

## Counts

| | Records |
|---|---|
| Total scraped records | 7,704 |
| Processed (researched against the official registry) | 7,704 |
| Successfully enriched (saved and verified by read-back) | **5,019** |
| Skipped (no reliable information, or identity not confirmed) | 2,685 |
| Write failed / row changed during a run | 0 |
| Pending review (Enriched — Review Pending tab) | **5,019** |
| Enriched records with a value needing review (conflict, not overwritten) | 1,594 |

| Saved values | Count |
|---|---|
| Enrichment fields saved (`doc.enrichment.fields`) | 80,292 |
| Blank working-copy fields filled (`doc.data`) | 8,111 |
| **Total fields saved** | **88,403** |

### Enriched by regulator

- RERA Karnataka: 4,105
- HARERA Gurugram: 914

### Fields added (records)

| Field | Records |
|---|---|
| registry_project_status | 5,019 |
| registry_promoter_name | 5,019 |
| full_address | 5,018 |
| project_cost | 5,006 |
| land_area | 4,966 |
| project_start_date | 4,831 |
| proposed_completion | 4,831 |
| taluk | 4,105 |
| approving_authority | 4,097 |
| project_description | 3,914 |
| pincode | 3,369 |
| towers | 3,008 |
| amenities | 2,885 |
| configurations | 2,032 |
| unit_mix | 1,817 |
| carpet_area | 1,795 |
| total_units | 1,792 |
| approved_plan_number | 1,722 |
| plan_approval_date | 1,722 |
| water_source | 1,719 |
| registry_latitude | 1,716 |
| registry_longitude | 1,716 |
| developer_website | 1,290 |
| total_carpet_area | 1,277 |
| project_sub_type | 1,227 |
| tehsil | 914 |
| dtcp_license | 914 |
| layout_plan_approval_date | 720 |
| total_plots | 696 |
| building_plan_approval_date | 668 |
| plot_sizes | 487 |

Runs: 15 Oct 2026, 07:26 UTC (1,742 rows, pages fetched by then) and 08:27–09:10 UTC (3,277 rows; the second
run was resumed once after a database timeout, and its one unlogged row was reconciled into the log).
Most "needing review" values are Karnataka completion dates: the detail page shows the extended (e.g. Covid
extension) date while the list had the original date; the original was kept and the registry date is in the enrichment.

### Skipped, by reason (the 2,685 records not enriched)

| Reason | Records |
|---|---|
| MahaRERA project pages need a CAPTCHA/login; not read automatically | 2,197 |
| no registration number on the registry list | 288 |
| registry name … differs from … | 77 |
| too little reliable information on the registry page  | 47 |
| no official project link on the registry list | 37 |
| registry detail page not available (not in the official Bengaluru Urban list or fetch failed) | 31 |
| registry page shows a different number | 7 |
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

## Verification (15 Oct 2026, 09:13 UTC)

`migration/enrichment/scraped/verify.mjs` re-read all 7,704 rows from the database and compared them with the
pre-enrichment snapshot:

- 5,019 enriched rows: all pass — id, key, `original`, deleted flag, Projects links, location and `pin_check`
  unchanged; `data` = snapshot data + recorded fills, every fill on a previously blank field; review status "Pending Review".
- 2,685 other rows: identical to the snapshot. No row missing.
- Live tables (`migration/enrichment/scraped/live-fingerprint.mjs`, before 07:16 UTC / after 09:13 UTC): `pins` 415,
  `projects` 188, `project_submissions` 205, `pins_history` 1,001 — row counts and content hashes identical.

Undo: `migration/enrichment/scraped/revert.mjs <snapshot> --all --apply` removes the enrichment and restores `data`
from the snapshot (skipping any row edited since).

### Correction (15 Oct 2026, 11:40 UTC)

On 188 older HARERA pages a "View Certificate" link sits before the registration status, and the first parser
saved the link text as `registry_project_status`. `migration/enrichment/scraped/fix-hr-status.mjs` re-read the status
from the cached official pages with the fixed parser (155 "APPROVED AND CERTIFICATE UPLOADED", 33 "Extension
Certificate Uploaded"). Only that one enrichment field changed; every row was verified by read-back; 188 lines were added
to the change log (`corrected_verified`). Backup: `migration/backup/pg-snapshot-2026-10-15T11-40-33-748Z-before-hr-status-fix/`.
Live tables re-checked at 11:48 UTC: hashes unchanged.

## Review in the admin

Super admin → Scraped data → **Added data — Check & go live** lists every enriched record with the added facts in
columns (configurations/units, RERA carpet area, land area, start → completion, project cost, amenities, registry
status, conflicts). Filters: "has <fact>", conflicts, Projects state; CSV export has one column per fact.
"Add to Projects" now copies the registry facts into the new submission: configurations that match a form option
exactly, total units, towers, land area (acres) and matching amenities as fields; the rest (project cost, unit mix,
carpet area, approvals, dates, website, address) under Additional details. It still goes to the Review queue first.

### Map location for the complete records (15 Oct 2026, 13:15 UTC)

`migration/enrichment/scraped/locate-ready.mjs` gave a map location to the 787 "Added data — Check & go live" records
(14 already had one). The location is the latitude/longitude on the official RERA Karnataka project page, declared by
the promoter; nothing was geocoded or guessed (the site's Google Maps key is browser-only, and Google's terms do not allow
storing its geocodes). It was saved (`data.lat/lng`, `pin_check` "verified", `pin_reason`, `location_source`) only when
the point is inside Bengaluru, given to at least 4 decimals, inside the boundary of the record's own pincode (OpenStreetMap
postal-code boundary, 1 km tolerance), and not the same point as another promoter's project.

- Saved and verified by read-back: **613**. Live tables re-checked before/after: hashes unchanged.
- Not located (left without coordinates, listed in `LOCATION-NOT-VERIFIED.csv`): 160 — point outside its pincode 115,
  too coarse 13, shared with another promoter 11, pincode without an OpenStreetMap boundary 9, outside Bengaluru 8, no coordinates 4.
- Backup: `migration/backup/pg-snapshot-2026-10-15T13-15-25-207Z-before-locate-ready/`.

## Files

- `PROJECT-CHANGE-LOG.csv` — one line per saved value: record id, field, old and new value, source, confidence, date, save status.
- `REVIEW-PENDING.csv` — the Enriched — Review Pending list.
- Raw registry pages (evidence): `migration/backup/scraped-enrichment-cache/` (local, git-ignored).
- Backup taken before writing: `migration/backup/pg-snapshot-*-before-enrichment/scraped_projects.json` (local, git-ignored).
