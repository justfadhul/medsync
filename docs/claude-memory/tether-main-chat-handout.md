---
name: tether-main-chat-handout
description: 15 Nov 2026 handout of the Mac "main chat" (Tether booking pilot) and its 15 nested sessions, with a ready brief to relaunch each open thread as a cloud session
metadata:
  type: project
---

# Tether pilot: main chat and nested sessions handout (15 Nov 2026)

On the Mac, one "main chat" ran the Tether (booking) pilot program and started 15 nested sessions. Their conversations stay on the Mac and **cannot be reopened from the cloud**. This file is what they knew. To "reopen" a thread, start a new cloud session from `main`, paste its **Relaunch brief** below, and let it read the files named.

Before you start, read `AGENTS.md`, `docs/CLAUDE-HANDOFF.md` and the notes these link to: [[booking-pilot-board]], [[clinic-floor-build-state]], [[clinics-schedule-build]], [[landing-tether-build]] and [[medsync-owner-rules]].

## The program

- **Goal:** the Tether booking pilot for about 5 private clinics in Uganda, running 30 days, web first.
- **Owner:** Fadhul, who is also the CSO. His sign-off in chat is final. Keep messages short.
- **Owner-only actions:** applying migrations, deploying Edge Functions, deploying to Vercel, and merging to `main`.
- **Board:** https://claude.ai/artifact/7wgK9QPzCKvwqi5cNSZydE. Its data is `.claude/pilot-board/tracks.json`, and dataset `tracks` was at version 32 on 15 Nov. Only the main chat writes to it; [[booking-pilot-board]] gives the update steps.
- **Rows not updated since 13 Nov:** clinics & schedule, Tether logo, inline MFA, and the merges listed below.

## Nested sessions on 15 Nov

