# Onboarding v2: STOP reports

Running gate record for `PROMPT-ONBOARDING-V2.md` (in this folder). The baseline is `extraction-2026-09-25.md`.

The owner said "go through all gates" (25 Sep 2026). Each STOP below is therefore a record, not a pause. The GATE A decisions stand as recommended, except where §13 of `gate-a-proposal.md` marks an item **PROVISIONAL**, meaning it waits on the CSO or the lawyer.

---

## STOP 0: discovery and baseline

### Where the work lives
- **Where the onboarding code is.** The current onboarding code (what production runs) is **uncommitted** in the main tree, on `feat/doctor-workspace` at `c555aaf`. `main` (`1728b2a`) is far behind, so it is *not* identical. Cutting from `main` would roll back production.
- **Worktree.** v2 is built in a separate worktree, `/Users/airm1/Desktop/medsync-onboarding-v2`, on branch `feat/onboarding-v2`. Another Claude session and a `next dev` are live in the main tree, so a separate worktree avoids collisions.
- **Baseline commit.** The worktree's first commit, `a7b784a`, is a snapshot of the main tree's uncommitted state (production parity). `.env.example` is excluded (owner rule). Tag: `onboarding-v2-baseline`. The v2 diff is `onboarding-v2-baseline..feat/onboarding-v2`.
- **Package manager.** The repo uses **npm**, not pnpm (`package-lock.json`; `.nvmrc` = 24). The repo wins.

### Q1–Q20

