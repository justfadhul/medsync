---
name: mobile-tide-v1-build
description: "Tide v1 patient phone app rebuild — worktree medsync-tide on feat/mobile-tide-v1, all 7 gates built 2026-10-17, local commit only, not pushed"
metadata:
  node_type: memory
  type: project
  originSessionId: a9a676bf-a7ce-4735-a085-0fa514b898cb
  modified: 2026-10-17T15:11:00.670Z
---

Tide v1 rebuild of the patient app (`mobile/`), built 2026-10-17 in worktree `~/Desktop/medsync-tide` on `feat/mobile-tide-v1` (cut from 446a0cc9). All gates 1–7 built; one local commit, NOT pushed. ADRs 0340 (Tide replaces Chroma on phone) and 0341 (bottom sheets on phone only). Read `docs/mobile-tide/00-RECON.md` (decision ledger D1–D10, Q1–Q6, L-1..L-8) and `99-REPORT.md` (F-01..F-23 status, open items) first.

**Why:** owner approved plan artifact https://claude.ai/artifact/WnHrPsD1zsTp3Zw4Gy1Nrx (D1–D10) then said "get through all gates". Tide DS artifact https://claude.ai/artifact/5vvCpkVoYk8G11PtLaSRuk dark column synced to PRD palette (v7).

**How to apply:**

- Never run on a device yet (no Xcode/Android SDK); verified on Expo web :8091 via `/dev/screen?name=home|add|care|…` (dev-only, renders signed-in screens outside the gate).
- Prettier in the worktree: scratchpad `pt.sh` used main checkout's prettier with absolute plugin paths; worktree has no root node_modules — symlink `node_modules -> ~/Desktop/medsync/node_modules` temporarily for web tsc / pre-commit hook, then remove.
- Since round 2 health screens use the patient's own log (ADR 0342); wording says only the patient sees it — clinicians cannot read 0029 tables. `savedWords()` removed.
- Open owner items: apply 0170, SMS provider for OTP, CSO thresholds/emergency numbers, legacy screens (consent, household, symptoms→today/ticket, emergency sheet) still Chroma.
- Related: [[chroma-design-system-build]], [[booking-app-build-state]], [[medsync-owner-rules]].

**Round 2 (17 Oct, pushed 7d21e265):** owner chose real data from existing tables (0029 self-tracking, 0091 visit summaries via app/api/mobile/visit-summaries, notification_dispatches), chat hidden (`mobileChat`), Expo Go on LAN, password-only. Migration 0170 (log kinds, home pin, patient_intake_ahead) NOT applied — owner runs `cd ~/Desktop/medsync-tide && npm run db:migrate -- 0170`. Test setup: worktree has gitignored symlinks `node_modules` and `.env.local` → main checkout; web dev must use `next dev --webpack -H 0.0.0.0` (Turbopack rejects the symlink); mobile/.env has EXPO_PUBLIC_WEB_ORIGIN=http://<Mac LAN IP>:3000 (172.20.10.2 = iPhone hotspot on 17 Oct). PR not opened: no `gh` CLI on this Mac.
