# ADR 0538: The rota is kept up with templates, publishing, cover and swap requests, and a delegate

**Status:** Accepted, 24 Nov 2026. The owner (CSO) approved the foundation decisions. Migration 0309 is GATED. Wording is a
draft (`content/duty-rota.ts`). Behind `DUTY_ROTA` (as [ADR 0534](0534-duty-rota-posts-and-assignments.md); independent of
`CARE_REQUESTS`).

Builds on [ADR 0534](0534-duty-rota-posts-and-assignments.md) (posts and assignments, and 0307's guard). Reuses the pharmacy
roster's pattern (0273): server actions write in `asClinicalWriter`, a SQL guard decides, and a transaction-local setting lets an
approved request through.

## Decision

1. **Templates.** `duty_rota_templates` holds a week template line: a post, the weekdays (1 Monday to 7 Sunday), a shift
   (`day`, `night`, `day24`, `week`) and optionally a person. A line is ended, never edited or deleted. `fillWeek` in
   `lib/rota/templates.ts` turns the lines into drafts for one week and skips any window the person already holds on that post
   (R34); a `week` duty fills once, on Monday. Lines with no person are skipped. Shift windows come from the cover engine
   (`windowFor`), never re-derived. `fillWeekFromTemplates` writes each draft through `assignDuty`, in its own transaction, so
   the guard's grade, leave, double-booking, room and lock rules apply to each; a refused draft is reported with the guard's
   words and never stops the rest.
2. **Publish and unlock.** `duty_rota_week_events` is append-only: per department and ISO Monday, a `publish` or an `unlock`
   (an unlock gives its reason, 2 to 300 characters). A week's state is its latest event (`weekPublished`;
   `private.duty_week_published` in SQL, week = the Kampala Monday on or before the instant). Only a rota maker with publish
   rights writes one, and a publish of a published week, or an unlock of a draft, is refused (`rota_week_state`).
3. **A published week is locked.** `private.duty_assignment_guard()` is 0307's rules unchanged, plus: inserting into or ending
   a duty in a published week is refused (`rota_locked`). Nothing is silently changed in a published week; the way in is an
   unlock, or an approved cover or swap (4).
4. **Cover and swap (decision: the colleague accepts, a maker approves).** `duty_swap_requests` and
   `duty_swap_request_events` (both append-only; the state is the events). The holder of a live duty asks a colleague to cover
   it, or to swap it for the colleague's duty on the same post (R35). The colleague accepts or declines; a rota maker approves
   (only after acceptance) or refuses; the database also lets the asker withdraw an open request, but no server action or
   screen offers it yet. Declined, approved, refused and withdrawn are
   final. Approval ends the asked duty with reason `covered` (and, for a swap, the colleague's too), each at the later of its
   start and now, and writes the colleague's cover or swap duty (and for a swap the mirror duty) in the same statement: all or
   nothing. The duty guard still checks grade, leave, double booking, room and the same post on those writes; only the week
   lock gives way. The asking is `askCoverOrSwap`, the answers `answerSwap` and `decideSwap` (`lib/rota/write.ts`).
5. **The delegate (D8).** `duty_rota_delegates`: the hospital admin or an open head of a department hands its rota to a
   colleague, until a day or until revoked, with or without the right to publish. Revoked, never deleted. A delegate does not
   pass it on. `private.duty_rota_maker()` gains `p_publish` (default false) and the active delegate; the three-argument
   version is dropped first (R8), so 0307's guard and the tests still call it with three arguments. `private.duty_rota_owner()`
   is 0307's rule (admin or open head), which only an owner passes, and which the delegate guard uses.
6. **Swaps send no notices in v1.** The colleague sees a request on the rota page ("Asked of you"), and the makers
   see it once the colleague has accepted ("Swaps to decide"); nobody is sent a notice, SMS or push.

## Rulings made while building

- **R48. The request-path lock bypass is for covers only.** `duty.rota_via = 'request'` lets a write through a published week
  only when it is cover-shaped: an insert that names the duty it covers (`covers_assignment_id`), or an end with reason
  `covered`. The setting is set and cleared inside the approval trigger only; a static test checks `lib/` and `app/` never
  contain `duty.rota_via`, so no application code can raise it.
- **R49. A delegation lapses with its grantor.** `duty_rota_maker` counts a delegation only while its grantor is still an owner
  of that department (least privilege), it is unrevoked and its end date has not passed (Kampala date). The recipient must be
  live staff of the hospital (`active` or `approved` affiliation). One active delegation per person per department (a unique
  index; the guard gives the usual case its words). An expired but unrevoked delegation still holds that one slot until revoked,
  as in 0273.
- **R50. The week lock is shared; publishing's is exclusive.** The assignment guard takes the department week's advisory key
  shared before the `rota_locked` check, and the publish event takes it exclusively, so a publish cannot race an edit. A
  request's events and a post's assignments take their own keys as before.
- **R51. `swapsAskedOfMe` is a separate export.** `myDuties` keeps its array shape and its callers are unchanged.
- **R52. Delegates reach `/doctor/rota`.** The page also lists departments where the viewer holds an active delegation
  (`delegatedDepartments`, judged by the same SQL function as the guard, once without and once with publish). For those,
  `canPublish` is the delegation's, and `canDelegate` is always false: a delegate never passes it on.
- **Every refusal has words.** Each 0309 refusal carries a HINT (`rota_maker`, `rota_changed`, `rota_post`, `rota_locked`,
  `rota_week_state`, `rota_holder`, `rota_cover`, `rota_delegate_until`, `rota_delegate_staff`, `rota_delegate_dup`,
  `request_state`, plus 0307's grade, leave, double and full), and `content/duty-rota.ts` has a sentence for each, so the screen
  never shows a database message.

## Consequences

- With `DUTY_ROTA` off nothing changes. With it on and no template or publish, the rota behaves as ADR 0534: a week is a draft
  and editable until a maker publishes it.
- A published week can still change through an approved cover or swap, and through an unlock with a recorded reason. Both are
  audited; nothing in a published week is edited quietly.
- A swap needs two people to act (the colleague, then a maker). Nothing is automatic and nobody is told: a request can wait
  unseen.
- Open for the owner or CSO, not decided here:
  - **Non-doctor delegates have no page.** `/doctor/rota` is the only delegate surface, so a nurse manager or other
    non-doctor given the rota has the right in SQL but nowhere to use it.
  - **Notices for swaps** (the colleague asked, a maker to approve, the answer back) are not built.
  - **Withdrawing a request** is allowed by the database but has no server action and no button.
  - **A delegation does not expire by itself in the unique index:** an end date that has passed stops it working, but it holds
    its slot until revoked.
  - **Fill into a published week** returns one `rota_locked` skip per draft rather than refusing once up front.
  - **All wording** is a draft.
