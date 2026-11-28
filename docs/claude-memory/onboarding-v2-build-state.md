---
name: onboarding-v2-build-state
description: "Onboarding v2 (ADRs 0119–0129) LIVE 2026-09-25: replaced the old forms (no flag), 0070 applied, 3 functions + web deployed from the main tree; feat/onboarding-v2 in worktree medsync-onboarding-v2 holds the commits"
metadata:
  node_type: memory
  type: project
  originSessionId: 722bf4f9-1246-49d3-8449-3b25771c25dc
  modified: 2026-09-25T10:27:56.453Z
---

Onboarding v2 is built and committed in a SEPARATE worktree, `/Users/airm1/Desktop/medsync-onboarding-v2`, on branch `feat/onboarding-v2`:

- `a7b784a` is the baseline snapshot of the main tree's uncommitted state (tag `onboarding-v2-baseline`).
- `bbb0135` is the build; `6fca936` is the STOP record.
- Gate record: `docs/onboarding-v2/STOP-REPORTS.md` (§12 numbers + owner actions). Proposal: `gate-a-proposal.md`.

**Why:** the owner said "go through all gates", use agents (a few, not hundreds), and "I want to see this rework deployed". The main tree had another live session, so a separate worktree was used.

**LIVE (2026-09-25 afternoon):** the owner asked for v2 to REPLACE the old forms (ADR 0129, commit `8e8f2aa`). The flag and `/signup/preview` are gone and the old forms are deleted. The v2 diff was `git apply`'d into the MAIN tree as uncommitted changes (clean, byte-identical). From the main tree: 0070 applied (the classifier allowed it this time), the 3 functions deployed, and web `medsync-il0fkn1xa` deployed (rollback `medsync-3kzwqfje1`). The owner's earlier attempt had run in the main tree before it had v2, so nothing changed then. Everything below "How to apply" is history.

**How to apply:**

- **Not deployed.** The auto-mode classifier refused `npm run db:migrate` (production deploy). The web and the three edge functions both need 0070 first. The owner runs, from the worktree:
  1. `npm run db:migrate` (0070 only);
  2. `npx supabase functions deploy approve-hospital-application reject-hospital-application approve-staff-affiliation --project-ref hrfpdfonjuvsakbjtfop --use-api`;
  3. `npx vercel deploy --prod --yes` (rollback target `medsync-pabwmi5xx`).
- **Seeing v2:** `/signup/preview` sets a per-browser cookie; `ONBOARDING_V2=1` turns it on for everyone. The pending pages are v2 for everyone by design (ADR 0124).
- **Merge before main-tree deploys:** `feat/onboarding-v2` must be merged into the main tree before the next deploy from there, or that deploy drops v2.
- **Harness:** `/Users/airm1/Desktop/onboarding-v2-harness`, holding `pg/probe.mjs` (PGlite, 78/78), `cdp.mjs` (headless Chrome with goto/type/press/geo/offline/jsKB steps) and the raw COD-AB and NHFR data.
- **Lessons:**
  - Classic zod on the client is a 63 kB gz chunk; shared client/server schemas use `zod/mini`.
  - Next preloads every client component a page can render, so flag-branched forms need `next/dynamic` wrappers (`app/signup/*/_lazy.tsx`).
  - The Next 16 dev server blocks its dev resources from 127.0.0.1; drive it via `localhost`.
  - Zod 4 skips object refinements after a field fails; pass `{ when: () => true }`.
  - NHFR's public API `…/api/v1/facilities/public?page_size=100` rejects urllib's User-Agent; use curl or fetch.
- **Open:**
  - CSO sign-off on the under-18 and consent lines, and AHPC scope.
  - The 14/7/21 catalogue JSON (absent).
  - 2 provisioning hospitals must re-invite a backup admin.
  - The staff-invite → hospital-admin claim gap (not fixed).

Related: [[medsync-owner-rules]] [[doctor-workspace-build-state]]
