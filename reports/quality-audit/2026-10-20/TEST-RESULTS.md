# Test results — 20 Oct 2026

Everything below was actually executed. "Not run" items are listed with the reason.

## Automated

| Check | Command | Result |
| --- | --- | --- |
| Type check | `npx tsc --noEmit` | Pass (0 errors) |
| Lint | `npx next lint` | Pass (0 warnings, 0 errors) |
| Unit + integration tests | `npm test` | **108 / 108 pass** (final run). Earlier in the pass: 98 / 98 three runs in a row after the CRM-push test fix |
| Production build | `next build` (in a separate worktree, see FINAL-VERIFICATION) | Pass; no DB fallback used during prerender |
| Intake app syntax | `node --check` on the 3 edited files | Pass |

New test files this pass:

| File | Tests | Covers |
| --- | --- | --- |
| `tests/listing-and-auth.test.ts` | 6 | Pagination (every item exactly once, bad/over-range pages), page window, RERA registry lookup, title suffix length, least-privilege role default |
| `tests/pin-to-intake.test.ts` | 8 | Pin → intake mapping (months, status, configuration, price, area), keep-pin-values rule, publish checks |
| `tests/pin-full-edit.test.ts` | 2 | Open full form for a pin (idempotent, non-destructive) and publish updates the same pin, on in-memory Postgres |

Changed: `tests/api-enquiries.test.ts` — the CRM-push test waits for the push (≤ 5 s) instead of a fixed 30 ms. Root cause: the fire-and-forget push first does a disk-backed geo-IP lookup that exceeded 30 ms under the parallel suite. Not a product defect; the assertion is unchanged.

## Real browser (headless Chrome 155, local production build)

| Suite | Result |
| --- | --- |
| 34 routes × 7 widths (320–1920px), 238 loads | 0 horizontal overflow, 0 JS errors, 0 broken images, focus visible on 12 Tab stops (4 pages) |
| Map: load, wheel zoom, drag pan, touch pan, mobile no-overflow, repeated navigation (4 rounds, markers not duplicated, heap 12–23 MB) | Pass |
| Map: marker click / tap opens the card | 3/3 desktop, 3/3 mobile |
| Map: deep link `?pin=` + detail panel RERA box for MahaRERA, Karnataka, Haryana, UP, invalid value | Pass at 375px (5/5) and 1440px (4/5 — the Karnataka popup was not open yet when checked; passed on re-check in the card/panel run) |
| Map card and panel layout at 375 / 768 / 1440 | No text under the floating buttons; RERA id inside its box |
| Map: simulated pin-data outage | Notice shown (`role="status"`), markers recover, notice removed, no JS errors |
| Authorization probe (97 GET checks, 3 identities) | All refused |
| Lighthouse 12.8.2, 7 routes × 2 builds × 3 runs | See PERFORMANCE-REPORT |
| SEO crawl of the final build (1,835 URLs) | See SEO-REGRESSION-REPORT |

## Not run

| Test | Why |
| --- | --- |
| Signed-in flows (login, logout, session expiry, favourites, compare, developer editing) | No test accounts; creating one = production write |
| s-admin UI incl. the new "Edit all details" buttons | Same. Logic covered by integration tests; manual checklist in FULL-EDIT-FEATURE.md |
| Any write path against the live build (lead form, contact form, admin saves) | The local build uses the production database |
| Safari / iOS / Android devices | Not available |
| `npm audit` | Not run this pass |
| PageSpeed Insights / field Core Web Vitals | API quota exhausted; no Search Console access |
