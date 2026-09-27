# Phase 0 discovery — access, permissions, charts, Workspace (Q9, Q10, Q12, Q13)

Branch `feat/emr-engine` @ 004772d. Read-only survey; every claim cites file:line. Repo wins over the prompt.

---

## Q9 — Permission matrix by cadre (today)

### Cadre catalogue

Table `cadres` (`db/schema/reference-data.ts:134`; `is_clinical` at :149, added in 0033). Seed `supabase/migrations/0009_reference_data_seed.sql:143-168` (19 clinical) + `0033_reception_workspace.sql:31-39` (RECEPTION, `is_clinical=false`).

| Council       | Codes                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| UMDPC medical | INTERN_DOCTOR, MEDICAL_OFFICER, MEDICAL_OFFICER_SG, CONSULTANT, SENIOR_CONSULTANT                                |
| UMDPC dental  | DENTAL_OFFICER, DENTAL_SURGEON                                                                                   |
| UNMC          | NURSE, MIDWIFE, SPECIALIST_NURSE (grades ENROLLED/REGISTERED/SPECIALIST in `cadre_grades`, 0009:171+)            |
| AHPC          | CLINICAL_OFFICER, **LAB_TECH, LAB_TECHNOLOGIST**, RADIOGRAPHER, PHYSIOTHERAPIST, OCCUPATIONAL_THER, NUTRITIONIST |
| Pharmacy      | PHARMACIST, PHARMACY_TECH                                                                                        |
| none          | RECEPTION (non-clinical)                                                                                         |

**A laboratory cadre exists** (LAB_TECH / LAB_TECHNOLOGIST, 0009:159-160) and already has a workspace: `lib/lab-tech/scope.ts:27` (`LAB_TECH_CADRE_CODES`), `requireLabTechScope` :51, route `app/lab/` (page, layout, `actions.ts`).

### Workspace scopes (who reaches which surface)

- Doctor: `lib/doctor/scope.ts:33` JUNIOR = INTERN_DOCTOR, CLINICAL_OFFICER; :36 SENIOR = MO, MO_SG, CONSULTANT, SENIOR_CONSULTANT; :50 `DOCTOR_CADRE_CODES`; non-matching → `/clinician` (:104).
- Nurse: `lib/nurse/scope.ts:29` NURSE, MIDWIFE, SPECIALIST_NURSE; else `/clinician` (:114).
- Lab: `lib/lab-tech/scope.ts:27`. Everyone else clinical (dental, allied, pharmacy) → generic `app/clinician/` (availability + schedule only).

### `clerkshipWriteAuthority` (`lib/encounter/access.ts:42-68`, pure)

`CLERKING_CADRE_CODES` :13 = 5 medical + CLINICAL_OFFICER. `COSIGN_REQUIRED_CADRE_CODES` :23 = INTERN_DOCTOR only.
Returns `canClerk`, `canWriteFinalDiagnosis` (clerker && !junior), `requiresCosign` (soft), `canRecordAllergies` (any clinical), `clinical`. Header says "INFERRED … CSO to ratify" (:8-9). Enforced in `recordClerkshipVersion` (`lib/encounter/record.ts:73-76`): non-clinical and non-clerker are refused.

### `clinical_cosign_policies` defaults (resolver default = `blocked`, `lib/doctor/capabilities.ts:33`)

Seeded per hospital that existed at migration time: 0030:313 (doctor actions), 0031:362 (nursing), 0036:272 (triage).

| Cadre                                    | rx_routine        | rx_controlled | high-cost imaging | admit   | discharge | triage_patient | triage_downgrade | high_alert_med | complex_proc |
| ---------------------------------------- | ----------------- | ------------- | ----------------- | ------- | --------- | -------------- | ---------------- | -------------- | ------------ |
| INTERN_DOCTOR                            | cosign            | blocked       | cosign            | cosign  | cosign    | allowed        | allowed          | –              | –            |
| CLINICAL_OFFICER                         | cosign            | blocked       | cosign            | cosign  | cosign    | allowed        | allowed          | –              | –            |
| MEDICAL_OFFICER                          | allowed           | cosign        | allowed           | allowed | allowed   | allowed        | allowed          | –              | –            |
| MO_SG / CONSULTANT / SENIOR_CONS         | allowed (all)     |               |                   |         |           | allowed        | allowed          | –              | –            |
| NURSE / MIDWIFE                          | –                 | –             | –                 | –       | –         | allowed        | blocked          | allowed        | cosign       |
| SPECIALIST_NURSE                         | –                 | –             | –                 | –       | –         | allowed        | blocked          | allowed        | allowed      |
| LAB, dental, allied, pharmacy, RECEPTION | no rows → blocked |               |                   |         |           |                |                  |                |              |

