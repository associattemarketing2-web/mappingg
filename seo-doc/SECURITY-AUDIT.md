# Mappingg — security audit (22 Nov 2026)

Defensive and non-intrusive. The work was:
- a source-code review
- `npm audit`
- `curl -I` header checks
- anonymous **read** requests to the public `/api/db` endpoint, the same requests the live map makes

No writes, no brute-force attempts, no fuzzing and no authenticated testing were done. No secret values appear below; findings name only the location and the type of risk.

---

## Findings

### SEC-1 — High: known-vulnerable framework and dependencies
- **Evidence:** `npm audit --omit=dev` reports 24 issues: 1 critical, 18 high, 4 moderate and 1 low.
- **Production-relevant packages:**
  - **`next@14.2.35` (critical).** Advisories cover DoS through the image optimiser, DoS through RSC deserialisation, and request smuggling in rewrites. The app uses `rewrites()` in `next.config.mjs`.
  - **`nodemailer` (high).** SMTP command injection and wrong-domain delivery advisories.
  - **`zod` (high, memory exhaustion).**
  - **`undici` (high, DoS).**
- **Dev-tool chain:** most of the remaining highs come from `prisma@8.0.0-rc.19`. It pulls in a vulnerable `hono`, `@prisma/dev` and `lodash`, and is a release candidate.
- **Note:** the Next fix needs a major upgrade (15/16), which is a regression risk to the App Router code and the legacy bundles.

### SEC-2 — High: rate limiting does not hold on serverless hosting
- **Where:** `lib/rate-limit.ts` keeps counters in process memory. Its comment says "the app runs as a single Node server (see render.yaml)".
- **Hosting:** production runs on Vercel (`vercel.json`; responses carry `Server: Vercel`, `X-Vercel-Cache`).
- **Consequence:** each serverless instance has its own counters, and they reset on every cold start.
- **Routes that depend on it:**
  - login (`app/api/auth/login/route.ts:38`, 10 attempts per account per 15 min)
  - OTP send and verify
  - sign-up
  - password reset
  - contact and lead forms
  - the anonymous map-enquiry insert (`app/api/db/route.ts`)
- **Impact:** credential-stuffing and spam protection is much weaker than the code suggests.

### SEC-3 — Medium: anonymous queries on the public data API take query operators
- **Where:**
  - `app/api/db/route.ts`: `filterSchema` `val: z.unknown()`, `limit` up to 10,000, and any `columns`.
  - `lib/db-engine.ts` `buildQuery`.
  - `lib/mongo-compat.ts` `buildWhere`.
- **What is safe:**
  - SQL is fully parameterised (`p.key`, `p.add`, `p.json`), so there is **no SQL injection**.
  - Table access is allow-listed: anonymous `select` works only on `pins`, `infra_markers`, `roads`, `map_settings`, `infra_types` and `area_boundaries`.
  - `users`, `leads`, `posts`, `developers`, `pins_history`, `contact_leads` and `project_submissions` all return 401 (verified live).
  - The `hidden` filter is forced server-side.
- **What is not:** a filter value may be an operator object such as `{"$regex": …}`, `{"$ne": …}` or `{"$in": […]}`. Anonymous callers can therefore run arbitrary regexes and full scans on public tables.
- **Impact:** a CPU / DoS vector and arbitrary data shaping. Low data-exposure risk because the tables are public.

### SEC-4 — Medium: the public pin API exposes internal and admin-hidden fields
- **Evidence (anonymous `GET /api/db` on pins):**
  - Rows include `source`, `rejected`, `pending_review`, `hidden` and `intake_project_id`.
  - 4 public pins return fields the admin switched off through `field_visibility`: `status` ×2, `key_usp` ×2 and `type` ×1.
  - `lib/seo/project-meta.ts` `applyFieldVisibility` hides these fields on the SEO pages only.
  - The live map hides them only on the client.
- **Positive:** `brochure_url` is removed for non-staff (`withoutBrochureUrl`).

