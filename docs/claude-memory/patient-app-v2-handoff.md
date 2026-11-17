---
name: patient-app-v2-handoff
description: 17 Nov 2026 cloud-to-Mac handoff of the booking-pilot nested session and the patient app v2 build (Steps 0–12, widgets deferred); branches, signatures, owner items, next steps
metadata:
  type: project
---

# Handoff: booking pilot follow-ups and patient app v2 (cloud, 15–17 Nov 2026)

Cloud session session_01AyHv1D2ewdBPDWcVvucFxZ (a nested session of the Tether main chat session_01AyHv1BQVYvi9chtZG8652e) ran two threads. The patient app v2 build ran in its own nested session, session_01AyHv1EmYfFgC7sodexhkEn. Neither conversation can be opened on the Mac. This file is what they knew. Owner rules: [[medsync-owner-rules]].

## 1. Booking pilot branches (done)

| Branch                           | Tip     | State                                                                                                                                                                                                                            |
| -------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude/booking-pilot-onto-main` | c16ab37 | Pilot numbers + clinic set-up guide cherry-picked onto main; docs rewritten for Clinics & schedule (ADR 0508); desk "Running late" steps in RECEPTION-TRAINING. Main later took #308/#310, so check it is merged before using it |
| `claude/booking-pilot-go-live`   | fb89678 | 15-min reminder cron + GO-LIVE.md. **Waits for Vercel Pro.** Main shows a go-live PR #310: check whether this cron is already on main and that Pro is on before any deploy                                                       |

Open: reminder toggle says "Sent at 18:00 the evening before" but the daily cron runs 08:00 EAT until Pro (wording change needs the CSO).

## 2. Patient app v2 (`feat/patient-app-v2`)

Prompt: the owner's "Tether patient app v2, phone and web, with booking payments" (gated, Steps 0–12). Branch was cut from main 971b9da after PR #314 (Apple HIG + Expo SDK 58, ADR 0515) was merged.

**State on 17 Nov:** Steps 0–10 and 12 done and pushed (tip af8d670). Step 11 (widgets) deferred by the owner: "lets first leave out widgets"; options in `docs/patient-app/step11-dependencies.md` (recommended `expo-widgets@58.0.28`). Read `docs/patient-app/REPORT.md` first, then `parity-phone.md`, `parity-web.md`, `gate-a-proposal.md`, `gate-a-amendment-1.md`, `payments-setup.md`, `business-model.md`.

**Already on main:** the first half (migrations 0299–0301, ADRs 0516–0519) reached main before the PR. ADR 0520 on main is "one admin workspace", so v2's Plus ADR is renumbered to **0523**.

**PR #318 merged (17 Nov):** https://github.com/justfadhul/medsync/pull/318, feat/patient-app-v2 @ 9b0e88a → main. origin/main is merged in, the CHANGELOG conflict is resolved, and the Plus ADR is renumbered 0520 → 0523. After the merge: typecheck and lint clean; vitest 12,598 pass, once `mobile/` dependencies are installed. Merging is the owner's.

**Flags (all off):** `appV2Mobile`, `appV2Web`, `careMode` (locked in code: `GATE_CG_SIGNED = false`), `mobilePayments` (sandbox only).

**Signed by the owner/CSO in chat, 16 Nov:**

- GATE A §6 block, A1–A5, the feature matrix and renames.json;
- D-PA-07: 30-day credit, then refund on request;
- amendment 1 (MR9: safety free, programmes paid);
- Plus prices 5,000 / 10,000 / 13,000 a month;
- very high BP at 180 or 110;
- red danger hero on both red allowlists;
- stage 3 wording;
- all STOP 4/5 departures.

**Still the owner's:**

1. Sign `parity-phone.md` and `parity-web.md` (gaps: phone 17, web 13).
2. ~~Apply migrations~~ **Done 17 Nov:** the owner applied 0299–0304 from a tablet in the Supabase SQL Editor (each wrapped in begin/commit and recorded in `_medsync_migrations`). Earlier, 0297 was confirmed applied (15 Nov).
3. Secrets: `MEDICAL_ID_TOKEN_SECRET` is the owner's to set in Supabase (Edge Functions → Secrets); **not confirmed set.** `PAY_WEBHOOK_SECRET` goes in Vercel (the callback is a Next route). Keep `PAY_SANDBOX_*` off production.
4. ~~Deploy the Edge Functions~~ **Done 17 Nov:** PRs #318, #319 and #320 are merged. The owner deployed all ten from `main` with the Actions button "Deploy Edge Functions" (`.github/workflows/deploy-functions.yml`, manual only; needs repo secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`). Use the same button for later function deploys. The Vercel deploy of main is still the owner's.
5. Payments:
   - choose the provider, Flutterwave or Pesapal (fees, refund API and callback signing not verified);
   - each hospital's merchant agreement;
   - Tether's own agreement for Plus;
   - approve Tether's share on care programme bills (`platform_share_ugx`; needs a provider with UGX split).
6. Care mode:
   - sign the danger-flow wording, including the sugar recheck at 15 min (prompt) or 5 (old phone screen);
   - sign the BP "rest 5 min" step;
   - then Gate CG.
7. Sign the draft strings in `content/patient-app/`. Never edit a `*_COPY_STATUS`.
8. Pilot: `appV2Mobile`/`appV2Web` on for one hospital for 5 days, then remove the old screens (legacy app/patient redirects are already in MOVED).
9. Measure budgets (2 GB Android, iPhone, production web build): not measured in the cloud.
10. Widgets later: App Group, APNs Live Activity key, EAS dev build.

**Known gaps:**

- the full Readings page reuses Add a reading/Trends;
- checks never show Done (no done dates);
- payment SMS drafted but not wired to the dispatcher;
- web ticket says "You" (no name data);
- the doctor's-times booking stays on the old screen;
- Plan goals wait for a targets format.

**Not from this work:** 38 PGlite EMR-lane failures already on main (14 Drizzle parity, rls-probes, pharmacy, others).

**Why:** the owner moved back to the Mac on 17 Nov and asked for a handoff.
**How to apply:** first finish the PR (section 2), then work the owner list. Patient app copy and clinical content stay draft until the owner signs.
