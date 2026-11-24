# ADR 0533: One request record for senior reviews and consults

**Status:** Accepted, 24 Nov 2026. The owner (CSO) approved D1–D12 of
`docs/superpowers/specs/2026-11-24-consults-rota-foundation.md`. Wording is a draft
(`content/care-requests.ts`, "Draft wording: awaiting CSO sign-off"). Behind `CARE_REQUESTS`; migration 0306 is GATED.

Builds on [ADR 0184](0184-plan-by-problem.md) (the Plan) and [ADR 0199](0199-doctors-allocate-the-ward-confirms.md) (no patient names
outside the care team). Before this, "senior review" only wrote words into the note and nobody was told.

## Decision

1. **One record for both kinds (D1).** `care_requests` holds a `review` (senior review of an admission) or a
   `consult` (ask another team). It is written once, when the Plan is placed, and never updated. `care_request_events`
   is its append-only history: routed, seen, accepted, declined, redirected, replied, closed, cancelled, escalated.
2. **The state is derived from the events, never stored** (`lib/requests/engine.ts`), as orders are. Only closed and
   cancelled are final; replied is not (a review may need more). A reply with "No follow-up needed" writes `closed` in
   the same transaction.
3. **Seen is not acknowledged (D2).** Opening a request records `seen` only for a current-round routed recipient, once
   per person per round; anyone else's look writes nothing. It is never shown as an acknowledgement.
   **Accept** (optional "expect me at") is the acknowledgement. Only a **signed reply note** answers the request.
4. **A decline needs a reason and hands the patient back (D3).** The requesting team stays responsible throughout, and
   every request screen says so. A round is `declined` only when every current-round recipient has declined and nobody
   has accepted; any accept in the round wins, so others may still accept after a partial decline (R22). A second
   decline by the same person in a round is refused. A **redirect** starts a new round; seen, accepted and declined
   count only within the current round.
5. **A consult says "advice only" or "please see the patient" (D5)**, required. A review takes no such choice.
6. **Phoned (spec point).** `phoned_user_id` and `phoned_at` are set at placement. The engine counts the phoned user as
   accepted at that time, but only while that time falls in the current round (a redirect ends it as an acceptance; the
   phoned user keeps chart access, ADR 0535). Nobody writes an event on another person's behalf. The phoned user must hold a live clinical
   affiliation at the hospital, must not be the requester, and `phoned_at` must be no later than now plus 5 minutes and
   no earlier than 24 hours ago (R24).
7. **Routing, in order** (`lib/requests/routing.ts`, pure): named people; post holders (the Phase 2 seam, none yet);
   the team list (a review takes senior cadres only, a consult every active clinical member); the requester's primary
   supervisor (a review by a junior only); the department head (substantive, then acting); the hospital's level-2
   contacts; nobody. With nobody, the request is still placed with a `routed` row with no recipient and reads "Reached
   nobody: phone the team". It never blocks the basket. The requester is always excluded.
   - **No request reaches a pharmacist in v1 (R32).** Routing yields no pharmacy cadre (team, heads, contacts,
     supervisor); named and phoned people who are pharmacy cadres are refused; pharmacy departments are left out of the
     Plan's department picker and the redirect list.
   - **Named people** must be clinicians at this hospital (any affiliation state at placement); routing skips the
     inactive ones. Phoned must be live (R24, R24a).
   - **Skips are recorded on the routed rows** (`care_request_events.skipped_user_ids`, empty unless the kind is
     `routed`): the requester; inactive, non-clinical or pharmacy-cadre people at the named, head and contact
     steps; and an inactive supervisor. A pharmacy-cadre supervisor is left out without a record. Team-list members
     filtered in SQL are not skips (R25).
8. **Who may act** (`canAct` in `lib/requests/engine.ts`; the writer re-checks).
   - **Seen, accept, decline:** someone who was asked and is not the requester (a current-round recipient, an active
     clinical member of the current department (D6: anyone there may pick it up) or its head), while the state is sent
     or seen.
   - **Reply:** the same people, only once the request is accepted, and they need chart access (ADR 0535).
   - **Redirect, close, cancel:** the requester alone. Redirect only after a full decline; close only after a reply;
     cancel any time before a reply.
   - Nothing acts once closed or cancelled.
9. **Reply is one dialog and one signed note.** `tpl.consult` for a consult, `tpl.ward_round` for a review (findings in
   s01, assessment in s03, recommendations in s04), through `insertSignedNote` on the request's own encounter, so it
   signs even after the patient is admitted. The same transaction writes `replied` with the note id. A replay must match
   the same kind and actor, else it is a conflict.
10. **Notices are written in a savepoint** inside the request's transaction, so none can outlive an unplaced request and a
    notice failure never rolls the request back. Subjects carry staff names and places only, never a patient (ADR 0199).
    The live nudge is the existing per-user topic. `sa_notifications.kind` gains `care_request`, `care_request_update`
    and `ward_incoming`; the Drizzle mirror of that CHECK is corrected, so `sa_notifications_kind_check` is exact.
11. **When requests go out, and when the nurse in charge is told (D11).** A review goes out at **Place**, to the admit ward's
    department (else the viewer's own), and the ward id is recorded on the request. The nurse in charge is told at **admission (Close)**: `afterClose` runs in a second transaction
    after the encounter completes, so the notice is written there in a savepoint and its failure is a warning. The
    in-charge is anyone whose assignment has started and is open-ended or ends in the future (substantive or acting).
12. **Smaller rules.** With requests in the basket the Place toast's verb follows `placeWords`; flag-off it is
    unchanged (R6). The Plan's visibility guard for the basket also counts requests (R18). A review whose ward has no
    department shows a visible words line instead of a silent gap (R28).
13. **Free text** (question, decline and redirect notes) is stored with `encrypt()`.
14. **Staff notices.** A minimal "Notices" list (`components/medsync/staff-notices.tsx`) reads and dismisses a person's
    own `sa_notifications`; nothing read them for staff before.

## Consequences

- Migration 0306 is GATED. Apply it before turning `CARE_REQUESTS` on, in this worktree: `cd <worktree> && npm run db:migrate`.
  Flag-off, every page is unchanged.
- Response times and automatic escalation are not here (D4, Phase 3). An unanswered request waits on its list.
- Not done: no named first contact per inpatient (D12); no SMS to staff; cover posts and the duty rota are Phase 2, so
  step 2 of routing is empty and a consult with no named person goes to the whole department's team list.
- Open for the owner or CSO, not decided here:
  - The decline reason codes and all wording are drafts.
  - Accept defaults to "No time" for "expect me at".
  - The catalogue status `cso_signed` now also covers the draft `tpl.consult` template.
  - Whether an intern's consult needs a co-sign (`request_consult` policy) and whether social workers get a cadre.
  - Pharmacy consults are out of v1 (R32); the owner decides if and how they come in.
