# Remaining issues — 20 Oct 2026

Severity: **High** = harms users, data trust or indexing now; **Medium** = noticeable but contained; **Low** = polish.
Nothing below was changed in production. Items marked *approval* need your decision before anyone acts.

## A. Decisions and production changes awaiting approval

| # | Sev | Item | Evidence | Exact proposed action |
| --- | --- | --- | --- | --- |
| A1 | High | **5 duplicate project records** | `DUPLICATE-RECORDS.csv`: 602/603 and 604/605 identical at the same spot; 21/75 (Mantra Melange) identical but 1.5 km apart; 423/424 (Splendid Evora) 70 m apart; 624/625 (Eldeco Live by the Greens) 85 m apart | In admin, keep the lower number and switch **Show on public map** off for 603, 605. For 21/75, 423/424, 624/625, first check which pin sits on the real site, then hide the other. Hiding is reversible; do not delete. Optional: 301 the hidden pins' URLs to the kept ones. |
| A2 | Medium | **Pin number 116 used twice** | "YOO ONE" and "Codename Autobiography by Jhamtani", 5.9 km apart | Give "Codename Autobiography" an unused pin number in the admin. Code now serves each at its own URL meanwhile, so nothing breaks either way. *approval* (pin numbers are part of URLs) |
| A3 | Medium | Same-name pairs that are probably distinct | 239/243 Santiago Sunrise (homes vs shop, same RERA); 562/596 Whiteland Blissville (different RERA); 5/9 Pristine Properties (different config, no RERA) | Rename so titles differ ("– Shops", "Phase 2"); for 5/9 check with the developer. |
| A4 | High | **Publish the two seeded guides** | `carpet-area-vs-built-up-vs-super-built-up-area` (947 words, 10 sections, FAQ) and `possession-delay-rera-buyer-rights-maharera-complaint` (800 words, FAQ); covers committed; descriptions shortened this pass | See "Blog publishing steps" below. *approval* — **the seed rewrites all 24 posts**, not just these two. |
| A5 | Medium | Legal pages still name MahaRERA only | `app/terms/page.tsx` (lines 49, 94, 101, 130, 187), `app/privacy/page.tsx` 16, `app/map-data/page.tsx` 157 | Legal text — have it reviewed; suggested wording: "the developer and the relevant state RERA authority (MahaRERA in Maharashtra)". |
| A6 | Medium | Onboarding asks only for a **MahaRERA** number | Developer/agent sign-up (`components/landing/body.ts`, `GoogleSignupForm.tsx`), admin review screens | Business decision: keep Maharashtra-only onboarding, or accept other states' RERA numbers. |
| A7 | Medium | Sessions can't be revoked | See AUTH-SECURITY-AUDIT risk 1 | Add `session_version` to `users` (small, additive schema change). |
| A8 | Medium | **Search Console API disabled** | API call returns "has not been used in project 847257037149 or it is disabled" (checked again 20 Oct). Windsor.ai has no Search Console source either. | Enable at https://console.developers.google.com/apis/api/searchconsole.googleapis.com/overview?project=847257037149 and add the service account (`GSC_SERVICE_ACCOUNT_JSON` → `client_email`) as a user on the `www.mappingg.com` property. Then the admin SEO tab and `npm run seo:audit` can use real queries. |

### Blog publishing steps (A4)

