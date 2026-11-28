---
name: pharmacy-workspace-v2-build
description: "Pharmacy Workspace v2 (six places) built 27 Oct 2026 in medsync-pharmws2, committed 576f6018, pushed 27 Oct (no PR); CSO signatures pending"
metadata:
  node_type: memory
  type: project
  originSessionId: 86d2ddf2-f3cb-4d6f-8e69-ab088d0f9685
  modified: 2026-10-28T06:41:20.875Z
---

Pharmacy Workspace v2 is the rebuild of the whole pharmacy UI from the owner's canvas (~/Downloads/pharmacy-workspace-v2-canvas).

**Where it is (27 Oct 2026):**

- Worktree `~/Desktop/medsync-pharmws2`, branch `feat/pharmacy-workspace-v2`, off feat/pharmacy-demo 4ffcc9d2.
- Commit 576f6018, pushed to origin 27 Oct 2026. **No PR yet.**

**Flag:** `PHARMACY_WORKSPACE_V2`. It stays off in production while `PHWS2_COPY_STATUS` is draft.

**Docs:** in `docs/pharmacy/workspace-v2/`. Read FINAL-REPORT.md first. Also there: STOP 0, GATE A, the parity checklist and BUILD-BRIEF. ADRs are 0451–0455.

**Facts that are not obvious from the code:**

- `PROMPT-PHARMACY-WORKSPACE-V2.md` was never found, so the boards plus the lab v2 prompt laws were the spec.
- Old page bodies live in sibling `body.tsx` files, because Next build rejects named exports from a `page.tsx`.
- Tabs follow `pharmacyNavFor`, except Signed packs, which follows `supplyFlagOn("packs")`. The old nav is pinned by the Phase 1 baseline test (engines.test.ts).
- In this worktree, Turbopack refuses the symlinked node_modules. Build with `next build --webpack`.

**Local run (27 Oct):**

- The main `.env.local` has no PHARMACY*\* flags (they live on Vercel). To run v2 locally, start `next dev --webpack -p 3108` from the worktree. Source the main `.env.local`, then export every PHARMACY*\* flag as 1, plus PHARMACY_WORKSPACE_V2=1 and DEV_SKIP_MFA=1.
- The preview launcher can't read Desktop, so start the server from Bash.
- Each local DB query takes about 200 ms (dev pool max 3), so pages take 20 s to several minutes. In prod (dub1) a query is about 1 ms.
- Fixes found by the browser pass were committed as 2217efe8 and pushed on 27 Oct:
  - the shell counts now load after the page, through `pharmacyShellCountsAction` (reconciliation is N+1 and took 82 s per page);
  - InboxRow moved to `inbox-row.tsx`, because a function prop sent to a client component crashed Today and Needs you;
  - the downtime page props are required again.

**Merged and the production override (27 Oct):**

- The owner merged v2 to main as PR #266.
- ADR 0468 lets PHARMACY_DEV_HOSPITALS test hospitals see v2 in production while the copy is unsigned. It is commit d249bcad on `fix/pharmacy-ws2-dev-hospitals`, pushed with no PR. That branch is checked out in the medsync-pharmws2 worktree.
- To see v2 in production: merge that branch, set `PHARMACY_WORKSPACE_V2` in Vercel, keep `PHARMACY_DEV_HOSPITALS` set, and deploy.

**Production Today hang (28 Oct):**

- /pharmacy/today timed out at 300 s in production (Vercel runtime log) and the rail prefetched every place again every ~1.5 s.
- Locally it is not a deadlock: with a one-connection pool Today still finishes.
- Fix: 25 s per source, 60 s for Today's rows, `prefetch={false}` on the rail. PR #269, branch fix/pharmacy-today-hang (12e6c33f).
- After the deploy, run `vercel logs runtime --query 'pharmacy.read_timed_out'` within 30 min (hobby retention) to find the slow source.
- The Vercel CLI is signed in on this Mac (`npx vercel@latest logs runtime|requests`). There is no gh CLI; PRs are opened through the GitHub API with the git credential.

**Root cause found (28 Oct):** the prod log named `today.rows`. Real cause: postgres-js pipelining through Supavisor's transaction pooler (6543) stalls a statement in `ClientRead` until timeout (no lock, small data). Proven on the prod DB: groups load stalled 4/5 on 6543, 0/3 on 5432, 0/5 with `max_pipeline: 0`. Fix = `max_pipeline: 0` in `db/index.ts` (with `@ts-expect-error`, missing from postgres 3.4 types) commit 1109456d, PR #270, merged and deployed 28 Oct (dpl_ijrgJj8e). IT BROKE PRODUCTION: max_pipeline 0 skips the onexecute hook sql.begin uses to reserve its connection, so every transaction threw UNSAFE_TRANSACTION. max_pipeline 1 keeps tx working but still stalls 5/5. Fix: keep 0 and override pgClient.begin with a reserve()-based begin + savepoint (db/index.ts), on branch fix/db-pipeline-transactions (medsync-pharmws2), uncommitted at time of writing; proven on prod DB (tx, rollback, savepoint, groups 5/5, loadTodayRows 3/3). Rollback target before #270: medsync-awff5rpip. Lesson: test a pool change with transactions, not only plain reads. Affects every page, not just pharmacy. Owner allowed prod DB reads in this session (28 Oct). Run vitest with the main `.env.local` sourced, or ~70 files fail on "Invalid environment variables".

**Still open:**

- CSO sign-offs: the copy, the Today definitions (including the "late = written before today" rule) and parity.
- A browser pass on the demo hospital.
- Step 11 (deleting the old UI) waits for the parity signature and a pilot.

Related: [[pharmacy-demo-build]], [[lab-workspace-v2-build]].
