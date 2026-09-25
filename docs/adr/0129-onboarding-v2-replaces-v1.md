# ADR 0129 — Onboarding v2 replaces the old forms; the flag is gone

**Status:** Accepted — 2026-09-25. Supersedes the flag part of ADR 0119 (§6: "behind `ONBOARDING_V2=1`… the old forms stay the default until the Phase 7 targets are met").

## Context

The owner saw v2 and asked for it to replace the old forms outright, with no flag.

## Decision

1. **The four `/signup/*` routes render the one-page forms only.** The old multi-step forms, their server actions and their lazy wrappers are deleted.
2. **The v2 code moves into the standard places.** Server actions go to each route's `actions.ts`, forms to `_components/form.tsx` and logic to `_lib/`. The "V2" names are dropped (`submitPatientSignup`, `PatientSignupForm`, …).
3. **The flag is removed:** `lib/onboarding/feature.ts`, `/signup/preview` and every branch on it.
   - The signup header always carries the Emergency button.
   - `/get-started` always shows the new "You'll need" lines and "Ask us to call you".
   - `ONBOARDING_V2` in Vercel is now unused and can be deleted.
4. **Seven primitives of `components/forms` go:** `MultiStepForm`, `CascadingCombobox`, `RadioCards`, `DatePicker`, `OtpInput` and `FileUpload` are deleted, and `Checkbox` stays (ConsentCheckbox uses it).
5. **`tests/auth-pages` test 10 now checks each door's copy against the shared schemas** (`lib/onboarding/schemas.ts`) rather than regex over the old actions.

## Consequences

- There is no in-app way back to the old forms. Rolling back means redeploying an older build (last old-form build: `medsync-3kzwqfje1`).
- Usability testing (Phase 7) runs on the live forms. The time estimates wait for those medians, as before.
