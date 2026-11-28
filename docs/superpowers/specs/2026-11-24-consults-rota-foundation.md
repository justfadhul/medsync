# Consults, review requests and the duty rota: a foundation proposal

Research only, 24 Nov 2026. Nothing here is built. The proposal is for the owner to authorise, change or refuse. Repo
read: worktree `admin-clinics-harmonize-efe20d` (branch `claude/clinic-line-doctor`, newest migration 0305, newest
ADR 0532). Web sources are listed in §9; the full findings with confidence tags are in
`scratchpad/research/web-findings.md` beside this file.

---

## Plain-language summary (for the owner)

1. Today MedSync cannot say who is on duty for a ward or a department. Only the pharmacy has a rota. Resus calls,
   critical lab results and co-signs all work around that gap by sending to "everyone in the department".
2. Senior review in the Plan only writes words into the note. Nobody is actually told.
3. Proposal: three things, built in this order. First, a **duty rota**: named posts ("Ward 4 consultant this week",
   "Nephrology SHO on call") with people put into them for set hours. Second, one **request** record for both review
   requests and consults. Third, **escalation** when nobody answers.
4. A request is addressed to a **post or a team**, not only to a person. MedSync works out who holds the post at that
   moment and records it. With no rota yet, the request goes to the department's shared list, and anyone there can take it.
5. A request opening on someone's screen counts as **seen**, not as acknowledged. **Accept** means "I'm coming".
   Only a **signed reply note** closes it. A **decline** needs a reason and hands the patient back to the requesting
   team, who stay responsible throughout.
6. Requests wait in the Plan's basket and go out with **Place**, in the same all-or-nothing step as tests and medicines.
7. The receiving consultant gets **temporary access to the patient's chart** while the request is open and for
   30 days after the reply. Every chart open is logged. Nobody sees other patients' names, as now (ADR 0199).
8. No new workspace per department. The existing doctor and clinician workspaces gain two lists, "Asked of you" and
   "Consults for your department", plus a chip showing your duty today. Admins get a rota page under Departments.
9. The rota is what was **planned**, not proof that someone turned up, and the screens will say so.
10. You need to decide 12 things (§7) before the build starts. The CSO also needs to sign the wording and the
    response times. Six ADRs and four gated migrations follow, across five build phases.

---

## 1. What already exists (build on it, don't duplicate it)

### 1.1 People, departments, wards