1. Deploy first, so the two covers in `public/img/blog/` are live.
2. Preview without writing: `node --env-file=.env migration/seed-blogs.mjs --dry-run`.
3. Take a backup first (super-admin → Backups).
4. Run `node --env-file=.env migration/seed-blogs.mjs`. **It upserts every article by slug** (refreshing the 22 live posts' project lists from current data) **and deletes the old placeholder post** `welcome-to-the-mappingg-blog`. If you only want the two new posts, ask for a `--only=<slug>` option first.
5. Check `/blog`, both new URLs, and `/sitemap.xml` (cached up to 1 hour).

## B. Data quality (fill in admin; never guessed)

| # | Sev | Item | Evidence |
| --- | --- | --- | --- |
| B1 | High | **Bengaluru: 474 of 491 projects have no price; none has a description**; 66 have no configuration | `BENGALURU-DATA-GAPS.csv` (one row per project, most gaps first). 487 came from RERA Karnataka imports. Pages stay honest ("the developer has not published a price on Mappingg yet"); no price/description is invented. |
| B2 | Medium | Bengaluru localities are registry districts ("Bengaluru East" 151, "Bengaluru South" 124, "Anekal" 119, "Bengaluru North" 56) | Buyers search by neighbourhood (Whitefield, Sarjapur Road…). Add the real locality to each project's location. |
| B3 | Medium | Site-wide: price missing 758 / 965, carpet area 768, description 861, configuration 215 | `reports/seo-audit/2026-10-20-after-local-final/PROJECT-SEO-REPORT.csv` |
| B4 | Low | RERA field holds non-numbers for some pins (e.g. "LAUNCHING-SOON", pin 5) | The page and map now ignore them as RERA numbers; the card still prints the raw text under "RERA No." |

## C. Code work not done

| # | Sev | Item | Why not | Suggestion |
| --- | --- | --- | --- | --- |
| C1 | Medium | **Admin redesign** | No staff test account; creating one = production write | See ADMIN-DASHBOARD-AUDIT. |
| C2 | Medium | Signed-in flows untested in a browser (login, logout, expiry, favourites, compare, developer editing, admin edits) | Same | Provide a test buyer, developer and employee account, ideally on a staging database. |
| C3 | Medium | No staging database | The local build reads the **production** database, so write paths (lead forms, contact form, admin saves) could not be exercised end to end | A Postgres branch/copy for QA. |
| C4 | Low | Hidden legacy `<h1>Associatte Interactive Map</h1>` in the map bundle | Bundle CSS may depend on it | Change to a `<div>` when the map source is next edited. |
| C5 | Low | 983 markers drawn individually (no clustering) | Works (983 markers in 2–5 s locally, no errors, heap 12–23 MB); not slow enough to justify changing map behaviour unasked | Consider clustering at low zoom if the map grows past ~2,000 pins. |
| C6 | Low | `npm audit` not run | Needs the registry | Run `npm audit --omit=dev` and review before release. |
| C7 | Low | No security headers (CSP / frame-ancestors) | Needs testing of the home-page map embed | See AUTH-SECURITY-AUDIT risk 5. |
| C8 | Low | Locality and developer pages are still unpaginated (max ~240 KB, `/locations/bengaluru-east`) | Below the threshold used | Apply the same pager if any grows past ~150 cards. |
| C9 | Low | Remaining long titles (≈25) are long project/developer names | Not cut on purpose | — |

## D. Verification limits

- Core Web Vitals field data (real users): not available without Search Console / CrUX. Only lab Lighthouse numbers (PERFORMANCE-REPORT).
- Google index status: unknown (no Search Console access).
- Browser tests ran headless Chrome on Windows; no Safari / iOS / Android device testing.
- Admin, signed-in and write workflows: see C1–C3.

## E. Added after the "Edit all details" request

| # | Sev | Item | Notes |
| --- | --- | --- | --- |
| E1 | High | **"Edit all details" not yet clicked through in a browser** | Needs a staff login. Logic is covered by integration tests; please run the 4-step checklist in FULL-EDIT-FEATURE.md before deploying. |
| E2 | Medium | Pending developer projects published from the full form skip the "project approved" activity entry | Approve in Developer projects first, then edit all details. Could be automated later. |
| E3 | Medium | Any staff session can call the Projects Intake admin actions, even employees without the "intake" permission (pre-existing: `/api/partners/rpc/*` checks staff only) | Add `hasPermission('intake')` to that route if employees should be limited. Not changed here because it alters who can use intake today. |
| E4 | Low | The repo's `.next` folder was overwritten by another process at 02:44–02:50 while a test server used it | Builds for measurement were moved to separate worktrees; if you run `next dev`, run `npm run build` again before `next start`. |
