# ADR 0537: Requests ride the Plan basket, with lanes and pages for the people asked

**Status:** Accepted, 24 Nov 2026. The owner (CSO) approved D1–D12. Wording is a draft
(`content/care-requests.ts`). Behind `CARE_REQUESTS` (needs `EMR_V1`; the Plan entry also needs `CLERKING_PLAN_V2`).

Extends [ADR 0184](0184-plan-by-problem.md) §3 (one basket, one Place action) and
[ADR 0161](0161-pop-ups-are-centred-landscape-dialogs.md) (pop-ups are centred dialogs).

## Decision

1. **A request is a third basket line.** Beside orders and prescriptions, the basket holds requests, and **Place** sends
   all of them in one all-or-nothing transaction (`placePlan` calls `placeRequests`). If a request fails, the orders are
   not sent. The button reads "Place n orders, m prescriptions and k requests" (`placeWords(n, m, k)`); with no
   requests it reads as before. Flag-off, the Plan is unchanged.
2. **Senior review becomes a request.** Choosing a time keeps one review line in the basket, sent to the admit ward's
   department, else the viewer's own. A fourth choice, **Not needed**, drops the line and asks for a reason of three
   words or more, which goes into the note. A placed review settles the checklist item.
3. **Ask another team** adds a consult line: department, optional named people, urgency, advice only or please see the
   patient, the problems that are the reason, a question, and "discussed by phone". Pharmacy departments are not offered.
4. **Lanes.** The doctor workspace board gains **Asked of you** (hotkey `y`; `a` is assign) and **Consults for
   your department** (`c`). "Asked of you" finds routed rows by user id whatever the doctor's scope department, and keeps
   every request. A department lane shows only unclaimed requests (not accepted or claimed), and exposes a claimed flag,
   not a state word (R30).
5. **Pages.** `/doctor/requests` and `/clinician/requests` (with a nav link in the clinician layout) list asked of you,
   of your department and sent by you; `?request=<id>` opens one. There are two centred `EmrDialog`s: `RequestDialog`
   (accept, decline, redirect, close and cancel as inline sections) and `ReplyDialog`. Opening a request records `seen`
   only for a current-round routed recipient. Off, the pages are not found. Every state is a neutral square `Tag` with
   its word, never red, amber or green; "Overdue" (clock icon) cannot appear in Phase 1, since `dueAt` is null until
   Phase 3. The requesting team stays responsible, on every screen.
6. **Restricted requests without a chart basis stay nameless (R29, R31).** Such a request on a department lane is left
   off the board, and on the list it shows no patient name, no question, no restricted problems and **no MRN** (an
   identifier is identity). It fails closed. A recipient, who holds a chart basis, sees it in full.
7. **Pharmacy is out (R32).** No request is routed, named or redirected to a pharmacist, and pharmacists stay on `/pharmacy`.

## Consequences

- The note's Plan block still carries the review words; the request is the delivery, the note stays the record.
- Notices appear in the staff notices list; no SMS (not built).
- Open for the owner or CSO, not decided here:
  - **R31's stricter hiding for restricted requests** (name, question, problems and MRN) is for the CSO to confirm.
  - **Two wordings for urgent and advice** in the Plan and on the request; all strings are drafts.
  - A review is not retargeted if the ward changes after the time is picked.
  - An unnamed board row could also blank code, age and sex; unreachable today.
