-- Buyer lead sources (lib/lead-sources/store.ts). The app creates these on first
-- use (CREATE ... IF NOT EXISTS); this file is the same DDL for review or a manual run.
-- Additive only: no existing table is changed. Leads themselves are stored in the
-- existing `leads` table (tagged with doc.ingest_source).

CREATE TABLE IF NOT EXISTS lead_ingest_keys (
  source text NOT NULL,
  external_id text NOT NULL,
  payload_hash text NOT NULL DEFAULT '',
  lead_id text,
  outcome text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, external_id)
);

CREATE TABLE IF NOT EXISTS lead_sync_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  action text NOT NULL,
  ok boolean NOT NULL,
  imported integer NOT NULL DEFAULT 0,
  merged integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  is_test boolean NOT NULL DEFAULT false,
  error text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor text
);
CREATE INDEX IF NOT EXISTS lead_sync_log_source_at ON lead_sync_log (source, at DESC);

CREATE TABLE IF NOT EXISTS lead_portals (
  id text PRIMARY KEY,
  name text NOT NULL,
  url text NOT NULL DEFAULT '',
  data_scope text NOT NULL DEFAULT '',
  terms_url text NOT NULL DEFAULT '',
  permission text NOT NULL DEFAULT 'not_reviewed',
  permission_note text NOT NULL DEFAULT '',
  evidence_url text NOT NULL DEFAULT '',
  reviewed_by text NOT NULL DEFAULT '',
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Rollback (drops only these three tables; imported leads stay in `leads`):
--   DROP TABLE IF EXISTS lead_portals, lead_sync_log, lead_ingest_keys;
-- To also remove imported leads:
--   DELETE FROM leads WHERE doc ? 'ingest_source';
