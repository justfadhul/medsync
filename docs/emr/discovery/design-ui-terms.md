# Phase 0 discovery — design tokens, clerking UI, terminology (Q17, Q18, R9)

Worktree `medsync-emr` @ `feat/emr-engine`. Read-only survey, 2026-09-26. Line refs are `file:line`.
Nothing was built or measured (no `npm run build` on an 8 GB machine), so **the Q18 performance baseline (TTFB, JS size, interaction timings) is still open.** It needs one `next build` plus a trace, run by the owner or a single agent later.

## Q17 — Design tokens (authority: `DESIGN-medsync.md`; tokens: `@theme inline` at `app/globals.css:15`)

| Need                                      | Utility to use                                                                                                                                                                                                   | Source                                                                                           | Notes                                                                                                                                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Critical value (chip)                     | `bg-status-critical-bg text-status-critical-fg`                                                                                                                                                                  | globals.css:107-108; light #FEE2E2/#DC2626 (:297-298)                                            | DESIGN §"Status pairs" (DESIGN:384) says `bg-status-critical`, but **that utility does not exist**. The real pair uses `-bg`/`-fg` suffixes, as in `components/ui/pill.tsx:37`     |
| Critical value (number)                   | `text-status-critical-fg font-bold font-mono tabular-nums`                                                                                                                                                       | DESIGN:156 (weight 700 only for out-of-range labs), DESIGN:538 (dark mode: soft red #FCA5A5)     | The dark flip is automatic because the token is redefined in `.dark`                                                                                                               |
| Amber / warning                           | `bg-status-caution-bg text-status-caution-fg`                                                                                                                                                                    | globals.css:109-110; #FEF3C7/#D97706                                                             | The resus section of DESIGN (DESIGN:647,657) uses raw Tailwind `amber-*` and `rose-*` (the default palette is still available and is not reset). For EMR, prefer the status tokens |
| Alert banner                              | `bg-alert-bg border-alert-border text-alert-fg`                                                                                                                                                                  | globals.css:119-121                                                                              |                                                                                                                                                                                    |
| Neutral chip                              | `<Pill>` default `bg-gray-100 text-gray-700` or `<Pill tone="pending">` (`bg-status-pending-bg text-status-pending-fg`)                                                                                          | pill.tsx:34,39                                                                                   |                                                                                                                                                                                    |
| Status trio (stable / caution / critical) | `<ClinicalBadge status=…>` in `components/medsync/clinical-badge.tsx:13-19`, or `<Pill tone=…>` in `components/ui/pill.tsx`                                                                                      | DESIGN:392 names ClinicalBadge as the canonical consumer                                         | Also available: admitted, discharged, pending. Pill adds `sensitive`, `info` (blue), `notice` (orange)                                                                             |
| Plum place marker                         | `bg-plum-50 text-plum-800` (active nav), `text-plum-600` (active icon), `plum-500` (active dot)                                                                                                                  | globals.css:81-91; DESIGN:85-107; used in `app/doctor/_components/doctor-sidebar-item.tsx:60,69` | **Plum means place, never state** (DESIGN:105): never on buttons, chips, focus rings or status                                                                                     |
| Teal action                               | `bg-primary` / `bg-teal-600`, hover `teal-700` (`primary-hover`); `brand-*` is an alias of teal (globals.css:360)                                                                                                | DESIGN:16,300-303                                                                                | Focus ring `shadow-focus` (teal 40 %). The resus selected-step ring is `ring-2 ring-teal-500/70` (DESIGN:650)                                                                      |
| Page header                               | `PageHeader` in `app/doctor/_components/page-header.tsx:10`: overline `text-overline uppercase text-muted-foreground` (place), H1 `font-display text-heading-l font-medium`, subline `text-body-s`, `right` slot | Workspace W9                                                                                     | The encounter page **does not use it**. It has its own header with off-scale `text-[10px]` mono (see Q18)                                                                          |
| Fonts                                     | `font-display` = **Fraunces**, `font-sans` = **Geist**, `font-mono` = **Geist Mono**                                                                                                                             | globals.css:167-170; `app/layout.tsx:2,19-32`                                                    | **DESIGN:132-134 still names Neue Haas Grotesk and SF Mono.** The repo ships Fraunces/Geist, so the doc is stale                                                                   |
| Type scale                                | `text-display-{xl,l,m,s}`, `text-heading-{l,m,s}`, `text-body-{l,m,s}`, `text-caption`, `text-overline`                                                                                                          | globals.css:173-231                                                                              | Headings use weight 500. Use `font-medium`, never `font-bold`                                                                                                                      |
| Radius                                    | `rounded-{xs,sm,md,lg,xl,2xl,3xl}` (4 to 24 px), base 8                                                                                                                                                          | globals.css:234-241                                                                              |                                                                                                                                                                                    |
| Shadows                                   | `shadow-xs`, `shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-card`, `shadow-popover`, `shadow-focus`                                                                                                              | globals.css:244-250; values :406-412                                                             |                                                                                                                                                                                    |
| Easing                                    | `ease-expo-out` (0.16,1,0.3,1), `ease-symmetric`; `ease-spring` exists (:257) but is **not** sanctioned by DESIGN                                                                                                | globals.css:253-257                                                                              |                                                                                                                                                                                    |
| Durations                                 | `duration-fast` 100, `duration-normal` 150, `duration-slow` 250, `duration-reveal` 400                                                                                                                           | globals.css:259-262; DESIGN:298-303                                                              |                                                                                                                                                                                    |
| Stagger                                   | DESIGN: 40 ms between siblings (DESIGN:305)                                                                                                                                                                      | —                                                                                                | **The `stagger-children` utility (globals.css:763) uses 60 ms steps and 500 ms reveals, which conflicts with DESIGN's 40 ms / 400 ms**                                             |

Hard rules for EMR UI: red only for real emergencies; always pair colour with a text label; no left-edge accent bars (DESIGN:638); headings weight 500; no decorative motion.

## Q18 — Current clerking page `app/doctor/encounters/[encounterId]`

### Server tree (`page.tsx`, 432 lines, `dynamic = "force-dynamic"`, :26)

- `requireDoctorScope()` (:34). The page stops early with "not active" if `!encounterEngineLive()` (:36). It stops with a no-access note if the encounter is missing or belongs to another hospital (:73, :85).
- Data: `loadEncounterRecord`, `fetchPatientSummaryAudited` (PHI read is audited, surface `encounter_clerking_header`, :92-100), `loadLatestVitals`, `loadPatientDemographics`, `loadNcdDraft` (the last three only when `ncdClerkshipLive()`, :104-134).
- `doctorWorkspace(hospitalId)` (:136) adds the workspace chrome.
- JSX: a raw-rgba plum atmosphere div (:143) → local `WorkspaceTopBar` (:144, :258) with `VisitStatus` → `<Suspense><NextPatient/></Suspense>` when completed and workspace is on (:150) → `<Suspense><EncounterRail/></Suspense>` (:157) → a `stagger-children` column (:161) containing the local `PatientHeader` (allergies chip, :162, :394-411) + a hand-rolled "Clinical documentation" header (:164-179) + `NcdClerkship` (:193) or a "Being rebuilt" card (:218).
- Flags (`lib/encounter/feature.ts`): `ENCOUNTER_ENGINE_LIVE` (:13), `NCD_CLERKSHIP_LIVE` (:76), `CLERKSHIP_DRAFTS_LIVE` (:30), `PROBLEM_LIST_SYNTHESIS_LIVE` (:46), `LAB_RESULTS_LIVE` (:62); `DOCTOR_WORKSPACE` (`lib/workspace/feature.ts:15`).

### Client islands (`_components/`, 4,599 lines, all `"use client"` except visit-status)

| File                   | Lines | Role                                                                                                                          |
| ---------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| ncd-clerkship.tsx      | 306   | Container: site toggle, 3-column grid `13rem / 1fr / 24rem` (:239), section rail + SaveStatus, prev/next StepButtons, profile |
| ncd-capture.tsx        | 2110  | Renders the fields of one section (`NcdCapture`, sectionId)                                                                   |
| ncd-profile.tsx        | 599   | `NcdProfileView`, the live profile from `buildProfile`                                                                        |
| ncd-differential.tsx   | 386   | Differential view                                                                                                             |
| ncd-interpretation.tsx | 463   | Interpretation view                                                                                                           |
| ncd-trend.tsx          | 704   | Trend view                                                                                                                    |
| visit-status.tsx       | 31    | Server: `EndVisitButton` (from `app/doctor/schedule/_components/end-visit`) or a `Pill` "Completed · HH:MM"                   |

### Autosave

The page binds an inline server action, `saveDraft` (page.tsx:53-56). It calls `saveNcdDraftAction(encounterId, values)` (actions.ts). That action re-checks the flag, the scope and that the encounter belongs to the caller's hospital, then calls `saveNcdDraft` (`lib/ncd/draft.ts`), which does a per-author upsert into the **mutable `clerkship_drafts`**.

On the client (ncd-clerkship.tsx:155-196), saves happen **when the clinician leaves a section** (rail pick or prev/next), not per keystroke and not on a timer. A `seq` ref discards stale responses. `SaveStatus` shows saving / saved / failed with a retry.

There is **no save on unload or visibility change**, so edits in the last section are lost if the tab closes. There is also **no write to `clinical_documentation`**: the "sign / finalise" step is the missing increment.

### Doctor layout / shell / workspace

- `app/doctor/layout.tsx`: `requireDoctorScope` → `DoctorShell` (+ `ArrestAlarm` when `resusDeskV2()`).
- `FullBleedGate` (`app/doctor/_components/full-bleed-gate.tsx:15`) hides the shell chrome on paths matching `/doctor/(resus|triage|encounters)/[id]`.
- `EncounterRail` / `NextPatient` (`app/doctor/_components/workspace/encounter-extras.tsx:21,42`) are async server components over `loadWorkspace({scope:"mine", lanes})`. They render the client pieces `RailPanel` / `NextPatientBar` (`encounter-rail.tsx`, "use client") and `AcuityChip`.
- `AcuityChip` (acuity-chip.tsx:13-17) uses the status tokens for levels 1 and 4 and **raw orange, yellow and sky ramps** for levels 2, 3 and 5.
- Other reusable workspace pieces: `panel-sheet.tsx` (wraps ui/sheet), `patient-panel`, `triage-sheet`, `keyboard-help`, `elapsed`, `start-button`, `use-workspace-live.ts`.

### Design drift on the clerking page (fix while touching it)

- Off-scale sizes: `text-[10px]`, `text-[11.5px]`, `text-[12px]` (page.tsx:165, ncd-clerkship.tsx:211,219,266,295).
- The page does not use `PageHeader`.
- The plum atmosphere is a raw `rgba(159,47,126,…)` (page.tsx:143).
- `stagger-children` runs on a page that is opened many times a day. The emil skill advises no animation at that frequency.

## Reusable UI inventory

- **`components/ui`** (all on `@base-ui/react`): badge, button, card, data-table (sortable, re-exports Pill), dialog (`Dialog*`, `DialogPortal`), dropdown-menu (base-ui Menu), input, label, pill, separator, sheet (`Sheet*` incl. `SheetBody`, `SheetFooter`), skeleton.
- **`components/forms`**: combobox (base-ui Combobox, searchable, `ComboboxItem`), segmented-control (`role="radiogroup"`, the closest thing to a toggle-group or tabs), checkbox, consent-checkbox, field, date-range-picker, phone-input, password-input, avatar-upload, photo-form.
- **`components/medsync`**: clinical-badge, panel (`Panel`, `CountDisc`, `SectionRule`), editor-dialog, vital-stat, stat-card, patient-identity (`PatientIdentityCard`, `PatientAvatar`, `demographicsLine`), clinical-path, section-number, ecg-loader, auth-card.
- **Missing**: tabs, toggle-group, command/palette (no `cmdk`), popover, tooltip, textarea, select. base-ui ships Tabs, ToggleGroup, Popover, Tooltip and Select, so wrap them from there. **Do not add dependencies.** `framer-motion` ^12 is installed.

## Terminology assets and R9 (ICD-10 licensing)

| Asset                                                    | State                                                                                                                                                                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db/schema/clinical-codes.ts:9,22`                       | Tables `icd10Codes` (`icd10_codes`) and `loincCodes` (`loinc_codes`): code, display, category, version, source                                                                                                                                    |
| `supabase/migrations/0041_clinical_code_reference.sql`   | **GATED**. Creates both tables with authenticated-read RLS and seeds **19 ICD-10 rows** (:49, e.g. A09, A41.9, B54) + **9 LOINC rows** (:71), mirrored from the TS module                                                                         |
| `lib/encounter/reference-codes.ts` (187 lines)           | `ICD10_CODES` (19), `LOINC_CODES` (9), `CODE_SYSTEM_VERSIONS` = WHO ICD-10 2019 / LOINC 2.77. Only consumer: `tests/encounter/reference-codes.test.ts` (68 lines). **No UI uses it**                                                              |
| `db/schema/encounter.ts:92,123` (migration 0040:165,190) | `icd10_code text` on diagnoses and the problem list. Nullable, free text, **no foreign key to `icd10_codes`**                                                                                                                                     |
| `icd10_hint` columns                                     | `symptom-catalog.ts:49` (0042:26), `clerkship-picklist.ts:37` (0046:24). **No code in lib/app populates them**                                                                                                                                    |
| `lib/ncd`                                                | **No ICD codes.** Conditions and classifications use local slugs (`type_1`, `type_2`, `dka`, `hhs`, …; `diabetes/diagnosis.ts:174+`, `conditions.ts:676+`). "ICDR" (`catalog/schema.ts:53`, `exam-eyes.ts:119`) is the retinopathy scale, not ICD |
| `THIRD-PARTY-NOTICES.md`                                 | **Does not exist** (no NOTICE or LICENSE files tracked either)                                                                                                                                                                                    |

**R9 is confirmed.** WHO ICD-10 content is committed: 19 codes plus displays in `reference-codes.ts` and migration 0041. No licence is recorded, and the repo has no notices file.

LOINC also needs its attribution notice under the LOINC licence. The 9 rows carry a source string but there is no notice file.

Options: record a WHO licence and add `THIRD-PARTY-NOTICES.md`, or keep only the local-slug concept layer (the CFC concepts) and treat ICD-10 as an optional mapping column that stays empty until a licence exists. Migration 0041 is immutable, so removing its rows would need a new migration.

## Prompt vs repo (this slice)

- The prompt's Q18 asks for performance numbers. None were measured (no build allowed), so the item is deferred.
- DESIGN documents fonts (Neue Haas / SF Mono) and utility names (`bg-status-critical`) that differ from the repo (Fraunces/Geist; `bg-status-critical-bg`).
- DESIGN's stagger of 40 ms / 400 ms does not match the `stagger-children` utility (60 ms / 500 ms).
- `ease-spring` exists in the tokens despite the rule that motion is expo-out only.

## emil-design-eng — the rules UI agents must apply (subordinate to DESIGN)

1. Decide by how often the UI is seen. At 100+ times a day (clerking steps, the rail, keyboard actions), use **no animation**. Occasional UI (sheets, dialogs, toasts) gets standard motion. (SKILL.md:66-80)
2. Never animate keyboard-initiated actions.
3. Keep UI motion under 300 ms. Use MedSync durations: 100 (press/hover), 150 (inputs/badges), 250 (sheets/modals).
4. Pressables get `active:scale-[0.97]` on a 100–160 ms transition (SKILL.md:199-213).
5. Never animate from `scale(0)`. Start at 0.95 plus opacity. Popovers scale from their trigger origin (`transform-origin`).
6. Prefer CSS transitions over keyframes for interruptible UI. Use `@starting-style` for enter states.
7. Animate only `transform` and `opacity`. Avoid layout properties.
8. Honour `prefers-reduced-motion`: keep opacity and colour, drop movement (SKILL.md:525+).
9. Gate hover effects behind `@media (hover:hover) and (pointer:fine)`.
10. On tooltips, skip the delay on subsequent hovers. For review output, use the skill's required before/after table format (SKILL.md:38).
    Where emil suggests springs, DESIGN's expo-out and no-decorative-motion rules win.
