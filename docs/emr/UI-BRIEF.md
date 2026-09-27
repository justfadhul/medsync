# EMR UI brief — the chart, the clerking desk, orders and results

Precedence, as AGENTS.md sets it:

1. **DESIGN-medsync.md** wins every visual disagreement.
2. The design and animation skills (`frontend-design`, `emil-design-eng`) supply craft only where the design system is
   silent.
3. The wireframes in `gate-a-proposal.md` §E and PROMPT §5 say _what_ is on screen.

This brief is what they add up to. Read it with those files; do not re-derive it.

## 1. Subject, audience, job

- **Subject:** a Ugandan hospital's clinical record. Adult OPD and emergency first; Mulago beachhead.
- **Audience:**
  - medical officers, clinical officers, nurses and interns between patients;
  - desktop in clinic, tablet on the ward, sometimes a low-end Android phone;
  - the lab bench for result entry.
- **Primary job:** know who this is and what could hurt them (the safety bar), then document, order and act in as few
  taps as the budgets in PROMPT §4. **Secondary job:** trust it. Every value sits one tap from its provenance.

## 2. Tokens, used as the system names them (from `app/globals.css`)

| Role             | Utility                                                                                                                                                                                                                     | Rule                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Action           | `bg-primary` / teal-600, teal focus ring                                                                                                                                                                                    | buttons, links, focus, selected controls, count discs                                                                                     |
| Place            | `bg-plum-50 text-plum-800`, icon `text-plum-600`                                                                                                                                                                            | the current chart section, the current note section, the active nav item. **Never a state.**                                              |
| Critical (alarm) | `bg-status-critical-bg text-status-critical-fg` (#DC2626 family)                                                                                                                                                            | **only** a critical result value (signed definitions only, so none in prod today) and the global Emergency affordance                     |
| Caution (amber)  | `bg-status-caution-bg text-status-caution-fg`                                                                                                                                                                               | awaiting acknowledgement, overdue, unsigned, offline, "Allergy status not recorded", "Unable to assess", uncoded allergen, amended result |
| Neutral state    | `<Pill>` default, `ClinicalBadge`                                                                                                                                                                                           | draft, signed, completed, working, final: grey, words                                                                                     |
| Type             | `font-display` (Fraunces) for the **patient name only** (and a hero value if one exists); `font-sans` (Geist) for everything else; vitals and result values use Geist Mono with `tabular-nums`, weight 500 (DESIGN §vitals) | headings weight 500, sentence case                                                                                                        |
| Motion           | `ease-expo-out`, `duration-fast` (100) / `-normal` (150) / `-slow` (250) / `-reveal` (400)                                                                                                                                  | see §5                                                                                                                                    |

**Never:**

- red for anything else;
- colour alone (every state has an icon and a word);
- left-edge accent bars;
- bold headings;
- off-scale sizes like `text-[11.5px]` (use the text-\* scale; fix the drift you touch on the encounter page);
- raw hex;
- `stagger-children` on work surfaces.

## 3. The design plan

- **The one bold element is the safety bar.** It is sticky and never scrolls away. The patient name is in Fraunces; the
  identifiers, age and sex are in Geist with tabular numerals. It then states, in words:
  - the allergy line, worst first;
  - pregnancy, only when a fact exists;
  - "Died hh:mm" (a neutral chip);
  - the top three problems;
  - critical results awaiting acknowledgement;
  - a lock plus "Restricted".
    Its accessible summary is read first. Everything below it stays quiet: hairline `Separator`s, no cards inside cards,
    no shadow beyond sheets and popovers.
- **Chart layout.** The left section index (Summary, Timeline, Results, Notes, Orders, Medicines, Problems & allergies),
  with plum marking the current section, and a reading column beside it. Numbers are right-aligned and text
  left-aligned, on a 4 px grid.
- **Clerking desk layout.** Three columns at ≥ 1280 px:
  - left: the Workspace rail (existing `EncounterRail`) above the note's section index;
  - middle: the note, set for reading (measure < 80ch, generous line height, bracket section numbers `[01]`, because the
    template **is** a sequence);
  - right: the context rail (triage, vitals, results, medicines, problems).
    Tablet portrait: the context rail opens in a centred dialog titled "Context". Phone: one section at a time, the
    index in a centred dialog, and the primary action bar fixed at the bottom (ADR 0161: no sheets from an edge).
- **Structured items sit inline as chips** with value and source mark. Never dot-joined meta strings. For multi-part
  metadata, use separate spans with spacing.
- **Avoid the template tells:**
  - ALL-CAPS eyebrow labels;
  - "A · B · C" strings;
  - `→` appended to buttons;
  - identical rounded cards for every block;
  - gradient washes;
  - one accented word in a heading.
    Section markers exist only where the content is a sequence.

## 4. Interaction rules

- **Findings:** three-state toggle chips (present / absent / not asked). The default is not asked. The accessible name
  states the value: "Chills, present". Keyboard: Space cycles.
- **Keyboard:**
  - `/` at the start of an empty line opens the insert menu (vital, finding, diagnosis, order, medicine);
  - `j`/`k` move between sections;
  - `Ctrl/Cmd+Enter` signs;
  - `?` opens help.
    All are off inside text fields, except the sign chord. The focus ring is teal and always visible.
- **Diagnosis picker:** a base-ui Combobox over `diagnosis_terms`. The clinician picks a term, never a code. Each row
  shows the term, the ICD-11 code with its verification mark, and flags (chronic, restricted). Budget: ≤ 4 keystrokes
  plus Enter for the top 50.
- **Allergy editor:** a centred dialog (ADR 0161). An uncoded entry is labelled "Matched by name only — code it for class checks" (amber).
- **Result entry:** one screen per panel, units defaulted, a comparator allowed. A unit-mismatch prompt asks and never
  rejects.
- **Empty and error states** direct the user; they never set a mood:
  - "No HbA1c on record. [Order HbA1c]";
  - "Allergy status not recorded" (amber) with "Record allergies";
  - "Offline, changes kept on this page" (amber).
    Errors say what happened and how to fix it; they don't apologise.
- **Copy:** sentence case, active voice. A button says exactly what happens ("Sign note", "Complete visit", "Order
  mRDT"), and its toast repeats the verb ("Note signed"). Say "person with diabetes", never "diabetic" as a noun.

## 5. Motion (emil-design-eng, subordinate to DESIGN)

| Thing                                                                    | Motion                                                                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Keyboard actions (`j`/`k`, `/` menu, section switch, chip toggle by key) | **none**: instant                                                                                                   |
| Chip press, button press                                                 | colour change + `scale(0.97)` on `:active`, 100 ms expo-out; no entrance animation (used dozens of times per visit) |
| Popover and combobox (diagnosis picker, insert menu)                     | 150 ms expo-out, opacity + `scale(0.97)`, `transform-origin: var(--transform-origin)` (origin-aware, base-ui)       |
| Dialogs (allergy editor, completion, context on tablet; ADR 0161)        | 150 ms expo-out, opacity + scale, centred origin (`EmrDialog`)                                                      |
| Modal confirm (notifiable diagnosis, sign)                               | 100 ms (as EditorDialog), centred origin                                                                                              |
| Autosave status, new result arrival                                      | no motion: a text swap and a polite live region                                                                     |
| Hover                                                                    | only under `@media (hover:hover) and (pointer:fine)`                                                                |
| Reduced motion                                                           | keep opacity, drop every transform                                                                                  |

Transitions are CSS, on named properties only (never `transition: all`; replace it where you touch it). Nothing enters
from `scale(0)`. Keyframes are not used for anything re-triggered.

## 6. Architecture rules for UI code

- **Pure `*View` components** in `components/emr/**` take the precomputed payloads (`lib/emr/chart.ts`
  `buildChartPayload`, order and result derivations). Server components load; client islands exist only where
  interaction needs them. This lets the scratch fixture harness render every screen without a database.
- The new UI sits behind `emrV1LiveFor(hospitalId)`. With the flag off, every existing page renders exactly as before.
- Primitives come from `components/ui`, `components/forms` and `components/medsync`. Missing ones (Tabs, ToggleGroup,
  Popover, Tooltip, Select, Textarea) are thin wrappers over `@base-ui/react`. **No new dependencies**; `cmdk` is not
  allowed.
- **Accessibility:**
  - WCAG 2.2 AA in light and dark;
  - targets ≥ 44 px on touch;
  - live regions polite, assertive once per critical result;
  - a table alternative for every sparkline;
  - two identifiers on every row, order, specimen label and printout.
- **Budgets:**
  - clerking route JS ≤ 90 KB gz added;
  - zero layout shift on autosave and live updates;
  - section switch < 100 ms;
  - no chart library (inline SVG sparklines).
- **Print:** print CSS only. Black on white, two identifiers in header and footer, "Page x of y", restricted items
  excluded unless the clinician includes them item by item.
