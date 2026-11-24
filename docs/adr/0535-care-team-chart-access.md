# ADR 0535: A request opens the chart for the people it names (the care_team basis)

**Status:** Accepted, 24 Nov 2026. The owner (CSO) approved D1–D12. Migration 0306 is GATED.

Makes real the `care_team` access basis that [ADR 0131](0131-rls-identity-propagation.md) reserved and
`0101_lab_work_access_basis.sql` left never matching. `phi_access_log` and `EmrAccessBasis` already allowed
`care_team`, so no log or type change. [ADR 0199](0199-doctors-allocate-the-ward-confirms.md) is kept (see 5).

## Decision

1. **Seeing the list is not opening the chart (D6).** Every active clinical member of the current department sees the
   request while it is open, with the patient's name and ward, so anyone can pick one up. Opening the chart needs the `care_team` basis
   below, and every open is logged.
2. **The arm.** One SQL helper (`private.care_team_patients`) feeds both bodies of the access rule. A person has chart
   access to the patient of a request while it is open, or for 30 days after its reply (`DEPARTMENT_WINDOW_DAYS`, as
   `department_recent`), if they are:
   - a **current-round routed recipient who has not declined in that round** (R23);
   - **any accepter**, in any round;
   - **the phoned user**, in any round (R23a).

   Each also needs a live clinical affiliation at the hospital. A cancel ends access at once. Earlier-round recipients and decliners lose chart access but **still read the request**
   (`private.care_request_visible`): D3 says a decline hands the patient back, and acting is limited to the current round.
   A decliner who must reopen the chart has to be routed again.
3. **Request visibility follows the current department (R26).** After a redirect, a clinical member of the new
   department reads the request and unrouted members of the old one stop. Old recipients keep reading through the
   event arm. The current department is the last `redirected` event's department, else the target. The department arm
   applies only while the request is open (no reply, close or cancel); the head arm does not. The requester, the
   department head and anyone an event names also read. **Anyone with any chart basis to the patient** (break-glass,
   lab work, `department_recent`, through `accessible_patient_ids`) reads every request on that patient. Pharmacy
   cadres are never team members here (R32).
4. **Restricted problems (HIV/TB).** A restricted reason makes the request `restricted`. It is still readable by every
   clinical member of the target department while open, as on orders. Lanes and notices never name it (ADR 0537).
5. **ADR 0199 holds.** Cover panels, notice subjects and lanes carry staff names and places only; a patient's name
   appears only where the viewer already has a chart basis.
6. **Reads** go through `asClinicalReader` with forced RLS; writes through `asClinicalWriter`. Nothing is granted to
   `anon` or `authenticated`.

## Consequences

- Seams left: post holders (`whoCovers`) are not read by routing yet (Phase 2); the escalation ladder is Phase 3.
  `care_team_members` (the patient app's outpatient programme team) is a different thing and is not used.
- Cost per read: `care_request_visible` runs `accessible_patient_ids` per row, and that function calls the care-team helper. Fine at v1 volumes.
- Open for the owner or CSO, not decided here:
  - **Restricted (HIV/TB) requests are readable by every clinical member of the target department while open.** This
    needs a deliberate CSO yes.
  - **Chart access while a request stays open has no time limit.** Escalation (Phase 3) leaves a request open and
    overdue, and the access stays open with it.
  - **In Phase 1 a consult with no named person routes to the whole department**, so all of them can open the chart.
  - Whether a decliner's access should instead survive until the request is redirected (R23 chose least privilege).
