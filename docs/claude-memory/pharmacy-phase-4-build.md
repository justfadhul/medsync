---
name: pharmacy-phase-4-build
description: "Pharmacy Phase 4 (repeats, refills, partner network) in ~/Desktop/medsync-network on feat/pharmacy-network; Steps 2–5 done dark, 0230–0232 unapplied, stop before Step 6"
metadata:
  type: project
---

26 Oct 2026: worktree ~/Desktop/medsync-network, branch feat/pharmacy-network (off origin/main 4d68236f), pushed to origin 26 Oct (no PR). Steps 2–5 done and committed dark (Step 4 302e1602, Step 5 0a3d78ac, then demo + guide). GATE A signed by CSO alone (D-PH4-29, Steps 2–5 only); Step 6 (partner routing) needs the DPO or legal adviser, so stop there. Reports in docs/pharmacy/phase-4/STOP-REPORTS.md; user guide docs/pharmacy/phase-4/HOW-TO-USE.md.

Migrations 0230, 0231, 0232 written, NOT applied; flags PHARMACY_REPEATS / PHARMACY_REFILLS off. CSO signed (26 Oct, 33cc01eb) the Steps 2–5 wording (PHARMACY_NETWORK_COPY) and Step 5 decisions; partner wording + message templates split into PHARMACY_PARTNER_COPY, draft until Step 6. ADRs now 0434–0437 (claim moved to 0434–0449 on 26 Oct after a NUMBERS.md clash with patient web; merged origin/main f523640b). Packs still unsigned (in-app, hospital values). The owner said nothing goes on until: legal Q1/Q2 answers, the 2026 Act commencement record, the verifier's name. Numbers: migrations 0230–0249, ADRs 0426–0444.

Demo = fixture catalogue only (lib/pharmacy/network-demo.ts, /styleguide/pharmacy-network/\* with MEDSYNC_FIXTURES=1), because a DB demo would need signed packs with made-up clinical values — that is the owner's call. Dev server in this worktree: `next dev --webpack` (node_modules symlink breaks Turbopack) plus SKIP_ENV_VALIDATION and a placeholder Supabase URL; the preview sandbox can't read the main .env.local.

**Why:** the owner explicitly gated switch-on on those inputs.
**How to apply:** never apply or switch on. Run PGlite lanes one at a time with SKIP_ENV_VALIDATION=1; reinstall pglite with `npm ci` in ~/Desktop/emr-harness/pg if it vanishes. Related: [[pharmacy-phase-3-build]], [[medsync-owner-rules]].
