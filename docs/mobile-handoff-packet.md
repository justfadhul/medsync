# MedSync — Mobile Handoff Packet (clinician workspace) · [GATE CG]

**Purpose.** The mobile app is a **second client of the same Supabase backend** — the same Postgres, the same RLS, the same Edge Functions, the same audit. It is NOT a separate API. This packet is the contract a mobile build consumes: per surface, what's phone-appropriate, the exact read/write contracts, the cadre/auth gates, the states, and the governance. **Nothing here invents an endpoint** — every table / Edge Function / helper below is cited to the repo.

**Reading rule.** "Read contract" = what the phone may SELECT (and which PHI is decrypted server-side). "Write actions" = the Edge Functions only (clients never write clinical tables directly — there is no client INSERT/UPDATE policy on clinical tables; all writes go through service-role Edge Functions that stamp author + audit).

> **Honesty banner — engine status (read this first).** Only some engines are live today. A mobile build must render honest "engine not live" states for the rest.
>
> | Engine                              | Status                  | Notes                                                                                                                                                            |
> | ----------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | Scheduling                          | **LIVE**                | appointments + availability; real surfaces                                                                                                                       |
> | Patient summary (audited PHI read)  | **LIVE**                | doctor + nurse; `clinical_phi_access_log` written on read                                                                                                        |
> | Triage / Resus                      | **LIVE**                | triage_records, resus_episodes + timeline                                                                                                                        |
> | Prescribing (emergency/crash-cart)  | **LIVE — narrow**       | engine + catalog live, but writes to the **immutable resus timeline**; persistent `prescriptions`/`patient_allergies` are **GATED (migration 0039 not applied)** |
> | Co-sign queue                       | **LIVE**                | `clinical_cosign_requests` + senior review surface                                                                                                               |
> | Nurse observations (vitals capture) | **LIVE**                | `clinical_observations` capture; but see Monitoring                                                                                                              |
> | **Encounter / EMR engine**          | **GATED — not on prod** | migration 0040 written, **not applied**; no UI yet (GATE D in progress, PR #80)                                                                                  |
> | **Monitoring / vitals alerts**      | **STUBBED / seam**      | no `clinical_alerts` table; `/doctor/alerts` returns `[]` by design                                                                                              |
> | **Care team**                       | **STUBBED / seam**      | no `care_team` table; the access basis branch is "always false today"                                                                                            |

---

## PART 1 — Cross-cutting foundations

### 1.1 Cadre model (`cadres`, migration 0009 + 0033)

20 cadres across 4 statutory councils; `is_clinical` is the reception-exclusion flag used by clinical RLS.

| Council                    | Cadres (`code`)                                                                                                   | `is_clinical`                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **UMDPC** (doctors/dental) | INTERN_DOCTOR, MEDICAL_OFFICER, MEDICAL_OFFICER_SG, CONSULTANT, SENIOR_CONSULTANT, DENTAL_OFFICER, DENTAL_SURGEON | true                                |
| **UNMC** (nursing)         | NURSE, MIDWIFE, SPECIALIST_NURSE                                                                                  | true                                |
| **AHPC** (allied)          | CLINICAL_OFFICER, LAB_TECH, LAB_TECHNOLOGIST, RADIOGRAPHER, PHYSIOTHERAPIST, OCCUPATIONAL_THER, NUTRITIONIST      | true                                |
| **PHARM_BOARD**            | PHARMACIST, PHARMACY_TECH                                                                                         | true                                |
| _(none)_                   | **RECEPTION**                                                                                                     | **false** ← only non-clinical cadre |

Grades (`cadre_grades`) matter for cosign: e.g. NURSE → ENROLLED / REGISTERED / SPECIALIST (an **ENROLLED** nurse's high-alert administration is cosign-gated, see §1.5).

### 1.2 Auth & MFA — every clinical session is AAL2

`MFA_REQUIRED_ROLES` (`lib/auth.ts`): `clinician, nurse, pharmacist, lab_tech, hospital_admin, superadmin`. **Reception is also AAL2** (touches identifiable patient data). Every scope helper enforces two redirects:

```
if (state.nextAal !== "aal2") → /onboarding/mfa-setup   // not enrolled
if (state.aal     !== "aal2") → /sign-in/mfa            // enrolled, session not stepped up
```

**Mobile implication:** the phone MUST complete TOTP step-up to AAL2 before any clinical read/write. A non-AAL2 session is treated as unauthenticated for clinical surfaces.

### 1.3 Lifecycle states that BLOCK clinical access (`lib/lifecycle.ts`)

15 states; **only `active` permits clinical work.** `BLOCKS_CLINICAL` = `unverified, verified, pending_approval, rejected, suspended, deactivated, under_review, agreement_signed, provisioning, offboarded, agreement_expired`.

Scope helpers additionally gate on the **affiliation + hospital**:

- `REACHABLE_AFFILIATION_STATES = { active, approved }`
- `REACHABLE_HOSPITAL_STATES = { provisioning, active }`

So a clinician with a `pending_approval` affiliation, or at a `suspended` hospital, gets **no clinical data** — the phone should render the same "pending / no access" state the web does.

### 1.4 Scope helpers (the server-side gate every surface inherits)

| Helper                  | Cadre filter                                       | Returns (key fields)                                            | No-match redirect            |
| ----------------------- | -------------------------------------------------- | --------------------------------------------------------------- | ---------------------------- |
| `requireClinicianScope` | any reachable affiliation                          | userId, hospitalId, departmentId, affiliationState              | /onboarding/clinical-pending |
| `requireDoctorScope`    | DOCTOR_CADRE_CODES (5 UMDPC medical)               | + cadreCode, `isJunior/isSenior/isConsultantLevel`              | /clinician                   |
| `requireNurseScope`     | NURSE_CADRE_CODES (NURSE/MIDWIFE/SPECIALIST_NURSE) | + cadreGradeCode, `isEnrolled/…`, `isInCharge`, inChargeWardIds | /clinician                   |
| `requireReceptionScope` | exact `RECEPTION`                                  | operational only (no clinical)                                  | /                            |
| `requireResusScope`     | `is_clinical = true`                               | + `leaderRecommended` (soft)                                    | /                            |
| `requireTriageScope`    | `is_clinical = true` + policy                      | + `authority` (from cosign policy)                              | /nurse                       |

All require `active|approved` affiliation (reception helper matches the cadre exactly). The mobile app calls the **same** Supabase auth; these helpers run server-side (Next.js route handlers / RSC). A native mobile client that talks to Supabase directly is bound by **RLS** (below) — it cannot see more than these helpers would allow because RLS enforces the same predicates at the DB.

### 1.5 Co-sign model (`clinical_cosign_*`, migration 0030/0031) + the decision rule

- **`clinical_cosign_policies`** — `(hospital_id, department_id?, cadre_code, action_kind) → requirement ∈ {allowed, cosign_required, blocked}`. Department row overrides hospital-wide default; **absent policy ⇒ `blocked`** (safe default).
- **`clinical_cosign_requests`** — the queue: `patient_user_id, requested_by_user_id, requested_by_cadre_code (snapshot), action_kind, action_payload jsonb, state ∈ {pending_review, approved, returned, cancelled, expired}, reviewed_by_user_id, reviewed_at, review_note, expires_at`.
- **`clinical_supervision`** — supervisee↔supervisor (primary/backup) pairings.
- **The rule (`lib/doctor/capabilities.ts → resolveCapabilities`)**: read the policies for the actor's `(hospital, cadre, action_kind)`; dept-specific wins; if `cosign_required`, the write Edge Function files a `clinical_cosign_requests` row instead of completing, and returns `queued_for_review: true`.
- **`action_kind`** (CHECK-constrained; authoritative list in migration 0030 + 0031 extension): `prescription_routine, prescription_controlled, order_high_cost_imaging, admit_patient, discharge_patient, high_alert_med_administration, independent_complex_procedure`.

Today the **only wired cosign path is `ha-administer-medication`** (ENROLLED nurse + high-alert → queued). The other action_kinds have policy rows but their producing Edge Functions are pending the relevant engines.

### 1.6 Audit pattern (three mechanisms — all append-only)

1. **`audit_log` + `audit_log_changes()` trigger** (migration 0003, SECURITY DEFINER): fires AFTER INSERT/UPDATE/DELETE on every audited table; captures `actor_id, action, table, record_id, before_data, after_data, request_id`. Tamper-blocked (`audit_log_block_modify` + REVOKE UPDATE/DELETE). This is the **write** trail.
2. **`sa_audit_log` + `recordSaAudit()`** (`_shared/sa-audit.ts`): god-mode / privileged actions (break-glass, four-eyes, role grants, audit export) with a **required `reason` ≥ 8 chars**. Most `ha-*` Edge Functions call this with the action's `reason`.
3. **`clinical_phi_access_log`** (migration 0030): the **read** trail — "who viewed which patient, on what basis": `hospital_id, clinician_user_id, patient_user_id, access_basis ∈ {care_team, active_encounter, department_recent, break_glass}, surface`. Written **after** a successful authorised PHI fetch. Append-only.

**Break-glass** (`sa_break_glass_grants`, migration 0018; opened by `sa-open-break-glass`): time-boxed (5–60 min, default 15) PHI grant `(actor_id, patient_id, purpose ≥16, category, expires_at, revoked_at, sa_audit_log_id)`. Superadmin-only to open; the patient + their hospital_admin can SEE the grant (transparency). A read under break-glass logs `access_basis='break_glass'`.

### 1.7 RLS migrations governing clinical/staff data

| Migration                    | Secures                                                                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0002_rls                     | users, hospitals, departments, user_roles, consent_records, audit_log; defines `user_has_role(role, hospital)`                                                                                |
| 0028_scheduling              | availability_blocks, clinician_scheduling_settings, department_scheduling_policy, appointments, encounters, queue_entries                                                                     |
| 0030_doctor_workspace        | clinical_supervision, clinical_cosign_policies, clinical_cosign_requests, clinical_phi_access_log                                                                                             |
| 0031_nurse_workspace         | nursing_assignments, ward_in_charge_assignments, clinical_observations, medication_administration_records, shift_handovers                                                                    |
| 0033_reception_workspace     | adds `cadres.is_clinical`; tightens clinical-content policies to exclude reception                                                                                                            |
| 0036_triage_engine           | triage_records, triage_config, triage_discriminators, (+ queue/obs)                                                                                                                           |
| 0038_resus_abcde             | resus_episodes, resus_timeline_events, resus_role_assignments, resus_mobilisation_alerts                                                                                                      |
| 0039_smart_prescribing       | **GATED** — patient_allergies, prescriptions, crash_carts, crash_cart_stock, emergency_administrations                                                                                        |
| 0040_encounter_emr_engine    | **GATED** — clinical_documentation, encounter_diagnoses, problem_list, encounter_medications, encounter_orders, encounter_results, encounter_events, care_plan, `has_clinical_relationship()` |
| 0041_clinical_code_reference | **GATED** — icd10_codes, loinc_codes (non-PHI reference)                                                                                                                                      |

`user_has_role(role_name, p_hospital_id DEFAULT NULL)` (0002, SECURITY DEFINER STABLE) reads `user_roles` — the predicate behind most write-side RLS.

### 1.8 Full clinician/staff Edge Function inventory

Convention: every `ha-*` takes a `reason: string (min 8)` that lands in `sa_audit_log`. All return JSON via `ok(...)`. Auth via `getCaller` + `hasRole`/scope. (Patient-facing `pt-*` and superadmin-only `sa-*` listed at the end for completeness.)

**Encounter / patient-handling**

- `ha-start-encounter` — `{appointment_id?|queue_entry_id?, reason}` → `{encounter_id, status:"in_progress"}`. Clinician(own)/nurse/admin.
- `ha-complete-encounter` — `{encounter_id, completion_reason?, reason}` → `{encounter_id, cascade}`. Owner/admin.
- `ha-check-in-patient`, `ha-mark-arrived`, `ha-register-intake`, `ha-cancel-intake`, `ha-record-walkin` — reception/nurse/clinician patient-flow.
- `ha-assign-patient-to-nurse` — ward in-charge pairs patient↔nurse.

**Nursing clinical**

- `ha-record-observation` — `{hospital_id, patient_user_id, observation_kind ∈ [bp,hr,temperature,rr,spo2,glucose,pain,weight,height,intake,output,gcs,other], numeric_value_1?, numeric_value_2?, unit?, pain_scale?, notes?, encounter_id?, recorded_at?, reason}` → `{observation_id}`. **No cosign.**
- `ha-administer-medication` — `{hospital_id, patient_user_id, encounter_id?, prescription_id?, drug_name, dose, route ∈ [oral,iv,im,sc,topical,inhaled,pr,other], is_high_alert, state ∈ [administered,withheld,refused,wasted], withheld_reason?, scheduled_for?, administered_at?, notes?, reason}` → `{mar_id, cosign_request_id, queued_for_review}`. **COSIGN: ENROLLED nurse + high-alert ⇒ queued_for_review.**
- `ha-submit-handover` — shift handover + patients_of_concern.

**Scheduling (clinician/admin)**

- `ha-set-clinician-availability`, `ha-cancel-clinician-availability`, `ha-set-clinician-settings` — availability/policy (operational, not clinical).
- `ha-confirm-appointment-request`, `ha-decline-appointment-request` — clinician approves/rejects a requested appointment.
- `cancel-appointment`, `reschedule-appointment`, `ha-mark-no-show` — appointment lifecycle.
- `system-propose-urgent-appointment` — service-role/superadmin; the **monitoring→scheduling seam** (creates an urgent appt from an alert).

**Staff admin (hospital_admin/superadmin)**

- `approve-staff-affiliation`, `reject-staff-affiliation`, `ha-assign-staff-role`, `ha-set-staff-status`, `ha-reset-staff-mfa`, `ha-invite-staff`, `ha-revoke-staff-invitation`, `ha-request-staff-info`, `assign-role`.

**Superadmin-only (`sa-*`)** — `sa-open-break-glass`, `sa-close-break-glass`, `sa-create-superadmin` (four-eyes), `sa-create-hospital`, `sa-activate-hospital`, `sa-deactivate-user`, `sa-suspend-user`, `sa-reset-user-mfa`, `sa-export-audit-log`. **Not phone-appropriate** (web-only, desktop governance).

**Patient-facing (`pt-*`)** — `pt-request-appointment`, `pt-declare-intake` (patient app, not clinician handoff).

> ⚠️ **There is no `ha-record-clerkship` / `ha-place-order` Edge Function yet.** The encounter engine's writes go through `lib/encounter/record.ts` (server-only), which is NOT wired to an Edge Function or surface — it's GATE D + the gated migration. A mobile encounter write contract does not exist until then.

---

## PART 2 — The seven surfaces

For each: **Mobile scope · Read contract · Write actions · Cadre & auth · States · Governance · Engine status.**

---

### A) Patient summary — **LIVE**

**Mobile scope.** Read-only on phone: identity + allergies + known conditions + (when live) problems/meds. Editing demographics, merging records → **web-only**. The single most valuable mobile read.

**Read contract.** `lib/doctor/patient-access.ts → fetchPatientSummaryAudited()` (nurse: `lib/nurse/patient-access.ts`). Source table `patient_profiles`; PHI **decrypted server-side** via `lib/encryption.ts decrypt()` (AES-256-GCM) — the phone never receives ciphertext or keys.

```ts
interface PatientSummary {
  patientUserId: string;
  patientCode: string;
  firstName: string;
  surname: string; // decrypted server-side
  sex: string;
  dateOfBirth: string; // plaintext columns
  phone: string;
  villageAddress: string | null; // decrypted server-side
  preferredLanguage: string | null;
  knownConditions: string[];
  accessBasis: "care_team" | "active_encounter" | "department_recent" | "break_glass";
}
```

Encrypted-at-rest columns: `firstNameEncrypted, surnameEncrypted, phoneEncrypted, villageAddressEncrypted, idNumberEncrypted, nokNameEncrypted, nokPhoneEncrypted`. Plaintext: `sex, dateOfBirth, knownConditions, patientCode`.

**RLS that scopes "my patients".** The read is gated by the **legitimate-access basis** resolved in `resolvePatientAccess()` (doctor) / nurse equivalent: `active_encounter → department_recent (30d) → care_team (seam) → break_glass`. There is **no "list all patients"** — the panel (`listDoctorPatientPanel`) is the union of those bases. Mobile inherits this; a patient with no basis is invisible.

**Write actions.** None on this surface (demographics are patient/registration-owned).

**Cadre & auth.** `requireDoctorScope` / `requireNurseScope` (AAL2). Reception **cannot** read (is_clinical=false → RLS denies).

**States.** loading; empty ("no patients in your department/encounters"); **denied** ("above your access" when no basis) — render honestly, don't 500; error.

**Governance.** Every successful PHI read writes `clinical_phi_access_log {basis, surface}` AFTER decrypt. Phone-appropriate (read). Break-glass reads flagged `break_glass`.

**Engine status.** LIVE (doctor + nurse surfaces in prod).

---

### B) Schedule — **LIVE**

**Mobile scope.** Read "my schedule" (next N days). **Actionable & phone-appropriate:** confirm/decline appointment requests, mark arrived/no-show, start/complete encounter. **Web-only:** setting availability blocks, scheduling settings, recurrence (heavy forms).

**Read contract.** `appointments` (migration 0028; `db/schema/scheduling.ts`):

```ts
// appointments (key fields)
{ id, hospitalId, departmentId, patientUserId, clinicianUserId,
  startsAt, endsAt,
  reason: "follow_up"|"new_concern"|"refill"|"routine"|"urgent_review"|"other",
  origin: "patient"|"clinician"|"nurse"|"reception"|"system_urgent"|"walk_in",
  status: "requested"|"pending_approval"|"confirmed"|"arrived"|"in_progress"|"completed"|"cancelled"|"no_show"|"rescheduled"|"declined",
  priority: "routine"|"urgent", type: "in_person"|"virtual",
  triggeredByAlertId: string|null /* monitoring seam */ }
```

Also `availability_blocks`, `clinician_scheduling_settings`, `department_scheduling_policy`. "My schedule" = `clinician_user_id = me AND hospital_id = mine` (RLS scopes clinician to own rows; patient PHI on the row is name/code via the patient-access path, not raw).

**Write actions** (Edge Functions, Zod):

- `ha-confirm-appointment-request` `{appointment_id, reason}` → `{status:"confirmed"}`.
- `ha-decline-appointment-request` `{appointment_id, reason /*shown to patient*/}` → `{status:"declined"}`.
- `ha-mark-no-show` `{appointment_id, reason}` → `{status:"no_show"}`.
- `ha-mark-arrived` `{appointment_id, reason}` → `{queue_entry_id?}`.
- `reschedule-appointment` `{appointment_id, new_starts_at, new_ends_at, reason}` → `{new_appointment_id}`.
- `cancel-appointment` `{appointment_id, reason}`.
- `ha-start-encounter` / `ha-complete-encounter` (see §D). **No cosign** on any.

**Cadre & auth.** `requireDoctorScope` / `requireClinicianScope`; owner-or-admin enforced inside each function.

**States.** loading; empty ("no upcoming appointments"); pending-approval rail; error.

**Governance.** Each action → `sa_audit_log` (reason). Phone-appropriate (lightweight actions). Availability authoring = web.

**Engine status.** LIVE.

---

### C) Monitoring alerts — **STUBBED / SEAM**

**Mobile scope (intended).** Read prioritised threshold-breach alerts; acknowledge/triage on phone (high value — alerts are a push use-case). Threshold config = web. **Today: nothing to show.**

**Read contract.** **No `clinical_alerts` table exists.** `lib/doctor/alerts.ts → listOpenAlertsForDoctor()` returns `[]` by design; `/doctor/alerts` renders an honest seam. Raw vitals ARE captured in `clinical_observations` (`db/schema/nurse-workspace.ts`): `{ observationKind ∈ [bp,hr,temperature,rr,spo2,glucose,pain,weight,height,intake,output,gcs,acvpu,other], numericValue1, numericValue2, unit, recordedAt, state ∈ [active,corrected], correctedByObservationId, triageRecordId }` — but there is **no schedule/threshold/alert engine**.

**Write actions.** Vitals capture today: `ha-record-observation` (see inventory). Alert ack/dispatch: **does not exist** (ships with monitoring). The scheduling seam `system-propose-urgent-appointment` is the wired consumer-to-be (`appointments.triggered_by_alert_id` is a TEXT seam awaiting the FK).

**Cadre & auth.** Observation capture: `requireNurseScope` (+ clinician). Alerts surface: would inherit `requireDoctorScope`.

**States.** **"Engine not live"** is the primary state — render "Monitoring connects here; the monitoring engine ships separately." Plus future loading/empty/error.

**Governance.** Observations audited via `audit_log_changes`. Alerts governance TBD with the engine.

**Engine status.** **STUBBED / seam.** (Vitals _capture_ is live; _monitoring_ — alerts/trends/thresholds — is a later build; the encounter engine treats `clinical_observations` as the defined vitals-link interface.)

---

### D) Encounters / EMR — **GATED (not on prod)**

**Mobile scope (intended).** Read the encounter record + timeline + latest clerkship (read is the phone win). **Web-only:** authoring the structured Hutchison clerkship (heavy form), placing complex orders. Possibly a lightweight "add note/addendum" on phone later.

**Read contract.** `lib/encounter/record.ts → loadEncounterRecord(encounterId, patientUserId, scope)` → `{ documentation, clerkship, allergies, diagnoses, problems, timeline }`. Tables (migration 0040): `clinical_documentation` (versioned/append-only, `sectionData jsonb`, `status draft|final`), `encounter_diagnoses` (icd10Code, mustNotMiss, status working|final|excluded), `problem_list`, `encounter_medications`, `encounter_orders` (kind, loincCode, status), `encounter_results`, `encounter_events` (append-only timeline), `care_plan`. `encounters` gains `disposition, triage_record_id, encounter_type (opd|inpatient|emergency|follow_up|tele)`, state widened with `planned`.

**RLS that scopes "my patients".** `has_clinical_relationship(patient)` (migration 0040) — the **same** legitimate-basis as the app resolver (`active_encounter → department_recent(30d) → break_glass`; care_team seam). Reads also write `clinical_phi_access_log`. ⚠️ Engine reads/writes run service-role (bypass RLS), so the basis is re-checked in `lib/encounter/scope.ts → resolveEncounterAccess` — RLS is necessary-but-not-sufficient.

**Write actions.** `lib/encounter/record.ts → recordClerkshipVersion()` (append-only version; fans out to allergies/meds/diagnoses/problems/orders/disposition). **Cadre rules** (`lib/encounter/access.ts`): doctor/CO clerks; **intern → diagnosis stays `working` (co-sign hook)**; nurse no final diagnosis; reception nothing. **⚠️ Not yet exposed as an Edge Function or surface** — there is no mobile (or web) write path until GATE D wires it and 0040 is applied.

**Cadre & auth.** `requireDoctorScope`/`requireNurseScope` → an `EncounterScope {userId, hospitalId, departmentId, cadreCode, isClinical}` (GATE D wires this adapter).

**States.** Today: **"engine not live / lands with the clinical module"** (the doctor patient page shows exactly this placeholder). Post-apply: loading/empty(no documentation yet)/draft-vs-final/denied/error.

**Governance.** Append-only documentation + timeline (block triggers); audit-on-read to `clinical_phi_access_log`; write audit via `audit_log_changes`. **Hard launch-blocker:** point the prescribing allergy read at `patient_allergies` before turn-on, else clerked allergies don't gate prescribing.

**Engine status.** **GATED** — migration 0040 written, **not applied**; engine code compiles + is unit-tested; no UI yet (PR #80, GATE D in progress).

---

### E) Prescribing & orders — **LIVE (narrow: emergency/crash-cart) · persistent store GATED**

**Mobile scope.** **Caution.** Bedside emergency administration is a resus-surface act (witnessed, at the cart) — phone is a poor fit for the act itself; mobile should **review** active meds + the prescribing safety flags. Routine prescribing/refills on phone could be cosign-gated later. Complex/controlled prescribing = web.

**Read contract.** Engine `lib/prescribing/engine.ts` (pure) + catalog `lib/prescribing/reference/emergency-drug-catalog.ts` (CSO-supplied, versioned, web-verified). Today **persistence is the immutable resus timeline** (`resus_timeline_events`, kind `"drug"` with a `prescribing` payload), NOT the `prescriptions` table. Allergy source today: `recordedAllergiesFromTimeline()` (resus timeline `allergyCapture`), **not** `patient_allergies` (that's the gated store).

**Write actions.** Emergency administration: `app/nurse/resus/actions.ts → recordEmergencyAdministration()` (server action, resus surface) — runs `runSafetyChecks` first. Nurse MAR: `ha-administer-medication` (cosign for ENROLLED + high-alert). **No general `ha-prescribe` Edge Function** (ships when 0039 applies). Safety flags:

```ts
interface SafetyFlag {
  code:
    | "allergy"
    | "concentration"
    | "weight_missing"
    | "paediatric_routing"
    | "max_cumulative"
    | "contraindication"
    | "controlled"
    | "dose_range";
  severity: "block" | "warn" | "info";
  message: string;
  overrideable: boolean;
  egregious?: boolean;
}
```

**Cadre & auth.** Prescribe-vs-administer authority is cadre-attributed (resus scope). `ha-administer-medication`: nurse cadres; ENROLLED+high-alert → cosign.

**States.** loading; empty (no meds); **block** (allergy/contraindication — hard stop, typed override for egregious); warn; "persistent prescribing not live (records to the resus timeline)".

**Governance.** Resus timeline is append-only + audited; overrides capture `overrideReason`+`overriddenFlags`+witness. Controlled drugs flagged. `prescriptions`/`emergency_administrations`/`patient_allergies` tables exist in schema but are **GATED (0039 not applied)**.

**Engine status.** **LIVE — narrow** (emergency/crash-cart via resus timeline; PR #69). Cross-encounter persistent prescribing = GATED.

---

### F) Care team — **STUBBED / SEAM**

**Mobile scope (intended).** Read who's on the patient's care team (a natural phone read). **Today: nothing** — the module isn't built.

**Read contract.** **No `care_team` table exists** in any migration. The access-basis `care_team` branch in both `lib/doctor/patient-access.ts` and `lib/nurse/patient-access.ts` is explicitly **"always false today — seam only."** The nearest live relations are `clinical_supervision` (supervisor↔supervisee) and `nursing_assignments` (nurse↔patient), but there is no assembled care-team view.

**Write actions.** None (no module).

**Cadre & auth.** Would inherit `requireDoctorScope`/`requireNurseScope` when built.

**States.** **"Engine not live"** only.

**Governance.** TBD with the module; note `care_team` is one of the four planned PHI access bases (so building it _widens_ legitimate access — a CSO sign-off item).

**Engine status.** **STUBBED / seam** (documented, table absent).

---

### G) Consultant co-sign queue — **LIVE**

**Mobile scope.** **Excellent phone fit — actionable.** A senior reviews a junior's flagged action and approves/returns on the go. Read the queue + read the `action_payload` + approve / return-with-note. Setting cosign _policies_ = web.

**Read contract.** `lib/doctor/cosign.ts → listPendingCosignRequests({hospitalId})` over `clinical_cosign_requests`:

```ts
{ id, hospitalId, patientUserId,
  requestedByUserId, requestedByCadreCode,           // who/what cadre
  actionKind: "prescription_routine"|"prescription_controlled"|"order_high_cost_imaging"|"admit_patient"|"discharge_patient"|"high_alert_med_administration"|"independent_complex_procedure",
  actionPayload: jsonb,                               // self-contained snapshot
  state: "pending_review"|"approved"|"returned"|"cancelled"|"expired",
  reviewedByUserId, reviewedAt, reviewNote, expiresAt }
```

RLS: requester sees own; **senior cadres at the same hospital see the pending queue**; hospital_admin/superadmin oversight. Joined to users/cadres for display.

**Write actions.** The approve/return action (review form at `app/doctor/cosign-queue/`) — sets `state` + `reviewed_by/at` + `review_note`. (Implemented as the cosign review server action / Edge path; cosign decisions are themselves audited — `sa-audit` actions `cosign_approve`/`cosign_return`.) Filing a request happens upstream in the producing function (e.g. `ha-administer-medication`).

**Cadre & auth.** `requireDoctorScope` **+ `scope.isSenior`** (the page redirects non-seniors to /doctor). Seniors = MEDICAL_OFFICER, MEDICAL_OFFICER_SG, CONSULTANT, SENIOR_CONSULTANT.

**States.** loading; empty ("nothing awaiting review"); per-item review; expired; error.

**Governance.** Every decision audited; the request carries a cadre snapshot + payload for medico-legal reproducibility. Phone-appropriate (this is a flagship mobile action).

**Engine status.** **LIVE** (senior-gated surface + table in prod).

---

## Appendix — mobile vs web (the [GATE CG] cut)

| Surface              | Phone: READ                     | Phone: ACTION                                    | Web-only                                 |
| -------------------- | ------------------------------- | ------------------------------------------------ | ---------------------------------------- |
| Patient summary      | ✅                              | —                                                | demographics edit/merge                  |
| Schedule             | ✅                              | confirm/decline, arrived/no-show, start/complete | availability + settings authoring        |
| Monitoring alerts    | (when live)                     | ack/triage (when live)                           | thresholds config                        |
| Encounters/EMR       | ✅ record+timeline (post-apply) | light note later                                 | full clerkship authoring, complex orders |
| Prescribing & orders | ✅ review meds + flags          | (bedside admin is resus, not phone)              | controlled/complex prescribing           |
| Care team            | (when live)                     | —                                                | team composition editing                 |
| Co-sign queue        | ✅                              | **approve / return**                             | policy authoring                         |

**Bottom line for a mobile build:** ship **Patient summary (read), Schedule (read + light actions), and the Co-sign queue (read + approve/return)** first — all LIVE, all phone-appropriate, all already RLS- and audit-governed. Treat Monitoring, Care team, and Encounters/EMR as **honest "coming with the engine" states** until those engines land (Encounters needs migration 0040 applied; Monitoring + Care team are unbuilt). Every write is an existing Edge Function with a Zod contract + a `reason` that is audited; the phone never writes a clinical table directly and never holds a decryption key.
