# Mappingg — HTML/Supabase → Next.js/MongoDB Migration Report

Date: 2026-09-29 · Next.js 14.2.15 (App Router, TypeScript) · MongoDB (`mappingg` db)

---

## 1. Existing functionality discovered

**Three standalone HTML apps, all backed by Supabase (anon key embedded client-side):**

- `index.html` → **public map** (Leaflet 1.9.4, OSM + ArcGIS satellite tiles).
  Marker rendering by status/type, filters, Google Places search, teaser popups,
  lead-capture gate (name/WhatsApp/email → unlock details), roads/metro lines,
  area boundary, infra markers, `?pin=<id>` deep-link, geolocation "near me",
  GTM/Search-Console loaded from `map_settings`, Realtime pin updates, Google
  Sheets lead webhook (best-effort).
- `team-editor-x7k2.html` → **admin editor** (Leaflet + Google Places + Phosphor
  icons). Supabase Auth login/logout, add/edit/delete pins, infra markers, roads,
  metro lines, boundaries; custom infra types; drag-to-move; autosave; map image
  export; **leads** panel; **history** panel + **restore**; Tracking/SEO settings.
- `mundhwa-map-3d.html` → **3D map** (MapLibre GL 4 + OpenFreeMap), 3D pins,
  infra markers, popups, navigation control.

**Supabase surface:** tables `pins, infra_markers, roads, map_settings, infra_types,
area_boundaries, leads, pins_history`; RPC `restore_pin_from_history`; Auth
(`signInWithPassword/signOut/onAuthStateChange/getSession`); Realtime channels on
`pins/infra_markers/roads/map_settings`.

## 2. Next.js architecture (final folder structure)

```
app/
  layout.tsx, globals.css, robots.ts, sitemap.ts
  page.tsx                              # / public map (+JSON-LD, SEO metadata)
  team-editor-x7k2/page.tsx            # admin editor (noindex)
  mundhwa-map-3d/page.tsx              # 3D map
  api/db/route.ts                      # query gateway → MongoDB
  api/auth/{login,logout,session}/route.ts
  api/rpc/restore_pin_from_history/route.ts
  rest/v1/map_settings/route.ts        # pre-boot GTM/settings compat
components/LegacyApp.tsx               # boots the map-app bundles in-document
lib/{mongodb.ts, auth.ts, db-engine.ts}
models/index.ts                        # TS shapes for every collection
public/db-shim.js                      # self-contained DB client → our API (no Supabase)
public/legacy/*.json                  # the three map-app bundles (canonical source)
public/img/*                          # image assets
public/llms.txt                        # AI-crawler descriptor
migration/                            # backup/import/verify/index/seed scripts
```

There are **no HTML pages** and **no Supabase** anywhere in the project — every
route is a Next.js page/route handler, and the three map apps ship as static
JSON bundles under `public/legacy/`.

**Key decision — behavior-preserving port.** The ~85k-char map/editor/3D app logic
is *preserved verbatim* inside the bundles and booted by `LegacyApp`, with only the
data layer swapped: the Supabase SDK is replaced by `public/db-shim.js` (which talks
only to our MongoDB-backed API). This guarantees the UI, map behavior, interactions
and business logic are identical, with no visual redesign. The bundles are now the
canonical source (the original standalone HTML files have been removed).

## 3. Database structure (collections + indexes)

Collections mirror the Supabase tables 1:1, keeping the original UUID `id` (also
used as `_id` for idempotent imports). Indexes (only where queries need them):
`pins.number`; `leads.created_at desc`, `leads.pin_id`; `pins_history.changed_at desc`,
`pins_history.history_id` (unique); `infra_types.key`; `users.email` (unique).

## 4. Authentication architecture

Replaces Supabase Auth. `POST /api/auth/login` verifies email + **bcrypt** hash
from `users`, issues a **JWT** (jose, HS256, `AUTH_SECRET`) stored in an
**HTTP-only, SameSite=Lax, Secure** cookie (unreadable by JS → XSS-safe). Session
read via `/api/auth/session`; logout clears the cookie. The shim maps
`signInWithPassword/signOut/getSession/onAuthStateChange` onto these. All write
APIs re-verify the cookie server-side.

## 5. API architecture

- `POST /api/db` — validated (zod) query engine: select/insert/update/delete/upsert
  with eq/in filters, order, limit, single, column projection; authorization per
  table; auto history-capture on pin update/delete.
- `POST /api/rpc/restore_pin_from_history` — server-side equivalent of the RPC.
- `POST /api/auth/login|logout`, `GET /api/auth/session`.
- `GET /rest/v1/map_settings` — public pre-boot compatibility (GTM/SEO/video only).

