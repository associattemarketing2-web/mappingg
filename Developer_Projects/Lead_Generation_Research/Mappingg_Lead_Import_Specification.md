# Mappingg Lead Import Specification

**Status:** design only. Nothing has been imported and no code or database has been changed. Every step that writes data needs your separate approval.

## 1. How Mappingg stores leads today (from the code)

| Store | Written by | Shape (JSON `doc` in Postgres via `lib/mongo-compat.ts`) |
|---|---|---|
| `contact_leads` | `app/api/contact/route.ts`, `lib/signup-leads.ts` | `id, name, email, phone ("+91 9876543210"), subject, message, source, status, notes, account_id?, created_at, updated_at` |
| `leads` | live-map forms (`app/api/db/route.ts`, `app/api/my/enquire/route.ts`) | `id, pin_id, role, name, whatsapp, email, consent, source, status, notes, created_at, updated_at` |
| CRM statuses | `components/admin/AdminApp.tsx:701` | `new, contacted, site_visit, negotiation, won, lost`. **There's no do-not-contact status** |
| External CRM | `lib/crm.ts` → B2BBricks webhook | Only fires from the website routes. A direct import would **not** reach B2BBricks |

**Recommendation:** import external leads into `contact_leads` (the general CRM list) with `source` set to the provider. Also keep the full provenance and consent block below in the same document. Existing screens ignore the extra keys, so nothing breaks.

## 2. Import pipeline (no production writes until the final, approved step)

1. **Receive:** save the provider's CSV/XLSX to `Buyer_Leads/imports/<provider>_<YYYY-MM-DD>/raw/`. That folder is git-ignored and never edited.
2. **Map:** convert it to the standard columns in §3 with a local script. Unmapped provider columns go into `extra_json`.
3. **Validate (dry run):** apply the rules in §4–§7 and write `validation_report.xlsx` with these sheets: Accepted, Rejected (with reason), Duplicates, Suppressed, Consent review.
4. **Review:** a person checks the report and the consent evidence. A sample of consent records is checked against the provider's proof.
5. **Approve:** you sign off the batch (batch ID, row counts, consent basis).
6. **Load (separate approved task):** insert only Accepted rows, in one transaction, tagged with `import_batch_id`. Before loading, take a backup snapshot. A batch can be rolled back by deleting rows with its `import_batch_id`.

## 3. Standard column mapping

| Standard column | Required | Rule | Maps to `contact_leads` doc | Meta Lead Ads | Google lead form | Portal export (typical) |
|---|---|---|---|---|---|---|
| `source_lead_id` | Yes | Provider's own lead ID, kept verbatim | `source_lead_id` | `id` | `lead_id` | enquiry/response ID |
| `name` | Yes | Trim; keep as given; do not "fix" | `name` | `full_name` | `FULL_NAME` | Name |
| `phone_raw` | Yes | Verbatim from provider | `phone_raw` | `phone_number` | `PHONE_NUMBER` | Mobile |
| `phone` | Derived | §4 normalisation → `+91 XXXXXXXXXX` (same format as `lib/phone.ts`) | `phone` | n/a | n/a | n/a |
| `email` | No | Lower-case; basic format check | `email` | `email` | `EMAIL` | Email |
| `city` | Yes | One of: Pune, Mumbai, Thane, Navi Mumbai, Kalyan-Dombivli (else reject as out of area) | `city` | custom Q | `CITY` / custom Q | City |
| `locality` | Recommended | Free text plus a `locality_match` against the target list | `locality` | custom Q | custom Q | Locality |
| `budget_raw` | Yes | Verbatim | `budget_raw` | custom Q | custom Q | Budget |
| `budget_min_cr` / `budget_max_cr` | Derived | Parse to crore (e.g. "1.5–2.5 Cr" → 1.5 / 2.5; "75 L" → 0.75); blank if unparseable | `budget_min_cr`, `budget_max_cr` | n/a | n/a | n/a |
| `bhk` | Yes | Normalise to `1 BHK`/`2 BHK`/`3 BHK`/`4+ BHK` (several allowed, `;`-separated) | `bhk` | custom Q | custom Q | Configuration |
| `timeline` | Yes | `0-3 months`, `3-6 months`, `6-12 months`, `12+ months`, `Just exploring` | `timeline` | custom Q | custom Q | often missing |
| `project_interest` | No | Project / listing name | `project_interest` | ad/form name | campaign/asset | Listing title |
| `source_name` | Yes | e.g. `Meta Lead Ads`, `Google Lead Form`, `99acres`, `Website` | `source` (+ `source_name`) | constant | constant | constant |
| `source_campaign` / `source_url` | Recommended | Campaign, ad set, form ID, listing URL | `source_campaign`, `source_url` | `campaign_name`, `form_id` | `campaign_id`, `form_id` | listing URL |
| `enquiry_at` | Yes | ISO 8601 with timezone; reject future dates | `created_at` and `enquiry_at` | `created_time` | `lead_submit_time` | Date |
| `consent_call` | Yes | `yes` / `no` / `unknown`. **`yes` only if an unticked call-consent box was actively ticked** | `consent.call` | consent checkbox answer | custom Q (verify) | usually `unknown` |
| `consent_whatsapp` | Yes | Same rule; **separate from call consent** | `consent.whatsapp` | separate checkbox | custom Q | `unknown` |
| `consent_sms` / `consent_email` | No | Same rule | `consent.sms` / `consent.email` | checkbox | n/a | `unknown` |
| `consent_text` | Yes if any consent = yes | Exact wording shown to the person, including the business name (e.g. "Associatte / Mappingg") | `consent.text` | disclaimer text | form text | n/a |
| `consent_version` | Yes if any consent = yes | Version label of that wording | `consent.version` | form version | form version | n/a |
| `consent_captured_at` | Yes if any consent = yes | Timestamp of the tick (usually equals `enquiry_at`) | `consent.captured_at` | `created_time` | submit time | n/a |
| `consent_source` | Yes | Where consent was captured: platform + form ID | `consent.source` | `Meta form <id>` | `Google form <id>` | `99acres terms` |
| `consent_evidence_ref` | Yes if any consent = yes | Pointer to proof (form screenshot file, export file and row) | `consent.evidence_ref` | n/a | n/a | n/a |
| `dnd_status` / `dnd_checked_at` | Before any call | Result and date of the TRAI DND / telecom-provider scrub done through an authorised method | `dnd.status`, `dnd.checked_at` | n/a | n/a | n/a |
| `import_batch_id` / `imported_at` | Derived | e.g. `META-2026-10-20-01` | same | n/a | n/a | n/a |
| `extra_json` | No | Any unmapped provider fields | `extra` | n/a | n/a | n/a |

