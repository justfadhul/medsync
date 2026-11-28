---
name: prescribing-protocols-build
description: "12 Nov 2026 prescribing kit P0–P6 all built on feat/prescribing-protocols (medsync-rx), pushed, no PR; 0279–0286 unapplied; PRESCRIBE_V2 flag; 10 protocols draft"
metadata:
  node_type: memory
  type: project
  originSessionId: 1ca875d6-2fbd-4f0a-bec4-2c16af100a54
  modified: 2026-11-12T08:37:34.195Z
---

The owner's prescribing-and-protocols kit (`docs/prescribing/kit/`, from ~/Downloads/prescribing-protocols) is built in full in worktree `~/Desktop/medsync-rx` on `feat/prescribing-protocols` (head 64323a74, off main 2de1cb3f). Pushed 12 Nov 2026; no PR yet.

**Why:** the owner asked to connect pharmacy to encounters and every prescribing place, building from the kit, with "go through all gates". The prototype is [[prescribing-tool-prototype]].

**How to apply:**

- Read `docs/prescribing/HANDOFF.md` first; its owner checklist is the live state. `FIT-MAP.md` gives each feature's single home.
- Migrations 0279–0286 are GATED and unapplied: `cd ~/Desktop/medsync-rx && npm run db:migrate`.
- Flags: `PRESCRIBE_V2`; `protocolsLiveFor` and `nurseTasksLiveFor` stay off in production until all their copy is signed.
- The 10 protocols are draft versions. The database refuses a start from an unsigned version, and the app allows drafts only in local dev and tests, never on Vercel. Two consultants sign a version.
- Not browser-checked (needs the migrations plus staff sign-ins). Playwright is not set up. drizzle-parity had 12 failures before this branch on untouched tables.
- The old `prescribe()` and `lib/prescribing/engine.ts` remain for the flag-off path; delete them when the flag replaces the old forms.
- 12 Nov: the owner MERGED it as PR #286 (main ac3a7711), so migrations 0279–0286 are on main and still unapplied. The owner merges PRs fast: push every fix before asking for a merge.
- 12 Nov: the owner said the built UI differed from the prototype artifact, so every kit screen was rebuilt to the prototype on fix/prescribe-pharmacy-classes (d70dccbd, PR #287 open). Prescribe now groups by the pharmacy's CLASSES (8 added; map in lib/prescribing/pharmacy-classes.ts). Owner rules (centred dialogs, grey workflow tags) still win over the prototype; the differences are in HANDOFF "UI matched to the prototype". Locally PRESCRIBE_V2 is in .env.switches; the dev server runs from medsync-rx with a real node_modules (Turbopack rejects a symlinked one).
