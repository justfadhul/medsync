---
name: patient-app-v2-handoff
description: 18 Nov 2026 handout of the patient app v2 build (phone, web, payments sandbox, care mode locked): what is merged and live, what is on a branch, owner items, and how to carry on from the Mac or a new cloud session
metadata:
  type: project
---

# Handout: Tether patient app v2 (state on 18 Nov 2026)

Built 15–18 Nov in cloud sessions that cannot be reopened elsewhere: this session (session_01AyHv1D2ewdBPDWcVvucFxZ) and the build session it started (session_01AyHv1EmYfFgC7sodexhkEn). This file is what they knew. Owner rules: [[medsync-owner-rules]]. Read `docs/patient-app/REPORT.md`, `parity-web.md` and `parity-phone.md` next.

## 1. Where things stand

| Thing                                                                     | State                                                                                                                                         |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| PR #314: Apple HIG + Expo SDK 58 (ADR 0515)                               | merged                                                                                                                                        |
| PR #318: patient app v2, Steps 0–10 and 12                                | merged 17 Nov                                                                                                                                 |
| PRs #319, #320: Actions button "Deploy Edge Functions"                    | merged                                                                                                                                        |
| PR #321: member number shows the whole ID                                 | merged 18 Nov                                                                                                                                 |
| PR #322: web v2 pass 1 (navigation, Home, one card on Me, Tether wording) | merged 18 Nov                                                                                                                                 |
| `feat/patient-app-v2-web-finish-2` @ 1a51419: web v2 pass 2               | pushed and rebased on main 31150f2; **no PR yet**; owner to say "open the PR"                                                                 |
| Migrations 0299–0304                                                      | applied by the owner 17 Nov (Supabase SQL Editor, each recorded in `_medsync_migrations`); 0297 confirmed applied 15 Nov                      |
| Edge Functions (10)                                                       | deployed by the owner 17 Nov from main with the Actions button                                                                                |
| Web                                                                       | `medsync-tether-site.vercel.app` runs main with `PATIENT_WEB_TIDE=1` and `PATIENT_FLAGS=appV2Web`. Not known to be redeployed since #321/#322 |
| Step 11, widgets                                                          | deferred by the owner; options in `docs/patient-app/step11-dependencies.md` (recommended `expo-widgets`)                                      |

The ten functions: pt-pay-intent, pt-refund-request, ha-refund-decide, ha-pay-desk, pt-care-reading, pt-dose-event, pt-care-message, pt-programme-bill, pt-plus, pt-medical-id-token.

## 2. Switches

| Switch                             | Where                  | Now        | Notes                                                                                             |
| ---------------------------------- | ---------------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| `PATIENT_WEB_TIDE`                 | Vercel env             | `1`        | serves `app/pw` pages at `/patient`                                                               |
| `PATIENT_FLAGS`                    | Vercel env, comma list | `appV2Web` | **global: every patient on that site sees v2**, with draft wording. No per-hospital switch exists |
| `EXPO_PUBLIC_MOBILE_FLAGS`         | `mobile/.env`          | owner's    | add `appV2Mobile` for the v2 phone screens                                                        |
| `careMode`                         | both lists             | off        | does nothing until `GATE_CG_SIGNED` is flipped in code (reviewed change)                          |
| `MOBILE_PAYMENTS`, `PAY_SANDBOX_*` | function env           | unset      | keep unset in production; the sandbox is for dev and tests                                        |

Secrets:

