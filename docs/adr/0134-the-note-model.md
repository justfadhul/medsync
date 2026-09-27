# ADR 0134 — The note model: drafts, one signing transaction, immutable after

**Status:** Accepted — 2026-09-26. GATE A D-EMR-01, D-EMR-02, D-EMR-03, D-EMR-15.

## Context

There was no note store. The NCD clerking page wrote drafts only (`clerkship_drafts`), saved only when a section was left, and could write to completed encounters without an access check. `recordClerkshipVersion` was not transactional. Note co-sign had no writer.

## Decision

1. **`clinical_notes`: one draft per author per encounter**, content encrypted (ADR 0132), updatable only while `state='draft'`. Autosave is revision-checked: a stale revision is a conflict ("This note was changed in another tab or device. Reload to see the latest version."). Every save stamps `encounters.last_activity_at`.
2. **Signing is one transaction** (`lib/emr/write/notes.ts`): validate the template minimum, compose canonically, HMAC (ADR 0132), write the note **and its note-born facts** together (D-EMR-01). Signing is the last mutation; a trigger refuses any later UPDATE.
3. **Chart actions** (vitals, allergies, problems, diagnoses, orders, medicines, pregnancy, procedures) commit at once as fact rows, not at signing.
4. **After signing, only events:** `clinical_note_events` records `cosign_requested`, `cosigned`, `addendum_added` and `entered_in_error` (with its reason, by the author or a supervisor). An entered-in-error note is struck through and its note-born facts leave the snapshot. Addenda inherit the parent's restriction.
5. **Note co-sign reuses `clinical_cosign_requests`** (action kind `sign_note`, `note_id`). Who must co-sign comes from one function, `clerkshipWriteAuthority().mustCosign` (interns). Requests show in `/doctor/cosign-queue` and the To co-sign lane. Co-sign never blocks care: an intern's orders commit while their note waits.
6. **Templates are data** (`data/emr/note-templates.v1.json`, reference 2.1–2.11). The sign checks are a closed list, not a rules DSL (D-NCD-02).
7. **The NCD capture is a section of the note.** At signing its values commit as facts through `lib/ncd/cfc-map.ts` (47 rules); the same map pre-fills NCD capture from facts recorded anywhere.
8. **The resus handover** becomes an ISBAR note: `consumeResusHandoff` runs after the resus close-out commits, creates or links the encounter, writes the note and clears `pending_encounter_handoff`, in one transaction.
9. **Operational defaults (O-9, not signed):** autosave 1.5 s after typing pauses, plus on section change and `visibilitychange`; late-entry label past 24 h between effective and signed time (`lib/emr/settings.ts`).

## Consequences

- Care is never blocked by signing; a missing HMAC key keeps the draft and says why.
- Scenario A4 green: a signed note is immutable, an addendum threads, entered in error is struck with its reason and its fact leaves the snapshot. A7: the intern's note awaits co-sign while their orders commit.
- Autosave runs through `lib/emr/sync` (write queue and server clock); A8: 30 s offline with a reply dropped mid-flight loses nothing and keeps order. Drafts live in memory only (E5: IndexedDB waits for DPPA acceptance).
- **Scenario A5 is partial:** the resus close-out has no structured action list, so outstanding actions are not turned into proposed orders. A close-out with no access basis leaves the flag set; the chart then offers "Bring in resus handover".
- `clinical_documentation` stays legacy, shown read-only as "Earlier clerking (legacy)".
- **Not built:** a hospital-settings store for the defaults; a medico-legal template (PF3/PF3A is a note type with no template).

## Alternatives considered

- **Commit every finding at once, as chart actions do** — a half-written history would enter the record, and engines would read unsigned narrative.
- **A separate note co-sign table** — `clinical_cosign_requests` already carries the queue, the lane and the audit.
