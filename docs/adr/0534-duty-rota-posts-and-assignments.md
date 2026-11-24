# ADR 0534: The duty rota — posts, timed assignments, and who covers

**Status:** Accepted, 24 Nov 2026. The owner (CSO) approved D1–D12. Wording is a draft (`content/duty-rota.ts`).
Behind `DUTY_ROTA` (`1` or hospital ids, `lib/rota/feature.ts`; independent of `CARE_REQUESTS`). Migration 0307 is GATED.

Builds on [ADR 0533](0533-one-request-record-for-reviews-and-consults.md) (the request record and its routing order),
which left the `post` step empty and `care_request_events.post_id` without a foreign key. The guard is copied in shape
from the pharmacy roster's (`0273_…` `private.*` roster guard, see [ADR 0273](0273-the-location-neutral-supply-record.md));
"ended, never edited" is [ADR 0265](0265-one-action-two-records.md)'s rule.

## Decision

1. **Posts and timed assignments.** `duty_posts` is a named post on a ward or in a department: who may hold it by
   cadre (`eligible_cadres`), its level, whether it takes consults, the post it escalates to, and how many may hold it
   at once (`capacity`, 1–20). `duty_assignments` is one person in one post for one window `[starts_at, ends_at)`,
   end exclusive: rostered, or a cover or swap that names the assignment it replaces (the writes create rostered and
   cover only; swap is in the table for a later phase). A post is archived, never edited
   or deleted. An assignment is ended (with a reason, by someone who may make the rota), never edited or deleted; an end
   is never after the planned end (`ended_at <= ends_at`). Writes run as the actor under the guard
   (`lib/rota/write.ts`: create and archive a post, assign, end early); nothing is granted to `anon` or
   `authenticated`, and both tables carry the `mfa_gate` policy and the audit trigger.
2. **Planned, not proven.** The rota says "rostered" and "on the rota", never "present" (`plannedNotPresent`:
   "Rostered, not confirmed present."), on the week grid, the duty chip and the ward cover panel. There is no sign-on.
3. **Shifts.** An assignment is made from a day and a shift on the Kampala wall clock (UTC+03:00, no daylight saving):
   day 08:00–17:00, night 17:00–08:00, 24 hours 08:00–08:00, week 08:00 for seven days (`windowFor`).
4. **D8: the hospital admin and the head of department make the rota.** `private.duty_rota_maker` is true for a
   `hospital_admin` of the hospital, or a head of the post's department who is in office now (substantive or acting).
   The doctor's `/doctor/rota` lists each department the doctor heads; the admin reaches a department through
   `/hospital-admin/departments/rota?department=<id>`. The named delegate is not built here: it comes in ADR 0538.
5. **D9: leave comes from `availability_blocks`.** One source: active `kind = 'leave'` blocks (ADR 0506). Leave never
   removes a duty. Leave over the part of a duty still to come marks it **needs cover**, derived on read (R33): the test
   is against `[max(now, start), end)`, so leave already over mid-duty does not flag it. The gap report shows needs-cover
   duties over the shown week and the next 72 hours. Leave is read as times only: no label, no reason. Assigning a person
   to a duty that overlaps their leave is refused (`rota_leave`). Weekly recurring leave is ignored (one-off blocks only).
6. **D10: the hospital names its own posts.** `name` is free text (2–80 characters); the rules underneath use five
   neutral levels (`junior`, `senior`, `consultant`, `nurse_in_charge`, `allied`) and cadre codes. No post names are
   shipped as data.
7. **The double-booking rule.** A person cannot hold the same post twice at the same time (`rota_double`), and a post
   cannot take more people than its capacity (`rota_full`; a cover or swap does not count the duty it replaces). An
   assignment **holds `[starts_at, least(ends_at, ended_at))`** (R34): the SQL and `endOf()` in `lib/rota/cover.ts` count
   the same window, an assignment ended early holds the post only until it ended, and one cancelled before it started
   holds nothing. A cover or swap must replace an assignment on the same post (R35, `rota_cover`).
8. **The guard, copied from 0273.** `private.duty_assignment_guard()` refuses a new assignment on an archived or
   another hospital's post (no HINT: `lib/rota/write.ts` answers "not found" first), and otherwise with a HINT that
   `lib/rota/write.ts` maps to the words in `content/duty-rota.ts`: the actor is not a rota maker (`rota_maker`), the person's cadre does not fit (`rota_grade`, needing an `active` or `approved`
   affiliation at the hospital), leave (`rota_leave`), `rota_double`, `rota_full`, `rota_cover`. The post's advisory lock is taken
   before the two counts, so two concurrent inserts cannot both pass. Ending an assignment is the only update allowed
   and needs a rota maker. Posts have no insert guard: `createPost` asks the same `duty_rota_maker` function first.
   Races on archiving come back as "not found", never a raw guard error (R37).
9. **Who can be rostered (R36).** The people offered are every live staff member at the hospital whose cadre the post
   accepts (as the guard allows), the post's own department first and others marked with their department.
10. **Who covers.** `whoCovers` (`lib/rota/cover.ts`, pure) walks a fixed order and names the step it used: the ward's
    posts, the department's takes-consults posts, the department head (substantive, then acting), the hospital contacts
    (`critical_contacts` level 2), else none. The ward panel on the hospital admin's wards page, and the duty chip in the
    doctor's top bar (the person's own in-post duty, post name and end time, no patient), read it. A rota read never
    breaks its page: the chip and the ward panel fail soft (`lib/rota/soft.ts`).
11. **Routing uses the post holder when the rota is on.** `loadRouteCandidates` fills the `post` step
    (`postHolders`, `lib/emr/write/requests.ts`) between named people and the team list, from `whoCovers`'s two post steps
    only. A review looks at the ward's posts of level senior or consultant, a consult at the department's takes-consults
    post. A holder who cannot take it (not a live clinician here; or, on a review, not a senior cadre, R7) is passed
    over and **recorded as a skip** (R25, R38a); the team list's own filtering stays unrecorded. When no ward holder is usable,
    the department's takes-consults post of those levels answers before the team list (R38). The read runs in a savepoint: if it fails,
    routing falls back to the team list and the request is still placed. The event records the `post_id` it was routed
    through. Rota off, nothing changes.
12. **No SQL twin until Phase 5.** The spec calls for one pure TypeScript resolver and one SQL twin. Only the TypeScript
    one exists; no SQL function answers "who covers". The guard's overlap rule is the SQL half that must agree with the
    engine (7).
13. **Migration 0307 is GATED and additive.** It creates the two tables, the maker function and two guards, adds
    `cre_post_fk` on `care_request_events.post_id`, and sets row-level security with a hospital-scoped read policy.

## Consequences

- No SQL resolver yet: anything wanting cover in SQL (escalation in Phase 3, pharmacy) must wait for the twin or call
  the TypeScript path.
- A post's holders are read at routing time; an assignment ended or leave added afterwards does not move a request
  already routed.
- Weekly recurring leave blocks are not honoured by the guard or the engine.
- Heads in `whoCovers` are not checked against leave.
- `rota_cover` does not check that the replaced duty is live or overlaps the new one.
- Posts have no insert-time checks that the department, ward and escalation post belong to the same hospital, or that
  cadre codes are real; the writes scope by the actor's hospital.
- The eligible list drops staff with no department.
- Open for the owner or CSO, not decided here:
  - **A back-dated end** on an assignment (`ended_at` set before `now`) is possible through the database.
  - **The delegate** who may make the rota (0538), and the week template and publish lock (a later phase).
  - Whether the hospital admin should see every department's rota from one page.
  - All wording is a draft.
