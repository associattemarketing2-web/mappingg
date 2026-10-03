-- Additive indexes to support a bounds-aware map endpoint (GET /api/map/pins).
--
-- NOT auto-applied. Review, then run against a NON-PRODUCTION database first
-- (or during a maintenance window). Idempotent (IF NOT EXISTS). Uses CONCURRENTLY
-- so it does not lock the table on a live DB — run each statement outside a
-- transaction block (psql default), not inside BEGIN/COMMIT.
--
-- Rationale: pins are stored as jsonb; lat/lng live at doc->>'lat' / doc->>'lng'.
-- A composite btree on the numeric casts lets a `lat BETWEEN ? AND ? AND
-- lng BETWEEN ? AND ?` viewport query use an index instead of a full scan once
-- the pin count grows to the thousands.

CREATE INDEX CONCURRENTLY IF NOT EXISTS pins_latlng
  ON "pins" (
    ((doc->>'lat')::double precision),
    ((doc->>'lng')::double precision)
  );

-- Partial index matching the public map's "visible pins" filter, so the common
-- anonymous read (hidden != true) stays index-only on the bounds columns.
CREATE INDEX CONCURRENTLY IF NOT EXISTS pins_latlng_visible
  ON "pins" (
    ((doc->>'lat')::double precision),
    ((doc->>'lng')::double precision)
  )
  WHERE (doc->>'hidden') IS DISTINCT FROM 'true';

-- Verify with, e.g.:
--   EXPLAIN ANALYZE
--   SELECT id, doc->>'lat', doc->>'lng', doc->>'title'
--   FROM pins
--   WHERE (doc->>'hidden') IS DISTINCT FROM 'true'
--     AND (doc->>'lat')::double precision BETWEEN :south AND :north
--     AND (doc->>'lng')::double precision BETWEEN :west  AND :east;
