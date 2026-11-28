---
name: pharmacy-rework-kit-build
description: '3 Nov 2026 kit "pharmacy-rework 5" (Downloads) — Roster + Set-up tabs done (both pushed, no PR); Main store next'
metadata:
  node_type: memory
  type: project
  originSessionId: 1ca875d6-2fbd-4f0a-bec4-2c16af100a54
  modified: 2026-11-03T16:16:34.781Z
---

Kit at ~/Downloads/pharmacy-rework 5 (copied to docs/pharmacy/rework/, plan in BUILD-PLAN.md). Order: Medicines
deltas → PROMPT-ROSTER → PROMPT-SETUP (feat/pharmacy-setup-tabs, 0274) → PROMPT-STORE (feat/pharmacy-main-store, 0275),
stacked branches, 9 steps each, commit per step.

- Roster DONE 3 Nov on feat/pharmacy-roster in the main folder (commits 4468cbd6…f7452b53, pushed, no PR). 0273 GATED,
  unapplied (needs 0271, 0272 first). Owner items in docs/pharmacy/HANDOFF.md "Set-up › People and roster".
- Set-up tabs DONE 3 Nov on feat/pharmacy-setup-tabs (a42b1e03…dd779a91, pushed, no PR). 0274 GATED, unapplied
  (after 0273). Owner items in HANDOFF "Set-up › Going live, Places, Rules and Messages". Fixture /styleguide/pharmacy-setup.
- Dev fixture /styleguide/pharmacy-roster (dev only, needs `data-ds="tide"` wrapper for Tide tokens).
- Gotcha: drizzle `sql` spreads a JS array into a param list — bind uuid[] as a `{a,b}` literal (`uuids()` helper).
- Gotcha: Next 16 allows one dev server per folder; the owner's runs on :3000 from the main folder.

**Why:** next sessions resume the kit without re-reading it all. **How to apply:** start PROMPT-STORE from a new
branch off feat/pharmacy-setup-tabs. Related: [[pharmacy-medicines-build]], [[medsync-owner-rules]].
