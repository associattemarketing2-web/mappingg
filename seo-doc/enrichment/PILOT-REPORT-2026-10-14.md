# Project enrichment — audit and 10-project pilot (14 Oct 2026)

**Status: read-only. Nothing has been written to the production database.**
Machine-readable proposals with sources: `pilot-2026-10-14.json`. Per-project completeness: `completeness-2026-10-14.csv`.

## 1. Audit

- Database: Postgres (`pins` table, JSONB documents via `lib/mongo-compat.ts`). 418 pins, all live (none hidden, pending or rejected). **Not ~450.**
- 415 are property projects; 3 are office/land markers (kept off `/projects` by `lib/seo/project-filter.ts`).
- Field rules: the admin editor's limits (`app/api/admin/submissions/route.ts`): text ≤ 120–6,000 chars, lat/lng range-checked. Every pin update through `runDbOp` saves the previous version to `pins_history` (restorable in Super admin → Backups).
- Snapshot taken before any work: `migration/backup/pg-snapshot-2026-10-14-enrichment/pins.json` (git-ignored).

| Field | Filled | | Field | Filled |
|---|---|---|---|---|
| Coordinates | 100% | | Carpet area | 65% |
| Status | 100% | | Possession | 61% |
| Title | 99% | | RERA number | 45% (+ 95 valid Karnataka/Haryana numbers) |
| Image | 99% | | Configuration | 46% |
| Location | 90% | | Price | 43% |
| Developer | 89% | | Video | 33% |
| Type | 87% | | Key USP | 21% |
| Description (≥ 80 chars) | 1% | | Amenities | 4% · Brochure 2% |

### Identity warnings found by the audit

| Issue | Pins | Why it matters |
|---|---|---|
| **Two pins share number 116** ("Codename Autobiography by Jhamtani", "YOO ONE") | 116, 116 | Project URLs end in the number, so one of them can't be reached by its URL. Needs a manual renumber. |
| Same title | #5 / #9 "Pristine Properties" | Placeholder title (developer's name), two different launches. |
| Same title + same RERA | #21 / #75 "Mantra Melange" (PM1261012601312) | Possible duplicate pin. |
| Same title + same RERA | #239 / #243 "Santiago Sunrise" (P52100077792) | Possible duplicate pin. |
| Not a project RERA | e.g. "LAUNCHING-SOON", "IN PROCESS", an agent number `A…` stored as project RERA | ~8 pins; shown as-is today. |

## 2. Pilot — what was found

Sources: the **official MahaRERA public search** (identity, registration number, promoter, pincode) and listing portals as secondary evidence only. MahaRERA's project detail pages load by JavaScript and could not be read automatically, so **possession dates and carpet areas could not be verified from MahaRERA** — portal values for those are marked low/medium and not applied.

| # | Project | Identity | Ready to apply (verified) | Needs your decision |
|---|---|---|---|---|
| 19 | Eastern Front | ✅ MahaRERA, 1 result | RERA **P52100055529**; promoter note "Vishal Anjani Associates LLP" | Possession Jun 2028 (2 portals agree); configuration and price conflict across portals |
| 55 | Mellizia Towers | ✅ registered as **Melliza Towers** | RERA **P52100052564** (residential) + commercial **P52100052462** as a custom field | Spelling fix; developer conflict: map says *Vidhyashree Developers*, MahaRERA promoter is *Moonlight Housing Schemes LLP* |
| 137 | Platinum Oceanic | ✅ MahaRERA, promoter PlatinumCorp Lifescapes LLP, 400052 | Copy RERA **P51800078789** from the custom field into the standard RERA field | Map price ₹6 Cr vs portals ₹3.1–4.2 Cr; possession Dec 2026 vs Dec 2028 |
| 99 | Kohinoor Kalideo | ✅ registered as **Kohinoor Kaleido** (Ph I P52100046027, Ph II P52100078107) | — | Spelling fix; which phase does the pin represent? |
| 100 | VJ Yashwin Enchante | ✅ Ph 1 P52100046510, Ph 2 P52100077455 | — | Which phase; developer typo "Villas Javdekar" → "Vilas Javdekar" (only pin with this developer) |
| 129 | Raheja Lunaris | ✅ 4 registered phases (Lunaris-1 Callisto P51700076867, -2, -3, -4) | — | Which phase(s); configuration conflicts across 4 portals |
| 123 | Lodha Crown | ⚠️ MahaRERA "Lodha Crown" = **Kolshet, Thane** (different project) | — | Dombivli RERA numbers from portals disagree — not found |
| 62 | Marvel Diva Ultima | ⚠️ not found by name on MahaRERA | — | Portals cite P52100046794 but describe villas / flats / plots; price field holds "Bunglow Plots" (not a price) |
| 60 | Yoo Pune – Panchshil | ✅ press (2019): yoo/Starck-designed, 228 homes, 6 towers | — | Description from press (medium). **#84 "Yoo Pune by Panchshil"** (Kharadi villa plots) looks like a different project — don't merge; consider renaming |
| 9 | Pristine Properties | ❌ placeholder, not identifiable | — | Needs the real project name from the developer |

### Before → after (pilot, verified items only)

- 3 of 10 projects get a verified RERA number in the standard field (#19, #55, #137); 2 get a sourced custom field.
- 3 more (#99, #100, #129) have verified registrations waiting only on the phase decision.
- 0 titles, developers, locations, coordinates, statuses or prices are changed automatically.

The dry run (`migration/enrichment/apply.mts`) produces exactly these 5 field changes. A rehearsal on an isolated copy of the full snapshot confirmed: 418 pins before and after, only 3 pins changed, 0 unexpected field changes, 3 history rows written, project-page data and API output show the new values, status/visibility unchanged.

## 3. Schema

No schema change is needed to apply verified values (existing fields + `custom_fields`). Research metadata (source, date, confidence) currently lives in these review files. If you want it stored with the data, the minimal additive option is one new table:

```sql
CREATE TABLE IF NOT EXISTS pin_research (
  id bigserial PRIMARY KEY, pin_id text NOT NULL, field text NOT NULL, value text,
  source_url text, source_type text, checked_on date, confidence text, status text, approved_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Not created — only if you approve it.

## 4. Realistic plan for the remaining ~408

- Automatic, reliable: MahaRERA registration number / promoter / pincode for projects whose registered name matches (~60–70% in the pilot). These can be batched (20–50 at a time, polite rate limit, resumable).
- Human check needed: possession dates and carpet areas (MahaRERA detail pages, or an official MahaRERA data source), phase choice for multi-phase projects, price (portals conflict and go stale quickly), descriptions and amenities (should come from developer websites or brochures, which most developers here don't publish in readable form).
- Out of scope automatically: non-Maharashtra projects (Bengaluru, Gurugram, Hyderabad, Dubai) need their own state RERA sources.

## 5. Decisions needed

1. Approve applying the 5 verified changes (#19, #55, #137)?
2. Phases for #99, #100, #129 (or "list all phases")?
3. Title spellings (#55, #99) and developer (#55, #100): rename (URL changes, needs redirects) or add a "Registered name" custom field?
4. Fix the duplicate pin number 116, and review duplicate pairs #21/#75 and #239/#243?
5. Go ahead with batch 1 (next 50 projects, MahaRERA identity + RERA only)?
6. Create the `pin_research` table, or keep metadata in review files?
