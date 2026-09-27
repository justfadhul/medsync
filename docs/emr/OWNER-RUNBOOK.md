# EMR — the owner's path to production

Branch `feat/emr-engine`. Decisions: ADRs 0130–0139. Evidence: `STOP-REPORTS.md`. Follow the steps **in order**;
tick each box. Nothing in the EMR is live until step 8, and with `EMR_V1` unset every existing page behaves as before.

**Two rules that do not bend:**

- **Apply the migrations before you deploy the branch.** Drizzle's encounter inserts and both changed Edge Functions
  name the 0071 columns. Deploying first breaks Take & start and End visit for every hospital, flag or no flag (house
  rule for GATED migrations).
- **`.env.example` is not touched.** The one new variable, `MEDSYNC_NOTE_HMAC_KEY`, is documented here and in ADR 0132.

---

## 1. Create the dev project (O-1)

- [ ] Create a hosted Supabase project for development with **synthetic data only** (E1, ADR 0133).
- [ ] Put its pooler URL (port 6543) in a local `.env.local` as `DATABASE_URL`, with its `NEXT_PUBLIC_SUPABASE_URL`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Keep it separate from production.
- [ ] Apply every migration there: `npm run db:migrate` (0000–0075; `0074_emr_prescriptions.sql` is committed with
      Phase 7, `0075_cosign_policy_defaults.sql` with the owner-support round).

## 2. Generate the note-signing key (O-2)

- [ ] Generate 32 random bytes, base64: `openssl rand -base64 32`.
- [ ] Add it to Vercel **production and preview**: `npx vercel env add MEDSYNC_NOTE_HMAC_KEY production` (then
      `preview`). Add the dev project's own value to `.env.local`.
- [ ] Store a copy in the password manager. **Never change it once notes are signed.** Rotation is designed but not
      built: the app reads one key, and a second slot must exist before an old key can be retired (ADR 0132).

Without the key, signing refuses with "Notes cannot be signed yet… Your draft is kept." Nothing is lost.

## 3. Check the lane and RLS against the dev project

- [ ] Locally, the PGlite lane (no database needed): `npm run test:emr-db`. Expected: all green (327 lane tests after the
      owner-support round). Needs the PGlite symlink `node_modules/@electric-sql → ~/Desktop/emr-harness/pg/node_modules/@electric-sql`;
      without it every lane test skips.
- [ ] Against the dev project, the hosted RLS suites: `MEDSYNC_ALLOW_RLS_DB_WRITES=1 npx vitest run tests/rls`
      (they write fixtures; **dev project only, never production**).
- [ ] The EMR probes' hosted twin, `tests/rls/emr-access.test.ts`, runs with the command above; to run it alone:
      `MEDSYNC_ALLOW_RLS_DB_WRITES=1 npx vitest run tests/rls/emr-access.test.ts` (**dev project only**). It probes a
      subset of the PGlite matrix (4 tables, 5 actors, the reader path over `DATABASE_URL` and
      `private.patient_access_basis`, the client path through supabase-js). It leaves two fixture hospitals (slugs
      `rls-emr-fixture`, `rls-emr-fixture-b`), `rls-emr-*` users and append-only EMR rows behind; RESTRICT keys stop
      their deletion, as with the resus-v2 suite. Its fixture SQL has never met a real project, so a first failure may
      be the fixture, not the policy.
- [ ] Also run this **read-only** check in the dev project's SQL editor. Every row should say `true`:

```sql
-- RLS is enabled and FORCED on every new clinical table.
SELECT c.relname, c.relrowsecurity AS rls_on, c.relforcerowsecurity AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN (
  'clinical_notes','clinical_note_events','encounter_order_events','specimens','specimen_events',
  'diagnostic_reports','conditions','medication_statements','pregnancy_episodes','procedures',
  'allergies','allergy_status_assertions','result_acknowledgements','critical_result_communications')
ORDER BY 1;

-- The reader role exists and cannot bypass RLS.
SELECT rolname, NOT rolbypassrls AS obeys_rls, NOT rolcanlogin AS nologin
FROM pg_roles WHERE rolname = 'medsync_clinical_reader';

-- Client roles hold no write privilege on the new clinical tables.
SELECT NOT EXISTS (
  SELECT 1 FROM information_schema.role_table_grants
  WHERE grantee IN ('anon','authenticated') AND table_schema = 'public'
    AND privilege_type IN ('INSERT','UPDATE','DELETE')
    AND table_name IN ('clinical_notes','conditions','allergies','diagnostic_reports','result_acknowledgements')
) AS no_client_writes;

-- The access rule and the realtime guard are installed.
SELECT to_regprocedure('private.patient_access_basis(uuid,uuid,uuid)') IS NOT NULL AS access_rule,
       to_regproc('private.accessible_patient_ids') IS NOT NULL AS access_set,
       to_regproc('private.may_hear_chart') IS NOT NULL AS realtime_guard;

-- ICD-10 cannot be written (O-3).
SELECT count(*) = 2 AS icd10_locked FROM pg_constraint
WHERE conrelid IN ('public.diagnosis_terms'::regclass, 'public.conditions'::regclass)
  AND pg_get_constraintdef(oid) ILIKE '%icd10_who_code IS NULL%';
```

