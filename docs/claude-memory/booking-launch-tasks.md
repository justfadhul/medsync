---
name: booking-launch-tasks
description: "26 Oct 2026 booking launch code tasks — three local branches/worktrees (legal pages, arrival-routing fixes, phone Tide port), committed, not pushed; two owner calls open"
metadata:
  node_type: memory
  type: project
  originSessionId: 39b13d09-3c01-4bfe-b4cf-48bd02b10c82
  modified: 2026-10-26T06:42:19.336Z
---

Owner chose to launch booking first, sold to private clinics (business model + launch plan artifacts: https://claude.ai/artifact/3XoLq9yMowfN83ZJwC7WmA, https://claude.ai/artifact/65W5peeezjoavdt1jpEHMW). Owner asked for Tide design on new UI.

Branches (each its own worktree, node_modules/.env.local symlinked to the main checkout), all committed, NOT pushed:

- `feat/legal-pages` (~/Desktop/medsync-launch-web, off feat/patient-web-tide): /privacy + /terms in Tide, Draft + noindex until `lib/legal.ts` flags flip; lawyer points in docs/legal/REVIEW.md. c5deb874.
- `fix/arrival-routing-review` (~/Desktop/medsync-launch-fix, off main): 8 fixes from a fresh ADR 0101 review (the Sept review's findings were never saved). f20bc099. Edge Functions need redeploy by owner.
- `feat/phone-tide-legacy` (~/Desktop/medsync-launch-phone, off feat/mobile-tide-v1): household/today/ticket/consent/emergency sheet in Tide. d3a07f13.

**Why:** finishing work for a public booking launch.

**How to apply:** owner ruled 26 Oct (ADR 0425): urgent arrivals always triaged; migration 0213 (GATED, partial unique index one live ticket/day) written + PGlite-checked, commit bc5ac17c on fix/arrival-routing-review — owner applies from ~/Desktop/medsync-launch-fix, then deploys ha-check-in-patient, ha-register-intake, ha-pre-arrival-arrived, pt-declare-intake, ha-start-encounter. Pre-existing test noise: "tomato" red-reserved failure on mobile-tide branch; patient-web care/help tests fail in worktrees without mobile/node_modules. Related: [[booking-app-build-state]], [[medsync-owner-rules]].
