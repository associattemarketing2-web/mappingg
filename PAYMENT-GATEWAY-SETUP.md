# Payment gateway setup — Razorpay

Everything is built. To take real payments you only add credentials and the webhook.
Until then: free plans work, paid plans show the exact price with **"Online payments
are being set up"**, and nothing is ever activated without a verified payment.

## 1. Environment variables

Add to Vercel → Project → Settings → Environment Variables (Production), and to `.env`
locally. Render: the same keys are listed in `render.yaml` (`sync: false`).

| Variable | Value | Secret? |
|---|---|---|
| `PAYMENT_GATEWAY` | `razorpay` | no |
| `RAZORPAY_KEY_ID` | `rzp_test_…` (test) or `rzp_live_…` (live) — Razorpay → Account & Settings → API Keys | no |
| `RAZORPAY_KEY_SECRET` | the key secret shown once when you generate the key | **yes** |
| `RAZORPAY_WEBHOOK_SECRET` | any long random string you choose (same value in step 2) | **yes** |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | same as `RAZORPAY_KEY_ID` (the browser checkout needs the key id) | no |
| `CRON_SECRET` | any long random string — Vercel Cron sends it automatically | **yes** |
| `SUBSCRIPTION_ENFORCE` | optional: `1` always enforce, `0` never; leave unset to use the admin switch | no |

Absolute links in emails already come from the existing `NEXT_PUBLIC_SITE_URL`
(lib/mailer.ts), so no separate `APP_BASE_URL` is needed.

The secret key and webhook secret are read only on the server
(`lib/subscriptions/gateway.ts`). Only the key id reaches the browser.

Generate random secrets with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## 2. Webhook

Razorpay Dashboard → Account & Settings → **Webhooks** → Add new webhook:

- **URL:** `https://www.mappingg.com/api/subscriptions/webhook`
- **Secret:** the value of `RAZORPAY_WEBHOOK_SECRET`
- **Active events:** `payment.captured`, `payment.failed`, `payment.authorized`, `order.paid`, `refund.processed`, `refund.failed`

Test-mode and live-mode webhooks are configured separately in Razorpay — add it in both.

How it is handled: the raw body's HMAC-SHA256 is verified before parsing; each event id
(`X-Razorpay-Event-Id`) is stored once in `sub_webhook_events`, so retries/duplicates are
acknowledged without processing twice. Permanent problems (amount mismatch) are recorded
and acknowledged; transient errors return 5xx so Razorpay retries.

## 3. Scheduled job

`vercel.json` runs `GET /api/subscriptions/cron` daily at 00:30 UTC (06:00 IST) and Vercel
sends `Authorization: Bearer $CRON_SECRET`. It sends expiry reminders, moves ended plans
into the grace period and then to Expired, and reconciles unfinished payments with Razorpay
(a captured payment whose webhook was missed is activated; abandoned orders are closed).
It is idempotent — running it more often is safe.

On Render (or anywhere without Vercel Cron), use any scheduler (cron-job.org, GitHub
Actions, …):

```
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://www.mappingg.com/api/subscriptions/cron
```

Super admin → Subscriptions → Dashboard also has **Run lifecycle now**.

## 4. Go-live checklist

1. Put the **test** keys in, deploy, add the test-mode webhook.
2. Super admin → Subscriptions → Dashboard: gateway shows *Razorpay · test mode*, webhook *Set*, cron *CRON_SECRET set*.
3. Sign in as a test buyer → `/dashboard/buyer/subscription` → choose Buyer Premium → pay with a
   [Razorpay test card / UPI](https://razorpay.com/docs/payments/payments/test-card-details/).
   Expect: plan active, invoice downloadable, payment in admin → Payments, webhook in admin → Webhooks & audit.
4. Try a failed payment (test card that fails) → admin → Payments shows *Failed*; the plan is not activated.
5. Refund the test payment from admin → Payments → Refund; the plan ends (full refund) and a refund appears.
6. Set GST details in admin → Subscriptions → Settings (see §5) before live payments.
7. Switch to **live** keys (`rzp_live_…`) + live-mode webhook. Do one small real purchase and refund it.
8. Turn on **enforcement** (admin → Subscriptions → Dashboard → *Turn on enforcement*) when you are ready
   for free-plan limits to apply to everyone.

## 5. GST / invoices

Default: **not GST-registered** — no GST is charged and invoices state that the supplier is not
registered under GST. When you register: admin → Subscriptions → Settings → tick
*GST-registered*, enter GSTIN, legal name, address, state + state code, SAC code (confirm the SAC
with your CA), rate (18%) and whether prices include GST. Checkout then shows CGST+SGST
(customer in your state, or no state given) or IGST (a business customer whose GSTIN is from
another state), and invoices become *Tax Invoice*.
Invoice numbers run in an unbroken sequence per financial year: `MPG/2026-27/00001`.

## 6. Payment flow (for reference)

1. `POST /api/subscriptions/checkout { plan, project_ids?, city?, coupon? }` — the server works out
   the price (plan price × projects − coupon − upgrade credit + GST), stores a `sub_payments` row and
   creates the Razorpay order for **that** amount. The browser never sends an amount.
2. The browser opens Razorpay Checkout with the order id.
3. `POST /api/subscriptions/verify-payment` — signature `HMAC(order_id|payment_id, KEY_SECRET)` is
   verified, the payment is fetched from Razorpay and must be *captured* for this order and the exact
   amount (an *authorized* payment is captured). Then, in **one transaction**: payment → paid,
   subscription activated/renewed/upgraded, coupon redeemed, invoice issued, history written.
4. The webhook does the same independently; whichever arrives second is a no-op.
5. Card / UPI details never touch Mappingg servers. Only Razorpay ids are stored.

Swapping provider: implement `PaymentProvider` in `lib/subscriptions/gateway.ts` and return it from
`getGateway()` for its `PAYMENT_GATEWAY` value.

## 7. Known limitation — automatic card debit

Renewals are **customer-initiated** (one-time Razorpay orders) with reminders 7 and 1 days before
expiry, a configurable grace period and one-click renew. Fully automatic recurring debit needs
Razorpay *Subscriptions* (e-mandates) — a separate Razorpay product with its own plan objects and
mandate rules. The `auto_renew` column exists for it; it is not wired up.