- `MEDICAL_ID_TOKEN_SECRET` (Supabase → Edge Functions → Secrets, 32+ characters): **not confirmed set**. Without it the card's QR fails.
- `PAY_WEBHOOK_SECRET` (Vercel, 16+ letters and digits): optional until a provider is chosen.
- Repo secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` exist for the deploy button.

## 3. How the owner does things from a tablet

- **Migrations:** Supabase SQL Editor. Wrap the file in `begin; … insert into public._medsync_migrations (name) values ('<file>.sql'); commit;`, one query per file, in order. The check is `select name from public._medsync_migrations order by name desc limit 8;`.
- **Edge Functions:** GitHub → Actions → Deploy Edge Functions → Run workflow from `main`, with the function names separated by spaces.
- **Web:** merging does not deploy (`vercel.json` has git deploys off), and "Redeploy" rebuilds the old commit. Make a new deployment from the latest main. To check the build, sign in as a patient and open `/pw/gallery/me-v2`.
- **Phone:** needs the Mac: `cd mobile && npx expo start` with the real keys. Cloud sessions run Expo web with dummy keys only (the sample page `/dev/v2`, no sign-in).

## 4. Signed by the owner/CSO in chat (16–18 Nov)

- GATE A §6, A1–A5, the feature matrix and renames.json.
- D-PA-07: 30-day credit, then refund on request.
- Amendment 1: safety stays free, care programmes are paid.
- Plus prices: 5,000 / 10,000 / 13,000 a month.
- Very high BP: 180 or 110.
- The red danger hero.
- Stage 3 wording.
- The STOP 4/5 departures.

Not signed:

- the draft strings in `content/patient-app/` and the Tether wording (never edit a `*_COPY_STATUS`);
- the danger-flow wording, including the sugar recheck at 15 min (prompt) or 5 (old phone screen);
- Gate CG;
- D-PA-01, the payment provider (shortlist Flutterwave or Pesapal; fees, refund API and callback signing not verified);
- the parity reports.

## 5. Open, in order

1. Open and merge the PR for `feat/patient-app-v2-web-finish-2`, then make a new Vercel deployment. It adds the Readings page, doctor's-times booking on the one-page Book, the name on the ticket, the offline banner, `/patient/wellness`, and a fix for the `/patient/care/plan` and `/patient/care/my-care` rewrites.
2. Confirm `MEDICAL_ID_TOKEN_SECRET` is set.
3. Decide whether v2 stays on for all patients on that site while the wording is unsigned, or turn `appV2Web` off after testing.
4. Sign the parity reports. Then pilot at one hospital for 5 days, then remove the old screens (Step 12 cutover; not done).
5. Payments:
   - choose the provider;
   - each hospital's merchant agreement;
   - Tether's own agreement for Plus (ADR 0523);
   - approve Tether's share on programme bills (`platform_share_ugx`; needs a UGX split);
   - wire the payment SMS (drafted, not sent).
6. Care mode: sign the danger wording, then Gate CG.
7. Decide whether to re-issue the data-processing notice under the Tether name (it still says MedSync; legal text, untouched).
8. Measure budgets on a 2 GB Android, an iPhone and a production web build (never measured).
9. Widgets, later: App Group, APNs Live Activity key, EAS dev build.

Six web gaps remain (reasons in `parity-web.md`):

- analytics: no tool chosen;
- one merged medicines list: waits for Gate CG;
- lab results in v2: needs the CSO's lab wording;
- settings (bigger text, sharing, family helper): needs storage that doesn't exist;
- Plan goals: no format agreed;
- the "Called" banner: patients can't read the floor's call state yet.

Phone gaps are in `parity-phone.md` (17 at Step 12; not revisited since).

Not from this work: 38 PGlite EMR-lane failures already on main (Drizzle parity, rls-probes, pharmacy).

## 6. Leftover branches

- `ops/sql-editor-0299-0304`: identical to main, a failed helper; delete it.
- `docs/handoff-functions-deployed`: an older copy of this note; delete it once this one is on main.
- `claude/booking-pilot-onto-main` and `claude/booking-pilot-go-live`: check against main (#308/#310) before using. The 15-minute reminder cron needs Vercel Pro.

**Why:** the owner asked for a handout on 18 Nov to carry on elsewhere.
**How to apply:** start from section 5. To continue building, start a new session from main with this file. Patient wording and clinical content stay draft until the owner signs.