| What                              | Where                                                                                                                                                                                                                         | What it gives us                                                                                                                                   | Gap for this work                                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Departments, with sub-departments | `db/schema/hospital-departments.ts:11-43` (`parent_id`, `kind` clinical/diagnostic/support/administrative, `medsync_live_at`)                                                                                                 | Internal Medicine with Nephrology, Cardiology and so on as children. Fits Mulago, whose medicine is organised in sub-specialty units (web §4, #51) | No duty, no on-call                                                                                    |
| Heads of department               | `db/schema/services-hub.ts:50` `department_heads` (effective-dated, one substantive plus one acting, written by `ha-services-hub` `ops-structure.ts:466-484`)                                                                 | Natural last rung of a department's escalation ladder and a natural rota maker                                                                     | —                                                                                                      |
| Staff affiliations                | `db/schema/clinician-profiles.ts:62-118` (user, hospital, department, cadre, grade, role, state)                                                                                                                              | Who may hold which post (cadre check)                                                                                                              | One person can have several departments. `requireDoctorScope` picks one (`lib/doctor/scope.ts:90-125`) |
| Cadres                            | `lib/doctor/scope.ts:34-51` (junior: INTERN_DOCTOR, CLINICAL_OFFICER; senior: MO, MO_SG, CONSULTANT, SENIOR_CONSULTANT). PHYSIOTHERAPIST and NUTRITIONIST seeded (`supabase/migrations/0009_reference_data_seed.sql:162-164`) | Post eligibility                                                                                                                                   | **No social-worker cadre**. Dietitian maps to NUTRITIONIST                                             |
| Wards                             | `db/schema/hospital-wards.ts:23-55` (`department_id` optional)                                                                                                                                                                | The place a cover post is attached to                                                                                                              | No doctor is linked to a ward. Only nurses are (below)                                                 |
| Ward in-charge                    | `db/schema/nurse-workspace.ts:83-113` `ward_in_charge_assignments` (open-ended, `acting`, one open each per ward)                                                                                                             | "The nurse in charge is told" has a target today                                                                                                   | Not a timed rota (no shifts)                                                                           |
| Nursing assignments               | `nurse-workspace.ts:41-81` (patient to nurse, primary or cover, `starts_at`/`ends_at`)                                                                                                                                        | Precedent for timed cover                                                                                                                          | Per patient, not per ward post                                                                         |
| Shift handover                    | `nurse-workspace.ts:379-405` `shift_handovers` (day/evening/night)                                                                                                                                                            | Shift labels already used                                                                                                                          | Nursing only                                                                                           |
| Supervision                       | `db/schema/doctor-workspace.ts:23-56` `clinical_supervision` (intern to consultant, primary or backup, dated)                                                                                                                 | Default target for a junior's senior review when no rota exists                                                                                    | Not used for routing today (the co-sign queue is hospital-wide, `lib/doctor/cosign.ts:33-67`)          |
| Hospital-admin roster             | `db/schema/hospital-admin-roster.ts`                                                                                                                                                                                          | Name clash only: this is admin succession, not a duty rota                                                                                         | —                                                                                                      |

### 1.2 Anything shaped like a rota, timetable or leave

| What                                                     | Where                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Lesson                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pharmacy duty roster**, the only real rota             | `supabase/migrations/0265_pharmacy_rework_foundations.sql:72-90` (`pharmacy_duty_roster`: user, place, role, shift day/night/call, dates, ended not edited) and `0273_pharmacy_roster.sql` (people, licences, delegation, week publish/unlock events, leave that frees shifts, swap and cover requests that a colleague accepts and the roster maker then approves, attendance, reminders, public holidays). Guard trigger at `0273:381-441`. Server actions `lib/pharmacy/actions/roster.ts`. PGlite tests `tests/emr-db/pharmacy-roster*.test.ts` | **Copy the pattern, not the table.** Its guard only accepts pharmacy places (`0273:397-400`), but its role list already includes `doctor_on_duty` and `nurse_in_charge` (`0265:78-79`), a sign that a hospital-wide rota was always going to be needed. Per the memory notes, 0273 may still be unapplied; check |
| Doctors' leave                                           | `db/schema/scheduling.ts:46-105` `availability_blocks` (kinds include `leave`, `ward_round`, `teaching`). ADR 0506 added `requested` and `declined` states, plus cover and approval (`0296_clinics_schedule.sql:117-120`)                                                                                                                                                                                                                                                                                                                           | **Doctors' leave already has a home.** The rota should read it, not add a third leave table (pharmacy has its own, `pharmacy_staff_leave`)                                                                                                                                                                       |
| Outpatient timetable                                     | `db/schema/clinic-sessions.ts:38-118` `session_templates` (weekday rules with `clinician_user_ids`). Draft, publish and versions in `db/schema/clinics-schedule.ts` (ADRs 0501-0508). Clash engine (ADR 0504)                                                                                                                                                                                                                                                                                                                                       | Shows when a consultant is in clinic (busy, still on call). The draft-then-publish and clash-check ideas carry over                                                                                                                                                                                              |
| "No on-shift model exists yet"                           | `lib/resus/mobilise.ts:21-23,33-60`: resus calls go to every active clinical member of the department plus every ward in-charge                                                                                                                                                                                                                                                                                                                                                                                                                     | First consumer to switch to the rota later                                                                                                                                                                                                                                                                       |
| Lab critical-results ladder "in the absence of a roster" | ADR 0243 (`docs/adr/0243-the-recipient-ladder.md`): level 0 orderer, level 1 the department's `critical_contacts`, level 2 hospital contacts (`db/schema/lab-safety.ts:68-77`)                                                                                                                                                                                                                                                                                                                                                                      | Second consumer. Level 1 could become "the department's on-call post"                                                                                                                                                                                                                                            |

### 1.3 Requests, orders, notes, the Plan

| What                                 | Where                                                                                                                                                        | Relevance                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan draft                           | `lib/clerking/plan/draft.ts:20-21,65` (`SENIOR_REVIEW = now / within_1h / routine`), `:81-86` (basket: orders and prescriptions only)                        | Requests become a third basket line                                                                                                                                   |
| Senior review today                  | `lib/clerking/plan/compose.ts:111` (words in the note), `lib/clerking/plan/checklist.ts:94-99` (checklist item ticked by choosing a time)                    | **Nobody is notified.** This is the gap the owner's prototype fills                                                                                                   |
| Place                                | `lib/emr/write/plan.ts:662-834` `placePlan` (one transaction: orders, prescriptions, charts; refuses an empty basket at `:668`)                              | Requests are inserted here, in the same transaction                                                                                                                   |
| Orders engine                        | `lib/emr/orders.ts:13-21`: status **derived from events, never stored**; invariant "nothing ordered disappears"                                              | The request engine should work the same way                                                                                                                           |
| `encounter_orders.kind = 'referral'` | `db/schema/encounter.ts:255,272,284` (kind and performer `referral` allowed; unused in `lib/`)                                                               | **Don't use it for inpatient consults** (§3.3). Keep it for referral out to another facility (Plan's "Refer", HMIS 032, `docs/emr/emr-clinical-reference.md:116-119`) |
| Note types                           | `db/schema/emr.ts:422` (`referral` exists, `consult` does not)                                                                                               | The consult reply needs a `consult` note type                                                                                                                         |
| Co-sign requests                     | `doctor-workspace.ts:100-150`, raised at admission in `lib/emr/write/encounter.ts:241-313` (`afterClose`, ADR 0201)                                          | Precedent for a request object with states, and for "warn, don't block"                                                                                               |
| Admission                            | `db/schema/admissions.ts:44-92` (one open per patient, ward, leading condition); ADRs 0198-0201; `supabase/functions/ha-complete-encounter/index.ts:227-263` | The ward a review is routed to. Admission sends nothing to the nurse in charge today (only the board's live topic)                                                    |
| Bed board privacy                    | ADR 0199 §7; `lib/wards/board.ts:100,204-207` (`patients: "none"` for doctors)                                                                               | Same rule for the cover panel: staff names only, never other patients                                                                                                 |

### 1.4 Notifications, inboxes, workspaces

| What                        | Where                                                                                                                                                                                     | Relevance                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| In-app staff notifications  | `db/schema/sa-notifications.ts:18-41` (own-row RLS; kinds widened in `0037` and `0068`, used by `lib/triage/notify.ts`, `lib/resus/mobilise.ts`)                                          | Request alerts reuse it, with new kinds                          |
| Per-user live topic         | `supabase/migrations/0106_lab_realtime_scheduler.sql:15-44` (`private.notify_user`, topic `user:<id>`, PHI-free payload)                                                                  | Live badge on a new request                                      |
| Escalation runner           | `0106:46-78` (pg_cron every minute, then `/api/cron/...`), ADR 0244 (pure planner, one idempotent executor, three callers, heartbeat in `escalation_heartbeats`, `lab-safety.ts:139-143`) | **Reuse as it is** for unanswered requests                       |
| Outbound queue              | `db/schema/notifications.ts:66-142` `notification_dispatches` (patient-facing; `related_kind` limited)                                                                                    | SMS to staff later. Not phase 1                                  |
| Doctor workspace lanes      | `lib/workspace/lanes.ts:1-10` ("A future engine … plugs in here without touching the page"), lane ids `:12-23`, `to_cosign` at `:121`                                                     | New lanes: "Asked of you", "Consults for your department"        |
| Scopes                      | `requireDoctorScope` (`lib/doctor/scope.ts:90`), `requireNurseScope` with in-charge wards (`lib/nurse/scope.ts:118-155`), `requireClinicianScope` (`lib/clinician/scope.ts`)              | Department-shaped behaviour comes from scope plus today's duties |
| Admin Departments           | `app/hospital-admin/departments/*` (wards, hours, availability, …)                                                                                                                        | Home for the rota editor                                         |
| Vercel crons are daily only | `vercel.json`                                                                                                                                                                             | Minute-level escalation must use pg_cron, as the lab does        |

### 1.5 Access and privacy

- One access rule in SQL, `private.patient_access_basis` (ADR 0131). Its latest body is in
  `supabase/migrations/0101_lab_work_access_basis.sql:23-94`. **`care_team` is a reserved seam that never matches**
  (`0101:85`, ADR 0131 §2). A consultant in another department has no basis today, so they could not open the
  patient to answer a consult. This is the one access change the foundation needs.
- `department_recent` gives a department's clinical staff 30 days of access to patients with an encounter or
  appointment in that department (`0101:68-76`, `lib/encounter/scope.ts:43`). A review within the patient's own
  department is already covered by it.
- `care_team_members` in `0301_patient_care_mode.sql:64-77` is the patient app's **outpatient programme** team (with
  a "first contact"). It is a different thing; don't stretch it to inpatients.
