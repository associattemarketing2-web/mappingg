# Mappingg — project data audit (22 Nov 2026)

Every query ran read-only (`BEGIN READ ONLY … ROLLBACK`) against the production Postgres. **No record was changed.**

**Per-project data:**
- `reports/seo-audit/2026-11-22-complete-audit/PROJECT-SEO-REPORT.csv`: one row per public pin, with its data gaps
- `data-quality.json` in the same folder

## 1. Counts

| | Count |
| --- | --- |
| Rows in `pins` | 937 |
| Shown on the public map (not hidden) | 935 |
| Hidden (staff only) | 2 |
| Pending review / rejected | 0 / 0 |
| Public property projects (each has a page) | 932 (3 non-project markers excluded: #1 office, #73 and #74 land parcels) |
| Indexable project pages | 929 |
| Noindex placeholders | 3 (#920, #921, #936: no title, no location; **still drawn on the public map**) |
| `projects` table rows with `is_live = true` | 1,021 |
| …of which point to a pin that no longer exists | **90** (stale `is_live` flags; probably from the 31 Oct dedupe) |
| …linked to a pin that is hidden or no longer linked | 2 |
| `project_submissions` | published 1,021, in_review 52, submitted 8, rejected 4 |
| `developers` | 960 (930 with a logo). The public pins name 585 distinct developers |
| `scraped_projects` (review track; never published automatically) | 8,693 |
| Published blog posts | 44 |

Public projects by city:

| City | Projects |
| --- | --- |
| Bengaluru | 447 |
| Pune | 281 |
| Mumbai & MMR | 115 |
| Delhi NCR | 72 |
| Hyderabad | 15 |
| Dubai | 1 |
| Nashik | 1 |

## 2. Completeness (932 public property projects)

| Field | Missing | Coverage |
| --- | --- | --- |
| Name | 3 (the placeholders) | 99.7% |
| Description | 4 (+74 shorter than 80 characters) | 99.6% |
| Location / locality recognised | 3 | 99.7% |
| Coordinates | 0 missing. 1 outside India (#196 Oleander Residencies, Dubai, which is correct) | 100% |
| Developer | 4 | 99.6% |
| Configuration | 27 | 97.1% |
| RERA number | 58 (+3 with the invalid value `LAUNCHING-SOON`) | 93.5% |
| Possession | 92 | 90.1% |
| Carpet area | 168 | 82.0% |
| Price | **366** (+16 placeholders such as "on request") | 60.7% |
| **Real project photos** (official gallery in `projects.gallery_urls`) | **599 of 929 linked** (330 have a gallery, 361 a cover) | 35.5% |
| Pin image | 886 are developer **logos** (data URIs), 45 URLs, 4 none | — |
| Property type | 68 empty, 14 spellings in use | 92.7% |
| YouTube video | 783 | 16% |
| Brochure | 928 | <1% |

- **Complete on the tracked SEO fields** (price, configuration, RERA, possession, carpet area, developer, description, locality): **392**.
- **Incomplete:** **540**. Of these, 368 are missing one field, 125 two, and 47 three or more.

## 3. Consistency problems (need human correction)

| # | Problem | Records | Evidence |
| --- | --- | --- | --- |
| D-1 | Same project entered twice | #24 and #86 Trump World Center | Same title; both pages indexable |
| D-2 | Invalid RERA value | #180 Lodha Casa Premier, #7 Lodha Mundhwa, #541 Mantra Miora | `rera_number = "LAUNCHING-SOON"` |
| D-3 | RERA number shared by different projects (check each) | #79 World Trade Center / #15 57 Avenue; #54 Horizon Highgroves / #71 108 Suites; #40 Merlin New Project / #66 Merlin 18 East; #65 Ram India New Commercial / #3 Epitome; #189 Blue Moon / #447 Century Astoria; #82 / #91 Eon Waterfront (phase, plausible) | Shared registration ids |
| D-4 | Price unit probably wrong (Cr instead of Lakh) | #257 Belmont Skydale "₹103.96–111.2 Cr" (3 BHK); #397 io Tower "₹430 Cr onwards" (1–3 BHK); #694 Birla Anayu "₹57 Cr onwards"; #736 Avalon Tower B "₹98.63 Cr onwards" | Implausible for the configuration; verify against the official source |
| D-5 | Empty placeholder pins visible on the map | #920, #921, #936 | No title or location |
| D-6 | Pins with exactly the same coordinates | 2 groups (4 pins) | Possibly phases or a copy-paste |
| D-7 | Status skew | `construction` 858 (92%), available 37, upcoming 28, sold 12 | The 21 Nov RERA-status update went to the intake forms; whether pin status is a default value is unverified |
| D-8 | Type taxonomy | "Residential/Group Housing" 388, "Residential" 318, "Mixed-Use" 39, "Mixed" 10, "Mixed Development" 9, "Residential / Commercial" 2, "Residential/ Commercial" 1, "3 BED SUITES & RETAIL" 2, "Villa / Plot" 2, empty 68 | Creates fragmented `/property/*` pages |
| D-9 | ALL-CAPS names | 429 | Shown title-cased on the site, so display only |
| D-10 | Stale live flags | 90 `projects` rows have `is_live=true` but their pin was deleted | Projects in the DB that are not on the website |
| D-11 | Admin-hidden fields served by the API | 4 pins | See SEC-4 |

## 4. SEO and indexing status per project

**All in order:**
- Indexable: 929.
- In the sitemap: 929.
- Returned 200 in the crawl: 932.
- Generated titles are unique for 929 and descriptions for 930.
- Schema is valid on all.

**Issues:**
- 2 projects share a title (D-1).
- 3 are noindex placeholders.
- 928 use an image under the robots-blocked `/api/` path.
- 886 show a logo instead of a photo.

## 5. Score

The score is **71/100**:

| Component | Weight | Score | Calculation |
| --- | --- | --- | --- |
| Completeness | 60 | 49 | 82.3% of the 8 core fields filled across 932 projects (price, configuration, RERA, photo, possession, carpet area, developer, description). 1,321 of 7,456 values missing |
| Consistency | 40 | 22 | Deductions for duplicates (D-1), invalid or shared RERA (D-2, D-3), price-unit errors (D-4), visible placeholders (D-5), type taxonomy (D-8) and stale live flags (D-10) |

**Rule for corrections:** fixes must follow the add-only enrichment rule (`enrich-add-only`). Fill only empty fields from official or registry sources, and correct the D-items only after checking the official source.
