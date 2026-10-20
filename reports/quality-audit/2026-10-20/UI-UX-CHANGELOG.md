# UI / UX changelog — 20 Oct 2026

Scope was deliberately narrow: fix what the real-browser checks showed as broken or misleading, and put the SEO pages' styles on tokens. No visual redesign of the homepage, map or admin (see ADMIN-DASHBOARD-AUDIT for why the admin was not touched).

## Design tokens (`app/seo.css`)

All crawlable listing and detail pages (projects, cities, localities, developers, status, property types) now draw colours, radii and shadows from tokens on `.seo-wrap` instead of 25 repeated hex values:

| Token | Value | Use |
| --- | --- | --- |
| `--seo-ink` / `--seo-ink-2` | #141b24 / #1b2430 | Headings / strong text, primary button |
| `--seo-text-2` | #4b5560 | Body text (7.6:1 on white) |
| `--seo-muted` | #646e7a | Meta text (4.9:1, AA) |
| `--seo-line` / `--seo-line-strong` / `--seo-subtle` | #e7ebef / #d0d6dd / #eef1f4 | Borders, dividers, image placeholder |
| `--seo-accent` / `--seo-focus` | #1766c0 | Links, focus ring |
| Status chip pairs | upcoming / build / ready / sold | Same colours as before; sold text darkened to #5c5c66 |
| `--seo-radius` / `--seo-radius-lg` | 12px / 14px | Cards / cover image |

Near-identical greys were merged (#46505b, #4b5560, #56606b → `--seo-text-2`; #6a7580, #646e7a → `--seo-muted`). No layout changes.

## Accessibility and interaction

- **Visible keyboard focus**: `:focus-visible` outline on every link and FAQ summary in the SEO pages. Verified: 12 Tab stops each on `/projects`, a project page, `/faq` and `/blog` all show a visible focus style.
- **Reduced motion**: card lift on hover is disabled under `prefers-reduced-motion`.
- **Tap targets ≥ 24px** (WCAG 2.2): breadcrumb links (were 18px tall) and the mobile menu's WhatsApp / email links (were 21px). Pager buttons and pills are 40px; project CTA buttons 44px.
- **Long text never pushes the page sideways**: `overflow-wrap: anywhere` on the SEO page wrapper; project spec values can shrink.
- **Map**: the hidden `/map` heading is now a short, honest description for screen readers with links to the same projects as lists, instead of ~400 KB of crawler-only text.

## Fixes found in the real browser

| Where | Problem | Fix |
| --- | --- | --- |
| Project page CTA | "Enquire about this project" + "See on live map" did not wrap and overflowed at 320px | `.seo-cta` wraps |
| Map project card | The floating Enquire / WhatsApp / Share column (52px) covered the locality and the type chip at every width | Card text keeps 66px clear; long property types end in "…"; status chip wraps instead of being cut ("Under Const…") |
| Map detail panel | Long RERA numbers (e.g. 37-character Karnataka ids, newly shown) ran under the Verify button at 375px | Number wraps inside its box |
| Map | When projects failed to load, the map stayed empty with no explanation (it retried silently) | "Couldn't load the projects. Retrying…" notice (`role="status"`) from the first failed attempt; removed when they load |
| Project lists | Up to 965 cards on one page (1.2 MB) | 48 per page with a numbered pager ("Showing 49–96 of 965 · page 2 of 21") |
| Developer index | 570 cards on one page (450 KB) | 96 per page, same pager |
| `/cities`, `/developers`, `/property` | Cards (h3) came straight after the H1 | Section H2 added |
| Blog index | Card images had no width/height (layout shift) | `width`/`height` set; `decoding="async"` |

## Responsive verification

Real Chrome (headless) at **320, 375, 430, 768, 1024, 1440 and 1920px** on 34 routes (238 page loads): no horizontal scrolling on any page at any width, no JavaScript errors, no broken images, one visible H1 per page (the map pages' H1 is screen-reader only by design). Screenshots at 375 and 1440px are in `browser/shots/`.

Map at 375 and 1440px: markers load (983 in 2–5 s), touch and mouse pan, wheel zoom, marker click/tap opens the card (3/3 at each width), detail panel fits a 375px screen.

## Not done

- No redesign of the homepage, map UI or admin; no new icon library (the site uses a Font Awesome subset consistently; the blog's no-cover placeholder still uses an emoji fallback inside the icon element).
- The legacy map bundle keeps a hidden `<h1>Associatte Interactive Map</h1>` (old brand name). Its CSS may rely on the tag, so it was left for a change where the map's own source is edited.

## Added after the Lighthouse run

- Logo links' accessible name now starts with the visible text ("Mappingg.com home") — site header, info pages, dashboard headers.
- Inactive pager steps (blog and project lists) readable at 4.8–4.9:1 with a dashed border.
- **"Edit all details"** buttons in s-admin (Map Editor pin header, Developers tab rows and project view, Developer projects rows and drawer) open the full Projects Intake form — see FULL-EDIT-FEATURE.md. Not yet verified in a browser.