| Q | Finding |
|---|---|
| Q1 | Hand-written SQL in `supabase/migrations/`, applied by `scripts/migrate.ts` (tracked in `_medsync_migrations`). **The next free number is 0070.** Production has applied up to `0069` (checked read-only). Tests have **no PGlite**: the DB suites hit the live project behind `MEDSYNC_ALLOW_RLS_DB_WRITES=1`. **pg_trgm and PostGIS are available but not installed** in production. |
| Q2 | Supabase Auth (GoTrue, bcrypt, so a **72-byte** ceiling; Zod counts UTF-16 units, not bytes). Each action calls `signUp` on the cookie client and rolls back with `auth.admin.deleteUser` (best effort). Uploads already in storage are orphaned on rollback, and a failed affiliation insert is not rolled back. `public.users` mirrors email on insert only. Nothing looks a user up by email through the admin API. |
| Q3 | Pages are `app/signup/{patient,clinical,non-clinical,hospital}/page.tsx`, with `_components/form.tsx` and `actions.ts`. Hospital: `_lib/schema.ts` + `_lib/catalog.ts`. Primitives: `components/forms/*` (MultiStepForm, CascadingCombobox, Combobox, PhoneInput, AvatarUpload, FileUpload, ConsentCheckbox, Field). **Only the hospital form shares its Zod schema** client/server; the other three are server-only. |
| Q4 | Geography columns: `patient_profiles.district_id` (NOT NULL) and `subcounty_id`; `hospital_applications.district_id` (NOT NULL), `subcounty_id` and `region_id`; `hospital_leads.district_id` (NOT NULL); text columns `hospitals.region` and `hospitals.district` (only the Mulago seed sets them); `emergency_contacts.district` (text, matched by name). **Nothing reads patient geography.** The admin approval cards read the application's geography. Emergency contacts read `hospitals.district`. Failing checks written first: the PGlite probes "Eastern + Arua stored as Northern" and "Western + Gulu stored as Northern" (red on the baseline schema; green after 0070). |
| Q5 | Every router and scope keys on **cadre code, grade code or `is_clinical`**, never on role code or `department_family`. Generic per-cadre roles are safe; migration 0017 already added nine of them. |
| Q6 | 20 cadres (19 + RECEPTION) and 9 grades on 4 cadres. **"Specialist Nurse" is both a cadre and a NURSE grade** (`lib/nurse/scope.ts:151` reads either). Root cause of the Grade "Loading…": the placeholder is `cadreGrades.length === 0 ? "Loading…"`, and 16 of 20 cadres have no grades, so it never resolves. Covered by `tests/onboarding-v2/schemas.test.ts` (O11: no council, grade or role key) and `staff.test.ts` (no grade or role picker in the clinical form). |
| Q7 | `approve-hospital-application` jumps straight from `pending_approval`/`under_review` to **`agreement_signed`**. It reuses the DPA accepted in the form, copies it into `hospital_agreements`, creates the hospital (`provisioning`), creates `hospital_departments` from the application, and grants hospital_admin. **Nothing sets `verified` or `under_review`.** The setup wizard (`/admin/setup`) is **not linear**: six steps on one page, done-state derived from data. Go-live calls `sa-activate-hospital`, which needs a superadmin, so a hospital admin gets 403 (pre-existing). |
| Q8 | **The validated catalogues JSON does not exist** anywhere (14 levels / 7 ownership / 21 roles). `docs/booking-app-gate-a-proposal.md:52` had already recorded that. The form shows the 8 / 4 / 6 lists in `_lib/catalog.ts`. **Ask Fadhul for the JSON.** Until then v2 keeps 8 / 4 / 6 and adds nothing invented. |
| Q9 | The patient `/patient/profile` edits phone, village, language, conditions, next of kin and photo. `/patient/hospitals` sets the usual hospital. **ID and title can't be edited after signup.** Staff: only `/doctor/profile` (photo). **No surface lets a clinician add a licence after signup.** |
| Q10 | `approve-staff-affiliation` checks state and scope, **not the licence**. Both UIs (hospital-admin staff sheet and `/admin`) go through it, so one guard there covers both. The super-admin review is `app/admin/page.tsx` (evidence rows) plus `detail-sheet.tsx` (a flag pill, sniffed from "⚠" in the subtitle). |
| Q11 | **Nothing sends email or SMS** on approval or rejection. Copy that promises one: hospital-pending "We'll email …" and "we'll notify you by email"; clinical-pending "You'll be emailed …", "We'll email you …" and "notify you by email"; the clinical form "we'll prompt you to re-upload before it lapses". All are removed in v2. |
| Q12 | `hospital_staff_invitations` + `ha-invite-staff` issue `/signup/clinical?invite=<token>`, and **nothing reads `?invite=`**. ⚠ **Security gap (out of scope, flagged):** a *staff* invite token claimed at `/admin/claim-invitation` makes the invitee a **hospital admin** (`accept-hospital-admin-invitation` ignores `invited_role_id`). |
| Q13 | `submitHospitalLeadAction` inserts into `hospital_leads` (0014; RLS: insert anon/auth, read superadmin). **No UI calls it and nothing reads it.** Production has 0 leads. |
| Q14 | Env-boolean flags in `lib/*/feature.ts` (`import "server-only"`). `DOCTOR_WORKSPACE` also takes hospital ids. There is no flag table. |
| Q15 | **No Playwright, no Lighthouse** (Law 11: flagged; nothing added). `axe-core` is present. Stand-ins without new dependencies: the local harness `onboarding-v2-harness/` drives headless Chrome over raw CDP (screenshots, axe, timings) and replays every migration in PGlite (triggers, RLS probes), the same method as the resus v2 and doctor workspace gates. Lighthouse scores are replaced by axe + CDP timings + first-load JS; this is recorded as a deviation. |
| Q16 | Field errors use **red** (`--destructive #DC2626`, `aria-invalid:border-destructive`), and the **required asterisk is red** (`components/forms/field.tsx:61-66`). This conflicts with Law 9 and with DESIGN-medsync.md's own red-scarcity rule (DESIGN:124 vs DESIGN:254). v2 resolves it **locally** in the new kit (amber + icon + text; no asterisk) and leaves the shared `Field`/`Input` untouched, so other surfaces don't change. `SectionNumber` is plum (ADR 0097). Plum never marks a selected control. |
| Q17 | The Emergency affordance on `/signup/*` and `/onboarding/*` is the **floating pill** (`components/emergency/emergency-pill.tsx`, fixed bottom-right, about 150×48 px). **At 360 px it overlaps** the right ~45% of any full-width button passing through the bottom 64 px. `/get-started` and `(auth)` use the **header** button. v2 moves signup and onboarding to the header pattern (`data-emergency-inline` hides the pill). |
| Q18 | Buckets `clinician-licences`, `hospital-authorisations` and `staff-identity-documents`: private, 5 MB, pdf/jpeg/png, owner-folder INSERT policies `(foldername)[1] = auth.uid()`. `avatars`: 2 MB. `serverActions.bodySizeLimit = 10mb`, but **Vercel caps a function body at 4.5 MB**, so two 3 MB documents inside the form post fail in production. **No client-side compression.** Rate limiting: only ad hoc row-count windows in edge functions; nothing generic. |
| Q19 | Production, counted read-only: **patients 8** (7 with test-style emails); clinicians 8 (6 with licence); staff identity 1; affiliations 9 (8 approved, 1 active); hospital applications 5 (4 `agreement_signed`, 1 rejected); hospitals 5; leads 0; districts 21. **One application is saved as Kampala + Western**, so O3 is live in production data. Patients use Kampala (7) and Wakiso (1) only. |
| Q20 | **UBOS units:** OCHA COD-AB Uganda v01 (UBOS boundaries, valid 2020-08-24, CC BY-IGO): 4 regions, 135 districts, 203 counties and 1,520 sub-counties, with polygons and pcodes. **No parishes or villages.** It predates the July 2020 cities, which appear as "<X> Municipality" inside their district. geoBoundaries was checked (ADM4 = 1,521 sub-counties, UNHCR 2019); COD-AB was chosen for UBOS pcodes and one source for names and polygons. **Facility registry:** the NHFR public list API (`/api/v1/facilities/public`), 6,801 facilities (Gov 3,535, PNFP 1,013, PFP 2,253), fetched 2026-09-25. **Registry coordinates are almost absent (2 of 6,801) and contacts are almost absent (10 of 6,801).** |

