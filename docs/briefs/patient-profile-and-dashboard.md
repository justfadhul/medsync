# MedSync — the patient profile and dashboard (briefing for a Claude chat)

_Written 2026-09-23 from the code on branch `feat/booking-app` (head `aa1fe46`). Web is live at
**medsync-six.vercel.app**. This describes what exists today, not what is planned, unless a line says otherwise._

## 0. How to use this document

You are helping the product owner of **MedSync** think about, critique or redesign the **patient side**: the
patient's dashboard (home), their profile and account pages, and the flows those screens lead to. You cannot see the
code. The owner works with a separate coding agent (Claude Code) that has the repo; anything you propose goes back to
it.

- **The owner** is a founder-engineer who is also the Clinical Safety Officer (CSO). They drive UI by screenshot
  ("does this UI make you happy?" → rework), like one-viewport screens, and want honest facts only.
- **When you suggest a change**, name the screen by its route (e.g. `/patient/profile`, phone "Settings tab") and
  say whether it is web, phone or both. Check it against §9 (the rules) first — several obvious "improvements"
  (a notification bell, "you're probably fine", a red status chip, a guessed emergency number) are forbidden on
  purpose.
- **Do not invent data.** If a screen would need a field that §3 does not list, say the field is missing.
- File paths in this brief are for the coding agent; you can quote them back.

## 1. The product in one paragraph

MedSync is a role-based digital-hospital platform for Ugandan hospitals (internal medicine first; Mulago National
Referral Hospital is the beachhead). Staff surfaces cover reception, triage, nurses, doctors, hospital admin and a
super-admin. The **patient side** is an _access_ tool: pick your hospital, get seen today or ask for a day, see your
visits, track your own readings and doses, and reach emergency help in one tap. It is deliberately not a diagnosis
app — the only clinical-sounding thing a patient touches is an advisory symptom catalog (§8) that signposts a next
step and is still unsigned by the CSO.

## 2. Two clients, one backend

|                                            | Web (`app/patient/**`)                                            | Phone app (`mobile/`, Expo SDK 57)                                   |
| ------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| Stack                                      | Next.js 16 App Router, Server Components, Tailwind v4 + shadcn/ui | Expo Router, React Native, own UI kit in `mobile/src/components/ui/` |
| Signup                                     | Yes (`/signup/patient`, 3 steps)                                  | **No** — "Create account" opens the web in the browser               |
| Home                                       | `/patient`                                                        | Home tab                                                             |
| Profile editing                            | Full (`/patient/profile`)                                         | **Only the photo** (Settings tab); no profile screen                 |
| Self-tracking (readings, medicines, doses) | Yes (`/patient/track/**`)                                         | **No**                                                               |
| Visit detail page                          | No (visits list with anchors)                                     | Yes (`visit/[id]`), incl. rating a visit                             |
| Book at any hospital                       | No — web booking is primary-hospital only                         | Yes (ADR 0086)                                                       |
| Theme                                      | System / light / dark toggle in the header                        | "Same as phone / Light / Dark" in Settings                           |

Shared backend: Supabase Postgres with Row-Level Security on every table, Deno Edge Functions for privileged writes
(`pt-*` = patient), and zero-import shared modules (`supabase/functions/_shared/*`) used by Next, Deno and Expo alike
(symptoms, slots, fees, cancel reasons, the symptom catalog).

## 3. The patient's data

### 3.1 Identity — `patient_profiles` (1 row per account, keyed to `auth.users`)

