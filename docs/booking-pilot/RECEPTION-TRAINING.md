# Reception training: a one-hour session

For the owner to run with the front-desk staff of one pilot clinic. Screen names and routes were read from
the app code on `origin/main` (12 Nov 2026). If a screen on the day looks different, trust the screen and
note it.

Anything in `[brackets]` is for you to fill in before the session. Nothing here is invented.

## Before the session

- The clinic is set up and live ([CLINIC-SETUP.md](CLINIC-SETUP.md), steps 1 to 10).
- **Branch `fix/booking-dry-run` is merged and deployed.** Without it, three things in this script break:
  **Book for this patient →** gives a 500 error (Block 6), the clinic admin cannot send **Cancel the
  day** because the **Why** box empties (Block 7), and a cancelled clinic day leaves the patient no way to
  choose a new day (Block 7).
- Every trainee has **their own approved reception account** and has already done MFA setup once. If not,
  do it in the first ten minutes and cut Block 2 short.
- Each pair has one computer, plus each trainee has their phone with the authenticator app.
- You have this test data ready (from CLINIC-SETUP step 12):
  - **Test patient A**: an account with a patient code. Name: `[test patient A]`.
  - **Two bookings for today** for test patient A and one more test patient: both **Confirmed**.
  - **One booking** that is not confirmed yet (turn auto-confirm off for one clinic, or book a request).
- Print the cheat sheet (last page) for everyone.
- Fill in: support number `[support number]`. Owner number `[owner number]`. The clinic's own emergency
  rule `[clinic emergency rule]`. Whether SMS is on `[SMS on: yes or no]`.

How the script works:

- **Say** = say it in your own words.
- **Do** = they do it on their screen.
- **Check** = what they should see.
- **Heads-up** = something in the app that is odd. Say it out loud so it does not surprise them.

---

## Block 1: The picture (0:00 to 0:05, 5 min)

**Say:**

- "A patient books a visit on their phone, or you book it for them."
- "On the day, they show up on your **Expected** screen."
- "You tap one button. That checks them in **and** sends them to triage or to the clinic."
- "You never see what is wrong with a patient. You see who, when, and where to send them."
- "Every name you open is recorded against your account."

**Draw on a board:** Book → Expected → Send on → Triage or Clinic queue.

---

## Block 2: Sign in with MFA (0:05 to 0:15, 10 min)

**Screens:** `/sign-in`, then `/sign-in/mfa`. First time only: `/onboarding/mfa-setup`.

**Say:** "MFA means two steps. Your password, then a 6-digit code from your phone. The code changes every
30 seconds or so."

**Do, one trainee at a time:**

1. Open `/sign-in`. Type **Email** and **Password**. Tap **Sign in**.
2. The screen says **Enter your authentication code**. Open the authenticator app. Type the 6 digits.
   Tap **Verify**.
3. You land on **Today** (`/reception`).

**First time only:** the screen says **Set up two-factor**. Scan the QR code. Type the 6 digits in
**Authenticator code**. Tap **Activate two-factor**.

**Check:** the top bar shows the clinic name and **Reception · non-clinical**. The left bar shows
`MFA · AAL2` under their name.

**Also show:**

- **Switch account** and **Sign out** (top right). On a shared computer: **sign out when you finish**.
- Keep to four accounts in one browser. At five, pages may fail with error 431 (seen in testing).
- Wrong code: type it again. Codes expire fast. Wait for a fresh one.

**Heads-up:**

- **There is no password reset.** If you forget your password, you cannot fix it yourself. Call
  `[support number]`.
- **Lost phone.** The clinic admin resets your MFA (**Staff** → **Directory** → your name → **Reset MFA…**).
  You set it up again.
- Three names for one thing: **two-factor** (setup screen), **two-step sign-in** (waiting page),
  **Authentication code** (sign-in box). They are all MFA.

**Quick test:** "Where do you get the 6 digits?" (The authenticator app, not an SMS.)

---

## Block 3: Read the Expected screen (0:15 to 0:22, 7 min)

**Screen:** left bar → **Expected** (`/reception/expected`). The page title says **Expected patients**.
The **Today** screen calls the same place **Check in**.

**Heads-up:** one screen, four names. Left bar: **Expected**. Today tile: **Check in**. Page title:
**Expected patients**. Say "the Expected screen" all session.

**Walk the screen top to bottom:**

1. **The week strip.** Pick another day to read its bookings. Other days are a record. You can check in
   only today's patients.
2. **Here — needs sending on.** Patients who tapped "I have arrived" on their phone. They are waiting.
   Send them on first.
3. **The table.** Columns: **Patient**, **How booked**, **Booked at**, **Due**, **Status**, then the buttons.
   - The list is in the order people **booked**. It does not change when someone calls out.
   - **Due** reads `No. 4 · from 09:30` (their number and when their window opens) or a plain time.
   - Under the name you see the booking code and clinician, in small grey text.
