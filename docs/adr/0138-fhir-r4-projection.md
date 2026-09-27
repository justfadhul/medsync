# ADR 0138 — FHIR R4 projection, for export tests only (E7)

**Status:** Accepted — 2026-09-26. GATE A E7.

## Context

Uganda's health information exchange uses FHIR R4. No DPA or MoU exists for sharing records with anyone.

## Decision

1. **`lib/emr/fhir.ts` is a pure projection**: facts and rows in, plain JSON out. Twelve resources — Patient, Encounter, Observation, Condition, AllergyIntolerance, MedicationStatement, MedicationRequest, Procedure, ServiceRequest, Specimen, DiagnosticReport, Composition — and a Bundle.
2. **Export tests only. No endpoint, no route, no outbound call.**
3. **Codes:** the MedSync concept id is the primary coding. LOINC, ICD-11 and ATC codes are emitted only when verified; a candidate code never is. ICD-10 has no system in the projection at all (ADR 0137).
4. **Restricted facts and rows are left out** of a bundle unless `includeRestricted` is passed; a property test holds that no restricted item reaches a patient-facing payload (200 seeds).

## Consequences

- 19 tests: a round trip per resource.
- The shape is ready, and nothing leaves MedSync.
- **Not built:** an endpoint, consent capture for exchange, and a conformance run against a national profile. An endpoint is a later decision behind a DPA/MoU.

## Alternatives considered

- **A live FHIR endpoint now** — no legal basis to share.
- **No projection until an endpoint** — the mapping would then be designed under deadline, not tested against the record as it grows.
