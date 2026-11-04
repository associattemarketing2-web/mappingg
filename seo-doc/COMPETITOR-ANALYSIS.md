# Competitor analysis — 4 Nov 2026

Method: 8 live web searches for target queries and two page fetches (Housiey Kharadi, Square Yards
Kharadi). The search API is US-based, not google.co.in, so result order is indicative only. No
competitor content was copied; only page structure was noted. Where a result count or price is
quoted below it is what that site displayed, not a verified figure.

## 1. Who ranks for what

| Query | Page types seen on page 1 | Sites seen |
| --- | --- | --- |
| new residential projects in Kharadi | Listing pages | Square Yards (projects / new-launch / ready-to-move variants), Housiey, Homebazaar, Ghar.tv, Biltrax |
| 2 BHK flats for sale in Wakad | Listing + project pages | Housing.com (many URLs), PropertyPistol, Ghar.tv, JLL Homes |
| flats under 1 crore in Pune | Budget listing pages | Homebazaar (city, zone and locality variants), Square Yards, Address of Choice |
| 3 BHK flats in Mundhwa | Listing + resale listings | Square Yards, Housing.com, PropertyPistol, Housiey, developer site (Puravankara) |
| stamp duty and registration charges Pune 2026 | Guides | Bajaj Finserv, Sobha, Godrej Properties, Paisabazaar, Houssed, Kolte Patil |
| how to check MahaRERA registration | Guides | Housing.com News, Housiey blog, Piramal, L&T Realty, Adani Realty |
| Kharadi vs Mundhwa | Comparison blogs | punerealityhub.pages.dev (a run of “X vs Y 2026” posts), Puravankara |
| mappingg.com | — | Mappingg did not appear |

Note: 99acres and Magicbricks did not appear in these particular results; Square Yards, Housing.com
and Homebazaar dominate the listing queries tested.

## 2. Page structure of the two fetched competitors

**Housiey — /in/pune/kharadi**: H1 “Top Projects in Kharadi”; breadcrumbs; short intro (“Read more”); filters (top developers, litigation-free, hide sold out); project cards with price range “all inc”, developer, size range, possession, unit-wise configuration and price, sold-out tags; heavy lead-gen CTAs (site visit, chat). No locality overview, price trend or FAQ visible.

**Square Yards — /projects-in-kharadi-pune**: title with count (“437+ Projects in Kharadi”); sort and status tiles (ready / under construction / new launch / upcoming / affordable / luxury); cards with status, possession, units, land area, BHK prices, rate per sq ft; stamp-duty block; filters (budget, BHK 1–5, status, zones, builders); nearby localities with distance; zone links.

## 3. Where Mappingg is weaker

- **Coverage.** Square Yards shows 437 Kharadi projects; Mappingg has 24. Counts on listing titles signal depth; ours are honest but small.
- **Prices.** 695 of 913 Mappingg projects have no price; competitors show unit-wise prices and rate per sq ft.
- **Facets.** Competitors have status × locality and budget × locality pages everywhere. Mappingg now has BHK/budget pages only where ≥ 6 projects qualify (by design).
- **Brand.** No brand visibility yet.

## 4. Where Mappingg can be better (and what is built)

| Advantage | Status |
| --- | --- |
| Every project is a real pin on a live map with surrounding infrastructure | Existing; every listing links to the map |
| RERA number per project with the registry named, plus a public explanation of what it does *not* certify | `/data-sources` added (competitors rarely explain this) |
| Honest counts and price ranges computed from the listed projects, with “N of M publish a price” | New BHK/budget pages + existing locality pages |
| No fake “all inclusive” claims, no invented ratings | Policy written on `/data-sources` |
| Guides with tables generated from live data, paired with the live list | Live-list box added to BHK/budget guides |
| Locality → BHK → project links in plain HTML | Added (city, locality, project pages) |

## 5. Content gaps to close (feeds CONTENT-ROADMAP.md)

1. Comparison guides from our own data: Kharadi vs Mundhwa, Wakad vs Hinjewadi, Baner vs Balewadi, Thane vs Navi Mumbai, Whitefield vs Sarjapur Road. The ranking pages are blogs with little data — a table of live project counts, starting prices, BHK mix and possession years per locality is a real differentiator.
2. Stamp duty: our guide exists; competitors disagree on the totals (metro cess / LBT). Refresh ours against IGR Maharashtra and show the calculation clearly.
3. Locality price pages (“Mundhwa property rates”) — only once enough projects publish prices.
4. Rate per sq ft on project pages where both price and carpet area are on record (data, not estimate).