- [ ] On the dev project, time the fact loader (the PGlite p95 was 91 ms at 2,000 facts against a 60 ms budget) and
      check that a second browser receives a `chart:<patient>` ping. Both are open budget items that only a hosted
      database can close.

## 4. Count the legacy rows (O-4) — before anything is retired

- [ ] Run in **production**, read-only: `npm run emr:legacy-counts` (takes `DATABASE_URL` from the environment or
      `.env.local` and prints the target host first; check it). It runs the SQL below verbatim, and adds the "after
      0071" block by itself once `public.allergies` exists. Keep the output with the release notes.

For reference, the SQL it runs:

```sql
-- O-4: legacy EMR rows. Read-only.
SELECT 'patient_allergies' AS tbl, count(*) FROM public.patient_allergies
UNION ALL SELECT 'problem_list', count(*) FROM public.problem_list
UNION ALL SELECT 'encounter_diagnoses', count(*) FROM public.encounter_diagnoses
UNION ALL SELECT 'encounter_medications', count(*) FROM public.encounter_medications
UNION ALL SELECT 'encounter_results', count(*) FROM public.encounter_results
UNION ALL SELECT 'clinical_documentation', count(*) FROM public.clinical_documentation
UNION ALL SELECT 'care_plan', count(*) FROM public.care_plan
UNION ALL SELECT 'clerkship_drafts (all)', count(*) FROM public.clerkship_drafts
UNION ALL SELECT 'clerkship_drafts (plaintext, O-5)', count(*) FROM public.clerkship_drafts
  WHERE NOT (payload ? 'enc')
UNION ALL SELECT 'clinical_observations', count(*) FROM public.clinical_observations
UNION ALL SELECT 'encounter_orders in flight (ordered/collected)', count(*) FROM public.encounter_orders
  WHERE status IN ('ordered','collected')
UNION ALL SELECT 'resus AMPLE captures', count(*) FROM public.resus_timeline_events
  WHERE kind = 'note' AND payload ? 'allergyCapture'
UNION ALL SELECT 'open encounters', count(*) FROM public.encounters
  WHERE state IN ('planned','in_progress')
UNION ALL SELECT 'resus handoffs pending', count(*) FROM public.resus_episodes
  WHERE pending_encounter_handoff;
```

After 0071 is applied, the script adds these (the columns exist only then):

```sql
SELECT 'clinical_observations (legacy)' AS tbl, count(*) FROM public.clinical_observations WHERE concept_id IS NULL
UNION ALL SELECT 'encounter_orders (legacy lifecycle)', count(*) FROM public.encounter_orders WHERE lifecycle = 'legacy'
UNION ALL SELECT 'allergies backfilled, no v2 yet (O-5)', count(*) FROM public.allergies a
  WHERE a.legacy_ref IS NOT NULL AND a.version = 1
    AND NOT EXISTS (SELECT 1 FROM public.allergies b WHERE b.logical_id = a.logical_id AND b.version > 1);
```

## 5. Apply the migrations in production (O-7)

- [ ] Confirm steps 1–3 are green on the dev project.
- [ ] `npm run db:migrate` with the **production** `DATABASE_URL`. It applies 0071, 0072, 0073, 0074 and 0075 in name order, one transaction per
      file, and records each in `_medsync_migrations`. It also applies the hub's 0080 if that is pending; the sets
      coexist in either order (HARMONISATION §9; replayed in PGlite both ways, 0071–0075 after 0080 included).
- [ ] 0075 (co-sign policy defaults) does not depend on 0071–0074 and may go first. Before applying, count the
      hospitals it will backfill (those with no policy row at all); afterwards the same query must return 0:

```sql
SELECT count(*) FROM public.hospitals h
WHERE NOT EXISTS (SELECT 1 FROM public.clinical_cosign_policies p WHERE p.hospital_id = h.id);
```

- [ ] A hospital with only **some** of the default rows is not backfilled (possible if 0030, 0031 and 0036 went in at
      different times with a hospital created between). Find them, and fill only the missing defaults for one
      (existing rows are never overwritten):

