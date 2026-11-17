# Subscription system — test report

*Run 14–15 Nov 2026 on Windows, Node 24, `npm test`.*

**Result: 190 / 190 tests pass** — the 157 tests that existed before plus 33 new ones.
No existing test was changed. `tsc --noEmit` is clean (apart from stale `.next/types` output of
the dev server, unrelated) and ESLint is clean on every new/modified file.

The new tests run against a real PostgreSQL engine in-process (PGlite) — the same SQL as
production, never the production database. Razorpay's HTTP API is stubbed, so the real provider
code (Basic auth, order creation, payment fetch/capture, refunds, HMAC signatures) runs with no
network and no money. Route tests call the real Next.js route handlers with a real signed session
cookie.

## Engine — `tests/subscriptions.test.ts` (25)

| Area | Test | Result |
|---|---|---|
| Pricing | no GST when unregistered; coupon/credit never below ₹0 | ✔ |
| Pricing | GST exclusive (CGST+SGST / IGST) and inclusive | ✔ |
| Periods | weekly limit resets Monday 00:00 IST; month-end clamping; unused-credit maths | ✔ |
| Catalogue | default plans seeded with the specified prices & cycles | ✔ |
| CP | Free: 3 unique / week, repeats free, 4th blocked | ✔ |
| CP | parallel requests can't overshoot the limit | ✔ |
| All | enforcement off → nothing blocked, usage recorded, `wouldBlock` reported | ✔ |
| CP | Pro: 10 / week, other city blocked; Pro Max: unlimited, all cities, CRM, future price | ✔ |
| CP | one-city plan must pick a city; city locked after choosing | ✔ |
| Buyer | Free: 20 listings; compare/favourite/share yes; premium no | ✔ |
| Payment | checkout → verified payment → active, invoice numbered, premium unlocked; double verify is a no-op | ✔ |
| Expiry | expired premium loses premium features; invoices kept | ✔ |
| Security | invalid signature, other user's order, underpaid amount rejected; browser fields (amount, user_id, status) dropped | ✔ |
| Webhook | bad signature 400; duplicate event processed once; redelivery no-op; failed payment recorded | ✔ |
| Pending | pending payment stays pending; cron reconciles once captured; abandoned orders closed | ✔ |
| Cancel | closing the widget cancels the order; gateway error never activates | ✔ |
| Refund | partial keeps plan; over-refund refused; full refund ends plan, invoice marked refunded | ✔ |
| Developer | Free: no media; Medium only on covered projects; other developer's project & multi-state refused; ₹1,000 × 2 projects | ✔ |
| Upgrade | Medium → Large charged with credit; site visits on; promotion flag set; one active sub | ✔ |
| Renewal / downgrade | renewal extends from current expiry; downgrade scheduled, no charge | ✔ |
| Bulk / expiry | Large Bulk bulk + video; expiry removes paid features & promotion, projects kept | ✔ |
| Grace | past-due keeps entitlements then expires; reminders sent once; expiring → past_due → expired notices | ✔ |
| Cancellation | stays active to term end, then not renewed | ✔ |
| Coupons | server-validated, category-scoped, per-user limit, 100% coupon activates without gateway | ✔ |
| Roles | buyer ≠ developer/CP features; staff no plan; wrong-category plans refused; manual activation needs reason & is audited | ✔ |

## HTTP / security — `tests/subscriptions-routes.test.ts` (8)

| Test | Result |
|---|---|
| Subscription APIs: visitor 401, staff 403, account 200 + `private, no-store` | ✔ |
| CP Free: 4th project via **Enquire now** → 402 (with upgrade + usage); via the **details API directly** → 402; visitors still get public details; no lead created for the refused project | ✔ |
| CP brochure download needs Pro (402); lead book needs a plan; CP2 can't list / edit / archive CP1's leads (404); CSV export Pro Max only; buyers 403; Pro CP outside city → 402 `city_not_allowed` | ✔ |
| Buyer premium tools 402 on Free; after Premium: portfolio + request created (status *requested*, not done); other buyer sees nothing and can't delete (404); developer 403 | ✔ |
| Developer: 4th project 402; bulk 402; editing a live uncovered project 402; gallery upload 402 on Free; HTML-as-PNG and SVG refused (415); real PNG accepted; another developer's folder 401 | ✔ |
| Quote ignores browser amount fields; wrong-category plan 400; forged verify 404; other user's invoice 404 | ✔ |
| Webhook endpoint: unsigned / wrong-secret 400; correctly signed unknown order acknowledged without effect | ✔ |
| Admin API: buyer 401, employee 403, owner 200; plan price change visible on public plans; unknown limit keys dropped; employee/CP can't self-activate; change audited with owner email | ✔ |

## Requirement checklist (spec §17)

| Spec item | Covered by |
|---|---|
| Free developer creates eligible project / limit | routes: developer limit |
| Paid developer uploads brochure / floor plan | engine: Medium on covered projects; routes: real upload accepted |
| Large gets site visit | engine: upgrade test (`dev_site_visit_booking`) |
| Bulk gets bulk listing | engine: Large Bulk test; routes: bulk 402 on Free |
| Expired plan loses paid entitlements | engine: bulk/expiry, buyer expiry, grace |
| CP 3/week, 4th blocked, Pro 10, city, Pro Max unlimited, CRM | engine CP tests; routes CP tests |
| Buyer 20, compare/favourite/share, premium, expiry | engine buyer tests; routes buyer test |
| Successful / failed / pending / invalid signature / duplicate webhook / refund / cancellation / expiry / renewal / upgrade / downgrade | engine payment tests |
| Buyer can't use developer features; CP can't see private developer/CP data; can't self-activate; can't change amount; can't read others' subscription; can't bypass weekly limit via direct API | engine roles test; routes tests |

## Also verified

- `migration/patch-map-subscriptions.mjs` patches the map bundle, is idempotent (second run: "Already
  patched"), `--check` works, and the patched script parses.
- Against the local dev server: `/pricing` rendered all 9 plans from the database with a canonical
  URL; `/api/subscriptions/current` unauthenticated → 401; unsigned webhook → 503 (no webhook secret
  set locally); cron without secret → 401.

## Not tested

- **No real Razorpay transaction** (no keys yet) — do the test-mode purchase in PAYMENT-GATEWAY-SETUP.md §4.
- **No browser click-through** of the dashboards, checkout modal or admin module (and no visual
  check at phone width). The local dev server stopped accepting connections partway through the smoke test,
  so the signed-in pages weren't loaded in a browser.
- `next build` was not run (it would overwrite `.next` used by the dev server).
- Email delivery (SMTP not configured in tests; mails are logged as skipped).