### Baseline counts (from the extraction, checked against the code)

| | Patient | Clinical | Non-clinical | Hospital |
|---|---|---|---|---|
| Continue presses | 2 | 3 | 0 | 6 |
| Inputs shown by default | 18 | 16 | 15 | 48 |
| Required inputs | 12 | 11 | 10 | 30 |
| Dependent pickers | 2 (district → sub-county) | 4 (council → cadre → grade/role; hospital → department) | 2 (cadre → role; hospital → department) | 2 (district → sub-county; IM toggle) |
| Taps to finish council → role | — | 8 (4 pickers × open + choose) | 4 (2 single-option pickers) | — |

First-load JS, axe, screenshots and scripted time are in `baseline/` (filled when the baseline build finishes; see below).

### Failing tests written at STOP 0 (red at baseline, green by STOP 5/6)
These were written against the v2 APIs, so they failed at baseline (the modules and columns did not exist). They live in:
- `tests/onboarding-v2/schemas.test.ts`: O11 (no grade or role keys), O13 via `staff.test.ts`, O15/S4 (a 17-year-old is refused), O16 (the officer contact is format-checked, needs at least one channel, and isn't the applicant's).
- `tests/onboarding-v2/engines.test.ts`: O3 at the engine (every place derives its region; Arua is Northern).
- The PGlite probes (`onboarding-v2-harness/pg/probe.mjs`): O3 in the database (Eastern + Arua and Western + Gulu stored as Northern).

### Prompt ↔ repo differences
1. **Package manager:** npm, not pnpm.
2. **No Playwright or Lighthouse:** CDP + axe harness instead (Q15).
3. **Validated catalogues JSON:** absent (Q8). v2 keeps the current lists.
4. **"The lifecycle already puts `agreement_signed` after `verified`":** only on paper. The code never sets `verified` (Q7).
5. **Registry coordinates:** absent, so facility location always comes from the device in the setup checklist.
6. **Dataset:** no parish or village level. The lowest searchable level is the sub-county, and village or cell stays free text.
7. **District-level units:** 135 in the dataset vs 146 counted in the extraction. The 11-unit difference is the post-2020 cities and districts (e.g. Terego). Cities are reachable by name through "<X> Municipality".
8. **The setup wizard is not linear**, so the checklist *extends* it rather than replacing it.
9. **Tests don't run against a local database;** RLS and trigger probes run in the PGlite harness.
10. **`registration_number`, `physical_address`, `institutional_email_domain` and `applicant_role` are NOT NULL** on `hospital_applications`. v2 relaxes only `registration_number` (government facilities have no licence number) and derives the others.

### Baseline measurements (25 Sep 2026, `next build` of the baseline tree; harness `onboarding-v2-harness/baseline/`)

**First-load JS (gz):**

| Route | kB |
|---|---|
| `/signup/patient` | 313.3 |
| `/signup/clinical` | 313.3 |
| `/signup/non-clinical` | 313.1 |
| `/signup/hospital` | 381.8 |
| `/get-started` | 239.0 |
| `/onboarding/*-pending` | 236.6 |
| `/admin/setup` | 313.9 |
| `/patient/profile` | 316.1 |

**axe (390 px, first step):**
- patient: `label` ×2 (critical), `page-has-heading-one`;
- clinical: `label` ×1 (critical), `page-has-heading-one`;
- non-clinical: `select-name` ×5 (critical);
- hospital: `nested-interactive` ×3 (serious), `page-has-heading-one`;
- get-started: clean.

