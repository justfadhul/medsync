# Onboarding schema proposal — GATE A

> **Status:** PROPOSAL. **No migrations have been written yet.** Per the
> kickoff section 0.3, every new table appears here for your review
> first. After sign-off the migrations land additively (new files,
> never editing a shipped migration).
>
> **Constants throughout:** Phase 0 patterns reused verbatim — RLS
> deny-by-default + `FORCE ROW LEVEL SECURITY`, audit trigger
> (`public.audit_log_changes()`) attached to every sensitive table,
> PHI encrypted via `lib/encryption.ts` (AES-256-GCM) **before** the
> value reaches the DB, logger calls scrubbed via `lib/logger.ts`.
> Sensitive writes go through Edge Functions (Zod → `getUser()` →
> role check → action → PII-redacted log → audit entry → typed response).
>
> **Open questions at the bottom — answer those + flag any schema
> concerns and I'll start migrations.**

---

## Tables added in this proposal

| #   | Table                     | Purpose                                                                      |
| --- | ------------------------- | ---------------------------------------------------------------------------- |
| 1   | `reference_data_versions` | Provenance log: dataset × source × version × row_count for every seed.       |
| 2   | `regions`                 | Uganda statistical regions (4).                                              |
| 3   | `districts`               | Uganda districts (UBOS — see Open Question 2).                               |
| 4   | `subcounties`             | Uganda subcounties (UBOS — see Open Question 2).                             |
| 5   | `councils`                | 4 statutory clinical councils (UMDPC, UNMC, AHPC, **Pharmacy Board**).       |
| 6   | `cadres`                  | Council-mapped professional ladder rungs.                                    |
| 7   | `cadre_grades`            | Career grades within a cadre (e.g. enrolled vs registered nurse).            |
| 8   | `specialties`             | Clinical specialties (incl. sub-specialties via `parent_id`).                |
| 9   | `roles`                   | Position within a department (joined to cadre + optional specialty).         |
| 10  | `clinician_profiles`      | Professional identity anchor (council + reg. number + licence file).         |
| 11  | `staff_affiliations`      | user × hospital × department × cadre × role × status (per-affiliation).      |
| 12  | `patient_profiles`        | Patient-side profile + durable care relationship.                            |
| 13  | `queue_tickets`           | Ephemeral queue ticket (separate from durable care).                         |
| 14  | `hospital_leads`          | Landing-page express-interest captures (no account).                         |
| 15  | `hospital_applications`   | Full pilot application + applicant.                                          |
| 16  | `signup_drafts`           | Server-side multi-step form draft persistence.                               |
| 17  | `sa_audit_log`            | Superadmin god-mode + sensitive-elevation audit (separate from `audit_log`). |

**Two new enums:**

- `public.lifecycle_state` — `unverified | verified | pending_approval | approved | active | rejected | suspended | deactivated`
- `public.facility_level` — `hc_ii | hc_iii | hc_iv | general | regional_referral | national_referral | private | other`

**Phase 0 tables touched only to add columns** (never restructured):

- `public.users` — `+state public.lifecycle_state not null default 'unverified'`

That's the only Phase 0 schema change. Everything else is new tables.

---

## 1. `reference_data_versions`

**Purpose** — provenance log. Every seed batch writes one row. Lets us
swap a dataset (e.g. UBOS 2026 release) by appending a new version
row and re-running the upsert, without losing the audit trail of what
was loaded when.

| Column         | Type        | Notes                                                             |
| -------------- | ----------- | ----------------------------------------------------------------- |
| `id`           | uuid PK     | `default gen_random_uuid()`                                       |
| `dataset`      | text        | e.g. `'ug_districts'`, `'councils'`, `'cadres'`                   |
| `source`       | text        | e.g. `'UBOS NPHC 2024 framework'`                                 |
| `source_url`   | text        | optional canonical URL                                            |
| `version_date` | text        | ISO date string from the upstream release                         |
| `row_count`    | integer     | rows actually inserted in that batch                              |
| `notes`        | text        | free-text caveats (placeholder lists, regulator-name flags, etc.) |
| `applied_at`   | timestamptz | `default now()`                                                   |

