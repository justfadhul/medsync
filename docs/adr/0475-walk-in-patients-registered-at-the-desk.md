# ADR 0475 — Walk-in patients registered at the desk, with no login account

**Status:** Proposed — 2026-11-12, for the owner (CSO). Built on `feat/reception-walk-in-register` (migration 0291,
Edge Function `ha-register-patient`). New wording is draft (`content/desk-register.ts`).

**Builds on** [ADR 0089](0089-gate-d-identity-and-lifecycle.md) (provisional identities, one writer of a
reconciliation), [ADR 0119](0119-onboarding-v2-one-page-per-form.md) (patient sign-up), [ADR 0161](0161-pop-ups-are-centred-landscape-dialogs.md) (pop-ups).

## Context

A walk-in with no MedSync account could not be registered at the desk. `/reception/intake` found patients by patient
code only, "Unknown / John Doe" exists only for the emergency chips, and "Register new →" on Confirm identity led back
to the same form. The pilot clinics (about 5 private clinics, web first) see such people on day one.

Every table that names a patient — `patient_profiles`, `appointments`, `patient_intakes`, `queue_entries`,
`encounters` and the EMR — keys on `auth.users.id`. Patient sign-up creates that row with an email and a password.

## Decision

### The record

A desk-registered patient is an **ordinary `patient_profiles` row on an `auth.users` row with no credential**:

- no password, no phone on the auth row, and an undeliverable address `desk-<uuid>@patients.medsync.invalid`
  (`.invalid` is reserved, RFC 2606, so no confirmation, magic link or reset can ever arrive);
- `app_metadata = { desk_registered: true, desk_hospital_id, registered_by }`;
- the profile holds sign-up's fields (names, sex, date of birth, phone, place, village; ID type `none`), encrypted the
  same way, with the phone's blind index, and **primary facility = this hospital**. The code comes from
  `issue_patient_code()` like every other.

Because the id is a real auth user id, the walk-in is booked, checked in, triaged and seen **exactly like an account
patient**: no table, query or Edge Function changes. Nobody can sign in as the record.

### The flow

The desk opens **Register new patient** (a centred `EditorDialog`) from the front door's code search, from Confirm
identity, or from Book. It asks sign-up's questions with sign-up's rules (`deskPatientSchema` shares the field
definitions and the date-of-birth rule with `patientSchema`), without email or password, and shows sign-up's notice.

`ha-register-patient`:

1. `getCaller` (with the MFA check, migration 0288), then `authoriseAtHospital`.
2. **The duplicate check, before anything is created:** `desk_patient_candidates()` returns this hospital's patients
   (primary facility here, or a booking or intake here) with the same phone blind index, or born the same year. The
   function decrypts the names and keeps those with **the same phone, or the same name and year of birth** — the
   words reconciliation already uses (`_shared/identity-match.ts`, moved from `lib/reception/reconcile-basis.ts`).
   The rule is a superset of "same name and date of birth": a day or month typed wrong still matches. Any match is
   returned instead of a new record, each name shown is logged in `clinical_phi_access_log`
   (`reception_register_duplicates#operational_today`), and the dialog offers **Use this record** or **None of these
   is them: register new**. The second resubmits with those codes, and they are written to the audit row.
3. Create the auth user, then `desk_register_patient()` in one transaction: the profile, the consent record, the
   user's state (`verified`, as sign-up) and the `register_patient` audit row. If it fails, the auth user is deleted.

### Consent

The same notice, version and hash as sign-up, stored the same way: a `consent_records` row, `data_processing`, for
the patient. Migration 0291 adds `recorded_by_user_id`: the staff member who recorded an agreement given at the desk
(NULL = the person ticked it themself). The box reads, as a **draft for the owner and the lawyer**: "I read or showed
this notice to the patient, and they agreed to it. My name is recorded with their agreement." No legal text is new.

### Server enforcement

