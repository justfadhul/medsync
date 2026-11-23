# ADR 0531: Triage on the clinic floor is a centred pop-up with the scores, the NEWS2 map and trends

**Status:** Accepted, 23 Nov 2026. The owner asked for the floor's triage side panel to be replaced, reviewed a
clickable prototype ("Tether Triage Pop-up", 15 versions, 22–23 Nov), chose the one-screen layout and said "yeah"
to building it. Wording is a draft (`content/clinic-floor/triage-dialog.ts`).

Supersedes the triage panel of [ADR 0491](0491-clinic-floor-views.md) (the side panel in `components/clinic-floor/triage.tsx`).
Pop-ups are centred dialogs, never side sheets (ADR 0161).

## Decision

Tapping Triage or Re-check opens `TriageDialog` (`components/clinic-floor/triage-dialog.tsx`), one screen at
laptop size:

- **Result band:** the level as a solid block with its colour named, what it means, the time to be seen, a
  five-step ladder, and seven scores (NEWS2, shock index, qSOFA, MAP, pulse pressure, modified shock index,
  glucose), each coloured by the band it falls in. On a re-check it says what the level and NEWS2 were last time.
- **Vital signs:** nine fields with the engine's word and tone. On a re-check each field says what the sign was
  at the last triage ("was 26"). The prototype's trend arrows and little lines were built and then removed on the
  owner's word (23 Nov): the plain "was" reads faster.
- **One panel, five tabs:** Red flags (the six life threats, the other manual discriminators, and "None of
  these"), NEWS2 map (the chart in its 3 2 1 0 1 2 3 layout with this person's cells filled), Other scores (each
  with its working in this person's numbers and its bands), Next steps, and Send to (clinic, doctor, note).

What the panel did is kept: the life-threat check must be answered (a threat or "None of these"); a Level 1
stops the triage and offers Open resus; the needed signs must be in before a level can be saved; changing the
engine's level needs one of the signed reasons; the save goes through the floor's port, so an offline triage
still queues and replays (ADR 0497).

No vital-sign cut-off is added outside the engine. The NEWS2 map is drawn by asking the engine what it scores at
each value (`news2Chart`), and the other scores read the engine's constants (`otherScores`), both in
`lib/clinic-floor/triage-view.ts`.

## Changed from the panel, on the owner's word

- **The level shows as the nurse types**, marked provisional until the needed signs are in. The panel showed no
  level until then. It still cannot be saved early.
- **The other manual red flags** (cardiac-sounding chest pain, stroke signs, suspected sepsis, severe respiratory
  distress, severe pain) can be raised on the floor and are sent to the engine as `present_discriminators`. The
  panel offered only the six life threats.
- **Red marks a serious clinical reading** here (a sign scoring 3, a score in its serious band, a raised red
  flag, a "worse" trend). The floor's earlier rule kept red for Level 1 and the Emergency button and showed a
  critical sign in amber. Red is still never a workflow state and never appears without its word.
- **Blood sugar** is always offered (it was behind "+ Blood sugar"); it stays optional.

## Added on the owner's word the same day

- **Send to** offers only clinics running today (plus the one the person came for and the one picked). Under the
  chosen clinic each doctor is a card: their own profile picture or initials, whether they are free, with a
  patient, on a break until a time or away, and how many are waiting for them (`doctorLoad`).
- **Level 1 or 2 alerts the clinic the person is sent to and the chosen doctor.** The engine action already
  alerted the triager's own department; `triageOnFloorAction` now also calls `notifyTriageOutcome` for the
  receiving clinic, with the chosen doctor by name. In-app only: no staff phone number is stored to text. A
  Level 1 is still not saved from the pop-up; it goes to Open resus, which mobilises its own way.
- **A nurse works in triage only.** `mayRecord(role, kind)` lets a nurse record triage, re-checks and their own
  sign-in on a shared device. On the Clinic line a nurse sees the line and "Doctors in this clinic now" (who is
  with which doctor, each doctor's state and queue) with no status switch and no Call, Finish, Running late or
  End session. `recordFloorEventAction` refuses the same actions from anyone without a clinic session of their
  own today, the test the floor already uses to tell a doctor from a nurse.

## Two drafts for the Clinical Safety Officer

- **Temperature in plain words** (hypothermia under 35.0, low to 36.0, normal to 37.5, raised to 38.0, fever to
  39.0, high fever above). Display only; NEWS2 points are still the engine's. `TEMPERATURE_WORDS_CSO_SIGNED` is
  false, so a production build shows the engine's own word until it is signed.
- **Glasgow Coma Scale** (eyes, voice, movement; 13 to 15 mild, 9 to 12 moderate, 8 or less severe). The engine
  works from ACVPU, so GCS does not change a level. It is kept in the visit's note ("GCS 12 (E3 V4 M5)"), the
  only place there is for it today.

## Consequences

- No migration, no Edge Function change. The triage record, the audit and the floor event are written as before.
- A proper home for GCS, GCS feeding the level, a MAP cut-off, and the children's and pregnancy charts drawn like
  the NEWS2 map are each their own decision.
- On a phone or a narrow tablet the columns stack and the pop-up scrolls.
