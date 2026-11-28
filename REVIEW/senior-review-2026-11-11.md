# MedSync: senior engineering review (2026-11-11)

**What was reviewed:** a read-only scratch clone of `origin/main` @ `2de1cb3f` ("Merge pull request #285 … chore/format-all"). No source file in the owner's checkout was touched. All `path:line` references below are relative to that commit.

**Method:**

- Phase 0 map: `REVIEW/phase-0-map.md`.
- Phase 1 checks: run in the clone on Node 24.20 and npm 12.2. There was no `.env.local` and `SKIP_ENV_VALIDATION=1` was set, so no check touched a live database or an external service other than the npm registry and Expo's version check.
- Phase 2: six parallel review lenses: clinical safety, web server authorization, Edge Functions and RLS, privacy and audit, data model, and frontend/quality/process.
- Verification: I re-read the code behind every Critical and High finding myself before it went into this report. Items I could not prove are listed under section 9, "Suspicions to verify".

---

## 1. Verdict

**No.**

MedSync should not hold real patient data today. The engine work is often good: the EMR write path, the pharmacy ledger, AES-GCM done correctly, and Zod on nearly every action. But the access-control perimeter has holes that need no skill to use:

- Anyone who self-signs up as "reception" at a live hospital passes the reception workspace gate before anyone approves them.
- MFA exists only in the Next.js pages, so a stolen password alone opens PostgREST and every Edge Function.
- The superadmin can read every patient's demographics and the full row history in `audit_log` without break-glass.
- Suspending a staff member changes nothing about their access.

Several public privacy promises ("every access is recorded", "information is encrypted when stored", the list of processors) are not true in code.

**One-sentence reason:** the perimeter that keeps one person's PHI away from everyone else fails open in four independent places, and none of the tests that would catch this run in CI.

---

## 2. Scorecard

| Area                 | Score    | Justification                                                                                                                                                                                                                                                                                |
| -------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Patient safety       | **4/10** | Strong engines (clerking sign-off hash, the NCD demo guard enforced in the database, append-only pharmacy ledger). But Red/Orange triage alerts can silently reach nobody, patient dose times run on UTC, glucose has no unit or plausibility guard, and the CSO gate fails open.            |
| Security & privacy   | **2/10** | MFA only in the pages; a reception-scope bypass open to any internet user; superadmin routine PHI access; self-editable `users.state`/`email`; avatars readable by any signed-in account; undisclosed transfers to the US (Anthropic, Vercel Analytics, Sentry).                             |
| Architecture         | **5/10** | One identity but three authorization paths, two of them (owner-role Drizzle, service-role Edge Functions) bypassing RLS. About 60 feature flags create parallel write paths into the same tables.                                                                                            |
| Data model           | **6/10** | Real discipline (about 1,700 FKs, CHECKs, `numeric` money, unique `client_key`s, FORCE RLS everywhere). Undermined by 53 `ON DELETE CASCADE` FKs from clinical tables to `auth.users`, released lab results that can be overwritten, and a production schema nobody can prove equals `main`. |
| Code quality         | **5/10** | Few type escapes (35 `any`, 1 `@ts-expect-error`, 0 TODO). But 621k lines of non-test source, 377 files over 400 lines, two patient webs and two resus desks live at once.                                                                                                                   |
| Testing              | **4/10** | 14,340 tests in 699 files, all green, mostly real behaviour tests of the engines. But 2,338 (16%) skip: the whole DB/RLS/audit layer. Line coverage is 32.8%; the 44 mobile test files never run in CI; and no test calls a server action or an Edge Function with the wrong JWT.            |
| Frontend engineering | **6/10** | Sound server/client split, no client-side `page.tsx`, labelled icon buttons. No error boundary on any clinician workspace and no `global-error.tsx`; three design systems stacked in one 1,759-line `globals.css`.                                                                           |
| Mobile               | **5/10** | Typechecks and lints clean; 581/584 jest tests pass. Tokens and PHI caches sit unencrypted in AsyncStorage and survive sign-out, there is no screenshot protection, there is no crash reporting, and jest is not in CI.                                                                      |
| Developer experience | **3/10** | A cold typecheck needs a 6 GB heap and 13 minutes on an 8 GB Mac; at 4 GB it thrashes. The README is stale, the real onboarding doc is addressed to Claude, `docs/` is 113 MB, and 116 local branches exist.                                                                                 |
| Production readiness | **2/10** | 41 production advisories (3 critical) at the root, including over 20 against the deployed Next 16.2.6. Clinical scopes have no error boundaries. Migrations are applied from feature branches with no checksum. Nothing in the repo shows CI gates merges.                                   |

---

## 3. Phase 1 check results

