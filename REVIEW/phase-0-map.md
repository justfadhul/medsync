# MedSync: Phase 0 system map (2026-11-11)

Tree reviewed: `feat/pharmacy-main-store` @ `75788ff0`. Every commit in it is already in `origin/main`, but it is 17 commits behind the local `origin/main` ref (`d6dde518`), and GitHub has moved on again (`2de1cb3f`). This checkout is missing pharmacy receive and supplies, and migrations 0276–0278.

## 1. Layout and toolchain

- **This is not a workspace monorepo.** The root is one npm package: the Next.js web app plus the Deno Edge Functions in `supabase/functions` (with their own `tsconfig`). `mobile/` is a separate npm app with its own `package-lock.json`. `packages/` is not packages: it holds two loose source folders (`patient-core`, 22 `.ts` files, and `clinical-rules`, one JSON file) that are reached through path aliases and have no `package.json`.
- **Package manager: npm** (`package-lock.json`, lockfileVersion 3). There is no pnpm lockfile, so `pnpm install --frozen-lockfile` cannot run as written.
- **Node: 24** (`.nvmrc`; the local machine runs v24.20.0). There is no `engines` field. The brief assumed Node 22.
- **Web versions, from the lockfile:** next 16.2.6, react 19.2.4, typescript 5.9.3, @supabase/supabase-js 2.106.1, @supabase/ssr 0.10.3, drizzle-orm 0.45.2, drizzle-kit 0.31.10, postgres 3.4.9, zod 4.4.3, tailwindcss 4.3.0, vitest 4.1.7, @sentry/nextjs 10.53.1, @vercel/analytics 2.0.1.
- **Mobile versions, from the lockfile:** expo 57.0.24, react-native 0.86.3, react 19.2.3, expo-router 57.0.22, supabase-js 2.116.0, typescript 6.0.3, jest 29.7.0, jest-expo 57.0.6.
- **Size:**
  - Web: 273 pages, 38 route handlers, 165 `"use server"` files.
  - Edge Functions: 76 (35 `ha-`, 18 `pt-`, 12 `sa-`).
  - Mobile: 44 screens.
  - Database: about 446 Drizzle tables and 192 migrations.
  - Git: 1,407 commits, 116 local branches, 5 worktrees.

## 2. Data and auth stack today

- **There is no Prisma, no Better Auth and no PGlite at runtime.** Those names appear only in docs: ADR 0001 rejected Prisma, and `content/trust-claims.ts:9` says neither is in `package.json`. PGlite is used only by a test lane that needs an out-of-repo symlink. The "Prisma + Better Auth" history in the brief does not describe this codebase.
- **Identity is shared.** Web and mobile both sign in through Supabase Auth on the same project.
- **Authorization runs on three separate paths:**
  1. **Web server code** (React Server Components, server actions, route handlers):
     - It uses Drizzle over postgres-js through the Supavisor pooler, logged in as the **`postgres`** role. The local `DATABASE_URL` user is `postgres`, port 6543.
     - **That connection bypasses RLS.** 279 files import `@/db`.
     - RLS applies only where the code opts in:
       - `asClinicalReader` switches to the `medsync_clinical_reader` role (`lib/emr/db.ts:44`). 32 files use it.
       - `lib/ncdreg/db.ts` does the same for the NCD registry.
     - EMR writes run as the table owner by design ("The caller checks access first", `lib/emr/db.ts:61`).
     - Everywhere else, access control is the 11 role scope helpers (`require{Doctor,Nurse,Clinician,Pharmacy,LabTech,Reception,HospitalAdmin,Triage,Resus,Patient,Ncd}Scope` in `lib/*/scope.ts`) plus whatever filters each query applies.
     - Separately, 52 files read through supabase-js with the user's token, and 43 files use the service-role client.
  2. **Edge Functions (Deno):**
     - All 76 import `_shared/auth.ts`. Its `getCaller` checks the token with `auth.getUser()`.
     - Each function then works through the service-role client, so every access check lives in that function's own code.
  3. **Mobile (patient app only):**
     - It calls 27 tables and 1 RPC directly with the anon key and the user's token. RLS is the only guard on those calls.
     - It also calls 16 Edge Functions through `callEdge`.
     - It also calls 6 web routes under `app/api/mobile/*` with a bearer token (`patientFromBearer`).
     - The session token is stored in AsyncStorage, which is not encrypted. The code admits this at `mobile/src/lib/supabase.ts:33`.
- **What this means:** RLS protects mobile and the EMR reads that opt in. It does not protect the web app. On the web, access control is application code spread across many files, and Phase 2 lens B starts there.
- **Request gate:** `proxy.ts` validates the user with `getUser()` (`lib/supabase/proxy.ts:47`), keeps a list of public routes, and enforces AAL2 (MFA). Under `/api/*`, each route handler must check auth itself.

## 3. Engines and the surfaces that use them

Table counts are approximate (grouped from `db/schema/*`). Flags are the local values in `.env.switches`; the production flag values live in Vercel and were not checked.