**Indexes:** unique `(dataset, version_date)`; index on `(dataset)`.
**RLS:** anon + authenticated SELECT (operational metadata, no PHI). No anon write; service-role mutates via migrations.
**Encrypted fields:** none.
**Audited:** yes (treat as system-of-record).

---

## 2. `regions`

| Column       | Type        | Notes                          |
| ------------ | ----------- | ------------------------------ |
| `id`         | uuid PK     | fixed in seed for FK stability |
| `code`       | text        | unique, e.g. `'CENTRAL'`       |
| `name`       | text        | display name                   |
| `created_at` | timestamptz | `default now()`                |

**Indexes:** unique `(code)`.
**RLS:** anon + authenticated SELECT (forms hit this pre-auth).
**Encrypted fields:** none. **Audited:** yes.

---

## 3. `districts`

| Column       | Type        | Notes                                                                                |
| ------------ | ----------- | ------------------------------------------------------------------------------------ |
| `id`         | uuid PK     | fixed UUIDs in seed (so FKs from `patient_profiles` etc. are stable across re-seeds) |
| `region_id`  | uuid FK     | `→ regions.id ON DELETE RESTRICT`                                                    |
| `code`       | text        | unique; UBOS code if available, else slug                                            |
| `name`       | text        | display name                                                                         |
| `is_city`    | boolean     | `default false`; true for the 11 cities elevated to district-equivalent              |
| `created_at` | timestamptz | `default now()`                                                                      |

**Indexes:** unique `(code)`, index on `(region_id)`, index on `(name)` for prefix-search.
**RLS:** anon + authenticated SELECT.
**Encrypted fields:** none. **Audited:** yes.

---

## 4. `subcounties`

| Column        | Type        | Notes                              |
| ------------- | ----------- | ---------------------------------- |
| `id`          | uuid PK     | fixed in seed                      |
| `district_id` | uuid FK     | `→ districts.id ON DELETE CASCADE` |
| `code`        | text        | unique within district             |
| `name`        | text        | display name                       |
| `created_at`  | timestamptz | `default now()`                    |

**Indexes:** unique `(district_id, code)`, index on `(district_id)`.
**RLS:** anon + authenticated SELECT.
**Encrypted fields:** none. **Audited:** yes.

---

## 5. `councils`

| Column         | Type        | Notes                                                               |
| -------------- | ----------- | ------------------------------------------------------------------- |
| `id`           | uuid PK     | fixed in seed                                                       |
| `code`         | text        | unique, e.g. `'UMDPC'`, `'UNMC'`, `'AHPC'`, `'PHARM_BOARD'`         |
| `name`         | text        | full official name                                                  |
| `short_name`   | text        | display abbreviation                                                |
| `register_url` | text        | optional public register URL (used for the verifier reference link) |
| `description`  | text        | "Regulates doctors and dentists." etc.                              |
| `created_at`   | timestamptz | `default now()`                                                     |

**Seed (per kickoff D4):** UMDPC, UNMC, AHPC, **Pharmacy Board**.
**Indexes:** unique `(code)`.
**RLS:** anon + authenticated SELECT.
**Encrypted fields:** none. **Audited:** yes.

---

## 6. `cadres`

| Column        | Type        | Notes                                                       |
| ------------- | ----------- | ----------------------------------------------------------- |
| `id`          | uuid PK     | fixed in seed                                               |
| `council_id`  | uuid FK     | `→ councils.id ON DELETE RESTRICT`                          |
| `code`        | text        | unique, e.g. `'MEDICAL_OFFICER'`, `'NURSE'`, `'PHARMACIST'` |
| `name`        | text        | display name                                                |
| `description` | text        | optional                                                    |
| `sort_order`  | integer     | for menu ordering within a council                          |
| `created_at`  | timestamptz | `default now()`                                             |

**Indexes:** unique `(code)`, index on `(council_id)`.
**RLS:** anon + authenticated SELECT.
**Encrypted fields:** none. **Audited:** yes.

---

## 7. `cadre_grades`

