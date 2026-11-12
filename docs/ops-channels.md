# Ops — Africa's Talking channels (SMS out, DLR, inbound SMS, USSD)

Gates E and F ([ADR 0090](adr/0090-gate-e-notifications-waitlist-cancellation.md),
[ADR 0091](adr/0091-gate-f-low-bandwidth-channels.md)). This is the owner's runbook: the env, the dashboard
steps, how to test without a live number, and the two notes that cost money.

## 1. Environment

| Where              | Variable                    | What                                                                                                                                                                                                                                                                                               |
| ------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel (Next)      | `AFRICASTALKING_USERNAME`   | AT app username (`sandbox` for the simulator)                                                                                                                                                                                                                                                      |
| Vercel             | `AFRICASTALKING_API_KEY`    | AT API key                                                                                                                                                                                                                                                                                         |
| Vercel             | `AFRICASTALKING_SENDER_ID`  | Optional alphanumeric sender (needs UCC/AT approval); absent = AT's default shortcode                                                                                                                                                                                                              |
| Vercel             | `SMS_WEBHOOK_SECRET`        | **Set 2026-09-14** (production; value in `.env.local`). The path segment of the DLR and inbound-SMS callback URLs                                                                                                                                                                                  |
| Vercel             | `USSD_WEBHOOK_SECRET`       | **Set 2026-09-14** (production; value in `.env.local`). The path segment of the USSD callback URL                                                                                                                                                                                                  |
| Vercel             | `AT_CALLBACK_IPS`           | Optional, comma-separated. **Leave unset** unless Africa's Talking support has given you their current callback source IPs in writing — AT publishes no list and changed the IPs in its 2023 cloud migration; a wrong list turns every callback into a silent 404                                  |
| Vercel             | `SUPABASE_SERVICE_ROLE_KEY` | Already set. The USSD/inbound routes call `system-ussd-book` / `system-ussd-act` with it — never exposed                                                                                                                                                                                           |
| Vercel             | `MEDSYNC_PHI_KEY`           | Already set. Phones on `ussd_sessions` / `inbound_sms` are encrypted + blind-indexed with it                                                                                                                                                                                                       |
| Supabase Functions | `MEDSYNC_SYSTEM_ACTOR_UUID` | **Set 2026-09-14:** `61ea9aa2-fcfa-4d97-94b5-2f94c5e245e5` = auth user `fadhulusama+medsync-system@gmail.com` ("MedSync System", no role, state unverified). Never delete it — `sa_audit_log.actor_id` and `appointments.created_by_user_id` point at it; never approve, suspend or give it a role |
| Supabase Functions | `MEDSYNC_PHI_KEY`           | Already set                                                                                                                                                                                                                                                                                        |
| Vercel (optional)  | `EXPO_PUSH_ACCESS_TOKEN`    | Expo enhanced push security                                                                                                                                                                                                                                                                        |

Rotate a webhook secret by setting the new value, redeploying, then updating the AT dashboard URL — the old
URL answers 404 the moment the deploy is live.

## 2. Migrations and functions, in order

```sh
npm run db:migrate                       # 0061 (Gate E), 0062 (Gate F) — GATED, owner runs
npm run db:backfill-phone-hmac           # once: patient_profiles.phone_hmac for rows written before 0062
# Every function: _shared/ changed (errors, sa-audit, system-actor), so a named subset would leave stale
# bundles. --use-api bundles server-side (no Docker on this machine). Never pass --no-verify-jwt.
npx supabase functions deploy --use-api
```

Then deploy the Next app. Vercel env changes reach only NEW deployments, so add every variable first and
deploy once. `system-ussd-book` and `system-ussd-act` refuse any Bearer that is not the service role
(`_shared/system-actor.ts`: the injected key byte-for-byte, or a gateway-verified JWT with `role =
service_role`), so exposing them is safe; they still should not be advertised.

### The dispatcher's cadence

`vercel.json` schedules `/api/cron/dispatch-reminders` **every 15 minutes** (`*/15 * * * *`) from branch
`feat/booking-pilot-go-live`. That entry **needs Vercel Pro**: Hobby refuses any sub-daily expression at
deploy time ("Hobby accounts are limited to daily cron jobs"), so the deploy fails outright. Do not merge it
to `main` until the hosting account is on Pro (checklist: [booking-pilot/GO-LIVE.md](booking-pilot/GO-LIVE.md)).
The free alternative stays open: keep a daily entry and drive the cadence from Supabase `pg_cron` + `pg_net`
(a scheduled `net.http_get` to `https://<host>/api/cron/dispatch-reminders` with
`Authorization: Bearer <CRON_SECRET>`, the secret in Supabase Vault, one GATED migration; not built).

## 3. Africa's Talking dashboard

Callback URLs (replace `<host>` and the secrets):