Always set on import: `status: "new"`, `subject: "Imported enquiry — <source_name>"`, `message`: a one-line summary (BHK · budget · locality · timeline), and `notes: ""`.

## 4. Phone normalisation (no guessing)

1. Strip spaces, dashes, brackets and dots.
2. Drop a leading `+91`, `91` (when 12 digits) or `0` (when 11 digits).
3. Accept only **10 digits starting with 6–9**. Anything else is rejected with reason `invalid_phone`. **Never add, remove or correct digits.**
4. Flag placeholders (7+ repeated digits, `9876543210`, `1234567890`) as `suspect_placeholder`. They are rejected.
5. Store `+91 XXXXXXXXXX`. A valid format does **not** mean the number is active. Only mark `phone_verified=true` after an authorised check (e.g. an OTP the person completed on the form, or an actual connected call).

## 5. Duplicate detection

| Check | Key | Action |
|---|---|---|
| Within the batch | normalised `phone` | Keep the newest `enquiry_at`; merge non-empty fields; list the others on the Duplicates sheet |
| Against existing CRM | `phone` vs `contact_leads.phone` and `leads.whatsapp` (normalised) | Don't create a new lead. Report "existing lead" with its ID; a person decides whether to add a note to it |
| Same provider lead twice | `source_name` + `source_lead_id` | Skip silently (idempotent re-runs) |
| Fuzzy | same email, or same name + same locality within 7 days | Flag for review only; never auto-merge |

## 6. Qualification (sets `qualification_status`)

| Status | Rule |
|---|---|
| **Qualified – call-ready** | Valid phone, city in scope, `budget_min_cr ≥ 1.0`, BHK in {1,2,3}, timeline ≠ `Just exploring`/blank, `consent_call = yes` with text + timestamp + source, DND scrub done, not suppressed |
| **Qualified – WhatsApp only** | As above, but `consent_call ≠ yes` and `consent_whatsapp = yes`. Contact on WhatsApp only, e.g. to ask whether they want a call |
| **Below budget** | `budget_min_cr < 1.0`. Keep, but report separately from the ₹1 Cr+ target |
| **Incomplete** | Missing budget, BHK, timeline or city |
| **Consent review** | Consent unknown / pre-ticked / bundled / provider terms unclear |
| **Rejected** | Invalid phone, out of area, agent/developer/channel partner (self-declared or known), test data, suppressed |

## 7. Opt-out and do-not-contact suppression

- Keep a **suppression list**: `suppression.csv` locally now, and a `do_not_contact` collection or flag later (a future code change). Columns: `phone` (normalised), `reason` (opt-out, wrong number, complaint, DND without consent), `channel` (all/call/whatsapp/sms), `requested_at`, `source`.
- Every import checks the suppression list **before** dedupe, and suppressed rows never load.
- Opt-outs from any channel (STOP reply, a request on a call, an email) go on the list within 24 hours and apply to the channel they name. If no channel is named, they apply to all.
- Future code change (not done): add `do_not_contact` and per-channel consent fields to the CRM UI, and add `consent` (channels, wording version, timestamp) to the website forms. That also fixes the pre-ticked map checkbox and the hardcoded `consent: true` found in the Buyer_Leads audit.

## 8. Import validation checklist

- [ ] Row count in = Accepted + Rejected + Duplicates + Suppressed + Consent review
- [ ] No Accepted row without `phone`, `city`, `source_name`, `enquiry_at`
- [ ] No row marked call-ready without `consent_text`, `consent_version`, `consent_captured_at`, `consent_source`
- [ ] No duplicate `phone` among Accepted rows or against the existing CRM
- [ ] No suppressed number among Accepted rows
- [ ] All dates parse, and none are in the future
- [ ] Sample of 20 rows (or all, if fewer) checked against the raw provider file
- [ ] Provider's consent wording and a screenshot of the form stored with the batch
- [ ] Batch approved by you before load; backup snapshot taken; rollback key = `import_batch_id`

## 9. Data handling

- Raw files and reports stay in git-ignored `Buyer_Leads/imports/`. Never commit them, and never upload them to third parties or ad platforms (e.g. as custom audiences) without a lawful basis and your approval.
- Delete raw provider files after load + 90 days, or as the provider's contract requires.
- Keep consent evidence as long as the lead is used, plus whatever limitation period your lawyer advises.