- EMR writes go through `asClinicalWriter` after `resolveEmrAccess` (`lib/emr/db.ts:9-22`, `lib/emr/access.ts`),
  not through Edge Functions. Reads go through `asClinicalReader` with FORCED RLS.
- FHIR: `toFhirServiceRequest` (`lib/emr/fhir.ts:461-486`) and a Task-plus-ServiceRequest bundle for lab referrals
  (`fhir.ts:749-812`) already exist to project from.

---

## 2. What the outside world does (short)

Full list with links and confidence in `web-findings.md`. The points that shape the design:

- **Keep the request and its fulfilment apart.** In FHIR, a ServiceRequest says what was asked (a consult is one;
  priority routine/urgent/asap/stat; `reasonReference` to a Condition; `performerType` when no one is named). A Task
  tracks doing it (requested, received, accepted, rejected, in-progress, completed, cancelled; `owner` = who is
  responsible now). The HL7 BSeR and IHE 360X closed-loop referral profiles use the same split: request, then accept
  or decline, then outcome note. [hl7.org/fhir/R4/servicerequest.html, /request.html, /task.html; IHE 360X]
- **Epic and Cerner:** a consult order goes to the receiving service's list or on-call pager, and the consult note
  linked to the order completes it. Where it does not, open orders linger. I found no public "acknowledge" status in
  Epic. [Salem Health, Alberta Connect Care, Niagara Health tip sheets]
- **Route to the role, not the person.** UCLA turned the Epic consult order into a page to whoever was on call. Median
  time to the consultant opening the chart fell from 4.0 h to 0.6 h. 14% of pages in two teaching hospitals reached
  the wrong (often off-duty) doctor, and team pagers reduced that. [PMC9259201; Wong 2009; Shieh 2014]
- **Don't rely on a manual "acknowledge" click for timing.** In Southland NZ a third of staff never pressed it, and
  31-45% of delay data was lost. [PMC9204417]
- **A decline needs a reason and must not bounce the patient back.** The referring team stays responsible until the
  receiving team takes over. RCEM 2025 also requires a digital on-call rota and a recorded referral time, and the
  referrer must say advice or admission and how urgent. (RCEM covers ED referrals, not ward to ward.)
- **No national clock for ward-to-specialty consults** in the UK or Uganda that I could find. 24 h targets are
  local. NHS seven-day standards require consultant review within 14 h of admission, then daily. So response
  times belong to each hospital and the CSO signs them.
- **FHIR has no duty-rota or on-call resource.** Schedule and Slot cover bookings; PractitionerRole covers opening
  hours. Vendors keep the rota separately (Amion, QGenda) and feed "who's on call" into the EHR. MedSync needs its own
  rota tables.
- **One named first contact per inpatient** raised correctly routed critical results from 18% to 88% (UChicago).
- **Uganda:** Mulago medicine runs sub-specialty units (consultants, physicians, SHOs, who are MMed residents, then
  interns and students), admitting from A&E. Medical inpatients moved to Kiruddu in 2014. Not verified: unit "take
  days", the MoH referral guideline text and Kiruddu's current status; confirm on site. Rota compliance is uneven in
  Uganda, so the rota records **planned** cover.

---

## 3. The proposed foundation

### 3.1 The duty rota: posts, and people in posts

**Idea:** cover is a **post** (a "bleep"): "Ward 4B consultant in charge", "Nephrology SHO on call", "Ward 4B nurse in
charge, night". People are put into a post for a time window. Requests and escalations address the post. This is
the team-pager lesson.

**`duty_posts`** (set up once per hospital by the admin or head of department)

| Column                      | Notes                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `id, hospital_id`           |                                                                                                                       |
| `name`                      | The hospital's own words ("SHO on call", "Registrar"). MedSync shows them as they are                                 |
| `scope_kind`                | `ward`, `department`                                                                                                  |
| `ward_id` / `department_id` | One of them, matching `scope_kind`. A ward post also names its department                                             |
| `level`                     | `junior`, `senior`, `consultant`, `nurse_in_charge`, `allied` (neutral codes for rules; the name carries the words)   |
| `eligible_cadres text[]`    | Checked against the person's active affiliation (for example a consultant post takes CONSULTANT or SENIOR_CONSULTANT) |
| `takes_consults boolean`    | This post receives the department's consults                                                                          |
| `escalates_to_post_id`      | Next rung (junior, then senior, then consultant). Null means the department head, then hospital contacts              |
| `capacity smallint`         | Usually 1. More than 1 for "the SHOs on Ward 4B"                                                                      |
| `archived_at`               | Archived, never deleted                                                                                               |

**`duty_assignments`** (the rota itself)

| Column                              | Notes                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `id, hospital_id, post_id, user_id` |                                                                           |
| `starts_at, ends_at timestamptz`    | Real windows, so a night shift crosses midnight cleanly (Kampala, no DST) |
| `kind`                              | `rostered`, `cover` (fills a gap or a person on leave), `swap`            |
| `covers_assignment_id`              | For cover and swap                                                        |
| `created_by, created_at`            |                                                                           |
| `ended_at, ended_by, end_reason`    | **Ended, never edited or deleted** (the pharmacy roster rule)             |

