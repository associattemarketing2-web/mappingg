# Remaining actions — 20 Oct 2026

Everything below is unresolved, blocked, or needs a decision. Ordered by impact.

## A. Needs you (access, approval or a business decision)

| # | Action | Why | Blocked on |
| --- | --- | --- | --- |
| 1 | **Review, commit and deploy** this branch | None of the fixes are live yet. After deploy, run `npm run seo:audit -- --label=after-deploy --compare=reports/seo-audit/2026-10-20-baseline-live-final` | You |
| 2 | **Enable the Search Console API** in Google Cloud project 847257037149: https://console.developers.google.com/apis/api/searchconsole.googleapis.com/overview?project=847257037149 — and confirm the service account (in `GSC_SERVICE_ACCOUNT_JSON`) is a user on the `www.mappingg.com` property | Without it there are no clicks, impressions, queries, rankings or index status; the keyword map uses site data only. Windsor.ai is connected but has no Search Console source either | Google Cloud owner |
| 3 | After deploy, **resubmit `https://www.mappingg.com/sitemap.xml`** in Search Console and request indexing for the 3 new city hubs (`/cities/bengaluru`, `/cities/delhi`, `/cities/hyderabad`) | New hubs for 584 projects | Search Console access |
| 4 | **Publish the two seeded guides** (`carpet-area-vs-built-up-vs-super-built-up-area`, `possession-delay-rera-buyer-rights-maharera-complaint`) by running `migration/seed-blogs.mjs` against production | They are in the repo (commit a9d4716) but not in the database. Writing to production was out of scope for this audit | Your approval to write to the DB |
| 5 | **Decide on the 8 same-name project pairs**: Mantra Melange (21/75 — identical incl. RERA), Splendid Evora (423/424 — identical), Yashwin SuperNova (602/603), VJ Town Centre (604/605), Eldeco Live by the Greens Phase III (624/625) — identical; Pristine Properties (5/9), Santiago Sunrise (239/243 — residential vs shops), Whiteland Blissville (562/596 — different RERA) | Identical pairs are duplicate pages competing for the same name. Hide one of each identical pair; give the others distinguishing names (e.g. "– Shops", "Phase 2") | Data team (no automatic merge was done) |
| 5b | **Duplicate pin number 116**: "Yoo One" and "Codename Autobiography by Jhamtani" both have number 116 | Project URLs resolve by number, so "Codename Autobiography" can never get its own page (its link on `/map` redirects to Yoo One). Give one of them an unused number in the admin; its page then appears automatically | Data team (pin numbers were not changed by this audit) |
| 5c | **Kohinoor Viva Pixel Phase 1 / Phase 2** (261/260) share the same key USP text, so their meta descriptions are identical | Add a phase-specific USP to one of them | Data team |
| 6 | **Verification wording**: FAQ ("Every RERA number is checked on the official MahaRERA website…", "How can I list my project?") and the home page still say MahaRERA for all projects | 584 projects are outside Maharashtra (Karnataka RERA, HARERA, UP RERA). Please confirm how those are checked so the text can be made accurate. I only removed "MahaRERA-verified" from the blog CTA and home description | You |
| 7 | **Hidden text on `/map`**: a visually hidden (`sr-only`) H1, area lists and a list of every project | Content shown only to crawlers is a risk under Google's spam policies. Options: (a) make it a visible, collapsible "All projects on this map" section under the map, or (b) drop it — `/projects` and the city/locality hubs now link every project | Design decision |
| 8 | **About page copy** still describes "Pune and the Mumbai Metropolitan Region" only; homepage title says "India & Dubai" | Brand copy — left for you | You |
| 9 | Vercel domain: `http://mappingg.com` takes 2 redirects to reach `https://www.mappingg.com` | Minor; set the apex to redirect straight to `https://www.` | Vercel dashboard |

## B. Project data gaps (965 projects; fill in admin — never guessed)

| Field missing | Projects | Effect |
| --- | --- | --- |
| Description / key USP | 861 | Pages rely on the facts overview; a real description is the biggest content gain |
| Carpet area | 768 | No area facts or per-sq-ft queries |
| Price | 758 | No "price" facet in title, no price FAQ |
| Possession date | 234 | No possession FAQ |
| Configuration (BHK) | 215 | Can't match "2 BHK in …" searches |
| RERA number | 162 | No RERA row / FAQ / schema identifier |
| Developer | 42 | No developer link or FAQ |
| Locality not recognised | 38 | No locality breadcrumb or hub (add the locality to `lib/locality.ts` KNOWN, or fix the text) |
| Generic names | 56 | e.g. "Pristine Properties" — use the real project name |

Start with Bengaluru (491 projects, mostly registry imports without price or description). Per-project gaps are in `PROJECT-SEO-REPORT.csv` (`data_gaps`).

## C. Code work not done (needs a decision or larger change)

| # | Item | Notes |
| --- | --- | --- |
| 1 | Very large listing pages: `/projects` 1.2 MB HTML (965 cards), `/status/under-construction` 1.15 MB, `/cities/bengaluru` 662 KB, `/property/residentialgroup-housing` 587 KB | Paginate (`?page=N`, like the blog) or show the top N per city with links to locality pages. Changes the listing UX, so not done without approval |
| 2 | 11 blog `seo_description` values are 171–189 characters | Stored in the database; shorten in the admin blog editor |
| 3 | ~12 project titles still exceed ~70 characters | The project name alone is that long; left as is rather than cutting names |
| 4 | Developer pages with 1–2 projects (≈500) stay `noindex` | By design (thin-page rule) |
| 5 | Core Web Vitals | Run PageSpeed Insights after deploy on `/`, `/map`, a project, a locality, a blog post, `/contact`. Last lab numbers (13 Oct): home 74, contact 64 on mobile |
| 6 | Mobile/browser check of the changed pages | Not done in a real browser. Check a project page (new overview + RERA row), a developer page, `/cities`, a blog post (breadcrumb) and the mobile menu |

## D. Off-page and content (from the 10 Oct plan, still open)

- Google Business Profile (same name/address/phone as the site footer).
- Backlinks: "View on Mappingg" links from listed developers, directory listings, local PR.
- Bengaluru now has the most projects but only one guide — add locality guides (e.g. Whitefield, Sarjapur Road, North Bengaluru) and a Delhi NCR guide.
- Once Search Console data is available, revisit `KEYWORD-URL-MAPPING.csv` with real queries.