```sql
SELECT h.id, h.name, count(p.id) FROM public.hospitals h
JOIN public.clinical_cosign_policies p ON p.hospital_id = h.id AND p.department_id IS NULL
GROUP BY 1, 2 HAVING count(p.id) < 54;
-- then, per hospital id listed:
SELECT private.seed_cosign_policy_defaults('<hospital id>');
```

- [ ] Re-run the step 3 SQL in production. The backfill copies allergies once; a re-run adds nothing.

## 6. Deploy the two changed Edge Functions

- [ ] `npx supabase functions deploy ha-start-encounter --use-api`
- [ ] `npx supabase functions deploy ha-complete-encounter --use-api`

Both keep their old behaviour for callers that send none of the new fields (ADR 0139).

## 7. Deploy the branch

- [ ] Run `npm run build` once before deploying. In the build output, check that `/doctor/encounters/[encounterId]`
      does not load the desk's code when `EMR_V1` is unset. The desk now loads through `next/dynamic`, but the size of
      that split has not been measured. Record the route's added JS against the 90 KB gz budget: it was +89.7 KB at
      STOP 5–6, and the P7 prescriptions panel has been added since.
- [ ] `npx vercel deploy --prod --yes`. With `EMR_V1` unset, every page is the page it was.

## 8. Switch the EMR on

- [ ] **Drain `/lab` first:** under the flag it lists only new-lifecycle orders, so let legacy in-flight orders (step 4
      row "in flight") reach a result.
- [ ] `ENCOUNTER_ENGINE_LIVE=1` must already be set; `EMR_V1` does nothing without it.
- [ ] Set `EMR_V1` to **one or more hospital ids**, comma-separated (Mulago first). Redeploy. Watch a working day.
- [ ] Then `EMR_V1=1` for every hospital.
- [ ] **Later**, after Phase 7 and its own sign-off: `EMR_PRESCRIBING=1` (prescribing from the encounter; only where
      `EMR_V1` is on).
      A senior's "returned" co-sign cancels the prescription and stops its medication statement in the same
      transaction (closed after STOP 7–8), so the desk, the printout and the chart's Medicines agree it is not valid.
      Co-sign defaults are seeded for every hospital by 0075 (and for new hospitals at creation). **Check** first that
      the step 5 count is 0; prescribing fails closed for a hospital with no policy rows.
- [ ] When the flag first goes on, copy the AMPLE allergies captured while it was off into the record
      (`scripts/emr/backfill-allergies.ts`, proposal §H.3). It replays 0071 §15, so it copies nothing twice.
  - Dry run: `npm run emr:backfill-allergies`. Prints the host, then "Would copy: N allergies, M NKDA assertions"
    (it runs the inserts in a transaction and rolls back: brief locks, possible sequence gaps, nothing saved).
  - Apply: `npm run emr:backfill-allergies -- --apply --actor <your auth.users id>`. A second `--apply` reports 0/0.

## 9. Re-encrypt old plaintext (O-5)

Two scripts (ADR 0132, ADR 0135). Both read `DATABASE_URL` from the environment or `.env.local`, print the target
host first, and only count without `--apply`. `MEDSYNC_PHI_KEY` must be the **production** key. `--actor` must be an
existing `auth.users` id (it is the audit identity and `recorded_by`); `--apply` without a valid uuid is refused before
any connection. Both are idempotent.

- [ ] **Old NCD drafts:** each `clerkship_drafts` row whose `payload` has no `enc` key becomes
      `{ "enc": encrypt(JSON.stringify(payload)) }` (`lib/encryption.ts`; `updated_at` unchanged). The reader accepts
      both shapes, so it can run at any time.
  - `npm run emr:reencrypt-drafts`, then `npm run emr:reencrypt-drafts -- --apply --actor <uuid>`.
  - A re-run says "Plaintext drafts: 0".
- [ ] **Backfilled allergies** (run the §8 backfill first): the current version of each item with a `legacy_ref` and no
      ciphertext gets a next version (same `logical_id`, `supersedes_id` = that version) carrying
      `substance_text_ciphertext` encrypted from the untouched source text. Must finish **before** any legacy table is
      retired.
  - `npm run emr:encrypt-allergy-text`, then `npm run emr:encrypt-allergy-text -- --apply --actor <uuid>`.
  - Rows whose source text is gone are left unchanged and counted as "Source text missing": look at them before
    retiring anything. Afterwards, the §4 row "allergies backfilled, no v2 yet" is 0 or equals that missing count.

## 10. Owner decisions

- [ ] **O-3 — ICD-10 licence.** Apply to WHO. Until it is held, ICD-10 stays present, unused and never exported
      (`THIRD-PARTY-NOTICES.md`). After: a new migration drops the two CHECKs, and the notices file is updated.
