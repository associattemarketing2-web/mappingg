# "Edit all details" — every project opens in the full Projects Intake form

Requested on 20 Oct: wherever a project is opened in s-admin (Map Editor pin, Developers tab, Developer projects), its edit screen must show **all** the options the Projects Intake review form has. Status: **built and tested in code; not yet clicked through in a browser** (needs a staff login — see "How to test").

## How it works

There is one complete form — the Projects Intake review form (`public/partners`, fields defined once in `shared/fields.js`: basics, location, price & configuration, timeline & RERA, highlights & media, additional details, content & SEO, project size, amenities & green, sales contact, verification & publishing). Instead of copying ~60 fields into three other editors (which would drift apart), every "Edit all details" button opens that form for the project:

| The project is… | What "Edit all details" opens |
| --- | --- |
| A pin published from Projects Intake (≈740) | Its existing intake submission |
| Any other pin (manual / developer-submitted, ≈230) | A new **In review** submission prefilled from the pin and linked to it (`source_pin_id`). A second click opens the same one. **Opening it changes nothing on the map.** |

Press **Publish** in that form and the **same pin** is updated — same number, same page URL, same pin size, highlight, card visibility switches and custom fields.

## Where the buttons are

- **Map Editor** → open a project pin → **Edit all details** in the panel header (project pins only, not roads/infrastructure). Inside s-admin it switches to the Projects Intake tab and opens the form; opened on its own, the form opens in a new browser tab. It uses the *saved* pin details — save sidebar edits first.
- **Developers** tab → a developer → **Edit** on any project row, or **Edit all details** in the project view.
- **Developer projects** tab (super admin) → **Edit all details** on each row and in the review drawer (the old smaller form is still there as **Quick edit**).

Staff without the Projects Intake tab get the form in a new browser tab.

## Safety rules for pins that were not from intake

Prefilling only moves values the form can hold **exactly**:

| Pin value | Goes into | If it can't be held exactly |
| --- | --- | --- |
| "₹ 1.25 Cr Onwards", "₹ 92 – 139 L", "Price on Request" | Price fields | e.g. "₹ 98 Lacs – ₹ 1.35 Cr", "Only for leasing" → listed as **Price (as on the map)** under Additional details and **kept on the pin** |
| "2 BHK / 3 BHK", "2, 3 BHK & Shops", "Plot" | Configuration ticks | anything else → **Configuration (as on the map)**, kept |
| "Dec 2027" | Possession / launch month | "Ready", "Q4 2027" → listed, kept |
| "1,050 – 1,450 sq ft" | Carpet area | anything else → listed, kept |
| RERA number(s) | RERA tags (slashes inside ids kept) | non-numbers (e.g. "LAUNCHING-SOON") → listed |
| Status, name, developer, type, location, lat/lng, USP, description, video, highlighted | Matching fields | — |
| Uploaded pin photo | (no field) | kept on the pin unless a cover image is uploaded in the form |

On Publish, any field left empty in the form **keeps the pin's current value** (only for pin-opened submissions — normal intake publishing is unchanged). The "Price" and "Configuration" publish checks accept a value carried over "(as on the map)", so editing, say, the description does not force re-typing a price the form cannot represent.

Note: **Publish makes the project live** (as it always has in intake). For a developer's project that is still pending approval, publishing from the full form makes it live without the "project approved" entry that the Developer projects **Approve** button writes to the developer's activity log — so approve there first, then use Edit all details.

**Deleting**: once such a submission has been *published*, deleting it in Projects Intake also deletes its map pin (the same rule intake already applies to its own projects; the pin goes to Backups → Recycle bin and can be restored). Deleting an unpublished one only removes the submission.

## Files

- `lib/pin-to-intake.ts` (new) — pin → submission mapping and the "keep pin values" rule (pure functions).
- `lib/partners-engine.ts` — new admin action `admin_open_for_pin`; publish passes the linked pin and the keep rule.
- `lib/intake-pins.ts` — `syncProjectPin(..., { keepPinValues })`: keeps empty fields and the pin's own photo.
- `components/admin/fullEdit.ts` (new), `AdminApp.tsx` (opens the intake tab at the right form; listens to the Map Editor), `DevelopersPanel.tsx`, `DevProjectsPanel.tsx` (buttons).
- `public/legacy/team-editor.json` (Map Editor button), `public/partners/shared/fields.js` (publish checks), `admin/views/queue.js`, `review.js` ("Map pin" source label).

## Tests (all run, all pass)

- `tests/pin-to-intake.test.ts` — 8 tests: months, statuses, configurations, prices, areas, full mapping, keep rule, publish checks.
- `tests/pin-full-edit.test.ts` — 2 integration tests on an in-memory Postgres (never production): opening creates one linked submission and leaves the pin byte-for-byte unchanged; a second click reuses it; publishing updates the same pin #50 (no new pin), changes the edited name/USPs, keeps the unparseable price, launch text, own photo, custom fields, card visibility and pin size, and links the pin to its intake project.
- Full suite: 108 / 108 pass. Type-check, lint and production build pass.

## How to test (needs a staff login — please do this before deploying)

1. s-admin → **Developers** → any developer → **Edit** on a project. Expect: switches to Projects Intake, form opens with all sections, values prefilled; a toast says the form was created or opened.
2. Change only the **Short description**, press **Publish**. Expect: toast "Updated on the live map as pin #N"; on `/map?pin=…` the same pin shows the new description and the old price.
3. **Map Editor** → click a pin → **Edit all details** → same form. Click again → same submission (no duplicate in the review queue).
4. Try a pin with a mixed-unit price: Publish must stay enabled and the map price must not change.
