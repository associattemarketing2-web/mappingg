# 500 new verified projects (started 31 Oct 2026)

Goal: up to 500 new, unique residential projects outside the cities Mappingg already covers, from official RERA
registries only, each with the GPS point the promoter declared to RERA. Nothing is invented: a value the registry
does not show stays blank and is listed in the missing-fields report. New projects go to the admin's Scraped data
list as **Pending Review**; nothing reaches the public map until the team adds and publishes them.

## Steps

```
node --env-file=.env Developer_Projects/New500_2026-10-31/scripts/audit.mjs                  # 1. what Mappingg already holds → audit/
node Developer_Projects/New500_2026-10-31/scripts/tn-research.mjs --limit=110                # 2. read TN RERA pages (cached)
node --env-file=.env Developer_Projects/New500_2026-10-31/scripts/tn-build.mjs --batch=1     # 3. validate, dry run → batches/
node --env-file=.env Developer_Projects/New500_2026-10-31/scripts/tn-build.mjs --batch=1 --apply    # insert (Pending Review)
node --env-file=.env Developer_Projects/New500_2026-10-31/scripts/tn-build.mjs --batch=1 --revert   # undo that batch
NODE_PATH=<folder with exceljs> node Developer_Projects/New500_2026-10-31/scripts/reports.mjs        # 4. Excel → reports/
```

- `audit/exclusion.json` — every RERA number, project + developer name and map point already in Mappingg (live and
  hidden pins, scraped rows including deleted ones, submissions, pin history, trash). Candidates matching it are duplicates.
- `sources.json` — every source looked at and why it was used, blocked or skipped (→ mappingg_source_registry.xlsx).
- Page cache (git-ignored): `migration/backup/scraped-enrichment-cache/new500/`.

## Batch log

| Batch | Source | Read | Passed | Inserted | Notes |
|---|---|---|---|---|---|
| 1 | TN RERA, Chennai region, registered 2026 | 110 | 52 | 50 (`new500-tn-batch1`) | Backup: `migration/backup/pg-snapshot-2026-10-31T12-43-42-251Z-before-new500-tn-batch1/`. 0 existing rows changed. |

## Known limits

- TN RERA shows BHK types only in the carpet-area statement PDF under `/uploads/`, which its robots.txt disallows, so
  configurations are blank. The admin's "Check & go live" rule needs a configuration, so these rows show in All, not in
  Check & go live, until BHK types come from an allowed source (owner decision).
- The TN map page lists only the current year (2026) by default; its 2024 / 2025 filter needs a form post, which was not used.
- Chennai pincodes have no OpenStreetMap boundary, so the location check is: official GPS point (same on the registry
  map and Form A), ≥ 4 decimals, in the registry district, not shared with another promoter, and within 3 km
  (5 km for a revenue village) of the locality the registry address names.
