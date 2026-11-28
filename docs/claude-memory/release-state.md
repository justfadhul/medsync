---
name: release-state
description: Git/release state found 2026-09-25 — main tree == feat/onboarding-v2 tip, 32 local-only commits, origin/main last merged 11 Sep, merge to main likely deploys prod; commit & merge plan doc
metadata:
  type: project
---

Found 2026-09-25 (plan doc "MedSync — Commit & Merge Plan": https://claude.ai/code/artifact/613f2cdf-2884-4b3a-b071-4fe668c0134f):

- The main folder's working tree (branch feat/doctor-workspace @ c555aaf + 448 uncommitted files) is byte-identical to
  `feat/onboarding-v2` tip `af174d0` except `.env.example` (checked with a scratch GIT_INDEX_FILE + `git add -A`).
  `a7b784a` = one lumped baseline snapshot (324 files, ~8 features: plum 0097, landing 0099, 0100, 0101, 0112, doctor
  workspace 0113–0118, auth fixes, skills refresh); then 4 onboarding v2 commits.
- 32 commits exist only locally: 27 on feat/booking-app since `origin/feat/booking-app` e7af753 (21 Sep; resus v2,
  ADR 0098) + 5 on feat/onboarding-v2. Migrations 0066–0070 (all applied in prod) are not on GitHub.
- Local `main` is stale (20 Jun). `origin/main` was last merged 11 Sep (PRs #180 bionic islet bench, #181 ncd-diabetes);
  it has 18 commits we lack (bench, /bioniccell). Trial merge: 4 additive config conflicts (next.config.ts,
  eslint.config.mjs, tsconfig.json, .prettierignore) — keep both. `/bioniccell` is 404 in prod today.
- Vercel likely auto-deploys `main` to Production (prod deploys of main on 10–11 Sep). Previews fail (no DB env).
- Repo github.com/justfadhul/medsync is private; `gh` CLI not installed.

**Why:** the progress report's "main 186 behind" came from the stale local main; this is the corrected picture.
**Done 2026-09-25 16:20:** baseline split into 9 feature commits via plumbing (scratch index + commit-tree,
trees verified identical; script kept at session scratchpad split.py), v2 commits replayed; `feat/booking-app` moved to
`beeb109` and PUSHED; the main folder now sits on `feat/booking-app` (only `.env.example` dirty). Local-only on top:
`57cc578` merge of origin/main (keep-both conflicts), `cda3efb` a11y fixes, `004772d` Prettier + `data/` in
.prettierignore — full CI set green (3,841 pass). The auto-mode classifier refused BOTH `git push origin
feat/booking-app` and `...:main` as [Production Deploy] once main was in the command — the owner runs them. Old branches
feat/doctor-workspace, feat/resus-desk-v2 (c555aaf), feat/onboarding-v2 (af174d0, old lumped history) and the two
worktrees are now redundant; local `main` still stale until fetched after the owner's push.
**How to apply (history):** owner decisions were pending in the plan doc (safety push to backup/2026-09-25, history A vs split B,
contact sheet, /bioniccell, merge timing, deploy-from-main). Pushing publishes to GitHub — get the owner's go first.
**Update 2026-10-03:** superseded — the owner pushed; origin/main now carries everything through PR #193 (8e45d34). Live state is in `docs/CLAUDE-HANDOFF.md` on origin/main ([[cloud-handoff]]).
Related: [[progress-report-doc]] [[onboarding-v2-build-state]] [[doctor-workspace-build-state]]
