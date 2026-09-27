# ADR 0139 — Encounter completion and administrative closure

**Status:** Accepted — 2026-09-26. GATE A D-EMR-09, D-EMR-10, harmonised **[H]**. Two Edge Functions change: `ha-start-encounter`, `ha-complete-encounter`.

## Context

End visit (`ha-complete-encounter`) wrote no disposition, although 0040 had the column. Emergency encounters stayed open. `ha-start-encounter` could open a second encounter for one visit (R2). Encounters had no `last_activity_at`, so active NCD clerking looked idle.

## Decision

1. **`encounters` evolves (0071):** `visit_id` (→ `patient_intakes`), `template_id`, `last_activity_at`, `completed_by`, `disposition_detail`, `follow_up`, `attendance_type` (`new|re_attendance|unknown`, default `unknown`), `referral_in`, `closure_kind` (`clinical|administrative`), `closure_reason` (a code) and `closure_note_ciphertext`. `encounter_type` gains `antenatal, procedure, virtual, community`; `disposition` gains `home, admitted, referred_out, transferred, left_before_completion, left_against_advice`; `state` gains `entered_in_error`. Legacy values stay.
2. **One completion path.** `ha-complete-encounter` accepts a disposition (with detail and follow-up) for a clinical completion, or `closure_kind: 'administrative'` with a reason code (`other` needs the encrypted note). A clinical completion needs a disposition; an administrative one records none. Either way an `encounter_events` row records who and why. **A caller that sends none of the new fields gets exactly the old behaviour**, so flag-off pages are unchanged.
3. **Warnings, not blocks.** `lib/emr/encounter.ts` returns `unsigned_notes`, `no_diagnosis` and `orders_not_collected`; pending results raise nothing. The Edge Function never refuses on them.
4. **[H] Died is stored as `deceased`**, the existing value, because ADR 0115 reads it; no death column is added.
5. **Nothing auto-closes.** A stale open encounter goes to Needs closing (the Workspace's 24 h idle constant, now in `lib/workspace/flow.ts`) and stays open until someone closes it with a reason.
6. **One encounter per visit.** `ha-start-encounter` reuses an open encounter (planned or in progress) already linked to the visit — its intake, its booking or the given `visit_id` — instead of inserting a second.
7. **Administrative closure reasons (O-9, not signed):** left before seen, duplicate encounter, documented elsewhere, opened in error, other.

## Consequences

- Scenario A6 green: a stale encounter reaches Needs closing and stays open; administrative closure needs a reason. A1 completes `home` with only the unsigned-note warning.
- Printouts from completion: visit summary, referral (HMIS 032 fields), lab request, specimen label — print CSS only (E9), two identifiers, restricted items excluded unless added one by one. "Page x of y" needs Chrome ≥ 131.
- `hmis_category_id` stays null until REF-HMIS-\* are signed.
- **Deploy order:** 0071–0073 before the branch and before these two functions: Drizzle's encounter inserts and the functions name the 0071 columns (house rule for gated migrations).
- Legacy completed encounters keep `closure_kind` null ("legacy completed").
- **Not built:** the cause-of-death record and MPDSR pathway, and the national referral form beyond the HMIS 032 field list; both wait for the forms to be confirmed.

## Alternatives considered

- **A second, EMR-only completion action** — two ways to end a visit, and the five boards ADR 0101 updates from the one write would drift.
- **Auto-close idle encounters** — a closed chart hides a patient who is still in the building.
