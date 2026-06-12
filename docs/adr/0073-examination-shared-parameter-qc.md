# ADR-0073 (PROPOSED) — Examination shared-parameter single-source-of-truth (cross-exam QC)

**Status:** **Proposed — GATE A, awaiting CSO sign-off of the registry.** Not yet implemented. Branch `feat/exam-consistency-qc`. Source: `examination-consistency-qc-kickoff.md` + `examination-shared-parameter-registry-reference.md`.

## Problem

A clinical finding that surfaces in ≥2 examination modules (GCS in vitals/general/CNS/resus; conjunctival pallor across general/resp/CVS/abdo; foot pulses across CVS/vascular/foot; the CNS sensory modalities reused by the diabetic foot) is currently captured as **separate fields per module**. That allows re-entry, **contradictory records** (GCS 15 in one tab, 8 in another — a real danger), the **stale-value trap**, an incoherent audit trail, and **double-counting** by the reasoning engine.

## Decision (proposed)

Model each shared parameter as **ONE canonical record per encounter, surfaced in many views** — editing any view updates the one record; all views reflect it. Shared identity, **not** field-to-field copying. Generalises the existing vitals carry-forward. Four sync types (A time-series / B static / C structured / D derived) with type-appropriate rules; full provenance; **discrepancy surfaced not overwritten**; **not-examined ≠ examined-elsewhere**; the reasoning engine reads the canonical value (no double-counting). Decision-support — never invents/auto-confirms/silently-overwrites.

## GATE A deliverable (this PR)

The **audit + reconciliation registry** — `docs/clinical/examination-shared-parameter-registry.md` — produced by an exhaustive 9-module field audit + clinical-identity reconciliation: **107 parameters appearing in ≥2 modules** (77 static · 27 structured · 13 time-series · 8 derived) + 18 single-module candidates to verify. **96 rows carry an explicit CSO equivalence decision (⚑).** The registry is the CSO-signed source-of-truth for the build.

## Headline equivalence decisions the CSO must sign (examples from the ⚑ rows)

- **GCS (E/V/M + total) + ACVPU/AVPU** — confirm one canonical consciousness parameter across vitals · general · CNS · resus, with **GCS ≤8 → airway emergency firing wherever set**.
- **Capillary glucose** — one value across vitals · CNS · foot · resus ("Don't Ever Forget Glucose").
- **Hepatomegaly / splenomegaly** — general _flag_ fulfilled-by the abdominal _structured_ finding (link, not a second record).
- **CNS sensory modalities ↔ diabetic-foot monofilament/vibration** — confirm ONE canonical set (the foot reuses neuro, does not re-define).
- **Peripheral + foot pulses** — one canonical named-vessel × side set across CVS · vascular · foot.
- **Cauda-equina screen** — shared CNS special-signs ↔ MSK back-pain red flags.
- Granularity reconciliations (general "oedema present" ↔ vascular "pitting to knee, bilateral"; gait coarse ↔ type) + borderline non-merges (malar rash vs malar flush; anaemia pallor vs ischaemic pallor; pretibial myxoedema vs generic oedema).

## Proposed schema (review only — no migration; section_data)

A per-encounter `canonicalParameters` store keyed by `canonicalId`: `{ type, value | readings[] (Type A), provenance{module, clinician, atIso}, discrepancies[] }`. Module fields become `field → canonicalId` bindings + presentation. Versioned/append-only/audited as today.

## Build order after sign-off

GATE B (binding + single store + reactive auto-fill) · GATE C (provenance + not-examined honesty + discrepancy surfacing + GCS≤8 everywhere) · GATE D (reasoning canonical read + UX + parity tests + closeout).