4. **Status words:** **Confirmed**, **Awaiting approval**, **Requested**, **Arrived**, **Cancelled**,
   **No-show**. Plus **Coming today** (a patient who said they are coming, with no booking).
5. **Tags under the status:** **Patient confirmed**, **Urgent booking**.
6. **The queue box on the right.** Who is in the line now.

**Other words on a row and what to do:**

| You see                                          | It means                                    | You do                               |
| ------------------------------------------------ | ------------------------------------------- | ------------------------------------ |
| **Send to triage** and **Send to clinic**        | A confirmed booking, ready                  | Check them in. See Block 4.          |
| **Not confirmed yet**                            | The clinician has not confirmed it          | Ask the clinician. Do not send on.   |
| **Identity to confirm** and **Confirm identity** | A "new caller" booking. Who is it?          | Tap **Confirm identity**. See below. |
| **Register at the desk**                         | The match was rejected                      | See Block 5.                         |
| **Video visit**                                  | A video visit. No door to send them through | Nothing.                             |
| **No-show…**                                     | Their time has passed                       | See "No-show" in Block 4.            |

**Confirm identity (one minute).** Candidates are shown only if the **phone matches**, or the **name and year
of birth** match. Each has a reason in words. Tap **Confirm** on the right person. Or **Not this person**.
Nothing is chosen for you.

**Say:** "Ask for the **name**. The code from the app may be on a phone at home."

**Check:** the page refreshes by itself. A new booking appears without you doing anything.

---

## Block 4: Check in a booked patient and send them on (0:22 to 0:32, 10 min)

**Screen:** **Expected**.

**Do, with test patient A:**

1. Find the patient's row. Ask for their name.
2. Look at the **department** box above the buttons. It already shows the booked clinic. Change it only if
   told to.
3. Tap **Send to triage**. (The big button.)
4. The row shows **Sent to triage**. They are in the triage line.
5. Do it again for the second test booking. This time tap **Send to clinic**. The row shows **Sent to clinic**.

**Say:**

- "**One tap does both**: it checks them in **and** sends them on. There is no separate check-in button."
- "**Triage is the default.** It is the big button."
- "**Send to clinic** skips triage. Use it only when `[clinic rule for when to skip triage]`."
- "**Urgent always goes to triage.** If a row says **Urgent booking**, it goes to triage whichever button you
  press. Press **Send to triage** anyway. The patient should not wait."
- "Triage or clinic is a **desk choice**, never a medical one. If you are unsure, triage."

**Heads-up:**

- If the tap fails, a short message shows under the buttons. Read it out loud. It usually says what is
  wrong (for example "not confirmed").
- **Urgent can only be practised by reading.** A booking becomes urgent only from the symptom checker,
  and that is off in production today. The rule is built into the system and tested, but you cannot
  click it in class. `[owner: G1 ruling on the symptom checker]`

**No-show.** If the booking time has passed and they did not come: tap **No-show…**. Type a reason (at least
8 characters, for example "did not arrive; called, no answer"). Tap **Mark no-show**.

**Check:** on **Today**, **Arrived** goes up by one for each patient you sent on.

---

## Block 5: Register a walk-in (0:32 to 0:40, 8 min)

**Screen:** left bar → **Register** (`/reception/intake`). The page title says **Front door**.

A walk-in is someone with no booking.

**Do, with a test patient who has a patient code:**

1. Under **How is the patient arriving?** tap **Walk-in (non-emergency)**.
2. Under **Patient**, type the first 3 or more characters of the **patient code**. Pick the match.
3. **Presenting complaint:** tap the symptom chips. Or type **In their words (optional)**. Triage will
   refine it.
4. **Where and what:** choose **Receiving department**. Fill **Entry door** if it asks.
5. Type the **Audit note** (at least 8 characters): "Walk-in at front desk".
6. Tap **Register intake**.

**Check:** "Intake registered. Awaiting triage." The patient waits for triage.

**Say:**

- "A walk-in always waits for **triage**. There is no **Send to clinic** here."
- "If someone looks **very unwell**: call a nurse first. Screen second. `[clinic emergency rule]`."
- "For an emergency the form has its own chips: **Emergency self-presentation** and **Emergency referral**.
  They need very little. If you do not know who they are, tap **Unknown / John Doe** and describe them. The
  receiving unit is alerted."

**Other chips you will see:** **Booked appointment arrival**, **External referral (routine)**,
**Inter-facility transfer (incoming)**, **Return / follow-up**, **Program / recurring clinic**. For a
booked patient, prefer **Expected** (Block 4).

**Heads-up. This is the biggest gap for a clinic.**

