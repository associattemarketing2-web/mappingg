# Mappingg Developer API — operator guide

Public docs: `/developer-api` · reference: `/developer-api/reference` · spec: `/api/v1/openapi.json`.
Admin: super-admin → **Developer API** tab (owner account only).

## Architecture

| Piece | Where |
|---|---|
| Endpoints (`GET /api/v1/...`) | `app/api/v1/**/route.ts` → `lib/api-platform/endpoints.ts` |
| Request pipeline (key, scope, limits, timeout, logging, JSON format) | `lib/api-platform/handler.ts` |
| Allow-listed response fields | `lib/api-platform/serializers.ts` |
| Data access (existing `runDbOp`, public rules) | `lib/api-platform/data.ts` |
| Apps, hashed keys, counters, logs, audit | `lib/api-platform/store.ts` (Postgres) |
| Key format / hashing | `lib/api-platform/keys.ts` |
| Admin API (owner only) | `app/api/admin/developer-api/route.ts` |
| Admin UI | `components/admin/DeveloperApiPanel.tsx` |
| OpenAPI | `lib/api-platform/openapi.ts` |

Data rules: only pins that are not `hidden`, not `pending_review`, not `rejected`; only property projects
(same filter as `/projects`); per-field `field_visibility` honoured; only `published` posts. Reads go through
`runDbOp(…, isAuthed=false)` and its 30 s in-process cache.

## Database

Five new tables, created automatically on first API use (same pattern as `site_events`):
`api_apps`, `api_keys`, `api_counters`, `api_request_log`, `api_audit`. DDL: `migration/pg-api-platform.sql`
(generated from `SCHEMA_SQL`). No existing table is changed. Postgres only — with `DB_PROVIDER=mongodb` the API answers 503.

Retention: request logs older than 30 days and expired counters are deleted automatically (every ~10 min, by the server).

## Environment variables

None are required. Optional:

- `DEVELOPER_API_DISABLED=1` — kill switch: every `/api/v1` endpoint except `/health` returns 503. Nothing is deleted.

Existing `DATABASE_URL` and `AUTH_SECRET` are used (`AUTH_SECRET` salts the one-way client fingerprint in logs).

## Limits (defaults; per application in the admin)

60 requests/min · 5,000/day (UTC) · 50 records/page (hard max 100) · paging stops at record 5,000 ·
5 concurrent requests per app per server instance · 30 failed auths per client per 10 min → 10 min block ·
unauthenticated endpoints 30/min per client · 10 s timeout · 2 MB response cap.

Per-minute and daily counters live in Postgres, so they hold across restarts and multiple instances.
The concurrency cap is per instance (in memory).

## Workflow: give a partner access

1. Super-admin → Developer API → **New application**. Fill in name, organisation, contact email, website, purpose.
2. Tick only the scopes they need. Set limits and an optional expiry date. **Create & generate key**.
3. Copy the key from the yellow box — it is shown once. Send it privately (e.g. a password manager share).
4. Send them `https://www.mappingg.com/developer-api`.
5. Watch **Requests today / 7 days**, recent requests and security events on the application page.

Rotate: application → **Rotate key** → choose how many hours the old key keeps working (0 = stop now).
Pause: **Disable** (reversible). End: **Revoke** (permanent, kills every key).

## Partner enquiries (POST /api/v1/enquiries, scope `enquiries:submit`)

The only write endpoint. A partner's **server** sends a visitor's enquiry; it becomes a normal CRM lead.

- **Grant:** application → *Edit scopes & limits* → tick `enquiries:submit`, make sure **Website** is the partner's
  domain (enquiries are only accepted from `sourcePage` URLs on that domain or its subdomains), and set the enquiry
  limits (default 10/min, 200/day). Revoke by unticking (takes effect on the next request). Both are in the audit trail.
- **Where leads appear:** Super admin → Leads → *map enquiries* (`leads` table, same shape as a live-map enquiry):
  status `new`, unassigned, so the normal CRM rules apply (owner sees all; employees only leads transferred to them).
  The lead's detail line reads "via partner website <domain> (Developer API: <app>; consent stated by the partner)".
  New leads are also pushed to the sales CRM webhook (`CRM_WEBHOOK_URL`) and emailed to the admin, like other enquiries.
- **Stored on the lead:** name, WhatsApp/phone (site format), email, project (`pin_id`), message (with BHK/budget/area),
  `consent` (partner-stated: their exact wording, version, time; `asserted_by_partner: true`), and `integration`
  (application, domain, page without query string, campaign, reference). Nothing else from the request is stored.
- **Not stored anywhere else:** API logs keep only route/status/timing; `api_enquiry_submissions` keeps the idempotency
  record (application, submissionId, reference, payload hash, lead id) — no personal data.
- **Duplicates:** same application + submissionId → original receipt (no new lead). Same phone + same project from the
  same application within 24 h (or a 4th lead for one phone in 24 h) → the existing lead's `enquiry_clicks` goes up.
- **Abuse:** per-app enquiry limits (shared counters), general request limits, 50 rejected submissions/hour pauses the
  app's enquiries for the hour, auth-failure blocking, 16 KB body cap, strict field allow-list.
- **Consent caveat:** Mappingg cannot verify a partner's form. The record proves what the partner *stated*, not what the
  visitor did. Grant this scope only to partners under a written agreement covering consent.

## Emergency procedures

- **One key leaked:** application → Keys → **Revoke** on that key, then **Rotate key** with grace 0 and send the new key.
- **A partner is abusing the API:** **Disable** the application (instant, reversible).
- **Switch the whole API off:** set `DEVELOPER_API_DISABLED=1` in Render → Environment and redeploy/restart.
- **Admin UI unavailable:** `UPDATE api_keys SET revoked_at = now() WHERE app_id = '<app id>';` or
  `UPDATE api_apps SET status = 'disabled' WHERE id = '<app id>';` — both take effect on the next request (no cache).

## Deploy

1. Merge and deploy as usual (Render runs `npm install && npm run build`). No env changes needed.
2. Optional: run `migration/pg-api-platform.sql` first; otherwise tables appear on first use.
3. Verify: `curl https://www.mappingg.com/api/v1/health` → `{"success":true,"data":{"status":"ok",…}}`;
   `curl https://www.mappingg.com/api/v1/projects` → 401 `missing_api_key`.
4. Create a test application with `projects:read`, call `/api/v1/projects` with it, then revoke it.

## Rollback

- Fast: `DEVELOPER_API_DISABLED=1` (keeps all data).
- Code: revert the commit; the new tables are unused and harmless.
- Data (optional, irreversible): `DROP TABLE IF EXISTS api_request_log, api_counters, api_audit, api_keys, api_apps;`

## Tests

`npm test` runs `tests/api-platform.test.ts` (route handlers + real SQL on an in-process PostgreSQL, PGlite — never
the production database) and `tests/api-openapi.test.ts` (docs ⇔ routes, key format).

## Known limitations

- The concurrency cap is per server instance.
- `/blogs` returns an empty list (not an error) if the database is unreachable — `listPublished()` swallows errors.
- The existing public map endpoint `/api/map/pins` filters only `hidden`, not `pending_review`/`rejected`
  (unchanged here; the v1 API filters all three). Developer submissions are forced `hidden` on insert, so this
  matters only if a pin is un-hidden while still pending.
