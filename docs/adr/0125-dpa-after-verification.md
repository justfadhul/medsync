# ADR 0125 — The data-processing agreement after verification

**Status:** Accepted — 2026-09-25 (Onboarding v2, D7). Build record: `docs/onboarding-v2/STOP-REPORTS.md`.

## Context

The DPA was accepted inside the application form by whoever filled it in, before anyone checked their authority.

## Decision

1. **Verify:** `approve-hospital-application` gains a verify step. For an application with no signed agreement it checks that the documents are complete, then sets `verified`, without provisioning.
2. **Sign:** the applicant signs on the pending page (the agreement gate: full text, version, hash, signatory name and title, "authorised to bind", "accept").
3. **Provision:** the second Approve provisions exactly as before (`agreement_signed`, hospital, agreement row, departments, hospital_admin). It now also fills `hospitals.district` and `region`, which emergency contacts match on.
4. v1 applications, which carry their DPA already, keep the one-step path.

## Consequences

- Nothing about a patient exists before an authorised signatory has accepted the DPA.
