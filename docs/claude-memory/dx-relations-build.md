---
name: dx-relations-build
description: Diagnosis relations build (secondary-to, subtypes, co-existing, background, drag-and-drop) started 2026-10-09 on feat/dx-relations in medsync-ncd
metadata:
  type: project
---

Owner handed ~/Downloads/medsync-dx-relations-1.0.0-draft (reply to BRIEF-DX-RELATIONS artifact P128JWiEraFVbbTw2fjAcg): design, dx-subtypes/causes/risk-factors/proposed-terms, 19 vignettes, 17 decisions D-REL-01..17. "Go through all gates, necessary agents."

GATE A signed 2026-10-09: all 17 decisions = A (bulk); catalogues signed as drafted; proposed terms live only after WHO ICD-11 API verification (creds in ~/Desktop/medsync/.env.local ICD_CLIENT_ID/SECRET, never print). Deferred: D-REL-07 HMIS counting, death-certificate chain.

Files: docs/emr/dx-relations/ (design, decisions, vignettes, tools, gate-a-signoff.json), data/clerking/dx-{subtypes,causes,risk-factors}.v1.json. Numbers: ADR 0220, migrations 0095 (terms v1.2) and 0096 (condition_relations).

Phases: 1 data+terms (me), 2 migration+write/read (agent), 3 board UI + DnD (agent), 4 refinement/stages/risk line, 5 composer, backfill, vignette tests, ADR, STOP.

- 2026-10-09 DONE all gates: commits b592506 (phases 1-2), 846a088 (board), dfcd872 (refine/stages/risk/look-back), 3b8c139 (final gate). 9,403 tests + build green; merges cleanly; NOT pushed. Gate B: build rulings signed, D-REL-10 WITHDRAWN (5 AIDS illnesses stay HIV-restricted), demotion asks+retires, 90-day look-back. Final gate: STG-04/05 signed, blank stages desk-only, placeholder dup removed, 'Considered and unlikely' line.
- DEPLOY ORDER: owner must apply 0095 + 0096 BEFORE merging/deploying (code reads conditions.refined_from on every conditions query). After apply: flip v1.2 terms coded:true in lib/clerking/impression/load.ts.
- Deferred: HMIS counting (D-REL-07), death-certificate chain, structured ECG refine, per-user classes (app.restricted_classes seam).

- 2026-10-09: owner applied 0095 + 0096; v1.2 terms flipped coded:true; branch PUSHED (owner opens PR).

**How to apply:** stop only for signatures; owner applies migrations. Related: [[ncd-dm-desk-build]] [[medsync-owner-rules]]

- 2026-10-09 follow-up: feat/desk-instant-actions (84f5f72, from origin/main after dx-relations merged) PUSHED: optimistic board ops (components/emr/desk/optimistic.ts, useOptimistic in desk-client) + runEmrWrite `{ refresh: true }` (next/cache refresh(), one round trip); leading card, each linked dx and "Add a linked diagnosis" collapse. Owner opens PR.
- 2026-10-10: 6e646e0 on same branch PUSHED: "Not yet explained" bucket targets co-existing + differential too (differential keeps the chip, pressed, toggles).