| Check                            | Command                                            | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean install (root)             | `npm ci` (Node 24.20 / npm 12.2)                   | ✅ 1,205 packages in 18 s. ⚠ npm 12 blocked install scripts for 12 packages (sharp, esbuild ×5, @sentry/cli, msw, unrs-resolver, fsevents …).                                                                                                                                                                                                                                                                                                                           |
| Clean install (mobile)           | `npm ci` in `mobile/`                              | ✅ in 18 s; 2 install scripts blocked.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm install --frozen-lockfile` | —                                                  | **Not run.** The repo uses npm (`package-lock.json` v3); there is no pnpm lockfile. Node is 24 (`.nvmrc`), not 22.                                                                                                                                                                                                                                                                                                                                                      |
| Typecheck, web app               | `tsc --noEmit` (4 GB heap)                         | ⚠ At 4 GB: **did not complete**; killed after 27 min of swap-thrashing on an 8 GB Mac. `ci.yml:51-54` now sets 6 GB because a cold run "outgrew 4 GB … and died out of memory". Retried at 6 GB: ✅ **0 errors, 783 s (13 min)**.                                                                                                                                                                                                                                       |
| Typecheck, Edge Functions        | `tsc --noEmit -p supabase/functions/tsconfig.json` | ✅ 0 errors, 5 s                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Lint                             | `npm run lint`                                     | ✅ 0 errors, 12 warnings (all `consistent-type-imports` in tests). Note: no `--max-warnings=0`, so warnings never fail.                                                                                                                                                                                                                                                                                                                                                 |
| Format                           | `npm run format:check`                             | ✅ all files Prettier-clean                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Clerking catalogue sign-off      | `npm run clerking:catalogue-check`                 | ✅ `ok`. Sign-off hashes match; 44 suggested-care items still `draft`.                                                                                                                                                                                                                                                                                                                                                                                                  |
| Production build                 | `npm run build`                                    | ✅ compiled in 2.0 min; 60 static pages; total 195 s                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Unit/integration tests           | `vitest run --coverage`                            | ✅ 0 failures. **699 files: 547 passed, 152 skipped. 14,340 tests: 12,002 passed, 2,338 skipped (16%).** The skipped ones are the PGlite EMR lane, ncdreg-db, and every live RLS/audit/auth suite (no `EMR_PGLITE`, no DB secrets), the same condition as CI. 538 s.                                                                                                                                                                                                    |
| Coverage                         | v8, `app lib components packages db`               | **Lines 32.8%** (33,031/100,741), statements 32.8%, branches 29.2%, functions 26.5%, counted over all source files including those no test imports. Not configured in the repo or in CI.                                                                                                                                                                                                                                                                                |
| Bundle budget                    | `npm run budget`                                   | ✅ 21 `/patient` routes under the 370 kB gzip ceiling (largest `/patient/track/medications` 331.4 kB). `/pw` and clinician routes are not budgeted (M-21).                                                                                                                                                                                                                                                                                                              |
| E2E                              | —                                                  | **None exist** (no Playwright or Cypress).                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Mobile typecheck                 | `tsc --noEmit`                                     | ✅ 0 errors                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Mobile lint                      | `eslint src --max-warnings=0`                      | ✅ 0 problems                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Mobile tests                     | `jest --ci`                                        | ⚠ 581/584 passed. 3 failed, all by 5 s timeouts: `src/features/safety/safety-screens.test.tsx` (×2, the "Help and danger interrupt stay light" law) and `src/components/tide/ticket.test.tsx`. Run under heavy CPU load. **Rerun alone: 15/15 pass in 6 s**, so these are load-sensitive timeouts, not logic failures. They are still flaky: the safety-screen suite took 536 s under load.                                                                             |
| expo-doctor                      | `npx expo-doctor`                                  | ❌ 19/21 checks. Fails "required peer dependencies installed" and "packages match SDK 57" (13 packages off-pin, e.g. `expo 57.0.24` vs `~57.0.32`, `expo-router 57.0.22` vs `~57.0.30`).                                                                                                                                                                                                                                                                                |
| `npm audit --omit=dev` (root)    | —                                                  | ❌ **41**: 3 critical, 14 high, 22 moderate, 2 low. Critical: `next@16.2.6` (>20 advisories incl. RCE classes in image optimisation and `next/og`, a proxy bypass, SSRF; fixed in 16.4.6), `@sentry/nextjs@10.53.1` (proxy bypass via tunnel route; `next.config.ts:87` sets `tunnelRoute: "/monitoring"`; fixed ≥10.75.2), `proxy-addr` (via `shadcn → @modelcontextprotocol/sdk → express`, a CLI wrongly in `dependencies`). High includes `zod <4.6.6` and `sharp`. |
| `npm audit --omit=dev` (mobile)  | —                                                  | ❌ **25**: 1 critical (`shell-quote`), 8 high, 9 moderate, 7 low. Mostly build tooling.                                                                                                                                                                                                                                                                                                                                                                                 |
| Dependencies ≥1 major behind     | `npm outdated`                                     | Root: 12 (5 by more than one major: `vercel` 54→65, `@types/node` 22→26, `@hookform/resolvers` 5→7, `framer-motion` 12→14, `typescript` 5→7). Mobile: 33, all one major (Expo SDK 57 → 58).                                                                                                                                                                                                                                                                             |

**Source counts** (non-test `.ts/.tsx`. Web = `app lib components db packages supabase/functions proxy.ts instrumentation*.ts`; mobile = `mobile/src`):

| Count                                       | Web (2,815 files / 621,140 lines) | Mobile (179 files / 43,711 lines) |
| ------------------------------------------- | --------------------------------- | --------------------------------- |
| `any` (`: any`, `as any`, `<any>`, `any[]`) | 35                                | 2                                 |
| `as unknown as`                             | 223                               | 1                                 |
| `@ts-ignore` / `@ts-expect-error`           | 0 / 1                             | 0 / 0                             |
| `eslint-disable`                            | 37                                | 5                                 |
| `TODO\|FIXME\|HACK`                         | 0                                 | 0                                 |
| `console.log` (all `console.*`)             | 5 (16)                            | 0 (3)                             |
| Raw hex colours outside token files         | 78                                | 15                                |
| `rgb()`/`rgba()` outside token files        | 40                                | 1                                 |
| `#DC2626` literal outside token files       | 7                                 | —                                 |
| Files > 400 lines / > 1,000 lines           | 377 / 61                          | —                                 |

**Test-to-source file ratio** (`tests/<domain>` ÷ `lib|app|components/<domain>` files): resus 1.21, auth 2.0, triage 0.75, scheduling 0.69, prescribing 0.58, emergency 0.47, clerking 0.42, wards 0.41, encounter 0.27, ncdreg 0.24, emr 0.23 (plus the 119-file PGlite lane, which does not run in CI), lab 0.20, ncd 0.20, pharmacy 0.18, reception 0.16, patient 0.08, hospital-admin 0.05, doctor 0.01, **nurse 0, onboarding 0**. Edge Functions: 112 source files, 2 test files, and those two are static source-text greps, not runtime tests.

---

## 4. Findings

Effort: S = ≤1 day, M = ≤1 week, L = more than a week.

### Critical

#### C-1. The reception scope never checks affiliation state, so any internet user can reach decrypted patient data at any live hospital

- **Evidence:**
  - `lib/reception/scope.ts:76`: `.where(and(eq(staffAffiliations.userId, state.user.id), eq(cadres.code, RECEPTION_CADRE_CODE)))`. There is no `state IN ('active','approved')`. The doc comment at `:21` promises "Most-recent active/approved". Every other staff scope filters on state.
  - The public signup `app/signup/non-clinical/actions.ts` inserts `staff_affiliations` with `state: "pending_approval"` (`:77`) at any hospital with a department where `medsync_live_at` is set.
  - `lib/legal.ts:28` `export const signupsOwnerOverride = true;` (signups open).
  - The MFA set-up page needs only `getUser`, so the attacker enrols their own TOTP and satisfies AAL2.
- **Why it matters:**
  - An anonymous person becomes "reception" at Mulago in five minutes and reads `/reception/find`, which decrypts patient names as the DB owner with RLS bypassed (`lib/reception/queries.ts:1150`). They also see today's board, expected lists and pre-arrivals.
  - The same gap means a rejected, suspended or ended receptionist keeps access.
  - That is a reportable DPPA breach on day one.
- **Fix:** add `inArray(staffAffiliations.state, ["active","approved"])` now. Then replace the 11 hand-written affiliation queries with one shared `activeAffiliation()` that also checks `users.state` and `hospitals.state`, and add a test that every `require*Scope` routes through it.
- **Effort:** S.

#### C-2. MFA is enforced only by the Next.js pages; PostgREST and all 76 Edge Functions accept password-only (aal1) tokens

- **Evidence:**
  - `supabase/functions/_shared/auth.ts:42`: `getCaller` calls only `client.auth.getUser()`, with no `aal` check.
  - `grep -il aal supabase/migrations/*.sql` matches only seed data (`0070`, `0072`), so no RLS policy references `aal`.
  - The only AAL checks are in the web scope helpers (`lib/clinician/scope.ts:58`) and `app/api/mobile/visit-summaries/_lib/caller.ts:65`.
- **Why it matters:**
  - Staff passwords get phished and reused. With an aal1 token from `/auth/v1/token`, an attacker can:
    - call `sa-open-break-glass`, `sa-create-superadmin`, `sa-reset-user-mfa` and every `ha-*` function;
    - read `patient_profiles`, `encounters` and `audit_log` over PostgREST under the superadmin or staff policies.
  - `content/legal.ts:86` tells patients "Staff accounts need a second sign-in step". At every layer below the web pages that is false.
- **Fix:**
  - Add a `RESTRICTIVE` policy, `(auth.jwt()->>'aal') = 'aal2'`, to every staff or superadmin policy arm (fold it into `user_has_role`).
  - Add `requireAal2(caller)` in `getCaller` for all `ha-*`, `sa-*` and staff functions.
- **Effort:** M.

#### C-3. Superadmins have standing, unlogged read access to PHI, including full row history through `audit_log`

- **Evidence:**
  - `0002_rls.sql:149-151`: `CREATE POLICY audit_log_select_superadmin … USING (public.user_has_role('superadmin'))`.
  - `0003_audit.sql:68-69` stores `to_jsonb(OLD)` and `to_jsonb(NEW)` for every audited table: `users` (plaintext name, phone, email), `patient_profiles`, observations, triage, conditions, allergies, `patient_places` (lat/lng), encounters.
  - `0011_patient_profiles.sql:135`: `USING (id = auth.uid() OR public.user_has_role('superadmin'))`. The same superadmin arm appears on `personal_health_logs`, appointments and the 0040 EMR tables.
