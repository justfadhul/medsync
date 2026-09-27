# ADR 0137 — Coding and terminology licensing: ICD-11 first, ICD-10 pending a licence (E6)

**Status:** Accepted — 2026-09-26. GATE A E6 (narrows D-CFC-10). Awaits owner action O-3 (the WHO ICD-10 licence).

## Context

Migration 0041 and `lib/encounter/reference-codes.ts` already commit WHO ICD-10 content without a licence, and no surface uses it (R9, worse than stated). There was no third-party notices file. Concept codes arrive as candidates until checked.

## Decision

1. **MedSync concept ids are primary** (D-CFC-01); external codes are mappings with a status: `verified`, `verified-mirror`, `verified-secondary`, `candidate`, `standard`.
2. **ICD-11 first** (CC BY-ND 3.0 IGO): codes and titles are shown unmodified and attributed. The 85 draft diagnosis terms (13 restricted) were each checked against the findacode MMS v2026-01 mirror — status **verified-mirror**, not yet confirmed at icd.who.int. The picker shows the ICD-11 code with its verification mark.
3. **ICD-10 stays empty until licensed.** `icd10_who_code` is CHECK-constrained to `NULL` on `diagnosis_terms` and `conditions` (0071). The 0041 content is untouched, used by no surface and never exported.
4. **LOINC codes are shown or exported only when verified.** The FHIR projection (ADR 0138) emits an external code only with a verified status; the seed test pins that every unverified code is a `candidate` (all 57 v1.1 codes are candidates).
5. **`THIRD-PARTY-NOTICES.md`** records the ICD-11 attribution, the LOINC notice, ICD-10 as "licence pending", and CIEL as not used yet (`ciel_id` column present, empty).

## Consequences

- Allowing ICD-10 is a deliberate future migration (DROP the two CHECKs) after O-3 records the licence.
- Confirming the 85 terms at icd.who.int, and the CSO signing them (REF-DX-TERMS), move them from draft.
- **Not built:** a separate CI check that fails on a candidate code in an export (the FHIR code filter and its property test hold the line today); CIEL mapping.

## Alternatives considered

- **Delete the 0041 ICD-10 content** — migrations are immutable; it is recorded and kept unused instead.
- **Ship ICD-10 alongside ICD-11 (D-CFC-10 as first written)** — not without the licence.
