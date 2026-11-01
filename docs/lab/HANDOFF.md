# Lab handoff (17 Oct 2026)

For the Claude Code session that continues the laboratory work in `~/Desktop/medsync` (the main folder, on `main`).
Read `AGENTS.md` first, then this file. It supersedes the lab parts of `docs/CLAUDE-HANDOFF.md` (3 Oct).

## 1. Who decides, and the rules that are settled

- **Fadhul is the owner and the Clinical Safety Officer (CSO).** Clinical values, wording and mappings are signed by
  him, in the product or by his own edit. Use AskUserQuestion for a real decision, one question at a time, with a
  recommended option first. "Go through all gates, use your recommendations" means: take the recommendations as the
  decisions and record them as "accepted as recommended on the owner's instruction, {date}". It never means that a
  clinical value, wording or mapping is signed.
- **Claude must not edit a signed-copy status** (`LAB2_COPY_STATUS`, `LAB3_COPY_STATUS` and the like). The permission
  system blocks it, rightly. Show the owner the file and line, and give the exact text to type. He edits; Claude may
  then commit and push his change if he asks.
- **`.env.example` is never staged or committed.** It carries the owner's own uncommitted edit; leave it alone.
- **The owner applies migrations and deploys.** Never run `npm run db:migrate` against production yourself, never
  `vercel deploy --prod`, never push to `main`. Give him the exact commands, in order, with the folder to run them in.
  A read-only `npm run db:migrate -- --dry-run` is fine for checking what is applied.
- **Ask before every push.** He merges PRs on GitHub (`gh` is not installed: give him the compare link, a title and a
  description to paste).