- **Why it matters:**
  - Break-glass (`sa-open-break-glass`, "the only legitimate path to surface decrypted PHI") is decorative: the superadmin can read the same data with one GET, no grant, no `sa_audit_log` row, and nobody notified.
  - Combined with C-2, that "superadmin" can be anyone holding the password.
  - It also makes the append-only audit log a permanent store of PHI that can never be erased, which conflicts with the DPPA erasure promise in `content/legal.ts`.
- **Fix:** drop the superadmin arms on PHI tables and on `audit_log`. Route superadmin reads through `sa_break_glass_grants`. Make the audit trigger store changed-column names plus hashes for PHI tables rather than whole rows.
- **Effort:** M.

#### C-4. Revocation does not revoke: suspended or deactivated staff keep full access, and any user can un-suspend themselves

- **Evidence:**
  - `0002_rls.sql:13`: `GRANT SELECT, UPDATE ON public.users TO authenticated;`.
  - `:53-56`: `users_update_own … USING (id = auth.uid()) WITH CHECK (id = auth.uid())`. There is no column limit and no guard trigger in any later migration.
  - `supabase/functions/sa-suspend-user/index.ts:105-106` only does `.from("users").update({ state: "suspended", … })`. There is no auth ban, no session revoke, and affiliations and roles are untouched.
  - Only `lib/patient/scope.ts:114` reads `users.state`. `lib/clinician/scope.ts`, doctor, nurse, pharmacy, lab-tech, reception, triage, resus and ncd never do.
- **Why it matters:**
  - The superadmin suspends a staff member who is misusing records, and the staff member keeps reading PHI.
  - A suspended patient PATCHes `/rest/v1/users?id=eq.<self>` with `{"state":"active", "suspended_*":null}` and is back in.
  - The same self-edit rewrites `email`. `_shared/four-eyes.ts:81` uses that email to decide who counts as a "real" superadmin, and `accept-hospital-admin-invitation/index.ts:109` uses it to bind invitations.
- **Fix:**
  - `REVOKE UPDATE ON public.users FROM authenticated; GRANT UPDATE (full_name, phone, avatar_path) …`.
  - In `sa-suspend-user`, call `auth.admin` to ban and sign out the user.
  - Check `users.state` in the shared affiliation query (C-1) and in `getCaller`.
- **Effort:** S–M.

### High

#### H-1. Next.js 16.2.6 and @sentry/nextjs 10.53.1 carry known critical advisories

- **Evidence:** `npm audit --omit=dev` reports `next` critical: more than 20 advisories from `>=16.0.0 <16.2.11` up to `<=16.4.0`. They include GHSA-6gpp-xcg3-4w24 (proxy bypass), GHSA-vcvr-r3jv-pc5j (RCE in `next/og` ImageResponse; `app/opengraph-image.tsx` uses it) and image-optimisation RCEs. It also reports `@sentry/nextjs` GHSA-mchm-gjx6-7h55 (proxy bypass with the tunnel route; `next.config.ts:87` `tunnelRoute: "/monitoring"`).
- **Why it matters:** `proxy.ts` is the page-level auth gate. Even where a layout re-checks, a proxy bypass plus C-2 widens the hole. I did not verify exploitability per advisory, but these are non-major upgrades.
- **Fix:** `next@16.4.6+`, `@sentry/nextjs@^10.75.2`, `zod@^4.6.6`. Move `shadcn` to devDependencies (it drags `express` and `proxy-addr` into prod). Add `npm audit --omit=dev --audit-level=high` to CI.
- **Effort:** S.

#### H-2. The medication administration record trusts a hidden form field for "high-alert" and accepts any cadre and any patient

- **Evidence:**
  - `app/nurse/mar/_components/administer-form.tsx:99` `<input type="hidden" name="is_high_alert" …>`, then `app/nurse/actions.ts:125` → `supabase/functions/ha-administer-medication/index.ts:39` `is_high_alert: z.boolean().optional().default(false)`. The senior co-sign gate is `:99` `if (isNurseCadre && input.is_high_alert)`.
  - Authorisation is any affiliation at the body's `hospital_id` (`:76-82`). The `patient_user_id` and `encounter_id` that get inserted are not checked against that hospital. `ha-record-observation` has the same gap.
- **Why it matters:** a nurse (or a tampered request) records insulin or KCl as not high-alert and skips the co-sign. A receptionist or lab account can write MAR rows and observations into any patient's chart, including at another hospital. That corrupts the record a clinician doses from.
- **Fix:** derive high-alert from the prescription or formulary on the server. Require a clinical cadre. Assert that the encounter belongs to the hospital and the patient.
- **Effort:** M.

#### H-3. Red/Orange triage alerts can reach nobody, and the triaging nurse is never told

- **Evidence:**
  - `lib/triage/notify.ts:70-75` returns `{ notified: 0 }` when the recipient query fails or finds no one.
  - `:89-92` does the same when the insert fails.
  - `:96`: `// Best-effort out-of-band (stubbed today).`
  - `app/nurse/triage/actions.ts:243-250` `await notifyTriageOutcome({...}).catch((e) => logger.warn(...))` discards the result.
- **Why it matters:** the sickest patient is triaged Level 1 and the escalation silently goes nowhere. Even on success it is an in-app row only, with no SMS or page. Resus mobilisation uses the same stub sink (`lib/resus/mobilise.ts:12`).
- **Fix:** return `notified` to the triage UI and show "No one was alerted. Call for help now" when it is 0. Fall back to the in-charge. Store staff phone numbers and wire the existing SMS transport.
- **Effort:** M.

#### H-4. Patient dose times are computed in the server's time zone, UTC on Vercel, not Africa/Kampala

- **Evidence:**
  - `lib/patient/doses.ts:163`: `// ponytail: slot instants use the server's local midnight.`
  - `:471-482` uses `setHours`/`getHours`.
  - `app/patient/track/page.tsx:37-48` is a server component (`const now = new Date(); … buildDayDoses(...)`).
  - `vercel.json` sets no time zone. The functions run in `dub1`.
- **Why it matters:**
  - An "08:00" dose opens at 11:00 EAT, and a take at 08:05 EAT reads "05:05".
  - From 00:00 to 03:00 EAT the page shows yesterday.
  - A dose shown as "not yet due" invites a double dose; "missed" for a dose already taken erodes trust. The file's own header names this harm.
  - This page is live while `PATIENT_WEB_TIDE` is off.
- **Fix:** build slots in `Africa/Kampala` with `Intl`, as `supabase/functions/_shared/slots.ts:191` already does.
- **Effort:** S.

#### H-5. Blood glucose has no unit or plausibility guard at triage or in the patient danger check

- **Evidence:**
  - `lib/triage/scoring/derived.ts:92-97`: `glucose < GLUCOSE.HYPO_LT ? "hypoglycaemia" : glucose > GLUCOSE.HYPER_DKA_SCREEN_GT ? "hyperglycaemia_dka_screen"`.
  - The action schema is `bloodGlucose: z.number().nullable()` (`app/nurse/triage/actions.ts:38`), with no bounds.
  - The patient-side `packages/patient-core/readings.ts:91-108` has no upper bound.
  - `lib/patient/self-tracking-constants.ts:84` offers `["mg/dL","mmol/L"]`.
  - The guard already exists and is unused: `lib/units/prompts.ts:10` `"obs.glucose": { unit: "mmol/L", fires: (v) => v > 60, ask: "Is this mg/dL?" }`.
- **Why it matters:** a glucometer reading of 54 mg/dL (hypoglycaemia) typed into the mmol/L tile becomes "screen for DKA". On the patient side it becomes "Your sugar is very high" instead of "eat something sweet now".
- **Fix:** reuse `lib/units/prompts`. Refuse or ask above about 35 mmol/L, and store the unit with every reading.
- **Effort:** S.

#### H-6. The CSO sign-off gate fails open and covers only part of the unsigned clinical content

