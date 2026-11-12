# MedSync Book pilot: go-live switches

Every env var, flag and code switch the 30-day booking pilot (about 5 private clinics, web first) needs, with
the value and who sets it. Names only: no secret value belongs in this file.

**Who:**

- **Host** is whoever holds the Vercel account the app deploys from (the collaborator's fork, deployed by hand).
- **Owner** sets Supabase secrets and decides the flags.
- **Code** is a one-line commit (owner decides, anyone commits).

Vercel env changes reach only new deployments: set everything first, then deploy once.

## 0. Blockers before the first real patient

| What                                                    | Value                                                | Who             |
| ------------------------------------------------------- | ---------------------------------------------------- | --------------- |
| Vercel plan                                             | **Pro**                                              | Host            |
| `vercel.json` → `/api/cron/dispatch-reminders` schedule | `*/15 * * * *` (branch `feat/booking-pilot-go-live`) | Code, after Pro |
| `DEV_SKIP_MFA`                                          | **unset** in Production                              | Host            |
| `PHARMACY_DEV_HOSPITALS`                                | **unset** in Production                              | Host            |
| `SKIP_ENV_VALIDATION`                                   | **unset** everywhere on Vercel                       | Host            |
| `MEDSYNC_ENV` (Supabase Functions secret)               | `production`                                         | Owner           |

- **Reminders every 15 minutes need Vercel Pro.** Hobby refuses any cron more often than daily at deploy
  time, so the whole deploy fails. Do not merge `feat/booking-pilot-go-live` to `main`, and do not deploy it,
  until the account is on Pro. On a daily cron, a 2-hour arrival window or waitlist offer goes out once a
  day, which is worse than not sending it. The free alternative (Supabase `pg_cron` + `pg_net` calling the
  route) is described in [ops-channels.md §2](../ops-channels.md) and is not built.
- With `DEV_SKIP_MFA` or `PHARMACY_DEV_HOSPITALS` set, a Production build refuses to start
  (`lib/boot-guard.ts`, `instrumentation.ts`), so leaving one on shows up as a dead deploy, not a quiet hole.
  Check Preview too if pilot clinics will ever use a preview URL: the guard only runs where
  `VERCEL_ENV=production`.
- `MEDSYNC_ENV=production` in Supabase Functions stops `pt-emergency-sheet` from serving draft rows when a
  caller asks for them. On Vercel it is optional: the app falls back to `VERCEL_ENV`.

## 1. Vercel env (the Next app), Production

| Name                                   | Value / rule                                                         | Who  | Needed for                                                               |
| -------------------------------------- | -------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | the project URL                                                      | Host | everything                                                               |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`        | the anon key                                                         | Host | everything                                                               |
| `SUPABASE_SERVICE_ROLE_KEY`            | the service role key, server only                                    | Host | crons, USSD/SMS routes, privileged reads                                 |
| `DATABASE_URL`                         | the pooler connection string (port 6543)                             | Host | Drizzle (crons, server pages)                                            |
| `DATABASE_DIRECT_URL`                  | the direct connection string (port 5432); required by env validation | Host | env validation fails without it                                          |
| `MEDSYNC_PHI_KEY`                      | **same key** as the Supabase Functions secret                        | Host | phone numbers (encrypt, decrypt, blind index)                            |
| `CRON_SECRET`                          | random, ≥ 16 chars (`openssl rand -hex 32`)                          | Host | every `/api/cron/*` route; without it each one answers 503               |
| `AFRICASTALKING_USERNAME`              | the AT app username (not `sandbox` in Production)                    | Host | every SMS; unset, the reminder cron answers 503 and sends nothing        |
| `AFRICASTALKING_API_KEY`               | the AT API key                                                       | Host | every SMS                                                                |
| `AFRICASTALKING_SENDER_ID`             | optional; needs UCC/AT approval. Unset = AT's default shortcode      | Host | sender name on SMS                                                       |
| `SMS_WEBHOOK_SECRET`                   | random, ≥ 16 chars; also typed into the AT dashboard URLs            | Host | delivery reports and inbound SMS (`/api/sms/*/<secret>`)                 |
| `USSD_WEBHOOK_SECRET`                  | random, ≥ 16 chars; also typed into the AT dashboard URL             | Host | USSD (`/api/ussd/<secret>`)                                              |
| `AT_CALLBACK_IPS`                      | **unset** unless AT gave a current IP list in writing                | Host | optional second lock on callbacks                                        |
| `EXPO_PUSH_ACCESS_TOKEN`               | optional (Expo enhanced push security)                               | Host | push; web-first pilot has few or no push tokens, so SMS carries the load |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | recommended for a pilot                                              | Host | error reports                                                            |
| `SENTRY_AUTH_TOKEN`                    | optional (source maps)                                               | Host | readable stack traces                                                    |
| `ONBOARDING_EVENTS_RETENTION_DAYS`     | optional; unset = 180                                                | Host | cleanup cron                                                             |
| `VERCEL_ENV`                           | set by Vercel; do not set by hand                                    | —    | production checks                                                        |

The SMS webhook secrets and AT keys must be set before the AT dashboard callback URLs are pointed at the
host: [ops-channels.md §1 and §3](../ops-channels.md).

## 2. Supabase Functions secrets

| Name                                                             | Value / rule                                          | Who   |
| ---------------------------------------------------------------- | ----------------------------------------------------- | ----- |
| `MEDSYNC_PHI_KEY`                                                | already set; must match Vercel's                      | Owner |
| `MEDSYNC_SYSTEM_ACTOR_UUID`                                      | already set; a real `auth.users` row, never delete it | Owner |
| `MEDSYNC_ENV`                                                    | `production`                                          | Owner |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | injected by Supabase; nothing to set                  | —     |

## 3. Feature flags on the booking path (Vercel env)

Unset means off for every flag below.

| Name                                        | Pilot value                          | Who   | What it does                                                                                                    |
| ------------------------------------------- | ------------------------------------ | ----- | --------------------------------------------------------------------------------------------------------------- |
| `FEATURE_SYMPTOM_CATALOG`                   | **unset**                            | Owner | symptom catalogue before booking (`lib/emergency/feature.ts`); off in production until Gate CS (signed content) |
| `FEATURE_PRE_ALERT`                         | **unset**                            | Owner | "Tell a hospital I'm coming"; off, the emergency sheet is call-only                                             |
| `FEATURE_FIRST_AID_CARDS`                   | **unset**                            | Owner | the two draft first-aid cards                                                                                   |
| `PATIENT_WEB_TIDE`                          | owner decides (`1` or unset)         | Owner | `1` serves the new Tide patient pages; unset keeps the old `/patient` pages                                     |
| `PATIENT_FLAGS`                             | **unset**                            | Owner | phone-only extras (`mobileChat`, `mobilePayments`, `mobilePhoneOtp`, `sayIt`)                                   |
| `TIDE_SURFACES`                             | owner decides (`reception` or unset) | Owner | reception in the Tide look; unset changes nothing                                                               |
| `PHARMACY_PATIENT_LIST`, `PHARMACY_REFILLS` | **unset**                            | Owner | patient medicines list and refills; not part of booking                                                         |
| `PATIENT_RESULTS`, `PATIENT_RESULTS_SMS`    | **unset**                            | Owner | lab results to patients; not part of booking                                                                    |

Every clinical flag outside booking (`EMR_*`, `CLERKING_*`, `LAB_*`, `NCD_*`, `PRESCRIBE_V2`, `WARD_BUILDER`, …)
stays as it is today; the pilot does not need any of them on.

## 4. Code switches (`lib/legal.ts`)

| Switch                         | Today       | Pilot value                                                                                                                                                    | Who                 |
| ------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `legalConfig.privacyPublished` | `false`     | `true` once the privacy notice is live                                                                                                                         | Code                |
| `legalConfig.termsPublished`   | `false`     | `true` once the terms are live                                                                                                                                 | Code                |
| `legalConfig.pdpoRegistered`   | `false`     | `true` once PDPO registration is granted                                                                                                                       | Code                |
| `legalConfig.legalEntityName`  | `"MedSync"` | the registered company name                                                                                                                                    | Code                |
| `signupsOwnerOverride`         | `true`      | `true` keeps every `/signup/*` form open in production before the privacy notice and PDPO; `false` brings back the holding page until both are true (ADR 0112) | Code, owner decides |

Patients book and give phone numbers during the pilot, so the privacy notice and PDPO registration are the
legal items behind these flags; flipping the flag does not make them true.

## 5. Crons (`vercel.json`)

| Path                           | Schedule       | Note                                                                                   |
| ------------------------------ | -------------- | -------------------------------------------------------------------------------------- |
| `/api/cron/dispatch-reminders` | `*/15 * * * *` | **Pro only.** Reminders, receipts, waitlist offers, push receipts, unconfirmed release |
| `/api/cron/sweep-pre-arrivals` | `0 4 * * *`    | daily                                                                                  |
| `/api/cron/cleanup-drafts`     | `0 2 * * *`    | daily                                                                                  |
| `/api/cron/sweep-break-glass`  | `0 3 * * *`    | daily                                                                                  |
| `/api/cron/hmis-changes`       | `0 1 * * *`    | daily                                                                                  |
| `/api/pharmacy/sms/daily`      | `0 5 * * *`    | daily                                                                                  |

The dispatcher is safe at 15 minutes: a row is claimed (`state` → `sent` only where it is still `queued` or
`held`) before anything is sent; quiet hours (default 21:00–07:00 EAT, per hospital) park a row until the
window ends; an SMS fallback is keyed `:sms` and inserted `ON CONFLICT DO NOTHING`.
`tests/notifications/dispatches.test.ts` runs a day of 15-minute runs and fails on any second send. Urgent
appointment reminders (`appointment_reminders`, 30 and 5 minutes before) are not held for quiet hours: held,
they would arrive after the visit.