| Engine                             | Tables                      | Web surfaces (`app/`)                                            | Mobile                                | Flags                                                        | Note                                                                                                                          |
| ---------------------------------- | --------------------------- | ---------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Identity, organisation, onboarding | ~25                         | `(auth)`, signup, onboarding, get-started, admin, hospital-admin | sign-in, sign-up                      | ONBOARDING_V2                                                |                                                                                                                               |
| Patient record, self-tracking      | ~14                         | patient, pw, reception                                           | most direct table calls               | PATIENT_WEB_TIDE                                             |                                                                                                                               |
| Scheduling, booking, intake        | ~10                         | patient, reception, hospital-admin, doctor, clinician, nurse     | yes, plus `pt-*` and `ha-*` functions |                                                              |                                                                                                                               |
| Emergency pathway                  | 6                           | emergency (public), pw, patient, nurse, reception, admin         | `emergency.tsx`, `pt-emergency-event` |                                                              |                                                                                                                               |
| Triage                             | 3                           | nurse, doctor, hospital-admin                                    | none                                  |                                                              |                                                                                                                               |
| Resus                              | 10                          | nurse, doctor, clinician                                         | none                                  | RESUS_DESK_V2                                                |                                                                                                                               |
| EMR, encounter, clerking           | 41                          | doctor, nurse, lab, pharmacy, patient, hmis, admin               | visit summaries through `/api/mobile` | EMR_V1, ENCOUNTER_ENGINE_LIVE, CLERKING_V2, CLERKING_PLAN_V2 | the only engine with database-enforced read RLS                                                                               |
| Prescribing                        | 5                           | doctor, nurse, pharmacy                                          | none                                  | EMR_PRESCRIBING                                              |                                                                                                                               |
| Monitoring (fluid balance, charts) | 2                           | 2 to 4 files                                                     | none                                  |                                                              | **thin**                                                                                                                      |
| NCD (diabetes pack, registry)      | 28                          | ncd (17 pages), doctor                                           | none                                  | 5 `NCD_*`                                                    | **12 NCD files import `ncdreg/demo`**                                                                                         |
| Lab                                | 88                          | lab (36 pages) and 10 other areas                                | `labs.ts`                             | 22 `LAB_*`                                                   | **demo code in live routes:** `lab/setup/demo`, `hospital-admin/departments`                                                  |
| Pharmacy                           | **172 (39% of all tables)** | pharmacy (26 pages), hospital-admin, doctor, nurse, patient      | none                                  | 15 `PHARMACY_*`                                              | **demo code in live routes:** `doctor/renewals`, patient refills and the pharmacy refill board import `pharmacy/network-demo` |
| Wards, beds                        | 4                           | hospital-admin, nurse                                            | none                                  | WARD_BUILDER                                                 |                                                                                                                               |
| Audit, super-admin, break-glass    | 5                           | admin                                                            | none                                  |                                                              |                                                                                                                               |
| Notifications, SMS, USSD           | ~6                          | api, patient, admin                                              | `push_tokens`                         |                                                              |                                                                                                                               |

**Surfaces to verify in Phase 2:**

- Demo and fixture modules are imported by live routes in NCD, lab, pharmacy, `doctor/renewals` and `patient/track/medications`. `network-demo` labels itself as fixture-only. Phase 2 must check whether the live routes reach it only behind a gate.
- The monitoring engine (2 tables, used in 4 files) is thin compared with the surfaces that mention vitals.

## 4. Tests, CI, environment, migrations

- **Web tests:**
  - Vitest, with 693 test files under `tests/`.
  - The PGlite lane (`tests/emr-db`) skips unless the out-of-repo symlink exists and `EMR_PGLITE=1` is set.
  - The 16 live-RLS suites in `tests/rls` always skip in CI, because CI has no secrets (see the header of `ci.yml`).
- **Mobile tests:** 44 jest files. **CI never runs them**: the mobile job only runs tsc, eslint and prettier.
- **No end-to-end tests:** there is no Playwright or Cypress.
- **Coverage:** `@vitest/coverage-v8` is installed but not configured.
- **CI:** one workflow, `.github/workflows/ci.yml`, runs on every push and pull request. It runs `npm ci`, typecheck, lint, the format check, the clerking catalogue check, build, test and the bundle budget, then tsc, eslint and prettier for mobile. Whether CI blocks merges (branch protection) cannot be seen from the repo, and I did not check it.
- **Git hooks:** husky runs lint-staged plus a full typecheck before each commit, and commitlint on commit messages.
- **Environment:**
  - `.env*` is gitignored and only `.env.example` is tracked. This is correct.
  - `lib/env.ts` validates variables with t3-env, but **`MEDSYNC_PHI_KEY` (the PHI encryption key) is optional** there.
  - About 60 feature flags are read straight from `process.env` and never validated. They include `DEV_SKIP_MFA` and `PHARMACY_DEV_HOSPITALS`.
  - **`vitest.config.ts` loads `.env.local` into the tests.** On this machine that file points at the live Supabase project, logged in as `postgres`.
- **Migrations:**
  - 192 hand-written SQL files numbered 0000–0275, with 85 numbers unused (reserved by other branches).
  - A custom runner, `scripts/migrate.ts`, applies them and records each one in `_medsync_migrations`. The owner runs it.
  - drizzle-kit has snapshots only for 0000 and 0001, so nothing checks after 0001 that the SQL still matches the Drizzle schema, which the project docs call the source of truth.
  - 143 files carry a GATED header.
  - Several migrations exist only on unmerged branches, so the history can be rebuilt branch by branch but not as one line.

## Defaults for Phase 1 (used on "continue" unless the owner says otherwise)

1. Review a scratch clone of `origin/main` after a fresh `git fetch`, not the owner's working folder.
2. Install with `npm ci` (not pnpm) on Node 24, inside that clone. The owner's `node_modules` and the `@electric-sql` symlink stay untouched.
3. Put no `.env.local` in the clone and set `SKIP_ENV_VALIDATION=1`, so no test can reach the live Supabase project. The live-RLS and PGlite suites will skip, and the report will list them as not run.
