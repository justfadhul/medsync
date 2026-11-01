# Claude Code handoff

For a Claude Code session picking this repo up without the previous session's local memory (a cloud session at claude.ai/code, or a new machine). Read `AGENTS.md` first, then this. Updated 2026-10-03.

**Pharmacy (Phases 0 and 1, the national-list catalogue):** see [`docs/pharmacy/HANDOFF.md`](pharmacy/HANDOFF.md) (17 Oct 2026). It supersedes anything below about pharmacy.

## Who decides

- **Fadhul is the owner and the Clinical Safety Officer (CSO).** Clinical content (catalogues, scales, flag rules, reference values, doses, CFC concepts) is data and needs the owner's signature before it goes live. Ask for signatures with AskUserQuestion, one decision per question, with a recommended option first. Record what was signed in the gate record and, for catalogues, in the sign-off file that pins the catalogue's SHA-256.
- Big prompts run **gated** (STOP 0 … STOP N): discovery, a GATE A proposal and signatures, then build, with a STOP report per phase. "Go through all gates" means run them all in one go, stopping only for signatures.

## Owner rules (settled; don't re-argue)

- **`.env.example` is never staged or committed** (it carries the owner's uncommitted work).
- **The owner applies migrations and deploys.** Migrations are applied with `npm run db:migrate` **in the folder of the branch that holds them** (a worktree borrows the main checkout's `.env.local`); always tell the owner the exact `cd` (see `AGENTS.md`, Applying migrations). Never run `npm run db:migrate` against production, `vercel deploy --prod`, or pushes to `main`. After each build, list the exact migration names and order.
- **Never copy or print secrets.** The owner's local `.env.local` in the main folder is production; cloud sessions have no production keys and must not be given them.
- **No fabricated data** anywhere (patients, ratings, phone numbers, doses).
- **Migrations are immutable** once written to `supabase/migrations/`; add a new file. GATED migrations carry a header and are owner-applied.
- **Pop-ups are centred landscape dialogs** (`EditorDialog`, ADR 0161); nothing slides in from an edge except the phone menu.
- **Keep agent use low.** Build directly; use at most two or three subagents for large, disjoint work, and only when it pays.
- When a new prompt conflicts with a committed ADR, surface the conflict and ask; record reversals as new ADRs.

## Where things are (branch `feat/clerking-exam-v2`)

| Work                                                      | State                                                                                                                                                                                         | Record                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Clerking desk v2 (history)                                | done, behind `CLERKING_V2`; migration 0076                                                                                                                                                    | `docs/emr/clerking-v2/STOP-REPORTS.md`, ADRs 0163–0168            |
| v2 on a phone                                             | done                                                                                                                                                                                          | `docs/emr/clerking-v2/mobile/STOP-REPORT.md`, ADR 0169            |
| Examination v2 (step 07)                                  | done, all 8 gates                                                                                                                                                                             | `docs/emr/clerking-v2/exam/STOP-REPORTS.md`, ADRs 0170–0175       |
| CFC addenda v1.2 / v1.3                                   | signed and built                                                                                                                                                                              | `docs/emr/cfc/cfc-migrations-proposal.md`, ADR 0176               |
| Legacy symptom conversion                                 | signed and built (no migration)                                                                                                                                                               | `docs/emr/clerking-v2/legacy-conversion-proposal.md` §7, ADR 0177 |
| CFC addendum v1.4 (three history findings)                | **awaiting the CSO's signature**; nothing built                                                                                                                                               | `docs/emr/cfc/cfc-v1.4-proposal.md`                               |
| MedSync Chroma (design system)                            | merged into this branch 2026-09-28; the clerking desk and chart restyled to it (iris for place, heading weights from the tokens)                                                              | ADR 0162, `tests/design/clinical-chroma.test.ts`                  |
| Operations, occupations and CAGE pick lists               | built; data files are drafts awaiting CSO review                                                                                                                                              | `data/clerking/{operations,occupations,cage}.v1.json`             |
| Summary (08) and Impression (09)                          | GATE A signed 2026-09-28; built behind `CLERKING_V2`, all 7 phases; clinician trial the owner's                                                                                               | `docs/emr/clerking-v2/summary-impression/STOP-REPORTS.md`         |
| Plan (10) by problem, prescribing, charts                 | built on `feat/clerking-plan-v2` behind `CLERKING_PLAN_V2`, all 7 phases; ADRs 0184–0190 proposed; migrations 0087–0089 applied by the owner                                                  | `docs/emr/clerking-v2/plan/STOP-REPORTS.md`                       |
| Ward builder and the live bed board                       | built on `feat/ward-builder` behind `WARD_BUILDER`, all 7 phases; ADRs 0191–0196 proposed; migration 0090 applied by the owner 2026-09-30                                                     | `docs/wards/ward-builder/STOP-REPORTS.md`                         |
| Closing the encounter: admission with a bed, patient copy | built on `feat/encounter-closure` (worktree `medsync-closure`) behind `ENCOUNTER_CLOSE_V2` and `PATIENT_VISIT_SUMMARY`, all 7 phases; ADRs 0197–0203 proposed; migration 0091 **not applied** | `docs/emr/closure/STOP-REPORTS.md`                                |

**Migrations (owner):** 0076 → 0082 → 0083 → 0084 → 0085, all applied by the owner (0084 and 0085 on 2026-09-28: the `confirm_diagnosis` co-sign kind, and the 187 REF-DX-TERMS v1.1 terms seeded uncoded). `npm run db:migrate` applies whatever is pending in file order. 0086 (the signed ICD-11 codes for 177 of those terms, ADR 0183) was applied by the owner and is merged into `feat/ncd-diabetes-pack` so `main` matches the database. The Plan's **0087 → 0088 → 0089** (GATED, on `feat/clerking-plan-v2`) were applied by the owner on 2026-09-28 from a worktree of that branch; they are safe while `main` is deployed. `CLERKING_PLAN_V2` stays off until the branch is deployed and the owner turns it on. The ward builder's **0090** (GATED, on `feat/ward-builder`) was applied by the owner on 2026-09-30 by fetching that one file into the main folder (whose checkout is older and holds uncommitted calendar work), and the owner ran the ward builder on localhost from a worktree of the branch with `WARD_BUILDER=1`. It only adds tables, columns and a function, so it is safe while `main` is deployed; `WARD_BUILDER` stays off in Vercel until the branch is merged and deployed. The closure build's **0091** (GATED, on `feat/encounter-closure`) is written and tested on the PGlite lane, not applied; it needs 0090 first and the three Edge Functions (`ha-complete-encounter`, `ha-services-hub`, `ha-book-on-behalf`) deployed after it. The next new migration is 0092.

**Open for the owner:** the clinician trial (protocol `docs/emr/clerking-v2/clinician-trial.md`); real-device timing on a mid-range Android; production counts listed in the exam STOP 0; symptom codes promoted in production through the 0044 governance (`origin='approved'`), which the legacy conversion table cannot see and carries as text until they get rows.

## Checks

```sh
npm ci
npm run typecheck
npm run lint                 # 2 warnings predate this work
npm run clerking:catalogue-check
SKIP_ENV_VALIDATION=1 EMR_PGLITE=1 npx vitest run    # full suite incl. the PGlite database lane (no real DB)
npx tsx scripts/emr/gen-seed.ts                       # regenerates 0072/0082/0083/0085 + lib/facts/catalogue.generated.ts
npx tsx scripts/prescribing/gen-formulary.ts         # regenerates lib/prescribing/reference/general-formulary.ts (MS-RX-CAT-001)
```

- `tests/emr/seed.test.ts` fails if a generated file drifts from its data.
- The Next build needs more heap on small machines: `NODE_OPTIONS=--max-old-space-size=6144`.
- The ward builder's screens render from synthetic fixtures at `/styleguide/ward-builder/[screen]` (in the repo, off unless `MEDSYNC_FIXTURES=1`; data in `tests/wards/fixtures.ts`).
- Screenshots were taken with a local CDP harness outside the repo (a fixture route at `/styleguide/emr-fixture/[screen]` mounting the real desk with `tests/clerking/fixtures.ts` and `tests/clerking/exam-patients.ts`). It is not in the repo; recreate it if screenshots are needed.

## Cloud sessions

- `.claude/settings.json` runs `npm ci` at session start, only when `CLAUDE_CODE_REMOTE=true` and `node_modules` is missing; it does nothing locally.
- On the cloud image's npm 10, `npm ci` fails ("package.json and package-lock.json … not in sync", `esbuild@0.28.2`), so the hook leaves no `node_modules`. `npx -y npm@11 ci` (the npm that ships with Node 24) installs cleanly without touching the lock file.
- The WHO ICD-11 API is reachable from the cloud environment (`icdaccessmanagement.who.int`, `id.who.int`, `icd.who.int` allowed; credentials in `ICD_CLIENT_ID` / `ICD_CLIENT_SECRET`, never printed). Codes are read there, never from a mirror or memory (ADR 0183).
- The cloud environment sets `SKIP_ENV_VALIDATION=1` and holds **no production keys**. Work that needs a real database (migrations, production counts) stays with the owner.
- `.nvmrc` pins Node 24; the cloud image defaults to Node 22. If a check behaves differently, say so rather than working around it.
- Pushing a branch from the cloud is fine; pushes to `main` and deploys are the owner's.

## Only on the owner's Mac (not on GitHub as of 2026-09-28)

- The main folder (`feat/booking-app`) has uncommitted work: the schedule calendar reskin, the tester feedback form.
- Several older branches were never pushed (`feat/emr-engine`, `feat/onboarding-v2`, `feat/resus-desk-v2`, `feat/hospital-services-hub`, `release/chroma-reskin`); some may already be in this branch's history.

Ask the owner before assuming any of these exist.
