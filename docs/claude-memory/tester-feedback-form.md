---
name: tester-feedback-form
description: /feedback tester form + /admin/feedback (migration 0081) — per-section redesign deployed 2026-09-26 as Vercel medsync-l22ehrpqz (prev medsync-gsag2knjs), UNCOMMITTED on feat/booking-app
metadata:
  type: project
---

Public `/feedback` form for the co-founders (minus Dr. Usama Fadhul) + Dr. Ahabwe Alvin. It covers the landing page, the four onboarding flows, department setup and overall UX. Responses go to `tester_feedback`, and superadmins read them at `/admin/feedback`.

- Questions live in `content/feedback.ts`. Ids are stored in the database, so never rename them.
- Owner applied migration 0081. Claude deployed twice on 2026-09-26: `medsync-gsag2knjs` (the long form), then `medsync-l22ehrpqz` (one section at a time, each sent separately). Both aliased to medsync-six.vercel.app. The Sentry source-map upload fails in the Vercel build (403 "project not found"); it does not block the deploy.
- The files are still **uncommitted** in the main tree (on feat/booking-app).

**Why:** the owner asked for a form colleagues could use to test the work so far.
**How to apply:** commit the files when the owner asks, never `.env.example`. Production sign-ups are closed, so testers need the owner's sign-up override or a preview URL to reach /signup/\*.

Related: [[release-state]] [[medsync-owner-rules]]
