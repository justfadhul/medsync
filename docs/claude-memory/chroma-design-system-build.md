---
name: chroma-design-system-build
description: "MedSync Chroma (ADR 0162) implemented 2026-09-27 in worktree ~/Desktop/medsync-chroma on feat/chroma-design-system — uncommitted; mobile migrated; prod deploy blocked for Claude, owner runs it"
metadata:
  node_type: memory
  type: project
  originSessionId: b642204d-8298-43f0-a80b-296c3dd5e67f
  modified: 2026-09-26T21:02:36.225Z
---

The owner (who is also the CSO) approved the "MedSync Chroma" design-system artifact (https://claude.ai/artifact/H43pExc1ttptFCt9vmdbpk) and asked for all of it to be implemented. Built 2026-09-26/27 in worktree `~/Desktop/medsync-chroma`, branch `feat/chroma-design-system` cut from `816ebb5`. **Uncommitted, not pushed, not deployed.** Mobile (Expo) migrated too: Bricolage font package, tokens, tag chip. The live tester-feedback files were copied in (+ admin nav/schema edits) so a deploy from this tree keeps /feedback. `vercel deploy --prod` from the worktree was blocked by the classifier (Production Deploy) on 2026-09-27; the owner runs it. Rollback target `medsync-hivr19k1f` (prod at the time, = main tree content).

- Token layer generated from the artifact's tokens.json by scratch script `gen-globals.mjs` (session scratchpad); gray/brand/mint kept as aliases.
- Place map in `lib/design/domains.ts` (Patients sky, Clinical iris, Pharmacy & lab grape, Operations plum, Admin slate).
- Shared pieces: `components/medsync/{sidebar-nav,command-bar,domain-tile,tag,status-pill,avatar,view-switcher,record-header,attribute-list,chroma-band}.tsx`.
- Critical/caution chip text moved to the `-fg-aa` pair, recorded in ADR 0162 as approved by the owner/CSO with the draft. Flag this if the owner questions it.
- Checks: 3,929 tests pass; the build passes against a dead-DB env; axe is clean on the pre-rendered pages.

**How to apply:**

- Merging into the main tree will conflict with the main tree's uncommitted `admin-shell.tsx` / `admin-sidebar-active.tsx` (tester-feedback work) and its `AGENTS.md` trim.
- Mobile ships only via EAS builds (no OTA updates configured).
- Workspaces were checked only via `/styleguide`; signed-in pages were never rendered (dead DB).

Related: [[tester-feedback-form]] [[medsync-owner-rules]]
