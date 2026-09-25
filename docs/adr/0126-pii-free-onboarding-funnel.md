# ADR 0126 — A PII-free onboarding funnel

**Status:** Accepted — 2026-09-25 (Onboarding v2, D16, EV-1..3). Build record: `docs/onboarding-v2/STOP-REPORTS.md`.

## Context

Nothing measured where people stopped or which field failed.

## Decision

1. **Schema:** `onboarding_events` holds form, event (start, section_complete, submit_attempt, submit_ok, field_error), section, field key, Zod error code, elapsed ms and a random per-tab id. CHECK constraints refuse anything shaped like a value.
2. **Writes** go only through a rate-limited server action. **Reads** are superadmin-only (RLS).
3. **Retention:** 180 days, pruned by the nightly cleanup cron (`ONBOARDING_EVENTS_RETENTION_DAYS` overrides).
4. **Report:** `node --env-file=.env.local scripts/onboarding-funnel.mjs [days]`.

## Consequences

- Time estimates ("About N minutes") are added only once real medians exist.
