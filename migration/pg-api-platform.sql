-- Developer API platform (/api/v1) — additive schema.
--
-- The app creates these tables itself on first use (lib/api-platform/store.ts,
-- SCHEMA_SQL — this file is generated from it), so running this by hand is
-- optional; it is here for review and for provisioning ahead of a deploy.
-- Idempotent. Touches no existing table.
--
--   psql "$DATABASE_URL" -f migration/pg-api-platform.sql
--
-- ROLLBACK (removes the Developer API's data only — every key stops working):
--   DROP TABLE IF EXISTS api_enquiry_submissions, api_request_log, api_counters, api_audit, api_keys, api_apps;
-- (Enquiries already written to the `leads` table stay there — they are normal CRM leads.)
-- To switch the API off WITHOUT deleting anything, set DEVELOPER_API_DISABLED=1.

CREATE TABLE IF NOT EXISTS api_apps (
  id text PRIMARY KEY,
  name text NOT NULL,
  organization text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  website text NOT NULL DEFAULT '',
  purpose text NOT NULL DEFAULT '',
  scopes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active',
  rate_per_minute integer NOT NULL DEFAULT 60,
  daily_quota integer NOT NULL DEFAULT 5000,
  max_page_size integer NOT NULL DEFAULT 50,
  expires_at timestamptz,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
  );

CREATE TABLE IF NOT EXISTS api_keys (
  id text PRIMARY KEY,
  app_id text NOT NULL REFERENCES api_apps(id) ON DELETE CASCADE,
  secret_hash text NOT NULL,
  last4 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz
  );

CREATE INDEX IF NOT EXISTS api_keys_app ON api_keys (app_id);

CREATE TABLE IF NOT EXISTS api_counters (
  k text PRIMARY KEY,
  n integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL
  );

CREATE INDEX IF NOT EXISTS api_counters_exp ON api_counters (expires_at);

CREATE TABLE IF NOT EXISTS api_request_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  app_id text,
  key_id text,
  method text NOT NULL,
  route text NOT NULL,
  status integer NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0,
  records integer NOT NULL DEFAULT 0,
  event text NOT NULL,
  request_id text NOT NULL,
  client text
  );

CREATE INDEX IF NOT EXISTS api_request_log_at ON api_request_log (at DESC);

CREATE INDEX IF NOT EXISTS api_request_log_app_at ON api_request_log (app_id, at DESC);

CREATE INDEX IF NOT EXISTS api_request_log_event_at ON api_request_log (event, at DESC);

CREATE TABLE IF NOT EXISTS api_audit (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  app_id text,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
  );

CREATE INDEX IF NOT EXISTS api_audit_app_at ON api_audit (app_id, at DESC);

ALTER TABLE api_apps ADD COLUMN IF NOT EXISTS enquiry_rate_per_minute integer NOT NULL DEFAULT 10;

ALTER TABLE api_apps ADD COLUMN IF NOT EXISTS enquiry_daily_quota integer NOT NULL DEFAULT 200;

CREATE TABLE IF NOT EXISTS api_enquiry_submissions (
  app_id text NOT NULL,
  submission_id text NOT NULL,
  reference text NOT NULL UNIQUE,
  payload_hash text NOT NULL,
  lead_id text,
  outcome text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, submission_id)
  );

CREATE INDEX IF NOT EXISTS api_enquiry_submissions_app_at ON api_enquiry_submissions (app_id, created_at DESC);
