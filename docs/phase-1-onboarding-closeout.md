# Phase 1 Onboarding — Closeout

Status: **GATEs A–G shipped**. 6 commits on `feat/onboarding` from
`5b418f3` (Phase 0 baseline) to the GATE G commit. Phase 0 untouched:
**71/71 RLS tests** still pass at every gate; typecheck + lint + build
green throughout.

## What shipped, gate by gate

| Gate | Commit (short) | What landed                                                                             |
| ---- | -------------- | --------------------------------------------------------------------------------------- |
| A    | `03c3215`      | Scaffold + schema proposal (no migrations)                                              |
| A    | `552da2c`      | Migrations 0006–0010 + Drizzle + lib/lifecycle + lib/signup-drafts + lib/reference-data |
| B    | `26ae8dd`      | Shared form primitives + preview surface (`/signup/preview/primitives`)                 |
| C    | `663bd48`      | Patient signup end-to-end (migrations 0011–0012)                                        |
| D    | `f7b8331`      | Clinical staff signup + clinician_profiles + staff_affiliations (migration 0013)        |
| E    | `acf1bdd`      | Hospital application + leads (migration 0014)                                           |
| F    | latest         | Approvals workflow: sa_audit_log + 4 Edge Functions + admin queue (migration 0015)      |
| G    | latest         | Closeout: drafts-cleanup cron + Storage bucket provisioning + this doc (migration 0016) |

## Schema added

**Phase 0 untouched** — the only structural change to a Phase 0 table is
`users.state` (column add only, never restructured).

| Migration | Table(s) added                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 0006      | `consent_versions`                                                                                                             |
| 0007      | `lifecycle_state` + `facility_level` enums; `users.state` column                                                               |
| 0008      | `reference_data_versions`, `regions`, `districts`, `subcounties`, `councils`, `cadres`, `cadre_grades`, `specialties`, `roles` |
| 0009      | Seed for the above                                                                                                             |
| 0010      | `signup_drafts`                                                                                                                |
| 0011      | `patient_profiles` + `issue_patient_code()` function                                                                           |
| 0012      | `consent_versions` v1.0 row for `data_processing` (placeholder pending legal)                                                  |
| 0013      | `clinician_profiles`, `staff_affiliations`                                                                                     |
| 0014      | `hospital_leads`, `hospital_applications`                                                                                      |
| 0015      | `sa_audit_log` + append-only triggers                                                                                          |
| 0016      | `clinician-licences` + `hospital-authorisations` Storage buckets + RLS policies                                                |

Every PHI column ships as AES-256-GCM ciphertext encrypted by
`lib/encryption.ts` BEFORE the DB write. Every sensitive table has the
generic `public.audit_log_changes()` trigger attached (writes to
`audit_log` automatically). Every approval transition also writes a
high-visibility entry to `sa_audit_log` with a required `reason`.

## Lifecycle paths shipped

```
unverified
   │
   ▼  (patient signup completes)
verified ─────────────────────┐
   │                          │
   ▼  (staff/hospital path)   │
pending_approval              │
   │                          │
   ▼  (admin approval)        │
approved                      │
   │                          │
   ▼  (MFA enrollment)        │
active ←──────────────────────┘
```

- **Patient**: `unverified → verified` on signup completion (current
  build skips OTP — see "Known follow-ups" below).
- **Clinical staff**: `unverified → pending_approval` on signup. GATE F
  `approve-staff-affiliation` Edge Function transitions to `approved`.
  MFA enrollment (existing `/onboarding/mfa-setup` from Phase 0) is
  the gate to `active`.
- **Hospital applicant**: `unverified → pending_approval` on signup.
  GATE F `approve-hospital-application` transitions to `approved` AND
  creates the `public.hospitals` row + grants the applicant
  `hospital_admin` scoped to the new hospital.

## What's running where

- **`/signup/patient`** — patient flow (3 steps)
- **`/signup/clinical`** — clinical staff flow (4 steps)
- **`/signup/hospital`** — hospital application (4 steps)
- **`/signup/preview/primitives`** — primitives review surface (noindex)
- **`/admin`** — superadmin + hospital_admin approvals queue
- **`/api/cron/cleanup-drafts`** — nightly Vercel Cron sweeper at 02:00 UTC
- **Edge Functions** (`supabase/functions/`):
  - `approve-staff-affiliation`
  - `reject-staff-affiliation`
  - `approve-hospital-application`
  - `reject-hospital-application`

## Operator setup checklist

Before this code can serve real traffic the operator needs to:

1. **Apply migrations**: `npm run db:migrate` against the target DB.
2. **Set `MEDSYNC_PHI_KEY`** in Vercel + `.env.local` (already required
   from Phase 0; failing to set it makes every encrypt() throw).
3. **Set `CRON_SECRET`** in Vercel project env. Generate with
   `openssl rand -hex 32`. The cron route 503s without it.
4. **Apply Storage bucket policies**: migration 0016 inserts the bucket
   rows and policies. Confirm via `supabase storage list` that
   `clinician-licences` and `hospital-authorisations` exist and are
   private (`public: false`).
5. **Deploy Edge Functions**: `supabase functions deploy
approve-staff-affiliation`, then the other three. The admin queue
   surfaces a friendly error if a function is unreachable.
6. **Seed at least one superadmin** so the admin queue is usable: use
   the existing `assign-role` Edge Function with another superadmin
   bootstrapping it, OR run a one-off SQL via the Supabase dashboard:
   `INSERT INTO public.user_roles (user_id, role) VALUES ('<uid>', 'superadmin');`
7. **Replace placeholder consent text** in migration 0012 (or insert a
   new `consent_versions` row with `supersedes_id`) once legal-approved
   text lands. The hash check in every signup action will then bind
   acceptances to the real text.

## Known follow-ups (intentionally deferred)

- **Phone OTP** — patient signup currently goes `unverified → verified`
  on signup completion. The OtpInput primitive is in place; wiring it
  to a real SMS provider (Africa's Talking env vars are reserved in
  `lib/env.ts`) is a production task.
- **UBOS districts/subcounties** — migration 0009 ships a placeholder
  21-district / 5-subcounty stub flagged in
  `reference_data_versions.notes`. Pulling the full NPHC 2024 CSV is
  out-of-scope for the build phase but ships idempotently.
- **Turnstile on hospital_leads** — kickoff Q4 default. Action layer
  is ready; the verify-token integration lands when the Turnstile
  site key is provisioned.
- **Hospital level enum unification** — `hospital_applications.facility_level`
  uses the richer `public.facility_level` enum (8 values); `public.hospitals.level`
  predates and uses 6 string-checked values. The approval Edge Function
  maps between them. Worth unifying in a Phase 1.5 sweep.
- **Async virus scan on Storage uploads** — kickoff §A.6 calls for this.
  Bucket policies enforce MIME + size; antivirus is a follow-up that
  blocks lifecycle transition until the scan returns clean.
- **`cross-tenant-read` Edge Function** — sa_audit_log enum reserves
  `cross_tenant_read`; the function itself lands when the first
  cross-tenant superadmin surface exists (Phase 1.5+).

## Regression evidence

- **Phase 0**: 10/10 test files, 71/71 tests pass at every gate.
- **Typecheck**: clean at every gate.
- **Lint**: clean at every gate.
- **Build**: 19 routes at GATE G (was 14 at Phase 0 baseline).
