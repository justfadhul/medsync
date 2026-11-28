---
name: services-hub-build-state
description: "Departments & services hub (ADRs 0150–0161, migration 0080) — e81aef1 + fix 816ebb5 on feat/booking-app (2026-09-26); fix deployed by Claude (function + Vercel medsync-4qr4qqtl1); first deploy was the owner's; not pushed"
metadata:
  node_type: memory
  type: project
  originSessionId: 722bf4f9-1246-49d3-8449-3b25771c25dc
  modified: 2026-09-26T15:16:03.581Z
---

Built 2026-09-26 in worktree `~/Desktop/medsync-services` on `feat/hospital-services-hub`, commit `e81aef1`.
The main tree (`~/Desktop/medsync`, `feat/booking-app`) was fast-forwarded to it. Nothing is pushed.

Gate record: `docs/hospital-services/STOP-REPORTS.md` (STOP 0–7 and the §12 table). The spec is `docs/hospital-services/gate-a-proposal.md`.

**Deploy state:**

- The first deploy was blocked for Claude: the classifier refused `npm run db:migrate` ("Production Deploy") and read-only production queries ("Production Reads").
- The owner later reported setting up departments in the hub, which implies 0080 and the app were live. This was not verified by Claude.
- Fix `816ebb5` (2026-09-26):
  - `listDepartments` taken out of the hour-long cache;
  - departments added live by default;
  - the `set_departments_live` op;
  - centred pop-ups (ADR 0161).
- Claude deployed that fix: `ha-services-hub`, then Vercel `medsync-4qr4qqtl1`. Nothing is pushed to GitHub.

**How to apply:**

- Deploy order matters. The app and two changed functions read 0080's columns, so anything deployed first breaks live sign-up and clinic-day saves. The owner runs, from the main tree:
  1. `npm run db:migrate` (0080 only; prod was at 0070).
  2. `npx supabase functions deploy ha-services-hub ha-upsert-session-template ha-set-hospital-emergency-settings --project-ref hrfpdfonjuvsakbjtfop --use-api`.
  3. `npx vercel deploy --prod --yes`.
- Rollback target: `medsync-mc3gphi3o`.
- Harness (scratch, can be wiped): `~/Desktop/services-harness`.
  - `pg/serve.mjs` serves the PGlite fixture over a socket. The app pool must be `max: 1`, because pglite-socket corrupts concurrent extended queries.
  - `pg/run-ops.mjs` + `shim.mjs` run all 30 Edge Function ops in Node (`--experimental-transform-types`, `npm:` specifiers mapped). Result: 60/60.
  - `app/` is a scratch copy with the auth/proxy/db-pool patches. Sync it with `sync.sh`. Use `localhost`, not 127.0.0.1: Next dev blocks the dev resources on 127.0.0.1 and the page never hydrates.
- Lessons:
  - The design system's gray and teal scales invert in `.dark`, so `dark:gray-*` overrides double-invert. Use the tokens.
  - The caution token (#D97706 on #FEF3C7, 2.86:1) fails AA. The hub uses `amber-800` text in light mode. This is an owner item.
- Open for the owner:
  - the ≥ 70 % preset target is not met end to end (72 % structure only);
  - the national test menu is unavailable;
  - holidays need a yearly top-up;
  - a single-admin hospital needs a superadmin to verify routing values.

Related: [[medsync-owner-rules]] [[release-state]] [[emr-engine-build-state]] [[onboarding-v2-build-state]]
