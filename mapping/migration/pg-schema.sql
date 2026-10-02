-- PostgreSQL schema for Mappingg (migrated off MongoDB).
--
-- Every former Mongo collection becomes a table shaped (id text pk, doc jsonb).
-- The whole document lives in `doc`; a GIN index makes containment/key lookups
-- fast, and a few expression indexes cover the hottest filters. `backups` and
-- `partners_media` hold binary blobs and so have their own columns.
--
-- Idempotent: safe to run repeatedly (CREATE ... IF NOT EXISTS).

-- ---- generic document tables ------------------------------------------------
CREATE TABLE IF NOT EXISTS "pins"                (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS "infra_markers"       (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS "roads"               (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS "area_boundaries"     (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS "infra_types"         (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS "map_settings"        (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS "leads"               (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS "pins_history"        (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS "users"               (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS "builders"            (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS "submission_links"    (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS "project_submissions" (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS "submission_events"   (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS "projects"            (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS "counters"            (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS "posts"               (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS "contact_leads"       (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);

-- ---- GIN indexes (containment / key existence) ------------------------------
CREATE INDEX IF NOT EXISTS pins_gin                ON "pins"                USING gin (doc jsonb_path_ops);
CREATE INDEX IF NOT EXISTS infra_markers_gin       ON "infra_markers"       USING gin (doc jsonb_path_ops);
CREATE INDEX IF NOT EXISTS roads_gin               ON "roads"               USING gin (doc jsonb_path_ops);
CREATE INDEX IF NOT EXISTS area_boundaries_gin     ON "area_boundaries"     USING gin (doc jsonb_path_ops);
CREATE INDEX IF NOT EXISTS infra_types_gin         ON "infra_types"         USING gin (doc jsonb_path_ops);
CREATE INDEX IF NOT EXISTS leads_gin               ON "leads"               USING gin (doc jsonb_path_ops);
CREATE INDEX IF NOT EXISTS pins_history_gin        ON "pins_history"        USING gin (doc jsonb_path_ops);
CREATE INDEX IF NOT EXISTS users_gin               ON "users"               USING gin (doc jsonb_path_ops);
CREATE INDEX IF NOT EXISTS builders_gin            ON "builders"            USING gin (doc jsonb_path_ops);
CREATE INDEX IF NOT EXISTS submission_links_gin    ON "submission_links"    USING gin (doc jsonb_path_ops);
CREATE INDEX IF NOT EXISTS project_submissions_gin ON "project_submissions" USING gin (doc jsonb_path_ops);
CREATE INDEX IF NOT EXISTS submission_events_gin   ON "submission_events"   USING gin (doc jsonb_path_ops);
CREATE INDEX IF NOT EXISTS projects_gin            ON "projects"            USING gin (doc jsonb_path_ops);
CREATE INDEX IF NOT EXISTS posts_gin               ON "posts"               USING gin (doc jsonb_path_ops);
CREATE INDEX IF NOT EXISTS contact_leads_gin       ON "contact_leads"       USING gin (doc jsonb_path_ops);

-- ---- hot-path expression indexes --------------------------------------------
CREATE INDEX IF NOT EXISTS pins_number   ON "pins"   (((doc->>'number')));
CREATE INDEX IF NOT EXISTS pins_hidden   ON "pins"   (((doc->>'hidden')));
CREATE INDEX IF NOT EXISTS users_email   ON "users"  (((doc->>'email')));
CREATE INDEX IF NOT EXISTS users_role    ON "users"  (((doc->>'role')));
CREATE INDEX IF NOT EXISTS projects_slug ON "projects" (((doc->>'slug')));
CREATE INDEX IF NOT EXISTS projects_live ON "projects" (((doc->>'is_live')));
CREATE INDEX IF NOT EXISTS sublinks_token ON "submission_links" (((doc->>'token')));
CREATE INDEX IF NOT EXISTS subs_builder  ON "project_submissions" (((doc->>'builder_id')));
CREATE INDEX IF NOT EXISTS subs_status   ON "project_submissions" (((doc->>'status')));
CREATE INDEX IF NOT EXISTS subevents_sub ON "submission_events" (((doc->>'submission_id')));
CREATE INDEX IF NOT EXISTS posts_slug    ON "posts"  (((doc->>'slug')));
CREATE INDEX IF NOT EXISTS posts_status  ON "posts"  (((doc->>'status')));
CREATE INDEX IF NOT EXISTS pinhist_op    ON "pins_history" (((doc->>'operation')));
CREATE INDEX IF NOT EXISTS pinhist_pin   ON "pins_history" (((doc->>'pin_id')));

-- ---- binary blob tables (special) -------------------------------------------
CREATE TABLE IF NOT EXISTS "backups" (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reason     text NOT NULL DEFAULT 'manual',
  size       integer NOT NULL DEFAULT 0,
  counts     jsonb NOT NULL DEFAULT '{}'::jsonb,
  gz         bytea NOT NULL
);
CREATE INDEX IF NOT EXISTS backups_created_at ON "backups" (created_at DESC);

CREATE TABLE IF NOT EXISTS "partners_media" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename     text NOT NULL,
  content_type text NOT NULL DEFAULT 'application/octet-stream',
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  upload_date  timestamptz NOT NULL DEFAULT now(),
  data         bytea NOT NULL
);
CREATE INDEX IF NOT EXISTS partners_media_filename ON "partners_media" (filename, upload_date DESC);
