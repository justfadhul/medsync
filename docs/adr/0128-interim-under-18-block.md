# ADR 0128 — The interim under-18 block

**Status:** Accepted — 2026-09-25 (Onboarding v2, D13, DPPA 2019 s.8). Build record: `docs/onboarding-v2/STOP-REPORTS.md`.

## Context

DPPA s.8 forbids processing a child's data without a parent's or guardian's prior consent, and self-signup accepted any age.

## Decision

1. **Client:** a date of birth under 18 replaces the submit with *"MedSync accounts for people under 18 need a parent or guardian. This isn't available online yet."*
2. **Server:** the action refuses (`under_18`) before anything is stored.

## Consequences

- The wording is **PROVISIONAL**: it needs CSO and lawyer sign-off.
- Guardian accounts are a separate decision (out of scope).