### SEO-adjacent SEC-5 — Medium: security headers are incomplete
- **Present:** `Strict-Transport-Security: max-age=63072000`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` and `Referrer-Policy: strict-origin-when-cross-origin`.
- **Missing:** `Content-Security-Policy`, `Permissions-Policy`, and `includeSubDomains` / `preload` on HSTS.
- **Leaking:** `X-Powered-By: Next.js` is sent (set `poweredByHeader: false`).
- **Mitigation already in place:** the Leaflet CDN tags carry `integrity` (SRI).

### SEC-6 — Medium: sign-up without verification while OTP is paused
- **Where:** `lib/otp.ts` `otpEnabled()` (`OTP_ENABLED` is not set in `.env`) and `app/api/auth/signup/route.ts:49-85` (`signup_method: 'password-no-otp'`).
- **Impact:**
  - Anyone can register any mobile number or email without proving they own it (number squatting).
  - Those unverified sign-ups are pushed to the CRM as leads (`addBuyerSignupLead`).
- **Positives:**
  - Staff roles cannot self-register.
  - Password reset still needs a code, and the code is bound to the current password hash, so it works only once.

### SEC-7 — Low: account enumeration
- `app/api/auth/reset-password/route.ts` returns 404 "No account found with this email" (or the mobile equivalent).

### SEC-8 — Low: blog HTML is rendered without sanitising
- `app/blog/[slug]/page.tsx:92` renders `post.content` with `dangerouslySetInnerHTML`.
- Only staff can write posts, so this is stored XSS only if a staff account is compromised.

### SEC-9 — Low: the Maps resolver follows redirects
- `lib/maps-link.ts:29-33` checks the first host against the Google short-link allow-list and then fetches with `redirect: 'follow'`. Later hops are not re-checked.
- Risk is low because the starting hosts are Google-owned, and the endpoint is rate-limited (but see SEC-2).

### SEC-10 — Low: keys in the repository
- **Our key:** the browser Google Maps key ships in `public/legacy/team-editor.json`. It is the same key as `NEXT_PUBLIC_GOOGLE_MAPS_KEY` (matched by hash), so it is public by design. Confirm in Google Cloud that it has HTTP-referrer and API restrictions.
- **Third-party keys:** `data/pune-research/cache/*.bin` (14 committed files) contain other sites' Google API keys from scraped pages. They are not ours, but they should not be in the repo.
- **`.env`** is not tracked: `git ls-files` shows only `.env.example`, and that file holds placeholders only.

### SEC-11 — Info: session design
- **Token:** HS256 JWT in an `httpOnly`, `Secure` (production), `SameSite=Lax` cookie. It lives 60 days (`lib/auth.ts`).
- **Revocation:** the role is re-checked against `users` every 2 minutes, so deleting an account or changing a role takes effect within 2 minutes.
- **CSRF:** relies on SameSite=Lax plus JSON bodies. That is acceptable, but there is no token. The 60-day lifetime is a policy choice.

---

## Controls verified as in place
- Passwords are hashed with bcrypt at cost 12, and a hash compare always runs so login timing does not reveal accounts (`app/api/auth/login/route.ts`).
- Every `/api/admin/*` route checks `hasPermission` / staff (verified by reading each route file). Each `/api/my/*` and subscription route uses `requireAccount`/`requireOwner`.
- Webhooks are authenticated:
  - Razorpay: signature verification
  - Meta: signature check plus challenge
  - WhatsApp: shared secret with `timingSafeEqual`
  - Cron: `CRON_SECRET` with `timingSafeEqual`
  - Google Ads: shared key
- Developer API keys are bearer tokens checked in `lib/api-platform/handler.ts`.
- Writes from developers are scoped to `owner_user_id` and forced to `pending_review`.
- `robots.txt` and `X-Robots-Tag` keep the dashboards, intake and partner pages out of search.
- HTTP redirects to HTTPS, and HSTS is set.

## Score

The score is 68/100. Each area had a fixed weight and earned points from the evidence above.

| Area | Weight | Points earned | Main reason |
| --- | --- | --- | --- |
| Authentication and sessions | 20 | 15 | Sound design; unverified sign-up (SEC-6); enumeration (SEC-7) |
| Authorisation and data access | 20 | 15 | Guards on all admin routes; SEC-3, SEC-4 |
| Input validation and injection | 15 | 12 | zod plus parameterised SQL; operator filters; unsanitised blog HTML |
| Abuse protection (rate limits) | 10 | 3 | SEC-2 |
| Dependencies | 15 | 6 | SEC-1 |
| Transport and headers | 10 | 7 | HSTS, nosniff and XFO present; no CSP; X-Powered-By |
| Secrets handling | 10 | 10 | No committed secrets; public key is intended |
| **Total** | **100** | **68** | |
