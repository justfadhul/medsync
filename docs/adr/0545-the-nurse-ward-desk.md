# ADR 0545: The nurse ward desk

**Status:** Accepted, 28 Nov 2026; Gate A signed ("get through all gates"). Fadhul approved the build plan "as picked" in chat, after shaping the clickable
prototype through comments (nurse desk v82). All clinical wording and every threshold are drafts for the CSO. Behind
`NURSE_WARD_V2` (`1` or hospital ids), off by default: with it off every `/nurse` page is unchanged.

Gate A: [docs/tether-ward/nurse-ward-desk-gate-a.md](../tether-ward/nurse-ward-desk-gate-a.md).

## Context

`/nurse` already has the pieces of a ward desk (patients, tasks, observations, MAR, controlled-drug doses, handover, beds,
assignments, incoming, ward stock), each on its own page. Nurses asked through the prototype for one desk that says what
is due, in what order, for whom, and lets them do it from where they are. The rota and requests foundation (ADRs
0533–0538) is merged.

## Decision

1. **One desk, upgraded in place.** The prototype is the reference. Existing `/nurse` routes are upgraded rather than
   rebuilt; new pages are added only where nothing exists (the To do board, the care plan, the calendar).
2. **Cadres.** In-charge, registered nurse and enrolled nurse, with the in-charge overlay from `NurseScope.isInCharge` and
   the grade overlay of `lib/nurse/capabilities.ts`. Maternity (midwife, Labour Care Guide, birth, postnatal) is parked
   and not part of this build.
3. **What the desk shows.**
   - Ward overview (in-charge): occupancy, today's flow, staffing ratio, vitals on time, doses not given, month figures
     counted from the ward's own records, the ward layout, who is on today.
   - My patients and the ward list, sickest first by NEWS2, as a table or as cards; cards only at phone width.
   - Due now, and a To do board (Overdue, Next hour, Later this shift, Done) that gathers vitals, doses, re-offers,
     co-signs, samples, results to pass on, nursing care and the doctor's non-drug orders. A record (vitals, a dose, a
     sample) opens its own window; a nursing task ticks off and can be unticked.
   - The patient chart: nursing care plan, observations and fluid balance, the doctor's plan and lab samples, medicines.
   - The medicines round: one chart for many patients by drug round, running infusions, protocols, as-needed doses.
   - Running the ward: bed board on the ward builder's live plan, admit onto a free bed, assign nurses, duty rota and
     My shifts, SBAR handover with receive-at-bed, a ward calendar shared with the department.
   - Quality of life: shortcuts, multi-step undo, remembered place and filters, "your next 3", countdowns in words, bulk
     ticks for nursing tasks, handover notes from any patient, larger text.
4. **Rota and requests** use `lib/rota` and `lib/requests`; the desk adds no second rota.
5. **One department calendar.** The head of department and the ward in-charge each add activities; everyone sees the
   ones that tell them; a nurse or doctor can ask to go, and the in-charge or head of department decides. New table,
   GATED migration (Phase 4).
6. **Self-doses from the patient app** land on the medicines chart only after the CSO sets who may self-dose and what
   the nurse confirms (Phase 3).
7. **Safety.** Decision support, never autonomous. Clinical records stay append-only and audited: an unticked task or a
   corrected dose is a new entry. Doses read "as prescribed". Red, amber and green mark the patient's state only;
   workflow states use square tags; nothing is shown by colour alone.
8. **Built with it** (gaps found in the current build, added 28 Nov 2026 at the owner's yes):
   - NEWS2 on the nurse lists from the scorer triage already uses (`lib/triage/scoring/news2.ts`).
   - The co-sign rules of `lib/nurse/capabilities.ts`, written but called nowhere, wired into the round, with a co-sign
     queue page.
   - Standard reasons for a dose not given, in place of the free-text `withheld_reason`.
   - Leave requests for all staff on the rota engine (leave is only entered by admins today).
   - A safety incident log for falls and pressure sores, so the in-charge's month figures are counted, not shown as
     "not recorded".
9. **Order.** Phase 1 shell, lists, To do, NEWS2 and quality of life (reads only, no migration); Phase 2 chart and care
   plans (GATED migration); Phase 3 medicines round, co-sign queue and dose codes (GATED migration); Phase 4 running the
   ward, the calendar, leave requests and the incident log (GATED migration); Phase 5 tests, the owner applies
   migrations and turns the flag on for one ward. One pull request per phase.

## Consequences

- Each phase stops for the owner before the next. Migrations are applied by the owner with `npm run db:migrate` in the
  worktree that holds them.
- The CSO signs the list in the Gate A document before the flag is turned on anywhere.
- Where the desk opens on the Tether domain is [ADR 0546](0546-ward-pages-open-on-tether.md).
