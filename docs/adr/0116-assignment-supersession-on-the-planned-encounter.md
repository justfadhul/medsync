# ADR 0116 — An assignment is superseded on the visit's planned encounter

**Status:** Accepted — 2026-09-24 (D5).

## Context

An assignment is a `planned` encounter; there is no assignment table. `assignDoctorFromIntake` looked for an existing
assignment on the latest triage record only, so each re-triage made the next assignment insert another planned
encounter. A doctor who re-triaged three times had three rows (W2).

## Decision

1. **Write side.** `assignDoctorFromIntake` first looks for the visit's open encounter through any triage record of the
   same intake. Planned: re-pointed to the assignee and to the latest triage record (assigned or reassigned). In
   progress by the same doctor: nothing changes. In progress by another doctor: refused. None: the existing insert.
2. **Read side.** The projection collapses duplicates onto the newest (FW-4) and badges the rest. Nothing old is
   altered.
3. **Retire assignment.** `retireAssignmentAction({ encounterId, reason })` moves a planned encounter to `cancelled`
   with `completion_reason = 'assignment_retired'` and a `retire_assignment` audit row (added to the CHECK by migration
   0069), in one transaction under a row lock — only for an assignment not yet started, only by the doctor it is
   assigned to.
4. Starting a planned encounter now stamps `started_at` (it never did), so time in stage is true.

## Consequences

- No new duplicates. Existing ones stay visible in Needs closing until a person retires them.
- Until migration 0069 is applied, the audit insert fails and a retirement changes nothing.

## Alternatives considered

- **`superseded_at` / `superseded_by_assignment_id` columns** — the existing `cancelled` state with a reason and an
  audit row says the same thing.
