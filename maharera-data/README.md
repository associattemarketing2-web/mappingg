# Pune & Mumbai MMR - MahaRERA Developers and Projects Database (PARTIAL)

**PARTIAL DATASET - NOT A COMPLETE LIST.** Only part of the official registered-project listing could be collected within MahaRERA's rate limits.

Generated: 2026-10-11 06:39:08 UTC. Source: Maharashtra Real Estate Regulatory Authority (https://maharera.maharashtra.gov.in), reproduced under its copyright policy.

## Counts

| Metric | Value |
|---|---|
| Unique registered projects collected | 1570 |
| Developers / promoters (from collected projects) | 1188 |
| Pune projects | 260 |
| Mumbai MMR projects | 1310 |
| Verified / partially verified / unverified records | 1544 / 26 / 0 |
| Projects on official status lists (all 6 districts) | 4377 |

## Coverage

| District | Category | Pages collected / total | Throttled-unverified | Not attempted | Records collected / portal total |
|---|---|---|---|---|---|
| Thane | Registered | 47 / 699 | 0 | 652 | 470 / 6988 |
| Mumbai Suburban | Registered | 19 / 633 | 0 | 614 | 190 / 6324 |
| Mumbai City | Registered | 64 / 130 | 1 | 65 | 640 / 1299 |
| Raigarh | Registered | 1 / 542 | 0 | 541 | 10 / 5416 |
| Pune | Registered | 26 / 1300 | 0 | 1274 | 260 / 12996 |
| Palghar | Registered | 0 / 271 | 0 | 271 | 0 / 2706 |
| All (filtered) | Revoked | 4 / 9 | 3 | 2 | 40 / 83 |

Every missing page, with its exact listing URL, is in Missing_Pages_List.csv.

## Status definitions

- **Registered - no adverse list match**: Listed in MahaRERA Registered Projects search and not found on any adverse list on the check date. Does NOT confirm the project is on schedule or that registration is unexpired.
- **Revoked**: Listed in MahaRERA Revoked Projects search (registration revoked / ab initio void).
- **Deregistered**: Listed on MahaRERA "List of Projects Deregistered".
- **Abeyance - lapse of completion date**: MahaRERA's lapse list: completion date lapsed; bank account frozen and sale agreements prohibited until compliance. This is the "Lapsed" status in this workbook.
- **Abeyance - QPR non-compliance**: On MahaRERA abeyance list for non-submission of quarterly progress reports.
- **Abeyance - common bank account**: On MahaRERA abeyance list for sharing a bank account with another project.
- **NCLT (flag only)**: On MahaRERA NCLT projects list; status shown is as on 31-01-2025. Not used to set primary status.
- **Priority**: When several lists match, primary status = first of: Revoked > Deregistered > Abeyance-lapse > Abeyance-QPR > Abeyance-common account. Each list also has its own Yes/No column; each project is counted once.
- **Verified (official listing)**: All listing fields present on the official MahaRERA search card (reg no, project, promoter, district, taluka, pincode, last modified, detail URL) and district consistent.
- **Partially verified**: Record from official listing but one or more listing fields blank or inconsistent.
- **Unverified / Not collected**: Pages that were throttled or returned ambiguous responses ("No Records Found" / "Unable to find records"). No records were taken from such pages; they are listed in Coverage & Missing Pages.

## Files

- Pune_Mumbai_Developers_MahaRERA_Database_PARTIAL.xlsx
- Developer_Directory_PARTIAL.csv
- Registered_Projects_PARTIAL.csv
- Pune_Projects_PARTIAL.csv
- Mumbai_MMR_Projects_PARTIAL.csv
- Revoked_Dereg_Lapsed_Projects.csv
- Duplicate_Review.csv
- Source_Directory.csv
- Coverage_Missing_Pages.csv
- Missing_Pages_List.csv
