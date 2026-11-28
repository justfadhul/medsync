---
name: encounter-closure-build-state
description: "Encounter closure (admission + bed + patient copy) built 2026-10-03 in worktree ~/Desktop/medsync-closure on feat/encounter-closure, committed cc624f6+4036150 (not pushed); 0091 applied (confirmed 2026-10-08); ADRs 0197–0203 proposed"
metadata:
  node_type: memory
  type: project
  originSessionId: 49ed709c-1a35-4b04-8b5a-154187eb4348
  modified: 2026-10-03T09:32:53.802Z
---

Owner prompt `docs/emr/closure/PROMPT-ENCOUNTER-CLOSURE.md`, run "through all gates" 2026-10-03. Worktree
`~/Desktop/medsync-closure`, branch `feat/encounter-closure` off main `8e45d34`; committed cc624f6 + 4036150, **not pushed**. Commits need NODE_OPTIONS=--max-old-space-size=5120 (pre-commit tsc OOMs) and headers ≤ 100 chars (commitlint).
Owner decisions: D1 doctor allocates / ward confirms (Arriving state), D2 no bed ≠ block (waiting list), D3 doctor
previews then shares/holds the patient copy, D4 scope stops at arrival (ward rounds/discharge = next prompt).

- Migration **0091** (GATED, unapplied): admissions, bed_assignments arrival cols, 4 SQL functions, patient_visit_summaries (column `copy_ciphertext`, renamed so tests/clerking/si-patient-facing's `contentCiphertext` guard holds), self_medications.source_prescription_id. Next migration 0092, next ADR 0204.
- Flags: `ENCOUNTER_CLOSE_V2`, `PATIENT_VISIT_SUMMARY` (lib/emr/feature.ts). Admissions only where `WARD_BUILDER` is on (else ward on the visit, no admission row) — owner-visible rule in ADR 0198.
- Edge Functions changed: ha-complete-encounter, ha-services-hub (ops-wards), ha-book-on-behalf (origin clinician).
- Fixture screens `/styleguide/encounter-closure/[screen]` + screenshots in docs/emr/closure/screenshots (CDP harness ~/Desktop/schedule-reskin-harness/cdp.mjs; dev with dummy NEXT*PUBLIC_SUPABASE*\* values, never the prod .env.local).
- Known gaps: bed picker not live-subscribed (server refuses a taken bed in words); "Admitted · ward" label reads disposition_detail (stale "waiting" after a bed is given); board shows "Other" without the encrypted note; no patient notification (dispatcher is booking-shaped); household proxies; Plan reconciliation stops not in "Medicines to stop".
- Pre-existing bug spotted: `startEncounter` reads `r.data.encounter_id` but edge responses are `{ok,data}` (should be `r.data.data`).

**Why:** next session needs the state and the judgement calls. **How to apply:** read STOP-REPORTS.md there first; don't re-open D1–D4. Related [[cloud-handoff]] [[medsync-owner-rules]].
