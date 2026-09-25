# ADR 0123 — The profession picker and generic roles

**Status:** Accepted — 2026-09-25 (Onboarding v2, D11, PRO-1..4). Build record: `docs/onboarding-v2/STOP-REPORTS.md`.

## Context

Four dependent pickers (council → cadre → grade → role). Grade showed "Loading…" forever for 16 of 20 cadres, and roles were Internal-Medicine-only, so a surgical MO had to pick "— Internal Medicine".

## Decision

1. **One grouped, searchable list** of 21 professions (`lib/onboarding/profession.ts`). Each maps to exactly one council, cadre, scope-changing grade and generic role.
2. **Council:** shown and named in the registration-number label, never chosen.
3. **Generic roles:** migration 0070 adds nine `*_GENERAL` roles. The department is the affiliation's, and no new affiliation is tied to Internal Medicine unless its department is.
4. **Specialty:** consultants and senior consultants choose one from the catalogue, or "My specialty isn't listed yet" (NULL, shown to the approver).
5. **"Specialist nurse"** is the cadre; the duplicate NURSE grade is no longer offered.

## Consequences

- Routing and scope key on cadre or grade codes and `is_clinical`, never on role code, so existing affiliations are untouched.
- Every mapping is probed against the seed in the local harness (21/21).
