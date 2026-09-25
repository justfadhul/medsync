# ADR 0120 — Ask, derive, defer: the onboarding field ledger

**Status:** Accepted — 2026-09-25 (Onboarding v2, D2, D6, D8, D12). Build record: `docs/onboarding-v2/STOP-REPORTS.md`.

## Context

The forms asked for things approval never uses (hospital: 30+ operating facts) and asked for the same fact twice (region + district, council + cadre + role, a display name after first name + surname, an email domain and an email).

## Decision

A field stays on a signup form only if account creation or verification needs it before approval. The ledger is Appendix A of `docs/onboarding-v2/PROMPT-ONBOARDING-V2.md`, as corrected in `gate-a-proposal.md` §10.

**Derived, not asked:**
- region, from the district;
- council, grade and role, from the profession;
- display name, from first name + surname;
- institutional email domain, from the work email;
- a registry facility's name, level, ownership and place.

**Deferred to where they are used:**
- **Patient:** ID (NIN, passport, refugee ID, other: D12), next of kin, usual hospital, photo and title go to `/patient/profile` ("Complete your profile").
- **Staff:** photo and optional grades go to the staff pending page; the approver records licence expiry.
- **Hospital:** departments, services, operating profile and contacts go to the setup checklist.

**Removed:** the applicant's council number (D8), and the free-text issuing authority.

## Consequences

- Inputs shown: patient 18 → 10, clinical 16 → 11, non-clinical 15 → 9, hospital 48 → ≤ 15 on the registry path.
- The servers still accept the old optional fields during rollout (the old forms still post them).
