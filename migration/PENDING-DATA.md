# Protected-data import — PENDING

The public tables were exported and imported into MongoDB successfully:

| Collection | Rows |
|---|---|
| pins | 186 |
| infra_markers | 15 |
| roads | 11 |
| area_boundaries | 4 |
| infra_types | 1 |
| map_settings | 1 |

## Still pending: `leads` and `pins_history`

These two tables are protected by Supabase Row-Level Security and return an empty
array when read with the public anon key. They could not be exported yet.

**They are NOT empty-by-assumption and NO fake data has been created.** The
collections exist with the correct schema and indexes, ready to receive the real
export.

### How to complete the import

You provided consent to use the Supabase **service_role** key. Once you paste it,
run:

```bash
# 1) Re-export including the protected tables (bypasses RLS)
SUPABASE_KEY="<service_role secret>" node migration/backup-supabase.mjs

# 2) Import everything (idempotent upsert; existing rows are preserved)
MONGODB_URI="<uri>" node migration/import-mongodb.mjs

# 3) Verify counts
MONGODB_URI="<uri>" node migration/verify-mongodb.mjs
```

Alternatively, an admin login works too:

```bash
SUPABASE_EMAIL="admin@example.com" SUPABASE_PASSWORD="..." node migration/backup-supabase.mjs
```

> Security: rotate the service_role key in Supabase after use — it bypasses all
> access control and must never live in client code or the Next.js frontend.

## Admin accounts

Supabase Auth (GoTrue) password hashes are not exportable via the API, so team
logins are recreated explicitly with `migration/seed-admin.mjs`.
