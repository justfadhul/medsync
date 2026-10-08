# STOP 1 — The diabetes pack reads the ten-step clerking (ADR 0216)

Branch `feat/ncd-dm-desk`, worktree `medsync-ncd`, 2026-10-08. Built, off (`NCD_DM_DESK`).

## Built

- `lib/ncd/pack/from-clerking.ts`: the clerking record → the pack's input. 142 of 208 pack features mapped (about 47
  renames, 95 derived); 62 asked in "More diabetes questions" (46 after the Core 12, below); 4 unused. Blank is never negative.
- Loader: creatinine, potassium, lipids, urine protein and ketone strips, pregnancy gestation and weeks post-partum.
  eGFR from creatinine with the registry's CKD-EPI 2021.
- `lib/ncd/pack/desk.ts`: flags (interrupt urgent; today and medicines caution, red flag urgent), the Impression verdict,
  when the profile shows. `components/clerking/diabetes-profile.tsx`; Plan "Diabetes: due and targets".
- Impression: type 2 and "type not yet determined" merge into one chip led by the pack's verdict; type 1 keeps its own.
- "More diabetes questions": the module form cut to what the clerking does not ask, no panel (`more-questions.ts`).
- Flag `NCD_DM_DESK` (`1` or hospital ids; needs `CLERKING_V2`). Off: nothing changes.

## Checks

typecheck ✓ · lint ✓ · 9,225 tests ✓ (PGlite lane on) · build ✓. New: `tests/ncd/pack-from-clerking.test.ts` (25),
`tests/ncd/pack-desk.test.ts` (5), `tests/clerking/ncd-dm-desk.test.ts` (4, end to end through deriveDesk).

## Phase 2 — Core 12 (owner decision 2026-10-08)

- Past history: gestational diabetes before (women), pancreatitis (acute or chronic), PCOS (women), G6PD deficiency,
  sickle cell trait or another haemoglobin variant, iron deficiency, vitamin B12 deficiency, HIV › ART regimen.
- About the diabetes: last HbA1c, last lipid profile, awareness of lows (Gold score 1 to 7).
- Social: exercise (active or inactive), food at home (always enough or not). Examination: acanthosis nigricans.
- History catalogue re-pinned (1.0.0-draft, fourth amendment); exam catalogue 1.1.2-draft re-pinned;
  `docs/ncd/diabetes/desk/core-12.amendment.json`. "More diabetes questions" now holds 46. These 12 questions are
  live for every ten-step desk on deploy (catalogue content, not behind `NCD_DM_DESK`).
- 9,233 tests ✓, typecheck, lint, build and catalogue check ✓.

## Signed (CSO, 2026-10-08)

- Mapping rulings MR-01 to MR-42 ("Accept all as proposed"); the Core 12 set; the wording of the 12 questions and
  rulings MR-43 to MR-46 ("do what makes more sense", after review of the list).

## Needed from you

- To try it: in Vercel, add `CLERKING_V2=1`, `NCD_DM_DESK=1` and `NCD_CLERKSHIP_LIVE=1` to Preview, then open the
  branch preview. Clinical use still needs the four-eyes second reviewer (D-NCD-17).

## Not done

- "A second result on another day" is asked, not derived (MR-40); gestation from an EDD alone (MR-39).
- Desk flags from the clerking catalogues (e.g. high ketones) can sit beside the pack's interrupt for the same event.