Guard trigger, copied from `pharmacy_duty_guard`:

- the person has an active affiliation at the hospital with an eligible cadre;
- no overlap beyond `capacity`;
- the person is not on approved leave (`availability_blocks` kind `leave`, state `active`);
- the actor is the hospital admin, the post's head of department or a delegate;
- the week is not published, unless a change goes through a cover or swap.

**Week templates and publishing** (phase 4): "Mon-Fri 08:00-17:00, nights 17:00-08:00, weekend call", filled forward
like `session_templates`, plus `duty_rota_week_events` (publish and unlock, append-only), as in pharmacy.

**Leave:** doctors keep one leave source, `availability_blocks` (ADR 0506). When leave is approved, any duty in that
range is **not silently removed**. It is marked "needs cover" on the rota and in the gap report, because a vanished
on-call duty is a hidden gap. Nurses' leave stays out of scope until nursing rotas are wanted.

**Resolver** (one pure TS function plus one SQL twin, both tested for the same answers):
`whoCovers({ wardId | departmentId, level?, at })` returns the people in post at `at`. When nobody is, it walks this
fallback order and says which step it used:

1. the ward post;
2. the department's `takes_consults` post;
3. the department head (substantive, then acting);
4. the hospital contacts.

The Plan dialog's "who covers Ward 4B" panel reads this: "Dr A, SHO on duty until 17:00 · Dr B, consultant in
charge this week". The "staff available today" list adds each person's status, using only these words: on duty, on
call, in clinic until 13:00 (from `session_templates`), on leave, off. Leave reasons are never shown.

**Planned, not proven:** screens say "rostered" or "on the rota", never "present". An optional sign-on (pharmacy's
`pharmacy_shift_attendance` precedent) can come later.

Not proposed: hour limits, pay, or UK contract rules. Those are HR rostering, and nothing here needs them.

### 3.2 One request for both review requests and consults

A review ("senior, come and see this patient") and a consult ("nephrology, please advise") have the same lifecycle:
ask a post or person, with urgency and a question; they see it, accept, reply; it closes. **One table with a `kind`**,
not two systems.

**`care_requests`** (the ask; written once at Place, never updated: FHIR ServiceRequest)

