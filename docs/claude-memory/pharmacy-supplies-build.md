---
name: pharmacy-supplies-build
description: "EMHSLU health and lab supplies across the pharmacy, feat/pharmacy-supplies in medsync-supplies, built 5 Nov 2026, 0277 and 0278 applied by the owner"
metadata:
  node_type: memory
  type: project
  originSessionId: be84821e-a091-48f1-bdbc-8a12bfa2c5c3
  modified: 2026-11-05T15:42:32.735Z
---

5 Nov 2026: SUPPLIES.md built on `feat/pharmacy-supplies` (worktree `~/Desktop/medsync-supplies`, cut from local `feat/pharmacy-receive`), pushed, no PR. Migrations 0277 (GATED) and 0278 (1,914 items): owner said applied on 5 Nov 2026 (not checked by Claude; a read of the database was refused by the permission check). Copy draft; rules group `sup` unsigned. Handoff section at the end of `docs/pharmacy/HANDOFF.md`.

Non-obvious:

- No Playwright in the repo: §H is covered by Vitest, the PGlite lane, axe, and a browser-pane pass at 1440 and 390 px. A real axe run in the pane works via a jsdelivr script tag.
- Worktrees with a symlinked `node_modules` fail Turbopack: use `next build --webpack`. The lint-staged hook doesn't format in this worktree, so run prettier by hand.
- `tests/emr-db/pharmacy-stores-data.test.ts` "a saved order's lines change only by closing" fails on the Receive branch too. `pharmacy-store-actions` can flake in a crowded parallel run.
- Worktree tests need `SKIP_ENV_VALIDATION=1` plus dummy `NEXT_PUBLIC_SUPABASE_*`.

Owner still supplies: whether Section C is used, supply prices if billed, top-up levels, signatures. Related: [[receive-build]], [[medsync-owner-rules]].