- The Edge Function is the only creator; the two SQL functions are `service_role` only (revoked from `anon` and
  `authenticated`) and check again that the actor is active staff or the admin at that hospital. A superadmin is
  refused (migration 0289: the superadmin is off patient data).
- `desk_register_patient()` refuses a child (under 18, as sign-up — DPPA s.8), a notice whose version and hash do not
  match `consent_versions`, and any auth user that the desk did not make (`desk_registered` must be true), so a
  profile can never be attached to someone's real login.
- Creation is audited in `sa_audit_log` (`register_patient`, target `patient_profile`, after-data: hospital, code,
  notice version, the matches the desk set aside). 0291 re-issues `sa_audit_log_action_check` as 0091's list plus
  `register_patient`; **any later migration that re-issues it must keep that value.**

### Taking the record over later (designed, not built)

When the person later signs up with the same phone, they should end up with **one** record, the desk's. Because the
record is already an auth user, taking it over is giving that user a credential — no data moves and no ids change:

1. Sign-up looks for a desk record (`desk_registered`) with the same phone blind index **and** the same name and date
   of birth.
2. A match alone is not proof: sign-up does not verify the phone, and a name, date of birth and phone number are not
   secret. So the takeover needs a **claim code**: a one-time code the desk gives at registration (printed or read
   out, or by SMS when SMS is live), stored hashed with an expiry; or, without one, the desk issues a new code after
   checking the person in front of it.
3. With the code, the server sets the email and password on the desk's auth user
   (`auth.admin.updateUserById`), sends the usual confirmation, clears `desk_registered`, sets `claimed_at`, and
   records the person's own acceptance of the notice (the unique `(user, type, version)` index means the desk's row
   for that version stands as the record; the self-acceptance needs a new version or a `claimed` column — to decide).
4. Without a code, sign-up proceeds as today and tells the person to ask the clinic to link their record. Merging two
   existing records is a clinical-record correction and stays out of scope (ADR 0089).

**Follow-up:** build steps 1–4 (a small migration for the claim code; a branch in `submitPatientSignup`; a desk
button "Give a claim code"; an audit verb). Until then, a desk patient who signs up gets a second record, as any
patient who forgets they have an account does today. The password-reset work must never set a password on a
`desk_registered` user by email or phone alone.

## Consequences

- A walk-in can be registered, booked and checked in in one sitting. The front door picks the new record into the
  form; Confirm identity adds it as a card to Confirm (still one press, still `ha-reconcile-identity`); Book goes
  straight to booking for it.
- `auth.users` holds rows that are not logins. Anything that lists users (superadmin screens, counts) should treat
  `app_metadata.desk_registered` as "patient record, no account". `public.users.full_name` holds the name, as for
  sign-up.
- The duplicate check sees only this hospital's patients. A person with a MedSync account who has never been booked
  here, and has no code with them, is not found and gets a second record. Owner question: should the check also say
  "this phone has a MedSync account elsewhere — ask for their code", without a name? That reveals that a number is on
  MedSync to any desk, so it is not built.
- Children cannot be registered at the desk (refused, draft wording). A parent's or guardian's consent is a legal
  question (`docs/legal/REVIEW.md`).
- No rate limit beyond the audit; add one if a desk account is ever abused.

## Alternatives considered

- **A patient record without an auth user** (drop the FK, a new id space) — every patient table and query keys on
  `auth.users.id`; a second id space is a large, risky migration across the EMR. Rejected.
- **Keep the walk-in as a provisional identity** — a provisional cannot be checked in (ADR 0089: the queue needs a
  patient) and has no patient code. Rejected.
- **An auth user with the patient's phone on it** — a later phone sign-in would open the record with no step the desk
  or the patient chose; and the desk-typed number may be wrong. Rejected for the claim code.
- **Create from a Next server action with the service key** — the brief asks for the Edge Function with `getCaller`
  and MFA, and the other privileged writes live there.
