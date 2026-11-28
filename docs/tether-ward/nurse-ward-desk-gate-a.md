# Nurse ward desk: Gate A

**Signed:** 28 Nov 2026. Fadhul (owner) approved the plan "as picked", added the five gaps ("Yes, add them") and said
"get through all gates". Decisions: [ADR 0546](../adr/0546-the-nurse-ward-desk.md),
[ADR 0547](../adr/0547-ward-pages-open-on-tether.md). Every clinical threshold and wording below stays a draft for the
CSO; nothing switches on until `NURSE_WARD_V2` is set by the owner.

Reference prototype: nurse desk v82 (artifact `97w1DBRGp3Phzq7uQK153d`). Visual plan `5XHBac4WEUM7FovhPuoZJp`, readiness
report `CSyoZq386KueATVR1qnzcH`.

## What exists and what each phase adds

| Area                        | On main today                                                       | Phase | Adds                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Nurse home                  | `app/nurse/page.tsx`, a page of links                               | 1     | Ward overview for the in-charge: occupancy, today's flow, staffing ratio, vitals on time, doses not given                            |
| Patient list                | `app/nurse/patients`, `listNursePatientPanel`, sorted by assignment | 1     | Latest NEWS2 (`lib/triage/scoring/news2.ts`), sickest first, vitals due or late from `monitoring_charts.frequency`, table or cards   |
| Tasks                       | `app/nurse/tasks`, `nurse_tasks` (0281), one-way                    | 1, 2  | To do board over vitals, doses, samples, tasks and the doctor's non-drug orders; untick as a reversal entry (2)                      |
| Tether                      | `TETHER_OPEN` has `/nurse/incoming` only                            | 1     | `/nurse` open behind the flag; ward nurses land on the desk                                                                          |
| Care plan                   | none (`care_plan` is the clinician's)                               | 2     | Nursing care plan: problem, related to, as shown by, goal, items ticked, shift evaluation                                            |
| Observations                | `app/nurse/observations`, `clinical_observations`, fluid balance    | 2     | NEWS2 table and graphs, blood sugar view                                                                                             |
| Lab samples                 | per patient `_orders`                                               | 2     | Ward list of samples to take and send, results to pass on                                                                            |
| Medicines                   | `app/nurse/mar`, `medication_administration_records`                | 3     | Round across patients, coded not-given reasons, re-offer, as-needed, infusion times, co-sign queue using `lib/nurse/capabilities.ts` |
| Self-doses                  | `dose_events` (patient app, no stay link)                           | 3     | Link to the prescription after CSO rules                                                                                             |
| Beds, incoming, assignments | `app/nurse/beds`, `incoming`, `assignments`, `lib/wards`            | 4     | Into the desk; admit from incoming                                                                                                   |
| Rota                        | `lib/rota` (any cadre), doctor and admin screens                    | 4     | Nurse Duty rota and My shifts; leave requests for all staff                                                                          |
| Handover                    | `shift_handovers`, free text per ward                               | 4     | SBAR per patient, tasks carried, received at the bedside                                                                             |
| Calendar                    | none                                                                | 4     | One department calendar, who is told, who goes, ask to go                                                                            |
| Incidents                   | none                                                                | 4     | Falls and pressure sores log                                                                                                         |

## Data (GATED migrations, from 0314, applied by the owner)

- Phase 2: nursing care plans, items, ticks, evaluations; nurse task reversal entries.
- Phase 3: not-given codes, re-offer, infusion start and stop, co-sign requests.
- Phase 4: calendar and attendance, SBAR handover and receipts, leave requests, safety incidents.

Phase 1 adds no table: it reads what exists.

## For the CSO

- NEWS2 bands and the wording of "emergency review", "urgent review", "routine".
- Vitals frequency by score and when a check counts as late.
- ~~The care-plan library (problems, goals, care items).~~ Signed as written by Fadhul (owner), 28 Nov 2026
  (`content/nursing-care-library.ts`).
- Who may co-sign which high-alert doses; enrolled-nurse limits.
- Self-dose rules and what the nurse confirms.
- Fluid balance targets and the low-urine alert.

## Rules carried from the prototype

Decision support, never autonomous. Records are append-only: an untick or correction is a new entry. Doses read "as
prescribed". Red, amber and green mark the patient's state only; workflow states are square tags; nothing by colour
alone. Pop-ups are centred dialogs. Maternity is parked.
