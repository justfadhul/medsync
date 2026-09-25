# Onboarding v2: usability kit

For Fadhul, to run with real testers (Phase 7). Each session takes 15–20 minutes per tester.

## Before you start

1. **v2 is live for everyone** (ADR 0129): no flag and no preview link.
2. **Use a low-end Android on mobile data** where you can, and at least one desktop.
3. **Accounts are real:** use a fresh email per tester (e.g. `name+test1@gmail.com`). Delete the test accounts afterwards from `/admin/people`.
4. **Don't help.** Note where they stop, what they re-read, and what they say.

## Who (5 per form)

| Form | Testers |
|---|---|
| Patient | 5, with at least 2 aged 50+ or less confident with phones |
| Clinical | a doctor, a nurse and an allied professional (+2 of any) |
| Non-clinical | a receptionist if possible (+4 front-desk or records staff) |
| Hospital | an administrator with no clinical background (+4 of any) |

## Tasks (read aloud)

- **Patient:** "Create a MedSync account for yourself. Use your real area. You can stop when you see the next page."
- **Clinical:** "Sign up to work at [Mulago] as you. If you don't have your licence with you, carry on without it."
- **Non-clinical:** "Sign up to work at [Mulago]'s front desk."
- **Hospital:** "Apply for [your facility] to join MedSync. You don't have the signed letter with you."

## Results sheet (one row per tester)

| Tester | Form | Completed (y/n) | Time to submit (mm:ss) | Errors seen (how many, which fields) | SEQ 1–7 ("Overall, how easy was it?") | "What was most tiring?" | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## Targets (§12)

- Completion ≥ 90 % per form; median SEQ ≥ 6 of 7.
- Record the median time. It becomes the "About N minutes" line on each form (rounded up).

## Afterwards

- **Funnel data** from real traffic: `node --env-file=.env.local scripts/onboarding-funnel.mjs 30` (starts, submits, completion, median time, fields that fail most).
- **Send back:** the filled sheet, plus any screen a tester got stuck on (a photo of the phone is enough).