- **A walk-in must already have a MedSync patient code.** The form finds people by code only. A person with
  **no MedSync account** cannot be registered here. (Only the emergency chips allow "Unknown".)
- What to do today: **help them make an account on their own phone** (`/signup/patient`, with an email and a
  password of 12 or more characters), then register them. Or, once they have an account, they open the
  app and tap **Open now · Come to the hospital today**. They then show on **Expected** as **Coming
  today**, and you tap **Send to triage**. Either way they need an account first.
- Also: the booking code (6 letters and numbers on a visit) is **not** the patient code. **Register** and
  **Find** want the **patient code**.
- `[owner: decide how a clinic handles a patient with no account, before the pilot]`.

**Find a patient (one minute).** Left bar → **Find** (`/reception/find`). Type a surname (people on today's
board) or a patient code (any record, 3 or more characters). Each hit has **Register an entry**.

---

## Block 6: Book a visit for a patient (0:40 to 0:47, 7 min)

**Screen:** left bar → **Book** (`/reception/book`). Title: **Book a visit for a caller**.

**Do:**

1. In the search box ("Patient code, or phone (07XX XXX XXX)") type a code or a phone. Tap **Book for this
   patient →** on the right person.
   No record? Tap **New caller**. Type **Name as given**, **Phone**, and **Date of birth** (or **or age in
   years**).
2. **Why are they coming?** Pick the reason. Add **What is bothering them** if they say.
3. **Which clinic?** Pick one.
4. **Which clinic day?** Pick a day. (Timed clinics say **Which day and time?**.)
5. **Check before booking**: read the summary aloud to the caller.
6. Tap **Book a place** (or **Book this time**).

**Check:** the screen says **Place booked**, with **Booking code — read it out**, **Position**, and **Arrive
between**.

**Say:**

- "**Read the code out and write it down for them.** Write down the day and the window too."
- "The code is texted to the phone you typed. `[SMS on: yes or no]`. Do not promise a text unless SMS is on."
- "A **New caller** booking says **Identity to confirm**. You confirm who it is when they arrive (Block 3)."
- "Under 18 is refused: **Booking for a child is not available yet.** That is the rule for now. Tell the
  carer the clinic will `[clinic rule for children]`."
- "The app **does not take money**. The clinic collects the fee at the desk. The fee shown is `[fee]`."

**Heads-up.** On **Which clinic day?**, a day with no clinician named cannot be booked. If a clinic looks
empty, ask the admin to name a clinician.

---

## Block 7: Cancel or move a visit, cancel a clinic day (0:47 to 0:53, 6 min)

**Say first, plainly:** "**Reception cannot cancel or move a booking.** The screen has no button for it.
Here is who can."

| Job                                           | Who can do it             | How                                                                                            |
| --------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------- |
| Cancel one visit                              | **The patient**           | App: **Visits** → the visit → **Cancel** → a reason (8 or more characters)                     |
| Cancel one visit                              | **The clinician**         | `/doctor/schedule` → tap the booking on the calendar → **Cancel…**                             |
| Move one visit (timed, **slot** clinics only) | **The patient**           | App: **Visits** → the visit → **Move it** → a new day and time → a reason. It gets a new code. |
| Cancel a whole clinic day                     | **The clinic admin only** | See below                                                                                      |
| Say the patient did not come                  | **You**                   | **Expected** → **No-show…**                                                                    |

**A numbered clinic-day booking cannot be moved.** The system refuses it. Cancel it and book again.

**If the patient is at the desk with a phone:** help them cancel or move it on their phone. Sit beside them.

**If the patient has no phone or no app:** `[owner decision: today the desk cannot do this]`. The workable
way: **book the new visit** for them (Block 6), then ask the **clinician** to cancel the old one in their
schedule. Tell the patient their old code is cancelled and the new code is the one to use.

**Cancel a clinic day: the admin's job.** Reception does not do this. You call the clinic admin. They do:

1. `/hospital-admin/scheduling` → **Next 14 days** → tap the day.
2. **Cancel this clinic day**. Type **Why** (at least 10 characters).
3. Tap **See who this affects**. It says how many patients hold a place.
4. Tick "I have read the number above and want to cancel this day."
5. Tap **Cancel the day (N affected)**.

What happens next: patients get a notice "Clinic day cancelled · Choose a day". In the app they get one tap
to **Book** the next day, or **Choose another day**. (Both need branch `fix/booking-dry-run` live.)

**Your job when a day is cancelled:**

- Tell the admin right away, before patients arrive.
- Patients with the app see the notice. **Patients without the app: call them** `[owner decision: who calls
and from which list]`.
- If the screen shows a long error or "520" when the admin cancels, the day is **still open**. Wait a few
  seconds. Try once more.

**Running late.** The admin can instead tap the day → **Late by (minutes)** → **Set**. Windows move. A
message goes to patients only when the move is 30 minutes or more.

