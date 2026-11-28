---
name: lab-workspace-v2-build
description: Lab Workspace v2 (Tide desk UI rewrite of /lab) — all 12 gates built 19 Oct 2026; commits, harness, what's open
metadata:
  type: project
---

Built 2026-10-19 (owner: "go through all gates") in worktree ~/Desktop/medsync-labws2, branch feat/lab-workspace-v2, NOT pushed.
Commits: 95a3b127 Steps 0–10 behind LAB_WORKSPACE_V2 (pilot from here) → d1773c93 merge main (#244) → 872630c3 Step 11 removes old UI + flag.
Read docs/lab/workspace-v2/FINAL-REPORT.md first. Open: CSO signatures (copy draft, parity, Today defs, DESIGN section), 5-day pilot, human timed trials, downtime "still down"/name search need new writes.
Harness ~/Desktop/labws2-harness (ports 4006/54336/9336; seed + main's demo loader; plans/v2.js, run in 4 batches — 8 GB machine OOMs otherwise; regenerate plan after reseed, ids change).
**Why:** gated UI rewrite; removal commit must not deploy before signatures + pilot.
**How to apply:** `next build` fails in the worktree (node_modules symlink) — build via the harness. Related [[lab-phase-5-build]], [[medsync-owner-rules]].