| Column                                             | Notes                                                                                                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id, hospital_id, patient_user_id`                 |                                                                                                                                                          |
| `encounter_id`                                     | The encounter it was asked from                                                                                                                          |
| `admission_id`                                     | When the patient is or is being admitted                                                                                                                 |
| `kind`                                             | `review` or `consult`                                                                                                                                    |
| `target_kind`                                      | `post`, `department`, `person`                                                                                                                           |
| `target_post_id`, `target_department_id`           | The department covers named services too (dietetics, physiotherapy, clinical pharmacy) as `support`-kind departments, so there is no new "service" table |
| `named_user_ids uuid[]`                            | The people the doctor ticked. Empty means "whoever is on call"                                                                                           |
| `urgency`                                          | Review: `now`, `within_1h`, `routine` (today's `SENIOR_REVIEW` words). Consult: `urgent_today`, `routine`. The CSO signs the words                       |
| `help_wanted`                                      | Consult only: `advice` or `see_patient` (the RCEM "advice or admission" idea; see decision D5)                                                           |
| `reason_condition_ids uuid[]`                      | The problem, as condition version ids (as orders take them; superseded problems are refused)                                                             |
| `question_ciphertext`                              | The question, encrypted like `reason_text_ciphertext`                                                                                                    |
| `phoned`                                           | Optional `{ user_id, at }`: "already discussed by phone with Dr X at 14:10" (phone first for urgent, recorded after)                                     |
| `requester_user_id, requester_cadre, requested_at` |                                                                                                                                                          |
| `placement_id, client_key`                         | Same basket placement as orders; idempotent retry                                                                                                        |
| `due_at`                                           | Computed at Place from the hospital's signed response times; null when none are signed                                                                   |
| `sensitivity`                                      | As on orders                                                                                                                                             |

**`care_request_events`** (append-only: the Task side). Kinds:

| Kind         | Who records it                            | What it means                                                                                                                      |
| ------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `routed`     | Automatic                                 | One row per recipient, with level 0, 1 or 2, why (named, on call, team, fallback step) and the post. The snapshot of who was asked |
| `seen`       | Automatic                                 | Once per person, when they open it. **Never shown as acknowledged** (ADR 0242's rule)                                              |
| `accepted`   | One tap                                   | "I'll see the patient", optional time to expect them. This is the acknowledgement and is required for review `now` / `within_1h`   |
| `declined`   | Recipient                                 | Reason code required. Returns to the requester; **the primary team stays responsible**                                             |
| `redirected` | Recipient                                 | To another post or person, with a reason. Routing runs again                                                                       |
| `replied`    | Automatic                                 | Written when a linked note is signed: `consult` note for a consult; `ward_round`/`progress` for a review                           |
| `closed`     | Requester, or reply marked "no follow-up" |                                                                                                                                    |
| `cancelled`  | Requester                                 | Reason required                                                                                                                    |
| `escalated`  | The runner                                | New level, new recipients (written with `routed` rows)                                                                             |

The **status is derived** by a pure engine (`lib/requests/engine.ts`, the orders-engine style). The order is:
cancelled → closed → replied → declined (back with the requester) → accepted → seen → sent, with "overdue" when past
`due_at`. Invariant, property-tested: **nothing asked disappears**. Every request ends replied, closed or cancelled
with a reason, or stays visibly open.

**Reply:** add `consult` to `clinical_notes.note_type` and a `care_request_id` on the note (or an event that names the
note). Signing writes `replied` in the same transaction. That gives a structural link, as in Epic and Cerner.

**Turnaround** comes from timestamps of actions (sent, first seen, accepted, replied), never from a separate click.

### 3.3 Why not reuse `encounter_orders` kind `referral`

It looks tempting (the kind exists and the FHIR projection exists). But:

- the orders engine derives specimen and report states;
- lab worklists and the `lab_work` access arm read that table;
- a consult needs a routing target, recipients, decline, redirect and a reply note, which orders don't have.

A separate table that follows the same conventions (events lifecycle, derived status, `client_key`, condition ids,
FORCED RLS) is less code and less risk. `kind = 'referral'` stays for referral out of the hospital.

### 3.4 Routing: who gets it

Routing runs at Place, and again on redirect and escalation. Its result is **stored** as `routed` events, so the record
shows who was asked even if the rota later changes.

1. **Named people** ticked by the requester: always recipients.
2. **Otherwise the target post** (or, for a department, its `takes_consults` post), resolved by `whoCovers` at that time.
3. **No rota or nobody in post:** the **team list**, meaning every active clinical member of the target department.
   Anyone there can accept, and acceptance makes them the owner (FHIR "open task anyone on the team can claim").
   This means the requests feature works on day one, before any hospital has a rota.
4. **Review requests** default to the cover of the patient's ward when the Plan admits, or the requester's department
   post otherwise. A junior with no rota falls back to their primary supervisor (`clinical_supervision`), then the
   department head.
5. Deactivated or departed staff are skipped and the skip is recorded. A level that resolves to nobody is recorded as
   such and passed up at once (ADR 0243 §3).

A small per-hospital **`request_routes`** table (target department, then its receiving post, plus whether named-only
requests are allowed) is needed only if a department wants consults to land somewhere other than its
`takes_consults` post. **Recommend skipping it in v1**: the post flag is enough.

### 3.5 Escalation when unanswered

Reuse ADR 0244 as it stands:

- a pure planner over signed times;
- one idempotent runner, called every minute by pg_cron (the owner schedules it once, as in 0106), lazily on every
  inbox read, and by tests;
- a heartbeat row (`escalation_heartbeats.source = 'care_requests'`) with an "escalations may be delayed" banner after
  3 minutes.

- **Clock:** from the moment a level is reached, until `accepted` for review `now`/`within_1h` and consult
  `urgent_today`, and until `replied` for routine.
- **Ladder:** level 0 is the routed recipients. Level 1 is the post's `escalates_to_post_id`, or the department head.
  Level 2 is the hospital contacts. The request stays open and overdue at the top.
- **The requester is told** at each escalation ("Not accepted after 60 min; asked Dr C, consultant on call").
- **No signed times, no automatic escalation** (ADR 0244 §1). Elapsed time is shown in words instead.
- **Response-time table** `care_request_response_versions`, signed per hospital (the `critical_response_versions`
  shape, `lab-safety.ts:58-66`).

### 3.6 Notifications

- **In-app:** `sa_notifications` rows with new kinds `care_request`, `care_request_update` and `ward_incoming`. The
  subject names the ward and the kind, never the patient. A live badge goes out through `private.notify_user`
  (`user:<id>`).
- **Nurse in charge:** at admission (in `afterClose`, `lib/emr/write/encounter.ts:241`, which already runs in the
  clinician's transaction after the close), one `ward_incoming` notification goes to the ward's current in-charge and
  acting in-charge (`ward_in_charge_assignments`). It is a courtesy that never throws; the board's waiting list and
  "Arriving" bed stay the durable signal. This also closes the gap ADR 0243 §5 left open.
- **Never roll back the record for a failed notification** (the resus rule, `lib/resus/mobilise.ts:26-27`).
  Notifications are written after the request commits.
- **SMS to staff:** later, PHI-free ("You have a new request in MedSync"), through a staff queue like pharmacy's. Not v1.

### 3.7 How requests ride the Plan basket and Place

- `PlanSchema.basket` (`lib/clerking/plan/draft.ts:81-86`) gains `requests: PlanRequestLine[]` (`clientKey`, kind,
  target, named ids, urgency, help wanted, condition ids, question, phoned). The draft lives in the encrypted note
  content, so the question is protected before Place too.
- `placePlan` (`lib/emr/write/plan.ts:662`) inserts `care_requests` and their `routed` events **in the same
  transaction** as orders and prescriptions. If any line fails, nothing is sent (ADR 0184 §3). The "basket is empty"
  check at `:668` counts requests. The button reads "Place n orders, m prescriptions and k requests".
- The Plan checklist's "Senior review" item (`checklist.ts:94-99`) is met by a placed review request or by "Not
  needed", which needs a reason (for example "Seen by Dr X on the ward round"). `compose.ts:111` writes the request
  line ("Senior review requested from SHO on call, within 1 h") instead of the bare words.
- Ward-cover reviews take the ward from the Plan's disposition (`wardId`). A review to the ward cover can only be
  added once "Admit" and a ward are chosen.
- "Plan done" already reopens on any draft change (ADR 0184 §5), so adding or removing a request reopens it.

### 3.8 Who can see what (RLS and privacy)

- **Rota tables** (`duty_posts`, `duty_assignments`, later week events and requests): readable by the hospital's
  active staff and admins. That covers names, posts and times only, as with `department_heads`. Leave reasons are
  never exposed. No client writes; the guard trigger decides who may change what.
- **`care_requests` and `care_request_events`:** FORCED RLS, no client writes. SELECT is allowed for:
  - the requester;
  - any routed recipient, current or past;
  - members of the target department while the request is open (the department list; see decision D6);
  - anyone with an access basis for the patient (the primary team sees requests about their patient);
  - the department head.

  Never reception, patients or superadmins (0289 keeps superadmins off PHI).

- **Chart access for the consultant:** implement the reserved `care_team` arm of `private.patient_access_basis` and
  its set form, `private.accessible_patient_ids()`, **in both bodies**, so the equivalence probe still holds. The arm
  matches when the user is a routed recipient or accepter of a request for the patient at that hospital that is open,
  or replied within 30 days (`DEPARTMENT_WINDOW_DAYS`). Every chart open is logged with basis `care_team` in
  `clinical_phi_access_log`.
- **ADR 0199 holds:** the cover panel and the "staff available today" list show staff, never patients. Inbox rows show
  the patient's name and MRN only to people the request is visible to (above). Notification subjects carry no patient.
- **The question is encrypted**, as other free text is.

### 3.9 Where the writes go, and audit

| Write                                                             | Path                                                                                                                                       | Why                                                                                                                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requests (place, accept, decline, redirect, reply, close, cancel) | EMR writer: `lib/emr/write/requests.ts` under `asClinicalWriter` after `resolveEmrAccess`; server actions in `lib/emr/actions/requests.ts` | Clinical record, same path as orders and notes (ADR 0131). `audit_log_changes()` stamps the real author                                                    |
| Rota (posts, assignments, ends, later swaps and publish)          | Server actions on the server connection with the SQL guard trigger (pharmacy 0273 pattern)                                                 | Testable on the PGlite lane, unlike Edge Functions. Audited by row-audit triggers and listed in the admin activity feed (`lib/hospital-admin/activity.ts`) |
| Escalation runner                                                 | `/api/cron/care-request-escalations` (bearer secret), called by pg_cron                                                                    | As the lab does                                                                                                                                            |
| Nurse in-charge notice                                            | `afterClose` (clinician transaction)                                                                                                       | The admission is final there                                                                                                                               |

A note on AGENTS.md's "privileged writes via Edge Functions": the EMR (ADR 0131) and pharmacy (0273) already write on
the server connection under SQL guards. This proposal follows those two, the closest precedents.

### 3.10 FHIR (projection only, later)

- **The request:** ServiceRequest with category consult or review, intent order, priority mapped from urgency,
  `performerType` the post or department, `performer` any named people, `reasonReference` the Condition, plus
  requester and encounter.
- **Its fulfilment:** a Task with `focus` set to the ServiceRequest, `owner` the accepter (or else the post), and status
  derived from the event kinds:

  | Event     | Task status |
  | --------- | ----------- |
  | sent      | requested   |
  | seen      | received    |
  | accepted  | accepted    |
  | declined  | rejected    |
  | replied   | completed   |
  | cancelled | cancelled   |

- **The reply note:** a DocumentReference with `basedOn` set to the ServiceRequest.

The rota is not exported; FHIR has no resource for it.

### 3.11 Department-shaped workspaces

**Recommend: no new workspace per department.** The existing workspaces change by who you are and what duty you hold
today:

- **Doctor workspace:** two new lanes in `lib/workspace/lanes.ts`:
  - "Asked of you" (scope `mine`): reviews and consults routed to you or accepted by you, overdue first, then by
    urgency. Each row reads: patient and ward, from whom, the question's first line, its age, the state word and one
    action (Accept, Reply, Redirect).
  - "Consults for your department" (scope `department`): the team list, unclaimed first.

  A duty chip in the header reads, for example, "On call: Nephrology SHO until 08:00". A department page,
  `/doctor/consults`, holds the full list with filters (open, overdue, replied this week) for consultants.

- **Clinician workspace** (dietitians, physiotherapists, clinical pharmacists): one "Requests" page, the same component.
- **Nurse workspace:** the in-charge sees "Coming to your ward", built from the existing admissions `awaiting_bed` and
  Arriving beds plus `ward_incoming`. There is no new nurse request type in v1.
- **Hospital admin:**
  - Departments, then **Rota**: a week grid per department, with its wards' posts.
  - The ward panel's "Who covers this ward".
  - A **gap report**: posts with nobody in the next 72 h, and duties marked "needs cover".
  - A turnaround report for requests (sent to accepted, and sent to replied, by department).
- Status words use square Tags (workflow states are never red, amber or green, per `DESIGN-medsync.md`). Overdue reads
  as words plus the Tag. Pop-ups are `EditorDialog`.

---

## 4. Lifecycles at a glance

**Duty assignment:** `planned → (in post now) → past`, or `ended early` (with reason), or `needs cover`
(leave approved over it). Never edited.

**Care request** (derived):

```
basket (draft only) --Place--> sent --open--> seen --Accept--> accepted --signed note--> replied --> closed
                                 |               |                 \--(no-follow-up reply)--> closed
                                 |               +--Decline(reason)--> back with requester --> redirect | cancel
                                 +--Redirect(reason)--> sent (new routing)
                                 +--(due passed)--> overdue + escalated level n  (stays open)
                                 +--Cancel(reason, requester)--> cancelled
