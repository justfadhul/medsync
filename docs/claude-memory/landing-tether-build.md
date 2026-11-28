---
name: landing-tether-build
description: "Tether landing page (ADRs 0477–0481) built through Step 7 hardening on feat/landing-tether, local only; owner items open"
metadata:
  node_type: memory
  type: project
  originSessionId: 5292025e-fd09-47ee-bf40-a3ee3c5cf287
  modified: 2026-11-13T12:06:46.950Z
---

13 Nov 2026: the Tether landing page (`/` via proxy when `LANDING_TETHER=1`) is built on `feat/landing-tether` in worktree `.claude/worktrees/landing-tether-09c47a`. Commits 3671685b (Steps 3–6), cdcd680d (fixes), 3a2c5db9 (reports). Pushed to origin 13 Nov (no PR); not deployed.

The result is in `docs/landing/REPORT.md`:

- LCP 2.41 s, INP 80 ms;
- axe 0 at every width;
- 24 of 24 scenarios pass.

**Why:** the owner said "go through all gates", so the STOPs were recorded, not held.

**How to apply:** the open items are the owner's:

- apply 0293 (`clinic_leads`);
- sign the parity file `tests/parity/landing/renames.json` (4 OPEN questions, including the Book a visit target);
- decide two hardening design calls (the cascade-4 blend, red text on the emergency question);
- the cutover: two days on in production, then delete the 15 old landing files and the flag.

The reception-desk session may merge this branch to share `ExampleTicket`, which is driven by props.

LCP lessons:

- text under a CSS `filter` is measured as the whole box;
- an opacity-0 entrance at first paint is not a candidate;
- a positioned span splits the text record.

Related: [[booking-pilot-board]], [[medsync-owner-rules]].

13 Nov later: the owner chose "own app, same folder". `apps/tether-site/` is a standalone Next app rendering the shared `components/landing/tether/landing.tsx`. It uses the root node_modules, and its `vercel.json` installs from the root. Commit 34189dcd is pushed (no PR). The owner sets up the Vercel project (root dir `apps/tether-site`), env and domain; see its README. It is untested on Vercel; the fallback is npm workspaces.

13 Nov: the owner merged PR #289 (merge 104d5396) into main. gh is not installed here; PRs are opened through the browser pane's GitHub compare page.