Action-kind CHECK widened in `0036_triage_engine.sql:250-266` (9 kinds); Drizzle `db/schema/doctor-workspace.ts:88-89,134-135` still lists only the original 5 → **schema/migration drift**. `COSIGN_ACTION_KINDS` (`lib/doctor/capabilities.ts:21`) also 5.

### Actor × action today

| Action                            | Path                                                                                                                                                                                                                                                                    | Gate                                                                                                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start encounter (booked/queue)    | `app/doctor/schedule/actions.ts:108` → Edge Fn `ha-start-encounter`                                                                                                                                                                                                     | booked clinician, any `nurse` role at hospital, superadmin, or scoped hospital_admin (`supabase/functions/ha-start-encounter/index.ts:108-116`); walk-in queue: any active clinical cadre (:253-270) |
| Start encounter from triage       | `app/doctor/encounters/actions.ts:24` → `lib/encounter/handoff.ts:88 openEncounterFromTriage`                                                                                                                                                                           | `requireDoctorScope` (doctor cadres incl. CO) + same hospital (:107); no cadre authority check beyond scope                                                                                          |
| Start from Workspace              | `app/doctor/_lib/workspace-actions.ts:181`                                                                                                                                                                                                                              | `requireDoctorScope`                                                                                                                                                                                 |
| Assign doctor (planned encounter) | `app/nurse/triage/actions.ts:413`, `lib/encounter/assignment.ts:99`                                                                                                                                                                                                     | `triage_patient=allowed` (Workspace `mayAssign`, `lib/workspace/queries.ts:360`)                                                                                                                     |
| Document (clerking version)       | `lib/encounter/record.ts:68`                                                                                                                                                                                                                                            | `canClerk` + `resolveEncounterAccess`                                                                                                                                                                |
| NCD draft                         | `app/doctor/encounters/[encounterId]/actions.ts:29` → `lib/ncd/draft.ts:98`                                                                                                                                                                                             | doctor scope; drafts table only (not the record)                                                                                                                                                     |
| Record observation                | `app/nurse/actions.ts:51`                                                                                                                                                                                                                                               | nurse scope                                                                                                                                                                                          |
| Complete encounter                | `app/doctor/schedule/actions.ts:141` → Edge Fn `ha-complete-encounter`                                                                                                                                                                                                  | encounter owner, superadmin, or scoped hospital_admin (`ha-complete-encounter/index.ts:94-101`)                                                                                                      |
| Order                             | Only as a side-effect of a clerking version (`lib/encounter/record.ts`, `lib/encounter/clerkship.ts` → `encounter_orders`)                                                                                                                                              | `canClerk`. No standalone `placeOrders`. `order_high_cost_imaging` policy exists but no order path reads it                                                                                          |
| Enter / release / reject result   | `app/lab/actions.ts:77 enterLabResultAction`                                                                                                                                                                                                                            | `labResultsLive()` (`lib/encounter/feature.ts:62`, `LAB_RESULTS_LIVE=1` + engine) + `requireLabTechScope` + order in same hospital (:84)                                                             |
| Acknowledge result                | **none** — no column, no action (grep `acknowledg` over `lib/encounter`, `lib/lab`, `app/lab`, `db/schema/encounter.ts` = 0 hits)                                                                                                                                       |
| Propose/co-sign clinical action   | `app/doctor/patients/[patientId]/actions.ts:47 proposeClinicalAction` (resolveCapabilities :86; blocked :110; cosign → `clinical_cosign_requests` pending :123; allowed → auto-approved row); review `:189 reviewCosignRequestAction` requires `scope.isSenior` (~:204) |
| Co-sign a clerking                | **none** — `clinical_documentation.cosigned_by_user_id` (`db/schema/encounter.ts:67`) has no writer, and the table is append-only (UPDATE blocked, 0040)                                                                                                                |

---

## Q10 — Patient-access rule in force

Three app resolvers + one SQL function, one basis vocabulary (`care_team | active_encounter | department_recent | break_glass`), **not identical**:

