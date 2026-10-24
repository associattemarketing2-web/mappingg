# Buyer lead sources — setup you must do by hand

Super admin → **Buyer leads** shows every source with its status
(Connected / Not configured / Permission required / Failed), real record counts,
last successful sync, latest error, required credentials (set / not set — values
are never shown) and these steps. This file is the same checklist in one place.

All secrets go in **server environment variables** (Vercel → Project → Settings →
Environment Variables → Production), then **redeploy**. They are never stored in
the database or sent to the browser.

| Variable | Source | Required | What it is |
| --- | --- | --- | --- |
| `GOOGLE_ADS_LEAD_WEBHOOK_KEY` | Google Ads | yes | A long random string (32+ chars) you make up. The same value goes in Google Ads. |
| `META_APP_SECRET` | Meta | yes | Meta app → App settings → Basic → App secret. |
| `META_WEBHOOK_VERIFY_TOKEN` | Meta | yes | Any random string you make up; typed into the Meta webhook setup. |
| `META_PAGE_ID` | Meta | yes | The Facebook Page that runs the lead ads. |
| `META_PAGE_ACCESS_TOKEN` | Meta | yes | Long-lived Page / System User token (see below). |
| `META_GRAPH_VERSION` | Meta | no | Defaults to `v23.0`. Bump it when Meta retires that version. |
| `META_LEAD_FORM_IDS` | Meta | no | Comma-separated form ids to sync. Default: every form on the Page. |

Generate random values with e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

## 1. Website enquiries — nothing to set up

Already connected: contact form (`/contact`), the new **buyer requirement form**
(`/buyer-requirement`), live-map "Enquire now", buyer accounts, and partner
websites through the Developer API. Counts come straight from `contact_leads`
and `leads`.

Suggested: link `/buyer-requirement` from the site menu, footer, WhatsApp replies
and ad landing pages. Ask your lawyer whether the Privacy Policy should mention
Google Ads / Meta lead forms and broker referrals as sources of personal data.

## 2. Google Ads lead forms (webhook)

1. Set `GOOGLE_ADS_LEAD_WEBHOOK_KEY` and redeploy.
2. Google Ads → campaign → **Assets → Lead forms** → open the form → **Lead delivery option → Webhook integration**.
3. Webhook URL: `https://www.mappingg.com/api/integrations/google-ads/leads`. Key: the same value.
4. Click **Send test data**. Buyer leads should show Google as **Connected** with a "(test)" success.
   Test data is never saved as a lead.
5. Repeat for every lead form. Google only sends new leads; download older ones as CSV in
   Google Ads and use **CSV import** (type "Buyer enquiries we collected").

*No "Run sync" for Google:* pulling leads needs the Google Ads API (developer token +
OAuth + approval), which isn't set up. "Test connection" checks our side and shows
when Google last reached the webhook.

## 3. Meta lead ads (Facebook / Instagram)

1. **Meta app**: developers.facebook.com → create a **Business** app linked to your Business Manager.
2. **Permissions** the token needs: `leads_retrieval`, `pages_show_list`, `pages_read_engagement`,
   `pages_manage_metadata`, `pages_manage_ads` (+ `business_management` if the Page belongs to a Business).
   `leads_retrieval` needs **Advanced Access via App Review** to read leads from people who
   aren't admins/testers of the app. Until then, Buyer leads shows **Permission required**.
3. **Token**: Business Settings → Users → **System users** → add one (Admin), assign the Page
   (and ad account), **Generate token** with the permissions above → `META_PAGE_ACCESS_TOKEN`.
4. **Leads Access**: Business Settings → Integrations → **Leads Access** → the Page → allow this app
   (and remove any CRM you no longer use).
5. Set `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`; redeploy.
6. App dashboard → **Webhooks** → object **Page** → Subscribe:
   callback `https://www.mappingg.com/api/integrations/meta/leads`, verify token = `META_WEBHOOK_VERIFY_TOKEN`;
   then subscribe to the **leadgen** field.
7. Buyer leads → Meta: **Test connection** (checks the Page, its forms and the webhook subscription),
   **Subscribe Page** if it says not subscribed, then **Run sync** (pulls the last 90 days; Meta keeps leads 90 days).
8. Check with Meta's **Lead Ads Testing Tool**. Test leads prove the webhook but are never saved.

Webhooks are verified with `X-Hub-Signature-256`; every Graph call sends `appsecret_proof`.
If a webhook's lead can't be fetched (token expired, permission removed), the error is logged
and **Run sync** picks the lead up later — it's idempotent, so nothing is duplicated.

## 4. CSV import (broker referrals, offline enquiries)

Buyer leads → CSV import → **Import CSV**. You must give: who supplied the file, how the people
agreed to be contacted by Associatte PropTech (Mappingg), and tick the confirmation.
If the file has a consent column, rows without a clear "yes" are skipped. People already in your
leads, repeats inside the file, invalid phones/emails are skipped and listed. Always a dry run first.
Imported leads go to your sales CRM webhook; no admin email per row.

## 5. Public property portals

Registry only. **Nothing is fetched from any portal**, and no portal connector exists.
"Add common Indian portals" lists 99acres, MagicBricks, Housing.com, NoBroker, Square Yards,
PropTiger and Makaan as **Not reviewed**. To use a portal's data you need its owner's **written**
permission (or an official feed/API) for the exact data and use; record it with a link to the
email/agreement. A connector would then still have to be built for that permitted use.
Buyers' personal contact details are never collected from portals.

## Where things are

- Leads land in the existing tables: website → `contact_leads` / `leads`; Google, Meta, CSV → `leads`
  (tagged `ingest_source`), so they also show in Super admin → Leads → Map enquiries with status "new".
- New tables (created automatically, DDL in `migration/pg-lead-sources.sql`): `lead_ingest_keys`
  (idempotency), `lead_sync_log` (every webhook/sync/test/import, no personal data), `lead_portals`.
- Code: `lib/lead-sources/`, `app/api/integrations/*`, `app/api/admin/lead-sources`,
  `app/buyer-requirement`, `components/admin/BuyerLeadsPanel.tsx`. Tests: `tests/lead-sources.test.ts`.