**Screenshots:** 360×740, 390×844 and 1440×900 for every form, plus the patient form in dark, are in `baseline/shots/`.

**Emergency:** the floating pill is present on every `/signup/*` route (Q17).

---

## STOP 1: GATE A

`gate-a-proposal.md` was written and signed by the owner's "go through all gates" (25 Sep 2026).

**PROVISIONAL (CSO/lawyer):**
- the under-18 message;
- the three consent summary lines;
- D9's AHPC scope;
- D19 (a staff-verification purpose in the notice).

**Owner action:** send the 14/7/21 catalogue JSON (Q8).

---

## STOP 2: engines and data

**Import reports:**
- **Geography:** 4 / 135 / 203 / 1,520 (matches the dataset's stated counts); 0 orphans; 0 duplicate codes; vintage 2020-08-24 v01.
- **Legacy mapping:** 20 of 21 districts by exact name; Fort Portal retired; 5 Kampala divisions mapped by name.
- **Registry:** 6,801 rows, 99.54 % matched to a district (31 unmatched, all Terego), 74.9 % to a sub-county. Clinic (432 rows) is unmapped and stored as `private`/`other`.

**SQL probes, harness `pg/probe.mjs` (PGlite, all 71 migrations): 77/77.**
- LOC-1: Eastern + Arua stored as Northern; Western + Gulu on update stored as Northern.
- LOC-4: both directions refused.
- LOC-9: the production-style Kampala + Western recomputed to Central; legacy ids kept.
- LOC-10: 135 / 1,520 with pcodes.
- PRO-1: 21/21 against the seed.
- D12 refugee ID; DOC-2 `documents_complete` for government and for private; `facility_source` and note-length checks; the short lead.
- RLS: `facility_locations` and `onboarding_events` for anon, patient, same-hospital staff, other-hospital staff, hospital admin and superadmin, covering SELECT counts and denied INSERT/UPDATE/DELETE.
- EV-1: a value can't ride in `error_code`.

**Engine tests (vitest, `tests/onboarding-v2/engines.test.ts`, `schemas.test.ts`):** LOC-1/2/5/6, REG-3/6, PRO-1/4, D11, §5.12 field rules, and the schema rules (O3 no region key, O5, O7, O10, O11, O12, O14, O15/S4, O16, S7, S9, S10).
- Search p95 < 150 ms and reverse geocoding p95 < 200 ms warm are both asserted; measured values are milliseconds and single-digit milliseconds.
- **LOC-7** (`privacy-and-retry.test.ts`): logger, console, fetch and service-client spies see no coordinate. The logger PII list and Sentry `request.data` were hardened.

**Rate limiting:** an in-memory, per-instance fixed window keyed by a salted hash of the IP. The raw IP is never stored. This is a ponytail choice: the ceiling applies per instance.

---

## STOP 3: form kit

**Components (`components/onboarding/`):**
- SectionedForm (sections, progress bar/rail with the plum place dot, error summary, session draft, idempotent submit, offline retry, funnel events);
- SearchField (ARIA 1.2 combobox);
- LocationField (search + "Use my location" + offline districts);
- ProfessionField;
- the three-box date input (MemorableDateInput);
- PhoneField (0772… → E.164);
- EmailField (typo hint);
- PasswordField;
- DocumentField + DocumentUploadNow (camera, on-device JPEG re-encode ≤ 1600 px, "Add it later", signed-URL upload);
- ConsentBlock;
- LeadDialog.

**Checked in headless Chrome** (harness `cdp.mjs`, dev server, patient form):
- S1: mocked GPS ± 25 m at Mulago resolves to Kawempe Division and reveals the village field.
- S2: "Arua" gives Arua District · Northern region first, and no region control exists.
- S4: DOB 7 3 2010 replaces the submit with the under-18 message.
- S12: offline banner, all 14 inputs kept, reload restores the draft without the password.
- S13: "0772 123 456" shows as 772 123 456 and is stored as +256772123456 by the server.
- S15: no fixed element on the page; the only red is the header Emergency button.
- The empty-submit summary lists every problem at once (Zod refinements run even when fields fail).
- axe: 0 violations at 390 px.

**Copy and colour invariants** (`copy-and-colour.test.ts`): no email/SMS promise, no cadre/affiliation/tenant, patient copy grade ≤ 8, no red tokens, no green ticks, no asterisks, no left-edge bars in any v2 file.
