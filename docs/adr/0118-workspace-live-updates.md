# ADR 0118 — Workspace live updates: a PHI-free broadcast, polling behind it, held reorders

**Status:** Accepted — 2026-09-24 (E2, E3).

## Context

Triage, Assigned and Encounters changed only on navigation (W11); the resus board was live (ADR 0109). A list that
reorders under a doctor's hand is worse than one that never updates.

## Decision

1. **Broadcast from the database** (migration 0069). AFTER triggers on `patient_intakes` (insert; status, level,
   department, routing), `triage_records` (insert) and `encounters` (insert; state, clinician, triage record, end) send
   `{ kind, at }` to the private topic `workspace:<hospitalId>`. The function is `SECURITY DEFINER` with an empty
   `search_path` and swallows its own errors, so a realtime failure never blocks a clinical write. RLS on
   `realtime.messages` lets only active clinical staff of that hospital listen.
2. **No patient reference in the payload.** A ping makes the board re-read through its own scoped server render.
   Resus changes arrive on the resus board's existing topic.
3. **Polling behind it:** every 15 s while either channel is down, a 5 min safety poll while both are up, a refetch on
   focus and whenever the tab is shown, with a 400 ms debounce.
4. **Held reorders (E3):** while the pointer or focus is in the list, new data waits behind "N updates · Show"; the
   doctor's own action follows its answer through.
5. **Announcements:** a polite live region says only that a patient is newly waiting for the viewer or newly in Resus.
   An arrest is announced assertively by the global ArrestAlarm.

## Consequences

- Another device sees a change a debounce after the write (not yet measured live: there is no test project), or
  within 15 s without the channel.
- Every ping costs a full board read (nine calls). That is fine at department scale; revisit it if pings become
  frequent.

## Alternatives considered

- **A patient id in the payload and a per-department topic (the prompt)** — nothing would use them, and they add policy
  surface and a patient reference.
- **Postgres Changes on the tables** — it streams row contents to subscribers, and those rows hold PHI.