```

---

## 5. Phased build (smallest useful slice first)

Each phase runs gated: discovery, GATE A, signatures, build, STOP report, as the owner's other builds do.

| Phase                         | What                                                                                                                                                                                                                                                                                                                                            | Useful on its own because                                                                                | Migration (number provisional)                                                                                                       | Flag                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **0**                         | GATE A document; owner answers §7; CSO signs the request wording and the urgency, decline and redirect reason codes                                                                                                                                                                                                                             | Nothing gets built on a guess                                                                            | none                                                                                                                                 | —                                                                                |
| **1. Requests on team lists** | `care_requests`, events, the engine, `consult` note type, `care_team` access arm, Plan basket line and Place, the "Asked of you" and "Consults for your department" lanes, reply by signed note, in-app notices, nurse in-charge notice at admission. Routing = named people, else the department team list, else supervisor or department head | Requests reach real people from the first day, with no rota needed. Senior review stops being only words | `0306_care_requests.sql` **GATED** (clinical tables, FORCED RLS, access-rule change, `clinical_notes` and `sa_notifications` CHECKs) | `CARE_REQUESTS` (1 or hospital ids; the Plan part also needs `CLERKING_PLAN_V2`) |
| **2. Duty rota core**         | `duty_posts`, `duty_assignments`, the guard, `whoCovers` (TS and SQL), the admin week grid, "Who covers this ward", the gap report, the duty chip. Routing switches to post first, with the team list as fallback                                                                                                                               | The Plan dialog's cover panel becomes real. Resus and lab ladders can switch later                       | `0307_duty_rota.sql` **GATED** (RLS)                                                                                                 | `DUTY_ROTA` (hospital ids)                                                       |
| **3. Escalation**             | Response-time versions (CSO-signed), planner, runner, pg_cron, heartbeat, requester told, turnaround report                                                                                                                                                                                                                                     | Unanswered requests climb the ladder                                                                     | `0308_care_request_escalation.sql` **GATED** (signed values, scheduler function)                                                     | none: no signed times means no escalation                                        |
| **4. Rota upkeep**            | Week templates, publish and unlock, cover and swap requests (colleague accepts, rota maker approves), leave marks "needs cover", delegation to a head-of-department delegate                                                                                                                                                                    | Rotas stay current without the admin doing everything                                                    | `0309_duty_rota_upkeep.sql` GATED                                                                                                    | under `DUTY_ROTA`                                                                |
| **5. Later**                  | FHIR projection; staff SMS; switch resus mobilisation and the lab level-1 ladder to the rota; optional sign-on; per-patient first-contact clinician (decision D12)                                                                                                                                                                              | —                                                                                                        | as needed                                                                                                                            | —                                                                                |

Phase 1 before phase 2 is deliberate. Requests on team lists are useful at once and need no admin set-up. The rota
then sharpens routing without changing the request model. If the owner wants the cover panel first, swap 1 and 2;
nothing in the design depends on the order.

**ADRs to write** (numbers from 0533, check at build time):

1. Requests: one record for review and consult, with events and derived status.
2. Routing: named people, then the post, then the team list, resolved and stored at send.
3. The `care_team` access basis for request recipients, and inbox privacy (extends ADR 0131, keeps ADR 0199).
4. Requests ride the Plan basket and Place (extends ADR 0184 §3), and senior review becomes a request.
5. The duty rota: posts and timed assignments, planned not proven, leave from `availability_blocks`.
6. Escalation of unanswered requests, reusing ADR 0244 with signed response times.

(The workspace change can be a section of ADR 4; the nurse in-charge notice a section of ADR 1.)

**Tests:**

- **Pure:**
  - the request engine (every event order, anomalies listed, property test "nothing asked disappears");
  - `whoCovers` with a fixed clock (nights over midnight, capacity, fallback order, leave);
  - the escalation planner (ADR 0244 style);
  - the Plan checklist and compose lines.
- **PGlite lane (`tests/emr-db`, `EMR_PGLITE=1`):**
  - `care-requests.test.ts`:
    - Place with requests is all-or-nothing, and `client_key` retries place once;
    - superseded problems are refused;
    - reply-by-signed-note writes `replied`;
    - decline needs a reason.
  - `duty-rota.test.ts`: the guard's refusals (cadre, overlap, leave, actor, published week).
  - `rls-probes.test.ts` extended to the new tables across all actors.
  - The access-rule equivalence probe (per-patient and set form) with the `care_team` arm, plus the 30-day window.
  - `drizzle-parity.test.ts` for the new schema.
  - An escalation runner idempotency test with a fixed clock.
- **App:** a lane registry test, a privacy test that the cover panel and notifications carry no patient names, and
  copy tests if the words go into `content/`.
- **Checks:** `npm run typecheck && npm run lint && npm run test`, and `npm run build` before shipping.

---

## 6. What the foundation deliberately leaves out

- Full HR rostering: hours rules, pay, overtime, contract limits.
- Per-department apps or route trees.
- Auto-accepting or auto-answering anything. Decision support only; every reply is a clinician's signed note.
- Patient-facing visibility of consults (the visit summary can mention them later).
- Outpatient referrals between clinics (those are bookings, ADR 0202) and referral out to other facilities
  (`encounter_orders` kind `referral` and the HMIS 032 note).
- Nursing rotas. The post model takes `nurse_in_charge` posts, but the nurse side keeps `ward_in_charge_assignments`
  until nurses ask for shifts.

---

## 7. Decisions for the owner (each with my recommendation)

- **D1. Should review requests and consults be one kind of record?**
  Recommend **yes**: one request with a kind, one inbox, one set of states. Two systems would drift.

- **D2. What counts as "acknowledged"?**
  Recommend: opening it is recorded as **seen** but never shown as acknowledged. **Accept** (one tap, optional "expect
  me at") is the acknowledgement. Only a **signed reply note** completes it.

- **D3. Can the receiving team decline?**
  Recommend **yes, with a reason code**, which the CSO signs. The request goes back to the requester to redirect or
  cancel. The screen always says the requesting team is still responsible for the patient.

- **D4. Who sets the response times, and what are they?**
  Recommend: per hospital, signed by the CSO. No automatic escalation until signed. Starting proposals for the CSO to
  accept or change, not verified clinical standards:
  - review `now`: accept within 15 min;
  - review `within_1h`: accept within 60 min;
  - consult `urgent_today`: accept within 2 h and reply the same day;
  - routine: reply within 24 h.

- **D5. Should a consult say "advice only" or "please see the patient"?**
  Recommend **yes**: two choices, required. They change what the consultant does first (RCEM, Southland).

- **D6. Who in the receiving department sees its consult list?**
  Recommend: all active clinical staff of that department see the list with patient name and ward, so anyone can pick
  one up. Opening the chart needs them to be routed to it or to accept it first, and that opening is logged.
  The alternative: only routed people see it. That is more private, but requests get stuck when the rota is wrong.

- **D7. Where does an unanswered request escalate?**
  Recommend: the next post up (SHO, then consultant on call), then the department head, then the hospital's contacts.
  The requester is told at each step.

- **D8. Who makes the rota?**
  Recommend: the hospital admin and the head of department, with a named delegate (for example a chief resident) added
  in phase 4.

- **D9. Doctors' leave: one source?**
  Recommend: **yes**, the leave already requested and approved in Clinics & schedule (ADR 0506). Approving leave marks
  that doctor's duties "needs cover"; it never removes an on-call duty silently.

- **D10. Words for posts ("registrar" in the prototype, "SHO" at Mulago)?**
  Recommend: each hospital names its own posts. MedSync shows the hospital's words, and Mulago's defaults are its own
  ("SHO on call", "Consultant in charge"). Rules use neutral levels underneath.

- **D11. When do ward-cover review requests go out, and when is the nurse in charge told?**
  Recommend: review requests go out at **Place**, as you said, using the ward chosen in the Plan. The nurse in charge is
  told at **admission (Close)**, when the ward and bed are final.

- **D12. Should each inpatient have one named "first contact" doctor?**
  Recommend **not in this foundation**. Cover comes from the ward's posts. Revisit after phase 2: the evidence for a
  named first contact is strong (18% to 88% correctly routed critical results), and it would also feed the lab ladder.

Smaller points the GATE A can settle with the CSO:

- **Interns sending consults:** allowed by default, the requester's cadre shown, and a co-sign policy kind
  `request_consult` available if a hospital wants one.
- **Social workers:** not a cadre today. Defer them, or add one as non-clinical with no chart access, so a request
  shows them only the ward, the ask and the patient's name.
- **"Discussed by phone" for urgent requests:** recorded on the request and counted as accepted at the phone time.

---

## 8. Risks

| Risk                                                                                 | Why it matters                                                                          | Mitigation in the design                                                                                                     |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| The rota is wrong or stale                                                           | Requests reach someone off duty (14% of pages in one study)                             | Address posts not people; team-list fallback; escalation; gap report; "rostered, not confirmed present" wording              |
| "Sent" read as "they know"                                                           | False reassurance on a sick patient                                                     | Seen ≠ acknowledged; requester sees state words and elapsed time; escalation; heartbeat banner                               |
| Wider chart access through the `care_team` arm                                       | Privacy                                                                                 | Only routed or accepting people; 30-day window; every open logged; RLS probes; GATED migration the owner applies             |
| The escalation job stops quietly                                                     | Overdue requests sit unseen                                                             | Heartbeat older than 3 min shows a banner; lazy escalation on every read                                                     |
| Alert fatigue                                                                        | People stop reading notices                                                             | One notice per request per person; updates only to the requester; no SMS in v1                                               |
| Plan placed before admission, then the ward changes or admission is cancelled        | Review sits with the wrong ward cover                                                   | The request names its ward; on admission cancel or ward change the requester is prompted to redirect; nothing silently moves |
| Three leave stores (pharmacy, clinicians, none for nurses)                           | Drift                                                                                   | Doctors use `availability_blocks` only; note in the ADR that pharmacy keeps its own until unified                            |
| Responsibility confusion                                                             | A consultant thinks the request made the patient theirs, or the ward thinks the reverse | Every request screen says who is responsible (the primary team) until a take-over is agreed and recorded as a note           |
| Uganda specifics unverified (take days, Kiruddu's role, MoH referral guideline text) | Model fits the brochure, not the ward                                                   | Posts and fallback are generic; confirm on site before seeding Mulago defaults                                               |
| Migration and ADR numbers collide with other branches                                | Build friction                                                                          | Numbers are provisional; take the next free ones at build time                                                               |
| Scope creep into HR rostering                                                        | Slows the clinical value                                                                | Explicit non-goals (§6)                                                                                                      |

---

## 9. Sources

**Repository:** cited inline with paths and line numbers.

**FHIR and IHE:**

- ServiceRequest: https://hl7.org/fhir/R4/servicerequest.html
- Request pattern: https://hl7.org/fhir/R4/request.html
- Workflow: https://hl7.org/fhir/R4/workflow.html
- Task: https://hl7.org/fhir/R4/task.html and https://hl7.org/fhir/R5/task.html
- Task status: https://hl7.org/fhir/R4/valueset-task-status.html
- Exchange patterns: https://hl7.org/fhir/R4/workflow-communications.html and https://hl7.org/fhir/R4/workflow-management.html
- Encounter participant roles: https://hl7.org/fhir/R4/valueset-encounter-participant-type.html
- CareTeam: https://hl7.org/fhir/R4/careteam.html
- Schedule: https://hl7.org/fhir/R4/schedule.html
- PractitionerRole: https://hl7.org/fhir/R5/practitionerrole.html
- IHE mCSD: https://profiles.ihe.net/ITI/mCSD/volume-1.html
- BSeR: https://build.fhir.org/ig/HL7/bser/workflow_management_resources.html
- IHE 360X: https://www.ihe.net/uploadedFiles/Documents/PCC/IHE_PCC_Suppl_360X.pdf

**EHR practice and evidence:**

- UCLA consult paging (Epic): https://pmc.ncbi.nlm.nih.gov/articles/PMC9259201
- Salem Health (Epic): https://salemhealth.org/common-ground-home/common-ground-post/new-inpatient-consult-workflow-starts-april-30-in-epic
- Alberta Connect Care: https://manual.connect-care.ca/workflows/ReferralConsultation/consultation-workflows
- Niagara Health (Cerner): https://niagarahealth.on.ca/files/his_tip_sheets/PhysTrack-AcuteCare-PrescriberConsults2024-10-111141Approved-94.pdf
- RCEM 2025 referral standards: https://rcem.ac.uk/wp-content/uploads/2025/04/Referral-for-Inpatient-Care-Standards.pdf
- Southland NZ e-referral: https://pmc.ncbi.nlm.nih.gov/articles/PMC9204417
- Jerusalem consult times: https://pmc.ncbi.nlm.nih.gov/articles/PMC8053423/
- Wong 2009, pages to the wrong doctor: https://jamanetwork.com/journals/jamainternalmedicine/fullarticle/10.1001/archinternmed.2009.117
- First-contact provider: https://psnet.ahrq.gov/web-mm/getting-right-doctor-right-away
- NHS seven-day standards: https://www.england.nhs.uk/wp-content/uploads/2022/02/B1230-seven-day-services-clinical-standards-08-feb-2022.pdf

**Uganda:**

- Kalyesubula 2019 (Mulago medicine organised by sub-specialty units): https://pmc.ncbi.nlm.nih.gov/articles/PMC6516645
- Kazibwe 2022 (Mulago and Kiruddu admissions): https://pmc.ncbi.nlm.nih.gov/articles/PMC9458845/
- Absenteeism and rota adherence: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8378719/
- Unverified items are listed in `web-findings.md` §4.
