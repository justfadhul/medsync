# MedSync Book — how to test what was built (A′–H)

A hands-on walkthrough for the owner and anyone they hand a phone to. It covers what only a person can see;
the machine already checks the rest (§0). Every step is **Do → Expect**. Where a step is expected to be
_refused_, the refusal is the pass. Every label and sentence below was checked against the code on
2026-09-20; §3 (patient web), §5 (reception) and §6 (doctor, cancel a clinic day) were re-walked against the
Tide redesign on a local dev server on 2026-11-12. §4 (phone) and §7–§11 were not re-walked. What broke on
that run, and what is still open, is in §13.

Read alongside: `docs/booking-app-handoff.md` (deploy order, secrets), `docs/ops-channels.md` (USSD/SMS
runbook), ADRs 0084–0094 (why things behave as they do).

**Money is deferred**, so nothing here pays, sends a live SMS, or delivers a push. Those are listed in §12 as
"not testable yet", not as gaps.

---

## 0. Before you start

### 0.1 Apply and deploy (once)

```sh
npm run db:migrate                          # 0063 then 0064 — both dry-run clean
npx supabase functions deploy --use-api     # every function; _shared/ changed
npx vercel deploy --prod                    # or push to main — the project is GitHub-linked
```

`0063` must land **before** the redeployed functions: `_shared/book.ts` now writes `quoted_fee_*`.

### 0.2 Let the machine do its part

```sh
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build && npm run budget
cd mobile && npx tsc --noEmit && npx eslint src --max-warnings=0 && npx prettier --check "src/**/*.{ts,tsx}"
```

All green means: the clinical firewall holds (PRD §5.4), red is reserved, every Pill has words, the six Gate H
rulings are in the code, the axe pass over the public pages is clean, and the patient routes are under 370 kB.
The same run happens on GitHub on every push (`.github/workflows/ci.yml`). Fifteen suites skip locally
unless `MEDSYNC_ALLOW_RLS_DB_WRITES=1` — they write rows to whatever `.env.local` points at, so run them only
against a project you are happy to dirty.

### 0.3 Run the apps

```sh
npm run dev                                 # web at http://localhost:3000
cd mobile && npx expo start --lan -c        # phone: Expo Go on the same Wi-Fi, or an emulator
```

Or test against production: `https://medsync-six.vercel.app`. The phone talks to the same Supabase project
either way (`mobile/.env`).

### 0.4 Two browsers, one phone

One browser holds up to five signed-in accounts (ADR 0280): add them at `/accounts` → **Add another account**
and switch with **Use this account**; every tab uses the active one. Use a phone (Expo Go) for the patient
app. The Africa's Talking simulator is your "feature phone".

With all five accounts signed in, the cookies pass Node's 16 KB header limit and `next dev` answers **431**
(§13, G3). Locally, start it with `NODE_OPTIONS=--max-http-header-size=65536`, or keep to four accounts.

Since migration 0288 (the MFA gate), Edge Functions refuse a staff session below aal2. A staff account signed
in through `DEV_SKIP_MFA` stays at aal1: its Edge Function calls (check in, cancel a day, approvals) answer
**401** and its own-token reads come back empty, while pages that read through Drizzle still render. That is
expected, not a booking defect. To test staff actions, enrol at `/onboarding/mfa-setup` and sign in with the
6-digit code, with `DEV_SKIP_MFA` unset for that run.

---

## 1. The cast

You need these accounts. If the dev project already has them, reuse them; the handoff names the five legacy
patients and the system actor.

| Role                   | How to get one                                                                                                                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Superadmin** (you)   | Already exists. Signs in with MFA.                                                                                                                                                                                                                                            |
| **Hospital admin**     | `/signup/hospital` → you activate it at `/admin/tenants`. (`/hospital-admin/admins` is still a placeholder. A second admin on an existing hospital needs the claim link a superadmin gets from `/admin/tenants` → New hospital, opened by a signed-in, MFA-enrolled account.) |
| **Reception**          | The person registers at `/signup/non-clinical`, picking the hospital and the Reception cadre → the hospital admin approves the pending affiliation at `/hospital-admin/staff`.                                                                                                |
| **Clinician (doctor)** | `/signup/clinical` with a clinical cadre (e.g. Medical Officer) → same approval. The **Invites** panel at `/hospital-admin/staff` is optional: it takes emails only and hands you a `/signup/clinical?invite=…` link to share.                                                |
| **Patient A** (web)    | `/signup/patient` — three steps: identity (name, sex, date of birth, ID type, phone), district, then the account (**email + password ≥ 12 chars** — you sign in with the email, not the phone) and the consent box. Usable immediately.                                       |
| **Patient B** (phone)  | Another `/signup/patient`; sign in on Expo Go with it.                                                                                                                                                                                                                        |
| **Feature phone**      | The AT simulator at <https://simulator.africastalking.com> with your sandbox app (`docs/ops-channels.md` §3).                                                                                                                                                                 |

