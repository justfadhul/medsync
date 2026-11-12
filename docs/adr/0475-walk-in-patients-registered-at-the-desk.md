# ADR 0475 — Walk-in patients registered at the desk, with no login account

**Status:** Proposed — 2026-11-12, for the owner (CSO). Built on `feat/reception-walk-in-register` (migration 0291,
Edge Function `ha-register-patient`). The takeover was built on 2026-11-13 on `feat/desk-record-takeover` (migration
0292, same Edge Function). New wording is draft (`content/desk-register.ts`).

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

### Taking the record over later (built: migration 0292)

When the person later wants an account, they end up with **one** record, the desk's. Because the record is already an
auth user, taking it over is giving that user a credential: no data moves, no id changes, nothing is deleted.

1. **The claim code.** The desk opens **Give a sign-up code** on the front door, types the patient code, and has
   checked it is the person in front of it. `ha-register-patient` (`{ action: "claim_code" }`, same `getCaller` with
   MFA and `authoriseAtHospital`) makes a code of 8 characters that cannot be misread (`ABCD-EFGH`, ~40 bits,
   `_shared/desk-record.ts`) and stores only its blind index (the phone's HMAC, with a label of its own) in
   `desk_claim_codes`. It works once, for 30 days; five wrong tries spend it; a new code replaces the old one.
   `desk_issue_claim_code()` refuses staff of another hospital (the record's primary facility must be the caller's
   hospital), a superadmin, a record already taken over and a login account, and audits `issue_claim_code` (never
   the code). The code is shown once, to write on the patient's slip or read out (by SMS once SMS is live).
2. **The claim.** Sign-up links to `/signup/patient/claim` ("A clinic registered you at its desk? Use the code they
   gave you"). The person gives the **mobile number the desk took and the code**, then an email and password, and
   agrees to the notice. Name, date of birth and place are not asked again: they are the record's own. The phone
   narrows (a family can share one), the code proves and picks the record.
3. **The server** (`submitDeskClaim`, the sign-up pattern: a server action with the service role):
   `desk_claim_begin()` compares blind indexes; a wrong code counts a try against every live code for that phone;
   expired, spent and claimed codes are refused. The right code opens a **5-minute permit**. Then
   `auth.admin.updateUserById` sets the email and password on the desk's auth user (`email_confirm: true`, as
   sign-up auto-confirms today, ADR 0010) and clears `desk_registered`. Then `desk_claim_finish()` checks the auth
   row really changed, marks the code used, records the person's own acceptance, copies the email to `public.users`
   and audits `claim_desk_record` with the patient as actor. The person is signed in, in their own account slot.
4. **Consent.** The unique `(user, type, version)` index keeps one row per notice version. Under the version the
   desk recorded, the desk's row stands and the person's own acceptance is on the claim row
   (`claim_consent_version`, `claim_consent_sha256`, `claimed_at`); under a newer version it is a
   `consent_records` row of its own (`recorded_by_user_id` NULL).
5. **No credential any other way.** A `BEFORE UPDATE` trigger on `auth.users` (`desk_record_guard`) refuses, while
   a row is desk-registered, any change to its password, email, phone or desk flag unless a claim permit is open.
   Password reset (ADR 0474), an admin call or a later bug cannot give a desk record a password. Password reset
   also refuses a desk record before asking Supabase: the request answers as usual and sends nothing, and a desk
   session never reaches the new-password step.
6. **When the claim fails or there is no code.** Nothing is created or changed. The page says why (wrong or
   mismatched phone, expired, too many tries, already has an account) and that the person can come back with a new
   code from the clinic at any time. Ordinary sign-up still works and stays one link away ("No code? Create an
   account without one (a separate record)"): choosing it is the person's own, not a silent duplicate. Sign-up
   does not look for desk records by phone on its own: it would tell anyone typing a number that a clinic
   registered it. Merging two existing records is a clinical-record correction and stays out of scope (ADR 0089).

If `desk_claim_finish()` fails after the credential is set (the database unreachable between two calls), the action
retries once and then logs `desk-claim.finish_failed` with the id: the person has their account, but the code is not
marked used and the `claim_desk_record` audit row is missing until the owner reconciles it. A later claim of that
record is refused as already taken over.

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
- A desk record can only be taken over at the hospital that registered it (the code comes from there). A record
  whose phone or code the desk got wrong cannot be claimed until the desk gives a new code; the phone itself cannot
  be corrected at the desk yet.
- The claim page is rate-limited per address in memory (10 a minute, as the other public sign-up doors). The
  per-phone count of wrong tries is the real cap: five, then the desk gives a new code.
- The phone app has no claim screen; the web page works on a phone.

## Alternatives considered

- **A patient record without an auth user** (drop the FK, a new id space) — every patient table and query keys on
  `auth.users.id`; a second id space is a large, risky migration across the EMR. Rejected.
- **Keep the walk-in as a provisional identity** — a provisional cannot be checked in (ADR 0089: the queue needs a
  patient) and has no patient code. Rejected.
- **An auth user with the patient's phone on it** — a later phone sign-in would open the record with no step the desk
  or the patient chose; and the desk-typed number may be wrong. Rejected for the claim code.
- **Create from a Next server action with the service key** — the brief asks for the Edge Function with `getCaller`
  and MFA, and the other privileged writes live there. (The claim itself is a server action: the person has no
  account to call a function with yet, and sign-up already works that way.)
- **Sign-up links a desk record when phone, name and date of birth match, without a code** — none of the three is
  secret, and sign-up does not verify the phone. Rejected.
- **A code issued with every registration** — most walk-ins never sign up, and a code on every slip is one more thing
  to lose. The desk gives one when the person asks (it can do so right after registering).
- **Code alone (no phone)** — works, but then wrong tries cannot be counted against a record. The phone narrows and
  carries the count.
