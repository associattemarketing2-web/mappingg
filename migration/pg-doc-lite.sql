-- Light document column for tables that keep base64 images inside `doc`.
-- See "Light reads (doc_lite)" in lib/mongo-compat.ts for why and how it's used.
--
-- Additive and reversible: no existing value changes, nothing in the app writes
-- this column (Postgres computes it on every INSERT/UPDATE), and the app keeps
-- reading `doc` whenever the column is missing. Apply / check / revert with
--   node --env-file=.env migration/apply-doc-lite.mjs [--revert]
--
-- Each inline image (a `data:` URL) becomes 'data:mg-digest;md5,' || md5(value) —
-- byte-for-byte the digest list queries computed on the fly before, so image URLs
-- (and browser/CDN caches keyed on them) don't change.

CREATE OR REPLACE FUNCTION mg_doc_lite(d jsonb, keys text[]) RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN d IS NULL THEN NULL ELSE d || coalesce((
    SELECT jsonb_object_agg(k, to_jsonb('data:mg-digest;md5,' || md5(d->>k)))
      FROM unnest(keys) AS k
     WHERE left(d->>k, 5) = 'data:'
  ), '{}'::jsonb) END
$$;

-- Keep the key lists in sync with LITE_MEDIA in lib/mongo-compat.ts.
ALTER TABLE "pins"       ADD COLUMN IF NOT EXISTS doc_lite jsonb
  GENERATED ALWAYS AS (mg_doc_lite(doc, ARRAY['image', 'brochure_image'])) STORED;
ALTER TABLE "developers" ADD COLUMN IF NOT EXISTS doc_lite jsonb
  GENERATED ALWAYS AS (mg_doc_lite(doc, ARRAY['logo'])) STORED;

-- The planner needs fresh stats for the new column.
ANALYZE "pins";
ANALYZE "developers";
