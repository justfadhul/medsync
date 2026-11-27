# ADR 0536: A request nobody answers escalates, on the lab's tick, with times the hospital signs

**Status:** Accepted, 24 Nov 2026. The owner (CSO) approved D4 and D7. Migration 0308 is GATED. Wording is a draft
(`content/care-requests.ts`). No feature flag: with no signed times there is no automatic escalation.

Reuses [ADR 0244](0244-escalation-planner-and-heartbeat.md) (a pure planner, a one-minute tick, a lazy run before
reads, a heartbeat) and [ADR 0243](0243-the-recipient-ladder.md) §3 (an empty level is passed at once). Builds on
[ADR 0533](0533-one-request-record-for-reviews-and-consults.md) (the request and its routing) and
[ADR 0534](0534-duty-rota-posts-and-assignments.md) (posts).

## Decision

1. **The clock (D4).** Each level waits the same window from when it was reached:

   | Request                 | Clock runs until | Minutes | Notes                                                            |
   | ----------------------- | ---------------- | ------- | ---------------------------------------------------------------- |
   | Review, `now`           | accepted         | 15      |                                                                  |
   | Review, `within_1h`     | accepted         | 60      |                                                                  |
   | Consult, `urgent_today` | accepted         | 120     | also marked overdue if not replied by the end of the Kampala day |
   | Routine, either kind    | replied          | 1440    |                                                                  |

   These are `D4_DEFAULTS` in `lib/requests/escalation.ts`. They are a prefill only (3).

2. **The ladder (D7).** Level 0 is the routing at placement. Level 1 is whoever is in post now on the
   `escalates_to_post_id` of the level-0 posts (a review: senior cadres only; needs `DUTY_ROTA` on), else the head of
   the department. Level 2 is the hospital contacts (`critical_contacts` level 2). Level 2 is the last: the request
   stays open and overdue there. A level with nobody to ask is passed at once, in the same run, and each level
   reached is recorded as an `escalated` event. The requester gets a `care_request_update` notice with the words of
   the step. The requester and pharmacy cadres are never asked.
3. **Times are signed, or nothing escalates.** `care_request_response_versions` (migration 0308) is the lab's
   critical-response-times table in shape: a draft, the hospital admin signs, then the CSO countersigns, which puts it
   in force and supersedes the set before; one signed set per hospital; whole minutes 1 to 2880. The hospital admin sets
   them at `/hospital-admin/departments/rota/response-times`; the CSO signs at `/admin/care-request-signoffs`
   (superadmin, aal2, fresh second factor). The form may prefill a draft with D4. With no signed set the planner has no
   times: no escalation, no due time, and rows read elapsed words ("Asked 40 min ago", ADR 0244 §1).
   - **The lab's author rule is dropped.** The lab refuses the draft's author as first signer unless a note is
     recorded. Here the hospital admin writes and signs first, so the rule would block the normal path. 0308 keeps one
     rule: the two signers differ, or an exception note is recorded (`crrv_signed_by_two`).
   - **R46: sign exactly what was shown.** Both signing actions pass the four numbers the signer saw, and
     `signRequestTimes` refuses with "changed since" if the draft differs.
4. **One tick, one lazy run.** The care-request run joins the lab's one-minute tick (`app/api/cron/lab-escalations`):
   no new route or schedule. A failure there is logged by name and never fails the lab run. Reads of Asked of you, For
   your department and Sent by you also run it for the viewer's hospital before they read (`requestDetail` does not).
   The owner sets the scheduler up once with `private.schedule_lab_escalations(url)` from migration 0106; nothing else.
5. **The heartbeat (ES-5).** Only the scheduler's run writes a heartbeat, with `source = 'care_requests'` (0308 widens
   the CHECK; 0102's `'scheduler'` and `'lazy'` are kept). The lazy run writes none, so a read that escalates on its own
   never hides a stopped scheduler. The banner "Escalations may be delayed. Phone the team for anything urgent." shows
   on `/doctor/requests` and `/clinician/requests` only when times are signed **and** `heartbeatStale` (the lab's, three
   minutes) says the last `care_requests` heartbeat is old or missing. It is a neutral card with a clock icon and its
   words, never red, and it fails soft: a read that fails shows no banner.
6. **Due words come from the live times (R41).** `care_requests.due_at` is set at placement (`dueAt` of the signed times
   then) and is only a placement record. Nothing reads it for the screen. Overdue and the due words use the planner's
   `overdue` and `dueAt` on the request's current level, with the times in force now. `deriveFromRows` still passes
   `dueAt: null` to the engine, so `derived.overdue` is always false and is not used. Words: "Due by 14:30" (Kampala
   time; "tomorrow" or the date when it falls on another Kampala day), "Overdue by 25 min", plain "Overdue" for the
   urgent consult's day end, "Asked 40 min ago" with nothing signed. Overdue is checked first, so a due time never shows
   beside an Overdue tag. A fully declined round shows no due words and is never overdue (R47, as R42). If the signed
   times cannot be read (0308 not applied yet), the lists fall back to "Asked … ago" and never fail. Overdue is a
   neutral slate `Tag` with a clock icon and the word.

### How the run behaves

- **R39.** The urgent consult's day-end overdue uses the **original** request time, not the redirect round's: the
  consult was due that day.
- **R40.** A level's window starts at the later of when the level was reached and when the times in force were signed
  (`csoSignedAt`). Signing or re-signing never bursts escalations for requests already open; the cost is that an old
  request escalates one window later.
- **R42.** A request whose current round is fully declined never escalates. A decline hands the patient back to the
  requester, who redirects or cancels; a redirect starts a fresh clock.
- **R43.** The run plans without locks, then locks only the due requests (`FOR UPDATE SKIP LOCKED`) and re-reads and
  re-plans them. Replied requests are excluded from the candidates, so nothing escalates after a reply. Two runs never
  escalate one request twice.
- **R44.** At level 1 and above, anyone already routed in the current round is treated as not available and the skip is
  recorded. A level of only repeats is empty and passes at once.
- **R45.** One savepoint per request. A bad request logs its id, the error name and the SQLSTATE (never the message)
  and is skipped; it never rolls back the run.
- **Rounds.** A redirect restarts the level at 0 and the clock; accepted (or phoned) and replied count in the current
  round only. Before migrations 0306 to 0308 exist, the run does nothing (R13).

## Consequences

- With no signed times nothing escalates and no request has a due time. This is the safe default and the setting a
  hospital starts in.
- Nothing is accepted, answered or closed by the run. It only asks the next person, and the requesting team stays
  responsible.
- A request that stays overdue at level 2 is visible as such, but nobody beyond the hospital contacts is asked.
- Open for the owner or CSO, not decided here:
  - **The numbers.** D4 is approved as the prefill; the CSO signs the set each hospital uses.
  - **The wording** of the banner, the due words and the requester's notice, all drafts.
  - **Where the two sign pages are linked from.** Neither has a nav link yet.
  - **Who is asked when nobody holds the escalation post and no head is set.** The request goes to the hospital contacts.
  - **A permanently failing request** logs once a minute; an alert on that is not built.
  - **The lazy run** derives every unfinished request of the hospital each read (a recorded shortcut); it needs a stored
    level and due time in SQL when open requests per hospital reach the thousands.
  - **The requester is told once per run**, not once per level reached in it.