| Field                                                             | Stored as                                                                      | Required             | Editable by the patient?                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------- |
| `patient_code`                                                    | `MS-YYYY-NNNNN` (e.g. `MS-2026-00042`), minted by the database, dense per year | auto                 | No                                                                              |
| First name, surname                                               | AES-256-GCM encrypted                                                          | yes                  | No (locked)                                                                     |
| Title (`mr/ms/mrs/dr/other`)                                      | plaintext                                                                      | no                   | Not shown anywhere                                                              |
| Sex (`male/female/intersex/prefer_not_say`), label "Sex at birth" | plaintext                                                                      | yes                  | No (locked)                                                                     |
| Date of birth                                                     | plaintext date (age is always derived, never stored)                           | yes                  | No (locked)                                                                     |
| ID type (`nin/passport/none`) + ID number                         | number encrypted; shown as last 4 only                                         | yes / if type ≠ none | No (locked)                                                                     |
| Phone                                                             | encrypted + HMAC blind index for lookup; Ugandan E.164 only                    | yes                  | **Yes** (web profile)                                                           |
| District, subcounty                                               | foreign keys                                                                   | district yes         | Not shown anywhere                                                              |
| Village / address                                                 | encrypted, ≤ 240 chars                                                         | no                   | **Yes**                                                                         |
| Preferred language                                                | free text, ≤ 40 chars                                                          | no                   | **Yes**                                                                         |
| Primary hospital (`primary_facility_id`)                          | FK to hospitals, nullable                                                      | no                   | **Yes**, on `/patient/hospitals` (web) or the Home picker / Today chips (phone) |
| Known conditions                                                  | plaintext text[], ≤ 24 items                                                   | no                   | **Yes** — used only to suggest what to log                                      |
| Next of kin: name, relationship, phone                            | name + phone encrypted                                                         | no (both or neither) | **Yes**                                                                         |

Also on `users`: `full_name` (plaintext "Name to display" from signup — a **second name source**, used by the menu and
greetings, not editable anywhere), `email`, `avatar_path` (photo), and `state` (`verified` at signup; the step to
`active` has not shipped, and phone OTP is not wired).

**Photo:** optional. Private `avatars` bucket, served by 1-hour signed URLs. Upload ≤ 8 MB, server resizes to a
512×512 JPEG. Shown to the care team who see the record. No "remove photo" control.

**Encryption & audit:** application-layer AES-256-GCM (`lib/encryption.ts`); encrypted columns cannot be searched.
Every write to the profile lands in an append-only `audit_log` via a database trigger. Staff never read the profile
through RLS; they use server code that enforces an access basis and writes `clinical_phi_access_log` (who viewed
which patient). Hospital admins see the code only. A patient-facing "who viewed my record" view does not exist yet.

### 3.2 The primary hospital

`primary_facility_id` means "where the patient usually goes". Signup does **not** ask for it (even though the step
heading says "home facility"), so every new patient starts with none and is sent to the hospital directory first.
It drives the home, the walk-in door, the emergency number shown, and web booking. The directory lists only active
hospitals, with a level label (National referral / Regional referral / District hospital / Health centre IV /
Health centre III / Private hospital) and "Accepting bookings" when a clinic day is open in the next 14 days.
Switching is one tap, no confirmation; it cannot be un-set.

### 3.3 Consent

- **Data processing** (required): the patient must have accepted the _current_ version of the notice (version + text
  hash). If not, every web page redirects to `/patient/consent` and the phone shows a consent gate that never fails
  open. The v1.0 text in force is literally a **placeholder pending counsel**; production signups are closed until
  the privacy notice, terms and data-protection registration are published.
- **SMS** (optional, unticked by default): "Send me SMS about my bookings" / "Confirmation, reminders and changes to
  your visits. No marketing." Turning it off shows the honest line: "Without SMS we can only reach you inside the app.
  People who turn this off miss visits more often. You will still get one SMS with the code each time you book."
  (CSO-provisional copy, byte-identical on web and phone.)
- No withdrawal of data-processing consent, no sharing controls, no data export or deletion yet.

### 3.4 Household ("People I book for")