| Session | Branch @ commit | Merged to main? | Open |
|---|---|---|---|
| Tether landing page (gated build) | `feat/inline-mfa-setup` @ 21551699 | **No** (1 ahead) | Owner to merge. Prod check after the dev switches came off (below) |
| Tether clinics and schedule | `feat/clinics-schedule` 564b0784, `fix/clinics-cutover-tests` 7b586675 | Yes (cut over, ADR 0508; PR #305) | Deploy is the owner's |
| Tether clinic floor | `feat/clinic-floor` @ 85d3dc42 | Yes | Engine gaps, wiring, sign-offs, `CLINIC_FLOOR` pilot (below) |
| Tether reception desk (all gates) | `feat/reception-desk` 4b44c851, then `feat/tether-reception-desk` 21c0f9fa | Yes | Sign-offs, desk flag for one clinic, first-load JS 345 KB vs 160 budget |
| Tether wordmark as logo and favicon | `feat/tether-logo` @ cdb9ef31 | Yes (PR #303) | None |
| Pilot numbers per clinic | `feat/pilot-numbers` @ 16c76564 | **No** | Owner to merge |
| Pilot clinic set-up guide and training sheet | `docs/booking-pilot-clinic-setup` @ 9806d385 | **No** | Owner to merge |
| Pilot: 15-minute reminders and go-live list | `feat/booking-pilot-go-live` @ a8fe8824 | **No** (2 ahead) | Waits for Vercel Pro (cron) |
| Tether booking workspaces brief | none; artifact https://claude.ai/artifact/Gwa1uV4tyZGzdMbGV1hhKx | n/a | None |
| Doctor booking requests never sit unseen | `fix/doctor-booking-confirm` | Yes | Redeploy booking functions from `main` at the final deploy |
| Walk-in takes over desk record | `feat/desk-record-takeover` | Yes | None |
| Register a walk-in at the desk | `feat/reception-walk-in-register` | Yes | None |
| Forgot-password reset keeping MFA | `feat/password-reset` | Yes | Supabase reset-email template (owner) |
| Reception cancel and move | `feat/reception-cancel-move` | Yes | None |
| Dry run: book, check in, see doctor | `fix/booking-dry-run` | Yes | None |
| Close the security holes | `fix/review-perimeter` | Yes | None |

## Migrations

- 0290–0298 are on `main`.
- The owner confirmed applying 0290–0295. [[clinics-schedule-build]] records that 0296 and 0298 were applied too.
- **Unconfirmed: 0297 `clinic_leads_mfa_gate`.** Ask the owner whether it was applied.
- Desk functions were deployed 13 Nov. Redeploy every booking function from `main` once at the final deploy, because earlier deploys came from different worktrees.

## Production state on 15 Nov

Prod returned 500 on every page. The cause was the start-up guard refusing to run with `DEV_SKIP_MFA` or `PHARMACY_DEV_HOSPITALS` set in Vercel Production. The owner agreed to remove both and redeploy. **Not confirmed done.** Once it is, check:
- the landing page on both addresses;
- `/sign-in` on Tether shows the Tether sign-in;
- `/reception` on Tether asks for sign-in and then shows the new desk.

Staff now need MFA. [[dev-skip-mfa]] and [[pharmacy-dev-hospitals]] are out of date if the removal happened.

## Owner items still open

- **Sign:**
  - Reception desk: parity list and copy.
  - Landing: Steps 3–6, its 4 parity questions and two colour changes.
  - Clinic floor: parity (5 missing controls), copy, trend bands, desk keyword list, and the rule that untriaged patients wait in the line as L4.
  - Cancel SMS, desk consent and claim-code wording.
- **Pilot one clinic:**
  - Desk flag for 2 days.
  - `CLINIC_FLOOR` for 2 days, then delete the old pages and flag.
  - `LANDING_TETHER` for 2 days, then delete the old page.
- **Not checked yet:** legal, hosting (Vercel Pro and staging), SMS sender ID, emergency numbers, the 5 clinics.
- **Other:** staff MFA, `MEDSYNC_ENV`, test data.

## Relaunch briefs (paste one into a new cloud session from `main`)

**Main chat.**
> You are the main chat for the Tether booking pilot. Read `docs/claude-memory/tether-main-chat-handout.md` and `booking-pilot-board.md`. Update `.claude/pilot-board/tracks.json` and the board to match the handout's session table (clinics & schedule, logo and inline MFA done; merges as listed), then commit the JSON on a branch. Run new work as separate sessions, relay their reports, and keep the board current. Ask the owner whether 0297 was applied and whether the prod dev switches were removed.

**Clinic floor follow-up.**
> Read `docs/clinic-floor/REPORT.md` and `docs/claude-memory/clinic-floor-build-state.md`. The triage panel lacks pregnancy and SpO₂ scale 2, and sends them as unknown/off; both change the engine's result. Add them as engine inputs only, with no new rules (PROMPT T1–T10 in `docs/clinic-floor/PROMPT.md`). Then wire the follow-up booking from Finish visit, lab "results back", trend history, and age/sex into the engine input. Keep `/nurse/triage` live. Gated: report before each change, and draft strings only. Branch off `main`; push the branch, never merge or deploy.

**Landing and Tether sign-in.**
> Read `docs/claude-memory/landing-tether-build.md` and `docs/landing/REPORT.md`. `feat/inline-mfa-setup` (21551699) is pushed and unmerged: it puts authenticator setup under the password on sign-in, with Tether-styled setup. Rebase it on `main`, re-run typecheck, lint and the landing tests, and tell the owner it is ready to merge. Once the owner says prod is redeployed, check `/`, `/sign-in` and `/reception` on the Tether host.

**Reception desk follow-up.**
> Read `docs/reception/REPORT.md`. Bring the desk route's first-load JS from 345 KB toward the 160 KB budget (the shared root is about 229 KB). Measure INP, axe and CLS in a browser and report. No behaviour change. Branch off `main`.

**Pilot go-live.**
> Read `docs/booking-pilot/GO-LIVE.md` on `feat/booking-pilot-go-live`. Rebase it on `main`. It holds the 15-minute reminder cron and needs Vercel Pro. Ask the owner whether Pro is on, and if so prepare it to merge.

## Owner rules that apply to every relaunch

- Never stage `.env.example`.
- Commit by file name, never `git add -A`.
- Never push `main`, apply migrations or deploy.
- No fabricated data.
- Pop-ups are centred `EditorDialog`s.
- Copy is drafted only; never edit a `*_COPY_STATUS`.
- Use few agents and few tokens; the owner likes the ponytail skill.
