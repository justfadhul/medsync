# Changelog

All notable changes to MedSync are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning will follow [SemVer](https://semver.org/spec/v2.0.0.html) once we tag.

## [Unreleased]

### Changed — The doctor's calendar: bands behind, white cards on top — 2026-09-27

No migration, no Edge Function, no data change. `/doctor/schedule` (and the styleguide calendar).

- **Two layers.** Availability draws as a faint background band with its kind chip; bookings and clinic days are white cards, side by side where they overlap. Colour lives only in chips, from one map (`components/scheduling/calendar/tones.ts`); red only for an urgent booking.
- **Grid.** Today's column and date disc, a teal now line with the time in the gutter, `EAT · UTC+3`, hours that stretch to take in any event (a booking outside 07:00–20:00 was not drawn before).
- **Toolbar.** Underline view tabs, ⌘F search, Availability plus **Set availability** as the one primary; one day with a week strip under 1024px; the rails go under the calendar below 1280px.
- **Deliberate calls:** teaching and admin share grey, leave and unavailable share the hatch (icon and word tell them apart); a cancelled booking recedes by a muted fill and dashed edge, not opacity, to keep 4.5:1.

### Changed — MedSync Chroma is the design system — 2026-09-26

[ADR 0162](docs/adr/0162-medsync-chroma-design-system.md). No migration, no Edge Function. `DESIGN-medsync.md` is rewritten for Chroma; `/styleguide` is the new visual contract.

- **Colour that places.** Cool `ink-*` ground; teal the one action colour; one hue per hospital domain (Patients sky, Clinical iris, Pharmacy & lab grape, Operations plum, Admin slate) on tiles, sidebar items, tags, avatars and record bands; red, amber and green for the patient's clinical state only. Tokens generated from the Chroma `tokens.json`; `gray`/`brand`/`mint` remain as aliases.
- **Type.** Bricolage Grotesque replaces Fraunces for marketing headlines, page titles and the wordmark; Geist carries every product heading at 600; a denser scale.
- **Components.** New DomainTile, Tag, StatusPill, Avatar, Kbd, CommandBar (⌘K in every workspace), ViewSwitcher, RecordHeader, AttributeList, VitalStrip, ChromaBand; Button, Input, Card, Dialog, DataTable, StatCard, Panel, VitalStat rebuilt; every workspace sidebar rebuilt on one shared Chroma sidebar.
- **Workflow states are tags.** Invitation, staff, clinic-session and appointment states render as square tags in cool hues, never red, amber or green. Critical and caution chip text use the AA pair (approved by the owner/CSO with Chroma).
- **Mobile (Expo patient app):** Chroma ink, teal and sky tokens; Bricolage Grotesque replaces Fraunces (`@expo-google-fonts/bricolage-grotesque`); the mint CTA becomes the teal primary; appointment chips are tags; rating stars are ink.
- **Removed:** gradient tokens, the plum glow, decorative pulsing dots, the italic headline accent.

### Added — The EMR: one clinical record, dark behind `EMR_V1` — 2026-09-26

[ADR 0130](docs/adr/0130-clinical-fact-store-and-cfc-adoption.md), [0131](docs/adr/0131-rls-identity-propagation.md), [0132](docs/adr/0132-encryption-boundary-and-note-hmac-key.md), [0133](docs/adr/0133-database-runtime-and-the-pglite-lane.md), [0134](docs/adr/0134-the-note-model.md), [0135](docs/adr/0135-allergy-record-single-source.md), [0136](docs/adr/0136-results-acknowledgement-and-critical-results.md), [0137](docs/adr/0137-coding-and-terminology-licensing.md), [0138](docs/adr/0138-fhir-r4-projection.md), [0139](docs/adr/0139-encounter-completion-and-administrative-closure.md) (owner and CSO signed every GATE A decision as recommended, 2026-09-26; harmonisations `docs/emr/HARMONISATION.md`; reports `docs/emr/STOP-REPORTS.md`). **Three GATED migrations**, additive, no UPDATE or DELETE of an existing row: `0071_emr_record_spine.sql` (21 tables, 5 views, the evolved encounters / observations / orders / co-sign requests, the `private` access rule, a non-owner reader role, FORCED RLS, the allergy backfill), `0072_emr_reference_seed.sql` (generated), `0073_emr_realtime.sql` (PHI-free chart broadcasts, reader grants). **Two Edge Functions change:** `ha-start-encounter`, `ha-complete-encounter`. **New env var:** `MEDSYNC_NOTE_HMAC_KEY`. Owner path, in order: `docs/emr/OWNER-RUNBOOK.md` — the dev project (O-1) → the HMAC key (O-2) → `npm run db:migrate` (0071–0073) **before** deploying the branch → `npx supabase functions deploy <name> --use-api` for each of the two functions → `npx vercel deploy --prod --yes` → `EMR_V1` (hospital ids first, then `1`). Flags off, every existing page is unchanged (`tests/emr/ui/flag-off.test.ts`).

- **The fact store** (`lib/facts`, `lib/units`): the Clinical Fact Contract with its v1.1 addendum; engines read `loadFactSnapshot` only. Legacy observations, triage vitals, problems, diagnoses, medicines and lab results are **projected**, never copied or altered; new fact rows are immutable and versioned. 145 concepts, 21 drug-class tags, 29 capabilities, a 35-test menu and 85 draft ICD-11 terms seeded; no clinical number ships — critical limits, plausibility, HMIS, IDSR, pregnancy age and the fasting definition are `pending_cso` reference entries that show nothing until signed.
- **One access rule, in the database:** `private.patient_access_basis`, hospital-scoped; EMR reads run as `medsync_clinical_reader` with the identity set per transaction. Patient, reception, other-hospital and anonymous reads are denied by RLS.
- **The chart** at `/doctor/patients/[id]` and `/nurse/patients/[id]`: the safety bar, summary, timeline, results flowsheet (sparklines with tables), notes, orders, medicines, problems and allergies, value provenance, live updates on `chart:<patient>` with a 15 s poll behind them.
- **The clerking desk** at `/doctor/encounters/[id]`: template sections, tri-state finding chips, the ROS grid, "still true?" carry-forward, medicines reconciliation, the allergy editor, vitals with the unit prompt, the diagnosis picker (85 terms in ≤ 4 keystrokes), Plan with orders and triage suggestions, the NCD section (its values reach the record at signing through `lib/ncd/cfc-map.ts`), autosave, sign / co-sign / addendum / entered in error, and completion with a disposition or an administrative closure.
- **Orders → specimens → results → acknowledgement:** the order sheet, specimen collection with two identifiers and the fasting chip, labels, the `/lab` worklist (preliminary, final, amend, reject — each one transaction), `/doctor/results` batch acknowledgement, the critical-call record. Three new Workspace lanes: Critical results, Results to review, To co-sign (keys 8, 9, 0).
- **One allergy record:** every prescribe path reads it, resus AMPLE writes through to it, and the server re-checks on emergency administration. Uncoded text is still matched by name.
- **Fixed at the root:** resus allergies were invisible to the next episode; `ha-start-encounter` could open a second encounter for one visit; End visit wrote no disposition; lab release and `recordClerkshipVersion` were not transactional; NCD drafts were plaintext and could be written to completed encounters. Found and fixed at the gates: a critical value lost its alarm when its context was incomplete; migrated allergies showed "substance not named"; the 0031/0033 policy would have exposed a patient's own restricted fact rows; 20 screenshot defects.
- **Numbers:** 2,400 RLS probes, 0 mismatches; scenarios A1–A9 10/10 (A5 partial: the resus close-out has no structured action list); 3,084 EMR tests on the PGlite lane (`npm run test:emr-db`), 284/284 lane tests at STOP 5–6; 40/40 audit rows name the acting user; axe serious/critical 0 over 39 screens × 4 viewport/theme pairs; 234 screenshots; clerking route +89.7 KB gz (budget 90), chart +58.2 KB, `/lab` +1.7 KB.
- **Open, recorded:** loader p95 91 ms on PGlite against a 60 ms Postgres budget and a 1.4 MB payload against 1 MB (measure on the dev project); the desk is still imported unconditionally on the flag-off page; design-system tokens fail WCAG AA product-wide (teal-600 text 3.7:1, caution 2.8:1, critical 3.9:1 — fixed in EMR files only, owner decides in `DESIGN-medsync.md`); drain legacy in-flight lab orders before switching `/lab`; ICD-10 is present but unlicensed and unused (`THIRD-PARTY-NOTICES.md`, O-3). `EMR_PRESCRIBING` exists as a flag; prescribing from the encounter is Phase 7.

### Fixed — Departments set up in the hub reach staff sign-up; every pop-up is a centred card — 2026-09-26

[ADR 0161](docs/adr/0161-pop-ups-are-centred-landscape-dialogs.md). No migration. Deploy the `ha-services-hub` Edge Function **before** the app (it gains the ops the new buttons call), then `npx vercel deploy --prod --yes`.

- **Why clinician sign-up said "no departments set up".** Two causes:
  - `listDepartments` sat in the hour-long reference-data cache that nothing clears, so sign-up missed departments for up to an hour after the hub changed them. It is no longer cached.
  - Departments added in the hub started as Not on MedSync yet, which sign-up hides.
- **What changed for departments:**
  - **Add departments** now adds them live by default, with a "Live on MedSync now" choice. The first live department becomes the start department.
  - The Departments tab says when any aren't live, with **Set all N live** (new op `set_departments_live`).
  - Sign-up now says a hospital has no departments _open on MedSync yet_, and says so separately when the lookup fails, instead of blaming the hospital.
- **Pop-ups are centred landscape cards, never side sheets (owner rule).**
  - Every Departments & services panel opens as the console's `EditorDialog`.
  - The department, clinic and ward panels put their settings and their related lists side by side. Add departments shows its catalogue in three columns.
  - The rule is in ADR 0161, `DESIGN-medsync.md` and `AGENTS.md`.
- **Also fixed:** "Archive department:not possible" was missing its space.
- **Checks:**
  - Vitest 3,853 passed;
  - all 31 ops run end to end (65/65), with a stand-in that now fills missing keys with NULL the way PostgREST does;
  - axe clean on 27 scans.

### Added — Departments & services: one place for what a hospital runs, where and when — 2026-09-26

[ADR 0150](docs/adr/0150-services-hub-single-editor.md), [0151](docs/adr/0151-services-hub-reuse-map.md), [0152](docs/adr/0152-department-kinds-and-live-status.md), [0153](docs/adr/0153-effective-dated-heads-and-in-charges.md), [0154](docs/adr/0154-clinics-days-holidays-closures.md), [0155](docs/adr/0155-confidential-clinics-in-messages.md), [0156](docs/adr/0156-test-menu-overlay.md), [0157](docs/adr/0157-availability-events.md), [0158](docs/adr/0158-four-eyes-routing-capabilities.md), [0159](docs/adr/0159-capability-profile.md), [0160](docs/adr/0160-level-presets.md). Gate record: `docs/hospital-services/STOP-REPORTS.md`.

Migration `0080_hospital_services_hub.sql` (GATED, additive: every existing department is backfilled live, so no reader changes on apply). Edge Functions: `ha-services-hub` (new), `ha-upsert-session-template` and `ha-set-hospital-emergency-settings` (changed).

- **`/hospital-admin/departments` becomes Departments & services**, with seven tabs: Departments, Wards & beds, Clinics, Diagnostics, Emergency & support, Availability, Hours & places. Every write goes through `ha-services-hub` (30 ops), and the audit row is written first.
- **Departments:**
  - four kinds, with units;
  - a "Live on MedSync" switch: only live departments reach sign-up, queues, intake, booking and USSD;
  - one start department;
  - effective-dated heads and acting heads;
  - archive instead of delete.
- **Wards & beds:** type, sex and age group; an optional bed register; in-charges and acting in-charges (reusing 0031); temporary closures. ICU, HDU, isolation and NICU counts are derived from wards.
- **Clinics are the booking engine's services.** Clinic days are its templates, which now support every N weeks, the nth weekday, and public holidays (seeded 2026–27, with their source).
  - Closures preview the affected sessions and bookings, then run the existing cancel flow.
  - The timetable prints on one A4 landscape page.
  - HIV/ART, TB, mental health, family planning and SRH clinics are confidential by default.
- **Diagnostics:** a per-hospital overlay on the ordering catalogue: in-house or referred, hours, stated turnaround. Plus imaging and other tests.
- **Emergency & support:** typed capability values. **Routing values need a second admin to verify them**, and the profile's emergency form no longer edits them (CAP-5).
- **Availability:** an append-only problem log. A problem turns "unconfirmed" after its expected-back date. It informs ordering and booking and never blocks them.
- **Presets:** five level presets (MoH 2016, signed) and a one-time import of the application's answers. Both add items as Planned only.
- **Also:**
  - a capability profile for three audiences, with no personal data;
  - ⌘K groups for departments, wards, clinics and tests;
  - an amber "unavailable" badge on the nav item;
  - the onboarding checklist links into the hub.
- **Numbers:**
  - tab switch p95 33 ms;
  - 6–14 KB gz of JS per tab;
  - axe clean on 27 scans;
  - 95/95 RLS probes;
  - all 30 ops run end to end against PGlite, 60/60 checks.
- **Not met:** the ≥ 70 % preset interaction target, which is met for the structure a preset adds (72 %) but not for the whole setup (~14 %). See STOP 7.

### Fixed — Signing out on one device no longer signs you out everywhere — 2026-09-25

No migration. Deploy: `npx vercel deploy --prod --yes`; the phone change ships with the next app build.

- **Sign-out is per device.** `/sign-out` and the phone app called `supabase.auth.signOut()`, whose default scope is `global`: it revoked every session the user held, so signing out of a shared ward PC also signed the clinician out of their phone and every other tab (and a patient signing out on the phone lost the web). Both now pass `{ scope: "local" }`.
- **Redirects keep the refreshed session.** `proxy.ts` built fresh `NextResponse.redirect`s for sign-in, the second factor and MFA enrolment, dropping the cookies `updateSession` had just rotated; the browser kept a spent refresh token and the session could end early. Redirects now carry those cookies (`tests/auth/mfa-gate.test.ts`, `tests/auth/sign-out.test.ts`).

### Added — The Doctor Workspace, dark behind `DOCTOR_WORKSPACE` — 2026-09-24

[ADR 0113](docs/adr/0113-doctor-workspace-replaces-the-four-list-pages.md), [0114](docs/adr/0114-patient-flow-projection-and-integrity-report.md), [0115](docs/adr/0115-death-read-from-the-records-that-hold-it.md), [0116](docs/adr/0116-assignment-supersession-on-the-planned-encounter.md), [0117](docs/adr/0117-triage-in-a-sheet-intercepting-route.md), [0118](docs/adr/0118-workspace-live-updates.md) (owner: "go through all gates"; **CSO signature pending** on D2, D3, D4, D9 and D11 — `docs/doctor-workspace/gate-a-proposal.md` §9). **One GATED migration** (`0069_doctor_workspace.sql`): the `retire_assignment` audit action, PHI-free broadcast triggers on intakes, triage records and encounters, and the `workspace:<hospital>` realtime policy. Owner actions, in order: the CSO signature → `npm run db:migrate` (0069) → `tests/rls/workspace-realtime.test.ts` against a test project and `docs/doctor-workspace/integrity-probe.sql` (read-only) → `npx vercel deploy --prod --yes` → set `DOCTOR_WORKSPACE` (`1` or hospital ids) with `ENCOUNTER_ENGINE_LIVE=1` and `RESUS_DESK_V2=1`. No Edge Function changes. Reports: `docs/doctor-workspace/STOP-REPORTS.md`.

- **One board at `/doctor`** replaces Triage, Assigned, Encounters and the Resus board: each patient once, in one of seven lanes (Resus, To triage, Unassigned, Waiting for you, In progress, Needs closing, Done today), with one next step and ⋯ for the patient panel. Name, MRN and age · sex on every row; Mine or Department scope; lane and patient in the URL; search with `/` or ⌘K; the keyboard (`j`/`k`, Enter, `s`, `t`, `a`, `0`–`7`, `?`). The old URLs redirect into their lane (307); the nav becomes Workspace · Patients · Schedule, with Emergency in the header.
- **The flow projection** (`lib/workspace/flow.ts`, pure): rules FW-1 to FW-11 with 78 tests, a 400-seed property test (every patient once, nothing disappears) and the 24 Sep screenshots as a fixture. A recorded death puts every open item in Needs closing under "Died hh:mm", and starting care anyway needs an audited reason; duplicate assignments collapse onto the newest; an L1 older than 24 h with no resus, and an encounter idle for 24 h, go to Needs closing. Nothing closes itself.
- **The chain:** triage in a sheet over the board (the full page on reload) ending in Open resus, Take & start or Assign; the next waiting patient offered after End visit; a workspace rail on the encounter page; Retire assignment and Close intake in the panel.
- **Fixed at the root:** assigning reuses the visit's open encounter instead of adding another (W2); starting a planned encounter stamps `started_at`.
- **Live:** the board listens on `workspace:<hospital>` and the resus board's topic, polls every 15 s without them, and holds reorders behind "N updates · Show" while the list is in use.
- **Numbers:** sidebar 11 → 3 items; triage submit → encounter open in 1 tap; +22.0 kB gz on `/doctor`; lane switch and panel open p95 36 ms.
- **Deviations recorded** (proposal §10): no `deceased_at`, `superseded_at` or settings table; a `{ kind, at }` payload on a hospital topic; ⋯ opens the panel; no sidebar count; no Playwright — scripted scenarios, plus axe, screenshots and timings over the DevTools protocol against a local build. **Known:** the design system's Critical pair (`#DC2626` on `#FEE2E2`) is 3.95:1 on the L1 chip and every critical badge; the doctor shell's tier label and its dark-mode cadre pill fail contrast (pre-existing).

### Changed — Sign-ups reopened in production — 2026-09-23

[ADR 0112](docs/adr/0112-signups-reopened-before-legal-basics.md) (owner decision; supersedes landing v4 S8 D1): `signupsOwnerOverride` in `lib/legal.ts` brings the patient, clinical, non-clinical and hospital forms back in production, removes the `/get-started` closed note and switches the FAQ to its "register now" answer. The privacy notice and PDPO registration are still outstanding. Set the override to `false` to restore the holding page.

### Added — The symptom catalog and the Emergency Pathway — 2026-09-22

[ADR 0098](docs/adr/0098-symptom-catalog-and-emergency-pathway.md) (owner + CSO decision via PRD MS-PRD-SYM-001, `docs/prd/`; **PROVISIONAL** — clinical content ships `draft`, production renders only `signed` content, every flag off). **One GATED migration** (`0066_symptom_catalog_and_emergency_pathway.sql`): six tables with RLS (`patient_symptom_catalog_versions`, `patient_symptom_catalog_items`, `symptom_submissions`, `emergency_pre_arrivals` — published to Realtime —, `emergency_contacts`, `pre_arrival_outbox`), `hospitals` gains capability, pre-alert, board owner, directions, SMS/ambulance numbers and coordinates, `appointments` gains `symptom_tier` + `symptom_submission_id`, `patient_intakes` gains `pre_arrival_id` + `symptom_submission_id`, entry type `self_presentation_prealerted`, eleven audit actions; Appendix B seeded **unverified**. Owner actions, in order: `npm run db:migrate` (0066) → `npm run db:seed-symptom-catalog` (`-- --dev-mulago` on dev only) → `npx supabase functions deploy --use-api` → `npx vercel deploy --prod --yes` → `cd mobile && npx expo start -c`. Nothing to set in production: the flags default off. Runbooks: `docs/runbooks/emergency-contacts-verification.md`, `docs/runbooks/pre-alert-facility-onboarding.md`.

- **The catalog as data** (`supabase/functions/_shared/symptom-catalog/`, zero-import, three runtimes): 109 lay-language items in 12 categories, each tiered Emergency / Urgent / Routine with ≤ 2 qualifiers, synonyms, an icon, sources, and a `lib/triage` discriminator ref where one matches; rules R1–R7 as data; a pure classifier with a reconstructable trace; monotonicity (10,000 seeded cases) and the golden table tested; `catalog.v0.1.ts` generated from the JSON with an FNV-1a checksum every submission stamps. Content caps, no reassurance, no dose or threshold, no literal emergency number — all in the rewritten `tests/booking/clinical-firewall.test.ts` (third posture: advisory tiering allowed, engines still blind to booking fields and free text).
- **Before booking, web and phone** (`/patient/symptoms`, `(app)/symptoms`): who it is about → a category grid with a danger-sign strip → items with qualifiers → a review that says the tier in three words and why ("Because you chose…"). Routine → the wizard, which sends the submission id instead of a descriptive list; Urgent → **Be seen today** (`pt-request-same-day`, the earliest slot today through the one booking core at `priority: urgent`, or today's queue with the submission linked); Emergency → the interrupt, once, with the sheet behind it and a way to say "this is not happening now". Free text never touches the tier. Non-production shows the draft under an **Unsigned clinical content** watermark; production keeps the ADR 0095/0096 picker until the CSO signs.
- **The Emergency Pathway.** A red pill on every route, signed in or out (`components/emergency/emergency-pill.tsx`, root layout; on the phone the red tab or disc), one tap to `/emergency`: the verified numbers for where the patient is or the hospital's registered line when none is verified, a nearest-facility list, **Tell a hospital I'm coming** (two taps with defaults: what, arriving in, by; callback required signed out; 3/h/device, 5/day/phone; hoax downgrade to call-only), a status screen that polls and gives up at five minutes with "call", offline queueing with an SMS fallback, calm crisis and sexual-violence routes with no red and no data collection. Precise location leaves the device only on the explicit toggle and only for a facility that can dispatch. PHI encrypted; the token is a blind index returned once.
- **The hospital side.** `/reception/incoming` and `/nurse/incoming` — the Incoming board over Realtime with polling behind it, a chime on a new alert, escalation at two minutes, Acknowledge / Ready / Not arriving / Hoax, and **Arrived** that converts the alert to an `awaiting_triage` intake through the one intake writer (`_shared/intake.ts`, extracted from `ha-register-intake`) — never a second intake. Reception's Today shows an open-alerts strip. The hospital admin's profile gains the **Emergency** panel (capability, pre-alerts with a required board owner, directions, numbers, coordinates); superadmin gains `/admin/emergency` (verify contacts under four-eyes, sign a catalog version by checksum). The Front door carries the desk catalog beside the descriptive picker and suggests — never sets — a priority.
- **Fixed:** the Front door's negative space — the complaint sits in the left panel, the picker opens compact (eight quick picks, "Show all"); the scheduling dashboard's _Next 14 days_ and _Weekly rules_ tables no longer squash their When and capacity columns.
- **Deviations recorded (ADR 0098 ruling 11):** no Playwright, Lighthouse or fast-check — source-level Vitest checks instead; E1 is server-rendered, not static; `expo-location` and `expo-haptics` added (PRD requirements, Expo Go compatible). **Known gap:** no four-eyes action has a second-approval executor, so contact verification self-executes only while one real superadmin exists.

### Changed — Plum, the second hue: place, never state — 2026-09-21

[ADR 0097](docs/adr/0097-secondary-accent-plum.md) (owner decision 2026-09-21). No migration. Deploy: `npx vercel deploy --prod --yes`.

- **A plum ramp** (`--plum-50…950`, mulberry at OKLCH hue 342, AA on every anchor in both modes) beside teal in `app/globals.css`, flipping with the theme like teal and pinned by `medsync-forced-dark`. Teal stays the only action colour, red the only alarm; plum means _where you are_ — never a button, a chip or a state.
- **Where it shows — the whole product:** every atmosphere (the landing's lavender hue 286 radials and both dark bands, the auth / signup / onboarding / not-found pages, the doctor and nurse homes, triage, the encounter page) is now plum; a plum corner glow in `--gradient-hero` and `--gradient-band`; the active nav item in every shell and the patient rail (`--sidebar-accent`), the phone tab bar, the site-nav underline and scroll progress; `SectionNumber`, section markers and the current step of every multi-step form (done steps stay teal); every monogram and avatar disc, decorative icon tiles, empty states, the tinted `StatCard`, headline emphasis; `--chart-2` and `--gradient-signature`. The phone mirrors the ramp (`plum` / `plumDark`) behind two new roles, `place` / `placeForeground`. Buttons, links, focus, selected controls, count badges and every status stay teal or their status hue.
- `DESIGN-medsync.md` § Secondary Plum (light and dark tables, the where / never rule, the re-pin mechanism for a per-workspace hue); `/styleguide` §04.

### Added — Symptoms before booking, and the Front door station reworked — 2026-09-21

[ADR 0096](docs/adr/0096-symptoms-before-booking.md) (owner ruling 2026-09-21, later the same day; carries ADR 0095's PROVISIONAL mark). No migration. Deploy: `npx vercel deploy --prod --yes`; phone `npx expo start -c`.

- **The shortlist under "How are you feeling today?"** on the patient home, web and phone: the catalogue's first eight in its own order (`QUICK_PICK_CODES`, one line to change), toggle chips, "More…" to the whole catalogue with search, the boundary sentence beneath. Picks carry no duration yet; the booking wizard and the phone's booking screens open on them and ask the duration as before. Web carries them in `sessionStorage` (consumed once by the wizard); the phone in an in-memory store both booking screens write back to. The firewall test treats both shortlist components as selector surfaces.
- **Front door (`/reception/intake`, `/hospital-admin/intake`) as a workstation** (`components/intake/front-door-form.tsx`): two columns — who is arriving (arrival modes grouped Booked / Emergency / Referral and transfer / Routine; a patient **code search** in place of the "paste a UUID" box; for a booked arrival, today's confirmed bookings as a pick list) and where and what (department, door, referral, the symptom picker + "In their words" writing one `presenting_complaint` line, brought by, priority, audit note, a docked Register). A booked arrival goes through **check-in** (`ha-check-in-patient`), never a second intake. Success card routes per surface; "Register another" really starts over.
- **Fixed:** the reception success card pointed at the hospital-admin list; the emergency chip did not move the entry door; a server-side error wiped the form's fields; Enter in a search box submitted the intake; the picker's duration prompt contradicted a "dropped at Register" caption (the duration now holds Register, per ADR 0095).

### Added — Symptoms at booking, the clinic's patient card, coloured and custom blocks — 2026-09-21

[ADR 0095](docs/adr/0095-symptoms-at-booking-staff-card-custom-blocks.md) (owner rulings 2026-09-21; **PROVISIONAL** pending CSO review of the amended PRD §5.4). **One GATED migration** (`0065_symptoms_and_custom_blocks.sql`): `appointments.symptoms jsonb` (list CHECK), `availability_blocks.kind` + `custom`, `availability_blocks.label` (≤ 40, required for custom); additive, dry-run clean. Owner actions, in order: `npm run db:migrate` (0065 — **before** the functions and the web: `pt-request-appointment`, `ha-book-on-behalf`, `reschedule-appointment`, `pt-accept-rebooking` and `ha-set-clinician-availability` write the new columns, the Next app selects them), then `npx supabase functions deploy --use-api`, then `npx vercel deploy --prod`.

- **Symptoms at booking — words only** (PRD §5.4 and §7.2 rule 1 amended in part). A booking may carry the symptoms the patient chose to state, each with a duration, as words for the clinic. One zero-import contract for Deno, Next and Expo (`_shared/symptoms.ts`): ≤ 8 entries, label ≤ 80, five duration chips, the 89 shared CSO-signed `symptom_catalog` rows rendered flat under lay system names in the catalogue's own order, a typed-in entry with `code = null` that never becomes a catalogue row; written by the core (`_shared/book.ts`) and copied unchanged by `reschedule-appointment` and `pt-accept-rebooking`. What did not change is tested (`tests/booking/clinical-firewall.test.ts`, rewritten for the amended rule): never ranked, routed, scored or coloured; never read by `lib/triage`, `lib/clerkship` or `lib/encounter`; the catalogue's decision-support flags never reach a booking surface; the selector asks nothing about severity or urgency; Appendix A, the interstitial and the emergency block stand. The patient reads `SYMPTOMS_NOTE` verbatim under every selector.
- **The selector** on the web wizard, the reception desk and the phone — "What is bothering you?" / "Optional. Choose anything that fits, or type your own.": a search over display and synonyms, toggle chips grouped by system, the chosen ones above with their own duration row (no default — "Choose a duration for each one." blocks Continue), "Something else" with Add, remove on each. "How are you feeling today?" stays banned (`REFERENCE-LANGUAGE.md`).
- **The clinic's patient card** (`components/medsync/patient-identity.tsx`, `lib/scheduling/patient-identity.ts`): name, photo, age, sex and complaint (`complaintLine(symptoms, reason_note)`) on the doctor's schedule (calendar cards, pending and queue rails, detail sheet), the clinician list and reception's expected board. The reveal is audited — one `clinical_phi_access_log` row per patient per fetch, basis `department_recent`, `surface = '<surface>#operational'`, mirroring reception — and fails closed to the code on both name and photo. Signed avatar URLs minted server-side per distinct patient; monogram (of the name, or the code's last four) when there is no photo. Hospital admin stays code-only (ADR 0032). Generalises ADR 0038 to "a booking with this clinician or department is the care relationship".
- **Coloured and custom availability blocks.** One tint, one `Pill` tone and one word per kind, from one exported map in `components/scheduling/calendar/helpers.ts` (the duplicates in the clinician list and the doctor's sheet are gone): bookable brand / teaching blue (`info`, new tone) / ward round violet / admin grey / leave amber / unavailable orange (`notice`, new tone) / custom green with the block's own label. Never red. A **custom** kind with a ≤ 40-character label, inert to the slot engine like teaching, ward round and admin — a doctor who needs to stop bookings uses Unavailable or Leave. A legend under the doctor's calendar names the kinds present in the window (`availability-legend.tsx`).
- **Fixed:** `unavailable` blocks wore the red `critical` tone in the clinician's availability list (red is for genuine emergencies); the clinician schedule joined `users.full_name` unaudited — replaced by the audited decrypt above.

### Added — Gate H: reports, the tests that hold the line, CI, and the six parked rulings — 2026-09-19

[ADR 0094](docs/adr/0094-gate-h-rulings-and-closeout.md) (rulings + closeout) and [ADR 0093](docs/adr/0093-fhir-appointment-mapping.md) (the FHIR mapping's own record). **One GATED migration** (`0064_cancel_reason_codes.sql`): rewrites legacy cancel words to codes, NULLs `declined_reason`, then closes `appointments.cancelled_reason` with a CHECK; dry-run clean. Owner actions: `npm run db:migrate` (0063 then 0064), `npx supabase functions deploy --use-api`, `npx vercel deploy --prod`; the first push to GitHub runs the new CI.

- **`/hospital-admin/reports`** (PRD §3.4) — fill rate, no-show rate, wait accuracy, demand vs capacity, refill load and SMS spend over 7/28/90 days in the hospital's zone; each number prints its numerator, denominator and window, and a rate under 20 in the denominator says "too few to report". The **§3.6 detector** scores each line and clinic day on the share of patients called inside the window they were promised and flags a line under 50% over a real sample — amber with words, a judgement of the facility. The page states the ruling: nothing here ranks, flags or colours a patient, and nothing in the booking path reads it (tested). Refill load shows two counts side by side and says they are not joined (prescriptions reach appointments only through two nullable FKs). The superadmin rollup carries the same aggregates per hospital, PHI-free; a live-DB test seeds two hospitals and asserts each sees only its own.
- **The tests that hold the line.** `tests/design/red-reserved.test.ts`: no red fill, ring, chip or tone under the patient and reception trees or `mobile/src` outside the five emergency files ADR 0085 §5 names (the web allowlist is empty — the emergency notice is amber by ADR 0084); red text only as an announced failure; every Pill/Badge carries words. `tests/booking/gate-h-rulings.test.ts` pins the six rulings below. Both proven to bite with probe files, beside Gate G's §5.4 firewall test.
- **CI and budgets** (PRD §4.5). `.github/workflows/ci.yml` runs typecheck, lint, format, build, test and `npm run budget` for the web and tsc/eslint/prettier for the phone on every push, with no secrets; the live-DB suites now **skip** when there is no database (the helper threw at import before, and two suites — auth-flow, audit — had no gate and wrote to whatever `.env.local` named). `scripts/check-budget.mjs`: 370 kB gzip first-load JS per `/patient` route over Next 16's route-bundle-stats (baseline 318 kB; 140 kB of every route is one shared chunk carrying Sentry). `@next/bundle-analyzer` behind `ANALYZE=true`. Node pinned by `.nvmrc`.
- **Accessibility, proven.** `eslint-plugin-jsx-a11y` strict on `app/patient` and `app/reception` (five fixes); axe-core in jsdom over the eight pre-rendered public pages after the build — six real defects on the landing page and the styleguide fixed at source, no rule disabled.
- **The six parked rulings** (owner, 2026-09-19): un-reconcile keeps today's bar (no four-eyes); cross-tenant un-reconcile is a 409 naming the count for a hospital_admin and a superadmin reverses everywhere, audited; `ha-book-on-behalf` and `system-ussd-book` refuse a stated minor — by either number given — with the desk form's own sentence, in the hospital's zone, before any write; **staff cancel reasons are staff only** — `appointments.cancelled_reason` is a closed code (`_shared/cancel-reasons.ts`, one copy for Deno, Next, Expo) because patients read the row through RLS, and the words stay in the `sa_audit_log` row every writer already records; template edits re-stamp empty future clinic days in place and leave booked ones untouched; **consent re-acceptance** — a patient whose `data_processing` record does not match the active consent text by version and hash is asked to accept before the patient area opens, on web (`requirePatientScope` → `/patient/consent`; the shell drops its navigation while gated) and phone (a four-state check — only `clear` mounts the workspace, a failed read offers Retry, the consent screen carries the emergency block). The five patients with no record are asked, not backfilled.
- **ADR 0093** lifts the FHIR R4 Appointment mapping out of ADR 0089: the exhaustive status map, the two derived values (`checked-in`, `waitlist`), why `reasonCode` is never emitted (Appendix A is administrative; the §5.4 firewall rests on it — now tested), the skeletons the proposal sketched and Gate D did not build, and that no route serves it. The mapper's waitlist input drops its Gate E stub.
- **Reviewed.** An adversarial pass over the whole Gate H diff (six lenses, two skeptics per finding) confirmed 23 defects, all fixed before this entry: the phone consent gate failed open on a failed read and matched any patient's record for a superadmin; one patient action sat outside the web gate; the no-show denominator counted a clinic day still in progress; demand and capacity were measured on different days; a stated minor slipped through when an adult age was typed beside a child's birthday; the red-reserved test did not know the Button's red variants; CI exposed secrets to every step and was red on a clean runner for the phone.
- **Fixed:** `format:check` failed on fifteen committed files that predated the check (whitespace only; `.agents/` — the vendored skills — is now ignored).

### Added — Gate G: the reference design on both platforms, and fees by cadre — 2026-09-19

[ADR 0092](docs/adr/0092-fees-by-cadre.md). **One GATED migration** (`0063_cadre_fees.sql`), additive; dry-run clean. Owner actions: `npm run db:migrate` (0063 **before** the redeployed booking core — `_shared/book.ts` now writes `appointments.quoted_fee_*`), then `npx supabase functions deploy --use-api` (adds `ha-set-service-line-fee`; `pt-bookable-clinicians` and the core changed), then the Next app.

- **The reference design, component for component, web and phone.** ADR 0085 named the web as the outstanding follow-up; both now carry it under the same component names — `ProviderCard` (home carousel), `ServiceLineCard` (the category grid with one filled tile), and the provider screen (`/patient/clinician/[id]` on the web; the phone's `doctor/[id]` reframed): photo card with the circular back control, rating badge, credential lines, action row, three-column stats strip, "Select date" with month stepper and day cards, "Select time", docked CTA. Palette is the design system's teal (`449f154`). Where the reference asserts what no table holds, the component stays and its content becomes true: "8 Years Experience" is "With us" from the affiliation's start; patients and reviews are counted (`pt-bookable-clinicians` now returns `patientsSeen`, `withUsSinceIso`, `allowVirtual`, `seenBefore`) and read "—" before there are any; the heart's slot carries "Seen you before" (PRD §2.7); phone and chat circles are unavailable with a stated reason; video is live where `allow_virtual` is set; the tick-mark time ruler is a chip radio group (44px targets, arrow keys, announced state).
- **Fees by cadre** — an override, not the model. Research first: Uganda's MoH guidelines (binding 1 July 2025) price private care by facility level, geography and service class, never by cadre; Mulago charges a flat UGX 50,000 consultation whoever sees you. So `service_line_fees(line, cadre, fee_ugx)` is a sparse override on `service_lines.fee_ugx`, resolved `COALESCE(override, base)` by one shared `_shared/fees.ts` (Deno, Next, Expo). A facility pricing the Ugandan way inserts nothing. The quote is snapshotted on the booking by the core alone (`quoted_fee_ugx/_label/_at`) — a later price change never moves a held booking; a test asserts one writer. Shown on the tile, before the booking control, and on the receipt, on both platforms, always with "You pay at the hospital, not in the app." and "Waivers may apply — ask at the desk." (MoH §2.2(J)). Never a sort key, filter or badge; cadre names verbatim (UMDPC §5(d)); no promotional vocabulary (tested). `ha-set-service-line-fee` + a "Fees by cadre" panel in the console's line editor.
- **Fixed:** a clinic day with no clinician was offered as bookable on both surfaces and refused by the server on tap (PRD §3.6). Gated on the clinician id, never the name — the name is a left join and is also null for a named clinician with no name on file. `service_lines.payment_posture` had been writable from the console with no booking path reading it and no patient ever told — a fee-required line booked in silence.
- **Gate H, started:** the PRD §5.4 invariant test — "no booking-flow field feeds any scoring or routing function" — which the PRD says is enforced by test and which did not exist. Six assertions over the scoring trees, the booking paths, Appendix A, the reason labels on both surfaces, the free-text placeholders and the interstitial; mutation-checked.
- Contracts for [Gate G](docs/booking-app-build/GATE-G-BUILD.md) and [Gate H](docs/booking-app-build/GATE-H-BUILD.md), surveyed against the code.

### Changed — brand colour back to teal — 2026-09-19

`app/globals.css` had drifted from `DESIGN-medsync.md` § Primary Teal: an undocumented swap (in `94ab8ba`) made indigo the brand hue with a mint accent. Reverted at the token layer. `brand-*` and `mint-*` — the names ~190 components were written against — stay as utilities and now alias the teal ramp (light, dark, and inside `medsync-forced-dark`), so `bg-brand-700` is `bg-teal-700`; `--primary`, `--accent`, `--ring`, sidebar, chart, focus-ring and gradient tokens carry their original teal values. Mirrored in `mobile/src/theme/tokens.ts` (`mint` is `brand`), the native splash (`mobile/app.json`), the PWA `theme_color`, `/styleguide`, and the booking `THEME-CONTRACT`. No component markup changed.

### Added — Gate F: USSD and SMS keywords, the low-bandwidth channels — 2026-09-13

[ADR 0091](docs/adr/0091-gate-f-low-bandwidth-channels.md). **One GATED migration** (`0062_ussd.sql`), additive throughout (`notification_dispatches.hospital_id` becomes nullable); dry-run clean after 0061. Owner actions before either channel works: `npm run db:migrate`, `npm run db:backfill-phone-hmac`, deploy `system-ussd-book` + `system-ussd-act` (and the re-deployed core callers — the core's `origin`/`channel` types gain `ussd`), set `MEDSYNC_SYSTEM_ACTOR_UUID` on Functions, `USSD_WEBHOOK_SECRET` (+ optional `AT_CALLBACK_IPS`) on Vercel, and the three callback URLs in the Africa's Talking dashboard — all in [docs/ops-channels.md](docs/ops-channels.md). No live AT call anywhere in the repo; credentials come after this gate.

- **USSD** (`/api/ussd/[secret]`) — the menu as a pure state machine (`lib/channels/ussd.ts`): `1 Book a visit` → language → hospital (5 per screen, `0 More`) → clinic (session lines first) → day (next 3; a slot clinic lists "day time" on one screen) → name and age (one screen) → confirm → END with position + arrival window or time, and the code; `2 My next visit`; `3 Cancel my visit` (code); `4 Confirm I'm coming` (code). Every screen ≤ 160 ASCII, ≤ 6 levels, tested screen by screen. Resumable (`ussd_sessions`, 10-minute TTL, swept by the cleanup cron), idempotent on `(sessionId, text)`, 20 sessions per phone per hour, `ussd.step { ms }` logged against the 2-second budget. Identity: the carrier-verified phone books a **provisional patient** with `phone_verified_at` set; a phone matching an account is _offered_ "Booking as {name}" and **never auto-linked**.
- **Inbound SMS** (`/api/sms/inbound/[secret]`) — `YES|CONFIRM <code>`, `CANCEL <code>`, `STOP`, else one help reply (`lib/channels/sms-keywords.ts`, pure, tested; no look-alike guessing on codes). Idempotent on AT's `id` (`inbound_sms`); 10 per phone per hour, the flood unanswered. Replies are dispatcher rows (`sms_reply`, a reply KEY rendered from the strings table) so their cost is attributed; `hospital_id` NULL = the platform's.
- **STOP** — `sms_opt_outs` by phone (covers provisional patients with no account); the dispatcher refuses every SMS to an opted-out phone, the receipt included, except the reply confirming the STOP; an account holder's consent is revoked and audited `sms_stop`.
- **`system-ussd-book` / `system-ussd-act`** — service-role only (a user JWT is refused; a test greps), audited as `MEDSYNC_SYSTEM_ACTOR_UUID`; booking goes through the core (origin/channel `ussd`, the line's first reason code), cancel/confirm are the existing paths and act only on a visit that belongs to the phone.
- **Webhook auth** — all three AT webhooks (USSD, inbound, DLR) share `lib/channels/webhook-auth.ts`: constant-time secret path segment + optional IP allowlist; a miss is a 404.
- **`lib/channels/strings.ts`** — every USSD/SMS word in one table keyed by language (English on; Luganda is a data change after CSO sign-off).
- **`patient_profiles.phone_hmac`** — the blind index written at signup and on phone change; backfill script for existing rows.
- **Not built:** Luganda strings; per-facility USSD funding switch (Part 8 #9 is per AT account); WhatsApp; re-granting SMS after STOP from the app (Gate H).

### Added — Gate E: notifications, the waitlist, cancelling a clinic day — 2026-09-13

[ADR 0090](docs/adr/0090-gate-e-notifications-waitlist-cancellation.md). **One GATED migration** (`0061_notifications_and_waitlist.sql`), additive throughout; applied by the owner via `npm run db:migrate` **before** the Gate E functions and the re-deployed core callers (`pt-request-appointment`, `ha-book-on-behalf`, `cancel-appointment`, `ha-decline-appointment-request`, `reschedule-appointment`) are deployed — they insert `notification_dispatches` rows. Dry-run BEGIN/ROLLBACK clean.

- **`notification_dispatches`** — the ONE outbound queue (proposal §5.11): every writer inserts rows through `dispatchRows()` (`_shared/dispatches.ts`, zero imports, shared by Deno and Next); the `*/15` dispatcher drains it push-first with SMS fallback (`fallback_after` + `pt-ack-notification`), records `provider_message_id` and Africa's Talking's `cost` per row, holds quiet-hours kinds until the facility's window ends (`hospitals.quiet_hours_*`, DEFAULT 21:00–07:00), reaps rows whose visit stopped being live, caps per kind except `session_cancelled` (300 patients hear in one run — tested), and keeps draining `appointment_reminders` until empty (never dropped). `booking_receipt` and `session_cancelled` go push AND SMS always. The planner (`lib/notifications/dispatches.ts`) is pure and tested: quiet hours, fallback after no ack, the consent gate and its one exception (the receipt), provisional recipients, one-per-(kind, related)-per-run, the cap.
- **SMS consent** (PRD §5.2) — `consent_versions` gains `sms_communication` v1.0 (CSO-provisional); `consent_records.revoked_at` records withdrawal (the row is otherwise immutable); the dispatcher sends SMS to an account only with a live record, the receipt excepted. Control on patient signup (own box, unticked, declinable), web Settings and mobile Settings, with the honest sentence when off. **Fix:** every signup's `consent_records` insert wrote a nonexistent `granted_at` and omitted the NOT NULL `version`, unchecked — no consent had ever been recorded; the shape is corrected and the error logged.
- **The waitlist** — `waitlist_entries` (FIFO per line, one live entry per person per line, agent-created entries for household members); `offer_released_capacity()` (SQL, `FOR UPDATE SKIP LOCKED`) decides who is offered a freed place and is called by `releaseCapacity()` from `cancel-appointment`, `ha-decline-appointment-request` and `reschedule-appointment`, and by the cron's expiry cascade. An offer is a notification, never a hold: `pt-accept-waitlist-offer` books through the core with the entry id as the idempotency key and a 409 puts the patient back in line at their original place. `pt-join-waitlist`, `pt-withdraw-waitlist`.
- **Cancelling a clinic day** — `ha-cancel-session` (hospital_admin / the session's clinician / superadmin; `dry_run: true` answers the affected count first): every live booking → `cancelled` reason `session_cancelled`, positions released, one push + SMS per patient with the next equivalent day pre-selected in the payload; `pt-accept-rebooking` books it in one tap. **`ha-set-session-delay`** ("running late by N minutes"): un-arrived windows move by the difference; `window_shifted` at ≥ 30 min. **`pt-confirm-attendance`** answers the T-24h request; **unconfirmed-release** (`department_scheduling_policy.release_unconfirmed_hours`, NULL = OFF by default) cancels, notifies and refills only where a facility sets it.
- **Push** — `push_tokens` (own-row RLS), `lib/notifications/expo-push.ts` (fetch, chunks of 100, receipts next run, `DeviceNotRegistered` tokens dropped). **DLR webhook** `/api/sms/dlr/[secret]` (`SMS_WEBHOOK_SECRET`), idempotent, never logs the phone.
- **Patient web** — "Confirm I'm coming" inside the last 24 h; a cancelled day says so with the next day one tap away ("Choose another day" beside it); "Waiting for a place" / "A place has opened" cards above Upcoming with the expiry in full words and "Take this place" / "Leave the list"; "Tell me if a place opens" on the clinic-day step when every day inside the target is full; the SMS row in Settings.
- **HA console** — select a clinic day → running late (minutes) or cancel it (reason, the affected count shown, a tick to confirm); the "Sent today" panel (messages by kind and channel, SMS spend).
- **Mobile** — `expo-notifications`: the token is registered after sign-in and deleted before sign-out; a push that arrives is acknowledged (that is what stops the SMS fallback); a tapped one opens the visit. The same patient surfaces as web (confirm, rebook, waitlist cards, "Tell me if a place opens") and a **Messages** section in Settings: notification permission in words with "Allow" / "Open Settings", and the SMS toggle with the honest sentence. Push needs `extra.eas.projectId` in `app.json` before a real token can be minted — owner action; until then every message falls back to SMS.
- **Not built:** in-app notification centre; position-called tracking (Gate H); four-eyes on cancel-session (parked).

- Gate D verification: `provisional_patients` staff policy is bounded to a hospital
  (a household row with `hospital_id NULL` was readable by every hospital admin);
  a rescheduled provisional booking keeps `provisional_patient_id`; a slot booking
  in a department hosting a confidential line no longer names the department in SMS.

### Added — Gate D web: reconciliation panel, book on behalf, "I have arrived", household — 2026-09-13

[ADR 0089](docs/adr/0089-gate-d-identity-and-lifecycle.md). No migration; no red anywhere; no clinical question on any booking path.

- **Reception board** (`/reception/expected`, `/reception/flow`) — provisional bookings appear (LEFT JOIN; they were dropped before) flagged **"Identity to confirm"** in words, with a position column and a **"Seen"** stage from `encounters.state = 'completed'` (intakes: `status = 'completed'`); both boards refresh every 30 s with an honest "Updated Ns ago". Check-in on a provisional row is replaced by **Confirm identity**, which opens the reconciliation panel: the declared name, masked phone and DOB/age beside candidate matches, each with its **basis in words** ("same phone", "same name and year of birth" — `lib/reception/reconcile-basis.ts`, tested), **never a score and never pre-selected**; Confirm / Not this person / Register new. Candidates come from a bounded decrypt scan of this hospital's profiles (ponytail ceiling recorded; `patient_profiles` has no blind index yet). Every name shown is audited; provisional reveals go to the structured log (no `patient_user_id` to audit against).
- **`/reception/book`** — book on behalf: find by patient code or phone (exact, audited), or **New caller** (name, phone, DOB or age, adult declaration); then the patient wizard's own `SlotStep` / `SessionStep` / `ChoiceList` (extracted to `app/patient/book/_components/pick-steps.tsx`) over `lib/scheduling/booking-options.ts` (`fetchLines`, lifted from the patient page, `patientUserId` now nullable); posts to `ha-book-on-behalf`; the code big on the receipt.
- **Patient web** — **"I have arrived"** on a confirmed, in-person visit on the clinic's today (Upcoming and, because a clinic day starts before its arrival windows, the Past list too) over `ha-mark-arrived`; refusal sentence shown verbatim. **`/patient/household`** (More → People I book for): the list, an add-member form that calls `pt-add-household-member` (one writer, audited; a minor is refused with the sentence), and the member's visits — **logistics only**: date, place, service (never a confidential line's name), code, status. The booking wizard gains a first step **"Who is this visit for?"** when the list is non-empty; confidential lines are hidden when booking for a member; `for_provisional_id` is sent; the receipt names the member.
- **HA console** — a T-12h banner on `/hospital-admin/scheduling`: published clinic days starting within 12 hours with no clinician named (amber, with the days listed).
- **Not built:** removing a household member (no writer yet — one UPDATE of `revoked_at`, Gate H); the desk has no emergency interstitial (the clerk is on the phone, PRD §2.5 is patient-facing); "Register new" leads to the intake register, since no patient-account registration exists at reception.

### Added — Gate D server: provisional patients, book on behalf, reconciliation, FHIR — 2026-09-13

[ADR 0089](docs/adr/0089-gate-d-identity-and-lifecycle.md). **One GATED migration** (`0060_identity_and_lifecycle.sql`), additive except `appointments.patient_user_id` DROP NOT NULL; applied by the owner via `npm run db:migrate` **before** the Gate D functions (and the re-deployed `pt-request-appointment`) are deployed; `MEDSYNC_PHI_KEY` must also be a Supabase Functions secret.

- **`provisional_patients`** — the booking identity when there is no account (PRD §2.8): encrypted name and phone (one wire format in both runtimes — `_shared/encryption.ts` is `lib/encryption.ts` on Web Crypto, proved both ways by `tests/encryption/cross-runtime.test.ts`), `phone_hmac` blind index (`blindIndex()` in both), dob or age, `reconciliation_state`, `reconciled_*` **set only by `ha-reconcile-identity`** (a test greps for it), 30-day `expires_at` swept nightly when unbooked and unlinked. Staff-only RLS at the hospital that created it or any hospital it is booked at; **no patient policy**. `hospital_id` is NULL for a household member (deviation from §5.8, recorded).
- **`booking_agents`** — one account, many patients (PRD §2.9); **adults only**: `declared_adult` CHECK true, a minor refused with "Booking for a child is not available yet." Agent reads own live links; member reads links about them.
- **`appointments`** gains `provisional_patient_id` (the PROVENANCE — stays after reconciliation; the CHECK is at-least-one), `patient_user_id` nullable, **`void`** in the status CHECK (FHIR entered-in-error, no writer yet), `appointments_select_agent` (an agent reads only bookings they created), `appointments_creator_idempotency_unique`. `patient_intakes` gains the same pair. `sa_audit_log` CHECKs re-issued (+ `reconcile_identity`, `unreconcile_identity`, `add_booking_agent`; + `provisional_patient`, `booking_agent`).
- **`_shared/book.ts`** — the booking core extracted from Gate C's `pt-request-appointment` and used by both writers (a test greps that the allocator, code, window, receipt and reminders live nowhere else). Replay and the rate limit key on `created_by_user_id`.
- **`ha-book-on-behalf`** — desk booking for an existing patient or a caller with no account (encrypted provisional row, then the core); 60 per desk user per hour; audit `book_on_behalf`. **`ha-reconcile-identity`** — `confirm` / `reject` / `unreconcile` (hospital_admin only, reason ≥ 20 chars, audited); confirm links this hospital's appointments and intakes, never touches the MPI. **`pt-add-household-member`** — a patient adds an adult member (provisional + agent link, audit `add_booking_agent`). **`pt-request-appointment`** gains `for_provisional_id` (a live household link required; confidential lines refused) and `provisional_patient_id` in its response.
- **`ha-check-in-patient` / `ha-mark-arrived`** refuse a provisional booking until reconciled (409 "Confirm who this booking is for…"); the intake row carries `provisional_patient_id`.
- **Dispatcher** reads the provisional's phone when the booking has no account, sends only to the member's phone (never the agent's), and never names a confidential service line.
- **`lib/fhir/appointment-r4.ts`** — `FHIR_PROFILE = "r4"`, an exhaustive status map (checked-in derived from an intake row + reconciliation; waitlist stubbed until Gate E), `toFhirAppointment` with Patient / PractitionerRole / Location, `serviceType`, `replaces`. Nothing FHIR is stored or exposed.
- **Not in Gate D's server:** no writer for `void`; no proxy cancel/reschedule; no minors; `reschedule-appointment` keeps its own code + receipt for now.

### Added — Gate C web: the booking wizard over three capacity modes, the receipt on screen, the PWA shell — 2026-09-13

[ADR 0088](docs/adr/0088-gate-c-booking-flow.md). No migration; no red anywhere.

- **`/patient/book` rebuilt on `StepWizardShell`** — reason (Appendix A's 13, title + hint) → the interstitial when the reason is a new problem (static, CSO-provisional copy byte-identical to the phone, the hospital's emergency number as a Call control, one dismiss) → clinic (the lines that take the reason, with "Clinic day" / "Appointment time" / "Same-day queue"; a queue is a door to `/patient/queue`) → the pick (slot: clinician with "Seen you before" first, day, time; session: the line's published days with "N places left" or "Full") → check → the receipt with the **booking code big and monospace**, the position and "Arrive between …" for a clinic day. **No-silent-wait** (PRD §2.4) in order: another clinician in the line, the same-named line elsewhere, "Coming to the hospital today", then the beyond-target days labelled "Beyond this clinic's target of N days". One POST at the end, `channel: "web"`, an idempotency key minted per attempt and replaced on any change of pick; the draft lives in `localStorage` per hospital and is cleared on success. The slot engine's read is extended, not forked.
- **Hospital directory** — a "Verified" pill on every (active) row; search also matches a department or service line name; "Accepting bookings" / "No days open" from one EXISTS over published clinic days and bookable blocks in the next 14 days.
- **Visits** show the booking code and, for a clinic day, the position and arrival window; a session booking says plainly that it cannot be moved yet.
- **Emergency, once** — `EmergencyNotice` renders from `app/patient/layout.tsx` on every patient screen (the per-page copies are gone); the sign-in page carries a plain text link to a static `/emergency` page.
- **PWA shell** — `app/manifest.ts` (standalone, `start_url: /patient`, token colours, 192/512 icons) and `public/sw.js`, which precaches the static `/offline` page and serves it only when a navigation fails; nothing else is cached, no API response ever.

### Added — Gate C server: booking into clinic days, the receipt, the rate limit — 2026-09-13

[ADR 0088](docs/adr/0088-gate-c-booking-flow.md). **One GATED migration** (`0059_receipts.sql`), additive; applied by the owner via `npm run db:migrate`.

- **`pt-request-appointment` books in two modes** — exactly one of `slot { clinician_user_id, department_id, starts_at, ends_at, type?, service_line_id? }` (unchanged behaviour, now with a booking code) or `session { session_id }`. A session booking **confirms at request**: the clinic day must be published, future, within the 14-day horizon, on an active `session`-mode line that takes the reason; capacity is consumed by `allocate_session_position()` (ADR 0087's one UPDATE as a `SECURITY DEFINER` SQL function, `service_role` only); NULL means full → 409 with the line's next two open days from `next_sessions_of_line()`. A failed INSERT after a successful allocation gives the place back (`release_session_position()`), as does cancelling a session booking. A clinic day with no clinician is refused (409) — `appointments.clinician_user_id` is NOT NULL.
- **Booking code and arrival window** — six characters from an unambiguous alphabet, unique per hospital, retried on collision; `arrivalWindow()` derives a **range with a stated basis** (position × pace, ruling C10) once at confirmation and stores it. Response: `{ appointment_id, status, booking_code, position_number, arrival_window_start, arrival_window_end }`.
- **`idempotency_key` is required** and a replay returns the first attempt's full body on both paths; **rate limit** five requests per patient per rolling hour → **429**; `channel` (`web` | `app`) is recorded; the reason vocabulary is Appendix A's 13 + `other`.
- **The durable receipt** — one `appointment_reminders` row of `kind='receipt'` scheduled for now(), composed in one pure place (`lib/notifications/receipt.ts`, GSM-7, ≤160, names cut before the code ever is) and sent by the existing `*/15` dispatcher. A receipt is never stale, never supersedes a reminder, and for a slot request still awaiting approval goes out the run after the clinician confirms. Reminders are unchanged.
- **`reschedule-appointment` refuses a session booking** ("Move this visit from the clinic day list.") — a position is not a time. A rescheduled slot booking's new row gets its own booking code and a receipt; the old row keeps its code.
- **`cancel-appointment`** repeats the status guard in its UPDATE so two concurrent cancels release a session place once.
- **Not in Gate C's server:** no waitlist, no cancel-session, no push, no session reschedule.

### Added — Capacity modes: service lines, session templates, clinic sessions (Gate B) — 2026-09-13

[ADR 0087](docs/adr/0087-capacity-modes.md). **One GATED migration** (`0058_service_lines_and_sessions.sql`), additive except one flagged index re-scope; applied by the owner via `npm run db:migrate`.

- **Three capacity modes on `service_lines.capacity_mode`** — `slot` (unchanged), `session` (default for new lines), `open_queue`. Every existing department is backfilled with one `slot` line, so nothing shipped changes behaviour. No holds (C12). `capacity_booked` defaults to 60 % of `capacity_total`, interleave 2:1 (Part 8 #4); time-to-care defaults are CSO-provisional (Part 8 #5). The dark-mode toggle stays (C8).
- **`session_templates` → `clinic_sessions`**, materialised 14 days ahead by one pure helper (`expandSessionTemplate`, `_shared/slots.ts`) from both `ha-upsert-session-template` and the nightly `cleanup-drafts` cron — idempotent on `(template_id, starts_at)`. Deactivating a rule cancels only its future instances with no bookings.
- **`appointments`** gains `idempotency_key`, `channel`, `session_id`/`position_number`, `arrival_window_*`, `booking_code`; `appointments_reason_check` widened to Appendix A's 13 codes (+ `urgent_review`, `other`). **The one non-additive step:** `appointments_no_double_booking` re-created with `session_id IS NULL` in its predicate — every shipped row satisfies it.
- **Console** — `/hospital-admin/scheduling` gains "Service lines" and "Clinic sessions" editors posting to `ha-upsert-service-line` / `ha-upsert-session-template` (audited `update_service_line` / `update_session_template`).
- **A′ hygiene** — `pt-request-appointment` / `reschedule-appointment` accept `idempotency_key` (a replay returns the same booking; 23505 on the double-booking index is a 409); every "today" boundary reads `startOfLocalDay(now, DEFAULT_TIME_ZONE)` instead of `setUTCHours(0)`/`setHours(0)`; `ha-complete-encounter` writes `appointments.status = 'completed'`; `ha-mark-no-show` admits any staff affiliation at the hospital, with a reception control on `/reception/expected`.
- **Not in Gate B:** nothing books into a session (Gate C); no cancel-session (Gate E).

### Changed — Two doors stay; the labels, the horizon, and the surfaces behind them change — 2026-09-12

The book-or-queue entry point, decided on research rather than instinct and then attacked twice ([ADR 0084](docs/adr/0084-book-or-queue-two-doors-relabelled.md)). **Partially supersedes** [ADR 0034](docs/adr/0034-book-or-queue-choice-point.md) — §§1, 3, 4, 5 stand, §2 is superseded, §6 is extended and its refresh interval revised, and the presentation is replaced. Evidence base: [`docs/booking-entry-points-research.md`](docs/booking-entry-points-research.md), 66 findings with sources and per-finding transfer assessments. **Three additive migrations** (`appointments.reason`, `hospitals.emergency_phone`, and the `sa_audit_log` verb that lets a superadmin write that number); none for the entry point.

- **The question asked was "collapse two doors into one that asks WHEN". The answer is no, and the reason is not the one the vote suggests.** Three of six research angles said keep two; one said collapse; two said the count is not where the harm lives — and the two that declined to vote found the actual defects. "One door or two" decomposes into three questions with three different answers: the count is fine, the **labels** are the hazard, and the **horizon** is what the one-door instinct was really tracking. Collapsing would have made the tree deeper, not shallower — two labelled buttons on one screen **is** a flat list of two, while "a specific date" opens month → week → day → time.
- **The addressable population is stated up front, because it scopes everything else.** Patient signup requires an email and a 12-character password, there is no SMS/USSD/assisted path, and reception cannot declare on a patient's behalf. Uganda's base is ~32M feature phones against ~20.5M smartphones. **"Primary door" means primary within the app** — the app is the minority channel into a hospital that keeps working without it, and the ADR says so rather than implying otherwise.
- **The labels name the act, not the mechanism — and not in the first person.** "Coming to the hospital today / We save your place in line. You will be seen in turn. We cannot tell you the hour." over "Ask for a day — the clinic confirms." No _queue_, _appointment_, _book_, _slot_ or _intake_ anywhere in the flow, not just on the buttons — the legend reading `DEPARTMENT` and the submit reading "Join today's queue" one tap in were the same failure. First person breaks on a shared device (76.1% of women in one Ugandan cohort owned a phone, 92.7% had access to one), so confirmation names the account holder instead.
- **The emergency block asks the patient to recognise a symptom, not to rate themselves.** The draft's "Very unwell right now?" was the self-rating instrument the evidence indicts, rejected in favour of itself — the corpus's own contrast is that ODISSEE reached 85.6% on level of care _because it asked clinical questions rather than asking the patient to rate urgency_, and its transfer note says plainly that "neither door count substitutes for a red-flag safety net." Named symptoms above one unconditional destination take no input, write nothing and branch nowhere, so **an instruction that makes no decision still cannot under-triage anyone** — while giving a man who has decided his chest pain is indigestion something to recognise. List is CSO-authored and CSO-signed, same rule as drug doses. Amber, never red.
- **The emergency number gets a way in, and it is a superadmin dialling it.** `hospitals.emergency_phone` was a column six patient files read and nothing wrote. One Edge Function (`sa-set-emergency-phone`) now records or clears it, callable at any time from the tenants list rather than folded into activation — `sa-activate-hospital` cannot reach a hospital that is already `active`, which is every hospital at the beachhead. The audited free-text reason is the only place "someone rang this and the emergency entrance answered" is ever recorded, because nothing in the stack can check it; clearing is allowed for the same reason, since a number that turns out to ring an empty office at 02:00 is worse than none. No default, no backfill from the self-asserted `hospital_applications.main_phone` switchboard. The block itself now shows to a patient with no primary hospital — no doors, no visits, and previously no emergency instruction either.
- **Three fabricated numbers and promises are deleted from patient surfaces.** "12 people are ahead right now" on the entry screen is a hospital-wide line that does not exist — the queue is department-scoped, and the draft broke the no-fabricated-data rule in the clause that invoked it. "No one waits in line" is an unverifiable claim about an emergency department MedSync cannot observe. Two notification promises ("we'll notify you when slots open", "you'll get a notification when they confirm") run over a transport that logs and returns. A count appears only where it is true, labelled as what it measures.
- **A patient who says they are coming today is never answered with a date picker.** The closed-state exit currently routes to `/patient/book` behind a primary button — under-triage by routing, in the direction the corpus says is dangerous. The primary exit is the hospital; booking demotes to a text link; the unconditional "Not coming today?" footer goes.
- **Two ordering defects became prerequisites, not follow-ups.** `desc(priority_hint)` on a text column sorts **urgent → routine → high**, so reception's one pre-triage escalation control sorted last — in both `lib/triage/worklist.ts` and `lib/intake/queries.ts`, while every patient declaration hard-codes `routine`. And `arrived_at` stamps the _declaration_, while `checked_in_at` is written on every check-in and never read, so declaring at dawn jumped the physical queue all day. Fixed at the root, with a test, before the volume this ADR creates arrives.
- **The patient stops guessing a department as well as a clinician.** The department radio is required and prices each clinical destination by queue length — a wait-shopping instrument for someone with exertional breathlessness, and the documented anti-pattern the draft cited to acquit the _doors_ while missing the screen behind them. Default to general outpatient, rest behind a disclosure. Clinician defaulting is justified on delegation and rota reality (only 11% of Choose & Book patients booked themselves), **not** on choice overload, which does not survive meta-analysis. No ratings, no review counts, no "years of experience" badge, no cart, no checkout verb.
- **The booking horizon is capped at 14 days — in `pt-request-appointment` and nowhere else.** No-shows run 9.1% at 0–2 weeks against 38.3% at six months in the arm that matches us. A schema CHECK or a shared-library guard would also block clinician- and system-created recall, which is exactly what an NCD review is; confined to the patient function it creates no dead end. The horizon is a rule, not a label — the wizard's max date is the defaulted clinician's last open day, so the button names real availability instead.
- **No clock numerals on the patient surface, and the date input goes.** The draft's day-part anchor fixed AM/PM, which was never the bug: the _numeral_ is offset by six (_ssawa bbiri_ is literally "two" and means 8am). Day-part only, and the rule extends past the entry screens to the confirmation — the screen most likely to be read aloud. With a 14-day horizon a `<input type="date">` that degrades to typed `yyyy-mm-dd` on low-end WebViews is replaced by at most 14 day chips. Net deletion.
- **An undocumented supersession is brought back into the record.** ADR 0034 §2 made a scheduling-policy row the walk-in gate; the code now does the opposite — open by default, policy narrows — recorded only in a comment. Ratified here, because it is correct and because the closed-state fix depends on knowing it can never fire on a hospital's first day.
- **The 30-second meta-refresh backs off**, because this ADR is what makes that page busy: at Mulago's median 346-minute wait it is ~690 full reloads, and when the bundle runs out the ticket is replaced by a browser error page with nothing to show the clerk.
- **Four review findings are rejected in writing**, with reasons, rather than silently accepted — including a day-one dead-end whose premise the code contradicts, and a "strict regression" that the client-side cap already prevented.
- **The falsifier is written into the ADR, with the honest gap on top of it:** no usability study, A/B test or trial comparing a single time-first entry against split entries exists in any healthcare product, in any country. Both designs are unevidenced on the direct question. Cheapest falsifier first — 20 exit interviews at Mulago OPD, read both buttons aloud, ask what each does, then ask whether the emergency instruction is something they could act on without transport.

### Added — The examination discrimination layer, and diabetes as its first corpus — 2026-09-08

The examination half of the NCD module ([ADR 0083](docs/adr/0083-examination-discrimination-layer.md)). Extends the protocol engine of [ADR 0082](docs/adr/0082-ncd-protocol-engine.md) and **partially supersedes** its position that the module carries no differential reasoning at all — it does **not** reinstate the v1 weights engine removed in [ADR 0081](docs/adr/0081-remove-clerkship-v1.md). **Ships gated dark** behind `NCD_CLERKSHIP_LIVE`, with the second gate on the content unchanged. **No migration.**

- **Why a differential layer is defensible here when ADR 0082 argued against one.** That argument was about an open-ended "what could this be?" across all of medicine — tuned by hand, never finishable. The examination asks something narrower: a clinician recording Kussmaul respiration, dehydration and a glucose of 27 is separating DKA from HHS from a mixed picture, a **closed set** this catalog already names.
- **Three properties make that safe, and all three are structural.** The condition set is **bounded** — only `catalog.conditions` can be ranked, and a mimic outside diabetes (salicylate toxicity, sepsis with a lactic acidosis) is a named **string**, never a rankable code, so the engine cannot imply it reasons about something it has no criteria for. The output is an **order, not a probability** — the integers the ranker sorts by are a fixed disease-generic ladder in engine code, never tuned, never stored, never rendered. And **every rank carries its evidence**: a ranked condition cannot be constructed without the finding codes that raised it _and_ the codes that argued against it.
- **Rank and confidence are separate axes.** Three findings can produce a perfectly clear order and still not be enough to act on. Conflating them is how a tool built on four answers looks as assured as one built on forty — the failure `Completeness` already exists to prevent.
- **Absence became evidence.** `Feature.suggests` was deliberately weak and one-directional; `importantNegative` now carries what a **recorded** absence argues against, with a **mandatory caveat**. Absent Kussmaul refutes _severe_ DKA and says nothing about mild or early DKA, and a bare list would lose exactly the qualification that stops it being dangerous.
- **Signs discriminate; numbers discriminate through rules.** A glucose of 27 discriminates through a threshold, and a threshold belongs in a cited `Criterion` — not in a second feature beside the measurement, which would create two codes for one number and let them drift.
- **Age bands, honestly scoped.** `AgeBand` is declared in full so deferred content has a home without a later migration, but only `adolescent`, `adult` and `older_adult` are populated. `refRange` is unchanged and `ageRefRanges` is additive, so adding a band to one feature cannot alter another's behaviour. An **unknown** band leaves everything in scope rather than guessing — a quietly narrowed examination is the more dangerous error.
- **The corpus:** 343 features, 37 rankable conditions, 44 rules, and 203 distinct sources across 588 cited assertions. Authored one domain at a time, each re-audited by independent agents instructed to **refute** it.
- **That adversarial pass earned its cost.** It caught an `atLeast: { n: 2 }` whose two predicates encoded one and the same observation (so "two of five" was really "one of four"), `severe_dka` firing on a single non-specific finding, HHS thresholds sitting exactly at the glucometer's "HI" ceiling, two Charcot rules that contradicted each other, and euglycaemic DKA made unreachable at a district clinic by requiring both blood ketones and a gas.
- **Restraint held where it matters:** zero `pathognomonic` claims, zero measurements carrying `discriminates`, and exactly **one** numeric likelihood ratio in the whole corpus — the 10 g monofilament, verified verbatim, with its citation recording that the reference standard was nerve conduction studies and the figures therefore describe _detecting_ neuropathy rather than _predicting_ ulceration.
- **Every condition can be reached by something.** A condition nothing discriminates and no rule names can never be ranked, which makes the differential look more capable than it is — the parsimony rule one level up from findings. Two were removed on that ground (`ketosis_prone_type_2_diabetes`, which `diagnosis.ts` already adjudicates as a `Classification` on the same two tests, and `pancreatogenic_diabetes`, for which nothing in 343 features records the exocrine failure ADA's definition turns on), and three were wired. The removal sites carry the reason, and the empty list is pinned by test.
- **Enforcement, not convention.** The validator now rejects an examination sign carrying no `discriminates` (a finding that cannot change the picture is documentation), rejects a numeric likelihood ratio whose citation nobody can follow, rejects a rule declaring no mimics, and **warns** when a condition is unreachable — with the outstanding ones pinned by name in a test, so the list can only shrink.
- **UI:** a live differential panel — red flags pinned above the ranking and not dismissible, each condition expandable to the findings that raised it _and_ those that argued against it, confirmatory tests shown by clinician-readable name with the catalog code kept as the audit anchor, mimics listed one per line, and a "what to check next" hint naming the one or two unexamined findings that would move the picture most. Copy is `suggests` / `consistent with` / `consider`, never _diagnosis is_, with a persistent confirmation framing. Ranking runs **entirely on-device** from catalog data with no model call, pinned by test.
- **Handover:** [`docs/clinical/ncd/diabetes-exam-handover.md`](docs/clinical/ncd/diabetes-exam-handover.md) is what a Clinical Safety Officer reads first — open questions, recorded ADA/UCG divergences, and every declared unverified item. The index and source list are **generated** (`npm run ncd:manifest`), because a hand-maintained index of 343 codes is wrong within a week.
- tsc + eslint clean; **1164 tests pass**; `npm run build` compiles; 28 acceptance vignettes green with one skipped and named — the nine-year-old, which the paediatric deferral puts out of scope.

### Added — NCD protocol engine, with diabetes as its first catalog — 2026-09-05

The rebuild that follows the v1 removal ([ADR 0082](docs/adr/0082-ncd-protocol-engine.md)). **Ships gated dark** behind `NCD_CLERKSHIP_LIVE`, with a second independent gate on the clinical content itself. **No migration** — `clinical_documentation.section_data` is JSONB.

- **A protocol engine, not a differential engine.** v1 asked "given these findings, what could this be?" — probabilistic, open-ended, a tuned weight file per complaint, and it never finished covering the front door. This asks "is it confirmed, what is staged, what is missing, what does the guideline say next?" — deterministic and bounded. No weights, nothing tuned: every verdict traces to a named threshold from a named body, so a clinician can review it rather than only an engineer.
- **Clinical content is data.** `lib/ncd/catalog/schema.ts` is the grammar; diabetes is a data file against it, and CKD and hypertension will be too. 70 features, 3 criteria sets (WHO/ADA/IDF), 3 classifications, 5 complications, 9 validity caveats.
- **Four invariants enforced by types and tests, not convention:** nothing clinical without a citation (and an unverifiable value must declare itself); a criterion evaluates to **four** states — `met` / `not_met` / `insufficient` / `unavailable` — because collapsing "we looked and it was normal" into "nobody looked" is how a screening tool hurts someone; standards are data, with the applied standard reported on every verdict; and guidance stops at the prescription.
- **The AND/OR precedence is deliberately asymmetric.** Under AND, one unobtainable requirement means the criterion can never be satisfied here, so it must not sit on a gaps list the clinician can never clear. Under OR it does not close the question: if HbA1c is impossible here but fasting glucose is merely undone, _do the test you can do_.
- **The clinical content forced the grammar to grow twice**, rather than the content being approximated: `atLeast` (IWGDF foot risk category 2 is "a combination of **two** of" three findings — neither AND nor OR) and `ValidityCaveat` (NGSP states haemoglobin-variant interference with HbA1c is **assay-specific**, and the bias has a **direction** — shortened red-cell survival _masks_ diabetes, iron deficiency _manufactures_ it).
- **The golden vignettes caught a real bug.** Under ADA a single fasting glucose was reaching `criteria_met`, which no standard permits in an asymptomatic person; the limitation had been written in a comment and that was not enough. `requiresConfirmation` now has teeth, satisfied either by an unconditional route or by two distinct criteria — which is exactly ADA's "two abnormal results, which may be obtained at the same time".
- **Phase 0 research:** 6 domains, **205 findings all fetched from primary sources**, each re-audited by an agent told to refute it — 201 confirmed, 4 misattributions, **0 hallucinated sources, 0 wrong values**, 35 standard conflicts, 76 flagged for CSO input. Each correction is now enforced by a test; the most consequential was the claim that ADA "independently adopts" the IWGDF foot stratification, when ADA Table 12.1 is an adapted reprint — one source appearing twice as two.
- **UI:** catalog-generated capture where every control is tri-state with _not assessed_ as the default, and a feature the site cannot perform is shown as unobtainable rather than as an empty input the clinician can never fill. The live profile gives completeness the same visual weight as the findings, splits gaps into _outstanding_ and _not available here_, and reserves red for the acute interlock alone. Motion is sparse by frequency: controls answered dozens of times per encounter get colour and a press, not animation.
- **Deliberately not built:** type 5 / malnutrition-related diabetes (no diagnostic criteria exist yet), auto-classification of T1 vs T2 from phenotype, and CVD scores without their validated population.
- tsc + eslint clean; **100 NCD tests, 881 overall**; build compiles; `validateCatalog` reports 0 errors and 69 warnings, all the unsigned-citation one.

### Removed — Clerkship v1 capture layer, ahead of the NCD rebuild — 2026-09-05

The v1 clerkship capture engine and its UI are removed so the NCD-specific version can be built on a clean surface ([ADR 0081](docs/adr/0081-remove-clerkship-v1.md), owner-directed). **Archived at tag `archive/clerkship-v1` → `fcaabc5`** — nothing was deleted from history. **No migration**, no schema change, no data change.

- **156 files, 38,507 deletions.** Out: `lib/clerkship/` (symptom engine, ROS, six structured exams, catalogs, reasoning agent, 17 sourced weight files), the clerkship form and all its tabs/panels/rail, its server actions, `tests/clerkship/` (51 files), and the agent packs under `docs/clinical/agent/`.
- **The cut is between capturing a clerkship and having an encounter.** The spine stays, so lab worklist + result entry (ADR 0077), triage→doctor assignment, nurse resus, doctor/assigned, patient clinical records and admin catalog proposals all keep working, untouched.
- **Existing clinical records stay readable.** `lib/encounter/clerkship.ts` survives as a FROZEN v1 document reader. It could be kept because `deriveClinicalObjects` reads only `history.{allergies,medications,pmhItems}` and `synthesis.{differential,problems,investigations,disposition}` — never into the exam/ROS/symptom payloads, which were nine **type-only** imports. Replacing them with an opaque `V1Payload` let the whole engine be deleted without making a single written clinical document unreadable.
- **Catalog governance was not clerkship code** — `lib/clerkship/governance.ts` imported only `db`, the symptom-catalog schema and `logger`. Moved verbatim to `lib/catalog/governance.ts` (100% rename); `app/admin/catalog-proposals/` repointed.
- **Left in place deliberately:** migrations 0040/0045/0048/0049 (applied + immutable; `db:check` reports no drift), the now-importerless `clerkship-drafts`/`clerkship-picklist` schema files, existing `encounter_symptom_observations` rows, and `clerkshipDraftsLive()` (annotated as unread so v2 can switch autosave back on without a migration).
- **The encounter route survives** — patient header, allergies, encounter state, investigations/results and timeline all render. Where the form was there is an honest empty state, not a stub form: nothing may imply clerking was captured when it was not.
- tsc (app + Edge Functions) clean; eslint clean with **0 warnings** (the 6 pre-existing ones were in deleted exam components); **781 tests pass, 0 failures**; `npm run build` compiles.

### Changed — Clerkship: the Review of Systems is now hypothesis-driven — 2026-09-04

The 81-symptom sweep is joined to the ranking engine that was already sitting beside it ([ADR 0080](docs/adr/0080-hypothesis-driven-review-of-systems.md); extends [ADR 0062](docs/adr/0062-review-of-systems-engine.md) and [ADR 0063](docs/adr/0063-ros-pc-suppression-focused-complete.md), governed by [ADR 0065](docs/adr/0065-clerkship-clinical-reasoning-engine.md)). **No migration** — no new persisted state, no catalog change.

- **The gap this closes.** `RosReview` received no agent input at all, so the sweep asked the same questions in the same order for every patient while the engine next to it held a live weighted differential from 17 sourced weight files. ADR 0065 promised to propagate discriminating prompts into the ROS; that propagation was only ever built for the Assessment tab (now deleted) and the rail, and `discriminatorsFor` hardcodes `area: "complaint"` so it could not route here in principle.
- **Three lanes** replace the single accordion: **Ask next** (top 6 by discrimination, re-ranked live) · **Red flags** (all 19 unanswered must-not-miss screens, never capped, never ranked out) · **Full sweep** (the 12-system accordion, unchanged).
- **New pure engine** `lib/clerkship/agent/ros-priority.ts`: simulates each unanswered screen as "present", re-scores the live hypotheses and measures how far apart they move. Gain = `separation` + leader-flip + top-3 entrants, damped ×0.35 when a question's only effect is to raise the current leader, plus an undamped +4 when it would satisfy an unpinned must-not-miss gate.
- **The anti-anchoring guarantees are the design test, and are asserted:** a uniform lift scores **zero however large** (magnitude is not gain — spread is), and a confirm-the-leader question ranks **below** a separating one even at twice the raw lift. The pin bonus is added after the damp and scanned over the whole differential, not the ranked window. With <2 live hypotheses the engine stays silent, because every question could then only confirm.
- **Honest reasons.** Each question says what it would change — _"Separates Tuberculosis from ACE-inhibitor cough"_, _"Would raise Malaria — a must-not-miss"_. A test asserts every diagnosis named in a reason line is actually in the live differential for that input. Vocabulary is the existing curated `FEATURE_ALIASES` bridge only; no fuzzy matching added.
- **ADR 0063 coverage honesty untouched** — coverage still comes from what was answered, never from what was offered; not-reviewed is still never auto-marked negative. The lanes re-order and remove nothing. Red flags deliberately ignore focused scope (a focused sweep is a choice about depth, not a licence to drop a must-not-miss); the ranked lane respects it and offers a one-tap Include for what it held back.
- **Graceful degradation** — with `AGENT_DDX_RANKING_CSO_SIGNED` off, or before a complaint is captured, the ranked lane is empty, the red-flag lane is still complete (it is catalog-driven) and the sweep renders exactly as before.
- **UI**: teal Ask-next card with a live-rank dot and a FLIP re-order (expo-out, 250 ms, nothing under `prefers-reduced-motion`) so the clinician can see their answer change the priorities; amber two-column red-flag lane with a remaining count; the sweep collapsed behind a header when a ranked lane leads. Property capture on a screen is now **opt-in** (`+ detail`) instead of springing open on every positive.
- **Not done:** promoting a positive screen into the HPC — `pcSystems` derives from all `hpcItems`, so it would collapse that whole system out of the sweep (ADR 0063 Rule 1). Recorded in the ADR with the reason.
- Ranking costs **0.74 ms** for all 81 screens. tsc/eslint/prettier clean; **1138 tests** (+22).

### Removed — Clerkship: the Assessment tab — 2026-09-04

The clerkship form's fifth step is removed ([ADR 0079](docs/adr/0079-remove-assessment-tab.md), owner-directed; supersedes in part [ADR 0074](docs/adr/0074-assessment-as-diagnostic-logic.md) and [ADR 0076](docs/adr/0076-diagnosis-feature-reconciliation.md)). **No migration** — the `synthesis` schema is untouched.

- `TABS` drops from five steps to four (Complaint · Review of Systems · Background · Examination); `assessment-tab.tsx` deleted.
- **No commit surface for a working diagnosis remains.** `synthesis.differential` can no longer be populated by a new encounter, so `encounterRecords` derives no diagnoses for encounters clerked after this change, and the `summary`/`differential` sections become unreachable — joining `investigations`/`managementPlan`, which already were. `clerkshipStatus` gates nothing, so nothing errors.
- **The ranked differential is not lost, but is now read-only.** All 17 sourced weight files and the ranking engine still run and the live rail still renders the tiered differential with its evidence and must-not-miss group — what goes is the ability to act on it (no Agree/Exclude/commit). Rail copy updated: it previously said "commit on the Assessment tab", which would now dangle. Feature reconciliation (0076) is dormant, not deleted — nothing triggers it.
- **Existing records preserved deliberately.** `buildClerkshipInput` sends the whole payload each save, so dropping the state would have wiped `summary`/`differential` from previously-clerked encounters on the next autosave. Both are still rehydrated and echoed back unchanged — no longer editable, never destroyed.
- tsc/eslint/prettier clean; **1116 tests** (unchanged — no test covered the deleted surface).

### Added — Clerkship agent: vitals + anthropometry as diagnosis feature tokens — 2026-09-04

Recorded vitals now reach the ranked differential, and the clerkship can finally record a weight ([ADR 0078](docs/adr/0078-vitals-anthropometry-feature-tokens.md)). **No migration** — clerkship sections persist as JSONB, so the new `RecordedVitals` fields need no schema change. Inherently dark in prod until `AGENT_DDX_RANKING_CSO_SIGNED`.

- **The gap this closes** was found by the adversarial review of the weight_loss chunk: `RecordedVitals` had no weight, height, BMI or MUAC anywhere, and `examVitals` never reached `buildFeatureIndex` — so a random glucose of 19 could not rank "New diabetes mellitus", and the weight-loss complaint ran in an EMR that could not record a weight.
- **Anthropometry** (`weightKg`, `heightCm`, `muacCm`) + a pure `bmi()` helper that returns `undefined` unless BOTH weight and height exist — a missing height is never a default height. MUAC is carried deliberately: it is the standard adult nutrition screen in Ugandan TB/HIV programmes and needs only a tape, not a working scale.
- **Twelve threshold tokens**, every cut-off a named published one (WHO/ADA glucose, WHO fever, NEWS2 bands reused rather than re-authored, WHO adult BMI, Ugandan programme MUAC). **Not-measured is never normal** — a token is emitted only when the measurement was recorded, so an empty or normal vitals set produces no tokens. Opt-in by exact token name, so no existing chunk's ranking shifts by accident.
- **Nutrition row** in the vitals panel (weight · height · MUAC) with a derived BMI chip that always pairs colour with the word (`BMI 15.6 · severe thinness`); clinical-red reserved for BMI < 16.
- Consumed immediately: weight_loss ranks TB/HIV/inadequate-intake on `bmi under 18.5` + `muac under 23` and New diabetes on `random glucose over 11.1` (+4); dizziness gains the glucose tokens on Hypoglycaemia. **NOT done:** renaming "New diabetes mellitus" (it matches the CSO-approved map by exact name) — recommended as a CSO action.
- tsc/eslint/prettier clean; **1106 tests** (+8).

### Added — Clerkship agent: in-field soft-dim of incompatible signs — 2026-06-17

The clerkship agent's incompatibility signal now surfaces **on the exam control itself**, not only in the rail (agent behaviour #3). When a recorded sign makes another implausible per the cited, CSO-signed incompatibility pack, the implausible chip **softly dims** (faded, dashed, italic) with the cited reason. **No migration.** Inherently dark in prod until `AGENT_INCOMPATIBILITIES_CSO_SIGNED`.

- **Soft-dim + override, never a hard block** (decision-support, never autonomous) — a dimmed chip stays tappable; recording it un-dims and the conflict then shows in the rail. The clinician is never prevented from documenting a genuine finding.
- **Pack-driven, anchored binding** (`lib/clerkship/agent/in-field.ts`, pure/TDD) — the clinical assertion (trigger → excluded sign → reason) comes only from the cited pack; the code binds tokens to option values by an **allow-listed, whole-word** map (no substring collisions), so a sign the pack does not exclude is never dimmed and each chip shows the reason of the rule that excluded it. Scope: the respiratory added-sounds chips (crackles/wheeze dim at a zone with absent breath sounds) — the pack's only chip-renderable rule today; zone-local.
- Pre-ship adversarial review (gating-dark / no-fabrication-pack-fidelity / never-block-honesty / zone-locality-a11y) confirmed 4 findings (2 latent pack-fidelity, 2 nits) — all fixed. tsc/eslint clean; **982 tests** (+7); build green.

### Added — Lab: result entry → release/reject (the lab write-side slice) — 2026-06-17

The lab-tech workspace gains the full result lifecycle ([ADR 0077](docs/adr/0077-lab-result-entry-release.md)). **Ships gated dark** (`LAB_RESULTS_LIVE=1` after migrations 0050 + 0051 are applied); uses the GATED 0050 columns from PR #138 plus **one new GATED migration 0051** (a unique index = one result row per order).

- **Server actions** (`app/lab/actions.ts`, mirror the clerkship write precedent): `enterLabResultAction` / `releaseLabResultAction` / `rejectLabResultAction` — `requireLabTechScope` + hospital re-check + `labResultsLive()` gate + append-only `encounterEvents` (kind `result`) audit.
- **entered ≠ released** — entering records `qualityStatus='entered'` (NOT visible to the clinician); a deliberate release sets `releasedAt/By` + moves the order to `resulted`; reject needs a reason (recollect). One result row per order (the non-released row is editable; a released result is frozen).
- **Release-aware clinician read** (`loadEncounterOrders`, gated) — only released (or legacy) results show as final; entered = pending, rejected = recollect. Legacy path selects only pre-0050 columns (safe un-migrated). All three reads collapse the orders→results join to one row per order (defence in depth; 0051's unique index makes a duplicate impossible).
- **Critical flag** computed on entry via the gated `evaluateCriticalFlag` (inert until `CRITICAL_VALUES_CSO_SIGNED`); the `sa_notifications` fan-out to the ordering clinician is a documented follow-up (needs a notification-kind migration).
- `/lab` worklist rows gain enter-form + release/reject controls when live. No fabrication; pending/rejected ≠ normal. Pure validation/critical-flag unit-tested; tsc/eslint clean; **975 tests** (+5); build green.

### Added — Clerkship: NCD catalog surfaced + diagnosis-driven feature reconciliation — 2026-06-16

The NCD catalog is now **visible** and a diagnosis, when selected, **reconciles itself against the whole clerkship** ([ADR 0076](docs/adr/0076-diagnosis-feature-reconciliation.md)). **No migration.**

- **NCD catalog surfaced** (`NCD_CATALOG_CSO_SIGNED=true`) — the diabetes **types** (T1/T2/with-complications) + all 15 NCDs are now selectable in the ranked suggestions + the catalog picker. Per-criterion honesty kept: confidence shown, the 17 `needs_cso_input` thresholds flagged; criteria inform/display, **never auto-diagnose**; the clinician selects.
- **Feature reconciliation** (`lib/clerkship/diagnosis/reconcile.ts`, pure/TDD + `diagnosis-reconciliation.tsx`) — selecting a diagnosis scans the clerkship for its supporting features and shows **present** (already captured → auto-confirmed ✓) vs **missing** (blank ＋). e.g. selecting diabetes ticks the polyuria/polydipsia already captured and leaves the rest blank. **Tap a missing symptom to capture it** as a present ROS observation (deduped); **nothing is auto-filled** — a missing feature stays missing until tapped. Code→display resolved from the live catalogs.
- Decision-support, never autonomous; capture only on the clinician's tap. Pre-deploy adversarial review (no-fabrication / capture-correctness / live-NCD-safety). tsc/eslint clean; **1006 tests** (+13); build green.

### Added — Clerkship: NCD-prioritised diagnosis catalog + catalog picker — 2026-06-16

The diagnostic-logic Assessment gains a chronic-disease (NCD) layer + a doctor's searchable "select a diagnosis from the catalog" picker ([ADR 0075](docs/adr/0075-ncd-diagnosis-catalog.md), extends ADR 0074). **Ships gated dark** (`NCD_CATALOG_CSO_SIGNED=false`); **no migration**.

- **15 prioritised NCDs** (`lib/clerkship/diagnosis/ncd-catalog.ts`) — T2DM/T1DM/diabetes-with-complications, hypertension, dyslipidaemia, heart failure, IHD, CKD, COPD, asthma, stroke, chronic liver disease, hypo/hyperthyroidism, RHD. Supports **derived from existing HPC/ROS + condition codes** (a CI test asserts every code is defined in the seed SQL — invented codes fail the build). **Defining criteria fetched + cited + version-stamped** (WHO/Uganda-first → ADA/ISH/ESC/KDIGO/GOLD/GINA/ATA/WHF fallback), persisted at `docs/clinical/ncd-defining-criteria-research.json`; 17 `needs_cso_input` markers. ICD-10 only from verified codes.
- **Matching** (`ncd-suggest.ts`, pure/TDD) ranks by support; must-not-miss surfaces regardless; criteria **inform + display what's met vs not, never auto-diagnose**; not-measured ≠ normal.
- **Catalog picker** (`diagnosis-picker.tsx` + `search.ts`) — acute (live) + NCD (gated), NCDs first; commits via the **same differential→encounterDiagnoses path** as a ranked suggestion (one record, no fork). One-source-of-truth with the reasoning maps preserved.
- **Pre-deploy adversarial review (15 agents)** — caught + fixed a real risk-factor matching bug (PMH displays vs condition codes); the "invented codes" finding was a false positive (reviewers missed the 572 ROS codes), now guarded by seed-SQL code-validity tests. Decision-support, never autonomous. tsc/eslint clean; **999 tests** (+18); build green. **Activate:** flip `NCD_CATALOG_CSO_SIGNED` after the CSO ratifies the criteria.

### Changed — Clerkship: Assessment as diagnostic logic (catalog-driven suggestions) — 2026-06-14

The Assessment now **reads the whole clerkship, matches captured features against a diagnosis catalog, and surfaces ranked, evidence-backed diagnosis suggestions the clinician selects from** — replacing the problem-list ([ADR 0074](docs/adr/0074-assessment-as-diagnostic-logic.md), supersedes [ADR 0073](docs/adr/0073-clerkship-problem-list-synthesis.md) for this surface). **No migration.**

- **Diagnosis catalog** (`lib/clerkship/diagnosis/catalog.ts`, pure/TDD) — a RE-PIVOT of the 17 CSO-signed reasoning maps, **derived at runtime** (structural one-source-of-truth — a map change flows here; never a parallel body). Inverts every differential into diagnosis-keyed entries with assembled supports + presentation provenance + must-not-miss. ICD-10 linked **only** from verified `ICD10_CODES` by name, else null (never fabricated); `workupRef` placeholder.
- **Support-matching adapter** (`suggest.ts`, TDD) — **borrows the reasoning engine** (re-presents its `ScoredDifferential` + matched evidence, joined with catalog metadata); cannot diverge from the rail. Ranks by support; **must-not-miss floats regardless of support**.
- **Surface** — ranked evidence-backed suggestions (the "why" shown) + **Select / Reject / Add-own** (ICD-10 typeahead); Select carries the catalog ICD-10 + feeds the workup seam (next build); Reject keeps "considered & excluded". The **problem-list proposer is removed** (Zone 3 + the problem-synthesis engine deleted); the patient longitudinal `problem_list` is unaffected (still fed from PMH at `deriveClinicalObjects`).
- Decision-support, never autonomous; no fabrication; not-examined ≠ normal. Pre-deploy adversarial review (parity/safety/clean-removal) — **0 confirmed findings**. tsc/eslint clean; **975 tests** (+14 catalog/adapter, −8 removed); build green. **Open follow-ups:** the 151 `«»` free-text features + ~85 null ICD-10 codes pending CSO curation/web-verification.

### Changed — Clerkship: Problem-list synthesis (reasoned problems-with-evidence) — 2026-06-14

The proposed problem list now **reasons across symptoms + signs + risks + abnormal vitals into the most-likely problems, each carrying its evidence underneath** — instead of listing each raw abnormal vital as its own line ([ADR 0073](docs/adr/0073-clerkship-problem-list-synthesis.md), supersedes the per-vital display). CSO-signed model (GATE A). **No migration.**

- **The synthesised problem IS the reasoning engine's leading hypothesis** (`lib/clerkship/problem-synthesis.ts`, pure/TDD) — not a second diagnosis-engine. It reuses each `supported` `ScoredDifferential`'s own evidence (symptoms/signs/risks) verbatim and nests it under the problem. Honest wording: **"likely … (working)" + status chip**; the diagnosis of record stays the clinician's.
- **Abnormal-vital safety net (conservative, clinician-confirmed):** a vital is absorbed as evidence only when its body system matches one the hypothesis draws support from (the differential's `supportingSymptoms` systems + a small vital→system map; temperature deliberately unmapped). Default standalone. **No abnormal vital is ever dropped** — it is nested under a shown problem, carried as evidence under a confirmed problem, or surfaced standalone ("unexplained · for review"); excluding a problem returns its vitals.
- **Reconciled with the differential-decision into one coherent record** — confirming a synthesised problem agrees the differential + commits it with evidence; rejecting keeps it "considered & excluded" (must-not-miss retained). `ClerkProblem.evidence[]` persists in the versioned section_data.
- **Pre-deploy adversarial review (7 agents)** caught a real evidence-persistence defect (dropped at the form boundary → could resurface an absorbed vital standalone) — fixed + locked with a round-trip regression test. tsc/eslint clean; **970 tests** (+10); build green.

### Added — Clerkship: Endocrine · Vascular · Diabetic-Foot exam pack (NCD) — 2026-06-12

The NCD-focused exam pack ([ADR 0072](docs/adr/0072-clerkship-endocrine-vascular-foot-examination.md)) — one card, three sub-tabs (Thyroid status / Peripheral vascular / **Diabetic foot**). Catalog supplied in full. **No migration.**

- **Diabetic foot (the centrepiece)** — per-foot skin/deformity + a **10 g monofilament map** + vibration + foot pulses + Charcot/infection; yields an **IWGDF 2023 risk category** (web-verified cited constants — 0/1/2/3 + active) that is **clinician-confirmed (never auto-assigned)** and feeds the monitoring re-exam interval (engine stubbed → honest state).
- **Peripheral vascular** — arterial look, pulses by name × side (tap-to-cycle), **ABPI with verified interpretation** (NICE CG147: <0.9 PAD · <0.5 critical · >1.4 calcified→TBI), Buerger's, the **6 P's** of acute limb ischaemia, venous + DVT flag.
- **Thyroid status** — peripheral/eyes/gland clusters → hyper/hypo + storm/myxoedema/compressive/malignant flags.
- **Cluster engine** (pure/TDD, 21 tests): acute limb ischaemia / diabetic-foot sepsis / acute Charcot emergencies; osteomyelitis; neuropathic-vs-ischaemic foot; arterial-vs-venous ulcer — transparent, never auto-diagnoses. Reuses neuro sensory + CVS pulses; feeds the live differential. tsc/eslint/build clean; **916 tests** (+21).

### Added — Clerkship: Musculoskeletal Examination (GALS + regional + arthropathy patterns) — 2026-06-12

The fifth system-exam layer ([ADR 0071](docs/adr/0071-clerkship-musculoskeletal-examination.md)) — a new sixth card (MSK) in the Examination switcher. Catalog supplied in full. **No migration.**

- **Two-level**: GALS screen (3 questions + G/A/L/S domains; "Normal GALS" fast path) → regional **Look·Feel·Move cards** by joint & side with region-specific LOOK extras, structured ROM, and **tap-to-cycle special tests** (Phalen's/Schober's/Thomas/McMurray's/Simmonds…).
- **Pattern characteriser** (distribution/symmetry/joint-size/stiffness/character) driving the arthropathy engine: **septic arthritis (any hot joint — emergency)**, RA, OA, **gout (hot 1st MTP broadens to gout AND septic)**, spondyloarthropathy, psoriatic, **rheumatic fever**, **sickle-cell (dactylitis broadens — Uganda)**.
- **Back-pain red-flag screen** — prominent; **cauda-equina options reused from the neuro exam**; cord/malignancy/infection (Pott's)/fracture groups; mechanical back pain is exclusion-only.
- Findings + patterns feed the live differential. tsc/eslint/build clean; **895 tests** (+16).

### Added — Clerkship: Neurological Examination (structured grading + by-limb + localisation) — 2026-06-12

The fourth + largest system-exam layer ([ADR 0070](docs/adr/0070-clerkship-neurological-examination.md)) — completes the Examination tab (all five systems now structured). Catalog supplied in full. **No migration.**

- **Structured grading** — GCS E/V/M (≤8 surfaced as airway emergency; reuses gcsTotal), MRC power 0–5 (tap-to-cycle per limb), reflex grades (absent→clonus), tone, plantar (down/up/equivocal) — all tapped, never typed.
- **By-limb (4-limb grid)** — power + per-limb tone/reflex; plantars per side; sensory by pattern (dermatomal/glove-and-stocking/sensory-level/hemisensory/dissociated) + Romberg; gait + DANISH cerebellar; meningism + cauda-equina screens; higher-function/cranial-nerve findings.
- **Localisation engine** (`matchNeuroPatterns`, pure/TDD 15 tests) — UMN vs LMN + neuraxis level (cortical-stroke/cord/cerebellar/parkinsonism/neuropathy/myopathy/NMJ/radiculopathy/mononeuropathy); emergencies ranked first (GCS≤8 · raised ICP · cord compression · cauda equina · meningism · stroke); Uganda differentials woven in; transparent, multiple-on-ambiguity, never auto-diagnoses; consistent with the resus Disability step + confusion/focal_weakness maps.
- Replaces the last free-text (Neuro) card in the Examination switcher; findings + localisation feed the live differential. tsc/eslint/build clean; **879 tests** (+15).

### Added — Clerkship: Abdominal Examination (tap-first IPPA by region + organs + PR + constellation) — 2026-06-12

The third system-exam layer ([ADR 0069](docs/adr/0069-clerkship-abdominal-examination.md)) — catalog supplied in full. **No migration.**

- **9-region grid** (3×3 tap-to-cycle): tenderness (tender→deep) + guarding (voluntary→involuntary) per region; rigidity/rebound/percussion-tenderness controls.
- **Structured organs** — liver (span/edge/craggy/tender/pulsatile), spleen (extent incl. massive-to-RIF/notch), kidneys, **aorta (expansile = alarm)**, bladder; **structured mass cards** (region/size/surface/edge/consistency/mobility/expansile/tender).
- **Ascites tests** (shifting dullness/fluid thrill), **loss of liver dullness (perforation alarm)**, bowel sounds, bruits, succussion splash; named signs (Murphy's/Courvoisier's/Rovsing's/psoas-obturator); GI stigmata + inspection (5 F's, named scars, Grey Turner's/Cullen's, hernias).
- **PR honesty control** — examined/not-examined/declined + findings; prose always states PR status; the normal-exam fast path leaves PR not-examined.
- **Constellation → pattern** (pure/TDD, 19 tests): peritonitis/AAA/perforation emergencies ranked first; obstruction; ascites; portal HTN; CLD; hepatomegaly (craggy → HCC flag); **massive splenomegaly with the Uganda differential**; β-hCG/ectopic + GI-bleed-shock safety prompts — transparent, multiple-on-ambiguity, never auto-diagnoses.
- Replaces the free-text Abdomen card in the Examination switcher; findings + constellation feed the live differential. tsc/eslint/build clean; **864 tests** (+19).

### Changed — Clerkship: CVS exam finding qualifiers (magnitude + location) — 2026-06-12

Findings now carry their clinical detail, tap-first ([ADR 0068](docs/adr/0068-clerkship-cardiovascular-examination.md) addendum). **Displaced apex** → interspace (5th/6th/7th ICS) + line (mid-clavicular / anterior-axillary / mid-axillary); **raised JVP** → height above the sternal angle (4–10 cm / to earlobes); qualifiers appear only when the finding is positive and clear when it's toggled off (never orphaned). Pulse **volume** row surfaced (was typed but unrendered). Same sweep elsewhere: CVS oedema extent (ankle→thigh/sacral), hepatomegaly span/character, lung-base crackle laterality+extent, lymph-node **size** chips (<1 / 1–2 / >2 cm) across all node groups, peak-flow severity bands. Prose renders the detail ("JVP raised (7 cm)", "Apex displaced (6th ICS, anterior axillary line) thrusting"). No migration; 845 tests.

### Added — Clerkship: Cardiovascular Examination + per-system card switcher — 2026-06-12

The Cardiovascular exam ([ADR 0068](docs/adr/0068-clerkship-cardiovascular-examination.md)) — tap-first **I-P-A** (no cardiac percussion) with **structured murmurs** (timing/location/radiation/intensity/pitch/manoeuvre — tapped) and a **valve-lesion / HF / IE / tamponade cluster** matcher (`matchCvsPatterns`, pure/TDD): transparent, multiple-on-ambiguity, must-not-miss + emergencies flagged in red, never auto-diagnoses; Uganda rheumatic woven in. **No migration.**

The **Examination tab is now a per-system card switcher** — vitals on top, then segmented **General · Cardiovascular · Respiratory · Abdomen · Neuro**, each its own card (a teal dot marks systems with findings). General/Respiratory/Cardiovascular structured; Abdomen/Neuro free-text placeholders. Also fixed: the respiratory **Added-sounds** grid no longer pre-selects "lower right" — you tap a zone first. tsc/eslint/build clean; **841 tests** (+12). _CSO to verify the authored CVS finding set + murmur model + cluster signatures._

### Changed — Clerkship: full-bleed encounter workspace + docked reasoning rail — 2026-06-12

The encounter clerking page now runs **full-bleed** like the resus/triage desks — the doctor sidebar + top bar are hidden (`FullBleedGate` extended to `/doctor/encounters/[id]`), replaced by a focused workspace top bar (back to Encounters · patient · hospital/cadre · sign out). The extra width lets **Clinical reasoning dock as its own right-hand rail** (sticky; stacks below the form on narrow screens) instead of the slide-over drawer — live + non-blocking. No migration.

### Changed — Clerkship: Examination UI declutter + GCS by component — 2026-06-12

- **Clinical reasoning moved to a slide-over drawer** — toggled by a floating "Clinical reasoning" button; non-modal (stays live while you keep tapping the form). The clerkship form now uses the **full width** (no squeezed right column), un-cramming the Examination tab.
- **Vitals GCS captured by component** — Eye (1–4) · Verbal (1–5) · Motor (1–6) selects with a computed, colour-banded **GCS /15** total (≤8 red), instead of a single overall-score field. NEWS2 consciousness still derived from the total. No migration.

### Added — Clerkship: Respiratory Examination (tap-first IPPA + zonal + cluster→pattern) — 2026-06-11

The first **system-specific** exam layer onto the general exam ([ADR 0067](docs/adr/0067-clerkship-respiratory-examination.md)). **No migration** — code-module catalog; captured in `section_data`.

- **Tap-first IPPA + zonal** — percussion / breath sounds / vocal resonance / added sounds captured **per zone** (upper/mid/lower × L/R) via a tap-to-cycle grid; trachea + expansion (per side); non-zonal findings reuse the general-exam three-state model; **"normal respiratory exam" fast path**. Peripheral overlap (clubbing/cyanosis/nodes/JVP) reused from the general exam, not duplicated.
- **Sign-cluster → pattern** (`matchRespPatterns`, pure/TDD) — surfaces consolidation / effusion / pneumothorax / **tension pneumothorax** / collapse / fibrosis / COPD / **stridor** the recorded cluster fits; **transparent**, **multiple on ambiguity** (broadening), **must-not-miss + emergencies flagged in red**, empty when nothing recorded — **never auto-diagnoses**.
- **Reasoning thread** — findings + matched patterns feed the differential. Replaces the free-text "Respiratory" field; CVS/abdo/neuro remain free-text. tsc/eslint/build clean; **829 tests** (+11). _CSO to verify the authored finding set + cluster signatures vs. the full catalog._

### Added — Clerkship: General Examination (tap-first findings + vitals + reasoning) — 2026-06-10

The Examination tab's general survey as **tap-first** capture ([ADR 0066](docs/adr/0066-clerkship-general-examination.md)). **No migration** — code-module catalog; ships on deploy.

- **Three-state findings** (present / absent / **not-examined**; not-examined ≠ normal) + value-set chips, finding-grouped (inspection · spot-diagnosis · hands · face/eyes/mouth · neck · lymphoreticular/peripheral) with a **"normal general exam" fast path**. Catalog `lib/clerkship/exam/catalog.ts` (CSO-signed, Hutchison Ch 2); engine pure/TDD (8 tests).
- **Vitals** — carry the triage set forward read-only (`loadTriageVitalsAction` → triage `vitalsSnapshot`) + **record new**; interpretation **reuses NEWS2** (`scoreNews2`, no new thresholds) with the **scores-0-≠-normal** discipline + trend arrows. Monitoring engine not built → honest "not yet attached" state; capture not rebuilt.
- **Reasoning thread** — the differential's exam targets surface in the panel; recorded findings **feed back** (present → positives, absent → negatives) so it re-weights live. Never predicts/auto-records/auto-diagnoses.
- General-first; system exams (CVS/resp/abdo/neuro) stay free-text, flagged as later focused modules. tsc/eslint/build clean; **818 tests**.

### Added — Clerkship: reasoning discriminator tap-options (GATED) — 2026-06-10

Migration **0047** (GATED) makes the live reasoning re-ranking match **exactly**, not just by keyword. An audit found only **34 genuine gaps** (the other flagged features already keyword-match curated options); 0047 adds a per-PC **"Discriminating features"** multi-select seeded with those gaps (31 options across 12 PCs), mapped to the symptom(s) the clinician taps — additive, does not touch the curated 0043 SOCRATES properties; reuses `symptom_property`/`_option`/`_map` (no new tables). Enriched maps (113 differentials, 65 must-not-miss) + cross-system support/refute already shipped. Artifact: `docs/clinical/enriched-reasoning-maps.json`.

### Changed — Clerkship: live floating reasoning + fully tap-first Background — 2026-06-10

- **Live reasoning** — the reasoning panel now RE-RANKS as the clinician taps: rule-in features raise a candidate, rule-out/denials lower it (`scoreReasoning`, pure/client-side — no API, no latency). Transparent (shows the matched +/− features), surfaces **what to ask/examine next** + **risk factors present vs to-check**, and **never drops a must-not-miss** (only re-ranks). Now a **floating, collapsible side panel** that moves with the clerkship.
- **Background fully tap-first** — every field is now selectable (dropdowns / chips / year & number pickers); removed all free-text inputs, the search boxes, the redundant **SOCRATES** grid, and the "Other notes" field. `tap-controls.tsx`. +5 tests (812 total).

### Added — Clerkship: Clinical Reasoning Engine (anti-anchoring, decision-support) — 2026-06-10

A stateful, anti-anchoring reasoning thread across the clerkship ([ADR 0065](docs/adr/0065-clerkship-clinical-reasoning-engine.md)). **No migration** — maps are code reference data; ships on deploy.

- **Always plural, never a diagnosis-giver** — from the presenting complaint the engine forms an always-plural **differential (likely + must-not-miss)**; it is structurally incapable of returning one answer. A test asserts **every one of the 17 maps carries ≥1 must-not-miss**.
- **Propagation as suggestion** — discriminating HPC features, associated symptoms to rule in/out, red flags, **hypothesis-driven examination targets**, and history emphasis — all _consider/ask/examine_, never pre-fill or conclude.
- **Anti-bias by design** — transparent (shows which maps fired + per-dx rule-in/out), qualitative likelihood (not probabilities), the **known-disease anchoring trap** ("is this different from usual?"), and a **diagnostic pause/time-out** at synthesis.
- **Maps** `lib/clerkship/reasoning/maps/` — 17 CSO-signed worked presenting complaints (§3): 206 differentials, 107 must-not-miss. Transcribed via a 17-agent workflow → deterministic assembler. **Engine** `lib/clerkship/reasoning/engine.ts` (pure/TDD, 10 tests). **UI** a persistent collapsible reasoning panel above the clerkship tabs (must-not-miss/red-flags = amber attention).
- Removed the redundant free-text **SOCRATES** grid from Background (captured via tapped symptom properties). Decision-support, not autonomous — nothing auto-marked; reasoning is never persisted as a diagnosis. tsc/eslint/build clean; **807 tests**.

### Added — Clerkship: remaining history sections (PMH/PSH/Drug/Family/Social/ICE), tap-first (GATED) — 2026-06-10

The rest of the clerkship history as **tap-first** structured capture ([ADR 0064](docs/adr/0064-clerkship-history-sections.md)) — a normal full history with little or no typing. **Migration 0046 is GATED.**

- **Pick-lists** — one governed `clerkship_picklist` (condition[shared PMH+FH]/operation/allergen/drug/occupation/exposure/immunisation), RLS + immutable attribution. Seed: **117 CSO-signed items**.
- **PMH** (conditions + status/year/complications + always-screen toggles) → **problem_list**; **PSH** (operations + anaesthetic); **Drug Hx** (drug pick-list + dose/freq/adherence) → **encounter_medications**; **Allergies** (allergen + reaction/severity, **NKDA** tap) → **patient_allergies** (surface at prescribing).
- **Family Hx** (relative + condition + quick screens); **Social** — smoking → **pack-years auto-calc**, alcohol → **CAGE** 4-tap, drugs (sensitive), occupation + exposures, living/function/mobility, lifestyle; **ICE**.
- **Explicit recorded negatives** (NKDA / none / non-smoker), never blank. **Carry-forward** — a returning patient's record surfaced to confirm/import, not re-enter. **Governed ad-hoc** "Other (specify)" stays per-encounter local.
- Structured entries live in `section_data` (no migration); engine `lib/clerkship/history.ts` (pure/TDD, 12 tests). Sensitive sections wellbeing-framed; CAGE = prompt, not label. tsc/eslint/build clean; **797 tests**.

### Added — Clerkship: ROS system logic — PC-suppression + focused/complete — 2026-06-10

Two pieces of clinical logic on the Review of Systems + a UI pass ([ADR 0063](docs/adr/0063-ros-pc-suppression-focused-complete.md)). **No migration** — coverage lives in `section_data`.

- **PC-system suppression** — the presenting complaint's owning system(s) (derived from all HPC symptoms' `system`; multi-system, bias to include) are **covered in the HPC** and not re-screened in the routine ROS — shown with a "covered in HPC" chip, **still openable**.
- **Focused vs Complete** — scope selector: Complete (all non-suppressed systems, default) or Focused (tap which systems to review); switch anytime; PC-suppression applies in both.
- **Coverage honesty** — per system the record distinguishes **findings / all-negative / HPC-covered / not-reviewed**, and **not-reviewed is never auto-marked negative**. Honest summary via `renderRosSummary`.
- **Engine** (pure/TDD): `RosScope`, `rosCoverage`, `renderRosSummary` (+3 tests). `history.rosScope` carried through the input/mapper. **UI** reworked: scope selector, honest roll-up (reviewed / covered-in-HPC / not-reviewed), per-system covered-in-HPC + focused-out + sweep states. Assists, never hides; nothing auto-marked. tsc/eslint/build clean; **785 tests**.

### Added — Clerkship: Review of Systems (ROS) engine (GATED) — 2026-06-07

A system-grouped, tap-first **screening sweep** replaces the clerkship's History segment, built as an **upgrade of the existing symptom catalog** ([ADR 0062](docs/adr/0062-review-of-systems-engine.md)). **Migration 0045 is GATED.**

- **Three-state model** — every screening symptom is **not-asked / denies / present**; not-asked = no row (never persisted), so **pertinent negatives are captured + queryable**. Distinct treatments (icon + label + tone, never colour alone).
- **Catalog upgrade (0045)** — `symptom_catalog` += `ros_screen` / `is_pain` / `must_not_miss` / `uganda_flag`, body-system vocab expanded to B1–B12; `encounter_symptom_observations` += `status`. Seed from Hutchison Box 1.7: **81 ROS screens** (16 existing upgraded, 65 new), 204 properties, 341 options, 298 maps. One catalog now serves HPC capture + doctor-created complaints + the ROS.
- **Engine** ([lib/clerkship/ros.ts](lib/clerkship/ros.ts), pure/TDD) — `renderRosProse` (per-system: positives reported, negatives as denials), `rosProgress`, `rosObservationRows` (status rows incl. denies). Stored in `history.ros` (versioned) + fanned to the projection (best-effort).
- **UI** ([ros-review.tsx](app/doctor/encounters/[encounterId]/_components/ros-review.tsx)) — collapsible per-system sections, persistent progress bar, per-system roll-up chips, one-tap **All negative**, present → optional tap-first property capture, carried-over presenting complaint shown already-positive, `must_not_miss` = amber attention (red reserved). aria/keyboard accessible.
- **Form** — tabs now Complaint · Review of Systems · Background · Examination · Assessment · Plan; PMH/drugs/allergies/social/SOCRATES moved to Background. Decision-support, not autonomous — nothing auto-marked. tsc/eslint/build clean; **782 tests** (+4 ROS).

### Added — Clerkship: doctor-created complaint = attributed catalog template (GATED) — 2026-06-07

A clerking doctor can **create a complaint not in the catalog** — name + body system + synonyms + a **mapping of existing properties** — and save it as a **reusable, attributed template** ([ADR 0061](docs/adr/0061-doctor-created-complaint-template.md)). **Migration 0044 is GATED.**

- **Template = structure only.** Saving stores the symptom DEFINITION + property MAPPING — **never** the patient's tapped values (those persist to the encounter as before). Enforced at one pure choke-point ([lib/clerkship/complaint-template.ts](lib/clerkship/complaint-template.ts) `templateStructure`), unit-tested (usefulness + privacy).
- **Attribution, immutable.** Records + displays **"Created by Dr X · date"** wherever the complaint appears (`symptom_catalog.created_by_user_id` / `created_by_name` / `created_at`, locked by a `BEFORE UPDATE` trigger); proposal/approval trail via `catalog_proposals`.
- **Two-tier governance.** Created complaints are `scope='personal'` (usable immediately by the creator; RLS hides them from others). A **"propose to shared catalog"** action → CSO/superadmin review → **approval promotes** the row to `scope='shared'` + applies the mapping (`reviewProposal`). The shared catalog is never directly user-mutated.
- **Reuse-only properties (v1):** map from the existing property catalog; new properties go via the propose path. `loadSymptomCatalog(viewerUserId)` now returns shared ∪ the viewer's personal templates.
- Migration 0044: `symptom_catalog` += `created_by_user_id` / `created_by_name` / `scope` / `origin`, scope-aware RLS, attribution-immutability trigger. Decision-support, not autonomous. Gated behind `ENCOUNTER_ENGINE_LIVE`. tsc / eslint / build clean; full suite **778 passing** (+3 template tests).

### Added — Clerkship: tap-first structured symptom-capture engine (GATED) — 2026-06-05

History capture restructured to be **tap-first, minimal-typing** — symptoms, their properties, and each property's values are tapped, not typed ([ADR 0060](docs/adr/0060-clerkship-symptom-capture-engine.md); proposal [docs/clerkship-symptom-engine-gate-a-proposal.md](docs/clerkship-symptom-engine-gate-a-proposal.md)). **Migration 0042 is GATED — awaiting CSO sign-off** of the catalogs + the symptom→property mapping (it encodes _what to ask_).

- **Three catalogs + a relevance mapping** as versioned reference data (migration 0042): `symptom_catalog`, `symptom_property` (value_type drives the tap UI), `symptom_property_option` (value-sets), `symptom_property_map` (which properties per symptom; common ones auto-apply). **Internal-Medicine-first seed** (16 symptoms / 20 properties / mappings; Hutchison + SOCRATES, CSO-signed).
- **Patient info pulled, read-only** — a patient header (name/age/sex + allergies-first) on the clerking surface; no re-typing; audited.
- **Tap-first capture → dual output** ([lib/clerkship/symptom-engine.ts](lib/clerkship/symptom-engine.ts), pure/TDD): search/tap a symptom → its relevant properties appear → tap values (chips / 0–10 scale / duration; free text last-resort) → live prose. Writes **readable prose** (`history.hpc`) **and** structured data (`history.hpcItems` + the queryable `encounter_symptom_observations` projection). Wired into the clerkship form at `/doctor/encounters/[id]`.
- **Governed edit/create:** per-encounter **ad-hoc** symptoms are free + local (never touch the shared catalog); **propose-to-shared** → `catalog_proposals` → **CSO/superadmin review** ([/admin/catalog-proposals](app/admin/catalog-proposals/page.tsx)) → approve is the only governed catalog insert. Clerkers propose; CSO/SA review.
- Decision-support, not autonomous (no auto-diagnosis); reuses the encounter documentation (no parallel store); reusable for the systematic enquiry later. Gated behind `ENCOUNTER_ENGINE_LIVE`. tsc / eslint / build clean; full suite **773 passing** (+7 engine/mapper tests).

### Added — Triage → doctor assignment (assign / reassign / start) — 2026-06-04

After triage, a patient is routed to a doctor before the encounter begins — the connective layer between the triage worklist and the (now-live) clerkship.

- **The assignment IS a `planned` encounter** (clinician = the assigned doctor, linked to the triage) — no new migration; reuses the encounter lifecycle (`planned → in_progress`). [lib/encounter/assignment.ts](lib/encounter/assignment.ts).
- **Nurse assigns** from the triage worklist: a compact "Assign Dr" picker on each triaged, identified patient (L2–L5; L1 stays the resus path) — department doctors first, widening to the hospital. [assign-doctor-button.tsx](app/nurse/triage/_components/assign-doctor-button.tsx).
- **Doctor-triager auto-assign:** when a doctor does the triage, the patient is auto-assigned to them (best-effort; never blocks the triage).
- **Doctor "Assigned to you" queue** ([/doctor/assigned](app/doctor/assigned/page.tsx)): the planned encounters assigned to them, with **Start** (→ flips to in_progress, seeds the clerkship from triage, opens the clerking) and **Reassign** (hand to a colleague). Patient shown by code + acuity + reason — name revealed only when they start (audited).
- **Reassignment** allowed only while `planned` (once started, care has begun). Nurses + the assigned doctor can reassign.
- Gated behind `ENCOUNTER_ENGINE_LIVE` (same flag as the engine). tsc / eslint / build clean; full suite 766 passing.

### Added — Encounter / EMR engine + structured clerkship — the clinical-data spine (GATED) — 2026-06-04

The clinical-data spine: the encounter engine with its clinical documentation realised as a **structured Hutchison CLERKSHIP** (history → examination → differential → initial management), not a free-text note. **The DB migration (0040) is GATED — NOT applied to prod; awaiting CSO sign-off** of the access model + schema + clerkship structure ([ADR 0059](docs/adr/0059-encounter-emr-engine-clerkship.md); proposal [docs/encounter-emr-engine-gate-a-proposal.md](docs/encounter-emr-engine-gate-a-proposal.md); clinical source [docs/clinical/clerkship-clinical-reference.md](docs/clinical/clerkship-clinical-reference.md)). **Reconciled (2026-06-04) against the now-provided primary spec `encounter-emr-engine-kickoff.md`** — the spine holds; the access basis was corrected to the kickoff's legitimate-access model (below). Remaining kickoff gaps tracked toward GATEs C–E (ICD-10/LOINC versioned reference data; care plan + encounter type vocab + vitals-link interface; triage→encounter handoff; thin surfaces + workspace wiring).

- **Builds ON the existing `encounters` table** (migration 0028) — extends it (+ disposition / triage link / encounter_class) and adds the clinical objects: `clinical_documentation` (versioned, append-only clerkship; `UNIQUE(encounter_id, version)`), `encounter_diagnoses`, `problem_list`, `patient_allergies` (**shared** with the gated 0039 — 0040 (re)creates it idempotently and is the **authoritative owner**, superseding 0039's hospital-scoped RLS with the relationship-based one), `encounter_medications`, `encounter_orders`/`results`, `encounter_events` (append-only timeline). Migration `0040` is GATED (clinical-data spine; hard to reverse — same posture as 0039).
- **Access model — legitimate-access basis (kickoff §2, reconciled to the repo's existing model):** a clinician reads a patient's record only on a basis resolved strongest-first — **`active_encounter`** → **`department_recent`** (30d) → **`care_team`** (seam) → **`break_glass`** — the SAME basis the doctor/nurse workspaces enforce ([lib/doctor/patient-access.ts](lib/doctor/patient-access.ts)); the engine resolves it in [lib/encounter/scope.ts](lib/encounter/scope.ts) `resolveEncounterAccess`. This **replaces the earlier looser "any clinical staff at the hospital" predicate** ("never any clinician sees any patient"). Every clinical table is `FORCE ROW LEVEL SECURITY`; clinical **writes are service-role only**; documentation + timeline are **hard append-only** (block triggers). **The engine's service-role paths BYPASS RLS, so the basis is resolved in app code** on every read **and** write; **audit-on-READ** writes a row to the canonical **`clinical_phi_access_log`** (with the basis) **after** a successful authorised fetch.
- **The clerkship engine** ([lib/encounter/clerkship.ts](lib/encounter/clerkship.ts), pure, TDD): the Hutchison sections (SOCRATES, **CAGE**, systematic enquiry, Uganda always-asks, allergies; examination; synthesis incl. ranked differential with **must-not-miss**, problem list, justified investigations, management/disposition/safety-netting) → **SOAP-mapped** → `deriveClinicalObjects` fans out to the engine objects (no parallel store; no fabrication). **Triage seeds the clerking** (`seedClerkshipFromTriage` — continuation, not a blank restart). **Cadre-write rules** ([access.ts](lib/encounter/access.ts)): doctor clerks; intern co-sign; nurse no final diagnosis; reception nothing.
- **Write/read/audit orchestration** ([lib/encounter/record.ts](lib/encounter/record.ts)): append-only versioning + the clerkship→objects fan-out (allergies persisted even on a draft — safety) + cadre enforcement + audit-on-read. Decision-support, not autonomous — no auto-diagnosis.
- **Standards as versioned reference data** (kickoff §1/§5; [lib/encounter/reference-codes.ts](lib/encounter/reference-codes.ts) + migration 0041): a curated, **sourced** ICD-10 + LOINC starter set (each code verified against WHO ICD-10 / loinc.org; version + source recorded), with pure lookup/search the documentation picker uses; the same rows seed the queryable `icd10_codes`/`loinc_codes` tables. Full sets load later via an official import. Codes WHERE codable; free-text still allowed.
- **Surfaces (GATE D) — wired into the doctor + nurse workspaces, gated by `ENCOUNTER_ENGINE_LIVE`:** a shared **longitudinal clinical record** panel (allergies surfaced first; problems / meds / diagnoses / encounter history) on the `/doctor` + `/nurse` patient pages ([patient-clinical-record-panel.tsx](components/encounter/patient-clinical-record-panel.tsx)); a per-encounter view + **append-only timeline** + the **clerkship documentation-entry form** (essential structured sections — history/SOCRATES, exam, differential with ICD-10 picker + must-not-miss, investigations with LOINC picker, plan + disposition; draft / finalise; "a correction is a new version") at `/doctor/encounters/[id]`; the **triage→encounter handoff** ([handoff.ts](lib/encounter/handoff.ts)) that opens/links an encounter from a completed triage and seeds the clerking. The engine-live flag keeps it deploy-safe before the migration; flip it at apply time.
- **Launch sequence (turn-on):** (1) apply migrations 0040 + 0041 (`npm run db:migrate`); (2) **point the prescribing allergy read at `patient_allergies`** (hard launch-blocker — today prescribing reads the resus-timeline capture, so until rewired **clerked allergies don't gate prescribing**); (3) set `ENCOUNTER_ENGINE_LIVE=1`; (4) merge → deploy.
- **Deferred (flagged):** the "Start clerking" button on the shared triage desk (the handoff action exists); the form's full Hutchison structure (v1 = essential sections); particular-group flows + system exam templates; order execution + results ingestion; the care-team module (`care_team` access basis is a seam); the admission slice (consumes the disposition).
- **Adversarial review** (access/RLS/audit/append-only/allergy) run + findings fixed: corrected `has_clinical_relationship` break-glass columns (`actor_id`/`patient_id`) so the gated migration applies; resolved the `patient_allergies` 0039/0040 ownership collision (idempotent, authoritative 0040); the legitimate-access basis re-checked in app code (service-role bypasses RLS); audit-after-fetch; `anaphylaxis` severity; `UNIQUE(encounter_id, version)`.
- **Tested:** clerkship engine + access + reference codes + scope adapter + clerkship-input mapper (**27 encounter unit tests**); encounter RLS boundary test (runs post-0040). tsc / eslint / **build clean**. No shipped migration altered (0040/0041 GATED).

### Changed — Resus · vitals strip: previous→current + clinical trend arrow + hover trend graph — 2026-06-04

The resus board's vitals strip now shows, per vital, **the previous reading, the current reading, and an up/down trend arrow coloured by clinical meaning**, and **on hover/tap reveals a clean trend graph** against the normal band — surfacing the serial vitals the resus already records (the trajectory is the story in a resus). **Display only — vitals capture, the derived-metric maths, the interpretation thresholds, population routing, and the engine are byte-for-byte unchanged** ([ADR 0058](docs/adr/0058-resus-vitals-trend-display.md)).

- **One shared classifier** ([lib/resus/vital-trend.ts](lib/resus/vital-trend.ts), TDD): `vitalBand` is the board's **existing** `vitalTone` cutoffs relocated verbatim + derived bands reusing the triage `SHOCK_INDEX`/MAP thresholds — it drives the cell tone, the trend direction, and the graph reference bands (one source; no new thresholds). `vitalTone` now delegates to it (identical output).
- **The cell**: current (prominent mono) + **previous (secondary "was N")** + a **trend arrow** whose glyph is the raw direction (↑/↓/→) and whose **colour is clinical** — a band change = improving/deteriorating, and **within an unchanged non-normal band, movement toward the danger edge = deteriorating** (so a still-critical SBP 85→80 reads deteriorating, not calm), within normal = neutral. So a **rising SpO₂ reads improving, a falling SpO₂ deteriorating** — by meaning, not raw direction. Shock index shows 2 dp. Colour + glyph + value (never colour alone); aria-label gives screen-reader users the trend; arrow only with ≥ 2 readings (honest single-reading state).
- **The hover/tap graph**: an SVG line over the resus with the **clinical-normal band shaded** + **danger thresholds** dashed (clinical-normal, respecting scores-0-≠-normal), a **time-aware x-axis** (actual reading times; irregular intervals honest), the latest point emphasised; **BP shown as a SBP+DBP pair** (two-line); the self-contained derived metrics (shock index, MAP) plotted the same way; reduced-motion-safe; tap-toggle popover on touch. **Pulse pressure + qSOFA stay flag-toned chips** (pulse pressure's "narrow" flag is SBP-relative, so a context-free line would drop that signal; qSOFA is a categorical score).
- **Read-model only**: plots the existing shock-index + MAP derived series (no new maths). No fabricated previous/trend; honest empty + missing states.
- **12 read-model tests** (full suite **722 passing**); tsc / eslint / prettier / build clean. No migration touched.

### Changed — Resus · actions board: one shared urgency-ordering across the whole surface — 2026-06-03

The actions board now displays indicated actions in **clinical-urgency order** — a deterministic composite of **time-criticality × state** — **consistently across all five ABCDE steps** from one shared function (formalises/extends the airway Addendum-2 ordering). **Presentation/ordering only — the engine, findings→action mappings, action-state lifecycle, severity, escalation, and the record are byte-for-byte unchanged** ([ADR 0057](docs/adr/0057-resus-actions-urgency-ordering.md)).

- **One shared, pure function** ([lib/resus/action-order.ts](lib/resus/action-order.ts), TDD): `orderResusActions` sorts by the **state band** (failed → indicated → in_progress → deferred → performed → not_indicated) then **time-criticality** (engine `priority`) within the band, stable + non-mutating. Each board reads top→bottom: **must-escalate → recommended → underway → parked → done → N/A**; colour + position reinforce the same priority.
- **Surfacing ≠ filtering (safety guardrail):** the function sorts, never removes — a regression test asserts every input action returns. Each panel merges triggered ∪ recorded into one ordered list; **no failed/indicated/in_progress/deferred action is ever hidden** (performed/N-A recede via the sort but stay auditable).
- **Persistent outstanding-actions indicator** ([resus-actions-heading.tsx](app/nurse/resus/[episodeId]/_components/resus-actions-heading.tsx)): a shared "N outstanding" badge (failed+indicated+in_progress) in every board header + an `aria-live="polite"`/`role="status"` region announcing the most-urgent action (so a jump-to-top on `failed` reaches screen-reader users). Deterministic; reduced-motion-safe.
- **Whole-surface consistency:** applied in airway/breathing/circulation/disability/exposure (no cross-step actions tab exists yet; the function is ready for one). Each panel keeps its own `ActionCard` (airway renders a dose line the others don't) — only the ordering + the heading/indicator are shared; the per-card duplication is a noted, deferred cleanup.
- **9 ordering unit tests** (full suite **719 passing**); tsc / eslint / prettier / build clean. No migration touched.

### Added — Resus · EXPOSURE step (findings→diagnosis→action engine + the return-to-A loop) — completes ABCDE — 2026-06-03

The **fifth and final** ABCDE step, built by **reusing** the A/B/C/D findings→action→state engine + the state colour system ([ADRs 0048–0050, 0053, 0055](docs/adr/0055-resus-disability-findings-action-engine.md)) with "what got missed" emergency medicine, and routing its drugs through the **smart prescribing tool** ([ADRs 0051–0052, 0054](docs/adr/0054-prescribing-editable-parameters.md)). Decision-support — records what the team does; never auto-administers. CSO-signed ([proposal](docs/resus-exposure-gate-a-proposal.md) + committed catalog [docs/clinical/resus-exposure-clinical-catalog.md](docs/clinical/resus-exposure-clinical-catalog.md); [ADR 0056](docs/adr/0056-resus-exposure-findings-action-engine.md)). **No new migration** (step-`E` timeline events) and **no new drug dose** (every E drug was already verified). **A/B/C/D/E now share one engine — the primary survey is complete.**

- **Two outputs** ([lib/resus/exposure.ts](lib/resus/exposure.ts), pure, TDD): `classifyExposure` — **worst-finding-wins**, no-new-critical → significant → temperature-extreme → critical, where a **temperature extreme is never downgraded** by a benign survey; and **`identifyExposureDiagnosis`** — anaphylaxis → meningococcal-sepsis → occult-haemorrhage → nec-fasc → limb-threat → severe-hypothermia → hyperthermia → hypothermia → opioid-patch, most-time-critical first. `tempStage` stages the core temperature (boundaries round to the **more-severe** band — 28.0 → severe, 32.0 → moderate — for the more-aggressive rewarming).
- **The E-distinctive element: the RETURN-TO-A loop** — E is **not a dead-end**. A prominent "primary survey complete → return to A and reassess" affordance **auto-records the draft first** (so AMPLE allergies aren't lost), records the loop event, and navigates back to A; the cycle guard is advisory (a non-linear resus must allow an urgent jump-back).
- **The lethal traps are enforced** (not just documented): **non-blanching rash → don't-delay antibiotics**; **unexplained hypothermia → think SEPSIS (cold sepsis)** → septic screen; **occult haemorrhage → log-roll** (fired by trauma OR a recorded back finding) + back-to-C; **expose → examine → RE-COVER + keep warm** (always surfaced; escalated when left exposed); **hypothermic arrest → "not dead until warm and dead"** modifier; transdermal opioid patch → remove + naloxone. **Co-morbid criticals are never masked** — every critical finding's action surfaces unconditionally (the D-review lesson, applied by construction).
- **AMPLE history feeds the prescribing allergy check** — allergies captured at E are written to the same store the prescribe-time allergy check reads, so an allergen learned at E protects every later prescription.
- **Drugs via the prescribing tool** (no new dose): `e_antibiotics`→sepsis antibiotics, `e_anaphylaxis_adrenaline`→IM adrenaline, `e_warmed_fluids`→crystalloid, `e_naloxone`→naloxone. Dantrolene (MH) deferred to record + escalation.
- **Exposure panel UX** ([exposure-panel.tsx](app/nurse/resus/[episodeId]/_components/exposure-panel.tsx)): findings + the **core-temperature input with staging** + **AMPLE capture** + a prominent **suspected-diagnosis** indicator + the **re-cover reminder** + the **return-to-A loop button**; mandatory-temperature flag; no-pulse→CPR (cold modifier). Wired into the desk for step E (doctors inherit it via the shared `ResusDesk`); the step-bar active-threat no longer cries wolf on an unmeasured temperature / glucose (alarm scarcity — also applied to D). No left-edge accents; reduced-motion-safe.
- **Adversarial clinical-safety review (fix-then-ship):** no MUST-FIX; applied its SHOULD-FIX set — return-to-A now auto-records the draft (no lost AMPLE allergies), staging boundaries round to the more-severe band, a back finding now escalates to the log-roll, and the nav active-threat excludes the always-pinned measure/check prompts. **40 exposure-engine tests** (full suite **708 passing**). No shipped migration altered.

### Added — Resus · DISABILITY step (findings→neuro-syndrome→action engine + GCS) — 2026-06-03

The fourth ABCDE step, built by **reusing** the airway/breathing/circulation findings→action→state engine + the state colour system ([ADRs 0048–0050, 0053](docs/adr/0053-resus-circulation-findings-action-engine.md)) with neurological-emergency medicine, and routing its drugs through the **smart prescribing tool** ([ADRs 0051–0052, 0054](docs/adr/0054-prescribing-editable-parameters.md)). Decision-support — records what the team does; never auto-administers. CSO-signed ([docs/resus-disability-gate-a-proposal.md](docs/resus-disability-gate-a-proposal.md) + committed catalog [docs/clinical/resus-disability-clinical-catalog.md](docs/clinical/resus-disability-clinical-catalog.md); [ADR 0055](docs/adr/0055-resus-disability-findings-action-engine.md)). **No new migration** (step-`D` timeline events + pure projections).

- **Two outputs** ([lib/resus/disability.ts](lib/resus/disability.ts), pure, TDD): `classifyDisability` — **worst-finding-wins**, alert → mild-moderate → severe-coma (GCS≤8) → active-seizure-status → raised-ICP-herniation, where **a normal GCS NEVER downgrades** a recorded seizure / raised-ICP / fixed-pupil sign; and **`identifyNeuroSyndrome`** — the cause that drives the reversible-first action (hypoglycaemia → opioid → status → eclampsia → raised-ICP → stroke → meningitis → DKA/HHS → non-convulsive → secondary-to-ABC), **glucose always considered first**.
- **The D-distinctive element: GCS** — a total computed from its components (verbal "T"=1 when intubated) with the **serial trend** (`gcsTrend`/`isGcsFalling`); a **falling GCS is a return-to-A trigger** and a step-bar active-threat.
- **The lethal traps are enforced** (not just documented): **"Don't Ever Forget Glucose"** — a missing glucose in any altered patient is flagged + **check-glucose is pinned at the very top** of the action order; **reduced-GCS-is-usually-A/B/C** → re-confirm A-B-C; **GCS≤8 → back to A** → definitive airway (the proceed-guard routes to A, not E); **Cushing's = raised ICP** → neurosurgery + CT, **do NOT treat the hypertension as primary**; **benzodiazepine at the FULL guideline dose** (lorazepam 4 mg / midazolam 10 mg — never underdose, the dominant SE error); **eclampsia → magnesium FIRST, not a benzo** (a pregnant/postpartum seizure never routes to the benzo path); pinpoint + reduced consciousness → opioid → naloxone (back to B); non-convulsive status → escalate/EEG.
- **Drugs via the prescribing tool**: `d_*` actions (glucose/glucagon, naloxone, full-dose benzodiazepine, eclampsia magnesium, flumazenil) open the pre-filled, dose-verified dialog. Six of D's drugs were already verified there; the **eclampsia magnesium regimen** (the one gap) was **web-verified 2026-06-03** (Collaborative Eclampsia Trial / Magpie; RCOG/NICE) and added as `magnesium_eclampsia_iv` — 4 g IV load over 5–15 min + 1 g/h for 24 h; recurrent seizure → 2–4 g over 5 min — with a look-alike guard distinguishing it from the 2 g arrest / 1.2–2 g asthma doses.
- **Disability panel UX** ([disability-panel.tsx](app/nurse/resus/[episodeId]/_components/disability-panel.tsx)): findings co-visible with the urgency-ordered action board; **GCS component pickers + the serial-GCS trend display** (the D-step's distinctive element) + a prominent **neuro-syndrome indicator**; AVPU; pupils; the **mandatory-glucose flag**; neuro-state chip; proceed-to-E guard; GCS≤8→back-to-A; no-pulse→CPR route. Wired into the desk for step D (doctors inherit it via the shared `ResusDesk`). No left-edge accents; reduced-motion-safe.
- **TDD**: 43 disability-engine tests (full suite 664 passing). No shipped migration altered.

### Added — Smart prescribing: editable prescription parameters (safety re-runs on every edit) — 2026-06-03

The prescriber can now **edit a prescription's parameters** — dose, route, concentration, frequency/interval, duration, volume/rate, PRN, notes — instead of only accepting the guideline default, because the right prescription depends on the patient (renal/hepatic function, weight, the clinical picture). The hard rule: **editing is NOT a bypass — the safety checks re-run live against the edited values.** Built on the existing engine + record ([ADRs 0051–0052](docs/adr/0051-smart-prescribing-catalog-and-engine.md); [ADR 0054](docs/adr/0054-prescribing-editable-parameters.md)). Decision-support, never autonomous.

- **Edit-aware engine** ([engine.ts](lib/prescribing/engine.ts)): `runSafetyChecks` takes an `edit` — the edited dose drives the **out-of-range** + **max/cumulative** checks; an edited route re-validates **concentration/route**. New `dose_range` guard: ~0.5–2× (e.g. renal dose-halving) raises nothing; further out **warns**; far out **blocks** (override + reason); egregiously out (≥5×/≤0.2×) needs a **typed dose confirmation** — never a hard block in a resus.
- **Inline editor** ([prescribe-dialog.tsx](app/nurse/resus/[episodeId]/_components/prescribe-dialog.tsx)): an "Adjust" expander; flags recompute live as values change; the **guideline default is shown alongside the edited value** (struck-through), so deviation is visible; defaults stay one-tap-accept; edits are scoped to the selected drug (no leakage when switching option).
- **First-class edit history** ([recordEmergencyAdministration](app/nurse/resus/actions.ts)): the record stores the **edited values** (what's given + reconciled), the **guideline default**, the **field-level edit log** (`{field, from, to}`), and any **override + reason** — append-only/versioned; controlled-drug edits keep the witness requirement.
- **Range guard extended to fixed-regimen drugs** (closes the documented free-text gap): a new catalog `doseRangeMg {low, high}` ([emergency-drug-catalog.ts](lib/prescribing/reference/emergency-drug-catalog.ts)) gives the 9 escalating/ranged drugs that had no single `unitDoseMg` a numeric plausibility check too — amiodarone (150/300), lidocaine (50/100), magnesium arrest (2 g), adenosine (6→18), salbutamol (2.5–10), ipratropium (0.25–0.5), prednisolone (40–50), magnesium asthma (1.2–2 g), TXA (1 g). A dose inside the band is silent; just outside **warns**; further out **blocks** (override + reason); ≥3×/≤⅓ is **egregious** (typed confirm). Endpoints are derived from each entry's own verified dose string; the dialog now surfaces the numeric mg input (with the usual range) for these drugs so an edit actually reaches the guard. Volume-dosed (mL) and pure category/record-only drugs keep no mg guard by design. CSO-ratifiable.

### Added — Resus · CIRCULATION step (findings→shock-type→action engine) — 2026-06-03

The third ABCDE step, built by **reusing** the airway/breathing findings→action→state engine + the state colour system ([ADRs 0048–0050](docs/adr/0050-resus-breathing-findings-action-engine.md)) with circulation medicine, and routing its drugs through the **smart prescribing tool** ([ADRs 0051–0052](docs/adr/0051-smart-prescribing-catalog-and-engine.md)). Decision-support — records what the team does; never auto-administers. CSO-signed ([docs/resus-circulation-gate-a-proposal.md](docs/resus-circulation-gate-a-proposal.md) + committed catalog [docs/clinical/resus-circulation-clinical-catalog.md](docs/clinical/resus-circulation-clinical-catalog.md); [ADR 0053](docs/adr/0053-resus-circulation-findings-action-engine.md)). Anchors web cross-verified 2026-06-03. **No new migration** (step-`C` timeline events + pure projections).

- **Two classification axes** ([lib/resus/circulation.ts](lib/resus/circulation.ts), pure, TDD): `classifyCirculation` — **worst-finding-wins**, well-perfused → compensated → decompensated → peri-arrest → arrest, where **a normal BP NEVER downgrades a shock state** (the occult/compensated-shock trap; shock index > 0.9); and **`identifyShockType`** — the core C reasoning (haemorrhagic / non-haemorrhagic / septic / anaphylactic / neurogenic / cardiogenic / obstructive-tamponade·PE·tension / undifferentiated), because the type determines whether fluids help or harm.
- **The lethal traps are enforced** (not just documented): crystalloid is **never surfaced** for cardiogenic / obstructive / haemorrhagic shock; **haemorrhagic** → stop-bleed + blood/MHP (whole-blood first-line) + TXA + permissive hypotension (TBI exception MAP ≥ 80), minimise crystalloid; **FEAST (Uganda-critical)** — a febrile child's fluid action carries the no-adult-flooding caution; **β-hCG/ectopic** for reproductive-age shock; **obstructive** → relieve the obstruction.
- **Shock-type-driven action engine**: `triggeredActions` surfaces the type-specific strategy in urgency order (stop-bleeding/decompress/adrenaline/blood at top); the inherited action-state lifecycle + `failed`→escalation; `circulationProceedGuard` (compensated shock still gates D — treat NOW); no-pulse → the arrest seam.
- **Drugs via the prescribing tool**: `c_*` actions (TXA, noradrenaline → MAP ≥ 65, crystalloid, adrenaline, atropine, hydrocortisone, vasopressin, dobutamine, sepsis antibiotics, blood/MHP) open the pre-filled, dose-verified dialog. Four category/record-only drugs added to the prescribing catalog so C's drugs all route through the tool.
- **Circulation panel UX** ([circulation-panel.tsx](app/nurse/resus/[episodeId]/_components/circulation-panel.tsx)): findings co-visible with the urgency-ordered action board; a prominent **shock-type indicator** (the type + its matched strategy — the C-step's distinctive element); circulatory-state chip; proceed-to-D guard; reassess-after-bolus nudge; no-pulse→CPR route. Wired into the desk for step C with the red `active_threat` step-bar escalation. No left-edge accents; reduced-motion-safe.
- **Currency (verification):** SSC **2026** (norepinephrine first-line + MAP ≥ 65; 60–65 if ≥ 65y), ATLS **11th ed** + whole-blood-first-line, lethal diamond incl. hypocalcaemia, TBI MAP ≥ 80 — folded into the action rationales + catalog.
- **Adversarial clinical-safety review (block → fix-then-ship):** an independent review caught 6 must-fixes — `raised_jvp` (the cardinal fluids-will-harm sign) now gates all crystalloid + routes cardiogenic; tension pneumothorax now identifiable (was dead code); warm/brady distributive shock caught with a normal BP; a stale trauma flag no longer overrides sepsis; a recorded β-hCG drives the ectopic caution — plus two follow-ups (no crystalloid for anaphylaxis-with-bleeding; obstructive signs never read as "not assessed"). All fixed + locked with regression tests (57 circulation tests).
- **Deferred** (record + escalation only, flagged): full MHP/vasopressor-infusion/central-line/pericardiocentesis/arrhythmia procedural tooling; paediatric + obstetric depth.

### Added — Smart prescribing tool (emergency / crash-cart scope) — 2026-06-03

The engine + bedside UX that turns a resus recommendation into a fast, safe, **recorded** prescription/administration — emergency/crash-cart scope first, built to extend to full prescribing + the pharmacy module (clean seams). Drug doses + concentrations are the highest-risk content in the system: **decision-support, never autonomous** (the clinician confirms; the app records), every value **web cross-verified** (8-agent pass, 36/36 `verified-web`) + CSO-signed ([docs/smart-prescribing-gate-a-proposal.md](docs/smart-prescribing-gate-a-proposal.md); CSO catalog [docs/clinical/emergency-crash-cart-drug-catalog.md](docs/clinical/emergency-crash-cart-drug-catalog.md); [ADR 0051](docs/adr/0051-smart-prescribing-catalog-and-engine.md), [ADR 0052](docs/adr/0052-smart-prescribing-accountability-and-pharmacy-seam.md)). **No production migration applied** — v1 records to the immutable resus timeline; the persistence layer (migration 0039) is written + reviewed but gated.

- **Emergency drug catalog** ([lib/prescribing/reference/emergency-drug-catalog.ts](lib/prescribing/reference/emergency-drug-catalog.ts)): versioned, sourced reference data across all tiers (arrest, peri-arrest, airway/breathing, circulation, disability/metabolic, reversal, RSI record-only) — exact dose + **concentration/presentation** + route + interval + max, weight-based paediatric notes, controlled flags, ABCDE mapping, look-alike guards, confidence per entry.
- **Prescribing/safety engine** ([lib/prescribing/engine.ts](lib/prescribing/engine.ts), pure, TDD): six prescribe-time checks — allergy (block) · **concentration / adrenaline 1:1000-IM-vs-1:10 000-IV guard** · weight/age paediatric routing (**never an adult flat dose on a child**) · max/cumulative (atropine 3 mg across the episode) · contraindication (e.g. adenosine + asthma) · controlled-drug (witnessed). Block flags are overrideable with a recorded, audited reason.
- **The smart link**: `resolvePrescriptionOptions` maps a resus recommendation to pre-filled option(s) — e.g. Breathing "systemic corticosteroid" → **hydrocortisone 100 mg IV** _or_ **prednisolone 40–50 mg PO** (the clinician picks); anaphylaxis → **adrenaline 500 µg IM 1:1000** (never the arrest concentration); asthma magnesium → the asthma item (never the arrest item). Each option shows the indication + the dose source.
- **Grab-and-give accountability**: `recordEmergencyAdministration` records the administration as the prescription onto the immutable, audited resus timeline (drug · dose · concentration · route · giver · time · patient · encounter · cart · amount · controlled · override); cumulative dosing is projected from the timeline; controlled drugs require a witness.
- **Bedside dialog** ([prescribe-dialog.tsx](app/nurse/resus/[episodeId]/_components/prescribe-dialog.tsx)) on the Breathing panel's action cards: pre-filled drug/dose/**concentration** (mono numerals), option picker, allergy gate (capture/NKDA before confirm), paediatric weight capture, prominent safety flags, override-reason + witness inputs. WCAG-minded, reduced-motion-safe, no left-edge accents.
- **Pharmacy seam (not built)**: every administration captures what the future pharmacy reconciles + restocks against; the pharmacy module does NOT dispense emergency drugs.
- **Gated persistence** ([migration 0039](supabase/migrations/0039_smart_prescribing.sql) + [db/schema/prescribing.ts](db/schema/prescribing.ts)): `patient_allergies`, `prescriptions` (shared anchor), `crash_carts`/`crash_cart_stock`, append-only `emergency_administrations`, with RLS + audit — written + reviewed, applied via the controlled DB step (not in this deploy).

### Added — Resus · BREATHING step (findings→action→state engine) — 2026-06-02

The second ABCDE step built in depth, and the **proof the airway pattern is a faithful B–E template**: it **reuses** the findings→action→state engine, the action-state lifecycle, the state colour system + action-state tokens, the step bar, and the urgency ordering ([ADRs 0048–0049](docs/adr/0048-resus-airway-findings-action-engine.md)) — populated with respiratory medicine. Decision-support — records what the team does; never performs/auto-administers. B is assessed only once A is secure (return to A on deterioration). CSO-signed ([docs/resus-breathing-gate-a-proposal.md](docs/resus-breathing-gate-a-proposal.md) + committed catalog [docs/clinical/resus-breathing-clinical-catalog.md](docs/clinical/resus-breathing-clinical-catalog.md); [ADR 0050](docs/adr/0050-resus-breathing-findings-action-engine.md)). Guideline-anchored to ERC/RCUK 2025 + BTS/SIGN 158 (2019) acute asthma + GINA 2025 + NICE CG187 + BTS/ICS 2016 + ATLS/ETC + Surviving Sepsis 2021; doses web-verified 2026-06-02. **No new migration** — built on the existing immutable timeline + pure projections.

- **Finding capture + classification** ([lib/resus/breathing.ts](lib/resus/breathing.ts), pure, TDD): five-level breathing-state + LOOK/LISTEN/FEEL & PERCUSS + **MEASURE banded codes** (RR/SpO₂/PaCO₂/PEF/EtCO₂ thresholds; raw numbers stay in the monitoring band); `classifyBreathing` — **worst finding wins** (an optimistic headline read never masks a danger finding) → adequate → distress-compensating → failure-decompensating → peri-arrest → apnoeic.
- **The pre-arrest traps are first-class critical findings** — **silent chest**, **falling RR / exhaustion / drowsiness**, **normalising/rising PaCO₂ in acute asthma**, **rising EtCO₂ with falling RR** all classify as peri-arrest and surface at the top with an explicit "do NOT mistake a quiet chest or a 'normal' CO₂ for improvement" rationale; **normal SpO₂ + high work** is distress-that-will-fail, never falsely reassured; cyanosis labelled a late sign.
- **Findings→action engine**: `triggeredActions` — the life-threat clusters (tension pneumothorax → decompress before imaging/PPV; massive haemothorax; open chest wound; acute/life-threatening asthma; COPD; pulmonary oedema; pneumonia/sepsis; PE; anaphylaxis), each with its rationale, emergencies-prominent ordering; apnoea **with a pulse** → bag-mask ventilation, apnoea + **no signs of life** → the existing arrest seam (the same pulse-dependent split as airway).
- **Anaphylaxis-first ordering**: bronchospasm + an allergen trigger surfaces **IM adrenaline FIRST (priority 0)**, before nebulised salbutamol (which is an adjunct, never a substitute). COPD risk gives **controlled O₂ (88–92%)**, not high-flow, with NIV at pH < 7.35 + PaCO₂ > 6.5 kPa.
- **Action-state lifecycle** (reused): `indicated / in_progress / performed / not_indicated / deferred / failed`; a **`failed`** action surfaces its next step inline. `buildBreathingActions` folds state by action; `breathingProceedGuard` enforces treat-before-proceeding to C (distress "compensating" still flags — it will fail).
- **Doses**: four NEW fixed cited constants — salbutamol 5 mg neb, ipratropium 500 µg neb, prednisolone 40–50 mg PO / hydrocortisone 100 mg IV, IV magnesium 1.2–2 g/20 min (BTS/SIGN 158 2019 + GINA 2025). PE thrombolysis / pulmonary-oedema GTN+furosemide / CPAP-NIV stay **category-level**. Citation corrections ratified (acute asthma ≠ NG245; pulmonary oedema = CG187; needle length labelled ATLS).
- **Breathing panel UX** ([breathing-panel.tsx](app/nurse/resus/[episodeId]/_components/breathing-panel.tsx)): findings co-visible with the live indicated actions (sticky floating card); glanceable action states; breathing-state + proceed-to-C indicator; stridor/gurgling → return-to-A hint; reassess nudge; apnoea→CPR/ALS route. The B letter on the step bar escalates to red on a genuine life-threat-now (`classifyBreathing` peri-arrest/apnoea or a p0 emergency action). No left-edge accents; reduced-motion-safe.
- **Deferred** (record-capable + escalation only, flagged): full ventilator/NIV-titration/RSI/chest-drain procedural tooling; paediatric + obstetric depth.

### Changed — Resus surface: state colour system (step bar + action states) — 2026-06-02

A **visual/UX rework** so the resus surface is glanceable under pressure — which letter is the live threat and what state each action is in, without reading text. **No engine, state-model, record, or clinical-behaviour change** — `git diff main` touches only `DESIGN-medsync.md` and the two resus UI components ([ADR 0049](docs/adr/0049-resus-state-colour-system.md)). Governing rule: **alarm scarcity** — red only for an active-threat step or a `failed` action; **never colour alone** (word + icon, WCAG AA, greyscale-legible); **no left-edge accent bars** (state via border + fill + ring + chip + icon + word).

- **ABCDE step bar** is now a state-styled triage+progress strip — pending grey / clear teal / addressed deep-teal / threatened amber / **active-threat red-filled** (the loudest element), each with a coloured letter chip + state word. `open` is amber by default and only escalates to red on a genuine life-threat-now (for A, derived from `classifyAirway` / a detected arrest — a UI-only derivation over the existing engine). The current step gets a brand **teal focus ring** (distinct from state); calm-but-unmissable, reduced-motion-safe, `aria-current`.
- **Action states** have distinct colour identities — indicated amber / in-progress blue / performed teal / failed red / deferred grey / N/A outline — each icon + word; the current state is a **filled token**, the others quieter controls; a **failed** action surfaces its next-tier escalation inline; amber draws the eye to the recommended next action.
- **Consistency:** the timeline tints entries subtly by state (failed→rose, performed→teal); findings stay calmer than actions (selected = brand teal); tokens documented in `DESIGN-medsync.md` for B/C/D/E reuse.

### Added — Resus · AIRWAY step (findings→action→state engine) — 2026-06-02

The first ABCDE step built in depth inside the resus surface, and the **reusable pattern for B–E**: the clinician records **findings**, findings **trigger candidate actions** (with the _why_ shown), and **each action carries a state**. Decision-support — records what the team does; never performs/auto-administers. CSO-signed ([docs/resus-airway-gate-a-proposal.md](docs/resus-airway-gate-a-proposal.md) + committed catalog [docs/clinical/resus-airway-clinical-catalog.md](docs/clinical/resus-airway-clinical-catalog.md); [ADR 0048](docs/adr/0048-resus-airway-findings-action-engine.md)). Guideline-anchored to **DAS 2025** (confirmed verbatim from the BJA full text, supersedes 2015) + RCUK/ERC-AHA 2025; doses web-verified 2026-06-02. **No new migration** — built on the existing immutable timeline + pure projections.

- **Finding capture + classification** ([lib/resus/airway.ts](lib/resus/airway.ts), pure, TDD): patency state + LOOK/LISTEN/FEEL + LEMON/MOANS/RODS difficulty screen; `classifyAirway` — **worst finding wins** (an optimistic patency never masks a danger finding) → secure → threatened → partially/completely obstructed → apnoeic-arrest. Reassessment = a versioned finding-set on the timeline.
- **Findings→action engine**: `triggeredActions` — single findings + the **8 combination/trajectory clusters** (complete obstruction, epiglottitis [do-not-instrument], burns/inhalation, anaphylaxis, reduced-GCS, expanding haematoma, progression/fatiguing, difficulty-flags), each with its rationale, least-invasive-first/emergencies-prominent; trauma→jaw-thrust; apnoea+no-signs → the existing arrest seam.
- **Action-state lifecycle**: `indicated / in_progress / performed / not_indicated / deferred / failed`; a **`failed`** action surfaces its **next-tier escalation** inline (the DAS Plan A→B→C→D ladder). `buildAirwayActions` folds state changes by action; `airwayProceedGuard` enforces treat-before-proceeding to B.
- **Doses**: only anaphylaxis adrenaline + O₂ are fixed cited constants; nebulised adrenaline (airway oedema) + airway-oedema corticosteroids are **category-level** (no authoritative adult dose). Wording flags honoured (capnography "most reliable"/≥2 variables not "gold standard"; NPA "caution" not "contraindicated").
- **Airway panel UX** ([airway-panel.tsx](app/nurse/resus/[episodeId]/_components/airway-panel.tsx)): findings co-visible with the live indicated actions; glanceable action states; airway-state + proceed-to-B indicator; reassess nudge; one-tap escalation; apnoea→CPR/ALS route. Bedside-first; no left-edge accents; reduced-motion-safe.
- **Deferred** (record-capable + escalation only, flagged): full RSI/videolaryngoscopy/eFONA procedural tooling; paediatric airway depth.

### Added — Resus straight from the triage board + triage vitals carried in — 2026-06-02

Closes the gap between triage and resus. A patient triaged **Red/L1** now shows an **"Open resus"** button on the triage worklist (replacing the rapid-declare control once they're already L1) that opens — or resumes — their ABCDE resus desk in one tap. So the flow is: assign L1 (or rapid-declare) → back on the board → Open resus. No engine/scoring change.

- **Vitals carried from triage as the first resus reading.** Opening a resus from a triage record maps that record's `vitals_snapshot` (RR/SpO₂/O₂/BP/pulse/ACVPU/temp/glucose) into the first `vital` timeline event, **recorded at the triage time** so the resus trend starts where measurement actually began. Pure mapping `vitalsFromTriageSnapshot` (4 tests); rapid-Red snapshots carry nothing (no measured vitals). No migration — reuses the existing triage record + resus tables.
- `openResusFromIntake` resolves the latest Red/L1 triage record for an intake; both triage entry points share one open→seed-vitals→mobilise→redirect path (idempotent — re-opening resumes the existing active episode).

### Added — ABCDE Resuscitation surface (Option A) — 2026-06-02

The highest-acuity surface: a decision-support **ABCDE primary-assessment engine + continuous monitoring + team mobilisation** for any patient at Red/L1 or a Step-0 life-threat. Records what the team does — it never acts, orders, or auto-administers; the clinician leads. CSO-signed ([docs/resus-abcde-gate-a-proposal.md](docs/resus-abcde-gate-a-proposal.md); ADRs [0044](docs/adr/0044-resus-record-immutability.md)–[0047](docs/adr/0047-resus-arrest-seam.md)). Guideline-anchored to the **2025** cycle (AHA/ERC + ILCOR 2025 CoSTR + Resus Council UK ABCDE + ATLS + Surviving Sepsis 2021 + NEWS2); every drug dose web-verified against its primary source on 2026-06-01. The full ALS cardiac-arrest algorithm is a **separate later module** — this surface detects arrest and routes to it.

- **Immutable record** (migration 0038): `resus_episodes` (header) + `resus_timeline_events` (hard append-only — block trigger + REVOKE UPDATE/DELETE; corrections are new events via `supersedes_event_id`) + `resus_role_assignments` + `resus_mobilisation_alerts`. RLS scoped to the clinical team + patient + superadmin; PHI encrypted; fully audited. Reconstruction is pure + reproducible to any past instant ([ADR 0044](docs/adr/0044-resus-record-immutability.md)).
- **ABCDE engine** (pure, TDD): open-life-threats tracker, treat-before-proceeding, recommended next step, reassess-after-intervention, return-to-A; A–E assess→danger→action catalog with the anaphylaxis cross-cut (one source of truth across A/B/C/E). Dose constants tiered by confidence — only web-verified values are fixed; TXA protocol-surfaced; status-benzo/naloxone/neb/flumazenil category-level (no fixed mg); paediatrics banded/deferred. "Never a remembered dose" is test-enforced ([ADR 0045](docs/adr/0045-resus-abcde-engine.md)).
- **Continuous monitoring**: live vitals band + per-vital sparkline trends + derived metrics (shock index/MAP/pulse-pressure/qSOFA, reusing the triage scorer) + a post-intervention "re-check vitals" nudge; mirrors to the longitudinal `clinical_observations` store (etco2/urine_output kinds added).
- **Team mobilisation + shared view**: opening a resus alerts all active clinical dept staff + the ward-in-charge in-app now (SMS/push stubbed behind the existing `NotificationSink`); a "who's responding" view + open role assignment (leader recommended, never blocked) ([ADR 0046](docs/adr/0046-resus-team-mobilisation.md)).
- **Arrest seam**: one-tap declare → flags the episode, logs arrest+CPR, prompts "Start CPR", routes to the ALS module (to follow). No rhythm/defib/arrest-drug/4Hs-4Ts logic built ([ADR 0047](docs/adr/0047-resus-arrest-seam.md)).
- **Surface**: full-bleed `/nurse/resus` board + `/nurse/resus/[episodeId]` desk (sidebar hidden), bedside-first, large tap targets, mono numerals, red used purposefully, no left-edge accent bars, reduced-motion-safe.

### Changed — Triage page: three-zone live working surface — 2026-06-01

Reflows the triage page so the score AND the suggested next steps update live beside the vitals — **no scrolling to reach them** ([ADR 0043](docs/adr/0043-triage-layout-live-flow.md)). Layout + reactivity only; the engine, scoring, thresholds, routing, worse-of, recommendation mapping, override, and audit are all **unchanged** (diff touches only the two UI components; 282 triage tests pass byte-for-byte).

- **Next Steps moved from below-the-fold into the right rail, beside the score** — visible from load, updating as vitals are entered (the core complaint fixed).
- Three co-visible zones: left patient/context + live acuity + Resus · centre vitals **with red-flags co-visible** + Assign · right score + Next Steps (rail scrolls independently).
- Live affordances: a completeness hint on the Vitals header ("provisional — need RR, SpO₂"), "obtain missing vitals" pinned to the top of Next Steps when incomplete, and an aria-live region announcing the level/disposition for screen readers.
- Responsive: below `lg`, a **sticky live header** keeps the acuity + score visible above the vitals; Next Steps never below the fold.

### Added — Triage vitals catalog: paediatric + obstetric scoring now real — 2026-06-01

Built the engine against the CSO-supplied Vitals-Interpretation Catalog ([ADR 0042](docs/adr/0042-triage-vitals-catalog.md); verified mapping in [docs/triage-catalog-build-specs.md](docs/triage-catalog-build-specs.md)). Paediatric (PEWS) and obstetric (MEOWS) patients — previously routed but marked "provisional, assess manually" — now get a **real, computed, cited acuity**. Every threshold traces to the catalog verbatim; nothing fabricated. Pure + deterministic; no migration.

- **Versioned vitals reference data** (`lib/triage/reference/`): the catalog as data with provenance (age-banded paeds norms, MEOWS thresholds) — updates without code changes.
- **Paediatric age-banded scorer**: per-vital severity vs the age band → acuity, honouring the over-flagging caveat (a lone out-of-band HR/RR → L3, a single mild blip never auto-alarms) with absolute red lines (decompensated shock → L1, SpO₂<92 → L2, infant <3mo fever → L2). The `70+2×age` hypotension formula on exact age.
- **Obstetric MEOWS scorer**: hypertension-as-emergency (≥160/110 → Red), the new **Modified Shock Index** (HR/MAP>1.7) concealed-haemorrhage catch; no over-call of physiological pregnancy shifts.
- **Cross-vital "smart layer"**: Cushing's reflex (triad → L1), temp+HR sepsis overlay (widens an already-ticked suspicion), pulse-pressure interpretation, SpO₂+RR "will fail" raise-only floor — paediatric bounds use the age band, never adult numbers.
- **Special-population cautions** (elderly / beta-blocker / athlete / chronic baseline): confounder warnings only — they never change acuity.
- **Two safety fixes**: gated the adult ESI-v5 HR/RR danger-zone off for children (it was over-flagging a normal infant to L2); `ageYears=0` resolves to the infant band (hypotension <70, not newborn <60) to avoid under-triage.

Honest scope: numeric rate-of-change + peri-arrest are **deferred** (the engine carries only `priorLevel`, not timestamped prior vitals — a real rate signal would be fabricated). 333 tests pass (incl. +66 new across reference/paeds/meows/cross-vital/special-pop); typecheck + lint clean; production build compiles.

### Added — Triage as a full page + recommendations layer — 2026-06-01

- **Triage is now its own page** (`/nurse/triage/[intakeId]`), not a dialog. Per the requested wireframe: a triage-local rail (identity + live-acuity mirror + Resus fast path), a centre Triage Form (patient + vital metric tiles + red-flags) with a sticky Assign bar, and a sticky right **Scores** column (acuity hero + NEWS2 KPI + derived tiles + worse-of) that updates live as vitals are typed. Worklist rows navigate to it. Same engine + behaviours; no migration.
- **Recommendations / suggested next actions** ([ADR 0041](docs/adr/0041-triage-recommendations.md); mapping in [docs/triage-recommendations-gate-a.md](docs/triage-recommendations-gate-a.md)): the triage finding now surfaces guideline-derived suggestions across 7 categories (disposition · immediate measures · monitoring · escalation · pathway flags · onward routing · investigations) in the page's **Next Steps** panel.
  - **Suggestions, NOT orders** — each has accept / modify / dismiss; nothing auto-executes; the clinician's decisions are recorded with the triage record (in `computed_breakdown`, no migration).
  - **Category-level only** — no doses/volumes/agents; a unit test fails the build on any dose-token in a suggestion string.
  - **Transparent** — every suggestion cites its guideline + threshold; nothing fabricated.
  - **Bias-up** — the L4/L5 down-disposition gate holds at standard while vitals are incomplete or a flag fired; **recompute on override** (suggestions follow the clinician's assigned level).
  - **Honest seams** — only care-team-notify + urgent-appointment are live; everything else is "workflow to follow", recorded not dropped. Paeds/obstetric stay provisional (`needs_cso_input`), not fabricated.

  Verification: `lib/triage/recommend.ts` is pure + deterministic with 20 unit tests (no-dosing guard, recompute, sepsis/DKA/stroke/obstetric/paeds, down-gate); 202 triage tests pass overall; production build compiles; panels rendered to pixels before ship.

### Changed — Smart Triage Engine v2: guideline-verified + ESI v5 + rapid mode — 2026-05-31

Reworks the shipped triage engine to top-tier standard on medical accuracy (current verified guidelines), operative UX, and craft. Engine stays pure + deterministic; **no migration** (reuses the v1 `triage_records` schema). Built on the centred-dialog rework.

- **Guideline currency verified at build** ([docs/triage-v2-gate-a-proposal.md](docs/triage-v2-gate-a-proposal.md) §1): NEWS2 2017 (RCP 2023 review confirmed no revision), **ESI v5 (ENA 2023)**, SATS/TEWS, Sepsis-3 + **SSC-2021 (qSOFA is an overlay, NOT a screen)**, NHS National PEWS v3 (2023, supersedes Brighton), MEOWS. Each tool's version, primary source, and confidence recorded for CSO sign-off. Paeds/obstetric per-point rubrics are paywalled → kept **provisional, not fabricated**.
- **ESI v5 mandatory-vitals + reassess-up** (the v1 miss; [ADR 0039](docs/adr/0039-triage-esi-v5-mandatory-vitals.md)): HR+RR+SpO₂ required for any non-L1/L2 patient → a missing one floors acuity to L3 + marks the result provisional with an "assessment incomplete" flag (no falsely-reassuring Green on incomplete data); a danger-zone vital (adult HR>100, RR>20, SpO₂<92) reassesses **up** to a minimum L2. Folded into the engine's worse-of as a third track; the danger floor is absolute (a baseline temper can't cross it), the incomplete floor is a needs-assessment default a reasoned temper may cross. `lib/triage/scoring/esi-v5.ts`, 14 boundary tests.
- **Rapid 1-tap Red mode** ([ADR 0040](docs/adr/0040-triage-rapid-mode.md)): a "Resus" button on every worklist row → confirm the Step-0 life-threat → a Level-1 resus record without the full form, through the same authorised + audited path (`requireTriageScope`, `sa_audit_log`, `notifyTriageOutcome`, queue re-rank). Can only over-triage (assigns L1), never under-triage.
- **ESI-v5 transparency**: the incomplete-vitals flag, the danger-zone reasoning line, and the provisional badge surface automatically in the dialog (the transparent design renders `result.flags` / `result.reasoning` / `result.provisional` — no panel change).
- **GATE E integration verification** (adversarial, 6 seams): `triage_records` + `sa_audit_log` inserts use only DB-valid columns + enum/check literals; queue/intake status values valid; `notifyTriageOutcome` in-app fan-out to `sa_notifications` is **real** (SMS/push honestly stubbed pending a dispatcher); ESI-v5 worse-of + thresholds correct both sides. Fixed one pre-existing Drizzle drift — `queue_entries.priority_order` (in migration 0036, missing from `db/schema/scheduling.ts`).

Verification: 182 triage tests (incl. +14 ESI-v5) pass; full regression green; typecheck + lint clean; no shipped migration altered. Engine remains medico-legally reproducible (same inputs → same output).

### Added — Smart Triage Engine (clinical-safety artifact) — 2026-05-31

Per [`prompts/triage-engine-kickoff.md`](prompts/triage-engine-kickoff.md), grounded in the authoritative clinical source [`docs/clinical/triage-medical-research.md`](docs/clinical/triage-medical-research.md). The clinical core that takes a patient in `awaiting_triage` and assigns an acuity level — transparently, reproducibly, and always overridable by a clinician. Built across gates A–F with CSO sign-off discipline.

**The three architectural commitments:** deterministic (same inputs → same output, medico-legally reproducible), transparent (every output shows the parameters + red-flags that drove it — no black box), clinician-overridable (the engine advises; the human decides; the system biases UP on uncertainty).

**Deterministic scoring core** ([`lib/triage/`](lib/triage/)) — pure, side-effect-free, thresholds transcribed verbatim from the research doc as named constants:

- NEWS2 (§3): 6 parameters + ACVPU + supplemental-O₂ +2 + single-parameter-3 "red score", clinician-enabled SpO₂ Scale 2, provisional on any missing vital (a gap is never a reassuring 0).
- Derived "smart" metrics (§5/§6/§11): shock index, pulse pressure, MAP, qSOFA overlay, glucose flags — the occult-instability layer.
- Paediatric age-band flagging (§7). **95 boundary unit tests; 154 triage tests total; determinism proven.**

**The engine flow** (Steps 0–6, research doc §9): life-threat screen → population routing (adult NEWS2 / paeds PEWS / obstetric MEOWS; unknown-pregnancy flags-not-blocks; <16 → paeds) → score → discriminators → **worse-of (never averaged)** → trend escalation (never auto-improves) → clinician-gated baseline temper with an **absolute floor** (can never pull below a fired red-flag or a life-threat).

**Migration 0036** (additive, applied): `triage_records` (medico-legal, PHI, RLS clinical-only — reception excluded at the DB), `triage_discriminators` (the ratified §A.2 red-flag list as reference data), `triage_config`; + `triage_level`/`triaged_at` on intakes, `priority_order` on queue, `acvpu`+`triage_record_id` on observations. **Migration 0037**: `sa_notifications.kind` widened for triage alerts. DB-level safety CHECKs: a down-override requires a reason; a baseline adjustment requires a reason.

**Authority (R1):** every triage is overridable up/down with a logged reason; **only doctors/clinical-officers may down-triage** (nurses triage + escalate freely). Rides the existing `clinical_cosign_policies` mechanism; defence-in-depth (UI + server action + DB CHECK + RLS).

**Transparent UI** ([`/nurse/triage`](app/nurse/triage/)): worklist → slide-out panel where the **pure engine runs live in-browser** as vitals are entered (reasoning builds visibly before commit), then the **same function re-runs authoritatively server-side** (one engine, zero drift).

**Integrations:** Red/Orange → in-app alert to the receiving department's clinical staff (SMS/push behind a stubbed `NotificationSink` until a dispatcher build — R2); triaged acuity chip + acuity-sort on the shared incoming-intake board; aggregate triage-acuity snippet for hospital admin (no PHI — seeds the §10 over/under-triage validation dataset).

**Docs:** ADR [0035](docs/adr/0035-triage-deterministic-scoring.md) (deterministic scoring), [0036](docs/adr/0036-triage-two-track-worse-of.md) (two-track worse-of model), [0037](docs/adr/0037-triage-override-authority.md) (override + cadre-gated authority) — all marked clinical-safety artifacts pending CSO sign-off.

**Honest scope (flagged, not faked):** the research doc does not specify the full Brighton PEWS per-point sub-rubric or MEOWS per-parameter colour cutoffs — these were **not** fabricated. Adult patients get full NEWS2; paediatric/obstetric are driven by the life-threat screen + discriminators + derived metrics and marked **provisional** with an "assess against the chart manually" flag, pending the CSO supplying those rubrics (they slot into Step 2 behind the same pure interface). The monitoring-alert→urgent-appointment path is left as a clean seam (no alerts table exists yet); the encounter seam is untouched (triage sets `status='triaged'` + disposition; the next clinical build owns the encounter).

### Added — Book-or-Queue: patient choice point after primary-hospital selection — 2026-05-30

Per [`prompts/book-or-queue-kickoff.md`](prompts/book-or-queue-kickoff.md) + [`docs/book-or-queue-gate-a-proposal.md`](docs/book-or-queue-gate-a-proposal.md). The post–primary-hospital-selection moment is now a clear two-door step: **Book a future visit** (existing scheduling flow) or **Join today's queue** (new same-day pre-queue). No new engines — wires the patient's choice into the existing scheduling + entry-points systems.

**Migration 0035** (additive only, pushed):

- `patient_intakes.status` widened with `'declared'` — patient-initiated queue ticket, not physically present yet. Reception flips to `'arrived'` at check-in.
- `patient_intakes.checked_in_at timestamptz` — stamped at the declared→arrived transition. `arrived_at` keeps its row-created-at semantics.
- `patient_intakes.declared_by_patient boolean` — explicit flag (not inferred) so staff boards distinguish patient-initiated declarations from staff-registered intakes.
- `patient_intakes_hospital_status_idx` partial predicate widened to include `'declared'` — keeps today-board queries on the hot path.
- `sa_audit_log` action widened with `'patient_declare_intake'`.

**Edge Functions:**

- `pt-declare-intake` (new, deployed): patient creates the `status='declared'` intake. Validates: caller is the patient; `hospital_id` matches `patient_profiles.primary_facility_id` (no cross-hospital declarations); department exists at this hospital; department is "open for walk-in today" per `departmentSchedulingPolicy` (no new flag — same heuristic as the patient UI); 409 if a same-dept booking exists today; 409 if a live queue ticket already exists today. Audited as `patient_declare_intake`.
- `ha-check-in-patient` (extended, deployed): now accepts **either** `appointment_id` (original path) **or** `intake_id`. The new branch flips a declared intake to `arrived` + stamps `checked_in_at` + inserts the dept queue row. Reception's single check-in surface handles both booked-arrival and patient-declared flows; no duplicate row.
- `ha-cancel-intake` (extended, deployed): patient may cancel their **own** intake while it's still `declared`. Once arrived, staff-only (a walkaway is a no-show — reception's call).
- Shared `conflict()` error helper extended to carry structured `details` so 409s can ship `existing_appointment_id` / `existing_intake_id` for the UI to link to.

**Patient UI:**

- [`/patient`](app/patient/page.tsx) — quick-actions render **Book a visit** + **Join today's queue** as a pair when a primary hospital is set.
- [`/patient/hospitals`](app/patient/hospitals/page.tsx) — primary-hospital tile renders the **"What would you like to do?"** choice point with Book / Join today's queue / Not now (mobile-stacked, thumb-reachable).
- [`/patient/queue`](app/patient/queue/page.tsx) — dept picker for same-day declarations; mirrors the Edge Function's open-today heuristic; shows count-ahead per dept; **surfaces existing booking-today / live-intake-today before letting the patient try**, so the user lands in the right place instead of bouncing off a 409. Honest emergency banner ("don't use this — go straight to emergency").
- [`/patient/queue/[intakeId]`](app/patient/queue/[intakeId]/page.tsx) — live status (declared → arrived → awaiting_triage → triaged → completed); stage card + ticket details + 30s `meta http-equiv="refresh"` polling. Patient self-cancel while declared.
- Honest copy throughout: no fake wait estimates ("12 ahead right now"), no guarantee of a specific clinician or time, no clinical chrome.

**Staff surfacing:**

- Reception home stat rail adds **Declared** tile between Expected and Arrived (grid bumped to `lg:5` cols). [`lib/reception/queries.ts`](lib/reception/queries.ts) `ReceptionTodayCounts` gains `declaredToday`; `FlowRow` adds `declared` stage + `declaredIntakeId`.
- [`/reception/expected`](app/reception/expected/page.tsx) — new **"Declared today · awaiting check-in"** section above the booked-arrivals table. Each row gets a one-tap **Check in** button (calls `ha-check-in-patient` via the new `intake_id` branch).
- [`/reception/flow`](app/reception/flow/page.tsx) — `declared` stage chip + tone (muted teal with ring, visibly distinct from solid-teal `arrived`).
- [`fetchHospitalIncomingIntakes`](lib/intake/queries.ts) default widened to `[declared, arrived, awaiting_triage]`; declared rows tail-sorted so they never push present-and-waiting patients down. `IntakeRow` carries `declaredByPatient`.
- [`IncomingIntakesPanel`](components/intake/incoming-panel.tsx) (nurse + doctor home) renders a muted **DECLARED** chip + _"Self-declared · awaiting check-in"_ sub-line + lower opacity for declared rows. Emergency override still applies.

The pre-queued/arrived boundary reads at a glance everywhere: chips, counts, ordering. No surface lets a not-yet-here patient look like they're waiting in the room.

**Docs:** [ADR 0034 — Book-or-Queue: patient-initiated intake is a status, not an entry type](docs/adr/0034-book-or-queue-choice-point.md). Captures: why we widened status instead of adding an entry type; why we reused `departmentSchedulingPolicy` for capacity (and the trade-off accepted); why patient writes go through a `pt-*` Edge Function with the same audit/scope shape as `pt-request-appointment`; the same-dept-today-booking reconciliation rule; why position-in-line is the only honest count.

**Deferred** (explicit, out of this gate):

- `accepting_walkins` / `closed_today` flag on `departmentSchedulingPolicy` — only if pilot exposes a genuine need for divergence from booking hours.
- Estimated wait time — no signal today; we surface count-ahead only.
- Websocket-pushed queue updates — `meta refresh` is the honest minimum until then.
- Auto-decay of stale `declared` intakes at EOD — cron, separate ticket.
- Push / SMS queue-position notifications — separate ticket.

### Added — Reception / Records Registration (non-clinical signup path) — 2026-05-30

Per [`docs/reception-registration-gate-a-proposal.md`](docs/reception-registration-gate-a-proposal.md). The signup-side completion of the reception/records workspace: a parallel `/signup/non-clinical` route, an admin pending-queue panel that branches by cadre clinicality, and a verification-by-attestation policy that's honest about who the verifying authority is. Closes the "today reception users are seeded manually" deferred item from the previous changelog entry.

**Migration 0034** (additive only, pushed to remote):

- `staff_identity_profiles` table — non-clinical mirror of `clinician_profiles`. PK references `auth.users(id)`; columns: `nin_encrypted` (required), `staff_number`, `appointment_letter_url`, `authorising_officer_name`, `authorising_officer_role`. RLS: own row + scoped hospital_admin (via existing affiliation) + superadmin. `audit_log_changes()` trigger attached.
- `staff-identity-documents` Storage bucket — private; RLS mirrors `clinician-licences` (hospital_admin SELECT only when the applicant has an affiliation at their hospital).

**New `/signup/non-clinical` route** (sibling to `/signup/clinical`):

- Single-page native form — Account / Identity / Where you work / Consent. No council/licence section.
- **NIN required** (encrypted via `lib/encryption`); staff number / authorising officer / appointment letter optional.
- Reuses the existing `staff_affiliations.pending_approval → approved → active` lifecycle. No bespoke approval path.
- Same MFA / consent-version-mismatch handling as the clinical path.

**`/get-started` tile** added — "Reception, records or non-clinical staff" routes here. Headline updated to "Four doors in." Grid bumped to `sm:2 / xl:4` for the new tile.

**Admin pending queue** — `fetchPendingAffiliations` switched from inner-join → left-join on `clinician_profiles` + `councils` and now joins `staff_identity_profiles`. Non-clinical applicants previously wouldn't have surfaced in the queue at all. The pending-detail sheet branches by `cadres.is_clinical`:

- Clinical: council + reg # in the header chips; "Council licence" evidence card.
- Non-clinical: "Non-clinical" path chip; NIN-on-file + staff # + authorising officer rows; "Appointment letter" card (optional, amber note if missing). An italic note inside the panel reads _"your approval IS the employer attestation."_

`getEvidenceSignedUrlAction` allowlist widened to include `staff-identity-documents`.

**Docs:** [ADR 0033 — non-clinical verification is by hospital-admin attestation](docs/adr/0033-non-clinical-verification-by-attestation.md). Captures the decision to make NIN the identity anchor and the admin's approval the verification anchor, with optional supporting evidence that never gates signup.

**Deferred** (explicit, per proposal §6):

- Admin-invite-driven signup path (tokenised email link). The current signup is applicant-driven; admin-driven onboarding is a separate ticket.
- Operational NIN-decrypt UI surfacing the decrypted value in the panel. Today the panel shows "On file (encrypted)"; decryption flows through the existing audited operational-decrypt helper used for patient PII.
- Government NIN-verification API integration — no API integrated today; the admin matches NIN to person on day one.

### Added — Reception / Records Workspace (non-clinical, RLS-enforced) — 2026-05-30

Per [`docs/patient-handling-flow-gate-a-proposal.md`](docs/patient-handling-flow-gate-a-proposal.md) §4 + the receptionist-workspace kickoff. A deliberately thin front-desk console + the lifecycle write paths that close board-rot. **Non-clinical by design** — RLS at the database, not just hiding in the UI.

**Migration 0033** (additive only, pushed to remote):

- `cadres.is_clinical boolean NOT NULL DEFAULT true` + `cadres.council_id` nullable. Non-clinical cadres now coexist with the council-anchored clinical ones.
- Seeded `RECEPTION` cadre + `RECEPTION_OFFICER` role. **No fake regulator.**
- `user_roles_role_check` widened to include `'reception'`.
- `patient_intakes.encounter_id` (back-link FK) + status enum widened with `'completed'` — closes the intake→encounter chain for visit-history + drop-off.
- `encounters.completion_reason` text — the "why it ended" line.
- **Clinical-content SELECT policies tightened**: `clinical_observations`, `medication_administration_records`, `shift_handovers`, `encounters` now require `cadres.is_clinical = true` on the calling user's active affiliation. Reception (`is_clinical = false`) cannot read clinical content — the boundary holds at the DB.
- `sa_audit_log` widened with `check_in_patient` verb.

**Three new Edge Functions** (deployed):

- `ha-complete-encounter` — closes the encounter + cascades: queue row → `done`, intake row → `completed` with `encounter_id` set, active nursing assignments → `ends_at = now()`. **One write, four boards updated.** The end of the long-standing lifecycle leak.
- `ha-check-in-patient` — convenience wrapper for booked arrivals. Flips appointment to `arrived`, creates the queue entry, AND inserts a `patient_intakes` row of type `booked_arrival`. Reconciles the scheduling/intake disjointness that the recon flagged.
- `ha-cancel-intake` — terminal close on an intake (patient left, mis-registered, transferred). Audited with operator reason.

**New `/reception/*` workspace** (sibling to `/doctor`, `/nurse`, `/clinician`):

- Sign-in routing: RECEPTION cadre on active/approved affiliation → `/reception`.
- **Today** — front-desk stat rail (expected · arrived · awaiting-triage · no-shows), quick actions, awaiting-triage panel.
- **Expected** — today's bookings with one-click **Check in** (calls `ha-check-in-patient`).
- **Register** — the full intake flow. Reuses the existing `IntakeForm` component (now action-pluggable) wired to a reception-scoped `receptionRegisterIntakeAction`.
- **Find** — operational patient search by `patient_code` (audited name-search deferred).
- **Flow** — today's operational status board (expected / arrived / in-queue / awaiting-triage), no clinical content.

The shell's cadre pill reads **"Reception · non-clinical"** in muted neutral tone — the chrome carries the boundary signal.

**Docs:** [ADR 0032 — reception non-clinical boundary (RLS-enforced)](docs/adr/0032-reception-non-clinical-boundary.md). Captures the cadre/`is_clinical`/policy-widening decisions + the four clinical-content tables that now check cadre clinicality.

**Deferred** (called out in proposal §11):

- `/signup/reception` (admin-invite-driven signup path) — today reception users are seeded manually.
- `/hospital-admin/patients` Layer-1 directory + `FlowOverviewCard` admin snippet.
- `lib/handling/presence.ts` typed helper centralising the staggered-presence rules (today the rules live inside each surface's query).
- `/patient/care` visit-history aggregator (`lib/patient/visit-history.ts`).
- Audited name + phone search Edge Function (`searchPatientsByCode` is code-prefix only today).
- Cron auto-decay for stale `awaiting_triage` intakes.

### Added — Patient Entry Points (front-door intake + triage seam) — 2026-05-29

Per [`docs/patient-entry-points-gate-a-proposal.md`](docs/patient-entry-points-gate-a-proposal.md). The unified front door to the clinical system — 11-entry-type taxonomy, intake/encounter-precursor record, never-block-emergency rule encoded in the schema, clean handoff to the next-build triage.

**Migration 0032** (additive only, already pushed): two new tables —

- `entry_types` — reference data; 11 rows seeded (booked_arrival, walk_in, external_referral_routine, external_referral_emergency, emergency_self_presentation, self_referral_bypass, internal_transfer, inter_facility_transfer, program_visit, follow_up, virtual). Per-type flags drive routing + validation.
- `patient_intakes` — the unified intake row. Patient linkage via `patient_user_id` OR `patient_unknown_label` (the `patient_or_unknown` CHECK is the never-block-emergency rule encoded in the schema — an unconscious patient brought by ambulance lands as `entry_type='emergency_self_presentation'` + an unknown label + nothing else required).

Plus `sa_audit_log` widening (3 new verbs: `register_intake`, `update_intake`, `cancel_intake` + `patient_intake` target kind).

**One new Edge Function** (already deployed):

- `ha-register-intake` — audited create path. Enforces per-type validation (routine referrals require a referring facility; emergency types skip everything). Auth accepts any active clinical affiliation, hospital_admin (scoped), or superadmin — no new role needed.

**New `/hospital-admin/intake`** surface in the hospital-admin shell (sidebar entry "Intake"):

- Today's awaiting-triage count + emergency-awaiting count.
- Full intake capture form — entry-type picker (emergency types styled rose), known-patient-or-unknown-patient toggle (the unknown branch only appears for entry types that allow it), conditional referral block, presenting complaint, brought-by, priority hint override.
- Awaiting-triage list panel beside the form (oldest-first within priority).

**Docs:** [ADR 0031 — entry-point taxonomy + intake model + triage seam](docs/adr/0031-patient-entry-points-intake.md).

**Deferred** (called out in proposal §7):

- Triage logic / acuity scoring / post-triage encounter creation — the next build.
- Notifications dispatcher (emergency-arrival alerts) — flag is set; dispatcher consumes it.
- Admin aggregate metrics snippet (entry-point breakdown / time-to-triage on `/hospital-admin/overview`) — polish ticket.
- Superadmin cross-tenant aggregates.
- Referral document upload (the schema reserves `referral_document_url`; widget + Storage bucket ship separately).
- Dedicated reception role + workspace.
- Patient pre-queue from `/patient/appointments`.
- Incoming-intake panel on nurse + doctor home (the data exists; surfacing it inline is a polish ticket).
- `update_intake` flow that backfills `patient_user_id` after the unknown-patient is identified.

### Added — Nurse Workspace (cadre-tailored, MAR safety scaffold, in-charge assignment board) — 2026-05-27

Per [`docs/nurse-workspace-gate-a-proposal.md`](docs/nurse-workspace-gate-a-proposal.md). UNMC-anchored nursing workspace — cadre tailoring (ENROLLED / REGISTERED / SPECIALIST × NURSE / MIDWIFE / SPECIALIST_NURSE), in-charge overlay (not a cadre), four legitimate patient access bases, audited PHI decrypt, MAR with 5-rights + high-alert cosign routing.

**Migration 0031** (additive only, already pushed): five new tables —

- `nursing_assignments` — patient ↔ nurse pairing per shift; the canonical access basis.
- `ward_in_charge_assignments` — who is ward sister right now (time-bounded, one-active-per-ward partial unique).
- `clinical_observations` — vitals/obs records; **the landing zone reserved in ADR 0026** for clinician-recorded observations (distinct from patient-self-tracked `personal_health_logs`).
- `medication_administration_records` (MAR) — administer + document; `prescription_id` as TEXT seam until the prescribing engine ships.
- `shift_handovers` — structured between-shift handover, per ward, audited.

Plus: `clinical_cosign_policies` + `clinical_cosign_requests` action_kind CHECK widening (`high_alert_med_administration`, `independent_complex_procedure`) + seeded default policy for the three nursing cadres × every active hospital. `sa_audit_log` widened with 10 new nursing verbs.

**Four new Edge Functions** (already deployed):

- `ha-record-observation` — write a clinical_observations row, audited; affiliation check.
- `ha-administer-medication` — MAR row + cadre/grade-driven high-alert cosign routing. ENROLLED nurses administering high-alert meds file a `clinical_cosign_requests` row instead of the MAR row directly — the MAR write waits for a senior approval.
- `ha-submit-handover` — shift handover row, audited.
- `ha-assign-patient-to-nurse` — in-charge (or admin) pairs a patient with a nurse; closes the prior pair if any.

**New `/nurse/*` workspace** (sibling to `/doctor/*` and `/clinician/*`; sign-in routing detects UNMC nursing cadres):

- Shell with **persistent hospital + cadre + grade + in-charge pills**.
- **Cadre-shaped sidebar** — Assignment board only visible to current in-charge holders; Supervisees + Review queue visible to REGISTERED+.
- **Patient panel + summary** — four OR-combined access bases (`assigned` / `ward_census` / `in_charge` / `care_team` stub). PHI decrypts only via the audited `fetchNursePatientSummaryAudited` helper; refusals show a respectful "above your current access" screen.
- **Record vitals** at `/nurse/observations?patient=X` — kind-driven form (BP / HR / temp / SpO₂ / glucose / pain / I/O / GCS / etc.); single + dual numeric inputs.
- **MAR** at `/nurse/mar?patient=X` — drug / dose / route / outcome (administered / withheld / refused / wasted) + reason, 5-rights confirmation gate, high-alert checkbox that routes ENROLLED administrations for senior cosign.
- **Shift handover** at `/nurse/handover` — submit per-ward; recent handovers panel beside the form.
- **Assignment board** at `/nurse/assignments` (in-charge only) — list active pairings + assign form.

**Library:** [lib/nurse/scope.ts](lib/nurse/scope.ts) (with in-charge overlay), [capabilities.ts](lib/nurse/capabilities.ts) (cadre + grade resolver), [patient-access.ts](lib/nurse/patient-access.ts) (four-basis resolver + audited decrypt mirroring the doctor's helper).

**Docs:** [ADR 0030 — nursing cadre→capability mapping](docs/adr/0030-nurse-cadre-capability-mapping.md). Captures the in-charge-as-overlay decision, grade-level downgrade in application layer, high-alert-list deferred to prescribing engine, single-RN-check vs cosign defaults.

**Deferred** (called out in proposal §9):

- High-alert formulary (`high_alert_medications` reference list) — lands with the prescribing engine.
- Real prescriptions / orders — clinical module. MAR's `prescription_id` is TEXT seam until then.
- Per-procedure granularity on complex-procedure cosign — needs a procedures catalogue.
- Real ward shift / rostering system (today assignment IS the shift signal).
- Care-team coordination tables — clinical module.
- Real monitoring engine + alerts.
- Notification dispatcher.
- Walk-in patient picker (UUID input today).
- HOD-of-nursing surfaces.
- Cosign-approve flow consuming queued `high_alert_med_administration` payloads → real MAR insert. (Currently the cosign request lands but the post-approval administration is the next ticket.)

### Added — Doctor Scheduling Rework (calendar-native + queue rail) — 2026-05-27

Per [`docs/doctor-scheduling-gate-a-proposal.md`](docs/doctor-scheduling-gate-a-proposal.md). Re-expresses the doctor's scheduling life so the calendar (PR #33) is the primary canvas, with stat rail / pending-approvals rail / live queue beside it. **Presentation + orchestration only** — no engine, schema, lifecycle, scope, or audit behaviour changed beyond the single flagged addition (the walk-in producer).

**One new Edge Function** — `ha-record-walkin` (the `record_walkin` audit verb was reserved in migration 0028 but no producer existed). Creates a `queue_entries` row in state `waiting` for a department, computes `sequence_number` per (hospital, department, today), audited with operator-reason ≥ 8 chars. Callable by reception / nurse / clinician / hospital_admin at the hospital.

**Net-new doctor surface at `/doctor/schedule`:**

- **Stat rail** — Total / Confirmed / Pending / Urgent / Completed / Cancelled for the visible range. Real counts; honest zero state.
- **Pending-approvals rail** (manual-confirm doctors only) — inline Accept / Decline with audited reason via existing `ha-confirm-appointment-request` + `ha-decline-appointment-request`.
- **Department queue rail** beside the calendar — today's `queue_entries` (waiting + being_seen) for the doctor's department. Call → start encounter via `ha-start-encounter`. "Record walk-in" sheet calls the new Edge Function. Urgent walk-ins flagged rose.
- **Settings sheet** opened from the calendar top bar — auto-confirm / slot length / buffer / virtual / out-of-hours-override. Reads the **effective settings** (clinician override → dept policy → hard default); inline `(dept default)` hint shows which fields the doctor hasn't overridden. Saves via existing `ha-set-clinician-settings`.
- **"Now seeing" line** in the header — derived from the queue's `being_seen` state.

**Library:** [lib/scheduling/doctor.ts](lib/scheduling/doctor.ts) — stat counts, pending requests, dept queue today, currently-being-seen, effective settings resolver.

**Docs:** [ADR 0029 — origins-on-calendar + dept-policy resolution](docs/adr/0029-doctor-scheduling-rework.md). Notes the cadre call (NOT a gate on availability edits — operational, not clinical-safety; co-sign path additive if a future hospital insists).

**Deferred** (called out in the proposal §7):

- Card-grid + view switcher alternate browse — the calendar is sufficient for the working doctor surface; the card-grid lands as a polish pass.
- Book-on-behalf wizard — wraps `/patient/book` with a patient picker, separate ticket.
- Walk-in patient picker (currently UUID input) — lands with the patient-directory surface.
- HOD department calendar overlay — the HOD surface doesn't exist yet.
- Real monitoring engine + alerts table (the seam is in place).
- Notification dispatcher (SMS / push) — queue stays accurate.

### Added — Scheduling: Reusable Calendar (month/week/day/agenda) — 2026-05-27

Pure-UI presentation primitive per [`docs/scheduling-ui-calendar-addendum.md`](docs/scheduling-ui-calendar-addendum.md) GATE A. New [components/scheduling/calendar/](components/scheduling/calendar/): `MedSyncCalendar` orchestrator + view switcher (month / week / day / agenda); week + day share a time-grid primitive (07:00–20:00, current-time indicator, urgent ring per DESIGN-medsync.md). Availability blocks render as hatched / muted background; appointments stack on top. Click an appointment → opens the existing `AppointmentDetailSheet` (full reuse). Query helper at [lib/scheduling/calendar.ts](lib/scheduling/calendar.ts). Wired at `/doctor/schedule` + demo at `/styleguide` §14. **No engine behaviour changed.**

### Added — Doctor Workspace — 2026-05-27

Per [`docs/doctor-workspace-gate-a-proposal.md`](docs/doctor-workspace-gate-a-proposal.md). Six gates landed on `feat/doctor-workspace`. The defining feature: **cadre tailoring**, grounded in Uganda's UMDPC/AHPC hierarchy — an intern, MO, and consultant genuinely do different work, with different scope and supervision, and the workspace reflects that server-side, not cosmetically.

**Migration 0030** (additive only): four new tables —

- `clinical_supervision` — intern → consultant pairings, time-bounded; primary + backup relationship kinds.
- `clinical_cosign_policies` — per-hospital (optional per-department) policy matrix: which cadre × action requires `allowed` / `cosign_required` / `blocked`. Seeded with the default safety matrix for every active hospital.
- `clinical_cosign_requests` — workflow object for flagged actions; `pending_review` → `approved`/`returned` with a JSONB action payload snapshot.
- `clinical_phi_access_log` — append-only "who viewed which patient" log, distinct from `audit_log` (which is row-mutation). Patient-discoverable via RLS.

Plus widening of `sa_audit_log` actions: `assign_supervision`, `end_supervision`, `cosign_request`, `cosign_approve`, `cosign_return`, `cosign_cancel`, `cosign_expire`, `update_cosign_policy`, `phi_access_break_glass`.

**Cadre-shaped enforcement** (per [ADR 0027](docs/adr/0027-doctor-cadre-capability-mapping.md), clinical-safety artifact):

- Intern / Clinical Officer: routine prescription, high-cost imaging, admit, discharge → `cosign_required`. Controlled substances → `blocked`.
- Medical Officer: routine independent; controlled substances → `cosign_required`.
- Medical Officer Special Grade / Consultant / Senior Consultant: full independent scope.
- Enforced at three layers: **policy table** (hospital-configurable) → **server-side** capability resolver gating every action → **UI** rendering different framing per requirement. Clients cannot bypass.

**Patient access basis** (per [ADR 0028](docs/adr/0028-patient-access-basis.md)): legitimate clinical relationship required for PHI decrypt — `care_team` (stubbed for the future module), `active_encounter`, or `department_recent` (last 30 days). Audited on every read via `clinical_phi_access_log`.

**New `/doctor/*` workspace** — net-new sibling to `/clinician/*`; sign-in routing detects UMDPC doctor cadres on a `staff_affiliations` × `cadres` join and sends them to `/doctor`:

- Shell — sidebar + top bar with persistent **hospital + cadre indicators** (a doctor must never be ambiguous about scope). Sidebar items filter by cadre (Review queue → MO+; Supervisees → Consultant-level).
- **Overview** — cadre-shaped: junior cadres see their named supervisor + pending self-requests; senior cadres see their review-queue count.
- **Patient panel** + **patient summary** — RLS-respecting list (panel = no PHI; summary = audited decrypt). "Above your access" screen when basis fails.
- **Prescribe / order** — the cadre-enforcement proof: routine + controlled prescription forms; cap-resolved on the server; `allowed` records the action, `cosign_required` files a review request, `blocked` shows a respectful refusal.
- **Review queue** (`/doctor/cosign-queue`) — senior cadres only; approve / return-with-feedback with audited transitions.
- **Supervisees** (`/doctor/supervisees`) — consultant-level only; lists juniors paired to them.
- **Schedule** — directional landing → reuses existing `/clinician/{schedule,availability}` surfaces.
- **Alerts** — honest "monitoring connects here" stub against the future engine interface ([lib/doctor/alerts.ts](lib/doctor/alerts.ts)).
- **Care team**, **Encounters**, **Tasks** — placeholder cards on the overview; full surfaces land with the clinical module.

**Server actions** — `proposeClinicalAction` (cap-resolved at request time; routes to execute / queue / block) and `reviewCosignRequestAction` (senior-only; approve / return). Both audited.

**Library:** `lib/doctor/{scope,capabilities,patient-access,cosign,alerts}.ts` — single sources of truth, all `server-only`.

**Out of scope** (deliberate, per the proposal §8):

- SOAP notes / clinical documentation engine, real prescribing form + drug catalog, lab / imaging order forms, monitoring engine, care-team coordination tables + threading, pharmacy queue, break-glass / four-eyes access (enum reserved), HOD / department-leadership surfaces, multi-affiliation workspace switcher.

### Added — Patient Workspace — 2026-05-27

Per [`docs/patient-workspace-gate-a-proposal.md`](docs/patient-workspace-gate-a-proposal.md) (signed off). Seven gates landed on `feat/patient-workspace`. The defining case: the self-registered patient with no hospital connection — the workspace is useful and non-empty in that state, with a clear path to connect.

**Migration 0029** (additive only): three new patient-owned tables —

- `personal_health_logs` (single table; `kind` discriminator covering glucose / BP / weight / SpO₂ / temperature / symptom / note / other; two numeric slots cover BP-style two-number readings without JSONB).
- `self_medications` + `self_medication_takes` (patient-managed med list with `schedule_pattern` and confirmed-taken events; "today's doses" + adherence derived live).

RLS: patient owns SELECT/INSERT/UPDATE/DELETE on own rows; superadmin SELECT for support; no clinician policy (the elevation seam lives in a future `clinical_observations` table when the clinical module ships). Per [ADR 0026](docs/adr/0026-patient-workspace-self-tracking.md).

**Care-relationship intent reuses `patient_profiles.primary_facility_id`.** The hospital directory's "Set as primary" action UPDATEs that column. No new join table; multi-hospital intent is a deliberate future migration.

**Redesigned `/patient/*` shell + home:**

- New tab bar: Home · Track · Visits · More (replaces the prior Home · Book · Visits · More). The unaffiliated patient never lands on a CTA that can't work.
- Home shows: greeting + connection-state banner (inviting "Connect to a hospital" when unaffiliated, primary-name chip when affiliated) · today's tracking glance (latest reading + today's doses, calm empty state when nothing logged) · 4-slot quick action grid · upcoming visits (affiliated only).

**New surfaces:**

- `/patient/track` — self-tracking hub (active medications + recent readings + quick actions).
- `/patient/track/log` — log a reading (kind picker, default-seeded from `patient_profiles.known_conditions`; per-kind value fields; severity for symptoms; optional note + when).
- `/patient/track/medications` — list + add + stop + mark-taken; today's adherence count per med.
- `/patient/hospitals` — MedSync directory (search by name / district / region; `Set as primary` / `Your primary` states; deep-link to `/patient/book`).
- `/patient/menu` — More tab landing (links to hospitals · profile · consent · settings · my care).
- `/patient/profile` — identity locked (read-only); editable contact / language / known conditions / next-of-kin. Encrypted PII round-trips via `lib/encryption`.
- `/patient/care` — "Available once you connect" panel when unaffiliated; framed placeholder for the clinical view when affiliated.
- `/patient/consent`, `/patient/settings` — inviting placeholders; full surfaces ship with the clinical module + notification dispatcher respectively.

**Server actions (no Edge Function — patient owns the data end-to-end):**

- `app/patient/track/actions.ts`: `logReadingAction`, `deleteReadingAction`, `addMedicationAction`, `markMedicationTakenAction`, `setMedicationStateAction`.
- `app/patient/hospitals/actions.ts`: `selectPrimaryHospitalAction`, `clearPrimaryHospitalAction`.
- `app/patient/profile/actions.ts`: `updatePatientProfileAction` (encrypts on the server before write).

**Out of scope (kicked to follow-up tickets):**

- Africa's Talking SMS / push dispatcher (reminder times stored on `self_medications.schedule_times`, not sent).
- Clinician-prescribed monitoring (`clinical_observations` + "elevate self-tracking" flow — clinical module).
- Multi-hospital care intent (single `primary_facility_id` for now).
- Patient-side encounter detail, prescriptions, lab results (clinical module).
- Tele-consult video for `type=virtual` appointments.

### Added — Scheduling, Appointments & Booking — 2026-05-27

Per [`docs/scheduling-gate-a-proposal.md`](docs/scheduling-gate-a-proposal.md) (signed off). Seven gates landed end-to-end on `feat/scheduling` — the connective tissue between patient and care team.

**Migration 0028** (additive only): 7 new tables — `availability_blocks`, `clinician_scheduling_settings`, `department_scheduling_policy`, `appointments`, `encounters`, `queue_entries`, `appointment_reminders` — plus widened `sa_audit_log` CHECKs with 16 new scheduling actions.

**11 new Edge Functions** covering the full appointment state machine (requested → pending_approval → confirmed → arrived → in_progress → completed + side states cancelled / declined / no_show / rescheduled), plus the urgent-from-alert producer interface and the arrival → queue → encounter handoff:

- `pt-request-appointment`, `ha-confirm-appointment-request`, `ha-decline-appointment-request`, `cancel-appointment`, `reschedule-appointment`, `ha-mark-no-show`, `ha-mark-arrived`, `ha-start-encounter`, `ha-set-clinician-availability`, `ha-cancel-clinician-availability`, `ha-set-clinician-settings`, `system-propose-urgent-appointment`

All follow the integration contract: Zod → getCaller → role → scope → audit → mutation → log. Every mutation requires a ≥ 8-char operator reason.

**Two new workspaces:**

- `/clinician/*` — availability editor + schedule view. `lib/clinician/scope.ts` resolves the signed-in clinician's most-recent-active affiliation. Sign-in routing sends `clinician|nurse|pharmacist|lab_tech` roles here.
- `/patient/*` — home + booking wizard + appointments list. `lib/patient/scope.ts` (MFA-optional). Sign-in routing sends the `patient` role here.

**Booking wizard** (`/patient/book`): four steps — Reason → Clinician → Date+Slot → Confirm. Server fetches clinicians + bookable blocks + live appointments for 14 days; client derives slots from the data with per-clinician slot_minutes + buffer_minutes. Virtual toggle appears only when the clinician opts in.

**Responsive primitives** (`components/responsive/`): `ResponsiveSheet`, `BottomActionBar`, `MobileTabBar`, `StepWizardShell`. One codebase, mobile-first, reflow at `md:+`. Per [ADR 0025](docs/adr/0025-responsive-patient-primitives.md).

**Urgent-from-alert seam** (`system-propose-urgent-appointment`): widening fallback (preferred department → any clinician at the hospital), picks the earliest slot across candidates, status lands at `confirmed` (urgent skips manual approval). `triggered_by_alert_id` stored as text — upgrades to FK when monitoring lands. Per [ADR 0024](docs/adr/0024-urgent-appointment-fallback.md).

**Arrival → queue → encounter handoff**: `ha-mark-arrived` flips the appointment to `arrived` and inserts a `queue_entries` row with the next `sequence_number` for (hospital, department, today). Virtual appointments skip the queue entry. `ha-start-encounter` flips to `in_progress` and creates the minimal `encounters` row — scheduling hands off there; the clinical module enriches the encounter later.

**Hospital-admin scheduling**: `SchedulingOverviewCard` self-contained server component drops into the hospital-admin overview. `/hospital-admin/scheduling` page renders the same card + a placeholder for the department-policy editor.

**Superadmin scheduling rollup** at `/admin/scheduling-rollup`: aggregate-only cross-tenant view (confirmed today / pending platform-wide / urgent today / no-shows 7d) + per-hospital table with a stale-pending column (pending ≥ 48h — safety net for "routing broken"). No PHI, no new god-mode path. Sidebar + ⌘K palette entry added.

**Lifecycle pattern documented in [ADR 0023](docs/adr/0023-appointment-lifecycle.md)** — every state transition is a dedicated Edge Function (rejected the single mega-function approach for role-rule + side-effect clarity).

**Tenant-isolation regression** at `tests/scheduling/tenant-isolation.test.ts` — proves patient-A sees only their own appointments, clinician-A sees only theirs, authenticated UPDATE on `appointments` / `availability_blocks` is refused. Skipped behind `MEDSYNC_ALLOW_RLS_DB_WRITES=1`.

**Operator actions required:**

```
npx supabase db push
npx supabase functions deploy pt-request-appointment ha-confirm-appointment-request ha-decline-appointment-request cancel-appointment reschedule-appointment ha-mark-no-show ha-mark-arrived ha-start-encounter ha-set-clinician-availability ha-cancel-clinician-availability ha-set-clinician-settings system-propose-urgent-appointment
```

**Explicit out of scope** (per GATE A proposal): Africa's Talking SMS / push dispatcher (reminders queue but don't send); tele-consult video tooling (`type=virtual` flag only); cross-hospital booking / referrals; care-team-based clinician suggestions; full clinical encounter UI; patient-punitive no-show automation; department policy editor + utilisation analytics.

---

### Added — Hospital-admin Staff Management feature — 2026-05-27

First feature plugged into the hospital-admin shell. Tenant-scoped via the shell's `requireHospitalAdminScope()` accessor; every mutation through an Edge Function that re-pins the scope check + writes `sa_audit_log`.

**New routes / surfaces**

- `/hospital-admin/staff` — three tabs (Pending / Directory / Invitations) driven by `?tab=…`; row deep-link via `?aff=…` so the slide-out panel survives revalidation.
- `/admin/staff-rollup` — superadmin's cross-tenant aggregate view (counts + stale-queue health signal, no individual-row data). Added to the superadmin sidebar + ⌘K palette as a superadminOnly entry.

**Migration 0027**

- `staff_affiliations.review_note text` (nullable) for "request more info" without rejecting. Cleared on the next approve/reject so a stale note doesn't survive the decision.
- Widens `sa_audit_log.action` + `target_kind` CHECK constraints with the new staff-management actions (`request_staff_info`, `suspend/deactivate/reactivate_staff_affiliation`, `reset_staff_mfa`, `assign_staff_role`, `invite_staff`, `revoke_staff_invitation`) and `staff_invitation` target.

**Edge Functions (6 new, 2 extended)**

- `ha-request-staff-info` — writes the review_note, state stays `pending_approval`.
- `ha-set-staff-status` — single function handling the (active|approved) ↔ (suspended | deactivated) transitions plus reactivation. Allowed transitions are explicit; anything else returns 400. Audit action varies by transition.
- `ha-reset-staff-mfa` — unenrols every Supabase MFA factor on the staff user (per-user, not per-affiliation; the reason ceremony surfaces this).
- `ha-assign-staff-role` — re-assigns role + department; validates target department belongs to THIS hospital (cross-tenant defence) and dedupes against the unique `(user, hospital, dept, role)` index.
- `ha-invite-staff` — 1–100 invitees per call (source=individual or bulk). 256-bit token per invite, SHA-256 hashed for storage, plaintext returned ONCE in the response. One audit row per invite.
- `ha-revoke-staff-invitation` — pulls an outstanding invitation; refuses to re-revoke or to revoke an accepted one.
- `approve-staff-affiliation` + `reject-staff-affiliation` — extended to clear `review_note` so the applicant's pending page never shows a stale note after the decision.

**Pending queue (GATE B)**
Evidence-in-panel slide-out with applicant identity, council + registration number, claimed role / department, the licence document (opened via the existing signed-URL flow against the `clinician-licences` bucket), and approve / reject / request-info actions. Aging chip with thresholds matching the rollup's stale-queue signal. "Info requested" pill on rows with an open review note. The applicant's `/onboarding/clinical-pending` page surfaces the note as an amber "we need more info" section.

**Directory (GATE C)**
Dense filterable table over every active/suspended/deactivated affiliation. Filter chips for status + a department select + a search input. Council registration numbers are stored plaintext (operational lookup) but rendered masked-until-expanded; click reveals per row. Per-row slide-out exposes Change role / Reset MFA / Suspend / Deactivate (active rows) or Change role / Reset MFA / Reactivate (suspended) or Reactivate (deactivated). Sensitive actions carry an amber warning banner explaining blast radius.

**Bulk invite (GATE D)**
One-textarea form (one email per line). On submit, the response's plaintext claim URLs render inline with a copy-to-clipboard button — the admin shares them out-of-band (no SMS integration yet; the kickoff's stub-or-build choice landed on build-the-DB-side, defer SMS). Invitations list shows pending / accepted / revoked / expired, sent/expires dates, inline reason-then-confirm Revoke flow.

**Overview snippet**
`StaffOverviewCard` server component: standalone, takes `hospitalId`, fetches 3 counts + renders a 3-stat grid with deep links into the Staff tabs. Already wired into `/hospital-admin` so the placeholder Overview shows real staff numbers immediately; the Overview feature prompt drops it into its KPI grid when it lands.

**Superadmin rollup (GATE E)**
KPI row + per-hospital totals table + stale-queue health-signal banner. Hospitals with `oldest_pending_days >= 14` get an amber row tint + appear in the banner. Zero-staff hospitals are listed too (silence is signal). No new mutation path: the rollup links into the existing `/admin` Approvals queue for action — the superadmin's role-check + audit there already handles the cross-tenant act.

**Tests (GATE F)**

- `tests/hospital-admin/staff-per-affiliation.test.ts` — RLS-layer regression proving (a) an admin-A anon client sees the same-clinician affiliation at A but not at B; (b) update of the B affiliation from A's session is refused; (c) suspending the A affiliation leaves B's state unchanged; (d) `review_note` clears when the affiliation leaves `pending_approval`. Skipped by default behind `MEDSYNC_ALLOW_RLS_DB_WRITES=1` (same opt-in as the rest of the RLS suite).

**ADRs**

- `0021-hospital-admin-staff-action-model.md` — per-affiliation, never per-user; reactivation lands at `approved` not `active`; MFA reset is the lone documented multi-tenant side effect.
- `0022-superadmin-staff-rollup-aggregate-only.md` — aggregate-only, no individual-row data, no new god-mode path; stale threshold = 14 days; rejects an explicit "escalation" flag in favour of the existing cross-tenant queue.

**Operator actions required**

- `npx supabase db push` to apply migration 0027.
- `npx supabase functions deploy ha-request-staff-info ha-set-staff-status ha-reset-staff-mfa ha-assign-staff-role ha-invite-staff ha-revoke-staff-invitation approve-staff-affiliation reject-staff-affiliation` to deploy the new + extended Edge Functions.

**Out of scope (explicitly)**

- SMS delivery for invitations (Africa's Talking integration is its own scope).
- Bulk CSV upload (the textarea handles ≤ 100 emails; CSV is a polish item).
- Workspace switcher for multi-hospital admins (shell ADR 0019 already deferred this; multi-hospital admins still pin to their most-recently-designated primary).

---

### Added — Hospital-admin workspace shell (overlay) — 2026-05-26

Builds the **shell** of the hospital-admin workspace per the hospital-admin shell kickoff. Not the features — those land in their own prompts. What ships here is the frame every feature plugs into: tenant-scope boundary, route guard, navigation, ⌘K palette, and the integration contract.

**New routes** under `/hospital-admin/*`. The seven feature areas (Overview, Staff, Departments, Scheduling, Admins, Audit, Profile) are reserved as routed placeholders that render the empty shell correctly. Sign-in routes `hospital_admin` users here; `/admin/*` is now superadmin-only and bounces hospital admins to `/hospital-admin` if they bookmark it.

**Tenant scope** — single source of truth:

- `lib/hospital-admin/scope.ts` → `requireHospitalAdminScope()` server-side helper. Validates auth + AAL2, resolves the admin's hospital from `user_roles` + `hospital_admin_roster`, refuses non-reachable lifecycle states (suspended / offboarded / agreement_expired). Redirects on no-scope rather than returning null.
- `app/hospital-admin/_components/scope-provider.tsx` → `useHospitalScope()` client hook. Throws when called outside the provider (programmer-error, not runtime).
- `supabase/functions/_shared/hospital-admin-scope.ts` → `requireHospitalAdminScope(callerId, hospitalId)` Edge Function helper. Re-pins the role check and refuses non-reachable hospitals at the wire.

**Shell composition** (reuses superadmin Attio primitives — re-themed via tokens, not forked):

- `app/hospital-admin/_components/hospital-shell.tsx` — 240px sidebar + 52px top bar + main slot, wrapped in `<HospitalScopeProvider>` so client features read scope without re-fetching.
- `HospitalSidebarItem` — same architecture as `AdminSidebarItem` (server passes primitives, client resolves icons + active state). Separate icon set scoped to this workspace's vocabulary.
- `MobileSidebar` — sheet-based hamburger nav for `<lg`. Sheet primitive reused as-is from `components/ui/sheet.tsx`.
- `HospitalCommandPalette` — ⌘K palette, nav-only for now. Hospital identity displayed in the modal footer so the operator can never forget the active tenant. Entry-registration contract for features to extend is documented in `docs/hospital-admin-integration-contract.md`.

**Hospital identity is ever-present** in the top bar — name + facility level + lifecycle state pill (only shown when not `active`). Replaces the superadmin's "Superadmin console · Production" strip with the tenant the admin operates on.

**Feature registration** — `app/hospital-admin/_lib/features.ts` carries the single `FEATURE_AREAS` array. The shell consumes it to build the sidebar, mobile sheet, and palette. Adding a feature is one entry; the shell doesn't change.

**Sidebar pending-staff badge** — `_lib/staff-pending-count.ts` wires the count from `staff_affiliations.state = 'pending_approval'` filtered to THIS hospital. The Staff feature prompt inherits a working badge from day one.

**Empty-state polish** — `PlaceholderSurface` component renders each reserved area as a credible page (eyebrow chip, Fraunces section title, hairline teal accent, "coming next" list) so the shell already feels Attio-grade before a single feature lands.

**Integration contract** documented in `docs/hospital-admin-integration-contract.md`. Covers: tenant scope accessors (server + client + Edge), feature registration, slide-out panel API, the Edge Function action pattern (CORS → method → Zod → caller → role → scope → audit → mutation → log → typed response), and the audit / no-decrypted-PHI rules.

**Hardened sign-in routing** — `app/(auth)/sign-in/actions.ts` now logs `routeReason: superadmin-role` / `hospital-admin-role` / `staff-affiliation-…` / `default-landing` on every successful sign-in. The `/admin` layout refuses hospital admins by bouncing them to `/hospital-admin`, never silently downgrading them.

**Regression guard** — `tests/hospital-admin/tenant-isolation.test.ts` proves the security boundary at the RLS layer: a hospital_admin scoped to A cannot SELECT, UPDATE, or probe any row in B (staff affiliations, hospitals). Skipped by default behind `MEDSYNC_ALLOW_RLS_DB_WRITES=1` — same opt-in pattern as the existing RLS suite.

**ADRs:** [`0019-hospital-admin-workspace-shell.md`](docs/adr/0019-hospital-admin-workspace-shell.md) (why `/hospital-admin` is structurally separate from `/admin`), [`0020-tenant-scope-resolution.md`](docs/adr/0020-tenant-scope-resolution.md) (why scope is helper-derived, not URL-derived).

**Out of scope (each lands in its own prompt):** Overview KPIs, Staff approvals UI, Departments + wards management, Scheduling, Admin succession transfer, Audit views, Profile edit forms, workspace switcher for multi-hospital admins, `/clinical` workspace.

---

### Added — Hospital registration upgrade (gates A–F) — 2026-05-25

Upgrades hospital onboarding from a thin account-creation flow into a full institution-onboarding system, per [`prompts/hospital-registration-upgrade-kickoff.md`](prompts/hospital-registration-upgrade-kickoff.md). Six gates landed end-to-end on `feat/hospital-registration-upgrade`. Closeout inventory: [`docs/hospital-registration-upgrade-closeout.md`](docs/hospital-registration-upgrade-closeout.md).

**Lifecycle state machine extension** — `public.lifecycle_state` enum gains `under_review`, `agreement_signed`, `provisioning`, `offboarded`, `agreement_expired`. The richer hospital path is `pending_approval → under_review → verified → agreement_signed → provisioning → active`; existing user-scoped paths (patient → active, clinician → pending → active) untouched.

**Schema additions (migrations 0020–0025):**

- `hospital_applications`: 25 additive columns covering institution profile (§B), clinical profile (§C–§E5 arrays + CHECKs + capacity bands), verification (§E6: licence + applicant + authority + callback contact), agreement metadata (§E7). Two junction tables for departments + IM sub-specialties.
- `hospital_dpa_versions` — versioned DPA text, SHA-256 anchored, append-only. Seeded with `v0.placeholder` carrying `{{LEGAL REVIEW — PLACEHOLDER}}` body until Ugandan counsel signs off on v1.
- `hospital_agreements` — per-hospital signings. `source` ∈ `applicant_flow | superadmin_offline | grandfathered`. The agreement gate is enforced server-side via EXISTS check, not FK.
- `hospital_wards` — name + bed_count + optional department FK.
- `hospital_admin_roster` — primary + backup designations with full succession trail. Partial UNIQUE ensures exactly one current primary per hospital.
- `hospital_staff_invitations` — single-use token hash; rows never grant access, only pre-fill + track intent.
- Migration 0024 grandfathers pre-existing hospitals into agreement-gate compliance (honest sentinels, no faked human names).

**Edge Functions (new + extended):**

- `approve-hospital-application` (extended) — creates hospital in `provisioning`, writes `hospital_agreements` row from the application's §E7 metadata, inserts applicant into `hospital_admin_roster` as primary. Rollback chain on partial failure.
- `sa-activate-hospital` (extended) — calls `requireCurrentAgreement` (the gate) before any state flip. Refuses 400 if no current agreement.
- `sa-create-hospital` (new) — superadmin-initiated hospital creation. Atomic chain: audit → hospital → agreement (offline) → invitation. Returns plaintext invitation token for the superadmin to share out-of-band.
- `accept-hospital-admin-invitation` (new) — invitee-only. Token + email + AAL2 + verified-TOTP checks. Writes user_roles + roster row + audits as `hospital_admin_claimed`.

**Routes added:**

- `/signup/hospital` rewritten — 7-step MultiStepForm for the expanded application (institution / departments+IM / clinical / operating / verification / agreement / account).
- `/admin/setup` — hospital_admin's 6-step post-approval setup wizard. Refuses superadmin sessions (ADR 0018 Q3). Final step calls `sa-activate-hospital` → fires the gate.
- `/admin/claim-invitation?token=…` — invitee landing for accepting the hospital_admin invitation.
- `/admin/tenants` now hosts a "Create hospital" button → superadmin-initiated create flow (Sheet).

**ADRs:**

- [0016 — Hospital verification model](docs/adr/0016-hospital-verification-model.md) — three concentric trust anchors; callback contact REQUIRED for applicant path.
- [0017 — Hospital agreement gate](docs/adr/0017-hospital-agreement-gate.md) — `hospital_agreements` is the activation gate; server-side EXISTS check; both onboarding paths feed it.
- [0018 — Superadmin-initiated hospital create path](docs/adr/0018-superadmin-hospital-create-path.md) — superadmin creates tenant not admin; wizard rejects superadmin sessions.

**Tests:** +48 (26 lifecycle, 17 RLS on new tables, 5 agreement-gate regression). Total 119/119 passing. Phase 0 + onboarding suites unchanged.

**Deferred (documented in closeout):** saved-drafts autosave/resume on the 7-step form; bulk staff invitation CSV ingest; admin succession transfer Edge Function; hospital_admin self-activation from the wizard; email delivery for invitations (currently the URL is shared out-of-band); agreement renewal flow when the lawyer-approved DPA arrives.

**Operator actions after merge:**

1. `npx supabase db push` — applies migrations 0020–0025.
2. `npx supabase functions deploy approve-hospital-application sa-activate-hospital sa-create-hospital accept-hospital-admin-invitation`.
3. When the counsel-approved DPA text arrives, insert a v1 row in `hospital_dpa_versions` with `legal_review_status='approved'` + `supersedes_id` pointing at the placeholder.

### Removed — Phase 1 onboarding rollback — 2026-05-23

The Phase 1 onboarding pass (gates A–G below) was rolled back to redesign the flow from scratch. All Phase 1 routes (`/get-started`, `/signup/*`, `/admin/*`), the seven shared form primitives, the lib helpers (`patient`, `clinician`, `hospital`, `approvals`, `lifecycle`, `reference-data`, `signup-drafts`), the Phase 1 schemas + migrations (`0006`–`0015`), `lib/auth.ts` extensions, ADR-0013, and `docs/reference-data-sources.md` were deleted. The older Phase 0 `/onboarding/{patient,clinical,hospital}` email-capture forms went with them.

Landing CTAs reverted to honest `mailto:hello@medsync.health` framing ("Email a founder") since no onboarding flow exists. `lib/auth.ts` reverted to its Phase 0 shape. `react-day-picker` removed from `package.json`.

DB rollback: paste [`scripts/rollback-phase-1.sql`](scripts/rollback-phase-1.sql) into Supabase Studio → SQL editor. Drops every table, enum, function, sequence, Storage bucket, and `users.state` column the Phase 1 era created. Idempotent.

### Added — Phase 1 onboarding (gates A–G) — 2026-05-23 [ROLLED BACK]

Opens the front door of MedSync to four audiences. Phase 0 ended with an empty authenticated shell + a public landing page; Phase 1 ships the multi-step signup flows, the approval-gated lifecycle, and the superadmin / hospital_admin review surfaces. Architecture recorded in [`docs/adr/0013-onboarding-architecture.md`](docs/adr/0013-onboarding-architecture.md); reference-data placeholder status in [`docs/reference-data-sources.md`](docs/reference-data-sources.md).

**Routes added (10):**

- `/get-started` — intent selector (3 tiles)
- `/signup/patient` + `/signup/patient/verify` + `/signup/patient/done`
- `/signup/clinical` + `/signup/clinical/verify` + `/signup/clinical/pending`
- `/signup/hospital` + `/signup/hospital/verify` + `/signup/hospital/pending`
- `/admin` (landing) + `/admin/applications` + `/admin/applications/[id]` + `/admin/affiliations` + `/admin/affiliations/[id]`

**Gates:**

- **[GATE A]** Onboarding schema + reference data. Migrations 0008 (lifecycle enum + reference tables + signup_drafts + clinician_profiles + staff_affiliations), 0009 (RLS), 0010 (seed councils / cadres / IM specialties / IM roles / regions). Drizzle schemas under [`db/schema/`](db/schema/) for the new tables; typed loaders in [`lib/reference-data.ts`](lib/reference-data.ts); lifecycle state machine in [`db/schema/lifecycle.ts`](db/schema/lifecycle.ts) + [`lib/lifecycle.ts`](lib/lifecycle.ts) (8 states; `LIFECYCLE_TRANSITIONS` enforces valid forward edges).

- **[GATE B]** Seven shared form primitives — `Combobox`, `CascadingCombobox`, `SegmentedControl`, `RadioCards`, `FileUpload`, `OtpInput`, three-mode `DatePicker` — under [`components/form/`](components/form/), all interactive on `/styleguide §14` with realistic Uganda data. Built on Base UI primitives + react-day-picker v10. Wrapped a Base UI `Popover` in [`components/ui/popover.tsx`](components/ui/popover.tsx) so every floating panel shares one surface style. All seven have arrow-key + Home/End nav, focus rings, hidden-input bridges for FormData submission.

- **[GATE C]** Patient signup end-to-end. Migration 0011 (`patient_sex` + `patient_id_type` enums, `patient_code_seq` + `issue_patient_code()` emitting MS-YYYY-NNNNN, `patient_profiles` table with CHECK enforcing `id_type`↔`id_number` presence, seeded 21 Uganda districts + 5 Kampala divisions) and 0012 (owner-only RLS). [`lib/patient.ts`](lib/patient.ts) does Supabase signUp → email OTP → encrypt NIN + phone via [`lib/encryption.ts`](lib/encryption.ts) → insert profile → lifecycle `unverified → verified → active` → MS-ID issued. Three-step form (About you / ID & location / Account & consent) at [`app/signup/patient/_form.tsx`](app/signup/patient/_form.tsx). PHI lives in a 30-min `httpOnly` + `sameSite=strict` + Secure-in-prod cookie until OTP verifies; password never enters it.

- **[GATE D]** Clinical-staff signup end-to-end. Migration 0013 creates the private `clinician-licences` Storage bucket (5 MB / PDF or JPG or PNG) with RLS that lets the owner read/write under `<user_id>/...`, the superadmin read all, and a hospital_admin read any licence whose owner has an affiliation at their hospital. [`lib/clinician.ts`](lib/clinician.ts) does Supabase signUp → service-role licence upload (the user has no usable session pre-verify) → cookie-stash metadata + path → OTP verify → insert `clinician_profile` + `staff_affiliations` + `user_roles` → lifecycle `unverified → verified → pending_approval`. Three-step form (Account / Professional identity / Affiliation). Postgres pool bumped on `lib/reference-data.ts` / `lib/patient.ts` / `lib/clinician.ts` from `max=1` to `max=3-5` with `idle_timeout: 20` — the single-socket setup serialized the clinical page's 6 parallel ref-data queries and hung dev requests for 60s; with five sockets the page returns in ~2s. Well under Supabase Free's 15-connection cap.

- **[GATE E]** Hospital application end-to-end. Migration 0014 adds the `hospital_ownership` enum, `hospital_applications` table (intentionally separate from `public.hospitals` so the rest of the app's queries stay on approved facilities only), owner-only / superadmin-read RLS, and a private `hospital-authorisations` Storage bucket with the same RLS pattern as `clinician-licences`. [`lib/hospital.ts`](lib/hospital.ts) does Supabase signUp → service-role authorisation-letter upload → OTP verify → insert `hospital_applications` row at state `pending_approval` → lifecycle `unverified → verified → pending_approval`. Three-step form (Hospital / Location & registration / Applicant & account) with level combobox, ownership segmented, district + Kampala-division subcounty cascading, letter-of-authority FileUpload mirrored to a hidden file input for FormData submission. Distinct from the landing's "express interest" capture at `/onboarding/hospital` which just lands an email in `interest_signups`.

- **[GATE F]** Superadmin + hospital*admin review queues. [`/admin`](app/admin/) shell + `requireAdminish` guard + role-aware nav. Approval logic in [`lib/approvals.ts`](lib/approvals.ts): hospital application approval inserts `public.hospitals` → sets `approved_hospital_id` → application `→ approved` → inserts `user_roles` (hospital_admin scoped to the new hospital) → lifts applicant lifecycle `pending_approval → approved → active`. Staff-affiliation approval: `pending_approval → approved → active`, and lifts the user lifecycle if it's still pending. Authorization is enforced in the \_server action* before `lib/approvals.ts` is called — `requireSuperadmin()` / `requireAdminish()` + a hospital-scope re-check on every affiliation mutation, so a forged `affiliation_id` can't bypass the scope filter. Migration 0015 attaches the existing `audit_log_changes()` trigger to `clinician_profiles`, `staff_affiliations`, `patient_profiles`, `hospital_applications`. `lib/auth.ts` extended with `roleRows: { role, hospitalId }[]` on `AuthState` + `requireSuperadmin` / `requireAdminish` / `adminHospitalIds()` helpers.

- **[GATE G]** Closeout. [`docs/reference-data-sources.md`](docs/reference-data-sources.md) records every `ref_*` catalog's source, status, and TODOs (UBOS NPHC 2024 full district + subcounty pull; pharmacy regulator name confirmation; specialty + role expansion beyond IM). [`docs/adr/0013-onboarding-architecture.md`](docs/adr/0013-onboarding-architecture.md) names the lifecycle / PHI-handling / approval / form-primitive decisions and the trade-offs we accepted. CHANGELOG + README + ADR index updated. Mobile-first + a11y verification pass on the new routes.

**Files added (Phase 1, exhaustive):**

- Schemas: `db/schema/lifecycle.ts`, `db/schema/reference-geography.ts`, `db/schema/reference-clinical-catalog.ts`, `db/schema/staff-affiliations.ts`, `db/schema/signup-drafts.ts`, `db/schema/patient-profiles.ts`, `db/schema/hospital-applications.ts`.
- Helpers: `lib/lifecycle.ts`, `lib/reference-data.ts`, `lib/signup-drafts.ts`, `lib/patient.ts`, `lib/clinician.ts`, `lib/hospital.ts`, `lib/approvals.ts`.
- Form primitives: `components/form/{combobox,cascading-combobox,segmented,radio-cards,file-upload,otp-input,date-picker}.tsx`, `components/ui/popover.tsx`, `components/styleguide/form-primitives-demo.tsx`.
- Routes: `app/get-started/page.tsx`, `app/signup/{patient,clinical,hospital}/` (page + form + actions + verify + done/pending), `app/admin/` (layout + landing + applications + affiliations queues and detail pages).
- Migrations: `0008` through `0015`.
- Docs: `docs/adr/0013-onboarding-architecture.md`, `docs/reference-data-sources.md`.

**Auth + lifecycle invariants:**

- `MFA_REQUIRED_ROLES` = clinician, nurse, pharmacist, lab_tech, hospital_admin, superadmin. Patient is opt-in.
- No clinical access before `active`; `pending_approval` accounts can sign in but the proxy routes them to MFA setup → pending screen.
- All sensitive writes go through service-role helpers; the user-context Supabase client is used only for reading-with-RLS.

**PHI posture:**

- NIN + phone encrypted at rest (AES-256-GCM, ADR-0008) in `patient_profiles`. Plaintext phone on `public.users.phone` for operational routing (SMS, support).
- Licence / authorisation documents stored in private Storage buckets keyed by `<user_id>/<timestamp>-<kind>.<ext>`, RLS gated to owner + scoped reviewer + superadmin.
- Logger only sees `user_id` and the issued patient_code; never email, name, phone, NIN, DOB.

**Deferred (out-of-Phase-1 scope):**

- Full UBOS NPHC 2024 district + subcounty seed (placeholder + tracker doc shipped this gate).
- `signup_drafts` server-side draft swap (the table exists; the cookie-to-row migration is Phase 2).
- Signed-URL helper to open the licence / authorisation file directly in the review page (today it shows the bucket path; opening is via Supabase Studio).
- Phone OTP via Africa's Talking (kickoff specifies phone primary; we use email OTP for verification this gate and store the phone for downstream SMS).
- Dashboard widget for pending clinicians / pending hospital admins (today they see status on the `/signup/.../pending` page; no link from `/dashboard`).

### Added — Landing page — Patient-experience addendum (gates PA–PE) — 2026-05-23

Weaves the patient surfaces into the landing page so the closed loop visibly has two ends. The base page (gates A–F below) was told almost entirely from the clinician / hospital side; this addendum threads the patient's view through the hero, the §07 scroll-pin, the data-sources viz, the Uganda-fit tiles, and the final CTA — plus adds one new dedicated patient chapter — without rewriting any existing section.

**Hard constraint enforced (addendum §0):** additive integration only. The diff confines to 10 files (3 new under `components/landing/`, 7 small edits to existing files). Everything outside that set renders byte-identical to before the branch. Three-door equal-weight rule preserved in `OnboardingCtaCluster`.

**Built on feature branch `feat/landing-patient-experience`. Merged to main at GATE PE.**

**Gates:**

- **[GATE PA]** [`_my-health-mock.tsx`](components/landing/_my-health-mock.tsx) — patient-end twin of the §05b `ClinicianHomeMock`. Static composition, server component, no client JS. Renders as a floating-card stack (initial phone-bezel iteration dropped at PB.1 — the bezel competed visually with the clinician dashboard). Component API: `<MyHealthMock fragment="full" | "log-reading" | "today-meds" | "sms-offline" | "report-concern" />`. Fragment variants let later gates embed individual cards inline. Reviewable standalone on `/styleguide` Section 14. Reuses Amina N. continuity: same patient, same Mulago IM-A ward, same Dr. M. Okello, same glucose series, same med list (Metformin, Lisinopril, Glibenclamide held, Insulin Actrapid). Tone (addendum §C) enforced: "5 days on track" (not "% compliant"), "held by your care team" (caution amber, never red failure), "Something feels off?" with "they'll review and reply" (calm channel, not emergency button).

- **[GATE PB]** Hero + §07 dual surfaces:
  - **`_hero-surfaces.tsx`** — wraps the existing `ClinicianHomeMock` and tucks the `MyHealthMock` into the hero section's bottom space, right-aligned at `lg+` and centred at `<lg`, with a small "… and on Amina's app at home" connecting label. `app/page.tsx` swap: `<ClinicianHomeMock />` → `<HeroSurfaces />`. ClinicianHomeMock itself unchanged.
  - **`07-platform-showcase.tsx`** — minimal surgical edit: 1 added import + 1 new internal `DualSurface` component + 2 case statements modified in `SurfaceForScene` (scene 3 Discharge + scene 4 Loop-closes now show the patient phone fragment above the existing clinician card). Scene metadata, IntersectionObserver, sticky pin, mobile fallback, motion-reduce — all unchanged.

- **[PB.1 fix]** Removed phone-bezel framing from `MyHealthMock`. The dark device shell + iOS status bar made the patient surfaces feel grafted on. Stripped to a clean floating-card stack matching the page's Attio rhythm. `_hero-surfaces.tsx` adjusted accordingly (the lg+ absolute scaled overlay was a phone-shape pattern; replaced with right-aligned cards + a small connecting label).

- **[GATE PC]** [`07b-patient-chapter.tsx`](components/landing/07b-patient-chapter.tsx) — new dedicated patient-POV chapter inserted between §07 [01] and §08 mid-band, in the same Attio "numbered chapter" archetype the existing chapters use. Page narrative now reads `platform / clinician loop → patient view → CTA break → team / specialty adaptation`. Four sub-points with alternating text/surface rows for visual rhythm:
  - a) Log in seconds, not in a notebook → `MyHealthLogReadingCard`
  - b) Never lose track of a dose → `TodayMeds` + `AdherenceStrip` + `SmsReminderChip`
  - c) Tell your team without a trip to hospital → `MyHealthReportConcernCard`
  - d) You're never logging into silence → `CareTeamReplyCard` (bespoke — Dr. M. Okello acknowledging the reading, tele-follow-up booked; closes the human-on-other-end reassurance beat)
    Card primitives exposed from `_my-health-mock.tsx` as `MyHealthLogReadingCard`, `MyHealthTodayMedsCard`, etc. for the chapter's surface composition.

- **[GATE PD]** Three remaining weaves:
  - **§10a Enrichment** ([`10-enrichment.tsx`](components/landing/10-enrichment.tsx)) — added 6th source row "Patient logs & confirmations · Amina's MedSync app" with `PATIENT` chip tag + teal-300 border highlight. FlowLines SVG paths recomputed from 5 → 6 curves. The record is now visibly "built **with** the patient, not just **about** them."
  - **§12a UgandaCapabilities** ([`12-uganda-capabilities.tsx`](components/landing/12-uganda-capabilities.tsx)) — added optional `patientSurface?: React.ReactNode` to the `Capability` interface. Offline-first tile gets a bespoke `OfflineSavedReadingCard` ("Saved · will sync when you're back online"); SMS · USSD tile gets the existing `MyHealthSmsReminderChip`. Other 3 tiles render identically. New "On Amina's phone" labelled slot above the existing Technical detail strip. The two Uganda-fit claims now ground in concrete patient experience.
  - **§16 FinalCta** ([`16-final-cta.tsx`](components/landing/16-final-cta.tsx)) — new `PatientGlimpse` sibling rendered between the closer line and the door cluster. Mini-card showing a "Fasting glucose 11.6 mmol/L · Logged from home" entry with a "Log this morning's reading" affordance and an arrow-down line: "Sign up below as a patient and this is in your hand ↓". `OnboardingCtaCluster` unchanged — three-door equal-weight rule preserved; visual pull added via the sibling, not asymmetric door styling.

- **[GATE PE]** Closeout + regression:
  - Integration scope check: diff confined to 10 files in the named scope. Zero out-of-scope edits.
  - Lint: 0 errors, 0 warnings.
  - Vitest: 71/71 pass (no existing test broke).
  - Build: 18 routes, all green.
  - Motion: every `animate-*` in PE-owned files paired with `motion-reduce:*` guard. Only one new animation across the whole addendum (motion-safe pulse on the "due now" clock icon in `MyHealthMock`).
  - A11y: section components carry `aria-label` / `aria-labelledby`; mock cards use semantic `<ul>` / `<li>` / `<article>`; non-interactive button-shaped elements use `tabIndex={-1}` to stay out of the keyboard order.
  - Tone (§C) verified: "5 days on track" not "% compliant"; "held by your care team" not "missed dose"; "Something feels off?" not "emergency"; "not a faceless AI agent" explicit in sub-point d; "works on basic phones" anchor on the SMS chip; no diagnosis copy in marketing; honest "early access" framing; named clinician (Dr. M. Okello), not anonymous AI.
  - Dev smoke: `/` 200, 615 KB (~+105 KB total from the addendum across all gates). Patient chapter, hero dual surfaces, §07 scenes 4 + 5 dual surfaces, §10a 6th source, §12a grounded tiles, §16 patient glimpse — all rendering. All untouched landing sections still rendering identically.

### Added — Landing page — Attio-archetype rebuild (gates A–F) — 2026-05-22

The public marketing page at `/` was rebuilt as a 17-section Attio.com archetype, executed as 6 gated commits (A scaffold → F closeout). Mirrors Attio's section skeleton, not its look. Spec rules enforced throughout: no fabricated logos, no fabricated testimonials, no fake certifications, no uptime numbers we haven't measured, every product mock marked ILLUSTRATIVE.

**Sections built (17 total, all real, zero stubs in production):**

- §01 [`01-announcement-bar.tsx`](components/landing/01-announcement-bar.tsx) — dismissible top strip; persists via `useSyncExternalStore` against localStorage (same-tab via custom event, cross-tab via native `storage` event).
- §02 [`02-nav.tsx`](components/landing/02-nav.tsx) — sticky-shrink nav driven by a 1px `IntersectionObserver` sentinel (no scroll listener). Hover-revealed mega-menus for Platform + Care doors. Mobile drawer with body-scroll lock.
- §03 [`03-floating-quote.tsx`](components/landing/03-floating-quote.tsx) — Fraunces-italic founders'-voice quote attributed to Usama Fadhul (Founder & Clinical Safety Officer).
- §04 [`04-sub-banner.tsx`](components/landing/04-sub-banner.tsx) — pilot-recruitment pill → `/onboarding/hospital`; live-dot ping is `motion-reduce:hidden`.
- §05a [`05-hero.tsx`](components/landing/05-hero.tsx) — H1 _"A digital hospital that doesn't stop at the gate"_ at `clamp(40px, 7.4vw, 92px)`; soft teal `oklch` radial atmosphere + inline-SVG turbulence grain; staggered `reveal-up` cascade gated on `motion-safe`; three equal audience doors via shared `OnboardingCtaCluster`.
- §05b [`05-clinician-home-mock.tsx`](components/landing/05-clinician-home-mock.tsx) — illustrative ward-overview surface; sample-data continuity: **Amina N. / MS-00184 / Mulago IM-A / Dr. M. Okello**. Inline-SVG glucose trend with 4–10 mmol/L target-band overlay, critical-alert chip, suggested-slot affordance, care-team avatars. Perspective transform with `motion-reduce:transform-none`. **ILLUSTRATIVE** badge required by spec rule #3.
- §06 [`06-trust-strip.tsx`](components/landing/06-trust-strip.tsx) — honest substitute for the logo wall: UMDPC · UNMC · AHPC · PSU chips with "Designed to comply with" framing and explicit "Not endorsements, not partnerships" caveat.
- §07 [`07-platform-showcase.tsx`](components/landing/07-platform-showcase.tsx) — 5-scene scroll-pin (`Admit → Diagnose → Treat → Discharge → Loop closes`); sticky right pane cross-fades between five focused product cards; single `IntersectionObserver` with `rootMargin: -35% 0 -35% 0` so the middle band wins; reduced-motion + `<md` drops the pin and stacks surfaces inline.
- §08 [`08-cta-band.tsx`](components/landing/08-cta-band.tsx) — mid-page dark CTA band on `bg-teal-950` with the same three doors (`tone="dark"`); no free-trial language per spec.
- §09a [`09-adaptive-model.tsx`](components/landing/09-adaptive-model.tsx) — "The closed-loop record"; 4 IM specialty tabs (Diabetology / Cardiology / Nephrology / Pulmonology); each tab swaps 6 clinical object cards (Patient / Vital / Medication / Note / Lab / Appointment) with attributes shifted per specialty (HbA1c · LVEF · eGFR · FEV1). "+N more attributes" affordance mirrors Attio. Signature-attributes strip beneath shows each specialty's diagnostic fingerprint. State-driven swap → instant on reduced-motion.
- §09b [`09-voices.tsx`](components/landing/09-voices.tsx) — three founders'-voice problem cards paired with mini answer surfaces (home-monitoring escalation, 7-day SMS adherence log, shared-record stream). Attribution "MedSync founding team" per spec rule #2 (no fabricated testimonials).
- §10a [`10-enrichment.tsx`](components/landing/10-enrichment.tsx) — 5 care-data source chips with static-SVG curved flow lines (oklch gradient) converging into a destination-card preview. Server component. `motion-safe:fade-in-slow` per path with stagger; reduced-motion gets static lines.
- §10b [`10-patient-card.tsx`](components/landing/10-patient-card.tsx) — **the page's richest single composition** (per spec). Full Amina N. unified record: header + auto-summary synthesis + triple column (Vitals: inline glucose 7d trend + BP 7d bars w/ 140 target line · Active meds: 5 lines with SMS-confirmed adherence bars · Recent labs: 6 results vs. reference ranges) + care-plan timeline (6 milestones, pulsing active dot) + care team / audit trail split. Card chrome + ILLUSTRATIVE badge.
- §11 [`11-ecosystem.tsx`](components/landing/11-ecosystem.tsx) — replaces Attio's "1000+ integrations" logo wall with a name-only grid of real Uganda care infrastructure (HMIS2/DHIS2 · NIRA · NDA · MTN · Airtel · Africa's Talking · Mulago central lab · MBN · Lancet · NMS · JMS · MoMo · Airtel Money · UAP/Jubilee · regional + mission hospitals). Each chip tagged **Integration target** — not active partnerships. Zero logos.
- §12a [`12-uganda-capabilities.tsx`](components/landing/12-uganda-capabilities.tsx) — 5 design-commitment cards (no fake uptime stats): offline-first wards · SMS/USSD reach · low-bandwidth UI · Mobile-Money payments · local data residency. Each card pairs a real-world Uganda constraint with the technical commitment.
- §12b [`12-trust-governance.tsx`](components/landing/12-trust-governance.tsx) — 6 engineering-claim pillars (no fake HIPAA/ISO/SOC2 badges). Each pillar = human claim + actual mechanism (PostgreSQL RLS, SECURITY DEFINER audit triggers, AES-256-GCM PHI encryption, mandatory AAL2 MFA, PII-redacted logging, Uganda DPA region pinning) + **receipts:** line pointing to the file in this repo.
- §13 [`13-founding-story.tsx`](components/landing/13-founding-story.tsx) — typographic narrative; UF monogram tile instead of a stock portrait; 5 paragraphs naming the two gaps MedSync exists to close (the patient walking out, the next clinician walking in).
- §14 [`14-vision.tsx`](components/landing/14-vision.tsx) — three horizons (Now / Soon / Later). The Later card carries a `Research only · subject to ethics + regulatory review` badge so closed-loop insulin dosing & OPD triage research read as research, not roadmap. No invented dates.
- §15 [`15-faq.tsx`](components/landing/15-faq.tsx) — native `<details>/<summary>` accordion (server-rendered, keyboard-accessible, no JS required). 8 honest questions including a direct "**No.** Holding none of those today" for HIPAA/ISO/SOC2 and cost-only first-pilot pricing.
- §16 [`16-final-cta.tsx`](components/landing/16-final-cta.tsx) — closing dark band on `bg-teal-950` (deeper than §08); H2 "The next era of Ugandan care doesn't stop at the gate." + closer "And the patients are waiting."; same three doors `tone="dark"`.
- §17 [`17-footer.tsx`](components/landing/17-footer.tsx) — 4-column nav (Audience doors / Platform / Built for Uganda / Legal & status) + brand block + standards strip (UMDPC/UNMC/AHPC/PSU) + Uganda DPA disclaimer. Legal links flagged "in legal review"; status "coming soon"; no fake social handles.

**Patient continuity:** Amina N. (MS-00184) is the single sample-data through-line across §05b → §07 → §09a → §09b → §10a → §10b. Same NIN-masked, same Mulago IM-A ward, same Dr. M. Okello, same glucose 14.2 mmol/L alert.

**Three audience doors** (`/onboarding/{patient,clinical,hospital}`) are the single source of truth in [`_cta-cluster.tsx`](components/landing/_cta-cluster.tsx) — change copy once, every CTA on the page updates. Three layouts (`doors` / `inline` / `pills`) × two tones (`light` / `dark`).

**Audience funnels:** new [`interest_signups`](db/schema/interest-signups.ts) table with RLS (anon `INSERT`, superadmin `SELECT`); shared server action [`app/onboarding/_actions.ts`](app/onboarding/_actions.ts) handles all three forms. Migration [`0007_interest_signups_rls.sql`](supabase/migrations/0007_interest_signups_rls.sql). Routes [`/onboarding/patient`](app/onboarding/patient/page.tsx), [`/onboarding/clinical`](app/onboarding/clinical/page.tsx), [`/onboarding/hospital`](app/onboarding/hospital/page.tsx) are publicly accessible via [`proxy.ts`](proxy.ts).

**Type system — Editorial clinical aesthetic:** Fraunces (serif display, `opsz` axis for the 92px hero H1) + Geist Sans (clinical body) + Geist Mono (tabular labs/vitals/IDs). All three loaded via `next/font/google` with CSS-variable handoff into the Tailwind v4 `@theme`, replacing the dead Neue Haas / Helvetica fallback the design system was pointing at.

**SEO shell:** full [`app/layout.tsx`](app/layout.tsx) Metadata with `openGraph` / `twitter` / canonical / `robots`; `MedicalOrganization` JSON-LD; [`app/sitemap.ts`](app/sitemap.ts) + [`app/robots.ts`](app/robots.ts); [`lib/site-config.ts`](lib/site-config.ts) centralises `SITE_URL` so the custom-domain swap is one-line.

**Closeout (GATE F):**

- Global `:focus-visible` rule in [`globals.css`](app/globals.css) (`:where(a, button, summary, [role="button"], [tabindex])`) → uniform teal keyboard-focus ring on every interactive element.
- Custom [`app/not-found.tsx`](app/not-found.tsx) — same editorial aesthetic, three audience doors so a missed link isn't a dead end. `robots: { index: false }`.
- Reduced-motion audit: every `animate-pulse` / `animate-ping` / `motion-safe:*` verified guarded.
- A11y audit: every section has `aria-label` / `aria-labelledby`; mobile drawer is `role="dialog"` `aria-modal="true"`.

**Build:** 17 routes (added `/_not-found`), 0 lint errors, 0 type errors, **71/71 tests** still passing.

### Added — Phase 0.12 (Vercel deployment) — 2026-05-22

- **MedSync is live: https://medsync-bice.vercel.app** (Vercel default URL; custom domain `medsync.health` deferred per session decision).
- New Vercel project `medsync` created and linked under `fadhulusama-gmailcoms-projects`.
- [`scripts/push-env-to-vercel.mjs`](scripts/push-env-to-vercel.mjs) — reads `.env.local` via `@next/env`, pushes each var to Vercel via `vercel env add KEY ENV --value V --force`. Idempotent. Used to push 5 required vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `DATABASE_DIRECT_URL`) to Production + Development.
- Preview env vars deferred — Vercel CLI's `--yes` flag is currently ignored for `vercel env add KEY preview --value V`, which prompts for a git branch even with `--yes`. Workaround documented in ADR-0012: set preview vars via dashboard if/when we cut a preview branch.
- Vercel CLI installed as a dev dep (`vercel@54.3.0`) — sandbox blocked the global install.
- Build pipeline auto-detected (Next.js 16, `next build`, output dir default). Build took 53s. Emitted 8 routes (`/`, `/_not-found`, `/sign-up`, `/sign-in`, `/sign-in/mfa`, dynamic `/dashboard`, `/onboarding/mfa-setup`, `/sign-out`, `/api/health`) plus the proxy middleware.
- Smoke verified live: `/` → 200, `/styleguide` → 200, `/api/health` → 404 (correctly env-gated to non-production).
- ADR-0012 documents the deploy decisions, the preview-env CLI bug workaround, the GitHub-remote / CI / custom-domain / separate-prod-Supabase-project follow-ups.

### Added — Phase 0.11 (Phase 0 seed) — 2026-05-22

- [`supabase/migrations/0005_seed_phase_0.sql`](supabase/migrations/0005_seed_phase_0.sql) — idempotent SQL seed:
  - 1 hospital: **Mulago National Referral Hospital** (`mulago-national`, level `national_referral`, Kampala, Central region).
  - 1 top-level department: **Internal Medicine** (`internal-medicine`).
  - 13 IM sub-specialties under it: Cardiology, Nephrology, Endocrinology/Diabetology, Pulmonology, Gastroenterology, Hepatology, Neurology, Infectious Diseases, Oncology, Haematology, Rheumatology, Dermatology, Geriatrics.
- Fixed UUIDs (`00000000-0000-0000-0000-0000000000Nx`) so later phases can rely on them in FKs / fixtures.
- Every INSERT uses `ON CONFLICT DO NOTHING` on its natural key (slug for hospital; `(hospital_id, parent_id, slug)` for departments). The migration journal also gates re-application — belt-and-braces.
- Verified live via SQL: 1 hospital + 14 department rows.

### Added — Phase 0.10 (Edge Functions foundation) — 2026-05-22

- [`supabase/functions/_shared/`](supabase/functions/_shared/) — four helpers that make the mandatory nine-step pattern uniform:
  - `cors.ts` — `preflight()` + `corsHeaders()`; origin allowlist includes `medsync.health`, `localhost:3000`, `*.vercel.app`.
  - `auth.ts` — `getCaller(request)` validates Bearer JWT via `getUser()`; `hasRole(userId, role, hospitalId?)` queries via service-role (bypasses RLS); `serviceClient()` is the one path to service-role mutations from inside Edge Functions.
  - `logger.ts` — Deno-side PII-redacted JSON logger that mirrors `lib/logger.ts`.
  - `errors.ts` — typed `{ ok, error?, data? }` envelope: `ok`/`badRequest`/`unauthorized`/`forbidden`/`conflict`/`methodNotAllowed`/`serverError`. `X-Request-Id` echoed back for triage correlation.
- [`supabase/functions/assign-role/index.ts`](supabase/functions/assign-role/index.ts) — reference function implementing the full nine-step pattern: CORS preflight → POST gate → Zod input → authn → role authz (superadmin OR hospital_admin scoped) → service-role INSERT → log → audit (automatic via 0.6 trigger) → typed response. Duplicate grants return idempotent `{ already_held: true }` rather than 409.
- [`supabase/functions/deno.json`](supabase/functions/deno.json) — Deno strict config, fmt rules.
- [`supabase/functions/README.md`](supabase/functions/README.md) — local serve + deploy commands.
- `tsconfig.json` excludes `supabase/functions/` (Deno typechecks its own).
- ADR-0011 locks in the nine-step pattern, the two-runtime duplication trade-off, and the Supabase-CLI-based deployment path.

### Added — Phase 0.9 (auth + MFA + route protection) — 2026-05-22

- [`supabase/migrations/0004_auth_user_mirror.sql`](supabase/migrations/0004_auth_user_mirror.sql) — `AFTER INSERT ON auth.users` trigger (`SECURITY DEFINER`) auto-mirrors into `public.users` with `id`, `email`, `full_name` from metadata (or email as fallback). Atomic with the auth insert; survives Server Action signups, admin API creates, and test setup.
- [`lib/auth.ts`](lib/auth.ts) — single `getAuthState()` helper returns `{ user, roles, mfaRequired, aal, nextAal }`. `MFA_REQUIRED_ROLES = { clinician, nurse, pharmacist, lab_tech, hospital_admin, superadmin }`. Always uses `getUser()` (validated), never `getSession()`.
- [`lib/supabase/proxy.ts`](lib/supabase/proxy.ts) + [`proxy.ts`](proxy.ts) — Next 16 proxy. Three responsibilities per request: (1) refresh Supabase session cookie via `updateSession()`, (2) gate public vs protected routes, (3) enforce AAL2 for users with MFA enrolled / redirect clinical-role holders to `/onboarding/mfa-setup` if not enrolled. Matcher skips `_next`, `/monitoring`, favicon, image extensions.
- Auth pages (route group `(auth)`):
  - [`/sign-up`](<app/(auth)/sign-up/>) — email / full_name / password; Zod-validated server action; trigger does the public.users mirror.
  - [`/sign-in`](<app/(auth)/sign-in/>) — email / password; honours `?redirect=<path>`.
  - [`/sign-in/mfa`](<app/(auth)/sign-in/mfa/>) — 6-digit TOTP challenge; elevates session to AAL2.
  - [`/onboarding/mfa-setup`](<app/(auth)/onboarding/mfa-setup/>) — TOTP enrolment; QR code rendered server-side via `qrcode` package (secret never leaves the server response); sweeps stale unverified factors on every visit.
- [`/dashboard`](app/dashboard/) — placeholder protected page showing user roles + MFA status.
- [`/sign-out`](app/sign-out/) — POST-only route handler (avoids GET-link CSRF logout).
- [`<AuthCard>`](components/medsync/auth-card.tsx), `<FieldError>`, `<FormError>` — shared auth-form primitives.
- Forms use React 19 `useActionState` + Server Actions; work without JavaScript (progressive enhancement).
- Tests: [`tests/auth/auth-flow.test.ts`](tests/auth/auth-flow.test.ts) — 4 cases (mirror with metadata, mirror without metadata, duplicate-email rejection, fresh user AAL state). `tests/rls/users.test.ts` updated — the trigger now creates public.users rows for us, the test seeds `full_name` via UPDATE only. Total suite **71/71 across 10 files** (~70s).
- Dependency: `qrcode` + `@types/qrcode`.
- ADR-0010 documents the trigger choice, `getAuthState` single-seam pattern, Server Action + `useActionState` over react-hook-form, the proxy logic, and per-request DB-query cost (acceptable for Phase 0; move roles to JWT `app_metadata` in Phase 1 if needed).

### Added — Phase 0.8 (logging + Sentry) — 2026-05-22

- [`lib/logger.ts`](lib/logger.ts) — structured JSON logger with field-name PII redaction. `logger.debug/info/warn/error`; `debug` no-ops in prod. Every context object passes through `redactPII()` before serialization. Redacts the kickoff-mandated set + extensions: `name`, `first_name`, `last_name`, `full_name`, `email`, `phone`, `phone_number`, `nin`, `national_id`, `date_of_birth`, `dob`, `address`, `password`, plus auth tokens / cookies / authorization. Case-insensitive; recurses through nested objects + arrays; handles `Error` (collapses to `{name, message, stack}`); circular references → `"[CIRCULAR]"`.
- `@sentry/nextjs` + `@vercel/analytics` installed.
- [`instrumentation.ts`](instrumentation.ts) (Next.js 16 pattern) — Sentry init for Node + Edge runtimes. `beforeSend` runs `redactPII()` over `extra`/`contexts`/`tags`/breadcrumbs; collapses `event.user` to `{id}`; strips cookies; allowlists request headers. `tracesSampleRate: 0.1` in prod.
- [`instrumentation-client.ts`](instrumentation-client.ts) — browser SDK with minimal `beforeSend` (lib/logger is server-only so can't ride along; patterns kept in sync).
- [`next.config.ts`](next.config.ts) — wraps with `withSentryConfig()` only when `SENTRY_DSN` is set, so contributors without a Sentry account get clean builds. Source-map upload restricted to prod. `tunnelRoute: "/monitoring"` to bypass ad-blockers.
- [`app/layout.tsx`](app/layout.tsx) — `<Analytics />` from `@vercel/analytics/next` (no-ops outside Vercel; pageview-only).
- Tests: [`tests/logger/logger.test.ts`](tests/logger/logger.test.ts) — 9 cases covering every claim in the redaction contract. Total suite **67/67 across 9 files** (~108s).
- ADR-0009 documents the design, the over-eager-by-design field-name approach, Sentry's conditional wiring, and follow-ups.

### Added — Phase 0.7 (PHI encryption) — 2026-05-22

- [`lib/encryption.ts`](lib/encryption.ts) — AES-256-GCM PHI encryption library:
  - `encrypt(plaintext)` returns `iv:authTag:ciphertext` (3 base64 segments). Fresh random 12-byte IV per call.
  - `decrypt(payload)` validates segment count + IV/tag length, then runs `decipher.final()` which throws if GCM's 16-byte auth tag doesn't validate (= any tamper rejected).
  - `generateKey()` mints a 32-byte base64 key.
  - `ciphertextsEqual()` timing-safe byte compare.
  - Imports `"server-only"` so a client component using it fails Next's build.
  - Reads `MEDSYNC_PHI_KEY` env var per call; explicit, helpful errors when missing or wrong-length.
- 0 callers in 0.7 by design — encrypted columns land in Phase 1+ clinical tables. Shipping the lib + tests now forces us to nail the wire format and key handling before there's data to migrate.
- Trade-offs encoded into the API: random IV per call → same plaintext yields different ciphertext → content is NOT queryable/indexable. Operational columns stay plaintext; only highest-sensitivity stored values get encrypted. Documented in ADR-0008 + the lib header.
- Key rotation: documented procedure in ADR-0008 §6 (decrypt-old + re-encrypt-new pass). Not automated in 0.7 — `keyId` wire-format prefix deferred until rotation is actually needed.
- Tests: [`tests/encryption/encryption.test.ts`](tests/encryption/encryption.test.ts) — 16 tests covering round-trip (ASCII / empty / UTF-8), IV uniqueness, tamper detection per segment (IV, auth tag, ciphertext), wrong-key, malformed payloads, missing key, wrong-length key, `generateKey()`. Vitest alias added (`server-only` → no-op stub) so the library imports in test context.
- Total suite: **58/58 across 8 files** (~70s).
- ADR-0008 documents algorithm/format choice, key handling, rotation procedure, the queryability trade-off, and alternatives considered (pgsodium / CBC+HMAC / XChaCha20 / AES-SIV / envelope).

### Added — Phase 0.6 (audit infrastructure) — 2026-05-22

- [`supabase/migrations/0003_audit.sql`](supabase/migrations/0003_audit.sql) — two trigger functions:
  - `public.audit_log_changes()` — `AFTER INSERT/UPDATE/DELETE` on `users`, `hospitals`, `hospital_departments`, `user_roles`, `consent_records`. `SECURITY DEFINER` so it can INSERT regardless of caller role. Captures `auth.uid()` as `actor_id`, full `to_jsonb(OLD/NEW)` as `before_data`/`after_data`, lowercased `TG_OP` as `action`, optional `app.request_id` GUC as `request_id`.
  - `public.audit_log_block_modify()` — `BEFORE UPDATE OR DELETE` on `audit_log`; always raises with SQLSTATE `insufficient_privilege`. Defence in depth via `REVOKE UPDATE, DELETE` on `audit_log` from `anon`/`authenticated`/`PUBLIC`. Service-role is intentionally NOT REVOKEd (it has `bypassrls`) but the trigger still raises for it — service-role is held to the same append-only standard as everyone else.
- `audit_log` is intentionally NOT audited (would recurse).
- Tests: [`tests/audit/audit.test.ts`](tests/audit/audit.test.ts) — 6 tests covering INSERT/UPDATE/DELETE trigger fires, before/after capture, and that UPDATE/DELETE on `audit_log` raises with the expected message. Total suite now 42/42 (~63s).
- Test cleanup paths updated: `audit_log` rows are now intentionally leaked from test suites because the append-only trigger blocks DELETE. Documented inline; manual purge via `TRUNCATE` available to the table owner.
- ADR-0007 documents the trigger design, the two-layer append-only lockdown, the table coverage, and follow-ups (Phase 0.9 request-id GUC, retention policy).

### Added — Phase 0.5 (RLS + tests) — 2026-05-22

- [`supabase/migrations/0002_rls.sql`](supabase/migrations/0002_rls.sql) — RLS policies for all 6 Phase 0 tables. `ENABLE` + `FORCE ROW LEVEL SECURITY` (defence in depth so even the table owner is subject), explicit `GRANT` of table privileges to `anon` / `authenticated`, deny-by-default with permissive policies per `(command, role)` combination.
- `public.user_has_role(role_name [, hospital_id])` — `SECURITY DEFINER STABLE` helper with hardened search_path. Lives in `public.*` (the pooler user lacks `CREATE` on `auth.*`).
- vitest + `@vitest/coverage-v8` installed; configured in [`vitest.config.ts`](vitest.config.ts) with `fileParallelism: false` for Supabase admin rate limits, env injected into workers via `test.env`.
- **`@next/env` + `NODE_ENV=test` workaround**: vitest sets `NODE_ENV=test`, and `@next/env`'s loader deliberately skips `.env.local` in test mode (silently — `loadedEnvFiles: []`). Config now overrides `NODE_ENV='development'` around the `loadEnvConfig()` call, then restores. Documented inline + ADR.
- Test helpers in [`tests/rls/_helpers.ts`](tests/rls/_helpers.ts): `createTestUser`, `serviceSupabase`, `serviceSql`, `grantRole`, `createTestHospital`, `cleanup`. Test-user emails follow `rls-<suite>-<role>-<rand>@medsync.local` for easy manual cleanup if a run crashes.
- RLS test suite: 36 tests across 6 files, one per table — positive + negative cases per `(role × command × scope)`. **All pass against live Supabase**, ~50s runtime (dominated by `auth.admin.createUser` round-trips on free tier).
- npm scripts: `test`, `test:watch`.
- ADR-0006 documents the policy model, helper function, vitest choice, the env-loading workaround, and the per-table coverage map.

### Added — Phase 0.4 (Phase 0 schema) — 2026-05-22

- Schema proposal: [`docs/schema-phase-0.md`](docs/schema-phase-0.md) — six Phase 0 tables with column types, FKs, indexes, RLS intent, what's encrypted, what's audited. Drizzle implementation matches the proposal verbatim.
- Drizzle schema files in [`db/schema/`](db/schema/):
  - [`_auth.ts`](db/schema/_auth.ts) — phantom `auth.users` for FK type-resolution (Supabase manages the real one).
  - [`users.ts`](db/schema/users.ts) — 1:1 with `auth.users` via shared uuid PK; PHI deferred to Phase 1+.
  - [`hospitals.ts`](db/schema/hospitals.ts) — Uganda MoH facility taxonomy via CHECK constraint on `level`.
  - [`hospital-departments.ts`](db/schema/hospital-departments.ts) — self-referential `parent_id` for IM → 13 sub-specialty trees.
  - [`user-roles.ts`](db/schema/user-roles.ts) — m:n with `role` + `hospital_id`; CHECK enforces superadmin-is-global, every other role hospital-scoped.
  - [`consent-records.ts`](db/schema/consent-records.ts) — versioned, immutable consent log with `consent_text_sha256` for non-repudiation.
  - [`audit-log.ts`](db/schema/audit-log.ts) — append-only system log; populated by trigger only (0.6).
- Generated SQL migration: [`supabase/migrations/0000_nosy_thunderbird.sql`](supabase/migrations/0000_nosy_thunderbird.sql). Header documents that the auto-generated `CREATE SCHEMA "auth"` / `CREATE TABLE "auth"."users"` block must be hand-stripped on every regeneration (Drizzle's `schemaFilter` only filters introspection, not generation).
- Hand-written migration: [`supabase/migrations/0001_updated_at_trigger.sql`](supabase/migrations/0001_updated_at_trigger.sql) — shared `public.set_updated_at()` function attached to every mutable table.
- Custom migrator: [`scripts/migrate.ts`](scripts/migrate.ts) — replaces `drizzle-kit migrate` (which needs prepared-statement support → IPv6-only direct hostname on free tier, unreachable from most networks). Runs each `.sql` file via the transaction pooler with `prepare: false`, wraps each in a transaction, tracks applied state in `public._medsync_migrations`. Drizzle's official migrator preserved as `npm run db:migrate:drizzle` for Pro / IPv6 setups.
- Live state verified: all 6 tables present in `public` (plus the `_medsync_migrations` journal).
- ADR-0005 captures the schema decisions, the auth-phantom workaround, and the pooler-migrator trade-off.

### Added — Phase 0.3 (Supabase + Drizzle + clients) — 2026-05-21

- [`lib/env.ts`](lib/env.ts) — `@t3-oss/env-nextjs` + Zod validation, split into `server` (service role key, DB URLs, `MEDSYNC_PHI_KEY`, Sentry, Africa's Talking) and `client` (`NEXT_PUBLIC_*` Supabase + Sentry) schemas. Fail-fast on missing/invalid required vars; `SKIP_ENV_VALIDATION=1` escape hatch for local scaffolding (never set on Vercel).
- Three Supabase clients, one per auth posture:
  - [`lib/supabase/client.ts`](lib/supabase/client.ts) — browser anon (`createBrowserClient`).
  - [`lib/supabase/server.ts`](lib/supabase/server.ts) — SSR with cookie threading via `next/headers` (`await cookies()` for Next 16 async API). Always use `getUser()`, never `getSession()`.
  - [`lib/supabase/service.ts`](lib/supabase/service.ts) — service role; `"server-only"` import guards prevent it from ever reaching the client bundle.
- [`drizzle.config.ts`](drizzle.config.ts) — Drizzle Kit configured against `DATABASE_DIRECT_URL` (port 5432) with `schemaFilter: ["public"]` so Supabase's `auth`/`storage`/`realtime` schemas are off-limits. Migrations land in [`supabase/migrations/`](supabase/migrations/).
- [`db/index.ts`](db/index.ts) — `postgres-js` client + Drizzle instance. Uses pooled `DATABASE_URL` (port 6543) with `prepare: false` (required for Supabase's transaction-mode pooler). Singleton on `globalThis` in dev to survive HMR without leaking connections.
- [`db/schema/index.ts`](db/schema/index.ts) — barrel export, empty for 0.3 (tables land in 0.4).
- npm scripts: `db:generate`, `db:migrate`, `db:push`, `db:studio`, `db:check`.
- [`app/api/health/route.ts`](app/api/health/route.ts) — dev-only smoke endpoint: runs `SELECT now()` via Drizzle, calls `getUser()` via the server client, calls `auth.admin.listUsers` via the service client. Gated to non-production. The Phase 0.3 acceptance check.
- ADR-0004 documents the data-layer choices.

### Added — Phase 0.2-dark (dark mode) — 2026-05-21

- Dark mode shipped (supersedes the "no dark mode" decision recorded in ADR-0002; full rationale in ADR-0003).
- [`next-themes`](https://github.com/pacocoursey/next-themes) wired via [`app/providers.tsx`](app/providers.tsx) with `attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`, storage key `medsync-theme`.
- [`<html suppressHydrationWarning>`](app/layout.tsx) + `color-scheme` CSS hint for native form controls; `<meta name="theme-color">` per `prefers-color-scheme` for matching mobile browser chrome.
- [`app/globals.css`](app/globals.css) restructured: every semantic token, clinical-status pair, and shadow lives as a plain CSS variable in `:root` (light) and `.dark` (dark) blocks; `@theme inline` references those vars so utilities like `bg-primary`, `text-status-critical-fg`, `shadow-card` resolve to the right colour per theme at runtime. Scale tokens (`gray-*`, `teal-*`) also flip — components that say `bg-gray-50` automatically render the dark spec's `#111111` in dark.
- [`ThemeToggle`](components/theme-toggle.tsx) — Sun/Moon crossfade switch; added to `/` and `/styleguide` headers.
- Primitives refactored to use semantic tokens (`bg-primary`, `text-foreground`, `bg-card`, `border-border`, `text-muted-foreground`) instead of direct gray-N/teal-N references so they flip cleanly. `dark:` variants reserved for the few asymmetric cases (Button `emergency` shifts to a soft-red outline; Button `secondary` upgrades its border in dark).
- `/styleguide` updated: ThemeToggle in header, palette swatches use static inline `style={{backgroundColor: hex}}` so reference display stays accurate in either mode; added separate sections for dark neutral scale + dark teal scale (now 13 sections total).
- DESIGN-medsync.md gained a full "## Dark Mode" section (verbatim from the dark-mode handoff) covering surface mapping, dark neutral/teal/status palettes, dark-specific shadows, button/input/card overrides, and dark anti-patterns.
- ADR-0003 (dark mode adoption); ADR-0002 status updated to "Accepted (no-dark-mode part superseded by ADR-0003)"; ADR README index updated.

### Added — Phase 0.2 (design system) — 2026-05-21

- [`DESIGN-medsync.md`](DESIGN-medsync.md) authored as the authoritative visual contract — monochrome neutral base with teal-600 (`#0D9488`) as clinical accent, six clinical-status pairs, 12-step type scale, restrained shadow/radii scales.
- [`app/globals.css`](app/globals.css) rebuilt as a Tailwind v4 `@theme` block: full neutrals (`gray-50`–`gray-950`), teal scale, clinical status pairs (`bg-status-*-bg`/`text-status-*-fg`), semantic shadcn mappings, type scale utilities (`text-display-xl`…`text-overline`), radii (`xs`–`3xl`), shadows (`xs`,`sm`,`md`,`lg`,`card`,`popover`,`focus`), easing (`ease-expo-out`), durations.
- shadcn primitives added: `card`, `input`, `label`, `badge`, `separator`, `dialog`, `dropdown-menu` (Form deferred to Phase 0.9 sign-up/sign-in flows).
- Button rewritten with MedSync-spec variants: `primary`, `secondary`, `ghost`, `tealSoft`, `emergency`, `alert`, `link` × sizes `sm`/`md`/`lg`/`iconSm`/`icon`/`iconLg`; expo-out 150ms transition; teal focus ring.
- Input rewritten to spec (13px font, `rounded-sm`, teal-tinted focus, alert-bg on `aria-invalid`).
- Card rewritten with three tones: `standard`, `muted`, `tealTinted`; replaced `ring-1` with `border` for consistency with the design language.
- Custom MedSync components:
  - [`ClinicalBadge`](components/medsync/clinical-badge.tsx) — six clinical statuses with strict bg/fg pairings.
  - [`VitalStat`](components/medsync/vital-stat.tsx) — monospace, tabular-nums vital display with normal/critical/success tones.
  - [`SectionNumber`](components/medsync/section-number.tsx) — `[NN]` bracket pattern.
  - [`ClinicalPath`](components/medsync/clinical-path.tsx) — monospace breadcrumb (`/ patient → vitals`).
- [`app/page.tsx`](app/page.tsx) replaced the create-next-app landing with a minimal MedSync splash (wordmark, hero, link to `/styleguide`, founder/CSO attribution).
- [`app/styleguide/page.tsx`](app/styleguide/page.tsx) — 12-section visual contract: neutrals, teal scale, clinical status, typography, buttons (every variant × size), inputs (default/focused/disabled/error), cards (3 tones), vital-stat strip with critical patient example, section numbers, clinical paths, spacing scale, radii reference, shadow reference.
- [`app/layout.tsx`](app/layout.tsx) — MedSync metadata (title template, applicationName, theme color), viewport config, font fallback chain applied at `<body>`.
- ADR-0002 (design system adoption + font-license deferral).

### Changed

- `globals.css` semantic tokens (`--color-primary`, `--color-foreground`, …) now resolve to MedSync palette; all shadcn primitives inherit the theme automatically.
- shadcn `Dialog` close/cancel button references migrated from the removed `outline`/`icon-sm` variants to `secondary`/`iconSm`.

### Notes / deferred

- **Fonts:** Neue Haas Grotesk Display/Text Pro are commercial. The CSS fallback chain (`"Helvetica Neue", Helvetica, Arial, sans-serif`) renders the correct character on macOS/iOS today; `next/font/local` swap-in pending license files.
- **Dark mode:** intentionally not shipped — see ADR-0002.
- **Form primitive:** picked up in Phase 0.9 where sign-up/sign-in flows make it concrete.

### Added — Phase 0.1 (scaffold + tooling) — 2026-05-21

- Next.js 16.2 App Router scaffold (Turbopack, React 19.2, TypeScript strict).
- TypeScript: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`, `useUnknownInCatchVariables`; `target: ES2022`.
- ESLint 9 flat config extending `eslint-config-next` with `@typescript-eslint/no-explicit-any: error`, typed-import enforcement, and unused-var rule.
- Prettier 3 with `@ianvs/prettier-plugin-sort-imports` and `prettier-plugin-tailwindcss`.
- Tailwind CSS v4 via `@tailwindcss/postcss`.
- shadcn/ui initialized (Nova preset, `@base-ui/react` primitives). Theme tokens deferred to Phase 0.2.
- Husky 9 + lint-staged pre-commit (`eslint --fix`, `prettier --write`).
- commitlint with Conventional Commits — types allowed: `feat`, `fix`, `chore`, `docs`, `security`, `style`, `refactor`, `test`, `perf`, `build`, `ci`, `revert`.
- npm scripts: `dev`, `build`, `start`, `lint`, `lint:fix`, `typecheck`, `format`, `format:check`.
- Runtime deps installed (wired but not exercised this sub-phase): `@supabase/ssr`, `@supabase/supabase-js`, `drizzle-orm`, `postgres`, `framer-motion`, `react-hook-form`, `@hookform/resolvers`, `zod 4`.
- Folder structure: `app/`, `components/`, `lib/`, `db/`, `supabase/{migrations,functions/_shared}/`, `docs/adr/`, `prompts/`, `tests/rls/`.
- ADR-0001 (stack choice).
