# Subscription & membership system — implementation report

*14–15 Nov 2026.* Built into the existing Mappingg Next.js 14 app: no new app, no new npm
dependency, no existing table altered. See also **PAYMENT-GATEWAY-SETUP.md** (activation)
and **SUBSCRIPTION-TEST-REPORT.md** (tests).

## 1. Decisions taken with the owner

| Question | Decision |
|---|---|
| What counts against CP (3/10 per week) and Buyer (20) limits? | A **signed-in** CP/buyer opening a project's full details on the live map (`/api/my/enquire`, `/api/project-quickview`). Public SEO pages and anonymous visitors are unchanged — no SEO loss. |
| Existing accounts | Everyone starts on **Free**. Limits are recorded but **not enforced** until the owner switches *Enforce* on (admin) or sets `SUBSCRIPTION_ENFORCE=1`. |
| GST | Mappingg is **not GST-registered yet**: no GST charged; invoices say so. Switchable in admin settings (rate, inclusive/exclusive, GSTIN, SAC, CGST/SGST vs IGST). |

## 2. Architecture (how it fits the existing code)

- **Data:** relational Postgres tables created on first use (same pattern as `api_apps`,
  `lead_portals`), because money, unique constraints, atomic counters and transactions need real
  columns. DDL: `lib/subscriptions/db.ts` (`SCHEMA_SQL`) = `migration/pg-subscriptions.sql`.
  Default plans/features/settings are seeded once with `ON CONFLICT DO NOTHING` (never overwrite
  admin edits). With `DB_PROVIDER=mongodb` the subscription APIs answer 503 and checks fail open.
- **Auth:** existing session (`lib/auth.ts`, JWT cookie + live role check). Roles map to
  categories: `developer` → Developer, `agent` → Channel Partner, `buyer` → Buyer. Staff have none.
- **Entitlement engine:** `lib/subscriptions/entitlements.ts` — `getUserSubscription`,
  `getActivePlan`, `getEntitlements`, `checkFeatureAccess`, `checkUsageLimit`, `consumeUsage`,
  `getRemainingUsage`, `validateCityAccess`, `validateProjectAccess`; lifecycle has
  `activateSubscription` (= `processSuccessfulPayment` / `adminActivate`) and `expireSubscription`.
  Plans, prices, features and limits are read from the database (30 s cache), never hard-coded.
- **Route guards:** `lib/subscriptions/guards.ts` gives existing routes a one-line server check
  with a consistent `402 { error: { message, code, upgrade, usage, manage } }`.
- **Payments:** `lib/subscriptions/gateway.ts` (provider interface, Razorpay REST + HMAC — the
  same documented endpoints the official SDK wraps, so no new dependency).
- **Expiry is computed on read** (`effectiveStatus`) — entitlements end on time even if the cron
  is late; the cron only persists statuses and sends notifications.

## 3. Plans (seeded defaults — all editable in admin)

### Developer (per project, monthly)
| Plan | Price | Highlights |
|---|---|---|
| Free — Small | ₹0 | Project listing, basic details, RERA details, area/price/units, basic visibility & dashboard. **3 projects**, 1 state, no media. |
| Medium | ₹1,000 / project / month | + Advanced dashboard, brochure, floor plans, gallery, edit live projects, RERA verification info, IGBC info, advanced management. 30 media files/project. |
| Large ★ | ₹1,500 / project / month | + Site-visit booking on your projects, enhanced visibility & presentation (promoted in listings). |
| Large Bulk | ₹2,000 / project / month | + Bulk Excel/CSV listing, highlighted videos, multiple states, priority promotion. |

Paid project features apply to the **projects chosen at checkout**; other projects keep Free
features. Buying a plan never sets RERA/IGBC verification — badges show the recorded status only.

### Channel partner (per account, monthly)
| Plan | Price | Highlights |
|---|---|---|
| Free | ₹0 | 3 unique project details / week, basic browsing, dashboard. |
| Pro ★ | ₹1,000 / month | 10 / week, **one chosen city**, brochure download, floor plans, enhanced info, lead book (50 leads). |
| Pro Max | ₹2,000 / month | Unlimited, all cities/listings, future prices, unlimited leads, full CRM (pipeline, priority, follow-ups, timeline, CSV export). |

