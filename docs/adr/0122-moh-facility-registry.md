# ADR 0122 — The MoH facility registry as the hospital source of truth

**Status:** Accepted — 2026-09-25 (Onboarding v2, D5, REG-1..6). Build record: `docs/onboarding-v2/STOP-REPORTS.md`.

## Context

Hospitals typed their own name, level and ownership, and nothing checked them against the Ministry's list.

## Decision

1. **Source:** the National Health Facility Registry's public list (`nhfr.health.go.ug`, API `/api/v1/facilities/public`), 6,801 facilities, imported by `scripts/import-registry.mjs`.
2. **Crosswalk:** 99.54 % matched to a district (cities go through "<Name> Municipality"; one reviewed alias, Sembabule ↔ Ssembabule). Terego (31 rows, created after 2020) is reported, not guessed.
3. **Shipped as read-only data with the server**, not a table.
4. **REG-3:** the application stores `registry_code`, and the server copies the facility's facts.
5. **REG-4:** a second application for the same code is flagged `duplicate_facility`, not blocked.
6. **REG-5:** the manual path is always there (`facility_source = 'manual'`).
7. **REG-6:** clinics (432) have no catalogue level. They are stored as `private` (PFP) or `other`.

## Consequences

- **No registry coordinates:** only 2 of 6,801 have them, so facility location always comes from a device in the setup checklist.
- **Refreshing** means re-running the import and redeploying.
