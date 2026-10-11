# Developer_Projects

**PARTIAL DATASET.** Built only from official regulator records and developer websites collected on 2026-10-11. Nothing was invented; unknown values are blank.

## City summary

| City | Projects | Developers | Verified / Partial | Verified contact items | Latest verified registration date | Coverage |
|---|---|---|---|---|---|---|
| Mumbai | 963 | 773 | 0 / 963 | 21 | n/a | PARTIAL |
| Thane | 269 | 174 | 0 / 269 | 0 | n/a | PARTIAL |
| Kalyan_Dombivli | 98 | 68 | 0 / 98 | 0 | n/a | PARTIAL |
| Pune | 260 | 205 | 0 / 260 | 0 | n/a | PARTIAL |
| Hyderabad | 0 | 0 | 0 / 0 | 0 | n/a | NO DATA |
| Bengaluru | 4425 | 2848 | 4137 / 288 | 49 | 2026-10-09 | Full list for scope |
| Delhi | 0 | 0 | 0 / 0 | 0 | n/a | NO DATA |
| Gurugram | 1082 | 587 | 1080 / 2 | 46 | 2026-09-14 | Full list for scope |
| Dubai | 0 | 0 | 0 / 0 | 0 | n/a | NO DATA |

Master totals reconcile with city workbooks: YES (7097 project rows).

## Verification levels
- **Verified**: key fields (registration no., project, developer, registration date, status) from a traceable official source.
- **Partially Verified**: some important field missing or uncertain (all MahaRERA records - no registration dates on the listing; Karnataka applications without a registration number; 2 Gurugram rows without a date).
- **Unverified**: none included.

## Key limitations
- Maharashtra (Mumbai, Thane, Kalyan-Dombivli, Pune): MahaRERA listing partly collected because of rate limits; registration/completion dates not available; PR/PM/PC letter meanings unresolved; no PP series observed.
- Hyderabad: Telangana RERA search requires CAPTCHA - not collected.
- Delhi: official portal unreachable - not collected.
- Dubai: DLD data behind reCAPTCHA; Dubai Pulse requires API key - not collected.
- Developer contacts: only selected high-activity developers researched; values taken only from tel:/mailto: links on the developers' own sites.

## Files
- MASTER_Developer_Projects.xlsx, MASTER_All_Projects.csv
- DATA_QUALITY_REPORT.xlsx (automated checks + manual spot-checks)
- Mumbai/Mumbai_Projects.xlsx, Mumbai/Mumbai_Projects.csv, Mumbai/Mumbai_Developers.csv, Mumbai/README.md
- Thane/Thane_Projects.xlsx, Thane/Thane_Projects.csv, Thane/Thane_Developers.csv, Thane/README.md
- Kalyan_Dombivli/Kalyan_Dombivli_Projects.xlsx, Kalyan_Dombivli/Kalyan_Dombivli_Projects.csv, Kalyan_Dombivli/Kalyan_Dombivli_Developers.csv, Kalyan_Dombivli/README.md
- Pune/Pune_Projects.xlsx, Pune/Pune_Projects.csv, Pune/Pune_Developers.csv, Pune/README.md
- Hyderabad/Hyderabad_Projects.xlsx, Hyderabad/Hyderabad_Projects.csv, Hyderabad/Hyderabad_Developers.csv, Hyderabad/README.md
- Bengaluru/Bengaluru_Projects.xlsx, Bengaluru/Bengaluru_Projects.csv, Bengaluru/Bengaluru_Developers.csv, Bengaluru/README.md
- Delhi/Delhi_Projects.xlsx, Delhi/Delhi_Projects.csv, Delhi/Delhi_Developers.csv, Delhi/README.md
- Gurugram/Gurugram_Projects.xlsx, Gurugram/Gurugram_Projects.csv, Gurugram/Gurugram_Developers.csv, Gurugram/README.md
- Dubai/Dubai_Projects.xlsx, Dubai/Dubai_Projects.csv, Dubai/Dubai_Developers.csv, Dubai/README.md
- Sources/ - compressed snapshots of the official pages used, and the scripts that built this folder
- Logs/build_state.json

## Rebuild
```
node Sources/scripts/dpbuild.js <snapshotDir> Developer_Projects
node Sources/scripts/dpqa.js Developer_Projects
```