- **Evidence:**
  - `lib/workspace-access/flag.ts:23` `if (process.env.VERCEL_ENV !== "production") return false;` (not blocked).
  - The same pattern appears in `app/emergency/_lib/sheet.ts:69` (unverified emergency numbers shown when `!isProduction()`) and in `lib/lab/criticals/readiness.ts:46`.
  - About 37 of about 48 `SignedCopy` constants with `status: "draft"` are never read by any gate. Examples:
    - `LAB_TEST_MENU_COPY_STATUS`, rendered in `components/emr/orders/order-sheet-view.tsx:17`.
    - `THRESHOLDS_STATUS` (`packages/clinical-rules/patient-thresholds.v0.json` `"status": "pending-cso"`), which drives the patient danger interrupt on `/pw` and mobile.
    - `content/pharmacy-medicines.ts:299` (`paracetamol: "Children: 10–15 mg/kg a dose"`). It is gated only through `PHARMACY_REWORK_COPY`, so signing that one constant ships these unsigned doses.
- **Why it matters:** a self-hosted deployment (a likely DPPA data-residency move), a preview pointed at production, or a missing variable serves every draft. "Signed" is a per-file string that one person edits, with no mechanism tying a page to its sign-off.
- **Fix:** invert the gate: blocked unless an explicit `MEDSYNC_ENV` names a non-production environment. Add a test that enumerates every `SignedCopy` export and fails if it is not wired into a gate. Gate the patient thresholds.
- **Effort:** M.

#### H-7. Personal health data goes to processors outside Uganda that the privacy notice does not name