Do **not** use `/sign-up` for staff — it creates a patient-default account. MFA is mandatory for reception
and clinical roles — enrol at `/onboarding/mfa-setup` on first sign-in.

---

## 2. Set the hospital up (hospital admin)

Everything below happens at `/hospital-admin`.

### 2.1 A department, a clinician, a cadre

- **Do:** `/hospital-admin/departments` — at least one department (e.g. Medicine). At `/hospital-admin/staff`,
  the doctor's affiliation is **active** in that department with a **clinical** cadre.
- **Expect:** the doctor appears in the roster with the cadre's registered name, verbatim.

### 2.2 Service lines — one of each mode

`/hospital-admin/scheduling` → **Service lines**. Create three:

| Line             | Capacity mode  | Payment posture      | Fee (UGX) | Why                                      |
| ---------------- | -------------- | -------------------- | --------- | ---------------------------------------- |
| General clinic   | **session**    | **Full fee to book** | 20,000    | positions and arrival windows (ADR 0087) |
| Follow-up review | **slot**       | **Full fee to book** | 30,000    | a clinician's time                       |
| Same-day queue   | **open_queue** | **No payment**       | —         | the walk-in door                         |

- **Expect:** each line saved with its reason codes. The Fee box steps in hundreds; the server accepts any
  whole UGX.

### 2.3 Fees by cadre (Gate G)

- **Do:** open _Follow-up review_ (a saved line) → **Fees by cadre** → an override for the doctor's cadre at
  UGX 35,000 with a reason (≥ 8 chars). Then open _Same-day queue_.
- **Expect:** the override saves and shows the cadre's registered name. On the No-payment line the **Fees by
  cadre** panel is simply absent. Call `ha-set-service-line-fee` directly for that line → **409** "This clinic
  is free. Set a payment posture on the line first." Call it as a **reception** user → refused (hospital_admin
  or superadmin only).

> The override goes on _Follow-up review_ (the slot line) because that is the line the provider screen books
> into (§3.3). Put a second one on _General clinic_ if you want the **range** on its tile (§3.2).

### 2.4 Weekly rules → clinic days

- **Do:** **Weekly rules** panel → **New rule** on _General clinic_: the doctor as clinician, a weekday,
  09:00, 180 min, total 60 / bookable 10, interleave 2/1, overbooking 1.00. Add a **second** rule with **no
  clinician**.
- **Expect:** both rules' days appear in the **Next 14 days** panel as `published`; the
  unnamed rule's rows read **Not yet assigned** in the Clinician column.

### 2.5 Availability for the slot line

