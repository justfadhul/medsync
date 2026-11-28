---
name: doctor-workspace-build-state
description: "Doctor Workspace (ADRs 0113–0118, 2026-09-24) — built dark in the MAIN tree on feat/doctor-workspace, uncommitted; 0069 applied in prod; CSO signature pending; scratch harness method"
metadata:
  node_type: memory
  type: project
  originSessionId: d00714f5-99ef-4994-8463-b93e29fa3201
  modified: 2026-09-24T12:29:16.076Z
---

Doctor Workspace built 2026-09-24 in the MAIN tree on `feat/doctor-workspace` (cut from feat/booking-app at
`c555aaf`), **uncommitted** — other sessions' dirty files share the tree, so stage by filename only. Gate record:
`docs/doctor-workspace/STOP-REPORTS.md` (STOP 0–6, §12 table, owner actions); as-built deviations in
`docs/doctor-workspace/gate-a-proposal.md` §10.

**Why:** the owner said "go through all gates" and "dont use agents, do it yourself" — every gate passed in one run,
built directly with no subagents or workflows.

**How to apply:**

- Dark behind `DOCTOR_WORKSPACE` (`1` or hospital ids; also needs `ENCOUNTER_ENGINE_LIVE=1` + `RESUS_DESK_V2=1`).
  Migration `0069_doctor_workspace.sql` is applied in production (onboarding v2 STOP 0 read-only check, 2026-09-25, found prod at 0069; prod reached 0070 the same day). CSO signature on D2/D3/D4/D9/D11 pending — the flag
  stays unset until it is signed.
- Harness (scratch, can be wiped): rsync the repo `--delete` minus node_modules/.next/.git/mobile/.env\*, clone
  node_modules with APFS `cp -Rc`, fixture route `app/styleguide/workspace-fixture/page.tsx` (scratch only, never in
  the repo; recoverable from the session transcript), dead-DB env, `next build` + `next start -p 3999`, CDP scripts for
  screenshots / axe / timings, PGlite `verify-0069.mjs` (17/17).
- Open for the owner: the design system's Critical pair (#DC2626 on #FEE2E2) is 3.95:1 — fails AA on the L1 chip and
  every critical badge; the doctor shell's tier label and dark cadre pill fail contrast (pre-existing, left alone so
  flag-off pages stay identical).
- `tests/a11y/static-pages` fails on a stale `.next/server/app/styleguide.html` (23 Sep), not on this work.

Related: [[resus-desk-v2-build-state]] [[medsync-owner-rules]]
