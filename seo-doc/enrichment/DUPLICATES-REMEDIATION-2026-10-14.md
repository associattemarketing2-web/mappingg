# Duplicate pin numbers and duplicate pins — remediation plan (14 Oct 2026)

**Status: assessment only. No record has been changed.** Backup: `migration/backup/pg-snapshot-2026-10-14-enrichment/pins.json` (all 418 pins). Every pin edit made through the app also saves the previous version to `pins_history`.

## How URLs work (why this matters)

- A project URL is `/projects/<title>-<locality>-<number>`. The page is looked up **by the trailing number only** (`getPinByNumber`), then `app/projects/[slug]/layout.tsx` 308-redirects any non-canonical slug to the canonical one.
- So a number must belong to exactly one pin. If two pins share a number, one of them has **no reachable page**, and its URL redirects to the other project.
- References checked (read-only): `leads.pin_id`, buyer favorites/compare lists (`users`), `pins_history`, intake records (`projects`), blog posts (`posts` links), recycle bin, analytics (`site_events` paths).

---

## Case 1 — Pin number 116 is used twice (real, live bug)

| | Pin A | Pin B |
|---|---|---|
| Database id | `5a743d2b-cc05-4d1e-bd5e-c0e1500cb2e4` | `2f813591-6a0e-4654-8530-e862829b9ae3` |
| Title | YOO ONE | Codename Autobiography by Jhamtani |
| URL | `/projects/yoo-one-116` | `/projects/codename-autobiography-by-jhamtani-116` |
| What the URL shows today | **YOO ONE** (the database returns this pin first) | **Redirects to YOO ONE** — this project has no working page |
| Status / data | Under construction; 3.5/4.5 BHK, ₹3.10 Cr, Dec 2029 | Upcoming; no location, developer or price yet |
| Created | 3 Sep 2026 (map editor) | 1 Sep 2026 (map editor) |
| Leads / favorites / compare | none | none |
| Blog links | none | none |
| History rows | 0 | 1 |
| Analytics visits recorded for either URL | none | none |
| MahaRERA | "YOO ONE PHASE - I" P52100045735 and "PHASE - II" PR1262022600430, promoter Dasscon Realty Pvt Ltd, Pune 411048 — matches the pin's NIBM/Undri position (not yet applied) | not found by name ("Codename" = pre-launch name) |

**Recommendation (safest):** keep **YOO ONE on 116** (its URL already works and may be indexed). Give **Codename Autobiography** the next free number (**417**; current max is 416), so it gets a working page `/projects/codename-autobiography-by-jhamtani-417`, and add a permanent redirect from its old `-116` URL. Nothing references pin B, so no lead, favorite or blog link moves.

Migration steps (for approval):
1. Add to `next.config.mjs` `redirects()`: `/projects/codename-autobiography-by-jhamtani-116` → `/projects/codename-autobiography-by-jhamtani-417` (permanent). Config redirects run before the page, so the old URL can't fall through to YOO ONE.
2. Deploy that first.
3. Update pin B's `number` 116 → 417 through the app's data layer (records history).
4. Verify: both URLs, the sitemap (now lists two distinct pages), the map marker, and `/api/v1/projects/116` + `/api/v1/projects/417`.

Rollback: set pin B's number back to 116 (history row) and remove the redirect.

## Case 2 — Mantra Melange, pins #21 and #75 (same name, same RERA, different map positions)

| | #21 | #75 |
|---|---|---|
| Database id | `65e8ea66-667f-43b6-9be7-5edfeabbd43b` | `9284d848-ae54-4b9b-876b-8d82c45aa7e6` |
| URL | `/projects/mantra-melange-kharadi-21` | `/projects/mantra-melange-kharadi-75` |
| Position | 18.52980, 73.93574 | 18.54246, 73.93061 (≈ 1.5 km north) |
| All listed details | identical (Mixed-Use, 2/3 BHK & shops, 843–1177 sq ft, ₹1.25 Cr, Dec 2029, RERA PM1261012601312, "Kharadi / Wadgaonshri") | identical |
| Video | youtu.be/tQVe5RjiHuo | youtu.be/wq1TZZ804TU (different) |
| Leads / favorites | none | none |
| Blog links | `2-bhk-flats-in-pune` (2 links) | `new-projects-in-kharadi-pune` (3), `best-areas-to-buy-property-in-pune` (2) |
| History rows | 23 | 16 |

MahaRERA name search for "Melange" returns nothing (registered under another name), so the number PM1261012601312 could not be matched to a site yet.

**Assessment:** one registration, two map positions. Either it is one project placed twice (a true duplicate — one position is wrong), or the pins mark two different things (e.g. the site and a sales office/experience centre). The different videos suggest someone added them separately on purpose.

**Recommendation:** do not delete or merge yet. Ask the Mantra contact (or check the MahaRERA certificate's survey/plot number against both positions). Then:
- If one position is wrong: keep the pin with more blog links (**#75**), hide #21 (not delete — it stays restorable), add a permanent redirect `/projects/mantra-melange-kharadi-21` → `/projects/mantra-melange-kharadi-75`, and update the one blog article that links #21 (or rely on the redirect).
- If both are real: retitle one (e.g. "Mantra Melange – Experience Centre") and change its type so it isn't counted as a second project.

## Case 3 — Santiago Sunrise, pins #239 and #243 (same name, same RERA, same position)

| | #239 | #243 |
|---|---|---|
| Database id | `523198a0-7fb0-480a-bf8e-d52f5ed282df` | `12c71781-603c-48ee-8d6d-fa57ee2cef71` |
| URL | `/projects/santiago-sunrise-sanghvi-239` | `/projects/santiago-sunrise-sanghvi-243` |
| Type / units | **Residential** 2/3 BHK, 683–696 sq ft, ₹1–1.29 Cr, **sold** | **Commercial** shops, 429–532 sq ft, ₹1.34–1.75 Cr, **available** |
| Position | 18.570353, 73.818343 | identical |
| Intake records | own intake project `1d63d26e…` | own intake project `53916656…` |
| Leads / favorites | none | none |
| Blog links | none | `new-projects-in-pimpri-chinchwad-pcmc` |

**Assessment:** not a data-entry duplicate — two components (residential and commercial) of one registered project, entered as two intake projects. Both pages carry different, valid information.

**Recommendation:** keep both pins and URLs. To avoid looking like a duplicate, retitle for display only via the intake record (e.g. "Santiago Sunrise – Residences" / "Santiago Sunrise – Shops") **only together with redirects**, or leave the titles and accept two cards. Lowest risk: leave as is.

---

## Root cause and prevention (proposed, not implemented)

- The intake flow assigns the **lowest unused** number (`lib/intake-pins.ts` `nextPinNumber`), and the map editor assigns numbers in the browser. Neither is atomic, so two pins can get the same number, and a deleted pin's number (and therefore its old URL) can be **reused by a different project**.
- Proposed fix after the cleanup: assign `max(number) + 1` atomically on the server, and add a unique index on `(doc->>'number')` for pins (additive, `CREATE UNIQUE INDEX CONCURRENTLY …`, fails safely if a duplicate exists). Needs your approval as a schema change.
