---
name: reception-desk-first-load
description: 15 Nov 2026 cloud session cut /reception first-load JS from 341.6 to ~263 KB gz on perf/reception-desk-first-load; root (229.7) is what stands between it and the 160 KB budget
metadata:
  type: project
---

- Branch `perf/reception-desk-first-load` (off main 8b9431b), pushed, not merged. No behaviour change.
- Splits: the ⌘K bar's dialog + combobox (`components/medsync/command-bar-panel.tsx`, lazy, preloaded on idle; every
  workspace gains ~28–54 KB); the desk's calendar and dialogs (`next/dynamic` in `components/reception/desk.tsx`,
  dialogs mount on idle or first modal); `DeskDialog` moved to `components/reception/desk-dialog.tsx`; `fill` moved
  to `content/fill.ts` (re-exported from `content/lab-workspace-v2.ts`).
- Numbers and the browser run (INP, CLS, axe, 390 px) are in `docs/reception/REPORT.md`, "First-load JS follow-up".
- **How to measure:** `next build`, then gzip each path in `.next/diagnostics/route-bundle-stats.json`
  (`firstLoadChunkPaths`), as `scripts/check-budget.mjs` does. For what is inside a chunk, build once with
  `productionBrowserSourceMaps: true` (do not commit it) and read the maps' `sources`/`sourcesContent`.
- Browser runs use `/styleguide/reception-desk` with `MEDSYNC_FIXTURES=1` set **at build time** (the page is static;
  without it the build bakes a 404). A worktree build needs `cp -al node_modules` (a symlink breaks Turbopack).
- **Left:** the root is 229.7 KB gz (react-dom, Next router, Sentry SDK, tailwind-merge). 160 KB needs Sentry
  deferred, which changes when errors are captured: the owner's call. axe: 3 serious/critical on the desk, same on
  main (table children, empty dialog label, calendar date contrast).

Related: [[medsync-owner-rules]]
