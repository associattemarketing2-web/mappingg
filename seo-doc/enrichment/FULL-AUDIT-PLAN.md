# Full data audit — architecture, plan and rollback (Stage A, 14 Oct 2026)

**Status: Stage A complete, read-only.** No production row was created, changed, merged or deleted. Counts below were read from the production database on 2026-10-14 (09:35 UTC) by `migration/enrichment/inventory.mjs`.

## 1. Verified counts

| Set | Table | Rows | Notes |
|---|---|---|---|
| Registry dataset ("scraped") | `scraped_projects` | **7,704** | 0 soft-deleted · 7,704 unique ids, keys and audit refs · 7,416 unique registration numbers (288 rows have none) |
| Live map projects | `pins` | **418** | 0 hidden, 0 pending, 0 rejected → all 418 are public · only **416 unique pin numbers** (#116 and #416 are each used twice) |
| Intake projects | `projects` | 188 | published from Projects Intake; each owns one pin (`intake_project_id`) |
| Intake submissions | `project_submissions` | 205 | 142 of them came from `scraped_projects` ("Add to Projects") |
| Pin history | `pins_history` | 927 | previous version of a pin before every update/delete |
| Snapshots | `backups` | 10 | Super admin → Backups |
| Recycle bin | `trash` | 4 | soft-deleted admin items |

The **7,704** = three dataset imports on 2026-10-11 (7,097 + 431 + 176 rows). The README in `Developer_Projects/` describes the 7,097-row build; the two later imports added 607 rows.

The **418** = every row of `pins` (none is hidden/pending/rejected). 415 are property projects; 3 are office/land markers.

## 2. Where the records come from

`scraped_projects` is **not** a portal scrape. Every row was collected from an official regulator list on 2026-10-11 (`Developer_Projects/README.md`):

| Regulator | Rows | City |
|---|---|---|
| RERA Karnataka | 4,425 | Bengaluru (full list for scope) |
| HARERA Gurugram | 1,082 | Gurugram (full list for scope) |
| MahaRERA | 2,197 | Mumbai 1,133 · Thane 346 · Pune 586 · Kalyan–Dombivli 132 (**partial**: MahaRERA rate limits, e.g. Pune 26 of 1,300 listing pages) |

Each row keeps `original` (what the registry showed) and `data` (the team's working copy; 137 rows edited). Fields: project name, promoter, registration number (+ Karnataka acknowledgement number), regulator, status + status category, project type, district/locality, dates (Karnataka/Haryana), certificate URL, location check (`pin_check`). Not on any registry list: price, configuration, carpet area, amenities, description, images, contact.

Hyderabad, Delhi and Dubai were **not** collected (CAPTCHA / unreachable / API key) — the 11 live pins there have no registry dataset to match against.

## 3. Relationships

```
scraped_projects ──(submission_id)──▶ project_submissions ──(published_project_id)──▶ projects ──(pin_id)──▶ pins
                                                                                                            ▲
pins ◀── leads.pin_id (8 leads) · users favourites / compare lists · pins_history.pin_id · blog links (/projects/<slug>-<number>)
```

- **Public URL** of a pin = `/projects/<title>-<locality>-<number>`; the page resolves by **number only** and 308-redirects to the canonical slug. Duplicate numbers therefore make one project unreachable.
- **Registry ↔ live:** 155 pins carry a registration number that exists in `scraped_projects` (exact match), and 142 scraped rows were sent to Projects. Matching is by exact registration only — never by name.
- References that must survive any change: 6 pins have leads, 1 is in a favourites/compare list, 927 history rows, blog articles linking project URLs (see `DUPLICATES-REMEDIATION-2026-10-14.md`).

## 4. Existing safety mechanisms (to reuse, not replace)

| Mechanism | Covers | Restore |
|---|---|---|
| `pins_history` (written by `runDbOp`) | every pin update/delete | Super admin → Backups → restore from history |
| `backups` snapshots | whole map data | Super admin → Backups |
| `scraped_projects.deleted` flag | soft delete; a re-import never resurrects or overwrites it | set `deleted=false` |
| `scraped_projects.original` | untouched registry copy | "reset" restores `data` from it |
| `trash` | admin deletes | Recycle bin |
| Local snapshot | `migration/backup/pg-snapshot-2026-10-14-enrichment/pins.json` (git-ignored) | manual |

## 5. Classification (one primary class per record)

| Class | Meaning | How it is assigned |
|---|---|---|
| **A** Verified genuine | identity confirmed by an official registry record | scraped: a registry row with a registration number · pin: its registration found in the registry dataset under a matching name, or verified on MahaRERA (pilot / batch 1) |
| **B** Likely genuine | real registry trace, identity not fully pinned | scraped: Withdrawn/Revoked entries without a number · pin: registration-format number not yet matched, or research outcome "needs review" |
| **C** Duplicate | same project as another record | only after evidence review — **no record is C yet** (see §7) |
| **D** Placeholder / test | no real project identity | scraped: blank / "Test Project" / "Unknown" names · pin: empty title, "New Launch", "New Project", developer name as title |
| **E** Invalid / irrelevant | not a listable property project | scraped: "Rejected (no registration)" · pin: office / land markers |
| **F** Conflicting | evidence disagrees | e.g. registration registered under a different name, a registration on another pin, a typo'd number |
| **G** Research not completed | nothing checked yet | pins outside the registry dataset not yet researched |

Separately from the class, every scraped row carries a **listability** flag: 552 rows are *not listable* (Rejected, Withdrawn, Revoked, Deregistered, Lapsed, Superseded) even when their identity is genuine (class A/B). A lapsed project is a real project — it just should not be advertised as available.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Treating "not found by search" as fake | MahaRERA search returns false "No records" under load (measured); zero results are retried 3× and never classify a record as fake |
| Similar-name contamination (e.g. "Lodha Crown" Kolshet vs Dombivli) | registry matching by exact registration only; name matches are review-only |
| Overwriting good live data | apply tool fills empty fields only, allow-listed fields, verified + high confidence, history captured |
| URL breakage from renumbering/renaming | dedicated redirect plan per change (`DUPLICATES-REMEDIATION`); titles never auto-changed |
| Publishing registry rows as live projects | new pins only via the existing Projects Intake review flow; never automatic |
| Personal data in reports | reports hold project/registry fields only; leads and favourites are counted, never listed |
| Scale: enrichment of 7,416 registry projects | see §8 — scoped, prioritised, resumable |

## 7. Duplicates — what was found (details in `duplicate-candidates.csv`)

- **Registry vs registry:** 0 shared registration numbers. 72 groups (156 rows) share name + promoter + city with **different** registrations — almost always phases/wings of one development; recommended: keep all, link as one development after review. Not duplicates.
- **Live vs live:** pin numbers #116 and #416 each used by two pins (URL conflicts; #416's two pins are blank, created 14 Oct); 3 registrations shared by two pins (Mantra Melange #21/#75, Santiago Sunrise #239/#243, and two pins storing `LAUNCHING-SOON`).
- **Registry vs live:** 155 exact links — these are the same project, intentionally represented in both (registry row = source, pin = published listing). Not duplicates to remove.

## 8. Workflow from here

| Stage | Scope | Method | Status |
|---|---|---|---|
| A | architecture + full inventory (8,122 records) | `inventory.mjs` (read-only) | **done** |
| B | classification + duplicate detection | rule pass in `inventory.mjs`, then human review of F/D/duplicate groups | **first pass done**; review pending |
| C1 | identity of the 237 live pins still B/F/G | MahaRERA official search (`research-maharera.mjs`, ~0.5 min/pin, retries on false zeros) + K-RERA/HARERA dataset matches | 60 done (pilot + batch 1); ~180 MahaRERA pins remain ≈ 2 h unattended |
| C2 | enrichment of live pins (price, configuration, possession, carpet area, amenities, description) | developer sites / brochures / MahaRERA detail page — human-reviewed; registry search pages carry none of these | not started |
| C3 | enrichment of registry-only projects | only for projects the team decides to **publish**, in priority markets, batches of 25 | not started |
| D | reports + change manifest | `report.mjs`, `apply.mts` dry-run manifests | partial (pilot, batch 1) |
| E | owner review + approval | — | waiting |
| F | apply approved changes | staging copy (PGlite rehearsal) → production via `runDbOp` (history) | not started |

**Why C3 is scoped:** the 7,416 registry projects already have a verified identity (registration, name, promoter, status). Enriching all of them with prices, configurations and amenities means project-by-project work on developer sites and brochures — realistically 10–15 minutes each with proper verification, i.e. well over 1,000 hours — and most will never be shown on the map. Doing it only for projects being published keeps quality high.

## 9. Rollback

- Before any production write: fresh `backups` snapshot + local JSON snapshot of the affected tables.
- Pin updates: through `runDbOp` only → previous version in `pins_history` → restorable per pin.
- Registry rows: only the `data` copy or the `deleted` flag ever change; `original` is never written → "reset" restores registry values.
- No hard deletes. Archive = existing soft-delete (`scraped_projects.deleted`, pins `hidden` + recycle bin), each reversible.
- Every apply run writes a before/after manifest (`seo-doc/enrichment/applied-*.json`) to undo field by field.