- **Do:** as the doctor, `/doctor/schedule` → **Availability** → Add block: Type **Bookable**, a coming
  weekday, e.g. 09:00–12:00. (There is no department field — the block follows the doctor's affiliation.)
- **Expect:** the block appears on the calendar; the patient side derives slots from it.

---

## 3. Patient on the web (Tide)

With `PATIENT_WEB_TIDE` on, every `/patient/*` page is the Tide design (served from `app/pw/`). The old URLs
redirect: `/patient/appointments` → `/patient/visits`, `/patient/clinician/<id>` →
`/patient/book/day?doctor=<id>`, `/patient/symptoms` → `/patient/book/wrong`, `/patient/household` →
`/patient/me/household`.

Sign in as **Patient A**. A patient with no hospital yet is asked to choose one ("Choose your hospital first")
at `/patient/hospitals`; only **active** hospitals are listed.

### 3.1 Consent re-acceptance (Gate H)

You only see this if your record does not match the active notice. To force it on the dev project, publish
a new version of the notice — a real product action — and every patient is asked once:

```sql
-- DEV PROJECT ONLY. Supersedes v1.0; pgcrypto is on.
INSERT INTO public.consent_versions (consent_type, version, effective_date, supersedes_id, body, body_sha256)
SELECT 'data_processing', 'v1.1', current_date, id, body || E'\n\n(v1.1 — test revision)',
       encode(digest(body || E'\n\n(v1.1 — test revision)', 'sha256'), 'hex')
FROM public.consent_versions WHERE consent_type = 'data_processing' AND version = 'v1.0';
```

- **Do:** open `/patient`.
- **Expect:** you land on `/patient/consent` with the full text of v1.1, a checkbox and "Agree and continue".
  Nothing else to tap leads back in. Tick and submit: you are on the home.
- **Also:** while gated, try `/patient/visits` directly → redirected back to consent.

### 3.2 Book a visit (`/patient/book`)

- **Do:** from the home, Book (or open `/patient/book`).
- **Expect:** "Book a visit" with two doors: **Open now · Come to the hospital today** (or "No clinic takes
  walk-ins now") and **Next open day: <day> · Ask for a day** ("Pick an open clinic day. The clinic confirms
  it."). The footnote: "Very unwell right now? Do not book. Press the red Help button."
- **Why are you coming?** offers **Something is wrong** and **Planned care**. While the symptom catalogue is off
  (production, until Gate CS is signed and `FEATURE_SYMPTOM_CATALOG=1`), Something is wrong reads "This is not
  available yet. You can still book a visit or come to the hospital today." — see §13, G1.

### 3.3 Ask for a day (`/patient/book/day`)

- **Expect:** a month calendar ("Open days are bold with a dot"), **Morning or afternoon?** with "Doors 08:00"
  or "No clinic", and the sentence "The time is when doors open, not your hour. You are seen in the order
  people arrive with a code." Then **Who do you want to see?** (Any doctor, or a named clinician, each with the
  fee), **Anything the doctor should know? · Optional** (text, Voice note, Add photo, Camera), and **Pay now ·
  Mobile Money** / **Pay later**. "Demo payment: no money moves, and your ticket says so." The submit button
  names the fee, the day and the part of the day.
- **Do:** pick a day and send.
- **Expect:** "The clinic confirms it. You will see the answer in Visits." The visit is on `/patient/visits`
  (Confirmed at once where the clinician has auto-confirm on). The notification "Your visit is booked" is on
  `/patient/notifications`.
- **Try:** book 5 more times quickly → the sixth is refused (5 per hour).

### 3.4 A doctor's time (slot mode)

- **Do:** open a slot-mode doctor: `/patient/book/day?doctor=<id>&department=<id>&hospital=<id>` (the old
  provider link redirects here).
- **Expect:** days and **times** from the doctor's availability (§2.5). Picking a time shows a live countdown,
  "Your visit is in … hrs … min … sec", with no hydration error in the console.

### 3.5 Waitlist

- **Expect:** "Tell me if a place opens" appears on the day page **only** when the chosen line has no open
  day and takes a waiting list. Set that up first: a line whose days are all full or none published inside its
  time-to-care window (default 7 days). At Test Hospital-1 every line had open days on 12 Nov, so the door
  could not be reached.
- **Then:** join; free a place (cancel another patient's booking) → the entry is **offered** and a
  `waitlist_offer` dispatch is queued; `pt-accept-waitlist-offer` books it when accepted.

### 3.6 Visits: move, cancel, arrive (`/patient/visits`)

- **Expect:** "This week": the month calendar, the next visit, and the week ahead. Tap a visit →
  `/patient/visits/<id>`: the band (department, status · code), the clinician, the **ticket** (hospital, day,
  clinic, who, time, the fee as money — "Not paid · UGX 50,000" — never the line's name), then **I'm coming**
  (it becomes **I'm here** on the day), **Move it**, **Cancel**, and **Getting there**.
- **Move it:** a dialog with this clinician's open days and times and a reason (8 characters at least) →
  "Your visit has moved." The moved visit has a new code and keeps the quoted fee.
- **Cancel:** a reason (8 characters at least) → "Your visit is cancelled." An ended visit shows the sentence
  ("Cancelled at the patient's request.") and no ticket, arrive note or Getting there.
- **I'm here:** on the day; the reception board (§5.2) shows the patient as arrived.

### 3.7 Household

- **Do:** `/patient/me/household` → add an adult member. Try a member aged 12.
- **Expect:** the adult saves; the child is refused with "Booking for a child is not available yet." A
  member's visit is logistics only: "You booked this for <name>. It can be moved or cancelled at the desk."

---

## 4. Patient on the phone (Expo Go, Patient B)

### 4.1 Sign in and the consent gate

- **Do:** sign in. If v1.1 is live and B has not accepted it:
- **Expect:** the **consent screen is the only screen** — no tabs behind it, no Back. The **emergency block**
  is at the top (the Emergency tab is behind the gate, so the block travels). The full text, a checkbox, "Agree
  and continue", "Sign out instead".
- **Do:** while still signed in, turn Wi-Fi/data **off**, then kill and reopen the app (the stored session
  restores on its own — do not sign out first; an offline sign-in only shows "Couldn't reach MedSync").
- **Expect:** "We couldn't check your account" with **Try again** — the app does **not** open onto the tabs.
  Data back on, Try again → the consent screen (or the tabs, if already accepted).
- **Do:** with data on, tick and Agree.
- **Expect:** the tabs appear. Kill and reopen: a brief "Checking your account" hold (emergency block +
  spinner), then the home — the consent form itself does not come back.

### 4.2 Home, doctor, clinic

- **Expect:** top strip (wordmark · hospital · your photo, which opens Settings), greeting, "How are you
  feeling today?", Coming up, the two doors, **Let's find your doctor** with the search box, **Doctors** with
  department chips and the carousel, **Find care** tiles with fees and both sentences.
- **Do:** search a name that matches nothing.
- **Expect:** "0 clinicians and 0 clinics match"; the department chips stay so you can reset; clear the box.
- **Doctor screen:** same components as the web (§3.3), one fee number. **Clinic screen:** the fee card with
  both sentences; days with no clinician are disabled.

### 4.3 Book, see, move, cancel, rate

- Book a clinic day → the interstitial → receipt with position and window.
- **Visits** tab → a slot-mode visit (Follow-up review) → **Move this visit** → a day and time; the moved
  visit keeps its quoted fee. A clinic-day booking shows no move control on the phone — the server refuses to
  move a position (cancel and rebook instead).
- Cancel → the visit reads "Cancelled at the patient's request."
- After a completed visit, **rate it** from the visit screen; the rating appears on the doctor's card as
  "★ 5.0 · 1" (never before there is one).

### 4.4 Emergency

- **Expect:** the Emergency tab is the **only red thing in the app**. Every pushed screen carries the red disc;
  the tab shows the hospital's verified number or the destination alone — never an invented number.

### 4.5 Sign out

- **Expect:** Settings → Sign out → the welcome screen. On a **physical device with a dev build** the device's
  `push_tokens` row is deleted (check in the Table Editor — RLS hides it from PostgREST). Android Expo Go and
  emulators never mint a token, so there is nothing to delete there.

---

## 5. Reception

Sign in as **Reception** (MFA). `/reception`.

### 5.1 Book on behalf (`/reception/book`)

- **Do:** **Who is calling?** → **New caller** (Name as given, Phone, Date of birth) or an existing patient
  (from a record, `/reception/book?patient=<id>` fills it in). **Why are they coming?** (Reason; What is
  bothering them) → **Which clinic?** → **Which clinic day?** (or **Which day and time?** on a slot line) →
  **Check before booking** → **Book a place** (or **Book this time**). For §5.2, give the caller **Patient A's
  phone** (or A's name and year of birth).
- **Expect:** "Place booked" with **Booking code — read it out**, the **Position** and **Arrive between**.
  "The booking code is texted here." A new caller's booking is provisional (**Identity to confirm**).
- **Do:** a caller aged 15; then age 18 typed beside a 2015 birthday.
- **Expect:** both refused with "Booking for a child is not available yet." on the form and from the server.

### 5.2 Expected today (`/reception/expected`)

- **Expect:** today's bookings with time and position, a status word (Confirmed, Arrived, …) and tags
  ("Coming today", "Patient confirmed", "Urgent booking"). A provisional booking reads **Identity to confirm**
  with **Confirm identity**; candidates appear only on the same phone, or the same name and year of birth.
- **Check in**, then route: **Send to triage** or **Send to clinic** → "Sent to triage" / "Sent to clinic". The
  patient appears in that clinic's queue (§6).
- **Urgent goes to triage:** an **Urgent booking** is sent to triage whichever button is pressed (ADR 0425,
  `effectiveRoute`; `tests/functions/arrival-routing.test.ts`). An urgent booking only comes from the symptom
  catalogue, so with it off (§13, G1) this cannot be walked by hand.
- **Reconcile / un-reconcile, cross-tenant, no-show:** unchanged — **Confirm** on Patient A's card names A;
  un-reconcile is a direct `ha-reconcile-identity` call with a reason ≥ 20 chars; "No-show…" needs a reason
  ≥ 8 chars once the start time has passed (`/reception/expected?date=YYYY-MM-DD` for a past day).

### 5.3 Find (`/reception/find`)

- **Do:** type a surname (people on today's board) or a patient code (any record; ≥ 3 characters).
- **Expect:** patient records with **Register an entry**. To book for a found patient use `/reception/book`.

Cancelling a clinic day is a **hospital admin** action, not reception's (§6.4).

---

## 6. The doctor

Sign in as the **doctor** (MFA). A doctor cadre (Intern, Clinical Officer, Medical Officer and above —
`DOCTOR_CADRE_CODES`) lands on `/doctor`; other clinical cadres land on `/clinician`, which has no queue or End
visit.

### 6.1 The day (`/doctor/schedule`)

- **Expect:** "Your week" counts (Appointments, Confirmed, Pending, Urgent, Completed, Cancelled), the calendar
  with **Bookable** blocks and bookings by patient name, and **Today's queue**: WAITING rows with the ticket
  number, name, patient code and the patient's note in quotes.
- **Do:** tap a booking on the calendar.
- **Expect:** the card: name, the note, the time, Patient code, Starts / Ends, and **Cancel…**.

### 6.2 Confirm and decline

- **Do:** with auto-confirm off, confirm one request; decline another with a reason.
- **Expect:** the decline reason is staff only; the patient reads "The clinic could not take this request."

### 6.3 Call, see, end the visit

- **Do:** on a checked-in patient's WAITING row, press ▶ ("Call <name> and start the encounter").
- **Expect:** the row moves to **NOW SEEING** (reload if it does not move — §13). Where the EMR is on, the row
  shows **Open** → `/doctor/encounters/<id>`, and **End visit** is in that page's top bar; where it is off,
  **End visit** is on the row. End visit takes two taps and closes the queue row, the intake and the booking
  in one audited write.

### 6.4 Running late / cancel a clinic day (hospital admin)

- **Do:** `/hospital-admin/scheduling` → **Next 14 days** → tap the day's row.
- **Running late:** **Late by (minutes)** → **Set**. Un-arrived patients' windows move; a message goes when
  the move is 30 minutes or more.
- **Cancel the day:** **Why** (10 characters at least) → **See who this affects** → "1 patient holds a place on
  this day. They will be offered <day>." → tick "I have read the number above and want to cancel this day." →
  **Cancel the day (N affected)**. The row reads **Cancelled**, 0 booked.
- **Patient side:** the notification "Clinic day cancelled · Choose a day" opens the visit: "This clinic day
  was cancelled.", **Book <day>** (one tap, `pt-accept-rebooking`; a second tap books nothing new) and
  **Choose another day**. The rebooked visit is on `/patient/visits`.

### 6.5 Edit a rule (Gate H ruling)

- **Do:** with one future day holding a booking and the others empty, change the rule's bookable capacity from
  10 to 12.
- **Expect:** the **empty** future days now show 12 places; the day **with a booking** still shows 10 — its
  promise stands. Deactivate the rule: empty future days are cancelled; the booked one stays.

---

## 7. USSD and SMS (Africa's Talking sandbox)

Runbook: `docs/ops-channels.md` §3–§5. Callbacks point at your deploy (or `ngrok` to `next dev`).

### 7.1 Book from a feature phone

- **Do:** in the simulator, dial your sandbox code as `+256700000001`.
- **Expect:** a root menu within 160 characters (1 Book a visit / 2 My next visit / 3 Cancel my visit /
  4 Confirm I'm coming, plus the emergency line); on the booking path at most six levels: language → hospital
  → clinic → day → name + age on one screen → confirm. No reason is asked — the clinic's first reason code is
  stamped on the row; the desk can change it. The final screen gives the code, the position and the window.
- **Do:** book again as `Amina 12`.
- **Expect:** refused in one sentence — "Could not book: Booking for a child is not available yet." (the same
  rule as the desk: a feature phone is a desk with no clerk).
- **Expect (behind it):** an `appointments` row with `channel = 'ussd'` and a **provisional** patient; a
  receipt SMS **queued** in `notification_dispatches` (the sandbox inbox gets it once the dispatcher runs, §8).

### 7.2 SMS keywords

Send from the simulator's SMS tab to your sandbox shortcode. Every reply is **queued** as an `sms_reply` row
and reaches the simulator inbox only after the dispatcher runs (§8) — not instantly.

| Text                                                            | Expect                                                                                                                                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `YES <code>` (also `Y`, `OK`, `CONFIRM`, `COMING`)              | a clinic-day booking is confirmed by the patient (`confirmed_by_patient_at` set); a slot booking still awaiting the clinician answers "This visit cannot be confirmed now." |
| `CANCEL <code>` (also `NO`, `N`)                                | cancelled with the code `patient_cancelled` — do not type `NO` expecting help                                                                                               |
| `STOP` (also `STOPALL`, `UNSUBSCRIBE`, `END`, `QUIT`)           | `sms_opt_outs` row for the phone; nothing further is sent to it                                                                                                             |
| `HELP`, `INFO`, `?`, a verb without a valid code, anything else | one-line help ("reply YES <code> to confirm, CANCEL <code> to cancel, STOP to end SMS"), no guessing who you are. There is no MOVE keyword.                                 |

- **Do:** send `STOP`, then book again from the same number.
- **Expect:** the booking succeeds; the receipt row is still created (`queued`) and, when the dispatcher next
  runs, is marked `cancelled` with `failure_reason = 'sms_opted_out'` — never sent. The only SMS the number
  still receives is the one confirming the STOP.

### 7.3 Delivery reports

- `curl` a DLR as in the runbook, using the row's real `provider_message_id` as `id` (the runbook's
  `ATXid_123` placeholder matches nothing and answers `{ "ok": true, "updated": 0 }`) → `Success` moves a
  `sent` row to `delivered`; `Failed`/`Rejected`/`Expired` move it to `failed` with
  `failure_reason = 'dlr_failed: <reason>'`; `Sent`/`Submitted`/`Buffered` change nothing. Cost is not on the
  DLR — it was written to `cost_amount`/`cost_currency` when the dispatcher sent the message.

---

## 8. Notifications (the dispatcher)

The cron runs **daily at 05:00 UTC (≈ 08:00 EAT)** on Hobby. To run it by hand:

```sh
curl -s -H "authorization: Bearer $CRON_SECRET" https://<host>/api/cron/dispatch-reminders
```

- **Expect:** JSON `{ ok: true, legacy: {…}, dispatches: { scanned, push, sms, fallbacks, held: {…}, reaped,
failed, backlog }, receipts: {…}, waitlist: { expired, cascaded }, released: { released } }` —
  `dispatches.sms` is what the sandbox will have received. A wrong secret is 401; a missing `CRON_SECRET`,
  `AFRICASTALKING_USERNAME`/`_API_KEY` or `MEDSYNC_PHI_KEY` is 503 naming the variable.
- **Rows:** the receipt from §7.1 goes `queued → sent`. The T‑24h `confirmation_request` and T‑2h
  `arrival_window` rows were written **at booking time**, not by the cron; they send once their
  `scheduled_at` has passed — for tomorrow's clinic day, expect the confirmation request on today's run and
  the arrival window on tomorrow's.
- **Quiet hours** (per hospital, default 21:00–07:00 EAT) hold the confirmation request, arrival window,
  waitlist offer and window-shift rows (`held`, `scheduled_at` moved to 07:00); the receipt, a clinic-day
  cancellation, an unconfirmed release and SMS keyword replies go at any hour.
- **Push:** with no `push_tokens` row for Patient B (Expo Go, no Firebase — §12) each push row goes `failed`
  with `failure_reason = 'no_push_token'` and keeps `channel = 'push'`; the dispatcher inserts a sibling SMS
  row (same idempotency key with `:sms` for `:push`) that sends on the **next** run, and only if the patient
  granted SMS consent (else `cancelled` / `no_sms_consent`). The receipt already has its own SMS row; a USSD
  booking has no push row at all.
- **Unconfirmed release** is **off** by default (Gate E) — nothing is released for not confirming unless the
  department's scheduling policy sets `release_unconfirmed_hours`, and even then only after a confirmation
  request was actually sent.

---

## 9. Reports (hospital admin) and the rollup (superadmin)

### 9.1 `/hospital-admin/reports`

- **Expect:** a boxed ruling **above** the numbers, headed **"These numbers describe the clinic's access,
  never a patient."** Under it, six cards over **7 / 28 / 90** days — the switch is the "Window" row of three
  links directly under the page header ("7 days" / "28 days" / "90 days", with "since 00:00 on <date>, East
  Africa Time" at its right; default 28) — Fill rate, No-show rate, Wait accuracy, Demand vs capacity, Refill
  load, SMS spend — each with its **basis line** ("34 of 50 places", "2 of 60 held bookings whose day has
  ended"). With fewer than 20 in a denominator the card reads **"Too few to report"**, never a percentage.
- **Below:** a table per service line (fill, wait accuracy, the **Windows** column with "Positions not
  honoured" in amber when under 50% over a real sample — visible on a phone-width screen too) and a table per
  clinic day.
- **Check one number by hand** (read-only SQL against the dev project). The page's window starts at **00:00
  Africa/Kampala** 28 days ago (what it prints as "since 00:00 on …"), not at `now() - 28 days`:

```sql
-- Fill rate, last 28 days, ended days only
select sum(booked_count) as booked,
       sum(ceil(capacity_booked * overbooking_factor)) as places
from clinic_sessions
where hospital_id = '<id>' and status in ('published','closed')
  and starts_at >= ((now() at time zone 'Africa/Kampala')::date - 28)::timestamp at time zone 'Africa/Kampala'
  and starts_at < now() and ends_at <= now();

-- Wait accuracy: session-mode bookings only; a patient who arrived after their window
-- closed is left out of the denominator (the card says so)
select count(*) filter (where q.called_at between a.arrival_window_start and a.arrival_window_end) as inside,
       count(*) as called
from queue_entries q
join appointments a on a.id = q.appointment_id
join clinic_sessions s on s.id = a.session_id
where a.hospital_id = '<id>' and q.called_at is not null
  and a.arrival_window_start is not null and a.arrival_window_end is not null
  and q.arrived_at <= a.arrival_window_end
  and a.starts_at >= ((now() at time zone 'Africa/Kampala')::date - 28)::timestamp at time zone 'Africa/Kampala'
  and a.starts_at < now();
```

- **Demand vs capacity** compares bookings **for** the days that started in the window against those days'
  places; it prints "—" when no day was published. Waitlist joins stand beside it.
- **Refill load** shows the refill-visit count; if GATED migration 0039 (prescriptions) is applied on the
  project it adds "; N prescriptions written" and the note that the two counts are **not joined** — otherwise
  "Prescriptions are not yet recorded at this hospital."

### 9.2 Tenant isolation

- **Do:** as a hospital admin of a **second** hospital, open `/hospital-admin/reports`.
- **Expect:** only that hospital's lines and figures; nothing of the first.

### 9.3 `/admin/scheduling-rollup` (superadmin)

- **Expect:** a **Booked access** panel — one row per hospital: fill, no-show, wait accuracy, requests / places,
  SMS spend. **No patient name, booking code or phone** anywhere on the page — the only names are the
  hospitals' own.

---

## 10. Things that must be refused

Each of these is a pass when it fails.

| Try                                                                                          | Expect                                                                                          |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Book a clinic day whose rule names no clinician (web, phone, or a direct call)               | disabled on the surface; **409** "This clinic day has no clinician assigned yet." from the core |
| Six bookings within an hour as one patient                                                   | the sixth is **429**                                                                            |
| A fee override on a No-payment line; a reception user calling `ha-set-service-line-fee`      | **409** / refused                                                                               |
| Desk or USSD booking with either number under 18                                             | refused, same sentence, client and server                                                       |
| Hospital admin un-reconciles a provisional confirmed to the same patient at another hospital | **409** with the count; superadmin succeeds                                                     |
| Reading another patient's appointment through PostgREST with a patient JWT                   | empty — RLS                                                                                     |
| Any patient page or action while consent is due                                              | redirect to `/patient/consent`; the action does not run                                         |
| A patient reading a staff cancel reason (row, phone, USSD)                                   | a code in the column, a fixed sentence on every surface                                         |
| Adding `reason_note` to a triage input, or a clinical word to a reason label                 | `npm test` fails (`tests/booking/clinical-firewall.test.ts`)                                    |
| A red button on a patient surface (`variant="emergency"`)                                    | `npm test` fails (`tests/design/red-reserved.test.ts`)                                          |

---

## 11. Accessibility and design spot checks

- **Keyboard only** through the web wizard: every step reachable; the day and time chips are reached with
  **Tab** (each is a button in an "Available days" / "Available times" list) and announce pressed / not
  pressed; the docked Book bar is focusable and never covered by the tab bar.
- **Screen reader** (VoiceOver / TalkBack) on the provider screen: the stats read "Patients: none yet" when
  empty; the action circles read their reason; the tiles read name, department, mode word, fee and soonest
  day in order.
- **Colour:** on the web nothing on a patient or reception screen is red — the emergency block is **amber** by
  decision (ADR 0084 §3); on the phone the only red is the Emergency tab and the emergency disc. Every status
  pill has words; a flagged line on the reports page is **amber with words**.
- **Targets:** every control ≥ 44 px (the window links, the chips, the consent checkbox).
- **Dark mode:** the toggle in the header (ADR 0087 C8 keeps it); the filled tile keeps full contrast.
- **Phone width** on the web: no horizontal scroll; the carousel keeps the first card whole.

---

## 12. Not testable yet (deferred by decision)

| Item                        | Why                                                                                                           | What would change                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Android push                | Firebase project + `google-services.json` + one dev build                                                     | `GATE-G-BUILD.md` §2 — free                        |
| iOS push                    | Apple Developer account                                                                                       | billing                                            |
| Live SMS to a real handset  | AT live credentials, sender ID / shortcode, wallet                                                            | billing                                            |
| `*/15` dispatcher cadence   | Vercel Pro                                                                                                    | billing (or Supabase pg_cron, free — ops-channels) |
| Payments in the app         | ADR 0092: the fee is stated, nothing is charged; PRD Part 8 #8/#14 are unresolved legal items; billing paused | a new ADR, not a switch                            |
| Booking a child at the desk | CSO + legal guardian model                                                                                    | PRD Part 8 #12                                     |

---

## 13. Dry run, 12 Nov 2026 — what broke and what is open

Walked as Sarah (patient), receptionistth1, clinicianth1 and adminth1 at Test Hospital-1, on
`fix/booking-dry-run`.

**Fixed on the branch**

| #   | Where                                     | What was wrong                                                                          |
| --- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| D2  | `/patient/visits/<id>` ticket             | the fee strip said "Not paid · Diabetes Clinic" (the line's name) instead of the amount |
| —   | `/reception/book?patient=<id>`            | 500: a bare `Date` inside raw SQL (`booking-options.ts`); now bound through `ts()`      |
| D3  | `/patient/visits/<id>`, an ended visit    | still showed the arrive note and "Getting there · Show code at the desk"                |
| D4  | after a clinic day is cancelled           | "Choose a day" opened a visit with no way to choose: the one-tap offer is back          |
| D6  | `/patient/book/day`, a doctor's time      | the live countdown threw a hydration error                                              |
| D8  | cancel a clinic day                       | the Why box emptied after "See who this affects", so the cancel could never be sent     |
| D9  | any staff action calling an Edge Function | a Supabase 520 printed the whole Cloudflare HTML page in the dialog                     |

**Needs an owner ruling**

| #   | What                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | "Something is wrong" is a dead end while the symptom catalogue is off. Sign Gate CS and set `FEATURE_SYMPTOM_CATALOG=1` for the pilot, or hide the door. Today symptoms can only be typed as a free note. |
| G3  | Five signed-in accounts → HTTP 431 on Node's default 16 KB header limit. Raise the limit where the app runs, or cap ADR 0280 at four.                                                                     |

**Seen, not fixed**

- The first real "Cancel the day" got a Supabase **520** after 43 s; the retry took 5 s and worked. The day
  stayed published in between, so nothing half-happened, but watch `ha-cancel-session` in the pilot.
- After ▶ Call, the doctor's queue did not move to NOW SEEING until a reload.
- **End visit was not walked in the browser.** With the EMR on, it sits on `/doctor/encounters/<id>`, and that
  page did not finish compiling under `next dev` on an 8 GB machine in 20 minutes. Walk it on the deployed
  app; the close itself is covered by `tests/doctor/end-visit.test.ts`.
- The phone's visit screen has the same two gaps as D3 and D4 (helpers exist in `mobile/src/lib/notifications.ts`,
  no screen uses them).
- "Next open day" on the Book page ignores the chosen reason (D5).
- Page titles repeat "MedSync" ("Schedule · Doctor · MedSync · MedSync"); a missing React `key` in
  `MedSyncCalendar`; the landing page's theme toggle has a hydration warning.

---

## Appendix — tidying up

- Test hospitals created through the RLS helpers are named `Test …` and are deleted by the suites' `cleanup()`.
  Do not name a real hospital that way on a project where those suites may run.
- The v1.1 consent row from §3.1 is a real supersession: leave it, or delete **only** on the dev project
  (`delete from consent_versions where version = 'v1.1'`, then the `consent_records` written against it).
- `sa_audit_log` is append-only. Everything you did as staff is in it, under `/admin/audit`.
