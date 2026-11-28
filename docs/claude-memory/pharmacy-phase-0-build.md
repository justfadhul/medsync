---
name: pharmacy-phase-0-build
description: "Pharmacy Phase 0 (front door) DONE 2026-10-11 — medsync-pharm0, feat/pharmacy-front-door rebased on feat/lab-front-door; local only; migrations 0098–0100 + 0120–0121, ADRs 0227–0237"
metadata:
  node_type: memory
  type: project
  originSessionId: 44d08942-204c-4711-bfca-7c3ed3a4a539
  modified: 2026-10-10T23:30:51.013Z
---

Prompt docs/pharmacy/phase-0/PROMPT-PHARMACY-PHASE-0.md (original in ~/Downloads). All STOP 0–5 done and committed locally on feat/pharmacy-front-door, rebased 2026-10-11 onto feat/lab-front-door eb0aecf (lab hotfix 0101) (owner chose to stack; lab Phase 1 goes elsewhere). Not pushed. Owner applied all migrations through 0121 and deployed ha-services-hub 2026-10-11; backfill granted 0 (none missing). Both branches pushed 2026-10-11; wording signed by the CSO via portal https://claude.ai/artifact/PrEYQNLnd2Ng7zaq58Rtj6 (commit b2492719); technicians' regulator confirmed (no source cited). Next: owner merges lab PR then pharmacy PR, sets PHARMACY_WORKSPACE, redeploys. Report: docs/pharmacy/phase-0/STOP-REPORTS.md (owner checklist at the end of STOP 5).

Key decisions: carrier role `pharmacy_staff` (title rule); trigger grant (0098); placement_id + placement_line (0099); 0100 narrows prescription/emergency/cart reads; 0120 (renumbered from 0101) takes pharmacy cadres out of the generic clinical-staff RLS predicate (lab cadres still broad, reported); 0121 (renumbered from 0102) dispensing points + hub op `set_dispensing_point`; shared modules in lib/workspace-access/ and components/medsync/{workspace-shell,workspace-nav,tab-list,caution-notice}.tsx (NOT lib/workspace/, which is the doctor workspace's). Notice wording signed 2026-10-11. Numbers ledger docs/NUMBERS.md: pharmacy used 0098–0100 and 0120–0121, holds 0120–0139 and ADRs 0260–0279 for later phases; lab took 0101 + ADR 0238 (hotfix) and Phase 1 holds 0102–0119 / ADRs 0239–0259.

Harness ~/Desktop/pharm0-harness (ports 4001/54332; HARNESS_USER selectable; start-prod.sh / start-prod-nobuild.sh; fixtures U4 pharmacist at Inpatient pharmacy, U5 tech at Outpatient pharmacy, U6 hospital admin).

**Why:** owner said "go through all gates" and will provide later pharmacy phase prompts. Related: [[lab-phase-0-build]].
**How to apply:** later phases build on lib/pharmacy/\*, pharmacyChecksState (replace body, not callers), the nav registry and the reserved permission names.