> Captures within-cadre career grades — e.g. for nurses: _enrolled_
> vs _registered_ vs _specialist_; for medical officers: _MO_ vs _MO
> special grade_ vs _consultant_ vs _senior consultant_. Optional on
> staff_affiliations (some cadres don't grade).

| Column       | Type        | Notes                                             |
| ------------ | ----------- | ------------------------------------------------- |
| `id`         | uuid PK     | fixed in seed                                     |
| `cadre_id`   | uuid FK     | `→ cadres.id ON DELETE CASCADE`                   |
| `code`       | text        | e.g. `'ENROLLED'`, `'REGISTERED'`, `'SPECIALIST'` |
| `name`       | text        | display name                                      |
| `sort_order` | integer     | rank within cadre (lower = earlier career)        |
| `created_at` | timestamptz | `default now()`                                   |

**Indexes:** unique `(cadre_id, code)`, index on `(cadre_id)`.
**RLS:** anon + authenticated SELECT.
**Encrypted fields:** none. **Audited:** yes.

---

## 8. `specialties`

> Self-referential so Internal Medicine can hold Cardiology /
> Nephrology / Endocrinology etc. as children — matches the Phase
> 0.11 hospital_departments seed shape.

| Column       | Type        | Notes                                                                |
| ------------ | ----------- | -------------------------------------------------------------------- |
| `id`         | uuid PK     | fixed in seed                                                        |
| `code`       | text        | unique, e.g. `'IM'`, `'CARDIO'`, `'NEPHRO'`                          |
| `name`       | text        | display name                                                         |
| `parent_id`  | uuid FK     | nullable, `→ specialties.id ON DELETE SET NULL` (sub-specialty edge) |
| `created_at` | timestamptz | `default now()`                                                      |

**Indexes:** unique `(code)`, index on `(parent_id)`.
**RLS:** anon + authenticated SELECT.
**Encrypted fields:** none. **Audited:** yes.

---

## 9. `roles`

> A _position_ within a department, tied to a cadre and (optionally)
> a specialty. E.g. _Consultant Physician — Endocrinology_ (cadre =
> Consultant, specialty = Endocrinology, department_family = IM).
> Filtered by cadre + specialty in the affiliation form.

| Column              | Type        | Notes                                                              |
| ------------------- | ----------- | ------------------------------------------------------------------ |
| `id`                | uuid PK     | fixed in seed                                                      |
| `cadre_id`          | uuid FK     | `→ cadres.id ON DELETE RESTRICT`                                   |
| `specialty_id`      | uuid FK     | nullable, `→ specialties.id ON DELETE SET NULL`                    |
| `code`              | text        | unique, e.g. `'CONSULTANT_IM_CARDIO'`                              |
| `name`              | text        | display name (`"Consultant Physician — Cardiology"`)               |
| `department_family` | text        | e.g. `'INTERNAL_MEDICINE'` — used to filter when hospital selected |
| `sort_order`        | integer     | menu ordering                                                      |
| `created_at`        | timestamptz | `default now()`                                                    |

**Indexes:** unique `(code)`, index on `(cadre_id)`, index on `(specialty_id)`, index on `(department_family)`.
**RLS:** anon + authenticated SELECT.
**Encrypted fields:** none. **Audited:** yes.

---

## 10. `clinician_profiles`

> 1:1 with `auth.users` for clinical staff. Holds the verification
> anchor (council registration #) + the uploaded licence. Council
> verification happens in the approval Edge Function (GATE F); state
> field reflects the verification outcome.

| Column                  | Type        | Notes                                                                       |
| ----------------------- | ----------- | --------------------------------------------------------------------------- |
| `id`                    | uuid PK     | references `auth.users(id) ON DELETE CASCADE` (1:1 with user)               |
| `council_id`            | uuid FK     | `→ councils.id ON DELETE RESTRICT`                                          |
| `registration_number`   | text        | plaintext — must be queryable for council verification (this IS the anchor) |
| `registration_expiry`   | date        | optional — practising certificate expiry                                    |
| `licence_document_path` | text        | path on private Supabase Storage bucket `clinician-licences`                |
| `verified_at`           | timestamptz | nullable — set when an approver verifies against the council register       |
| `verified_by`           | uuid FK     | nullable, `→ auth.users(id) ON DELETE SET NULL`                             |
| `created_at`            | timestamptz | `default now()`                                                             |
| `updated_at`            | timestamptz | `default now()` + `set_updated_at` trigger                                  |

**Indexes:** unique `(council_id, registration_number)` — no two users can claim the same registration; index on `(verified_at)`.
**RLS:**

- `SELECT` own (`id = auth.uid()`) + superadmin + scoped hospital_admin (any user with a pending/active affiliation at their hospital).
- `INSERT` own; service-role for verification updates only.
- `UPDATE` service-role only (the verifier flips `verified_at`/`verified_by`; the user can never).
  **Encrypted fields:** none — registration_number must be queryable by the verifier; not PHI.
  **Audited:** yes (every verification + edit attempt).
  **Storage bucket:** `clinician-licences` (private, 5 MB / PDF/JPG/PNG; RLS scoped owner + scoped hospital_admin + superadmin).

---

## 11. `staff_affiliations`

> The per-affiliation row. Permissions attach here, **not** to the
> user — a user can hold one `active` affiliation at hospital A and
> one `pending_approval` at hospital B simultaneously. Each gets its
> own approval cycle.

| Column             | Type                     | Notes                                             |
| ------------------ | ------------------------ | ------------------------------------------------- |
| `id`               | uuid PK                  | `default gen_random_uuid()`                       |
| `user_id`          | uuid FK                  | `→ auth.users(id) ON DELETE CASCADE`              |
| `hospital_id`      | uuid FK                  | `→ hospitals.id ON DELETE CASCADE`                |
| `department_id`    | uuid FK                  | `→ hospital_departments.id ON DELETE RESTRICT`    |
| `cadre_id`         | uuid FK                  | `→ cadres.id ON DELETE RESTRICT`                  |
| `cadre_grade_id`   | uuid FK                  | nullable, `→ cadre_grades.id ON DELETE SET NULL`  |
| `role_id`          | uuid FK                  | `→ roles.id ON DELETE RESTRICT`                   |
| `specialty_id`     | uuid FK                  | nullable, `→ specialties.id ON DELETE SET NULL`   |
| `employment_type`  | text CHECK               | `IN ('full_time', 'visiting', 'locum')`           |
| `state`            | `public.lifecycle_state` | `default 'pending_approval'`                      |
| `rejection_reason` | text                     | nullable; required when state moved to `rejected` |
| `approved_by`      | uuid FK                  | nullable, `→ auth.users(id) ON DELETE SET NULL`   |
| `approved_at`      | timestamptz              | nullable                                          |
| `created_at`       | timestamptz              | `default now()`                                   |
| `updated_at`       | timestamptz              | `default now()` + `set_updated_at` trigger        |

**Indexes:** unique `(user_id, hospital_id, department_id, role_id)`; index on `(user_id)`; index on `(hospital_id, state)` for the hospital-admin approval queue.
**RLS:**

- `SELECT` own + hospital_admin for that hospital + superadmin.
- `INSERT` own (`user_id = auth.uid()`).
- `UPDATE` service-role only — state transitions flow through the approval Edge Function (GATE F).
  **Encrypted fields:** none — affiliation metadata isn't PHI.
  **Audited:** yes (every transition is the legal proof of when a clinician got clinical access).

---

## 12. `patient_profiles`

> 1:1 with `auth.users` for patients. Holds the durable demographic
> profile + the _care relationship_ (which facility the patient
> considers their primary). The care relationship is a soft pointer
> — formal care-team membership is established clinician-side in a
> later phase.

| Column                 | Type        | Notes                                                                                                                                      |
| ---------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                   | uuid PK     | `references auth.users(id) ON DELETE CASCADE` (1:1)                                                                                        |
| `patient_code`         | text        | unique, DB-issued `MS-YYYY-NNNNN` via `issue_patient_code()` function                                                                      |
| `title_code`           | text        | nullable enum (`'mr' \| 'ms' \| 'mrs' \| 'dr' \| 'other'`)                                                                                 |
| `first_name_encrypted` | text        | AES-256-GCM ciphertext; plaintext name lives on `public.users.full_name` already (Phase 0 trigger) but PHI copy here for clinical surfaces |
| `surname_encrypted`    | text        | AES-256-GCM ciphertext                                                                                                                     |
| `sex`                  | text CHECK  | `IN ('female', 'male', 'other')`                                                                                                           |
| `date_of_birth`        | date        | non-null                                                                                                                                   |
| `id_type`              | text CHECK  | `IN ('nin', 'passport', 'none')`                                                                                                           |
| `id_number_encrypted`  | text        | nullable iff `id_type='none'`; AES-256-GCM ciphertext                                                                                      |
| `phone_encrypted`      | text        | AES-256-GCM (plaintext on `users.phone` for SMS routing)                                                                                   |
| `district_id`          | uuid FK     | `→ districts.id ON DELETE RESTRICT`                                                                                                        |
| `subcounty_id`         | uuid FK     | `→ subcounties.id ON DELETE RESTRICT`                                                                                                      |
| `village_address`      | text        | nullable free-text (encrypted)                                                                                                             |
| `preferred_language`   | text        | nullable, free-form (ISO 639 or display label)                                                                                             |
| `primary_facility_id`  | uuid FK     | nullable, `→ hospitals.id ON DELETE SET NULL` — durable care relationship                                                                  |
| `known_conditions`     | text[]      | nullable; multi-select of seeded common NCDs (Phase 1.5 catalog)                                                                           |
| `nok_name_encrypted`   | text        | nullable (encrypted)                                                                                                                       |
| `nok_relationship`     | text        | nullable, seeded enum                                                                                                                      |
| `nok_phone_encrypted`  | text        | nullable (encrypted)                                                                                                                       |
| `created_at`           | timestamptz | `default now()`                                                                                                                            |
| `updated_at`           | timestamptz | `default now()` + `set_updated_at` trigger                                                                                                 |

**Constraints:** CHECK `(id_type = 'none' AND id_number_encrypted IS NULL) OR (id_type <> 'none' AND id_number_encrypted IS NOT NULL)`.
**Indexes:** unique `(patient_code)`; index on `(district_id)`; index on `(primary_facility_id)`.
**RLS:**

- `SELECT` own + superadmin. (Hospital_admin / care-team read access is Phase 1.5 once formal care-team membership exists; not in this proposal.)
- `INSERT/UPDATE` own.
  **Encrypted fields:** first_name, surname, id_number, phone, village_address, nok_name, nok_phone (all via `lib/encryption.ts` BEFORE the row is written).
  **Audited:** yes.

---

## 13. `queue_tickets`

> **Ephemeral** — a join-the-queue ticket the patient gets after
> selecting facility + department from the dashboard. Distinct from
> the durable care relationship on `patient_profiles.primary_facility_id`.
> Lives in this onboarding-adjacent doc because the kickoff §B1 step 6
> defines it; the _issuing UI_ is a dashboard action shipped in
> [GATE C], not part of the signup form itself.

| Column          | Type        | Notes                                                               |
| --------------- | ----------- | ------------------------------------------------------------------- |
| `id`            | uuid PK     | `default gen_random_uuid()`                                         |
| `patient_id`    | uuid FK     | `→ auth.users(id) ON DELETE CASCADE`                                |
| `hospital_id`   | uuid FK     | `→ hospitals.id ON DELETE CASCADE`                                  |
| `department_id` | uuid FK     | nullable, `→ hospital_departments.id ON DELETE SET NULL`            |
| `service`       | text        | nullable, free-text service requested                               |
| `ticket_code`   | text        | unique short code shown to the patient (e.g. `'A-042'`)             |
| `state`         | text CHECK  | `IN ('waiting', 'called', 'in_progress', 'completed', 'cancelled')` |
| `issued_at`     | timestamptz | `default now()`                                                     |
| `closed_at`     | timestamptz | nullable                                                            |
| `expires_at`    | timestamptz | nullable — purge tickets older than N days via cron                 |

**Indexes:** unique `(hospital_id, ticket_code)`; index on `(patient_id)`; index on `(hospital_id, state, issued_at)` for the queue-board view.
**RLS:**

- Patient `SELECT/INSERT` own.
- `UPDATE` (state transitions) by clinical staff at that hospital (via Edge Function) + superadmin.
  **Encrypted fields:** none (ephemeral, no PHI; clinical context lives elsewhere).
  **Audited:** yes — state transitions are an operational paper trail.

---

## 14. `hospital_leads`

> Landing-page lead capture, **no account created**. Superadmin reads
>
> - decides whether to invite to full apply. Lighter footprint than
>   `hospital_applications`.

| Column           | Type                    | Notes                                                            |
| ---------------- | ----------------------- | ---------------------------------------------------------------- |
| `id`             | uuid PK                 | `default gen_random_uuid()`                                      |
| `hospital_name`  | text                    | as typed                                                         |
| `facility_level` | `public.facility_level` | required                                                         |
| `ownership`      | text CHECK              | `IN ('public_moh', 'private', 'pnfp', 'private_clinic')`         |
| `district_id`    | uuid FK                 | `→ districts.id ON DELETE RESTRICT`                              |
| `contact_name`   | text                    | required                                                         |
| `contact_role`   | text                    | required, seeded role enum                                       |
| `contact_email`  | text                    | required (lower-cased)                                           |
| `contact_phone`  | text                    | required                                                         |
| `notes`          | text                    | optional free-text                                               |
| `source`         | text                    | which CTA fired (e.g. `'announcement-bar'`, `'final-cta'`)       |
| `state`          | text CHECK              | `IN ('new', 'contacted', 'invited', 'archived')` `default 'new'` |
| `created_at`     | timestamptz             | `default now()`                                                  |

**Indexes:** index on `(state, created_at)`; index on `(contact_email)`.
**RLS:**

- anon `INSERT` (landing form runs unauthenticated). Rate-limited via the existing Phase 0 rate limiter pattern (or a fresh one if none exists — flag for confirmation).
- `SELECT` superadmin only.
- `UPDATE` superadmin only (mark contacted / invited / archived).
  **Encrypted fields:** none. Lead contact info is PII (logger redacts) but not PHI — no clinical data here.
  **Audited:** yes (lead-state transitions are a sales trail).

---

## 15. `hospital_applications`

> Full pilot application. Separate from `public.hospitals` so the
> approved-facilities table stays a clean lookup. On superadmin
> approval (GATE F), a row is created in `public.hospitals` and the
> applicant's `user_roles` is elevated to `hospital_admin` scoped to
> the new hospital.

| Column                        | Type                     | Notes                                                               |
| ----------------------------- | ------------------------ | ------------------------------------------------------------------- |
| `id`                          | uuid PK                  | `default gen_random_uuid()`                                         |
| `applicant_user_id`           | uuid FK                  | `→ auth.users(id) ON DELETE CASCADE`; one application per applicant |
| `hospital_name`               | text                     | required                                                            |
| `facility_level`              | `public.facility_level`  | required                                                            |
| `ownership`                   | text CHECK               | `IN ('public_moh', 'private', 'pnfp', 'private_clinic')`            |
| `registration_number`         | text                     | required — official licence/registration identifier                 |
| `registration_authority`      | text                     | optional — e.g. `'MoH Facility List'`                               |
| `district_id`                 | uuid FK                  | `→ districts.id ON DELETE RESTRICT`                                 |
| `subcounty_id`                | uuid FK                  | nullable, `→ subcounties.id ON DELETE RESTRICT`                     |
| `physical_address`            | text                     | required free-text                                                  |
| `institutional_email_domain`  | text                     | required — verification signal (e.g. `'mulago.go.ug'`)              |
| `applicant_role`              | text                     | required, seeded role enum                                          |
| `authorisation_document_path` | text                     | path on private Storage bucket `hospital-authorisations`            |
| `state`                       | `public.lifecycle_state` | `default 'pending_approval'`                                        |
| `rejection_reason`            | text                     | nullable; required on `rejected`                                    |
| `reviewed_by`                 | uuid FK                  | nullable, `→ auth.users(id) ON DELETE SET NULL`                     |
| `reviewed_at`                 | timestamptz              | nullable                                                            |
| `approved_hospital_id`        | uuid FK                  | nullable, `→ hospitals.id ON DELETE SET NULL` (set on approve)      |
| `created_at`                  | timestamptz              | `default now()`                                                     |
| `updated_at`                  | timestamptz              | `default now()` + `set_updated_at` trigger                          |

**Indexes:** unique `(applicant_user_id)`; index on `(state, created_at)`; index on `(district_id)`.
**RLS:**

- `SELECT/INSERT` own. `UPDATE` own only while `state='pending_approval'` (re-apply after rejection by editing the row).
- `SELECT` superadmin (all).
- `UPDATE` to `approved`/`rejected` is service-role only (Edge Function).
  **Encrypted fields:** none — institutional data, not PHI.
  **Audited:** yes.
  **Storage bucket:** `hospital-authorisations` (private, 5 MB / PDF/JPG/PNG; superadmin + owner read).

---

## 16. `signup_drafts`

> Server-side persistence for multi-step forms. PHI fields inside
> `payload` are encrypted via `lib/encryption.ts` BEFORE being put in
> the JSONB blob. TTL'd to 14 days; cleanup cron in GATE G.

| Column         | Type        | Notes                                                                         |
| -------------- | ----------- | ----------------------------------------------------------------------------- |
| `id`           | uuid PK     | `default gen_random_uuid()`                                                   |
| `draft_kind`   | text CHECK  | `IN ('patient', 'clinical', 'hospital')`                                      |
| `owner_key`    | text        | lowercase email pre-account, or `auth.uid()` once an account exists           |
| `access_token` | text        | nullable; server-issued rotating token for pre-account resume (signed cookie) |
| `payload`      | jsonb       | step-by-step form state (PHI fields encrypted before write)                   |
| `current_step` | text        | last-reached step name for UI restore                                         |
| `created_at`   | timestamptz | `default now()`                                                               |
| `updated_at`   | timestamptz | `default now()` + `set_updated_at` trigger                                    |
| `expires_at`   | timestamptz | `default now() + interval '14 days'`                                          |

**Indexes:** unique `(draft_kind, owner_key)`; index on `(expires_at)` for the cleanup cron.
**RLS:**

- Authenticated `SELECT/INSERT/UPDATE/DELETE` own (`owner_key = auth.uid()::text`).
- Pre-account access is service-role-only (the access_token in a signed cookie is the app-side auth; no anon RLS path).
  **Encrypted fields:** payload contents handled by the application (PHI fields encrypted before insert); column itself is opaque JSONB.
  **Audited:** no — transient form state, not system-of-record. Auditing per-keystroke would balloon `audit_log` with no forensic value.

---

## 17. `sa_audit_log`

> Separate from `public.audit_log` (which captures every CRUD via the
> generic trigger). This one is the **high-visibility** superadmin
> log: every god-mode cross-tenant read, every elevation to admin,
> every approval, every creation of another superadmin. PDPO/DPIA
> auditors will scrutinise this first.

| Column        | Type        | Notes                                                                         |
| ------------- | ----------- | ----------------------------------------------------------------------------- |
| `id`          | bigint PK   | `generated by default as identity`                                            |
| `actor_id`    | uuid FK     | non-null, `→ auth.users(id) ON DELETE SET NULL`                               |
| `action`      | text        | e.g. `'cross_tenant_read'`, `'approve_hospital'`, `'elevate_admin'`,          |
|               |             | `'create_superadmin'`, `'reject_hospital'`, `'cross_tenant_export'`           |
| `target_kind` | text        | e.g. `'hospital'`, `'user'`, `'staff_affiliation'`, `'patient_profile'`       |
| `target_id`   | text        | string-form id of the target row                                              |
| `reason`      | text        | required free-text — the superadmin MUST give a reason for cross-tenant reads |
| `request_id`  | uuid        | optional, threads to `app.request_id` GUC                                     |
| `ip_address`  | inet        | nullable, captured at the Edge Function entry                                 |
| `user_agent`  | text        | nullable                                                                      |
| `before_data` | jsonb       | nullable                                                                      |
| `after_data`  | jsonb       | nullable                                                                      |
| `timestamp`   | timestamptz | `default now()`                                                               |

**Constraints:** append-only — `BEFORE UPDATE OR DELETE` trigger raises (same pattern as `audit_log` in 0003). `REVOKE UPDATE, DELETE` from anon/authenticated/service_role.
**Indexes:** index on `(timestamp)`; index on `(actor_id)`; index on `(target_kind, target_id)`.
**RLS:** `SELECT` superadmin only. `INSERT` service-role only (Edge Functions write here directly).
**Encrypted fields:** none (forensic log; reason field is operational, not PHI).
**Audited:** no — auditing the audit table would recurse.

---

## Edge Functions added (named here; built in their gates)

Each follows the Phase 0 pattern: `_shared/` helpers → Zod input → `getUser()` → role check → action → PII-redacted log → audit/sa_audit entry → typed response. Idempotency keys on writes where the operation is replayable.

| Function                       | Gate | Purpose                                                                                                       |
| ------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------- |
| `submit-patient-signup`        | C    | OTP-verify phone → create `patient_profile` + `consent_record` → state→active.                                |
| `submit-clinical-identity`     | D    | Persist `clinician_profiles` row + upload anchor to storage.                                                  |
| `submit-staff-affiliation`     | D    | Append a `staff_affiliations` row at `pending_approval`.                                                      |
| `submit-hospital-lead`         | E    | Anon-callable; rate-limited; insert into `hospital_leads`.                                                    |
| `submit-hospital-application`  | E    | Insert `hospital_applications` row + storage upload.                                                          |
| `approve-staff-affiliation`    | F    | Hospital_admin/superadmin only; transitions affiliation pending→active; lifts user state if needed; audit.    |
| `reject-staff-affiliation`     | F    | Same auth; transitions to rejected with reason.                                                               |
| `approve-hospital-application` | F    | Superadmin only; inserts `hospitals` row, elevates applicant to hospital_admin, sa_audit.                     |
| `reject-hospital-application`  | F    | Superadmin only; reason required; sa_audit.                                                                   |
| `create-superadmin`            | F    | Existing superadmin only; sa_audit at high visibility.                                                        |
| `cross-tenant-read`            | F    | Helper Edge Function any superadmin must call to read another hospital's data; writes sa_audit with `reason`. |

---

## Open questions — answer these and I'll start the migrations

### Open Q1 — D4 catalog scope

The kickoff §D4 asks me to recommend a default. My recommendation:

> **Seed the _full national_ council + cadre + cadre_grades + specialties
> catalog now**, but **seed role _instances_ scoped to Internal Medicine
> only** (matching the Phase 0.11 `hospital_departments` seed). New roles
> land per department as MedSync activates them.

**Why:** councils + cadres + specialties are finite and used for
verification across every signup the moment we go live. Roles are
department-shaped and expanding the full national role catalog now
adds rows we won't use for a year.

**Confirm or override.** If you want the full national role catalog
shipped now, say so and I'll expand the seed scope (will add a few
hundred more rows to `roles` but no architectural change).

### Open Q2 — UBOS dataset

Per §D1 the count is source- and date-dependent. Two candidates:

| Option                                           | Count                               | Notes                                                                                               |
| ------------------------------------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| **UBOS NPHC 2024 framework** (census basis)      | 135 districts + 11 cities           | Most recent. Cleanest mapping if NPHC 2024 area profiles are the publishing pipeline going forward. |
| **UBOS administrative units list** (operational) | ~146 districts + ~2,184 subcounties | Broader, captures recent administrative splits the NPHC framework didn't yet absorb.                |

**Pick one.** Whichever you pick, I'll record it in
`reference_data_versions` and write the seed as an idempotent
`INSERT … ON CONFLICT (code) DO NOTHING` so re-runs with a later
release just add the diff.

### Open Q3 — `patient_profiles` PHI encryption breadth

The current proposal encrypts: `first_name`, `surname`, `id_number`,
`phone`, `village_address`, `nok_name`, `nok_phone`.

Question: do you want me to **also** encrypt `date_of_birth`?
Trade-off — encrypting DOB rules out age-range queries (which we'd
need for clinical-population analytics). I default to **plaintext DOB**
for that reason, but the UDPP could argue DOB is PHI. **Confirm.**

### Open Q4 — landing-page lead form (`hospital_leads`) anon write rate-limiting

There's no existing Phase 0 rate-limiter on anon `INSERT`s. Options:

1. **Add a per-IP rate limit at the Edge Function layer** (Upstash Redis or in-memory token bucket).
2. **Cloudflare Turnstile** on the form (privacy-first, no JS heuristic).
3. **Both** (defence in depth).

I default to **#2 only** (lighter ops surface). **Confirm or override.**

### Open Q5 — `consent_records` integration

Phase 0 already has `consent_records`. The patient signup (§B1.3)
writes one entry per signup with the current consent version. Do you
want me to:

1. **Reuse `consent_records` as-is** (write one row per signup,
   `version_date` = whenever legal-approved text lands), or
2. **Add a `consent_versions` lookup table** so versions are first-
   class objects (text + effective_date + supersedes_id)?

I default to **#2** because regulators will eventually ask "show me
the exact text the patient agreed to on 2026-05-23" — a lookup table
makes that one query. **Confirm or override.**
