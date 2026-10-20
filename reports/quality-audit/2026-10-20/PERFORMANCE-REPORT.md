# Performance report — 20 Oct 2026

## Method (comparable conditions)

- **Before** = commit `ecd49b5` (the SEO pass), **after** = this pass (`8bc5332` + uncommitted map-bundle and accessibility fixes). Each was built with `next build` in its own temporary git worktree and served with `next start` on the same Windows machine (ports 3200 / 3100), both reading the same database.
- Lighthouse **12.8.2** (same version as the 13 Oct report), mobile preset with simulated throttling, Chrome 155 headless, Google Tag Manager / Analytics and `/api/track` blocked (so test traffic never reached analytics or the database). 3 runs per route per build; medians below.
- These are **lab** numbers on a developer machine, not real-user (field) Core Web Vitals; INP cannot be measured in a lab run. PageSpeed Insights was not usable (its shared daily quota was exhausted).
- One earlier batch was **discarded**: the repo's `.next` folder was overwritten mid-run at 02:44–02:50 by a process outside this session, so later "after" runs hit a broken server. All numbers below come from the clean rerun.

## Results (median of 3)

| Route | Perf | A11y | Best pr. | SEO | FCP | LCP | TBT | CLS | Page weight | HTML |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | 72 → 80 | 100 → 100 | 100 → 100 | 100 → 100 | 3.3 s → 2.8 s | 4.9 s → 3.9 s | 101 ms → 148 ms | 0 → 0 | 362 KB → 362 KB | 43 KB → 44 KB |
| `/projects` | 73 → **88** | 100 → 100 | 100 → 100 | 100 → 100 | 1.9 s → 1.2 s | 3.2 s → 2.7 s | 777 ms → **346 ms** | 0 → 0 | 267 KB → 193 KB | 140 KB → **20 KB** |
| `/projects/mantra-melange-kharadi-21` | 92 → 92 | 100 → 100 | 100 → 100 | 100 → 100 | 1.1 s → 1.1 s | 2.6 s → 2.7 s | 204 ms → 220 ms | 0 → 0 | 297 KB → 164 KB | 16 KB → 16 KB |
| `/cities/bengaluru` | 80 → **88** | 100 → 100 | 96 → 100 | 100 → 100 | 1.5 s → 1.1 s | 2.9 s → 2.6 s | 544 ms → **269 ms** | 0 → 0 | 202 KB → 147 KB | 75 KB → **19 KB** |
| `/blog/new-projects-in-bengaluru` | 92 → 88 | 100 → 100 | 100 → 100 | 100 → 100 | 1.3 s → 1.3 s | 3.0 s → 3.2 s | 142 ms → 238 ms | 0 → 0 | 370 KB → 370 KB | 27 KB → 27 KB |
| `/faq` | 87 → 87 | 100 → 100 | 100 → 100 | 100 → 100 | 2.5 s → 2.5 s | 3.4 s → 3.4 s | 0 ms → 23 ms | 0 → 0 | 293 KB → 293 KB | 11 KB → 11 KB |
| `/map` | 25 → 25 | 99 → 98 | 96 → 96 | 92 → 92 | 28.4 s → 32.5 s | 71.4 s → 76.3 s | 5.4 s → 5.0 s | 0 → 0 | 1,597 KB → 1,509 KB | 94 KB → **7 KB** |

HTML sizes above are compressed transfer sizes. Uncompressed, `/projects` went from 1,255 KB to 102 KB, `/cities/bengaluru` 678 → 105 KB, `/map` 454 → 33 KB (`curl`, same machine).

Reading the table:
- **Real gains** where pagination removed most of the HTML and React payload: `/projects` +15, `/cities/bengaluru` +8, blocking time roughly halved.
- `/` +8 is mostly run-to-run variation on the embedded map (the home page code did not change).
- Blog post 92 → 88 and small TBT/LCP differences on unchanged pages are within the normal spread between Lighthouse runs on one machine; those pages did not change.
- Accessibility rounds to 100 both before and after, but every "before" page failed `label-content-name-mismatch` (the logo link). That audit now passes everywhere (fixed). An intermediate build also briefly failed `color-contrast` (the new pager's inactive "Previous") and `target-size` (screen-reader links on `/map`); both were fixed before this final run.

## Biggest remaining cost: the live map

`/map` scores 25 on throttled mobile in both builds; nothing in this pass changed how the map loads. From the Lighthouse network log:

- The first screen waits for the map app: the visible content is the map, which renders only after the app bundle, Leaflet and the pin data arrive.
- Pin data is one **~770 KB** request (every column for all 983 pins, including descriptions and custom fields) — most of it is not needed to draw markers.
- ~50 map tiles and 983 individual markers (no clustering).

Suggested (not done — changes map behaviour, needs your OK and testing on real phones):
1. Load only the columns needed for markers first (`id, number, lat, lng, title, status, type`), fetch the rest when a card opens.
2. Cluster markers at low zoom.
3. Paint a static placeholder (or the last map snapshot) immediately so the page is not blank while data loads.

## Other performance changes in this pass

- Listing pagination (48 projects / 96 developers per page).
- `/map` server HTML 454 → 33 KB (crawler-only lists removed).
- Blog card images have dimensions (no layout shift); project and article cover images load with high priority.
- Map card: no layout change cost (CSS only).

## Backend

- Listing pages with `?page=N` render on request (like the blog index); the data comes from the in-process 30-second cache in `lib/db-engine.ts`, so pagination adds no extra database load per page.
- Server response time for `?page=N` pages was not measured separately; Lighthouse's lab FCP for `/projects` improved (1.9 → 1.2 s) with page 1, which is rendered the same way.
- Database: pins, users, posts and leads have primary-key, GIN and lookup indexes (`pins_number`, `pins_hidden`, `users_email`, `posts_slug` …) — checked read-only. No slow-query logging is available; no N+1 patterns were found in the SEO page code (all listing pages read the cached pin list once).