- **No fabricated data.** Fixtures in tests and harnesses are named as fixtures. No clinical numbers in code, seeds or
  copy. Never use the CBC report photo the owner once shared (a real patient's record).
- **Migrations are immutable once applied** (and once shipped). Add a new file. GATED migrations carry the header.
- **Numbers:** read `docs/NUMBERS.md` and claim a block there before writing a migration or an ADR. As of today,
  `main` holds migrations up to **0136** (pharmacy) with the lab at **0112–0118**, and ADRs up to **0311** (lab
  0300–0311; pharmacy 0281–0282). Lab spares 0119, 0150–0159 and ADRs 0312–0319 were released.
- **Design:** `DESIGN-medsync.md` wins. Centred `EditorDialog` only. No red except genuine emergencies and signed
  critical results; Lab Phase 3 uses no red and no green at all. Tokens only. en-GB, dates as `13 OCT 2026`.
- **Plain-language reports.** STOP reports and final reports are written for the owner: short sentences, tables,
  every gap stated.

## 2. Commands that work here

```bash
# typecheck (needs the larger heap)
NODE_OPTIONS=--max-old-space-size=8192 NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 npx tsc --noEmit
npm run lint            # 2 old warnings in scripts/embed-bench.mjs are expected
# full suite, including the PGlite database lane
SKIP_ENV_VALIDATION=1 EMR_PGLITE=1 NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 npx vitest run
# production build
rm -rf .next && SKIP_ENV_VALIDATION=1 NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 \
  NODE_OPTIONS=--max-old-space-size=8192 npm run build
```

- **Committing:** run `git commit` with `NODE_OPTIONS=--max-old-space-size=8192` in front, or the pre-commit
  typecheck runs out of memory (the commit then silently does not happen; check `git log -1`).
- **commitlint:** types `feat|fix|chore|docs|security|style|refactor|test|perf|build|ci|revert` only (`content` is
  refused). Header and every body line at most 100 characters. End the body with the co-author line.
- Database tests use the PGlite lane (`tests/emr-db/_pglite.ts`, `bootLane`); every lab scenario test lives there.

## 3. Where the lab stands

All four lab phases are merged to `main`.

| Phase                                     | Record                                                | State                                                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Front door                              | `docs/lab/phase-0/`                                   | Live                                                                                                                                         |
| 1 Safety floor (criticals, units, ranges) | `docs/lab/phase-1/`                                   | Live; copy signed 12 Oct                                                                                                                     |
| 2 One menu, one record (catalogue v2 …)   | `docs/lab/phase-2/FINAL-REPORT.md`, `STOP-REPORTS.md` | Migrations 0107–0111 applied; copy signed 13 Oct; wording review of 807 lines done 13 Oct; **v1.6 addendum not yet signed** (lead, then CSO) |
| 3 Registers, reports and quality          | `docs/lab/phase-3/FINAL-REPORT.md`, `STOP-REPORTS.md` | Migrations 0112–0118 applied; copy signed 16 Oct (PR #237); flags set for **Test Hospital-1**                                                |

Phase 3 in one paragraph: a stock ledger with lot acceptance and FEFO; equipment on the widened `devices` table, with
breakdowns written through the hub's own `report_problem`; QC with Westgard rules, the release hold in
`writeReportVersion` (the single release path), the override and the look-back; nonconformities; EQA; bedside device
checks and competency; the daily register; the HMIS 105 laboratory section (counted, checked, signed, revised, printed,
CSV); lab reports and quality indicators. Every signed item is a kind in `lab_signed_configs`.

Signers: the laboratory lead is whoever holds an open `department_heads` row for the Laboratory department (on the
trial hospital that is the "Trial lab lead" account). The CSO signs at `/admin/lab-signoffs`. HMIS In-Charge and focal
person are set in `hmis_designations` (the HMIS desk at `/hmis`).

## 4. What is open (in the order the owner will meet it)

**Owner actions** (Claude prepares, the owner does):

1. Sign the **v1.6 catalogue addendum**: the lab lead at `/lab/setup/drafts`, then the CSO at `/admin/lab-signoffs`.
   Signing asks for a fresh authenticator code; the owner asked about skipping it and then set that aside. If he asks
   again: `DEV_SKIP_MFA` does not cover `secondFactorFresh()`, and a bypass there is his own edit, with every signature
   made under it re-signed before go-live.
2. Phase 3 sign-offs in the product, by the lab lead: QC plans and the QC policy (the CSO countersigns the hold), kit
   and stain rules, acceptance plans, stock levels, equipment schedules and temperature ranges, EQA schemes, bedside
   device rules, strip-lot ranges, competency validity, register columns (from photos of the paper registers).
3. The CSO signs the Phase 3 hazard log, the user guide and permission map v2 (`data/lab/permission-map.v2.json`).
4. Roll the Phase 3 flags on per hospital in order: `LAB_STOCK` → `LAB_EQUIPMENT` → `LAB_QC` (logging, at least 20
   days) → `LAB_QC_HOLD` (once every live quantitative test has a signed plan) → `LAB_EQA` → `LAB_POCT_QUALITY` →
   `LAB_REPORTS` → `LAB_HMIS`. A technician sees the Quality group; set-up and signing appear for the lab head.
5. **HMIS 105, later** (only before `LAB_HMIS`): the printed form (2019 print version) or the eHMIS export to verify
   the 134 rows in `data/lab/hmis105-2019-09.json`, and the eHMIS data-element, category-option and organisation-unit
   ids for the CSV. The how-to was given to the owner on 16 Oct (eHMIS is DHIS2 at hmis.health.go.ug; four API links).
   Then name the In-Charge and the focal person, run one parallel month with the paper tally
   (`docs/lab/phase-3/parallel-run.md`), then stop the paper tally.
6. Timed trials with two or three lab users (QC run, a delivery, a bedside check), and the bench timings with
   `scripts/lab/bench-timing.js` (instructions in its header).
7. Unset `DEV_SKIP_MFA` before real patients or staff use the platform.

**Known gaps in the code** (none blocks the rollout; details in each final report):

- Phase 3: QH-5 "Run on another analyser" names analysers but cannot move the specimen; lot-comparison samples are
  stored as "Sample n", not result ids; certificates and EQA reports are reference text (no storage bucket); no
  "Book reassessment" store and no competency revocation; four indicators show on the EQA and stock pages rather
  than the reports page; the admin view has its own window and there is no In-Charge or focal-person screen; the
  look-back window for a downtime result uses its entry time; minor axe `empty-table-header` on three tables.
- Phase 2: the diabetes pack keeps its own lab reader (NF-8, set aside by the CSO until the pack's go-live); the
  DH-615 research-use list may be incomplete (the lab lead confirms on the analyser).

## 5. Traps already met (do not repeat)

- **Files read at request time must be traced.** Vercel only ships files whose paths it can see. A path built from a
  constant broke `/lab/setup/drafts` in production; `next.config.ts` `outputFileTracingIncludes` now lists the lab's
  data files. Add any new runtime-read file there and check the route's `.nft.json` after a build.
- **A server component must not call a function exported from a `"use client"` module** (it crashed the EQA page).
  `tests/design/client-call-from-server.test.ts` guards the lab trees.
- **One database connection per request** inside a transaction: read through the transaction, never the global
  client (a second pool connection hung the harness).
- **`lab_qc_runs."values"`** must be quoted (reserved word).
- **Release is per report.** A held QC component stays preliminary inside a final report and is released later by a
  completion version (E-LAB3-08); do not add a new report status.
- **The engine and the database must agree.** The lot transitions are checked against migration 0112 by
  `tests/lab/phase-3/lot-transitions-parity.test.ts`; keep such pairs in step.

## 6. Local things outside the repo

- `git stash` in the main folder holds "main-folder snapshot before switching to main, 2026-10-17": the old calendar
  draft and booking-app leftovers. It is stale (`main` has later versions) and conflicts if applied. Do not apply or
  drop it without asking.
- The lab screenshot harnesses (`lab0-harness`, `lab3-harness`) were deleted on 17 Oct. A new one, if needed,
  boots the PGlite lane locally and never touches a remote database (see `docs/lab/phase-3/FINAL-REPORT.md`).
- `~/Desktop/medsync-pharm1` is the pharmacy worktree; not lab work, leave it alone.
- Decision and review pages the owner used (claude.ai artifacts): Phase 2 CSO decisions
  https://claude.ai/artifact/HxcV7qKXZg2XswqJa2iMqd and the Phase 2 wording review
  https://claude.ai/artifact/1MhjgdMdKonfVXBmMHVMNE; the Phase 3 UI canvas
  https://claude.ai/artifact/WyFvKanF3KcGNCYMDhXphi.

## 7. Starting the next session

1. `git status` and `git log --oneline -5` in `~/Desktop/medsync`; `git fetch` and confirm `main` is current.
2. Read this file, then the final report of the phase you are touching.
3. Ask the owner what is next. Likely: help with the addendum and Phase 3 sign-offs, the HMIS form when he has it,
   a fix from the gap list, or Lab Phase 4 (referral tracking, microbiology, analyser interfaces).
