---
name: ncd-dm-desk-build
description: Diabetes pack embedded in the ten-step clerking desk (auto-profile + suggest dx), started 2026-10-08 in worktree medsync-ncd
metadata:
  type: project
---

Owner (2026-10-06/08): the diabetes pack must be embedded in the encounter, not a separate form — as one clerks, it auto-profiles a diabetic and suggests the diagnosis. My PR #201 (module button + wide dialog on the v2 desk) was the wrong shape; it is merged and stays only until this replaces it.

Signed decisions 2026-10-08 (all my recommendations):

- Impression: one diabetes suggestion, worded by the pack (criteria met vs "possible: one result, repeat"); desk's own dx rules still find the case.
- Missing pack questions: important ones added to the clerking steps (CSO-signed catalogue additions); the rest in a short "More diabetes questions" pop-up from the profile card listing only gaps; the full-module button goes.
- New flag NCD_DM_DESK, off; owner to add CLERKING_V2 to Preview env to try it.
- eGFR computed from creatinine with CKD-EPI 2021 (reuse lib/ncdreg/standard/calculations.ts egfr()).

Feature map (agent, 2026-10-06): scratchpad map/feature-map.md (208 features: 41 direct, 96 derived, 19 in record not loaded, 52 none); gaps: eGFR never stored, K/creatinine/lipids not loaded into desk, pregnancy weeks not loaded. Surfaces: Flag[] concat before toBadges (components/clerking/model.ts), Impression suggestions lib/clerking/impression/suggest.ts.

Numbers: next ADR 0216, next migration 0095 (registry took 0215/0094). Branch feat/ncd-dm-desk.

- Phase 1 DONE 2026-10-08, commit 1883845 on feat/ncd-dm-desk (not pushed): lib/ncd/pack/{from-clerking,desk,more-questions}.ts, components/clerking/diabetes-profile.tsx, deriveDesk(…, dm), Impression withPackVerdict, Plan 'Diabetes: due and targets', loader adds K/creatinine/lipids/strips/pregnancy dates, eGFR CKD-EPI 2021; 9,225 tests green. 42 mapping rulings MR-01..42 in docs/ncd/diabetes/desk/mapping-rulings.md await CSO (MR-01 lab glucose 1 day). Phase 2 = move important 'more' questions into clerking catalogues.
- 2026-10-08: owner signed MR-01..42 (bulk, as proposed) and chose "Core 12" for Phase 2. Phase 2 DONE commit 70221a7: 12 questions in history/exam catalogues (history re-pinned 4th amendment, exam 1.1.2-draft), MR-43..46 + Core 12 wording signed. Branch PUSHED 2026-10-08 (owner opens PR). NOTE: the Core 12 catalogue questions are ALWAYS ON for every v2 desk on deploy (not behind NCD_DM_DESK). Not pushed.
- 2026-10-08: feat/ncd-dm-desk merged as PR #209 (owner turned NCD_DM_DESK on in prod). "Show all" diagnoses (claude/dx-browse-dialog, c3b50d8) had never been merged; merged with main on fix/dx-show-all (+ the 2 doc commits missed by #209), pushed for owner's PR.
- 2026-10-08: ADR 0217 one-tap removal of a diagnosis added here (feat/dx-quick-remove, 9f15a7b, pushed). Owner asked to clear Patient Three-3 (MS-2026-00004) from prod DB: writing the delete script was blocked by the permission classifier; recommended a fresh synthetic test patient instead. Do not retry the delete script without the owner granting permission.
- 2026-10-08: side panel + vitals (feat/desk-side-panel, dc7c48b, ADR 0218, not pushed): tooltip flags, criteria explain (engine explainCriterion), folds, vital classification data/clerking/vital-classification.v1.json SIGNED by CSO (AHA default; 38.0 fever; UCG 160/100 = stage 2), anthropometry last-saved display. Pre-existing failure on main: tests/ncdreg/outbox.test.ts (2 tests).
- 2026-10-08: PR #213 (side panel) merged. Diagnosis associations (ADR 0219) on feat/dx-associations, pushed: data/clerking/dx-associations.v1.json SIGNED (1,377 pairs: 315 complication / 152 goes_with / 910 excluded; triggers kept), panel under each dx on step 09, link in Impression meta.with, note 'With: …'.
- 2026-10-08: associations PR merged; follow-up feat/dx-associations-container pushed: chosen associations in their own container under the leading dx with their own supports; cso_additions in dx-associations.v1.json (all diabetes types same complication set incl. DKA).
- 2026-10-08: PR #215 merged. feat/dx-associations-layout (38a2482, pushed): associations in the leading card's left column; supports picked from the shared 'Not yet explained' bucket via an 'Add findings to' switch.
- 2026-10-08: feat/dx-associations-arrange (649be70, pushed; includes the unmerged layout commit 38a2482): arrange (meta.with order) + flag (meta.flagged) chosen associations; 'Add an association' full-width section. Open question to owner: should a flag also surface in Flags panel / Plan?
- 2026-10-09: PR #217 (arrange/flag) merged. Owner asked for diagnosis relations (secondary-to, risk factors, subtypes e.g. ACS→UA/NSTEMI/STEMI, co-existing, background chronic, drag-and-drop). Brief artifact for a Claude chat: https://claude.ai/artifact/P128JWiEraFVbbTw2fjAcg (BRIEF-DX-RELATIONS; returns design + dx-subtypes/causes/risk-factors/proposed-terms JSON + vignettes + D-REL decisions). Owner will bring the reply back; verify ICD-11 'to verify' codes via WHO API before use.
- Worktree gotchas: `npm install` prunes PGlite — reinstall with `npm install --no-save @electric-sql/pglite@0.5.8`; the pre-commit hook runs tsc, so commit with NODE_OPTIONS=--max-old-space-size=6144.

**How to apply:** build in phases with STOP reports in docs/ncd/diabetes/desk/; mapping judgement calls go to the CSO as a rulings list. Related: [[ncd-diabetes-pack-build]] [[medsync-owner-rules]]