A patient can add up to 20 **adults** they book for (a parent, spouse, adult child, someone they look after, a
relative, a village health worker, someone else). Each becomes a provisional identity (name + phone encrypted,
DOB or age). The booker sees **logistics only** for those visits: date, place, service (unless confidential), booking
code, status, position — never a reason, clinician or clinical content. Children are refused ("Booking for a child is
not available yet."). Members cannot be removed or edited yet.

### 3.5 Self-tracking (web only)

Private to the patient — no clinician can read it. Readings (glucose, blood pressure, weight, SpO₂, temperature,
symptom with severity 1–5, note), a medicines list with dose times, and taken/missed doses. Stored in plaintext.
Every surface says it is "not yet shared with a clinician". Medicine reminders are stored but not sent.

## 4. The web shell (every `/patient` page)

- **Header** (sticky, frosted, 52px): "MedSync" wordmark → `/patient`; a mono chip with the hospital name (hidden on
  phones); on the right a sun/moon theme toggle and "Sign out".
- **Navigation** (one list, two renderers): **Home · Track · Doses** (indented under Track) **· Visits · More**.
  Without a primary hospital: **Home · Visits · More**. Desktop: a left rail (icons at `md`, labels at `lg`) with
  "Your hospital: {name}. Change hospital" at the foot. Phones: a fixed bottom tab bar. While the consent gate is up,
  neither renders.
- **Active item colour is plum** (the "place" accent, ADR 0097) — never a left-edge bar.
- **Page width** ≈ 1200px, container queries decide the two-column layouts (a 20rem right column at wide sizes).
- **Emergency pill:** a red "Emergency" pill fixed bottom-right on every route (web root layout), linking to
  `/emergency`. Hidden on `/emergency/**`, and on the landing `/` and `/about`, whose header carries its own
  Emergency link. Pulses once on load (never for reduced motion). On `/patient` phones it sits above the tab bar.
- Error page: "This didn't load" / "We couldn't load this. Your data is safe." / "Try again" · "Back to home".

## 5. The web dashboard — `/patient`, top to bottom

First run: a patient with no primary hospital is **redirected to `/patient/hospitals`** ("Welcome, {first}." / "Pick
your hospital to see its clinics and book a visit. You can change it any time."). Everything below assumes a hospital.

1. **Header** — eyebrow "MedSync · Your space"; h1 **"Hello, {first name}."**; "{Hospital} is your hospital. Track how
   you're doing and see your visits."
2. **Symptom area** — one of two, decided by the catalog mode (§8):
   - _Catalog off_ → **"How are you feeling today?"** / "Tap what fits. You can add more when you book." Eight toggle
     chips (Chest pain, Breathlessness, Cough, Palpitations, Leg swelling, Abdominal pain, Headache, Fever — the first
     eight of the catalogue in its own order), a "More…" chip, and a "Book a visit" button once something is picked.
     Footer, verbatim and mandatory: "This is passed to the clinic as you wrote it. It does not change your place in
     line or your time." Picks carry into the booking wizard.
   - _Catalog on_ → **"What's wrong?"** / "Tell us what you feel or see, and we will say how soon to be seen." An
     amber watermark while unsigned ("Unsigned clinical content — for review only, not signed by the clinical safety
     officer."), a 2×2 strip of adult danger signs (amber tiles, each opening the catalog on that item), "All danger
     signs (n)", and a "What's wrong? Tell us" button.
3. **The two doors** (ratified copy — do not paraphrase), unequal, labels not icons, no counts:
   - Primary: **"Coming to the hospital today"** / "We cannot tell you the hour." → `/patient/queue`
   - Secondary: **"Ask for a day — the clinic confirms"** / "Choose from the days the clinic has open." → `/patient/book`
4. **Hero card** — one saturated teal card, whole card is a link. Priority: next visit (clinician, department ·
   hospital, status, date, "Morning session"/"Afternoon session", "See your visits") → doses today ("3/4 doses recorded
   today", "Open your dose timeline") → "Start with one reading" ("Log a reading").
5. **Discovery** — "Let's find your doctor" with a search box ("A clinician, a department, a clinic", filters what is
   already on the page); "Your clinicians" carousel (photo or monogram, name, department, "★ 4.5 · 12 reviews" or
   "No ratings yet", "Next open {date}", "Seen you before"); "Find care" clinic tiles (mode, fee in UGX, "You pay at the
   hospital, not in the app. Waivers may apply — ask at the desk.", "Soonest {date} · n places left").
6. **"Today's doses"** (hidden when the hero already shows doses) — "{taken}/{total}", next dose, or "Nothing scheduled
   today".
7. **"Upcoming visits"** — up to 3 rows (clinician, status pill, department · In person/Virtual, "Tue 23 Sep · Morning
   session"); empty: "Nothing yet. A visit you have asked for shows up here." Same-day queue tickets do **not** appear
   here.
8. **"Recent readings"** — up to 3; empty: "Nothing logged yet. A glucose, blood-pressure or weight reading takes a
   moment."
9. **"Quick actions"** (right column when wide) — "Log a reading"; "{Hospital} · Your hospital — change it here".

Not on the web home: the patient code, the patient's photo, any queue/ticket state, notifications.

## 6. The web profile and account pages

### 6.1 More — `/patient/menu`

h1 = the display name (or email), plum monogram (the photo is not shown here). Rows: **Hospitals** · **Profile**
("Contact, next of kin, language") · **People I book for** · **Settings** ("Appearance and language") ·
**Consent & sharing** ("Soon") · **My care** ("Soon"). "Sign out" button.

### 6.2 Profile — `/patient/profile` ("Your profile")

"Identity details stay locked — change them through support. Contact, language, and conditions are yours to edit any
time." Back link "Back to More". Two columns when wide (form left; Photo + Identity in a sticky right column).

- **Photo** — upload + "Save photo".
- **Identity** (badge "Locked") — Patient code (mono), Date of birth (DD MMM YYYY), First name, Surname, Sex, ID
  ("National ID (NIN) · ⋯1234" or "Not on file"). Footnote promises "a request flow lands here soon" — **that flow is
  not built**.
- **Contact** — Phone (+256 fixed prefix), Village / address, Preferred language (suggests English, Luganda, Swahili,
  Runyankole, Lusoga, Acholi, Lugbara).
- **Health** — Known conditions ("Comma-separated. We use this to suggest what to log on the Track tab.").
- **Next of kin** — name, relationship (Spouse / Parent / Child / Sibling / Guardian / Friend / Other), phone; both or
  neither.
- One docked **"Save changes"** bar → "Saved.". Last redesigned 2026-09-13 — it has **not** had the recent UI pass.

### 6.3 Settings — `/patient/settings`

"What you can change today. The rest is listed below, unbuilt." Rows: Theme ("Saved on this device only"), Language
(read-only here, "Change" → profile), SMS about your bookings (On/Off + "Turn off/on"). "Coming next": two-factor
sign-in (optional for patients), download a copy of your data.

### 6.4 Other account pages

- **Consent & sharing** `/patient/consent` — shows the accepted notice version and "Your self-tracking is private";
  everything else is a "Coming next" list (hospital access, per-clinician access, caregiver invitations, revoke with
  audit).
- **People I book for** `/patient/household` — "Adults you book visits for. You see the date, the place and the code —
  never their care." List, "Add someone" form, "Visits you booked for them".
- **Hospitals** `/patient/hospitals` — search ("Hospital, clinic or district"), cards, "Make this my hospital"; the
  current one is tinted with "Your hospital" and shows the two doors.
- **My care** `/patient/care` — an honest placeholder: "Nothing from {hospital} reaches this page yet — the clinical
  module hasn't shipped." **No clinical data reaches the patient today.**
- **Clinician page** `/patient/clinician/[id]` — photo or monogram, cadre · department, facts only when true ("New on
  MedSync" / "N yrs on MedSync", "N patients", rating, "Video visits", "Seen you before"; years of career experience are
  deliberately absent), a day strip + time grid, the fee, and "Book this time".

## 7. Flows the dashboard leads to (web, briefly)

- **Visits** `/patient/appointments` — "Your visits": Upcoming / Past. Cards show booking code (mono), fee, position
  and arrival window for clinic days, "I have arrived" (on the day), "Confirm I'm coming" (within 24 h), "Move this
  visit" (sheet, reason ≥ 8 chars), "Cancel visit", waitlist offers ("A place has opened" → "Take this place"), and a
  one-tap rebook when the clinic cancels a day. Status words: Requested, Awaiting approval, Confirmed, You've arrived,
  In progress, Completed, Cancelled, Missed, Rescheduled, Declined — never red.
- **Ask for a day** `/patient/book` — one decision per screen: (who, if household) → reason (13 administrative reasons,
  never symptoms) + optional symptoms with a duration each + note → a "Booking is for care that can wait." interstitial
  for "New or worsening problem" → clinic → day and time (or clinic day with "n places left") → check → receipt with a
  6-character booking code. Waitlist when nothing is open.
- **Coming today** `/patient/queue` → ticket `/patient/queue/[id]` — "We save your place in line. You will be seen in
  turn. We cannot tell you the hour." Ticket states: place saved → in the line ("n ahead of you", only once physically
  present, with "Sicker people are seen first, so this number can go up as well as down.") → seen by the nurse.
- **Track** `/patient/track` — "Day to day": doses, medicines, readings; "Only you can see this".
- **Symptom catalog** `/patient/symptoms` — see §8.
- **Emergency** `/emergency` — one page: "Get help now", the verified numbers (or "Go to the nearest emergency unit"
  when none is verified), and beside it "Tell a hospital I'm coming" (a pre-alert form). Follows the site theme; Close
  returns to the page the pill was pressed on.

## 8. The symptom catalog and the Emergency Pathway (ADR 0098 — provisional)

A lay-language catalog (109 items in 12 categories) sorts what the patient picks into three advisory tiers:
**Get help now** (emergency → interrupt + Emergency page), **Be seen today** (earliest slot today, else today's
queue), **Book a visit** (the booking wizard). Deterministic rules, monotonic (adding a symptom never lowers the tier),
free text never changes the tier, no diagnosis, no reassurance. Hospital triage always re-assesses.

- **Gates:** production shows the catalog only if the flag is on **and** the CSO has signed the exact content
  version (checksum). Unsigned, it can be shown under the "Unsigned clinical content" watermark in non-production mode.
- **At the time of writing** the owner has switched medsync-six into review mode: the draft catalog shows
  watermarked, the pre-alert form is on, and unverified emergency numbers show in a dashed "not yet verified" strip.
  Nothing is CSO-signed; no emergency number is verified; no hospital accepts pre-alerts yet.
- Web catalog screens and the emergency interrupt are still **forced light**; the Emergency page follows the theme.

## 9. The rules (read before proposing anything)

### Clinical safety

- The patient side is an **access** tool. No diagnosis, **no reassurance** (never "not serious", "you can wait",
  "probably fine"), no drug names, doses or numeric thresholds in patient copy.
- Booking reasons are administrative; symptoms are **words for the clinic only** — never ranked, scored, sorted,
  coloured or used to route (except the signed catalog's tiers). No severity scales, no "how bad", no default duration.
- Free text is stored and shown to the clinician, never parsed.
- **No fabricated data**, ever: no guessed emergency number (the most dangerous fabricated datum in the product), no
  seeded ratings, no stock faces, no "popular" rankings, no made-up estimates.
- No clinical content reaches the patient app yet (governance gate). Self-tracking is private and never implies a
  clinician is watching.

### What the patient may and may not see

- **Allowed** (ADR 0085 reversed earlier bans): doctor photos (real only; else a monogram), star ratings (real only;
  else "No ratings yet"), clock times beside the day ("Thu 18 Sep · 9:30 AM"), open-place counts.
- **Never:** wait estimates for the queue, scarcity pressure ("3 people viewing", countdowns), years of experience,
  a "checkout" or cart, staff-typed cancel reasons (only fixed sentences), a notification bell (there is no inbox),
  video-call buttons, bookmarks, share.
- Queue position only on the ticket, only once the patient is at the hospital.
- Fees are information only ("You pay at the hospital, not in the app." + "Waivers may apply — ask at the desk."),
  never a sort key, filter or badge; "premium", "cheapest", "recommended" are banned.

### Visual (DESIGN-medsync.md is authoritative)

- **Teal = action** (buttons, links, focus). **Plum = place** (active nav, avatars, "where you are") — never a
  button, chip or state. **Red = genuine emergency only** — the pill, the emergency call, the emergency interrupt;
  never cancellations, errors or no-shows. Amber = caution, green = stable, grey = pending.
- **Never colour alone** — every pill and state carries words. **No left-edge accent bars.**
- Headings weight **500**, never bold. Display font Fraunces, body Geist.
- Motion: one easing curve, 100/150/250/400 ms only, 40 ms stagger, **no decorative animation**, respect reduced
  motion. The phone adds nothing new: press = opacity.
- Both themes supported (dark mode shipped). Only the symptom catalog and its interrupt stay forced light.
- Mobile-first, one set of responsive components; tap targets ≥ 44 px (≥ 48 on catalog screens); no horizontal
  carousels for anything the patient must not miss (day chips).
- Copy is frozen: existing patient sentences stay byte-identical unless the owner ratifies new ones. The door labels,
  the symptoms note and the SMS consent lines are ratified/CSO copy.

### Ugandan context

- Luganda and Swahili count hours from dawn ("ssawa bbiri" = 8:00 am), so a time always sits beside its day;
  queues use "Morning session" / "Afternoon session". All times in the Kampala zone.
- Data is expensive: one request per action, small pages (≤ 370 kB JS per patient route), an offline shell.
- Phones are often shared: labels are not first-person ("Coming to the hospital today", not "I am coming"), and
  confidential services are never named in SMS.
- Most people have feature phones: SMS and USSD exist beside the app; the app is the minority channel.
- English only at launch; a language ships whole or not at all; no machine translation.

## 10. The phone app

- **Welcome** — "Book your visit. Keep your place.", "Create account" (opens the web), "I already have an account";
  a red Emergency disc works signed out.
- **Tab bar** (floating pill): **Home · Visits · Emergency** (red, "the one red thing in the app") **· Settings**.
  The current tab's chip is plum. The two doors are not tabs.
- **Home tab** — top strip: "MedSync", hospital name, the patient's photo (opens Settings); no bell. Greeting "Good
  morning/afternoon/evening, {first}" on the hospital's clock. New patient → "Choose your hospital" picker. Then
  **"How are you feeling today?"** with the shortlist (or the catalog entry), a **"Coming up"** hero only when
  something is in motion (a live ticket — "Your place today", patient code, stage — or the next visit with
  "I have arrived" / "See this visit" / "Move it"), **"Get seen"** (the two doors), "Let's find your doctor" search,
  **"Doctors"** carousel with department chips, **"Find care"** clinic grid.
- **Visits tab** — "Your visits", Upcoming / Past chips, waitlist offers on top, each row with code and position.
- **Visit detail** — hero, "Move this visit", "Cancel visit", "Confirm I'm coming", booking code card, and
  **"Rate this visit"** after an attended visit (web has no rating).
- **Settings tab** — the only "profile" on the phone: photo, name (read-only), "Patient code {code}", **"Change
  photo"** (the only editable field), People I book for, push and SMS toggles, Appearance, Sign out.
- **Today / Ticket** — the "Coming to the hospital today" door; picking another hospital's chip changes the primary
  hospital. The phone ticket shows **no** "n ahead of you" count (web does).
- Gaps specific to the phone: no signup, no profile editing, no self-tracking, "Forgot your password?" does nothing,
  sessions stored unencrypted on the device.

## 11. Known gaps and inconsistencies (good material for improvement ideas)

1. **Two name sources** — `users.full_name` (greeting, menu) vs encrypted first name + surname (profile); neither is
   editable, and they can disagree.
2. **Locked identity with no way to fix it** — "request a change" is promised on the profile but not built. The lock
   is enforced in app code only, not by the database.
3. **Signup promises a "home facility" but never asks** — every new patient hits the directory first.
4. **District/subcounty and title** are stored but shown nowhere; the patient cannot see or correct them.
5. **The web home shows no queue state** — after "Coming to the hospital today", nothing on the home reflects the
   ticket (the phone's hero does).
6. **Time format is inconsistent on web** — visit lists say "Morning session"; the wizard, arrival windows and SMS use
   "9:30 AM"; ADR 0085 says lists should show clock times too. Readings and doses use a 24-hour clock and the server's
   time zone (no patient time-zone column).
7. **Web booking and the clinician page work only at the primary hospital**; the phone can book anywhere.
8. **No fee on the web booking check/receipt**, although ADR 0092 lists the receipt.
9. **Photo** — no remove option; the web More menu shows a monogram even when a photo exists.
10. **Household** — no remove/edit; adults only; members who already have accounts cannot be linked.
11. **Placeholders** — Consent & sharing, My care, two-factor sign-in, data export, "who viewed my record".
12. **The profile page, and the phone's Settings/Visits/Ticket/Today screens, have not had the recent UI pass.**
13. **Reminders are not production-grade** — SMS is sandbox-only, the dispatcher runs daily, iOS push is not set up,
    there is no in-app notification centre.
14. **Stale rulebook** — `docs/booking-app-build/REFERENCE-LANGUAGE.md` still bans photos, ratings and clock
    numerals that ADR 0085 re-allowed; the PRD still says "light-only" though dark mode shipped.
15. **Scope check** — a signed-in user with no patient profile row can reach `/patient` (then gets bounced to the
    directory and a profile error); the phone handles this case explicitly.

## 12. Current state and history

- **Live:** migrations through **0066** applied; all Edge Functions and the web deployed (latest deploy 2026-09-23,
  `aa1fe46`). Deploys are made from the local working tree, so a concurrent, not-yet-committed "plum" restyle
  (ADR 0097) is also live.
- **Provisional until the CSO re-reads them:** ADR 0095 (symptoms at booking), 0096 (the shortlist), 0098 (catalog
  - Emergency Pathway). Catalog v0.1 is `draft`; emergency numbers (112, 999, 912, KCCA) are seeded unverified.
- **Deferred on purpose:** payments (MedSync charges nothing), live SMS, push, booking for children, translations.
- **How the dashboard got here:** May 2026 first patient workspace (profile editor, self-tracking, hospital
  directory) → Sept 12–13 rebuild + the Expo app + photos/ratings/clock times (ADR 0085) → Sept 19 web home brought to
  the phone's presentation (doctor cards, clinic tiles, search), fees, consent re-acceptance → Sept 20–21 owner's UI
  pass (new patients land on the directory, one screen per page) → Sept 21 symptoms at booking and the shortlist →
  Sept 22–23 symptom catalog, the red Emergency pill, the one-page Emergency screen.

## 13. Glossary

- **Primary hospital** — the patient's usual hospital (`primary_facility_id`).
- **Patient code** — `MS-2026-00042`, the patient's identifier. **Booking code** — 6 characters, one per visit.
- **The two doors** — "Coming to the hospital today" (same-day queue) and "Ask for a day — the clinic confirms"
  (booking).
- **Clinic day / session** — a day with a position and an arrival window, not an exact time. **Slot** — an exact time.
- **Ticket** — the same-day queue place: place saved → in the line → seen by the nurse.
- **Household / booking agent** — a patient booking for other adults; provisional patients are those without accounts.
- **Tiers** — Get help now / Be seen today / Book a visit. **Gate CS** — CSO signs clinical content. **Gate CG** —
  the owner switches clinical features on in production.
- **CSO** — Clinical Safety Officer (the owner). **ADR** — a numbered, immutable decision record.
- **Plum / teal / red** — place / action / emergency.