### Buyer
| Plan | Price | Highlights |
|---|---|---|
| Free | ₹0 | 20 property listings (lifetime, configurable), compare, favourites, share, loan EMI/eligibility calculator. |
| Buyer Premium ★ | ₹1,999 / quarter | Unlimited listings + vastu guide, legal checklist, expert / legal / vastu requests (booked with a person), portfolio manager, premium insights. |

## 4. Feature matrix — where each rule is enforced (server)

| Rule | Enforced in |
|---|---|
| CP weekly unique-project limit; buyer listing limit | `/api/my/enquire`, `/api/project-quickview` (signed-in), `/api/subscriptions/access` → `consumeUsage` (transaction + advisory lock; unique per project per period, so refresh/tabs/repeats never double count and parallel requests can't overshoot) |
| CP one-city plans | same, `validateCityAccess` (city from pin coordinates, `lib/seo/city.ts`) |
| CP brochure download | `/api/brochure/[id]?download=1` → `cp_brochure_access` |
| CP lead book / CRM / export / future price | `/api/cp/leads`, `/api/cp/future-price` |
| Buyer favourites / compare | `/api/my/favorites` (now also buyers), `/api/my/compare` |
| Buyer premium tools | `/api/buyer/services`, `/api/buyer/portfolio`; premium page content rendered server-side only when entitled |
| Developer listing limit | `/api/my/projects` POST, `/api/db` developer pin insert (map editor) |
| Developer bulk listing | `/api/my/projects` bulk mode → `dev_bulk_listing` |
| Developer edit of a live project | `/api/my/projects` PATCH → `dev_project_editing` for that project (pending/rejected projects can always be corrected) |
| Developer media (brochure/floor plan/gallery/video) | `/api/partners/storage` (own `dev/<user>/<pin>/<kind>/` folder only, PDF/JPG/PNG/WebP verified by magic bytes) + `/api/my/projects/media` |
| Site-visit booking on developer projects | `/api/my/enquire` and guest `/api/db` leads insert → `dev_site_visit_booking` of the pin's owner (lead is still saved; Mappingg-managed pins unchanged) |
| Promotion | activation/expiry sets `pins.sub_promotion`; home "featured" ranking uses it after the admin's own highlight |

When a plan ends, nothing is deleted: projects, leads (archived, never hard-deleted), favourites,
portfolio and invoices stay; only new restricted actions are refused.

## 5. API endpoints

| Method & path | Who | Purpose |
|---|---|---|
| GET `/api/subscriptions/plans[?category=]` | public | Active plans + features |
| POST `/api/subscriptions/quote` | account | Server price breakdown (coupon, credit, GST) |
| POST `/api/subscriptions/checkout` | account | Create payment + Razorpay order (or schedule a downgrade / activate a ₹0 coupon order) |
| POST `/api/subscriptions/upgrade` | account | Same engine, requires an active paid plan |
| POST `/api/subscriptions/verify-payment` | account | Signature + server fetch → activate |
| POST `/api/subscriptions/payment-cancelled` | account | Close own unpaid order |
| POST `/api/subscriptions/webhook` | Razorpay | Signed webhook, idempotent |
| GET `/api/subscriptions/current` | account | Plan, status, usage, days left, options |
| GET `/api/subscriptions/history` | account | Subscriptions, payments, events |
| POST `/api/subscriptions/cancel` (`{resume:true}` to undo) | account | Cancel at term end |
| POST `/api/subscriptions/city` | CP | Choose the one-city plan's city (once) |
| GET `/api/subscriptions/invoices`, `/invoices/[id]` | owner / staff | Invoices |
| GET/POST `/api/subscriptions/notifications` | account | List / mark read |
| POST `/api/subscriptions/access` | CP / buyer | Explicit project-access check |
| GET `/api/subscriptions/cron` | Bearer CRON_SECRET | Daily lifecycle |
| GET/POST/PATCH/DELETE `/api/cp/leads` | CP | Private lead book / CRM |
| GET `/api/cp/future-price` | CP Pro Max | Admin-published future prices |
| GET/POST/DELETE `/api/buyer/services` | buyer | Expert / legal / vastu requests |
| GET/POST/PATCH/DELETE `/api/buyer/portfolio` | buyer | Portfolio manager |
| GET/POST `/api/my/projects/media` | developer | Project media submissions |
| GET/POST `/api/admin/subscriptions` | **owner only** | Admin module (views + audited actions) |

## 6. Database (21 new tables)

`sub_settings`, `sub_features` (SubscriptionFeature), `sub_plans` (SubscriptionPlan),
`subscriptions` (Subscription — one open per account+category via partial unique index),
`sub_payments` (SubscriptionPayment — order, price breakdown, `gateway_order_id`/`gateway_payment_id` UNIQUE),
`sub_transactions` (PaymentTransaction), `sub_webhook_events` (PaymentWebhookEvent, PK = event id),
`sub_usage` (SubscriptionUsage, PK user+metric+period+subject), `sub_invoices` (SubscriptionInvoice, number & payment UNIQUE),
`sub_counters`, `sub_history` (SubscriptionHistory), `sub_coupons` + `sub_coupon_redemptions` (SubscriptionCoupon),
`sub_notifications` (SubscriptionNotification, dedupe key UNIQUE), `sub_refunds` (SubscriptionRefund),
`sub_audit` (SubscriptionAuditLog), `sub_price_outlook`, `cp_leads`, `buyer_service_requests`,
`buyer_portfolio`, `dev_media_submissions`. Statuses: FREE (no row) · PENDING · ACTIVE · PAST_DUE
(grace) · EXPIRED · CANCELLED · FAILED · REFUNDED · SUSPENDED. Money in integer paise.

**Already created in the live database:** a local smoke test against the dev server (which
uses `pooled.db.prisma.io`) created these tables and seeded the default plans on 14 Nov 2026,
with enforcement **off** — additive, same as the first request after deploy. Rollback SQL is at
the end of `migration/pg-subscriptions.sql`.

## 7. User interface

- **`/pricing`** (public, indexable, canonical, in the sitemap): three sections, cards with
  Free/Premium/Recommended badges, feature comparison table, billing notes. Server-rendered.
- **My subscription** — `/dashboard/<developer|agent|buyer>/subscription` and the developer
  dashboard's new *Subscription* tab: current plan, status, start/expiry/renewal, days left,
  expiring / renewal-due / expired / payment-failed / city-needed banners, usage meters, plan
  coverage per project, included features, plan grid with checkout, payment history, invoices
  (download as PDF via print), subscription history, notifications.
- **Checkout modal:** plan summary, project picker (developer), city (CP Pro), coupon, optional
  GSTIN (when registered), live server price breakdown, terms checkbox, Razorpay, result states
  (paid / pending / failed / scheduled), test-mode and "payments being set up" notices.
- **Existing dashboards:** developer dashboard plan card + *Project media* and *Subscription*
  tabs; CP profile and buyer profile plan cards; developer bell shows subscription notices.
- **CP:** `/dashboard/agent/crm` — lead book, pipeline, follow-ups, timeline, export, future prices.
- **Buyer:** `/dashboard/buyer/premium` — EMI calculator, insights, expert requests, portfolio,
  legal checklist, vastu guide (general information with clear disclaimers — not legal advice);
  `/dashboard/buyer/favorites`; ♥ on map cards.
- **Live map:** 402 shows an upgrade dialog (instead of the guest form); site visits on
  developer plans without booking say so. Patched by `migration/patch-map-subscriptions.mjs`
  (idempotent, `--check`).
- **Admin:** Super admin → *Subscriptions* (owner): Dashboard (enforcement switch, MRR, revenue,
  expiring, failures, gateway/webhook/cron health, run lifecycle), Plans & features (create/edit
  prices, cycles, units, features, limits, limit periods, activate/deactivate), Subscriptions
  (filters incl. expiring/expired, per-account detail, extend, suspend/resume, set city, cancel,
  manual activation with reason), Payments (failed filter, refunds, close stuck orders), Refunds,
  Coupons, Reports (monthly revenue by type, active by plan, lifecycle events, coupon usage),
  Requests & media (buyer requests, developer media approval), Future prices, Settings (grace,
  reminders, TTL, invoice prefix, GST), Webhooks & audit log.
- Private pages: `robots: noindex` + under `/dashboard` (already disallowed in robots.txt).

## 8. Files

**New** — `lib/subscriptions/`: `catalog.ts`, `db.ts`, `store.ts`, `pricing.ts`, `entitlements.ts`,
`gateway.ts`, `lifecycle.ts`, `invoices.ts`, `notifications.ts`, `projects.ts`, `features.ts`,
`insights.ts`, `summary.ts`, `guards.ts`, `http.ts`, `admin.ts`, `page-auth.ts`.
`app/api/subscriptions/{plans,quote,checkout,upgrade,verify-payment,payment-cancelled,webhook,current,history,cancel,city,invoices,invoices/[id],notifications,cron,access}/route.ts`,
`app/api/cp/{leads,future-price}/route.ts`, `app/api/buyer/{services,portfolio}/route.ts`,
`app/api/my/projects/media/route.ts`, `app/api/admin/subscriptions/route.ts`,
`app/pricing/{layout,page}.tsx`, `app/dashboard/[role]/{subscription,crm,premium}/page.tsx`,
`app/dashboard/[role]/invoices/[id]/page.tsx`,
`components/subscriptions/{subscriptions.css,PlanGrid,Checkout,SubscriptionCenter,PlanSummary,AccountShell,PrintButton,CpCrm,BuyerTools,DevMedia}.tsx`,
`components/admin/SubscriptionsPanel.tsx`, `migration/pg-subscriptions.sql`,
`migration/patch-map-subscriptions.mjs`, `tests/subscriptions.test.ts`,
`tests/subscriptions-routes.test.ts`, the three `.md` reports.

**Modified** — `app/api/my/enquire/route.ts`, `app/api/project-quickview/route.ts`,
`app/api/brochure/[id]/route.ts`, `app/api/my/projects/route.ts`, `app/api/db/route.ts`,
`app/api/my/favorites/route.ts`, `app/api/my/compare/route.ts`, `app/api/my/notifications/route.ts`,
`app/api/partners/storage/route.ts` (developer uploads + `nosniff`), `app/dashboard/[role]/favorites/page.tsx`,
`app/sitemap.ts`, `components/admin/AdminApp.tsx` (tab), `components/dashboard/{DeveloperApp,AgentProfile,BuyerProfile,FavoriteCollection}.tsx`,
`components/landing/home-sections.ts`, `lib/home/{cards,quickview}.ts`, `public/legacy/public-map.json`,
`vercel.json` (cron), `render.yaml`, `.env.example`.

## 9. Deployment

1. Review & commit (nothing is committed yet). `npm test` → 190/190.
2. Deploy. Tables already exist; otherwise they are created on the first request.
3. Follow PAYMENT-GATEWAY-SETUP.md (keys → webhook → CRON_SECRET → test purchase → live keys).
4. Optionally review plans/prices in admin → Subscriptions → Plans.
5. Turn on enforcement when ready. Before that, tell existing CPs/buyers about the new limits.

## 10. Known limitations / not done

- **Automatic recurring card debit** isn't implemented (needs Razorpay Subscriptions/e-mandates);
  renewals are one-click with reminders and grace.
- **Invoices** are a printable page ("Save as PDF") rather than a generated PDF file (no PDF
  library added). SAC code and GST details must be confirmed with your CA before GST billing.
- **Public SEO pages** still show full project details to everyone (owner's choice) — limits apply
  to signed-in CP/buyer map opens.
- **Admin module is owner-only**; employees don't get it (a grantable permission could be added).
- **Future prices** are only what admins publish (with a source) — nothing is estimated.
- The developer media pipeline adds `floor_plan_urls`/`gallery_urls` on pins; the public
  `/projects/[slug]` page doesn't render those two yet (the live map's details panel does).
- Dashboards and checkout were type-checked, linted and API-tested but **not clicked through in a
  browser**, and no real Razorpay transaction was made (no keys).
