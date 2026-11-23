# ADR 0532: The doctor's Clinic line opens MedSync's own encounter, laid out as Tether

**Status:** Accepted, 23 Nov 2026. The owner reviewed a clickable prototype of the doctor's line ("Doctor's
Clinic line", 22–23 Nov), answered all four line changes, and said "Yes, build it". They then had the real
encounter desk isolated in a prototype of its own (the real code over example data, "MedSync Encounter", 11
versions, 23 Nov), restyled it through comments on that prototype, and said "now build it into the real thing".
Wording is a draft (`content/clinic-floor/triage-dialog.ts`, `TD.doctor`).

Builds on [ADR 0531](0531-clinic-floor-triage-is-a-pop-up.md) (triage on the floor) and the clerking desk v2
(ADRs 0163–0168, 0184–0190).

## Decision

**The encounter on Tether is MedSync's existing ten-step clerking desk, unchanged in behaviour.** The owner's
rule (23 Nov): "if we build this thing, we are being faithful to the existing encounter system". Nothing is
copied or simplified. The desk keeps its flags and gates (`EMR_V1`, `CLERKING_V2`, `CLERKING_PLAN_V2`,
`EMR_PRESCRIBING`). One thing is left out on Tether: the diabetes pack (`NCD_DM_DESK`) and the NCD module, on the
owner's word ("without the diabetes knowledge, just the encounter system").

### The doctor's Clinic line

- **For you / Whole clinic.** The line opens on the people booked for this doctor or for any doctor; a switch
  shows the whole clinic, each row tagged "For you", "Any doctor" or another doctor's name (`bookedFor`). Another
  doctor's patient has no Call (it reads "for Dr …"), and "Call next" is always this doctor's own next, whichever
  list is showing.
- **The triage scores on the card.** NEWS2, shock index, qSOFA and raised red flags, read from the triage record
  through the engine's own helpers (`otherScores`, `toneOfBands`); on a re-check, what the level was and when.
  Trends and earlier visits fold into one "more" section.
- **The actions stay in view.** The card's action bar is pinned to its bottom edge (`position: sticky`).
- **Start the encounter** calls MedSync's own `takePatientAction`, which assigns the doctor, opens the encounter
  from the triage record and goes to `/doctor/encounters/<id>`. A person with an encounter already shows Resume;
  a person not yet triaged asks for triage first. A planned encounter (assigned, not begun) is left to Start,
  which begins it; with several for one visit the open one is shown. A death on record opens MedSync's own
  confirm (`DeathConfirm`) for a reason kept in the audit log, as the doctor workspace does. With the engine off (`encounterEngineLive()` and
  `emrV1LiveFor` for the hospital), the button does not show and the old "Open their record" stays.
- **Tether lets one MedSync page through**: `/doctor/encounters/<id>` (`tetherClosed`). The encounter list and
  the rest of `/doctor` stay closed on Tether. The desk's Back goes to the Clinic line.

### The desk's Tether layout (looks only)

On the Tether host the desk page sets `data-tether-desk` and forces the Tide look (`TideScope force`; light and
dark both follow the person's setting, as on MedSync). A block of CSS in `app/globals.css` under that attribute
changes placement only, at desk width (`80rem`, the same as the desk's own `xl:` classes); phones and smaller
screens keep MedSync's layout:

- the floor's grey ground with the desk's parts as floating rounded cards;
- left column: the patient (MedSync's safety bar) as a navy card, then the ten steps as a vertical list; a tall
  patient card (many allergies) scrolls inside itself so the steps, Next and Sign stay on screen;
- across the top: the triage context as one strip, with triage and vital signs as one block, the six readings
  side by side as small tiles, and results, medicines and problems stacked to the right;
- the step as one card with its Next bar; the flags and note on the right.

No markup, wording, order or behaviour of the desk changes for this. MedSync's own host renders exactly as before.

### Changed on MedSync too: the earlier reading beside each vital sign

On the owner's comment on the prototype ("these should have trend indicators as well… like what we did for
triage"), each numeric vital sign in the desk's rail shows the reading before the newest, in grey: "was 124/78".
No arrow and no better/worse judgement, the same as the triage pop-up (ADR 0531). It is drawn only when the
earlier reading is from the same day as the newest (an older one may be another visit's), and blood pressure
shows systolic/diastolic. This is a change to the shared desk, so MedSync shows it as well.

## Consequences

- The Tether layout depends on the desk's DOM order and `data-slot` hooks (`clerking-desk`, `safety-bar`,
  `clerking-steps`, `clerking-rail`, `desk-actions`). A structural change to the desk can break the Tether layout
  without failing a type check; `tests/clinic-floor/doctor-line.test.ts` pins the hooks it relies on.
- An independent review (four lenses, each finding checked by a second reader) found 14 problems before commit;
  all are fixed here, among them the navy bar's Keys button contrast, dark mode, and the steps being squeezed
  out by a tall patient card.
- No migration. No new clinical rule, cut-off or dose.