- **Evidence:**
  - `app/api/mobile/reading-photo/route.ts:47` sends a patient's meter photo to `https://api.anthropic.com/v1/messages`, and `food-label` does the same. There is no in-app consent prompt.
  - `app/layout.tsx:124` `<Analytics />` on every route, with no `beforeSend`. It receives `/nurse/patients/[patientId]` and the reception name search, a GET form (`app/reception/find/page.tsx:110` `name="q"`, so the patient's name goes in the URL).
  - The Sentry client config (`instrumentation-client.ts`) leaves URL and fetch breadcrumbs unscrubbed.
  - A Google Maps iframe carries the patient's GPS on `/share`.
  - The notice (`content/legal.ts:79`) lists only "hosting and database services, an SMS and USSD provider, and phone notification services".
- **Why it matters:** DPPA s.19 restricts transfers abroad without adequate protection or consent, and health data needs explicit consent. Reception staff typing patient names sends those names to Vercel Analytics in the US.
- **Fix:** name every processor. Add per-feature AI consent. Add `beforeSend` to Analytics and Sentry that strips path IDs, `?q` and tokens. Make the reception search a POST.
- **Effort:** S–M.

#### H-8. Patient identity is stored in plaintext beside the encrypted copy

- **Evidence:**
  - `app/signup/patient/actions.ts:35` `const fullName = \`${v.firstName.trim()} ${v.surname.trim()}\``, then `createAccount`, then `auth.users.raw_user_meta_data.full_name`and`public.users.full_name`(with`phone`and`email`).
  - Meanwhile `patient_profiles.first_name_encrypted`/`surname_encrypted` are AES-GCM.
  - Other plaintext: `pharmacy_epi_clients` (child's name, DOB, carer, village), `clinical_documentation.section_data`, `clerkship_drafts.payload`, `appointments.symptoms`, every `audit_log` row.
- **Why it matters:** a database dump or backup yields every patient's name, phone and email regardless of the key. `content/legal.ts:86` "Information is encrypted when … stored" is true only of the Supabase disk.
- **Fix:** do not write patient names into `users`/auth metadata (use a display alias). Encrypt the EPI register and clinical free text.
- **Effort:** M–L.

#### H-9. Reads of PHI are logged only in some modules, despite "every access is recorded"

- **Evidence:**
  - `clinical_phi_access_log` is written by 12 modules (nurse, doctor, emr, triage, reception, encounter, resus, scheduling).
  - These decrypt without logging: `lib/pharmacy/read.ts:448-465`, `lib/pharmacy/clinical/reaction-read.ts:78`, `lib/lab/read.ts:280,353`, `lib/lab/referral-results-store.ts:108`, `lib/emergency/queries.ts:94`, `lib/channels/ussd-data.ts`.
  - The promise is made in `content/legal.ts:78` and in `content/trust-claims.ts:105` (status `built`).
- **Fix:** log in the shared read helpers, or at scope resolution per patient.
- **Effort:** M.

#### H-10. The audit trail can be switched off, truncated or rewritten by the role the app runs as, and most writes are attributed to nobody

- **Evidence:**
  - `0003_audit.sql:125-134` revokes UPDATE/DELETE only from `PUBLIC`/`anon`/`authenticated`. There is no `BEFORE TRUNCATE` guard on `audit_log`.
  - The table owner `postgres` is the role the web app uses (`db/index.ts`, Phase 0).
  - `public.pharmacy_demo_remove` (`0263_…sql:197`, SECURITY DEFINER, called at runtime from `lib/pharmacy/demo/index.ts:191`) runs `ALTER TABLE … DISABLE TRIGGER` on clinical tables and hard-deletes. `lab_demo_remove` (`0178:117`) does the same.
  - `actor_id := auth.uid()` reads `request.jwt.claim.sub`. That is set only in `lib/emr/db.ts:46`, `lib/emr/write/ample.ts:40` and `lib/ncdreg/db.ts`, so every other Drizzle write (pharmacy, lab, patient profile …) is audited as `NULL`.
- **Why it matters:** an append-only guarantee that has a runtime off-switch is not an audit trail a regulator or court will accept. "Who changed this?" is unanswerable for most of the system.
- **Fix:**
  - Set the claim GUC in every transaction in `db/index.ts`.
  - Add a `BEFORE TRUNCATE` statement trigger.
  - Move the audit tables to a schema owned by a role the app does not use, and ship them off-box.
  - Move demo data out of the production database.
- **Effort:** M–L.

#### H-11. Every patient's and staff member's photo is readable by any signed-in account

- **Evidence:** `0056_avatars_ratings.sql:67-70`: `CREATE POLICY avatars_select_authenticated ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'avatars');`. Object keys are `<userId>/…`.
- **Why it matters:** public self-signup, then list the bucket, then every patient's face keyed to their user id. A face is biometric personal data.
- **Fix:** limit reads to the owner, clinicians (their own photos), and staff with a clinical relationship.
- **Effort:** S.

#### H-12. Unauthenticated pre-alert flooding of emergency boards, plus facility SMS costs

- **Evidence:**
  - `supabase/functions/pt-create-pre-arrival/index.ts:98` `device_hash: z.string().min(16).max(128)` is supplied by the client.
  - Rate limits apply only `if (!caller)` (`:245`) and are keyed on that hash and on a typed phone number.
  - Each request writes `emergency_pre_arrivals` plus a `pre_arrival_outbox` SMS.
- **Why it matters:** with only the anon key and a loop that randomises `device_hash` and the phone, an attacker floods every hospital's ED pre-alert board, masking real arrivals, and runs up the Africa's Talking bill.
- **Fix:** rate-limit on server-observed IP, add a per-facility global cap, and require OTP above a threshold.
- **Effort:** M.

#### H-13. Four-eyes is not enforced: one superadmin can mint another, and the second-approval path does not exist

- **Evidence:**
  - `0002_rls.sql:108-116` `user_roles_insert_admin … WITH CHECK (public.user_has_role('superadmin') OR …)`, so a direct PostgREST insert of `role='superadmin'` works.
  - `_shared/four-eyes.ts:96` `const autoSatisfied = realCount < 2;`, where "real" means an email not ending in `@medsync.local` (`:81`), and that email is self-editable (C-4).
  - `loadPendingForConfirm` has no caller; no confirm or execute function exists.
  - Suspend, deactivate, reset-MFA and break-glass do not use four-eyes at all.
- **Fix:**
  - Refuse `role='superadmin'` in the RLS policy (service role only).
  - Count superadmins from an immutable flag.
  - Build the confirm function.
  - Require a second approver for break-glass and notify a DPO.
- **Effort:** M.

#### H-14. Only 2 of 11 staff scopes check the hospital's tenant state

- **Evidence:** `REACHABLE_HOSPITAL_STATES` is checked only in `lib/clinician/scope.ts` and `lib/hospital-admin/scope.ts`. Doctor, nurse, pharmacy, lab-tech, reception, triage, resus and ncd ignore `hospitals.state`.
- **Why it matters:** offboarding a hospital (contract ended, DPA withdrawn) leaves its staff reading and writing PHI.
- **Fix:** part of the shared `activeAffiliation()` from C-1.
- **Effort:** S.

#### H-15. Clinical history cascade-deletes with the patient's auth user

- **Evidence:**
  - 53 `REFERENCES auth.users(id) ON DELETE CASCADE` FKs. Examples: `0028_scheduling.sql:266` (encounters), `0039_smart_prescribing.sql:68` (prescriptions), the 0040 diagnoses, problem list, medications, orders and care plan, `0091` admissions, and the `0031` MAR.
  - No later migration changes them. Newer tables use RESTRICT, so the policy changed without migrating old tables.
  - `encounters.hospital_id` also cascades (`0028:264`).
- **Why it matters:** a dashboard delete, an `auth.admin.deleteUser` (already used in `lib/onboarding/account.ts:76`), or a future merge or erasure flow erases encounters and prescriptions. Whether history survives depends on whether some append-only table happens to hold a row.
- **Fix:** a migration switching every patient or hospital FK on clinical tables to RESTRICT.
- **Effort:** M.

#### H-16. Encounter completion is several separate writes, with failures logged as "non-fatal"

- **Evidence:**
  - `supabase/functions/ha-complete-encounter/index.ts:322-409` has eight separate `log.warn("… failed (non-fatal)")` branches: encounter event, queue, intake, nursing assignments, appointment.
  - `:387-392` also closes every active nursing assignment for the patient at that hospital, not just this encounter's.
- **Why it matters:** half-closed encounters leave a patient "being seen" in the queue and "in progress" on the appointment, with no reconciliation. A second short encounter takes an admitted patient off the ward nurse's list.
- **Fix:** one SQL function per mutation (as `admit_from_encounter` already does), and scope the assignment close to the encounter.
- **Effort:** M.

#### H-17. Released lab results can be overwritten on the legacy lab path

- **Evidence:** `app/lab/actions.ts:108-138` checks `existing.some(r => r.qualityStatus === "released")` and then runs `db.update(encounterResults).set(fields)…`. That is outside a transaction, with no status predicate on the UPDATE and no trigger on `encounter_results`. Live where `legacyWritesOpen(hospitalId)` is true.
- **Why it matters:** a race between re-entry and release silently replaces a released value and flips it back to "entered". A clinician's result changes under them.
- **Fix:** add `AND quality_status <> 'released'` on every UPDATE and a `BEFORE UPDATE` trigger freezing released rows.
- **Effort:** S.

#### H-18. The database, RLS, audit and mobile test suites never run in CI, and nothing in the repo shows CI blocks merges

- **Evidence:**
  - `tests/emr-db/_pglite.ts:20` `laneOn = process.env.EMR_PGLITE === "1"`, and it needs a symlink into `~/Desktop/emr-harness` (AGENTS.md).
  - `ci.yml` header: no secrets, so `tests/rls/*`, the tenant-isolation tests, `tests/audit` and `tests/auth/auth-flow` skip. Measured in this review: **2,338 of 14,340 tests (152 of 699 files) skip** under CI-equivalent conditions.
  - The mobile job runs no jest.
  - Zero tests import an `app/**/actions.ts`.
  - `tests/functions/*` are two static source-grep files.
  - `"lint": "eslint"` has no `--max-warnings=0`.
  - There is no migration replay, no audit step and no CODEOWNERS.
- **Why it matters:** C-1 through C-4 are exactly the kind of bug these suites exist to catch. They pass on one laptop and are invisible to CI.
- **Fix:** make `@electric-sql/pglite` a devDependency (reverses ADR 0133). Point the RLS suites at a disposable Supabase project. Run mobile jest. Protect `main`.
- **Effort:** M.

#### H-19. The production schema cannot be proven equal to `main`

- **Evidence:**
  - `scripts/migrate.ts:74-78` `pending: sorted.filter((f) => !applied.has(f))`: no out-of-order refusal and no checksum. Selective `-- 0092 0083` application is supported.
  - AGENTS.md instructs running `db:migrate` from feature-branch worktrees.
  - `main` has 85 unused numbers (reserved by other branches). drizzle-kit snapshots stop at 0001.
  - The parity test (`tests/emr-db/drizzle-parity.test.ts`) does not run in CI (H-18).
- **Why it matters:** disaster recovery from the repo yields a different schema from production, and nobody can audit what is actually deployed.
- **Fix:** refuse out-of-order application without a flag, store a sha256 per applied file, and run a nightly diff of production `pg_dump --schema-only` against a from-zero replay.
- **Effort:** M.

#### H-20. No error boundary on any clinician workspace, and no `global-error.tsx`

- **Evidence:** `find app -name error.tsx` returns 7 files: `app/patient/error.tsx` plus 6 under `app/pharmacy/`. There is none for doctor (30 pages), nurse incl. resus (18), lab (36), hospital-admin (22), admin (17), reception (8), ncd (17) or `/pw` (35), and no `app/global-error.tsx`.
- **Why it matters:** one throwing widget (for example the 1,648-line `desk-client.tsx`) blanks the route to Next's default error screen. That loses the navigation and the Emergency pill, possibly mid-resus. The mobile app has no crash reporting.
- **Fix:** one `error.tsx` per workspace layout that keeps the shell, plus a root `global-error.tsx`; Sentry in mobile.
- **Effort:** S.

#### H-21. Prescribing checks use the newest weight or glucose of any age and show only a clock time (gated)

- **Evidence:**
  - `lib/emr/write/plan.ts:93-102` `newest("obs.weight")`/`newest("obs.glucose")`, with no `lookbackYears`.
  - `lib/prescribing/plan-checks.ts:128-133` `toLocaleTimeString(… hour, minute …)` (no date). `:233` `${ctx.weight.kg} kg · ${time(ctx.weight.at)}`; `:297` glucose "passed".
- **Why it matters:** an 8-month-old child weight shown as "09:12" drives mg/kg arithmetic, and a week-old glucose clears dextrose. Behind `CLERKING_PLAN_V2` + `EMR_PRESCRIBING` (default off). It must be fixed before either is switched on.
- **Fix:** show the date unless it is today, and set a maximum age per check.
- **Effort:** S.

### Medium

| ID   | Finding                                                                                                                                                                                                                        | Evidence                                                                                                                                                                                                                                                                                                     | Fix (effort)                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| M-1  | Column-level `REVOKE`s are no-ops under table-level grants, so clinicians can self-set `verified_at`.                                                                                                                          | `0013:78` `REVOKE UPDATE (verified_at, verified_by) ON public.clinician_profiles FROM authenticated` (same in `0014:178`, `0018:303`)                                                                                                                                                                        | Revoke at table level, grant columns (S)                                  |
| M-2  | Patients can rewrite clinically used demographics (`sex`, `date_of_birth`, `patient_code`, `known_conditions`).                                                                                                                | `0011:149-154` `patient_profiles_update_own` covers all columns                                                                                                                                                                                                                                              | Column allow-list; identity changes desk-verified (S)                     |
| M-3  | Hospital admins write `user_roles` directly over PostgREST, skipping the Edge checks and `sa_audit_log`.                                                                                                                       | `0002:14` `GRANT SELECT, INSERT, DELETE ON public.user_roles` + policies `:108-127`                                                                                                                                                                                                                          | Service-role only (S)                                                     |
| M-4  | Staff can manufacture a "clinical relationship" by booking any patient, then read that patient's self-reported data from other hospitals.                                                                                      | `has_clinical_relationship` (0040) counts appointments with `starts_at >= now()-30d`, future included; `ha-book-on-behalf/index.ts:203-214` accepts any `patient_user_id`                                                                                                                                    | Require attendance; cap the window; audit creation (M)                    |
| M-5  | NEWS2 bands have gaps, so decimal vitals score 0 and lose the red trigger.                                                                                                                                                     | `lib/triage/constants.ts:70-75` (`max: 90`, `min: 91`); `lib/triage/scoring/news2.ts:101-105` → `points: 0`                                                                                                                                                                                                  | Half-open bands or integer rounding (S)                                   |
| M-6  | Red marks stock-outs and rota gaps, and the red-reserved test does not scan pharmacy, lab, NCD, `/pw`.                                                                                                                         | `components/pharmacy/medicines/tones.ts:8,15`; `tests/design/red-reserved.test.ts:52-63`                                                                                                                                                                                                                     | Use Tag/neutral; widen the test (S)                                       |
| M-7  | The pharmacist regulator is named "PSU / Pharmaceutical Society of Uganda" in a database CHECK and in UI copy.                                                                                                                 | `0273_pharmacy_roster.sql:82` `CHECK (body IN ('PSU','AHPC'))`; `content/pharmacy-roster.ts:221`; `components/pharmacy/roster/people.tsx:108` (vs `lib/onboarding/profession.ts:14` "Pharmacy Board of Uganda")                                                                                              | New migration + copy (S)                                                  |
| M-8  | The lab demo writes into production as the first real doctor, with no production freeze (pharmacy has one).                                                                                                                    | `lib/lab/demo.ts:416-455` (`doctorActor: { userId: doctor.id`) vs `lib/pharmacy/demo/index.ts:176-182`                                                                                                                                                                                                       | Same freeze; demo out of prod (S)                                         |
| M-9  | SMS provider calls happen inside DB transactions, so a rollback means a re-send and a held pool connection.                                                                                                                    | `lib/pharmacy/sms/store.ts:426`; `lib/pharmacy/notify.ts:174-181`                                                                                                                                                                                                                                            | Outbox pattern (M)                                                        |
| M-10 | Duplicate encounters per triage: find-or-create with no lock or unique index.                                                                                                                                                  | `lib/encounter/handoff.ts:152-205`; no unique index on `encounters(triage_record_id)`                                                                                                                                                                                                                        | Partial unique index + `FOR UPDATE` (S)                                   |
| M-11 | Other multi-step writes are non-transactional (`ha-start-encounter`, legacy `lib/encounter/record.ts`, lab release); only 10 of 77 writing Edge Functions use an RPC.                                                          | `ha-start-encounter/index.ts:309-381`; `app/lab/actions.ts:199-215`                                                                                                                                                                                                                                          | SQL functions (L)                                                         |
| M-12 | Rough edges in the hand-rolled `begin()`: the original error can be masked, a failed rollback still releases the connection, and the `statement_timeout` comment is wrong (sent in StartupMessage, may not survive Supavisor). | `db/index.ts:67-99`, `:52`                                                                                                                                                                                                                                                                                   | Keep original error; destroy on failed rollback; `SET LOCAL` timeouts (S) |
| M-13 | About 60 feature flags create parallel writers with weaker invariants into the same tables; no CI coverage of flag combinations.                                                                                               | `process.env` flag reads in `app lib components`; F3 (H-17) and M-11 are flag-off paths                                                                                                                                                                                                                      | Sunset dates; delete v1 on cut-over (M)                                   |
| M-14 | `DEV_SKIP_MFA` (and about 15 "not production means open" gates) is blocked only when `VERCEL_ENV === "production"`.                                                                                                            | `lib/boot-guard.ts:9`; `lib/auth.ts:63`                                                                                                                                                                                                                                                                      | Require `NODE_ENV=development`, or an explicit `MEDSYNC_ENV` (S)          |
| M-15 | `reviewCatalogProposalAction` writes shared clinical reference data with no AAL2 check and no runtime validation.                                                                                                              | `app/admin/catalog-proposals/actions.ts:20`                                                                                                                                                                                                                                                                  | Check `aal2` + Zod (S)                                                    |
| M-16 | `attachScanAction` downloads storage objects with the service role before authenticating.                                                                                                                                      | `lib/lab/referral-actions.ts:372`                                                                                                                                                                                                                                                                            | Authenticate first (S)                                                    |
| M-17 | Rate limiting is in-memory per instance; sign-in, MFA verify and most signups have none; GoTrue sees Vercel's egress IPs.                                                                                                      | `lib/onboarding/rate-limit.ts`; `app/(auth)/sign-in/actions.ts:42`                                                                                                                                                                                                                                           | Shared limiter + Vercel firewall (S–M)                                    |
| M-18 | Crypto lifecycle: no key id in `iv:tag:ct`; one key for all tenants; the raw PHI key is reused as an HMAC secret with an empty fallback; decrypt failures return null silently in clinical reads.                              | `lib/ncdreg/exchange/index.ts:398` `process.env.MEDSYNC_PHI_KEY ?? ""`; `lib/pharmacy/read.ts:60`                                                                                                                                                                                                            | Versioned keyring, HKDF subkeys, loud failures (M)                        |
| M-19 | Mobile PHI at rest: visit records (diagnoses, medicines), history, health card and places sit in AsyncStorage, survive sign-out, and screens have no screenshot protection.                                                    | `mobile/src/data/records.ts:98`, `history.ts:65`, `me.ts:118`; `src/lib/session.tsx:54-60`; `mobile/src/lib/supabase.ts:33`                                                                                                                                                                                  | Clear on sign-out; encrypted store; `usePreventScreenCapture` (M)         |
| M-20 | Automated accessibility checks cover 8 public pages only; the resus prescribe dialog is a hand-built `role="dialog"` with no focus trap or Escape; the audited down-triage reason box has no label.                            | `tests/a11y/static-pages.test.ts:30-38`; `app/nurse/resus/[episodeId]/_components/prescribe-dialog.tsx:332`; `triage-desk.tsx:811-817`                                                                                                                                                                       | Axe over styleguide fixtures; use `EditorDialog` (M)                      |
| M-21 | `/pw` escapes the bundle budget and strict jsx-a11y once `PATIENT_WEB_TIDE` is on.                                                                                                                                             | `scripts/check-budget.mjs` `PREFIX = "/patient"`; `eslint.config.mjs:33-38`                                                                                                                                                                                                                                  | Add `/pw` (S)                                                             |
| M-22 | Three design systems coexist and the docs contradict each other.                                                                                                                                                               | `AGENTS.md:80` "The system is MedSync Chroma" vs `DESIGN-medsync.md:3` "Supersedes MedSync Chroma"; `app/globals.css` 1,759 lines, about 9 token scopes, Tide by `:root:has(...)` overrides; 2 Buttons, 9 `Field`s; 2,172 off-scale `text-[Npx]`; about 10 right-edge `SheetContent` panels against ADR 0161 | Fix the docs now; finish Tide and delete Chroma (L)                       |
| M-23 | Form limits are duplicated by hand between client and server.                                                                                                                                                                  | `app/hospital-admin/scheduling/actions.ts:43` `.min(5).max(240)` vs `policy-form.tsx:167` `values.slot < 5 \|\| values.slot > 240`                                                                                                                                                                           | Share schemas from `lib/<domain>/schemas.ts` (M)                          |
| M-24 | Very large components (17 `useState` in one 1,648-line client component).                                                                                                                                                      | `desk-client.tsx`, `ncd-capture.tsx` (2,110), `impression-step.tsx` (1,888), `app/nurse/resus/actions.ts` (25 actions, 1,489)                                                                                                                                                                                | Reducers/hooks; `max-lines` warn (M)                                      |
| M-25 | Onboarding docs are stale or addressed to an AI; repo bloat.                                                                                                                                                                   | `README.md` "Phase 0 foundation", 8 of 48 scripts; `docs/CLAUDE-HANDOFF.md` "next migration is 0092" (latest 0278); `docs/` 1,531 files / 113 MB; two ADRs numbered 0425                                                                                                                                     | Rewrite the README; move dumps out (S)                                    |
| M-26 | A cold typecheck needs more than 4 GB of heap (CI set 6 GB today), and the pre-commit hook runs it.                                                                                                                            | `ci.yml:51-54`; `.husky/pre-commit` `npm run typecheck`; here: 4 GB thrashed for 27 min; 6 GB took 13 min                                                                                                                                                                                                    | Project references / split `tsconfig`; run typecheck in CI only (M)       |

### Low

- L-1: Cron secrets are compared with `!==`, not constant time (`app/api/cron/*/route.ts`; all fail closed). Webhook secrets travel in URL path or query (`/api/ussd/[secret]`, pharmacy `?key=`) and reach logs and Sentry.
- L-2: `public.patient_code_seq` (`0011:22`) is the only table without RLS (no PHI; tampering would break patient-code generation).
- L-3: CORS allows any `*.vercel.app` (`_shared/cors.ts:23`). Bearer auth, so impact is low.
- L-4: `ha-assign-patient-to-nurse/index.ts:111` closes the pair's assignments at every hospital (no `hospital_id` filter).
- L-5: `lab_referrals.patient_user_id` has no FK (`0151:22`), the only one of 104.
- L-6: `shadcn` (a CLI) is in `dependencies`; `framer-motion` is a root dependency used only by `bionic-islet-bench/`, which ships to `public/bioniccell` on the production domain.
- L-7: Root junk: `claude-code-organize-prompt.md`, empty `prompts/`, `artifacts/` (2.6 MB PNG), `components/landing/_*.tsx`.
- L-8: Naming: `lib/notify` vs `lib/notifications`, `ncd`/`ncdreg`/`registry`, schema files named after migrations (`pharmacy-stores-0182.ts`), 5 `kit.tsx`.
- L-9: Sequential awaits in the older encounter page (`app/doctor/encounters/[encounterId]/page.tsx:113-157`) and about 15 sequential queries inside `lib/emr/read/desk.ts`.
- L-10: Mobile splash waits on 12 font files; 10 long lists render with `ScrollView` + `map`; 142 KB `foods.ts` in the bundle.
- L-11: The mobile emergency call fails silently (`Linking.openURL(...).catch(() => {})`); the number is visible on the button.
- L-12: npm 12 blocks install scripts for `sharp`, `esbuild` and `@sentry/cli`, with no `allowScripts` config. This is fragile for the next person's clean install.

---

## 5. Docs vs reality

| Claim                                                                                                               | Where                                                | Reality                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| "Staff accounts need a second sign-in step"                                                                         | `content/legal.ts:86`                                | Only the Next.js pages enforce it (C-2).                                                                                                |
| "Information is encrypted when … stored"                                                                            | `content/legal.ts:86`                                | Patient names, phone and email are plaintext in `users` and auth metadata; clinical free text and the EPI register are plaintext (H-8). |
| "Every time they are shown it is recorded"; "Every access is recorded" (status `built`)                             | `content/legal.ts:78`; `content/trust-claims.ts:105` | Pharmacy, lab, emergency and USSD reads are not logged (H-9). Most writes are audited with `actor_id = NULL` (H-10).                    |
| Processors: "hosting and database services, an SMS and USSD provider, and phone notification services"              | `content/legal.ts:79`                                | Also Anthropic (US), Vercel Analytics, Sentry, Google Maps, OpenStreetMap, Open Food Facts, Expo push (H-7).                            |
| Break-glass is "the only legitimate path to surface decrypted PHI"                                                  | `supabase/functions/sa-open-break-glass`             | `audit_log` and the superadmin RLS arms are a second, unlogged path (C-3).                                                              |
| `sa-create-superadmin` "waits for them to confirm"                                                                  | four-eyes                                            | No confirm path exists (H-13).                                                                                                          |
| Reception scope resolves "Most-recent active/approved" affiliation                                                  | `lib/reception/scope.ts:21`                          | No state filter (C-1).                                                                                                                  |
| "The DB itself denies clinical reads" (reception comment) / RLS-first (AGENTS.md "Conventions")                     | `lib/reception/scope.ts`; `AGENTS.md`                | The web runs as the `postgres` owner; RLS applies only inside `asClinicalReader` and NCD (Phase 0).                                     |
| "Drizzle schema is the source of truth"                                                                             | `AGENTS.md`                                          | Migrations are hand-written SQL; drizzle-kit snapshots stop at 0001; the parity test is a local-only lane (H-19).                       |
| "The system is MedSync Chroma"                                                                                      | `AGENTS.md:80`                                       | `DESIGN-medsync.md:3`: Tide "Supersedes MedSync Chroma" (M-22).                                                                         |
| `instrumentation-client.ts:7` "patterns are duplicated" from the server scrubber                                    | Sentry client                                        | They are not; the client only trims `user` and cookies (H-7).                                                                           |
| `statement_timeout` "sent as a SET command after connect"                                                           | `db/index.ts:52`                                     | Sent in the StartupMessage; may not apply through Supavisor (M-12).                                                                     |
| "Phase 0 foundation", 17-section landing, Fraunces                                                                  | `README.md`                                          | Long out of date (M-25).                                                                                                                |
| `docs/CLAUDE-HANDOFF.md` "next new migration is 0092"                                                               | handoff                                              | Latest on `main` is 0278.                                                                                                               |
| AGENTS.md describes the stack as Supabase + Drizzle; the review brief described a Prisma + Better Auth + PGlite web | brief                                                | There is no Prisma, Better Auth or PGlite at runtime. AGENTS.md is right; the brief's history is not this codebase.                     |

---

## 6. What is genuinely good

- **The EMR write path is the right shape:** Zod, then scope, then one transaction, then access re-checked inside it (`resolveEmrAccess` against SQL `patient_access_basis`). Optimistic revisions (`lib/emr/write/notes.ts:187-216`), 48 unique `client_key` indexes behind an idempotent sync queue, and reads under a non-bypass role (`asClinicalReader`).
- **The pharmacy ledger is enforced in the database,** not in JS: append-only triggers, a sign CHECK, a balance guard under `FOR UPDATE`, and a `(hospital_id, idempotency_key, batch_id)` unique index (`0265:51`).
- **AES-256-GCM is implemented correctly:** random 12-byte IV, auth tag verified, 32-byte key enforced, throws when the key is unset (no plaintext fallback), and the Node and Deno code is identical.
- **Edge Functions consistently authenticate with `getUser()`, Zod-validate (76/76), and authorise against the target row's own `hospital_id`** rather than the request body. The `/share` token has about 244 bits of entropy, an 8-hour CHECK and revocation.
- **Safety thinking shows up in data, not just prose:** NCD demo interlocks in SQL (`0093:12-13,177`), the clerking catalogue SHA-256 checked in CI, a boot guard that refuses `DEV_SKIP_MFA` in Vercel production, and SMS bodies with no PHI by construction.

---

## 7. Uncomfortable truths

1. **Surfaces are ahead of the safety-critical engines.**
   - Pharmacy is 172 of about 446 tables (39%), with 15 flags, 26 pages, a supplies catalogue, a roster and epidemiology.
   - Triage has 3 tables, and its Red/Orange escalation is an in-app row with a stubbed out-of-band sink (`lib/triage/notify.ts:96`).
   - Monitoring has 2 tables used in 4 files.
   - The parts that keep a deteriorating patient alive are the thinnest parts of the system.
2. **Too many parallel workstreams for one person to keep safe.**
   - 116 local branches and 5 worktrees.
   - Migrations reserved and applied from unmerged branches (85 gaps on `main`).
   - About 60 feature flags; two live patient webs (`app/patient` 15,953 lines + `app/pw` 13,405); two live resus desks (5,754 + 15,858 lines).
   - About 100k inserted lines in the last 60 non-merge commits.
   - Every one of the Critical findings sits in a place that had been "done" and moved on from.
3. **The tests that matter run only on the founder's laptop.** 2,338 DB/RLS/audit tests (16% of the suite) depend on a symlink into `~/Desktop/emr-harness` or on secrets CI does not have. A green CI badge says almost nothing about authorization.
4. **One person is the superadmin, the Clinical Safety Officer and the audit reader.**
   - Sign-off is a `status: "signed"` string edited in `content/*.ts` by the same committer (H-6).
   - Four-eyes auto-approves while fewer than two "real" superadmins exist (`four-eyes.ts:96`), and no second-approval path exists anyway (H-13).
   - The superadmin can read `audit_log`, including the trail of their own actions (C-3), and the demo-removal functions can disable the audit triggers at runtime (H-10).
   - No regulator will accept a control where the controlled party is also the control.
5. **Demo data lives in the production database.** It needed three emergency fix-forward migrations in two days (0260–0263, "production, 29 Oct 2026") whose headers describe real staff's signed work being caught by the removal.
6. **The public privacy notice was written ahead of the code.** Four of its promises are false today (section 5). Under DPPA that is a misrepresentation to data subjects, not a backlog item.

---

## 8. Fix order (risk reduced per unit of effort)

**Next two weeks (all S–M; together they close every Critical):**

1. **C-1 + H-14 + C-4 (staff side):** one shared `activeAffiliation()` that checks affiliation state, `users.state` and `hospitals.state`, used by all 11 scopes, plus a test enforcing that. Ship the reception one-liner today. _(S)_
2. **C-4 (DB side) + M-1 + M-3:** column-level grants on `users`, `clinician_profiles`, `hospital_applications`; revoke client writes to `user_roles`; `sa-suspend-user` bans and signs out. _(S)_
3. **H-1:** `next@16.4.6+`, `@sentry/nextjs@^10.75.2`, `zod@^4.6.6`; `shadcn` to devDependencies; add an audit step to CI. _(S)_
4. **C-2:** AAL2 in a RESTRICTIVE policy on staff and superadmin arms, and in `getCaller` for `ha-*`/`sa-*`. _(M)_
5. **C-3 + H-11:** drop the superadmin arms on PHI tables and `audit_log`; route through break-glass; restrict the avatars bucket. _(M)_
6. **H-2 + H-3 + H-4 + H-5:** server-derived high-alert flag and patient/encounter checks; surface `notified = 0` in triage; Kampala time zone for doses; glucose plausibility. _(S each)_

**Next quarter:**

7. **H-18 + H-19:** PGlite lane and RLS suites in CI, mobile jest in CI, branch protection; migration checksum, out-of-order refusal, nightly prod-vs-replay schema diff. _(M)_
8. **H-10 + H-9 + H-13:** actor GUC on every transaction, TRUNCATE guard, audit schema the app cannot own, PHI-read logging in shared helpers, a real four-eyes executor; demo data out of production. _(M–L)_
9. **H-7 + H-8 + M-19:** processor disclosure and AI consent, Analytics/Sentry scrubbing, POST search; stop writing patient names to `users`/auth metadata; encrypt clinical free text; mobile cache encryption and wipe on sign-out. _(M–L)_
10. **H-15 + H-16 + H-17 + H-12 + H-20 + H-6:** RESTRICT FKs; SQL-function encounter completion; freeze released results; server-side pre-alert limits; error boundaries; invert the CSO gate and wire every `SignedCopy`. _(M)_

---

## 9. Suspicions to verify

| Suspicion                                                                                                                                                                                     | How to confirm                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase default grants are live (ALL to `anon`/`authenticated` on new public tables), which M-1, M-3 and L-2 rely on                                                                         | `select has_table_privilege('authenticated','public.patient_places','INSERT');` and `has_column_privilege('authenticated','public.clinician_profiles','verified_at','UPDATE');` on production |
| `verify_jwt` is disabled for some Edge Function, which would let a forged `{"role":"service_role"}` JWT pass `system-*` (`_shared/system-actor.ts:37` reads the claim unverified)             | Supabase dashboard → Functions → settings, or `supabase functions list`; there is no `config.toml` in the repo                                                                                |
| Vercel preview deployments share the production database and env, in which case M-14 and H-6 apply to real data                                                                               | Vercel → Settings → Environment Variables, by scope                                                                                                                                           |
| Vercel Analytics records `?q=<patient name>` from reception search                                                                                                                            | Vercel Analytics dashboard → pages filter `/reception/find`                                                                                                                                   |
| `statement_timeout` (30 s) is not actually in effect through Supavisor                                                                                                                        | `SELECT current_setting('statement_timeout')` through the app pool in production                                                                                                              |
| CI was red (OOM) while PRs merged; `main` is unprotected                                                                                                                                      | `gh api repos/<owner>/medsync/branches/main/protection`; `gh run list --branch main --limit 50`                                                                                               |
| Closed encounters or resus episodes can be edited (CHECKs only, no transition trigger; the web writes as owner)                                                                               | Audit all `.update(encounters)` / `resus_episodes` sites for a state predicate; try a write on a closed row in the PGlite lane                                                                |
| The mobile emergency number (112, `status: "pending-moh-cso"`) and the web E1 sheet ("No verified emergency number") disagree; the web fallback labels a hospital number `verified` unchecked | `mobile/src/features/safety/config.ts:9-13` vs `app/emergency/_lib/sheet.ts` ~80-90; CSO decision                                                                                             |
| Account switching across tabs makes server actions run as the other account (clinical writes misattributed)                                                                                   | Two accounts, open a note form, switch in another tab, submit                                                                                                                                 |
| Android auto-backup copies AsyncStorage PHI to Google Drive                                                                                                                                   | Inspect the prebuilt `AndroidManifest.xml` `allowBackup`                                                                                                                                      |
| The 203 KB general formulary is in the clinician client bundle (`prescribe-dialog.tsx` → `lib/prescribing/formulary.ts`)                                                                      | `npm run analyze`                                                                                                                                                                             |
| Edge Functions behind reception actions share C-1's blindness to affiliation state                                                                                                            | Read `ha-check-in-patient`, `ha-register-intake`, `ha-book-on-behalf`: `authoriseAtHospital` state filter                                                                                     |
| `attachScan`'s `startsWith` path check can be escaped with `..` segments                                                                                                                      | Test a key `h/r/../../h2/x.pdf` against Supabase Storage                                                                                                                                      |
| Hospital admins can read all tester feedback in `/admin/feedback` (could carry PHI)                                                                                                           | `app/admin/feedback/page.tsx` has no superadmin check; test with a hospital_admin account                                                                                                     |
| The 3 mobile jest timeouts reappear on a CI runner                                                                                                                                            | **Resolved here:** they pass alone (15/15). They will matter only once jest runs in CI (H-18); set `testTimeout` for the render suites                                                        |
