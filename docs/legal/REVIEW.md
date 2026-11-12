# Privacy notice and terms: points for legal review

The text lives in `content/legal.ts` and renders at `/privacy` and `/terms` (Tide, public). Both pages show
**Draft** and are `noindex` until `lib/legal.ts` sets `privacyPublished` / `termsPublished`; the footer links and
the sitemap entries appear only then. Nothing here is legal advice; a Ugandan lawyer confirms each point below.

## Privacy notice

1. **Roles.** The notice calls MedSync the _data collector_ for booking data and the hospital responsible for its
   clinical record, with MedSync keeping it for them (processor). Confirm the DPPA 2019 roles per data set.
2. **PDPO registration.** Not yet done (`pdpoRegistered: false`). The notice does not quote a number; add one if the
   Office requires it to be shown.
3. **Cross-border storage.** It says some providers store data outside Uganda (hosting, database, SMS, push). Confirm
   the conditions the Act sets for transfers abroad and whether patients must be told the countries.
4. **Retention.** "As long as the law on medical records requires" — fill in the actual period and the period for
   technical logs.
5. **Deletion.** Clinical records are append-only (corrections added, earlier versions kept). Confirm this is how the
   right to erasure should be described.
6. **Children.** Booking for household members exists; the guardian model is not built (PRD Part 8 #12). Decide what
   the notice says about minors.
7. **Processors.** Named by company since the senior review (H-7): Supabase, Vercel, Africa's Talking, Expo, Sentry
   (wording approved by the owner, 12 Nov 2026).
   Not yet named: Anthropic (reading meter and food-label photos in the app), Google Maps and OpenStreetMap (maps),
   Open Food Facts. They come with the per-feature AI consent work. Confirm whether countries must be named.

## Terms of use

1. **Liability.** "When things go wrong" makes no limitation-of-liability claim beyond "nothing limits your rights
   under Ugandan law". Add any limitation the lawyer advises.
2. **Fees.** Booking is free; fees shown are the hospital's. Confirm the wording against ADR 0092.
3. **Suspension and governing law.** Plain statements; confirm.
4. **Hospital agreement.** These terms are for patients. Hospitals need their own subscription agreement.

## To publish

Set the flags in `lib/legal.ts`, update `updated` in `content/legal.ts`, deploy.
