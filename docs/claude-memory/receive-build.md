---
name: receive-build
description: 4 Nov 2026 Stock › Receive a delivery (kit 6) built on feat/pharmacy-receive in medsync-receive; 0276 unapplied; copy draft; not pushed
metadata:
  node_type: memory
  type: project
  originSessionId: 52ced77c-7340-4f57-a7f8-7699ff80d13f
  modified: 2026-11-04T12:01:03.596Z
---

Stock › Receive a delivery from kit 6 (`docs/pharmacy/rework/RECEIVE.md`) is built on `feat/pharmacy-receive` in worktree `~/Desktop/medsync-receive`, off `feat/pharmacy-main-store` 75788ff0. Latest commit 447e1382, local only.

**Why:** the owner asked to run every step of `PROMPT-RECEIVE.md` ("go through all gates"); the harmonised prototype was accepted by this kit. See [[receive-harmonized-prototype]].

**How to apply:**

- Migration 0276 is GATED and unapplied: `cd ~/Desktop/medsync-receive && npm run db:migrate`. The app needs it first, because the Main store reads it too.
- Copy is draft. Open items are in `docs/pharmacy/HANDOFF.md`, section "Stock › Receive a delivery".
- Screens were only checked on the fixture `/styleguide/pharmacy-receive` (`MEDSYNC_FIXTURES=1`); never run against a real database. Server paths are covered by `tests/emr-db/pharmacy-receive*`.
- Run lane tests here with `SKIP_ENV_VALIDATION=1`; build with `next build --webpack`, since Turbopack rejects the symlinked `node_modules`.
- Failing before this branch too (checked on 75788ff0): `pharmacy-stock` S5 and "the in-charge sets a price", `pharmacy-demo-stores` "/store/packs". `tests/patient-web/{care,help}` fail only in worktrees (mobile tsconfig).
- The prototype `.dc.html` needs its host to render; static Chrome shows only `{{ }}` templates. Screenshots from the app's browser pane fail when the pane is hidden; headless Chrome over CDP works.
