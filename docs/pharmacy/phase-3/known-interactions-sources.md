# Known interactions: sources (research, 25 Oct 2026)

Goal: a pharmacist checks and signs a list of known interactions instead of typing pairs one at a time. MedSync writes no interaction from memory; every pair comes from a named source the hospital may use, and is signed by the CSO.

## 1. ONC high-priority list: drafted, unsigned

- **Source:** Phansalkar S, Desai AA, Bell D, et al. _High-priority drug-drug interactions for use in electronic health records._ J Am Med Inform Assoc 2012;19(5):735-743, doi:10.1136/amiajnl-2011-000612, [PMC3422823](https://pmc.ncbi.nlm.nih.gov/articles/PMC3422823), Table 2.
- **What it is:** 15 pairs of drugs or classes an expert panel judged contraindicated together, which every EHR should alert on.
- **Draft:** `lib/pharmacy/clinical/reference/onc-high-priority.ts` (`REF-DDI-ONC-2012`, `pending_cso`), check in `tests/pharmacy/clinical/onc-high-priority.test.ts`.
- **Matched to MS-RX-CAT-001:** 9 medicine pairs from 2 rows.
  - Row 4: atazanavir with omeprazole.
  - Row 23: rifampicin (alone, RHZE, RH) or carbamazepine with atazanavir/r or lopinavir/r.
- **Not matched:** the other 13 rows. For each one, the drugs on one side or both are not on the formulary, mostly MAO inhibitors, triptans, ergots and simvastatin. Row 21 (QT with QT) defers to the CredibleMeds list, which has its own licence. Each row keeps its reason, and no pair is guessed.
- **Gaps before signing:**
  1. **Wording:** the paper gives no per-pair effect or advice, so `effect` and `management` are empty. The schema needs both, so they must come from a cited monograph.
  2. **Member lists:** the table says they are not complete. Transcribe-check each row against the published table.
  3. **Matching through components:** fixed-dose combinations are matched through a listed component (the `via` field), which the CSO confirms.
  4. **Copyright:** the PMC page shows "© 2012, Published by the BMJ Publishing Group Limited" and names no open licence. The owner decides whether reusing the list needs BMJ permission.
- **Finding:** this list is US-centred. On a Ugandan medical ward it adds little beyond the HIV and TB pairs, which is where source 2 matters.

## 2. Liverpool HIV and TB interaction checkers: needs written permission

- **Terms:** <https://www.hiv-druginteractions.org/terms> (read 25 Oct 2026).
  - Content is the University of Liverpool's. Use is a personal, non-commercial licence: "no modification, reproduction, re-use, further distribution or transmission in any form is allowed".
  - Content "may not be reproduced, transmitted, or distributed without the prior written consent of The University of Liverpool".
  - Commercial use needs "the express written consent of The University of Liverpool".
- **So:** MedSync cannot load or copy any of it until the hospital or MedSync holds written consent. The prototype shows this source as locked until the letter is recorded.
- **Contact on the terms page:** Liverpool Drug Interactions Group, c/o Sara Gibbons, University of Liverpool, 3rd Floor William Henry Duncan Building, 6 West Derby Street, Liverpool L7 8TX, hivgroup@liv.ac.uk.
  - This address is given for privacy questions. Ask them which address handles data-reuse requests.
- **Owner action:** request written permission to show their HIV and TB pairs inside MedSync for Ugandan hospitals. Name the use: the pairs and severity, cited and not modified, with no charge to patients. Ask whether a feed or export exists.

## Not chosen yet

- **Commercial databases** (Lexicomp, Micromedex, Stockley's): full coverage, but each needs a licence the hospital holds.
- **Open research sets** (DDInter, DrugBank): check each licence for commercial use before relying on it.