---

## Block 8: When something fails (0:53 to 0:58, 5 min)

**Say:** "Most problems are small. Read the message on the screen. Then use this table."

| What you see                                | Do this                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Short message under the **Send to** buttons | Read it. Fix what it says. Try once more.                                                    |
| A long error, or "520"                      | Wait a few seconds. Try **once** more. Then call `[support number]`.                         |
| Everything says "401" or "not allowed"      | Sign out. Sign in with a fresh code.                                                         |
| The patient is not on **Expected**          | Today only. Is it today? Is the booking **Confirmed**? Search by name. Then check **Find**.  |
| Row says **Not confirmed yet**              | The clinician has not confirmed it. Ask them.                                                |
| Patient says "my booking was cancelled"     | Ask them to look in **Visits** in the app. If the clinic day was cancelled, tell the admin.  |
| Pages will not load, or the Wi-Fi is down   | Use the paper back-up `[clinic's paper back-up]`: name, phone, reason, time. Enter it later. |
| Wrong code at sign-in                       | Try a fresh code.                                                                            |
| Forgot password                             | There is no reset. Call `[support number]`.                                                  |
| Lost phone                                  | Ask the clinic admin to **Reset MFA…**. You set it up again.                                 |
| Screen looks wrong, or you are not sure     | Do **not** guess. Call `[support number]`. Write down the time and what you saw.             |

**Say:** "When you call, say: your name, the clinic, the screen name, and the words on the screen."

**Never:**

- Never share your password or your 6-digit code. Not with a colleague, not with support.
- Never use someone else's account.
- Never write a patient's details anywhere but the system and the clinic's own paper back-up.

---

## Block 9: Close (0:58 to 1:00, 2 min)

**Ask three questions:**

1. "A patient is **Urgent booking**. Which button?" (**Send to triage**. It goes there anyway.)
2. "A patient wants to **cancel**. Can you?" (No. They do it on their phone, or the clinician does.)
3. "Where do you get the 6 digits?" (The authenticator app.)

Give out the cheat sheet. Put `[support number]` on it in pen if it is not printed.

---

<div style="page-break-before: always"></div>

# Cheat sheet: reception

Keep it at the desk. `Support: [support number]`

## Sign in

1. `/sign-in`: **Email**, **Password**, **Sign in**.
2. **Enter your authentication code**: 6 digits from your authenticator app, **Verify**.
3. Done when you see **Today**. Always **Sign out** on a shared computer.

No password reset: call support. Lost phone: ask the clinic admin to **Reset MFA…**.

## The left bar

| Tap          | For                                                  |
| ------------ | ---------------------------------------------------- |
| **Today**    | The day's counts                                     |
| **Incoming** | Patients on their way                                |
| **Expected** | **Check in.** Booked patients. Send them on.         |
| **Register** | A walk-in or an emergency (a patient code is needed) |
| **Book**     | Book a visit for a caller                            |
| **Find**     | Find a patient: surname (today) or patient code      |
| **Flow**     | Who is where today                                   |

## Check in a booked patient

1. **Expected** → find the name. Ask for the name, not the code.
2. Tap **Send to triage** (default), or **Send to clinic** `[only when: clinic rule]`.
3. You see **Sent to triage** or **Sent to clinic**. Done. One tap checks in and sends on.

**Urgent booking** always goes to triage. Press **Send to triage**.

| Row says                   | Do                                      |
| -------------------------- | --------------------------------------- |
| **Not confirmed yet**      | Ask the clinician. Do not send on.      |
| **Identity to confirm**    | **Confirm identity**. Match the person. |
| **No-show…** (time passed) | Reason, then **Mark no-show**           |

## Walk-in

**Register** → **Walk-in (non-emergency)** → patient code → complaint → **Receiving department** → **Audit
note** → **Register intake**. They wait for triage.

Very unwell? Call a nurse first. `[clinic emergency rule]`
No patient code? Help them sign up on their phone, or they tap **Come to the hospital today** in the app.

## Book for a caller

**Book** → search code or phone → **Book for this patient →** (or **New caller**) → reason → clinic → day →
**Check before booking** → **Book a place**.
**Read the code out. Write it down for them.** Under 18: not available yet. The clinic takes the fee at the
desk.

## Cancel or move

**You cannot.** The patient does it in the app (**Visits** → **Cancel**, or **Move it** for timed visits).
Or the clinician does it (**Cancel…** on their schedule). A **whole clinic day**: only the clinic admin.
Tell them at once.

## When it fails

- Read the message. Try **once** more.
- Long error or "520": wait a few seconds, try once.
- "401": sign out, sign in with a fresh code.
- Not sure? **Do not guess.** Call `[support number]`. Say your name, the clinic, the screen, the words.

**Never** share your password or your 6-digit code.
