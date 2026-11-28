---
name: lab-test-menu-v2-build
description: Lab test menu v2 built 19 Oct 2026 on feat/lab-test-menu-v2 (worktree medsync-tm2), commit 3cd40093, not pushed; 0171–0173 unapplied
metadata:
  type: project
---

All 12 steps done and green; GATE A signed by the CSO on the recommendations as written. Commits 3cd40093, b68818cb, 3486d693 on feat/lab-test-menu-v2, worktree ~/Desktop/medsync-tm2, not pushed.

**Why:** the owner applies migrations and pushes.

**How to apply:** owner order is 0171 → 0172 → 0173, then `npm run lab:migrate-offerings` (dry run, then `--apply --actor`), then redeploy ha-services-hub. The addendum `cfc-1.7.0` must be signed in the product. Read docs/lab/test-menu-v2/FINAL-REPORT.md first. Visual harness copy: ~/Desktop/tm2-harness (ports 4016/54346; start Next with run-next.sh, which sets the lab FLAGS). A task-progress mod (status line "Tasks n/m · %") is in ~/.claude/dev-mods/babbbcdb-…/task-progress; the user asked for it.

2026-10-19 later the same day: the owner applied 0171–0173 in prod, ran TM-9 --apply (Test Hospital-1: 30 rows became 28 tests) and deployed ha-services-hub, which now refuses lab rows. The web app from this branch is NOT deployed yet and the branch is not pushed or merged.
