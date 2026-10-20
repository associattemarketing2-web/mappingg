# Quality audit — release-candidate summary (20 Oct 2026)

**Verdict: ready for human review, not for blind deploy.** All automated checks pass (type-check, lint, 108/108 tests, production build, SEO crawl with 0 errors). Two things must be checked by a person first: the new **Edit all details** feature in s-admin (no staff login was available to click through it), and the duplicate-record / RERA-wording decisions listed in REMAINING-ISSUES.

## What was found and fixed

| Area | Finding | Status |
| --- | --- | --- |
| Map (data trust) | RERA numbers from Karnataka, Haryana and UP (~580 projects) were **dropped** from the project panel; every number was labelled "MahaRERA" with a MahaRERA Verify link | Fixed: each number shows its own registry and link (verified in Chrome) |
| Copy (data trust) | Buyer-facing pages claimed all RERA numbers are "verified on MahaRERA" | Fixed on home, FAQ, About, Features, How it works, Disclaimer, API docs, map prompt, buyer screens; legal pages flagged |
| Routing | A project sharing its pin number (116) could never be reached | Fixed in code; data clean-up recommended |
| Security | A user record without a role would be treated as **admin** (latent; 0 such accounts today) | Fixed (least privilege) |
| Security | Unauthenticated Google-link resolver had no rate limit | Fixed |
| Performance | `/projects` 1.2 MB HTML, `/status/under-construction` 1.15 MB, `/cities/bengaluru` 662 KB, `/developers` 448 KB | Fixed with crawlable pagination; `/projects` Lighthouse 73 → 88, blocking time 777 → 346 ms |
| SEO | `/map` held ~400 KB of crawler-only hidden text | Fixed (removed; short accessible description kept) |
| UX | Map card text hidden under floating buttons; long RERA ids overflowing; empty map with no message when data fails | Fixed and verified at 375 / 768 / 1440px |
| Accessibility | Logo link name mismatch on every page; small tap targets; no focus styles on SEO pages | Fixed; Lighthouse accessibility audits pass on all non-map pages |
| Tests | CRM-push test flaky in the full suite | Root cause: fixed 30 ms wait vs a geo-IP lookup; test now waits for the push |
| Admin (requested) | Project edit screens outside Projects Intake showed only some fields | **New: "Edit all details"** everywhere opens the full intake form; publishing updates the same pin (FULL-EDIT-FEATURE.md) |

## What passed

- Real Chrome at 7 widths on 34 routes: no horizontal scroll, no JS errors, no broken images.
- Map: 983 markers load (2–5 s locally), zoom, pan, touch, marker click/tap, deep links, detail panel, outage + recovery, repeated navigation.
- Authorization: 97/97 privileged GET checks refused (anonymous, forged token, signed token for a non-existent account).
- SEO vs the live site: 404s 2 → 0, broken links 2 → 0, schema errors 1 → 0, thin pages 640 → 50, issues 18/671/1233 → 12/65/76.

## What remains (details in REMAINING-ISSUES.md)

- **Needs your decision / approval**: hide 5 duplicate records; renumber pin 116; publish the 2 seeded guides (the seed rewrites all 24 posts); legal-page wording; onboarding for non-Maharashtra developers; session revocation; enable the Search Console API.
- **Data**: 474 of 491 Bengaluru projects have no price and none has a description; localities are registry districts.
- **Biggest performance item**: `/map` scores 25 on throttled mobile (blank for ~28 s while 770 KB of pin data and tiles load) — needs a change to how the map loads.
- **Not tested**: admin and signed-in screens in a browser, write paths, real phones.

## Report index

QUALITY-AUDIT-SUMMARY (this) · FRONTEND-PAGE-AUDIT.csv · BACKEND-API-AUDIT.csv · AUTH-SECURITY-AUDIT · ADMIN-DASHBOARD-AUDIT · PERFORMANCE-REPORT · UI-UX-CHANGELOG · TEST-RESULTS · BUG-FIX-CHANGELOG · SEO-REGRESSION-REPORT · REMAINING-ISSUES · FINAL-VERIFICATION · FULL-EDIT-FEATURE · DUPLICATE-RECORDS.csv · BENGALURU-DATA-GAPS.csv · `browser/` (raw results and screenshots)