| Product       | Where in the dashboard                          | URL                                                   | Method / body                                                                                    |
| ------------- | ----------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| SMS → DLR     | SMS → Callback URLs → Delivery reports          | `https://<host>/api/sms/dlr/<SMS_WEBHOOK_SECRET>`     | POST form: `id`, `status`, `phoneNumber`, `networkCode`, `failureReason?`                        |
| SMS → Inbound | SMS → Callback URLs → Incoming messages         | `https://<host>/api/sms/inbound/<SMS_WEBHOOK_SECRET>` | POST form: `from`, `to`, `text`, `date`, `id`, `linkId`                                          |
| USSD          | USSD → Service codes → (shared code) → Callback | `https://<host>/api/ussd/<USSD_WEBHOOK_SECRET>`       | POST form: `sessionId`, `serviceCode`, `phoneNumber`, `text`; reply `text/plain` `CON …`/`END …` |

AT does not sign callbacks. The secret path segment is the authentication. The IP allowlist is an optional
second lock: AT does **not** publish its callback source IPs (ask info@africastalking.com; they changed in
AT's 2023 cloud migration), so leave `AT_CALLBACK_IPS` unset unless you hold a current list in writing — a
wrong list makes every USSD/SMS callback a silent 404. Note that inbound SMS is retried by AT every minute
for up to 12 hours while a callback fails; USSD is live and is simply lost.

Shared USSD code: available immediately on MTN and Airtel through AT. A dedicated code needs UCC allocation.

## 4. What each webhook does

- **DLR** — flips the dispatch row (`provider_message_id = id`) to `delivered` on `Success`, to `failed` with
  the reason on `Failed | Rejected | Expired`. Idempotent; always 200 once the secret matched.
- **Inbound SMS** — `YES <code>` / `CONFIRM <code>` confirms; `CANCEL <code>` cancels; `STOP` opts the phone
  out of every SMS (the receipt included) and revokes the account's consent; anything else gets one help
  reply. One row per AT `id` (`inbound_sms`) — a redelivery does nothing. 10 per phone per hour; the crossing
  message hears why, the rest are dropped silently. Replies go out through the dispatcher as `sms_reply`
  rows, so they cost-attribute like every other SMS (`hospital_id` NULL = the platform's).
- **USSD** — the menu in `lib/channels/ussd.ts`: `1 Book a visit` (language → hospital → clinic → day →
  name and age → confirm → END with position/time + code; SMS receipt follows through the dispatcher),
  `2 My next visit`, `3 Cancel my visit` (code), `4 Confirm I'm coming` (code). 20 sessions per phone per
  hour. Session state lives 10 minutes (`ussd_sessions`, swept by the cleanup cron). Every step logs
  `ussd.step { step, ms }` — PRD §4.5 wants ≤ 2 s.

The booking identity on USSD is a **provisional patient** with `phone_verified_at` set (the carrier verified
the number). A phone that matches an account is _offered_ "Booking as {name}" and still books a provisional
row — never auto-linked; reception reconciles at the desk (PRD §2.8).

## 5. Testing without a live number

- **AT sandbox** (`AFRICASTALKING_USERNAME=sandbox`): the simulator at
  <https://simulator.africastalking.com> dials USSD codes and sends SMS to your sandbox app, and delivers
  the callbacks to whatever URL you configured. Point them at a preview deploy (or `ngrok` to `next dev`).
- **By hand**, the same shapes:

```sh
# USSD — first callback (empty text), then "1", then "1*1", …
curl -s -X POST https://<host>/api/ussd/<USSD_WEBHOOK_SECRET> \
  -d sessionId=test-1 -d serviceCode='*384*1#' -d phoneNumber=%2B256700000001 -d text=
# inbound SMS
curl -s -X POST https://<host>/api/sms/inbound/<SMS_WEBHOOK_SECRET> \
  -d id=msg-1 -d from=%2B256700000001 -d to=12345 -d text='YES K7M2XQ' -d date='2026-09-13 10:00:00'
# delivery report
curl -s -X POST https://<host>/api/sms/dlr/<SMS_WEBHOOK_SECRET> \
  -d id=ATXid_123 -d status=Success -d phoneNumber=%2B256700000001 -d networkCode=64102
```

No test in the repo makes a live AT call; the transports are covered by the planner and machine tests.

## 6. Money

- **SMS** is the dominant variable cost (PRD §1.5): push first, SMS on fallback, one receipt per booking, no
  marketing. Every row records AT's `cost`; `/hospital-admin/scheduling` → "Sent today" sums it per facility.
- **USSD** (Part 8 #9): **prepaid** charges the patient per session; **postpaid** makes the code toll-free
  and bills the facility. The PRD's recommendation is a shared code, postpaid where a facility funds it —
  a facility that wants feature-phone patients booking pays for that choice. Configure per AT account;
  MedSync has no per-facility switch for it yet (Gate H reports will show USSD sessions per facility once
  `ussd_sessions.hospital_id` is populated by a booking).
