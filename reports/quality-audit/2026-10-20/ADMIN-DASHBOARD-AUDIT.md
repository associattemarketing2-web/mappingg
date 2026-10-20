# Admin dashboard audit — 20 Oct 2026

**Status: code review only. The admin was not redesigned in this pass.**

## Why no redesign

The super-admin (`/dashboard/s-admin`) is one client component, `components/admin/AdminApp.tsx` (2,811 lines), plus 10 panels (6,141 lines in total). It can only be rendered after signing in as staff. There are no test staff credentials, and creating an account would be a write to the production database, which this pass does not do. A redesign that cannot be seen, clicked or regression-tested would be exactly the "massive unverified patch" the brief rules out. It is listed as the first item for the next pass, with a test account.

## What was checked in code

| Area | Finding |
| --- | --- |
| Access | `app/dashboard/s-admin/layout.tsx` and every `/api/admin/*` handler check staff/permission server-side (see AUTH-SECURITY-AUDIT). Live probe: guests are redirected; APIs return 401/403. |
| Roles | Owner (`admin`) sees everything; employees see only tabs whose permission they hold (`map, intake, leads, accounts, blogs, seo, settings`), enforced again in the API (`hasPermission`). |
| Destructive actions | All 26 delete/remove actions ask for confirmation and are soft deletes ("moves to Backups → Recycle bin, where you can restore it"). |
| Large tables | Leads are capped server-side (`LEADS_LIMIT`); a live SSE stream (`/api/admin/leads/stream`) pushes new ones. |
| Visibility switches | Per-field "show on public card" switches are honoured by the live map, the API, and (since the SEO pass) the project pages. They are not secret (see AUTH-SECURITY-AUDIT risk 4). |
| Data-quality metrics | The SEO & Health tab and `migration/enrichment` reports derive counts from real rows; nothing hard-coded was found. |
| Copy | Developer/agent review screens ask for a **MahaRERA** number — correct for Maharashtra onboarding; developers in other states would need a different field (business decision, see REMAINING-ISSUES). |

## Changes in this pass that touch signed-in screens

- Buyer Compare table and Favourites: column label "MahaRERA no." → "RERA no." (the numbers come from any state's registry).
- Map sign-in prompt: "MahaRERA-verified RERA numbers" → "RERA numbers".

## Recommended next pass (with a staff test account)

1. Screenshot every tab at 375 / 768 / 1440 px; list overflow, clipped tables, small targets.
2. Split `AdminApp.tsx` by tab (no behaviour change) so each tab can be tested and redesigned on its own.
3. Shared table component: sort, search, pagination, empty/error states, row actions, sticky header on mobile.
4. Form pattern: required markers, inline errors, unsaved-change warning on long project edits.
5. Dashboard overview: only metrics computed from real rows (projects, data gaps, leads by status, submissions awaiting review).