- [ ] **O-6 — Playwright.** Today: PGlite-lane scenarios, axe over server HTML and CDP screenshots. Decide whether to add
      Playwright (a new dependency).
- [ ] **O-8 — Cross-hospital allergies** (with the CSO, DPA/MoU in view). As built, a clinician with a basis at their
      own hospital sees, and prescribing checks against, the patient's allergies from every hospital, labelled by
      source. Confirm, or ask for hospital-scoped reads.
- [ ] **O-9 — Operational defaults** (`lib/emr/settings.ts` and proposal §H.2; not clinical numbers):
  - [ ] note autosave 1.5 s after typing pauses, plus on section change and `visibilitychange`;
  - [ ] late-entry label past 24 h between effective and signed time;
  - [ ] encounter or draft idle → Needs closing after 24 h (the Workspace constant);
  - [ ] server-clock skew warning 30 s, offset refetch every 5 min;
  - [ ] realtime fallback poll 15 s while visible;
  - [ ] duplicate vitals flagged (not merged) within 10 minutes;
  - [ ] administrative-closure reasons: left before seen, duplicate encounter, documented elsewhere, opened in error,
        other (text).
- [ ] **Design tokens fail WCAG AA product-wide** (teal-600 text 3.7:1, caution pair 2.8:1, critical pair 3.9:1). The EMR
      fixed its own files only; decide in `DESIGN-medsync.md`.

## 11. CSO confirmations (collected from STOP-REPORTS)

Nothing below blocks switching the flag on: each mechanism ships and shows no number, or behaves conservatively, until
signed.

- [ ] **Urea in mg/dL** is read as urea nitrogen (the spec's factor). A report of urea mass in mg/dL needs its own unit.
      Confirm.
- [ ] **Chest X-ray marked ionising** on the test menu (it drives the "check pregnancy status" prompt). Confirm.
- [ ] **Allergy record unavailable at emergency administration:** the dose is still recorded after the amber warning
      and stamped `allergyRecord='unavailable'`. Confirm, or require an override reason.
- [ ] **Restricted result under cover:** a covering clinician sees "Restricted result" with a lock and can still
      acknowledge. Confirm.
- [ ] **Dipstick answer sets** (urine blood, leucocytes) reuse the v1 scale; confirm against the strips in use. Also the
      Xpert result wording and blood-group answer ids (concept JSON `openConfirmations`).
- [ ] **ACVPU `C`** has no AVPU answer; those triage readings are quarantined until a concept is signed.
- [ ] **Reference entries to sign** (`lib/emr/reference/*.ts`, all `pending_cso`, values withheld):
  - [ ] REF-CRIT-\* critical limits and REF-CRIT-TIMEFRAME (with the laboratory lead);
  - [ ] REF-PLAUS-\* plausibility bounds;
  - [ ] REF-HMIS-ATTENDANCE, REF-HMIS-AGEBANDS, REF-HMIS-MAP;
  - [ ] REF-IDSR-CLASSES, REF-IDSR-SCREEN;
  - [ ] REF-PREG-AGE, REF-PREG-POSTPARTUM (the pregnancy line stays hidden until signed);
  - [ ] REF-DM-FASTING-DEF;
  - [ ] REF-DX-TESTFIRST.
- [ ] **The 85 draft diagnosis terms** (13 restricted; REF-DX-TERMS): confirm each ICD-11 code at icd.who.int (today
      verified-mirror only) and sign.
- [ ] **Entered-in-error notes seen by the patient** show "Entered in error" without the reason; before, the reason
      reached the patient. Confirm.
- [ ] **Prescribing with the allergy status unknown** ("not recorded" or "unable to assess"): the sheet shows amber
      words and the server records nothing. Decide whether a confirm reason is required.
- [ ] **Forms to confirm:** the HMIS 032 referral field list, the national cause-of-death form and MPDSR pathway, PF3/PF3A,
      the UCG 2023 malaria wording and page, and the minor/guardian model.

## 12. Known open items (not owner actions, recorded so nobody is surprised)

- Printouts leave encrypted narrative as write-in lines. "Page x of y" needs Chrome ≥ 131.
- The nurse orders panel (collect specimen, print label) shows this visit's orders a second time below the chart's
  read-only list. UX polish, not a safety issue.
- Resus-handover proposed orders stay authored by the resus leader, so results-to-review follows the leader, not the
  clinician who accepted (clinical decision; STOP-REPORTS owner-support round).
- The legacy TS access resolvers still decide legacy surfaces (convergence, HARMONISATION §7). 0040 still lets a
  patient read their own legacy rows.
