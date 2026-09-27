# ADR 0133 — Database runtime and the PGlite lane (E1)

**Status:** Accepted — 2026-09-26. GATE A E1, harmonised **[H]**: E1 (a hosted Supabase dev project) stands as owner action O-1; the PGlite lane runs until it exists.

## Context

Only a hosted, production-like database exists. The RLS suites in `tests/rls/**` skip without its env. The machine has 8 GB of RAM and the build may add no dependency. The EMR's safety lives in SQL (triggers, FORCE RLS, a backfill, an access function), so mocks would test nothing that ships.

## Decision

1. **E1 stands.** The owner creates a hosted Supabase dev project with synthetic data (O-1); the hosted checks run there.
2. **Until then, the PGlite lane.** `tests/emr-db/**` runs a real Postgres in-process (PGlite, WASM) with every migration replayed over a minimal Supabase bootstrap (`tests/emr-db/_pglite.ts`: `anon`, `authenticated`, `service_role`, `auth.uid()`, `realtime.messages`, Supabase's default grants on `public`, so a missing REVOKE shows).
3. **The switch is `EMR_PGLITE=1`** (`npm run test:emr-db`). Without it every lane test skips in under a second.
4. **PGlite is never a dependency.** As built — not the draft's `EMR_PGLITE_MODULES` variable — PGlite lives in `~/Desktop/emr-harness/pg/node_modules` and `node_modules/@electric-sql` is a local symlink to it. Every PGlite import is a dynamic import of a string variable, so `tsc` and CI never resolve it.
5. **Each file boots once** (~10 s for 74 migrations) and every probe runs in a rolled-back transaction.
6. **Playwright is not added [H].** Scenarios A1–A9 run as lane integration tests over the real server-side write functions. UI checks: axe-core over server-rendered fixture pages plus screenshots over the DevTools protocol from the scratch harness. Playwright is a flagged decision (O-6).

## Consequences

- Migrations, RLS probes, write paths and A1–A9 are testable today. The lane held 204 tests at STOP 2 and 284/284 at STOP 5–6; the harness replays 74 migrations (0000–0073).
- **Proven only on the dev project (O-1):** realtime delivery, the pooler (:6543, `prepare:false`), the `authenticator` role, and the loader's latency budget (91 ms p95 on PGlite against a 60 ms Postgres budget).
- The EMR RLS probes are PGlite-only; no hosted twin in `tests/rls/**` exists yet. `docs/emr/OWNER-RUNBOOK.md` gives the read-only SQL checks to run on the dev project meanwhile.
- A fresh clone has no symlink, so the lane skips there; that is intended.

## Alternatives considered

- **Add `@electric-sql/pglite` to `package.json`** — a new dependency, refused by the build rules.
- **Docker Postgres or `supabase start`** — too heavy for the 8 GB machine.
- **Mock the database** — would test none of the SQL that carries the safety.
