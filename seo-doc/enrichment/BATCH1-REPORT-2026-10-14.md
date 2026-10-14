# Enrichment batch 1 — MahaRERA identity research (14 Oct 2026)

**Read-only. Nothing was written to production.** Machine-readable: `batch1-2026-10-14.json` (per project: existing value, registry rows, source URLs, flags, outcome) and `batch1-2026-10-14.csv`.

## Scope and method

- **50 projects researched:** the next 50 Maharashtra property projects by pin number, after the 10 pilot projects. 5 more pins were researched only for the duplicate report (#75, both #116, #239, #243) and are not counted here.
- **Source:** the official MahaRERA public project search, by name (registration number, registered name, promoter, pincode, district). Portals were not used in this batch.
- **Queries:** 96 unique searches. MahaRERA sometimes returns "No Records Found" for searches that do have results, so every zero result was retried up to 3 times 8 s apart. That made 215 HTTP requests, with 0 failures, between 06:41 and 07:08 UTC (≈ 27 min).
- **Reconciliation:** all 96 cached searches are referenced by the results; no orphaned or missing searches. A second pass re-matched every project against all registry rows already fetched, with no new requests. That pass found #26's registration and the #10 typo.
- **Not researched:** price, possession, carpet area, amenities and description. The MahaRERA search page doesn't carry them, and none are proposed.
- **Not-found results:** "Not found" means no registered project was found by name after 3 tries per query. It does **not** mean the project is unregistered or invalid.

## Outcomes (every project has one)

| Outcome | Count | Projects |
|---|---|---|
| **Verified** — stored RERA number found on MahaRERA under a matching name | **16** | #4 Godrej Elaris, #6 Nova Elegence, #11 Ganga Avanta, #15 57 Avenue, #17 Jhamtani Ace Abundance, #18 Osian Almanova, #20 Shubh Tristar, #23 Duville Avira, #24 Trump World Center, #25 Nova Residency, #29 Global Riverfront, #30 Jhamtani Bizcore, #35 The Reserve, #37 Godrej Skyline, #38 Supreme Towers, #50 Trustfort Icon |
| **Conflicting evidence** | **4** | #7, #10, #31, #47 (below) |
| **Needs manual review** | **12** | #13, #21, #26, #27, #32, #34, #39, #43, #44, #48, #54, #56 (below) |
| **Not found** — genuine project names | **16** | #2 1 Residency by Burgundy, #3 Epitome by Ram India, #8 Port 133, #12 Kumar 47 East, #14 Majestique Landmark, #16 Tayal Envoque, #22 Mantra Marvilla – Burgundy, #28 Mayfair by Burgundy, #33 Panchashil Golden Bell 2, #36 Osian – One & Only, #41 AP81 by Amar & Pristine, #42 Adani Greens, #45 Amar Quantum Tech Park, #51 Vedant 84, #52 Mantra Uber Luxury, #53 Mantra Highstreet & Offices |
| **Not found** — placeholder titles | **2** | #40 Merlin New Project, #49 Anandtara New Launch |

Verified registrations are **existing** values confirmed, so they need no change. For 9 of the 16 (#11, #15, #18, #23, #24, #29, #30, #35, #38), the registered promoter is a separate legal entity from the developer brand on the map (usually an SPV or LLP); this is noted in the JSON.

Six of the 16 genuine "not found" projects already store a MahaRERA-format number: #2 `P52100066482`, #3 `PC1260002500325`, #12 `P52100024598`, #16 `P52100053239`, #22 `P52100054742`, #28 `P52100079211`. Their registered names differ from the map titles, so they could not be matched by name. Those stored values are kept and are not disproved.

## Proposed changes — none applied; all need your review

| # | Map project | Existing | Proposed | Identity evidence (MahaRERA) | Why review |
|---|---|---|---|---|---|
| 10 | Kumar Prism (Kumar World) | `PR1260002501640` | `PM1260002501640` | "Kumar Prism Tower A", Kumar Prism Realty LLP, Pune 411036 | Stored number is not in the registry; the same digits are registered as **PM…**, so a one-letter typo is likely. Another registration, "KUMAR PRISM" P52100034109 (Kumar Properties and Promoters, 411036), also exists, so a phase is involved. |
| 26 | Mantra Business Center (Mantra Properties) | — | `P52100030995` | "MANTRA BUSINESS CENTRE MUNDHWA", Mantra Residences Mundhwa Pvt Ltd, Pune 411036 | Centre/Center spelling. Found in another project's search, not this project's own. |
| 32 | Power Heights & Residency (no developer on map) | — | `P52100047455` | "POWER HEIGHTS AND POWER RESIDENCES", Sapra Constructions, Pune 411036 | Name differs ("Residences"); the developer can't be cross-checked. |
| 34 | Jhamtani Elevate (Jhamtani Group) | — | `P52100078567` | "Jhamtani Elevate", Highspot Realty LLP, Pune 411036 | Exact name; the promoter is a different legal entity than the brand. |
| 43 | Casa Elanza (no developer on map) | — | `P52100029148` | "Casa Elanza", Parmaz Green Realty LLP, Pune 411036 | Exact name; the developer can't be cross-checked. |
| 54 | Horizon Highgroves (Horizon Developers) | — | `P52100030909` | "HORIZON HIGHGROVES", Yashcon Shelter LLP, Pune 411036 | Exact name; the promoter is a different legal entity than the brand. |

Each row's source URL (the exact search whose results contained the registration) is in `batch1-2026-10-14.json` → `summary.proposed_changes[].source_url`.

## Conflicting evidence

- **#7 Lodha Mundhwa:** the stored "RERA" is `LAUNCHING-SOON`, not a registration. No Lodha registration was found for Mundhwa, so this is likely an unregistered upcoming project. Recommend clearing or hiding the RERA field (your decision).
- **#10 Kumar Prism:** probable prefix typo (above).
- **#31 Jhamtani XO Villas:** the stored `P5210048327` has 10 digits; MahaRERA numbers have 11. A digit is missing, and the correct number wasn't found by name.
- **#47 Kumar Parc** (Kumar Corp, no stored RERA): its registration "Kumar Parc Residences – B1" `PR1264042501296` is **stored on pin #207 "The Select Circle"**. Either The Select Circle is the marketing name of Kumar Parc B1, or #207 carries the wrong number. Kumar Parc has 5 registered wings (A1, A2, B1, B2, C-MHADA), so the phase is also unresolved.

## Needs manual review

- **Phases / multiple registrations, phase not confirmed:**
  - **#27 Mantra Mirari:** Phases 1–3: P52100030037, P52100032842, P52100049704.
  - **#39 Platinum Capital:** Retail P52100030060 and Office Phase I P52100047639.
  - **#56 Breeza:** BREEZA P52100047290 and Breeza P II P52100055883 (A and A Developers, 411036). A separate "Goodwill Breeza" in 411015 is a different project.
  - **#44 Omicron Commerz:** a Koregaon Park NX Phase I (411036) and a Baner (411045) registration.
  - **#48 Kohinoor Business Towers:** Mundhwa (Rising Associates, 411036) and Baner (Revoluxe Estates, 411045).
  - **#44 and #48** are likely the 411036 entries, given our Mundhwa/Kharadi pins, but **not confirmed**.
- **#13 Ravima Newtown:** the stored `PR1261012500924` exists as "NEWTON HOME MUNDHWA" (Ravima Venture). The developer matches; the name matches only with spelling tolerance. The value is kept.
- **#21 Mantra Melange:** the stored `PM1261012601312` was not found under any "Melange" name. The only "Melange" registrations belong to other developers (Rama Synergy 411057, Cosmos Skyline 411012). Unresolved; see the duplicate report.
- **#26, #32, #34, #43, #54:** see "Proposed changes".

## Related pins (not conflicts)

- **#35 The Reserve:** its towers "Vyana Phase-I-T1" (`PM1261012601645`, pin #326) and "Vyana Phase-I-T8" (`PR1261012601671`, pin #323) have their own pins. This is fine if intended; just be aware there's an umbrella pin plus tower pins.

## Registered names (proposal only)

Where the registered name differs from the map title (#13 "Newton Home Mundhwa", #26 "Mantra Business Centre Mundhwa", #32 "Power Heights and Power Residences"; pilot #55 "Melliza Towers", #99 "Kohinoor Kaleido"), the map title, slug and URL stay as they are. The existing editor and public card already support a custom field, so a **"Registered name (MahaRERA)"** custom field could hold the legal name without a schema change. This is **a proposal only**; nothing has been added or published.

## Data-quality findings

- **Invalid stored RERA values:** #7 `LAUNCHING-SOON`; #31 `P5210048327` (one digit short).
- **Developer brand vs registered promoter** differs in 17 projects. This is usually normal: projects are registered by SPVs or LLPs. It's not an error, but the registered promoter is the name buyers will see on MahaRERA.

## Remaining work and recommendation

| | Count |
|---|---|
| Live property projects | 415 |
| Maharashtra (MahaRERA) projects done (pilot 10 + batch 50) | 60 |
| **Maharashtra projects remaining** | **247** (100 of them already store a MahaRERA-format number) |
| Outside Maharashtra (other registries) | 103 — Bengaluru 92 (K-RERA), Delhi/Gurugram 8 (H-RERA), Hyderabad 2 (TS-RERA), Dubai 1 (DLD) |

- **Time:** at the observed rate (≈ 0.54 min per project, 1.9 queries per project, 4–8 s between requests) the 247 remaining Maharashtra projects need **≈ 2–2.5 hours** of unattended querying. Raising the request rate isn't worth the risk: the registry already returns false "no records" under load.
- **The real bottleneck is review, not querying:** in this batch only 16 of 50 projects (32%) could be confirmed outright; 16 needed a human decision.
- **Batch size:** run the remaining Maharashtra projects in **2–3 batches of ~100** (unattended, resumable), but review in groups of 25.
- **More efficient official-source workflows:**
  1. **Developer confirmation:** most developers here are your partners. A one-line request ("please confirm your MahaRERA number(s) per tower for X") resolves phases, typos and brand-vs-SPV in one step, and is more reliable than name search.
  2. **Look up stored numbers directly:** the 100 remaining projects that already store a number need a *by-number* check, which this search page doesn't offer. Checking those numbers on MahaRERA's project page (QR/certificate) by hand, or through an official MahaRERA data request, confirms them faster than name matching.
  3. **Prices, possession, carpet area, amenities:** these can only come from the MahaRERA project detail page (JavaScript-only, so it was not automated), developer brochures, or the developer directly. Plan these as a separate, human-reviewed pass.
