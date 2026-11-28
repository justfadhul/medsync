---
name: resus-desk-v2-build-state
description: "Resus Desk v2 rework (2026-09-23) — separate worktree + branch, gates passed, harness location, what is owner-gated, agent-stall lesson"
metadata:
  node_type: memory
  type: project
  originSessionId: b05bd2ce-c046-4d10-b097-ac4f7d798d92
  modified: 2026-09-24T08:29:38.668Z
---

Resus Desk v2 is built in a SEPARATE git worktree: `/Users/airm1/Desktop/medsync-resus-v2` on branch
`feat/resus-desk-v2` (cut from `feat/booking-app` at `aa1fe46`). Gate record: `docs/resus-v2/STOP-REPORTS.md`;
spec: `docs/resus-v2-gate-a-proposal.md` (D1–D25, E1–E7 signed by the owner's "go through all gates");
UI contract: `docs/resus-v2/UI-BUILD-SPEC.md`; catalogs `docs/clinical/resus-{als,post-rosc,closeout}-clinical-catalog.md`.

**Why:** the main tree carries other sessions' uncommitted work (ADR 0100/0101, plum), so v2 builds and commits in
isolation; HEAD of feat/booking-app did not build (globals.css brace) — fixed on the v2 branch (`43a754c`).

**How to apply:**

- Migration `0068_resus_desk_v2.sql` is NOT applied (owner action, after 0067). Web must not ship before it (v1
  reads `select *` from resus_episodes). v2 is behind `RESUS_DESK_V2=1` (lib/resus/feature.ts); .env.example untouched.
- Local harness lives OUTSIDE the repo: `/Users/airm1/Desktop/resus-v2-harness` (cdp.mjs Chrome driver; pg/ PGlite
  replay of all migrations + `probe.mjs`, 71/71). The fixture route `app/styleguide/resus-fixture/` is git-excluded
  (.git/info/exclude) — never commit it. Build with dead DB URLs (port 6543/5432 shapes) + `next start -p 3417`.
- Scratchpad dirs can be wiped mid-session — keep tooling in the harness folder, not the scratchpad.
- Subagents stall ("no progress 600s") when one tool call streams a huge file: always tell them to write ≤ ~200
  lines per Write/Edit and build big files in parts.
- No seed data for real hospitals (units / bay defibrillators come from `scripts/seed-resus-units.ts` + a JSON the
  hospital declares). Owner turned ultracode on for this build (workflows for build → review → verify → fix).
- DONE 2026-09-24: whole build committed (`43a754c`..`684e2fe`, tree clean); final report = STOP 4–7 section of
  `docs/resus-v2/STOP-REPORTS.md` (§14 numbers, owner actions, CSO confirmations, Deferred list). Owner cut Phase 7
  for time — deferred: S0/S6–S11 scripts, network-drop/realtime/perf suites, resus red-scarcity + fast-path tests,
  idle-sweep cron. Owner prefers finishing work directly over more agent workflows when a build runs long.
- 2026-09-24 LIVE: 0068 applied + `RESUS_DESK_V2` set in Vercel Production by the owner; resus v2 fast-forwarded
  into the MAIN tree (`feat/booking-app`, uncommitted work kept; backup ref `refs/backup/pre-resus-v2-merge`) and
  deployed from there (`vercel deploy --prod`). Since then: Base UI #31 menu fix, centred landscape desk panels
  (Sheet side="center"), hospital-wide arrest alarm (components/resus/arrest-alarm.tsx, shared board channel
  lib/resus/board-channel.ts). Workflow: commit on feat/resus-desk-v2 → ff main tree (3-way merge any file dirty
  there, e.g. app/clinician/layout.tsx) → deploy. ADR 0111 sign-off sheet still unsigned.
- Spec §5.1 phone layout: the bottom bar holds Record findings + Record vitals (panel record bar not sticky there);
  the no-horizontal-scroll rail/strip on phones is a deliberate safety deviation (critical values never off-screen).
- Decision taken (confirm with CSO): re-arrest after ROSC is one tap + Undo (signed ALS-ROSC-07 over D20's confirm).
