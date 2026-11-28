---
name: pharmacy-phase-2-build
description: "Pharmacy Phase 2 (stores, wards, supply) — all 11 steps built 21 Oct 2026 on feat/pharmacy-stores (worktree medsync-pharmclose), pushed, PR via compare link (no gh CLI); migrations 0180–0182, 0184 unapplied"
metadata:
  node_type: memory
  type: project
  originSessionId: 4ddf4421-ab38-486b-baef-a5329fdbc02e
  modified: 2026-10-21T08:05:02.837Z
---

GATE A signed 21 Oct 2026 (D-PH2-01..24, map v3 adds pharmacy.store only where PHARMACY_STORE is on; CSO signs alone by exception "CSO signs alone (ADR 0281)"). Built with 3 agent lanes (store / wards+carts / recall+month end+orders+packs) after I wrote migrations, schema, write layer (lib/pharmacy/stores/write.ts) and engines lane.

Last commit 299e81b0, pushed to origin/feat/pharmacy-stores. Checks: unit 11,156, lanes 1,740, build, axe 0 serious on 40 jobs. Records: docs/pharmacy/phase-2/{gate-a-proposal,FINAL-REPORT,user-guide}.md; ADRs 0370–0380. Six flags PHARMACY_STORE, \_WARD_STOCK, \_CARTS, \_RECALL, \_MONTH_END, \_ORDERING (off; prod gated on PHARMACY_STORES_COPY draft).

Open: owner inputs Q5/Q6/Q8 (HMIS layouts, pilot practice, paper baselines); confirm store opening count writes `adjusted` pre-live; reason lists free text where stores_reason_lists not wired; IS-4, withdrawRequisition not built; Phase 1 pack kinds lane_rule/high_risk_list/controlled_classes/availability_mapping not signable in app. `gh` CLI is not installed — give compare links.

Related: [[pharmacy-phase-1-build]], [[tide-everywhere-build]].

2026-10-25: PR #250 merged to main. CSO signed all 957 Phase 2 strings as written (in chat, sign-off page unused) → commit 79690a4b on feat/pharmacy-stores-signed (pushed, PR via compare link). Next: Phase 3 from ~/Downloads/pharmacy-phase-3/ (not started).