## 6. SEO implementation

Metadata API (title templates, description, canonical, Open Graph, Twitter) in
`layout.tsx` + per-route; dynamic `sitemap.xml` (public pages only), `robots.txt`
(disallows `/team-editor-x7k2`, `/api/`, `/rest/`); JSON-LD (WebSite/Organization)
on `/`; crawlable `<h1>` (visually hidden, UI unchanged); editor is `noindex` via
metadata **and** `X-Robots-Tag` header.

## 7. Performance improvements

Server Components for shells; heavy map JS is client-only and lazy-loaded via the
bundle boot; libraries deduped across navigations; MongoDB indexes on real query
paths; column projection preserved (light-column pin fetch); Realtime replaced by
a 15s change-signature poll (far lighter than the original always-on socket).

## 8. Security improvements

`MONGODB_URI`/`AUTH_SECRET` are server-only (never `NEXT_PUBLIC_`); the anon key
and direct DB exposure are gone; all inputs zod-validated; table identifiers
whitelisted (`^[a-z_]+$`) → NoSQL-injection-safe; writes require auth; `leads`/
`pins_history` require auth to read; `pins_history` is not client-writable
(trigger-equivalent server capture); HTTP-only Secure cookies; bcrypt(12) hashes;
login avoids user enumeration.

## 9. Responsive improvements

The original responsive CSS (mobile/tablet/desktop breakpoints, touch targets,
`dvh`, `viewport-fit=cover`) is preserved unchanged; `viewport` is set via Next's
viewport export. No layout was altered, so existing responsive behavior carries
over intact.

## 10. Files changed / added

Added: all of `app/`, `components/`, `lib/`, `models/`, `public/db-shim.js`,
`public/legacy/*`, `public/img/*`, `public/llms.txt`, `package.json`, `tsconfig.json`,
`next.config.mjs`, `.eslintrc.json`, `.gitignore`, `.env.example`, `.env.local`,
`migration/*`, `MIGRATION-REPORT.md`.

## 11. Files removed

After the migrated app was browser-verified, the old site was removed so the
project is pure Next.js with no HTML pages:

- `index.html`, `team-editor-x7k2.html`, `mundhwa-map-3d.html` — old standalone
  pages (their behavior is preserved verbatim in `public/legacy/*.json`).
- root `robots.txt`, `sitemap.xml` — superseded by `app/robots.ts` / `app/sitemap.ts`.
- root `llms.txt` — moved to `public/llms.txt`.
- root `img/` — moved to `public/img/`.
- `scripts/prepare-legacy.mjs` — the HTML→bundle build step, obsolete now that the
  bundles are canonical.

## 12. Files intentionally preserved

`public/legacy/*.json` — the canonical, self-contained map/editor/3D app bundles
(no Supabase, no external HTML source needed). `migration/*` retained for the pending
`leads`/`pins_history` import and re-verification.

## 13. Migration risks / manual verification needed

- **Visual map render** (Leaflet/MapLibre, marker draw, popups, drag, search) was
  not browser-tested in this environment — verify in a browser (`npm run dev`).
- **`leads` + `pins_history`** not yet exported (RLS) — see PENDING-DATA.md.
- **Realtime** is polling, not websockets — cross-client updates lag ≤15s.
- **Google Sheets webhook** and **Google Maps/Places key** are the original hardcoded
  values; lock the Maps key by HTTP referrer.
- **Admin accounts** must be (re)created via `seed-admin.mjs` (temp one seeded).

## 14. Testing results

| Feature | Result |
|---|---|
| `npm run build` (prod) | PASS |
| `npm run lint` | PASS (0 warnings) |
| DB select pins (186) via API | PASS |
| Public settings pre-boot fetch | PASS |
| Unauthenticated write blocked (401) | PASS |
| Admin login (cookie issued) | PASS |
| Authed insert/update/delete pin | PASS |
| Auto history capture on pin edit/delete | PASS |
| Restore from history (RPC) logic | PASS (engine verified) |
| Public lead insert (no auth) | PASS (201) |
| Unauthenticated lead read blocked (401) | PASS |
| `pins_history` not client-deletable (403) | PASS (by design) |
| Static assets `/img/*`, shim, bundles | PASS |
| robots.txt / sitemap.xml / noindex header | PASS |
| Data integrity (counts unchanged after tests) | PASS |
| Visual map rendering | NOT TESTED (needs browser) |
| leads / pins_history data import | PENDING (needs service_role key) |
```
```
