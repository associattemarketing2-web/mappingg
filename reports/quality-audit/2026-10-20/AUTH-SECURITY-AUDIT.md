# Authentication & security audit — 20 Oct 2026

Scope: `lib/auth.ts`, `lib/staff.ts`, `lib/db-engine.ts`, `lib/rate-limit.ts`, all 63 route handlers under `app/api` and `app/rest`, the dashboard and admin pages. Method: code review of every handler, plus a live probe against the production build running locally (read-only GET requests only; no write was sent to any privileged endpoint because the local server uses the production database).

## How it works (verified in code)

| Area | Implementation | Verdict |
| --- | --- | --- |
| Session | HS256 JWT in `mg_session` cookie, 60 days, `httpOnly`, `Secure` in production, `SameSite=Lax`, path `/` | Good |
| Session check | Every request re-reads the account's role from `users` (30 s cache); a deleted account is signed out | Good |
| Passwords | bcrypt; login always runs a hash compare (no user enumeration by timing); rate-limited | Good |
| Google sign-in | `state` checked against a cookie (CSRF) and PKCE | Good |
| Roles | `admin` (owner), `employee` (granted permissions), `buyer`, `developer`, `agent` | Good |
| Admin APIs | Each handler calls `getStaffUser`, `hasPermission(perm)` or checks `role === 'admin'` server-side — not just hidden buttons | Good |
| Generic data API (`/api/db`) | Public may read only map tables (pins, roads, infra, boundaries, settings, infra types); hidden pins excluded server-side; private tables need staff; developers are scoped to their own pins | Good |
| CSRF | JSON APIs + `SameSite=Lax` cookie; no cross-site form posts accepted with the cookie | Acceptable |
| Open redirects | No redirect is built from a URL parameter; post-sign-in targets come from the server | Good |
| Media | `/api/media/<table>/<id>` only serves allow-listed tables and fields; hidden pins are staff-only and never cached publicly | Good |
| Storage | `/api/partners/storage` private buckets require staff; only `project-media` with `public=1` is public | Good |
| Secrets | Server-only env vars; none sent to the client; reports contain none | Good |

## Fixed in this pass

| # | Severity | Finding | Fix | Evidence |
| --- | --- | --- | --- | --- |
| 1 | High (latent) | An account record with **no role** became `admin` at login and on every request (`role || 'admin'` in 3 places). No account lacks a role today (checked read-only: 15 buyer, 8 agent, 5 employee, 3 developer, 2 admin), so nobody was affected — but a bad import or a manual insert would have granted full admin. | New `lib/auth-role.ts` → `roleOrDefault()` defaults to `buyer`; used in `lib/auth.ts` (token + DB role) and `app/api/auth/login/route.ts` | `tests/listing-and-auth.test.ts` ("a missing role never grants staff access") |
| 2 | Medium | `POST /api/partners/fn/resolve-maps-link` is anonymous (the public intake form uses it) and makes the server fetch a Google short link — with no rate limit. Host allow-list already prevented SSRF to other hosts. | 30 requests/min per IP; input URL capped at 2,048 chars | Code review |

## Live probe (local production build, 20 Oct)

97 GET checks, three identities: anonymous, a token signed with a wrong secret, and a **correctly signed** `admin` token for an account id that does not exist.

- 22 privileged APIs (`/api/admin/*`, `/api/my/*`, `/api/partners/storage`): all refused — 401/403, or 400 for missing parameters before the staff check (storage). Private buckets re-checked: 401.
- 8 privileged pages (`/dashboard/*`, `/s-admin`): all redirect (307) to sign-in.
- `/api/auth/session` reports no user for all three identities.
- Anonymous `/api/db` reads of `leads`, `pins_history`, `users`, `contact_leads`: refused.

Raw results: `browser/auth-results.json`.

## Unresolved risks (need a decision)

| # | Severity | Risk | Recommendation |
| --- | --- | --- | --- |
| 1 | Medium | Sessions are stateless 60-day JWTs. Logout only clears the cookie on that device; a copied token keeps working until it expires. Changing or resetting a password does not sign out other devices. | Add a `session_version` field to `users`, put it in the token and compare it in `currentRoleOf()`; bump it on password change, reset and "sign out everywhere". Needs a small schema addition — proposed, not done. |
| 2 | Low | If the `users` lookup fails (DB blip), `currentRoleOf()` trusts the signed token's role for that request. A token still has to be genuinely signed, so this is a deliberate availability trade-off. | Keep, or fail closed for `admin` routes only. |
| 3 | Low | Rate limits are in-memory per server instance (documented in `lib/rate-limit.ts`). On several Vercel instances each enforces its own window. | Fine for brute-force braking; use a shared store (e.g. Upstash) if abuse appears. |
| 4 | Low | Admin "hide this field on the card" switches are display-only: the values are still in the public map data (`/api/db` pins). Today only status/type/key USP are hidden on 4 projects, plus RERA numbers in 6 hidden custom fields — all public information. The map needs some of them (status colours the marker). | Document in the admin UI that hidden fields are not secret; never put confidential notes in them. |
| 5 | Info | No security headers beyond Next defaults (no CSP, no `X-Frame-Options`). The home page embeds `/map` in an iframe from the same origin, so `frame-ancestors 'self'` would be safe. | Add `X-Frame-Options: SAMEORIGIN` / CSP `frame-ancestors 'self'` in `next.config.mjs` after testing the home-page embed. |

## Not tested (and why)

- Signed-in flows (login, logout, session expiry, role switching, admin edits, developer edits): **no test accounts** were available, and creating one would be a production database write. Covered only by code review and the existing automated tests (`tests/api-*.test.ts` use an in-memory database).
- Write-path authorization against the live build: not sent, to avoid any chance of modifying production data. Verified by code review of every mutating handler.
- Dependency vulnerabilities: `npm audit` not run in this pass (network/registry dependent) — see REMAINING-ISSUES.