| Basis                                                        | `lib/encounter/scope.ts:45 resolveEncounterAccess` | `lib/doctor/patient-access.ts:42 resolvePatientAccess` | `lib/nurse/patient-access.ts:52 resolveNursePatientAccess`                    | SQL `has_clinical_relationship` (`0040:72-113`)               |
| ------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| active_encounter (own `in_progress`)                         | yes :50-61                                         | yes :48-59                                             | –                                                                             | yes                                                           |
| department_recent (appt or encounter in caller's dept ≤30 d) | yes :64-94                                         | yes :62-91                                             | ward_census: same-dept appt **today** via `nursing_assignments.department_id` | yes, + requires clinical cadre, affiliation `active/approved` |
| nurse `assigned` / `in_charge`                               | –                                                  | –                                                      | yes (assigned :74, in_charge = any appt at hospital today :101)               | **no**                                                        |
| break_glass (unrevoked, unexpired `sa_break_glass_grants`)   | yes :97-108                                        | **no** (type only, :35)                                | no                                                                            | yes                                                           |
| care_team                                                    | seam, always false                                 | seam                                                   | seam                                                                          | not present                                                   |
| hospital/tenant check                                        | **none** (no hospital predicate)                   | none                                                   | yes (`hospitalId`)                                                            | none                                                          |

- SQL fn: `SECURITY DEFINER`, `auth.uid()`; granted to `authenticated` (0040:114-115). Only one definition (0040); used by every 0040/0042 clinical-table SELECT policy as `patient_user_id = auth.uid() OR user_has_role('superadmin') OR has_clinical_relationship(patient_user_id)` (e.g. 0040:148-153) — **patients can read their own clinical rows today** (prompt §7.8 wants "Patient role: denied until Gate CG").
- App reads use the service-role Drizzle client and bypass RLS; the resolver is the real gate (`lib/encounter/scope.ts:21-23`).
- No `private` schema, no `private.accessible_patient_ids()` / `private.current_user_id()` (grep 0 hits). No `set_config('app.user_id')` pattern.
- Break-glass: **superadmin-only** (`supabase/functions/sa-open-break-glass/index.ts:75`), 15-min default (`db/schema/sa-break-glass-grants.ts:16`), page `app/admin/break-glass/page.tsx`. No clinician self-serve break-glass.

### `clinical_phi_access_log` (`db/schema/doctor-workspace.ts:141-173`, 0030; append-only trigger 0030:301-304)

`access_basis` CHECK = the 4 bases (:166). **No shared writer helper** — seven inline `db.insert(clinicalPhiAccessLog)` sites:
`lib/doctor/patient-access.ts:286`, `lib/nurse/patient-access.ts:323` (maps nurse basis → care_team/department_recent, real basis in `surface` "#basis" :316-329), `lib/encounter/record.ts:326,450`, `lib/triage/worklist.ts:161,232`, `lib/scheduling/patient-identity.ts:95`, `lib/reception/queries.ts:128`.

---

## Q12 — Existing chart / profile routes

| Route                                                  | Reads                                                                     | Access gate                                                     | Content                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `app/doctor/patients/page.tsx`                         | `listDoctorPatientPanel`                                                  | doctor basis                                                    | panel list                                                                                   |
| `app/doctor/patients/[patientId]/page.tsx` (281 l)     | `fetchPatientSummaryAudited` :36 + `PatientClinicalRecordPanel` :167      | doctor resolver, then `resolveEncounterAccess` inside the panel | demographics, placeholders "Recent vitals" / "Care team" :153-161, longitudinal record panel |
| `app/doctor/patients/[patientId]/prescribe/page.tsx`   | prescribing                                                               | doctor scope                                                    | prescribe dialog                                                                             |
| `app/doctor/encounters/[encounterId]/page.tsx` (432 l) | `loadEncounterRecord`, NCD draft, `doctorWorkspace` wrap                  | resolveEncounterAccess                                          | NCD clerking                                                                                 |
| `app/nurse/patients/[patientId]/page.tsx` (391 l)      | `fetchNursePatientSummaryAudited` :55 + `PatientClinicalRecordPanel` :273 | nurse resolver, then **resolveEncounterAccess** in panel        | summary + record panel                                                                       |
| `app/clinician/*`                                      | –                                                                         | –                                                               | no patient pages                                                                             |
| `app/patient/care/page.tsx`                            | `requirePatientScope`                                                     | own                                                             | placeholder: "the clinical module hasn't shipped" (:17)                                      |
| `app/lab/page.tsx`                                     | `lib/lab-tech/worklist.ts`                                                | lab scope                                                       | order worklist                                                                               |

Shared component: `components/encounter/patient-clinical-record-panel.tsx` (→ `loadPatientClinicalRecord`, `lib/encounter/record.ts:387`; hidden unless `encounterEngineLive()` :28). **Answer:** `/doctor/patients/[patientId]` and `/nurse/patients/[patientId]` are the chart homes to extend; no `/patients/[id]` needed.

---

## Q13 — Workspace

Merged: `lib/workspace/*`, `app/doctor/(workspace)/`, 0069 all present on this branch. Flag `doctorWorkspace(hospitalId)` (`lib/workspace/feature.ts:14`) = `DOCTOR_WORKSPACE` (1 or hospital-id list) AND `encounterEngineLive()` AND `resusDeskV2()`.

### Lane registry (`lib/workspace/lanes.ts`, 117 l, pure)

```ts
type LaneId = "resus"|"triage"|"unassigned"|"waiting"|"in_progress"|"needs_closing"|"done"; // :11
interface LaneViewer { mayAssign: boolean }                                               // :20
interface LaneDef { id; label; short; scope: "hospital"|"department"|"mine"; hotkey; collapsed?; empty; visibleFor(v) } // :26
const LANES: readonly LaneDef[]   // :42  display order; hotkeys 1–7
visibleLanes(viewer) :108 · laneFromParam(v) :113
```

**There is no "lane source" API.** A lane is display metadata only. Adding one (Critical results / Results to review / To co-sign) means: extend `LaneId` + `LANES` entry (+hotkey), add input arrays to `FlowInput` (`lib/workspace/flow.ts:141-156`), add a branch in `buildRow`'s precedence chain, load the data in `loadWorkspace` (`lib/workspace/queries.ts:91`), and extend `LaneViewer` if visibility depends on cadre. `LANE_ORDER` derives from `LANES` (`flow.ts:286`); counts from `LANES` (:338).

### FW rules (`lib/workspace/flow.ts`, 902 l, pure; tests `tests/workspace/flow.test.ts`)

FW-1 bucket by patient :344 · FW-3 current acuity = latest triage of visit :391 · FW-4 newest assignment wins :435 · FW-5 stale L1 (24 h) :395 · FW-7 death → needs_closing :541 · FW-8 resus supersedes triage :572 · FW-9 sort :881 · FW-10 amber only past CSO-signed target :800 · FW-11 Mine never takes others' items :369.
**FW-2 (one row, one lane) precedence**, `flow.ts:475-680`:

1. death + open items → needs_closing
2. live resus → resus
3. my non-idle `in_progress` encounter → in_progress
4. planned (non-stale L1) → waiting
5. intake awaiting triage → triage
6. triaged, unassigned → unassigned
7. any other open item (idle >24 h `ENCOUNTER_IDLE_MS` `queries.ts:54`, superseded, stale L1) → needs_closing
8. else → done (today)

Note: row-assignment precedence (above) ≠ board display order (`LANES`: resus, triage, unassigned, waiting, in_progress, needs_closing, done). Prompt E8 positions are display positions; the new branches also need a slot in the FW-2 chain. Encounter "last activity" is computed, not a column: `max(updated_at, latest clinical_documentation)` (`queries.ts:313`).

### Co-sign

Tables `clinical_cosign_policies` / `clinical_cosign_requests` (`db/schema/doctor-workspace.ts:62-141`, 0030:94,163): request = {hospital, patient, requester+affiliation+cadre, action_kind, action_payload jsonb, state pending_review|approved|returned|cancelled|expired, reviewer, expires_at}. Readers `lib/doctor/cosign.ts:37 listPendingCosignRequests`, :91 `listMyCosignRequests`, supervision :135/:185 (`clinical_supervision`). UI `app/doctor/cosign-queue/page.tsx` + `_components/review-form.tsx` → `reviewCosignRequestAction`. **Action-level only** (prescriptions/imaging/admit/discharge), not note co-sign; "approve to execute" executes nothing downstream yet (auto-approved rows are audit only).

### Realtime broadcast (0069 + client)

- `public.workspace_broadcast()` `0069_doctor_workspace.sql:98-117`: SECURITY DEFINER, `realtime.send({kind: TG_TABLE_NAME, at}, 'change', 'workspace:'||hospital_id, true)`, exceptions swallowed.
- Triggers :121-136 on `patient_intakes` (status, triage_level, receiving_department_id, routed_to), `triage_records` (INSERT), `encounters` (state, clinician_user_id, triage_record_id, ended_at). Needs `NEW.hospital_id` on the table.
- Receive policy on `realtime.messages` :145-160: topic `workspace:%` + `public.is_active_clinical_staff(h.id)` (defined 0068:115).
- Client `app/doctor/_components/workspace/use-workspace-live.ts`: private channel, event `change` → debounced (400 ms) `router.refresh()`; poll 15 s without channel, 5 min safety poll with; also `subscribeResusBoard` (`lib/resus/board-channel.ts:63`).
- `lib/workspace/changes.ts`: `countChanges(before, after)` (sig = lane|primary.kind|acuity) and `arrivals()` for the polite live region.
- To make results/co-sign lanes live: add the same trigger to the new result/cosign tables (payload PHI-free) — new migration, since 0069 is shipped.

### Resus v2 sync pattern (ADR 0109, `docs/adr/0109-resus-v2-realtime-sync-optimistic-queue.md`)

- Server: `commitResusEvents` (`lib/resus/v2-record.ts:88`) — one Drizzle tx, locks the episode, idempotent on first event's `clientEventId`, `recordedAt` bedside time (±60 s rule, `lateEntry`), `expectRows` optimistic check, `audit` row, `also(tx)` hook; returns `{ ok, serverTime, eventIds }` (`app/nurse/resus/_v2/common.ts:52`). Delta reads `fetchResusEventsSince` :246, `fetchByClientIds` :263.
- Client: `useDesk` (`app/nurse/resus/[episodeId]/_components/v2/use-desk.ts:82`) → `useWriteQueue` (`use-desk-queue.ts:42`), model `desk-queue-model.ts` (`SubmitSpec` :12, `WRITE_TIMEOUT_MS` 15 s :28, `backoffMs` cap :32, `nextToSend` :91); server clock `useServerOffset` (`desk-sync.ts`), 30 s skew warning (use-desk.ts:282), `beforeunload` guard :267, 10 s poll fallback :68. Queue in memory only (no IndexedDB).
- Topics `resus:<episodeId>` / `resus-board:<hospitalId>` (0068:461,493,515).
- Not generic: the queue is typed to `TimelineEvent` and `episodeId`; reuse for EMR notes/facts needs extraction.

---

## Prompt vs repo

| #   | Prompt                                                                                                            | Repo                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | §7.8 one predicate `private.accessible_patient_ids()` + `private.current_user_id()` + `set_config('app.user_id')` | none exist; the predicate is `public.has_clinical_relationship(uuid)` (0040:72) on `auth.uid()`, and app paths use service-role + TS resolvers                                                                                                                             |
| 2   | "Patient role: denied until Gate CG"                                                                              | 0040 policies admit `patient_user_id = auth.uid()`                                                                                                                                                                                                                         |
| 3   | "the patient-access rule … inside one function"                                                                   | 4 divergent implementations (table above)                                                                                                                                                                                                                                  |
| 4   | Writes via server actions, "Edge Functions only" wording replaced                                                 | start/complete encounter still go through Edge Fns `ha-start-encounter` / `ha-complete-encounter`; clerking, lab and workspace use server actions                                                                                                                          |
| 5   | §5.11 "register a lane source"                                                                                    | no source abstraction; a lane is a `LANES` entry plus a hand-written FW-2 branch                                                                                                                                                                                           |
| 6   | "Encounter state and `last_activity_at` feed FW-2"                                                                | no `last_activity_at` column; computed in `queries.ts:313`                                                                                                                                                                                                                 |
| 7   | R3 "no results model"                                                                                             | `encounter_orders` / `encounter_results` with specimen, critical flag, quality, entered/released (0050, 0051, `db/schema/encounter.ts:201,235`), lab worklist and `enterLabResultAction`, dark behind `LAB_RESULTS_LIVE`. Missing: acknowledgement and standalone ordering |
| 8   | Q9 "whether the catalogue has a laboratory cadre"                                                                 | yes: LAB_TECH, LAB_TECHNOLOGIST + a `/lab` workspace                                                                                                                                                                                                                       |
| 9   | Co-sign of notes (§5.9)                                                                                           | co-sign exists for actions only; no note co-sign writer                                                                                                                                                                                                                    |
| 10  | Prisma interactive tx                                                                                             | Drizzle `db.transaction` (pattern `commitResusEvents`)                                                                                                                                                                                                                     |

## Risks

- Nurse chart: the summary is allowed by the nurse resolver, but `PatientClinicalRecordPanel` re-gates with `resolveEncounterAccess`, which has no `assigned` / `in_charge` basis, so an assigned nurse can be refused the record panel.
- `resolveEncounterAccess` and the SQL fn have no hospital predicate; `department_recent` is safe only because department ids are hospital-scoped.
- The doctor resolver lacks break-glass, while the encounter resolver has it: a break-glass superadmin sees the record panel but not the doctor summary.
- Policy seeds run once over the hospitals that existed then (0030/0031/0036 `FROM public.hospitals`). Nothing seeds a new hospital, so every action there resolves to `blocked` and `mayAssign` is false.
- Junior definition differs: `lib/doctor/scope.ts:33` (INTERN + CO) vs `lib/encounter/access.ts:23` (INTERN only) for `requiresCosign`.
- Drizzle CHECK for cosign action kinds is stale against 0036 (drift for `db:check` / `db:generate`).
