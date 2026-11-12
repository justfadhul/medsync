# Clinic setup: one pilot site, step by step

For the owner. Use it on site, in order, once per clinic.

Every screen name and route below was read from the app code on `origin/main` (12 Nov 2026). Where the
app is confusing or has a gap, a **Heads-up** box says so.

## Who does what

- **Owner** = you, signed in as superadmin.
- **Clinic** = the clinic's own person, on their own device. You sit beside them.
- Anything in `[brackets]` is for you to fill in on site. Nothing here is invented.

| #   | Step                               | Who            | Screen                                                                           |
| --- | ---------------------------------- | -------------- | -------------------------------------------------------------------------------- |
| 0   | Before you go                      | Owner          | `GO-LIVE.md`                                                                     |
| 1   | Clinic applies                     | Clinic         | `/signup/hospital`                                                               |
| 2   | You verify, they sign, you approve | Owner + Clinic | `/admin` (Approvals), `/onboarding/hospital-pending`                             |
| 3   | First admin sets up MFA            | Clinic         | `/onboarding/mfa-setup`                                                          |
| 4   | Set up the hospital                | Clinic admin   | `/admin/setup`                                                                   |
| 5   | Clinics (service lines)            | Clinic admin   | `/hospital-admin/scheduling` → Service lines                                     |
| 6   | Fees                               | Clinic admin   | Same screen: Payment posture, Fee, Fees by cadre                                 |
| 7   | Hours and clinic days              | Clinic admin   | `/hospital-admin/scheduling` → Weekly rules; `/hospital-admin/departments/hours` |
| 8   | Staff accounts: sign up, approve   | Clinic         | `/signup/non-clinical`, `/signup/clinical`, `/hospital-admin/staff`              |
| 9   | Each person sets up MFA            | Each person    | `/onboarding/mfa-setup`, then `/sign-in/mfa`                                     |
| 10  | Name clinicians on clinic days     | Clinic admin   | `/hospital-admin/scheduling` → Next 14 days                                      |
| 11  | Emergency number                   | Owner          | `/admin/tenants`, `/admin/emergency`                                             |
| 12  | Last check: one test visit         | Both           | `/patient/book`, `/reception/expected`                                           |

---

## 0. Before you go (Owner)

- [ ] The switches in [GO-LIVE.md](GO-LIVE.md) are set. (That file is on branch `feat/booking-pilot-go-live`
      until it is merged.) The ones that matter on site:
  - `DEV_SKIP_MFA` is **unset** in Production. Staff must really use an authenticator app.
  - `MEDSYNC_ENV=production` is set as a Supabase Functions secret.
- [ ] **Branch `fix/booking-dry-run` is merged and deployed.** Without it: reception's **Book for this
      patient →** gives a 500 error, **Cancel the day** cannot be sent (the **Why** box empties), and
      the patient's visit ticket shows the clinic's name where the fee should be.
- [ ] You can sign in to the live app as superadmin, with your authenticator.
- [ ] Print the cheat sheet from [RECEPTION-TRAINING.md](RECEPTION-TRAINING.md).

Ask the clinic to have ready on the day:

- [ ] The clinic's official name, level and district.
- [ ] A **signed letter** from a senior officer naming the person who applies. (Can be uploaded after
      the form, but review waits for it.)
- [ ] The clinic's **operating licence**. Which council issued it (UMDPC, UNMC or AHPC) and the licence
      number.
- [ ] Phone or email of the senior officer who signed the letter. We contact them.
- [ ] Every staff member's **own phone** with an authenticator app installed (1Password, Authy or
      Google Authenticator, as the app says).
- [ ] Each reception person's **National ID number (NIN)**.
- [ ] Each clinician's **practising licence** (file or photo) and registration number.
- [ ] The list of clinics they run: name, days, start time, how long, how many patients, `[fees]`.
- [ ] The clinic's emergency number: `[clinic emergency number]`. See step 11 before you accept one.

---

## 1. The clinic applies (Clinic, with you beside them)

**Screen:** `/signup/hospital`. Title: **Apply to bring your hospital onto MedSync**.

The applicant fills three sections, then taps **Submit application**.

| Section                 | What it asks                                                                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Your facility**       | Find it on the MoH registry ("Type the facility's name"). Or "Can't find it? Enter your facility yourself": Official name, Facility level, Ownership, Where it is.                                                            |
| **You, the applicant**  | Full name, Your role, Work email, Mobile number, **Password** (12 or more characters; a short sentence works).                                                                                                                |
| **Proof and authority** | Private facility: **Licence issued by**, **Licence number**, **Operating licence** file. Then **Who authorised you to apply? (not you)**: name, title, phone or email (at least one), and **Their signed letter naming you**. |

- The work email and password are how the applicant signs in from now on.
- Licence and letter can be added after submitting. The pending page says
  "Review starts when it's here."
- After submit the applicant sees **We're reviewing your application** (`/onboarding/hospital-pending`).

> **Heads-up.** If this page says **Applications unavailable**, the current consent text is not published.
> Nothing can be submitted. Fix that first.

> **Heads-up.** Public sign-up forms are open in production only because of the `signupsOwnerOverride`
> switch (see GO-LIVE.md §4). Check it before the visit.

---

## 2. You verify, the clinic signs, you approve (Owner, then Clinic, then Owner)

**Screen:** `/admin` (the Approvals queue). Hospital applications are in it.

Three moves, in this order:

1. **Owner:** open the application. Check Documents outstanding says **All on file**. Contact the
   authorising officer (the app says we do this). Tap **Verify**.
2. **Clinic (the applicant):** on `/onboarding/hospital-pending` they now see **Sign the data-processing
   agreement**. They type **Signatory's full name** and **Signatory's title**, tick both boxes ("I am
   authorised to bind this institution…" and "I accept the data-processing agreement above."), tap
   **Sign the agreement**. They see "Agreement signed. We're setting up your hospital next."
3. **Owner:** back on `/admin`, the button now reads **Approve & provision**. Tap it.
   Until the clinic signs it reads **Waiting for the applicant to sign**.

> **Heads-up.** The agreement text the clinic signs says: "This is a placeholder DPA pending
> Ugandan-counsel review." The clinic will read that. Decide what you tell them. This is a legal item,
> not a software one.

---

## 3. The first admin sets up MFA (Clinic)

The applicant is now the hospital's first admin. Every admin and clinical screen needs MFA, so the
first sign-in goes straight to MFA setup.

Follow [How a person sets up MFA](#how-a-person-sets-up-mfa) (below, after step 12).

Do this **before step 4**. `/admin/setup` and `/hospital-admin/*` will not open without it.

---

## 4. Set up the hospital (Clinic admin)

**Screen:** `/admin/setup`. Title: **Set up your hospital**.

It is one page. Each task is a row that opens. It remembers where you stopped.

**Needed to go live:**

| Task             | What to do                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Departments**  | **Open Departments** (`/hospital-admin/departments`). Pick the departments they run. Set one **live**. It becomes where MedSync starts.            |
| **Backup admin** | Type **Backup admin's email**, tap **Create invitation link**. Send the link yourself. It works once, only for that email, and expires in 14 days. |
| **Wards**        | **Open Wards & beds**. Add each ward: **Ward name**, **Beds**, **Add ward**. At least one.                                                         |

**Recommended** (do the first two now, the rest can wait):

- **Clinics and clinic days.** Skip for now. Steps 5 to 7 do it properly.
- **Facility location.** Stand at the clinic, tap **Use this device's location**. Needs 200 m accuracy
  or better, inside the clinic's district. Used for emergency directions.
- Contact details (main phone, official email, landmark). Emergency and support services. Operating
  profile.

When "Everything needed is done" shows, tap **Take the hospital live**.

> **Heads-up. This can block a small private clinic.**
>
> - **A ward is required** to go live, even for a clinic that has no beds. Add one ward with the
>   clinic's own name for the pilot, or decide a different rule. `[owner decision]`
> - **The backup admin must accept first.** The button stays grey and the page says "A backup admin has
>   to accept their invitation first." The backup needs their own account with that email **and MFA on**.
>   So run steps 8 and 9 for the backup early, or the clinic cannot go live today.

---

## 5. Clinics (Clinic admin)

**Screen:** `/hospital-admin/scheduling` → panel **Service lines**. Tap **New service line**.

A service line is one bookable clinic in one department.

| Field                    | Notes                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Name**                 | What patients see, for example `[clinic name]`.                                                                                                  |
| **Department**           | Pick from the clinic's departments. If the list is empty, finish step 4 first.                                                                   |
| **Capacity mode**        | **Session** = a numbered position in a clinic day. **Slot** = one patient per timed slot. **Open queue** = a same-day ticket (the walk-in door). |
| **Time to care (days)**  | The window patients are offered open days in. Default 7. If no open day falls inside it, the waiting list shows.                                 |
| **Confidential service** | Tick for sensitive clinics. The desk shows a **Confidential** tag.                                                                               |
| **Status**               | **Active** to let patients book. Leave **Inactive** until steps 6 and 7 are done.                                                                |
| **Audit note**           | At least 8 characters. Goes to the audit log.                                                                                                    |

Tap **Create service line**.

Which mode: decide with the clinic. `[owner decision per clinic]`. The dry run used one of each.

> **Heads-up. The same clinics appear in a second place.** **Departments & services → Clinics**
> (`/hospital-admin/departments/clinics`) shows the same rows as a weekly timetable. Use it to **look**.
> Do the fee and capacity mode in Scheduling, because only Scheduling has those fields.

---

## 6. Fees (Clinic admin)

**Screen:** the same **Service lines** form.

| Field             | Notes                                                         |
| ----------------- | ------------------------------------------------------------- |
| **Posture**       | **No payment**, **Deposit to book**, or **Full fee to book**. |
| **Fee (UGX)**     | Whole shillings. The box steps in hundreds. `[fee]`           |
| **Deposit (UGX)** | Only with Deposit to book.                                    |

Different fee by cadre: open a saved line → **Fees by cadre** → **Choose a cadre** → **Fee (UGX)** →
Why (8 characters or more) → **Set fee for this cadre**. It shows on the patient's doctor choice.
The panel is absent on a **No payment** line.

> **Heads-up. The app does not take money in the pilot.** The fee is shown to the patient. Nothing is
> charged. The patient screen says "Demo payment: no money moves." So **the clinic collects the fee at the
> desk**. Tell them. "Full fee to book" sounds like the app collects it. It does not. (Payments are deferred
> by ADR 0092.)

---

## 7. Hours and clinic days (Clinic admin)

### Weekly rules (the session templates)

**Screen:** `/hospital-admin/scheduling` → **Weekly rules** → **New weekly rule**.
(The line must be in Session mode: "Set a service line to session mode first.")

| Field                                           | Notes                                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Service line**                                | The clinic.                                                                                                      |
| **Clinician**                                   | Leave blank for now. Step 10 names them. A day with none reads **Not yet assigned** and patients cannot book it. |
| **Venue (optional)**                            | Room or building.                                                                                                |
| **Day**, **Starts (EAT)**, **Length (minutes)** | The weekly slot, for example `[day] [time] [minutes]`.                                                           |
| **Valid from**, **Valid until (optional)**      | When the rule runs.                                                                                              |
| **Patients per session**                        | Total places.                                                                                                    |
| **Booked allocation**                           | How many of them can be booked ahead. Between 1 and the total.                                                   |
| **Booked seen per…**, **…walk-ins seen**        | The mix at the desk (for example 2 booked, then 1 walk-in).                                                      |
| **Overbooking factor**                          | 1.00 means none.                                                                                                 |
| **Audit note**                                  | 8 characters or more.                                                                                            |

Tap **Save rule**. It publishes the clinic days for the next 14 days **straight away**.

Check: the **Next 14 days** panel lists the days as **Published**.

Editing a rule later: days that already hold a booking keep their old capacity. Empty future days
follow the change.

### Slot lines (timed visits)

A **Slot** line has no weekly rule. The **clinician** adds their own times: `/doctor/schedule` →
**Availability** → add a block, Type **Bookable**. Do this after step 9.

### Opening hours, closures, holidays

**Screen:** `/hospital-admin/departments/hours` (**Hours & places** tab).

- **Opening hours** → **Save hours**.
- **Places** → **Add a place** (building, floor, room, directions for patients).
- **Closures**: closures always win. No clinic day is published inside one. Days already published are
  cancelled and patients are told.
- **Public holidays** are listed there too.

### Auto-confirm

Does a booking confirm at once, or wait for the clinician? Two places:

- Department: `/hospital-admin/scheduling` → **Booking policy**.
- Clinician: `/doctor/schedule` → settings → "Auto-confirm — patient requests confirm immediately".

If it is off, the booking shows on the desk as **Not confirmed yet** until the clinician confirms.
Decide per clinic. `[owner decision]`

---

## 8. Staff accounts: sign up, then approve (Clinic)

Each person makes their own account. Then the clinic admin approves them.

| Person               | They go to                                                             | Screen title                        | They need                                                                                                         |
| -------------------- | ---------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Reception**        | `/signup/non-clinical`                                                 | **Join your hospital's front desk** | NIN; pick the hospital; cadre = Reception                                                                         |
| **Clinician, nurse** | `/signup/clinical`                                                     | **Join your hospital on MedSync**   | Practising licence; pick hospital and cadre                                                                       |
| **Second admin**     | The link from step 4 (Backup admin): `/admin/claim-invitation?token=…` | **Claim your role**                 | An account with that email, signed in with MFA on. They make the account first (any sign-up), then open the link. |

Do **not** use `/sign-up` for staff. It makes a patient account.

Password: 12 or more characters.

**Optional invite link for clinicians.** `/hospital-admin/staff` → **Invitations** tab → type one email
per line → **Send invitations**. The app gives a `/signup/clinical?invite=…` link per person. You share
it yourself (WhatsApp, email). It is advisory: they still do the full sign-up. It cannot invite
reception or admins.

**Approve each one.** `/hospital-admin/staff` → **Pending approvals** tab → open the person → **Approve…**
→ add an **Approval note** → **Confirm approval**. For a clinician the admin cannot approve until the
practising licence is on file.

After approval, each person does step 9.

Doctor cadres (Intern, Clinical Officer, Medical Officer and above) land on `/doctor`. Other clinical
cadres land on `/clinician`, which has no queue.

> **Heads-up. Admin screen `/hospital-admin/admins` is a placeholder.** It does nothing yet. Use the
> **Backup admin** task in step 4.

> **Heads-up. Shared computer.** One browser holds up to five signed-in accounts. With five, pages may
> fail with error 431 (open item G3 in the dry run). Keep to four, or sign out when you finish.

---

## 9. Each person sets up MFA (Each person)

Everyone with a staff role does this once. Then every sign-in uses the code.

### How a person sets up MFA

1. Open `/sign-in`. Type **Email** and **Password**. Tap **Sign in**.
2. The app sends them to **Set up two-factor** (`/onboarding/mfa-setup`). It says "Required for clinical
   and administrative roles."
3. On their phone, open the authenticator app. Scan the QR code.
   Cannot scan? Tap **Can't scan the QR code?** and type the secret in by hand.
4. Type the 6 digits in **Authenticator code**. Tap **Activate two-factor**.
5. Every later sign-in: email and password, then **Enter your authentication code**, type 6 digits, tap
   **Verify**.

Check: on the reception screen the left bar shows `MFA · AAL2` under the person's name.

**Lost phone.** The clinic admin opens `/hospital-admin/staff` → **Directory** → the person → **Reset
MFA…**. The person sets up again from step 1.

**Forgot password.** There is no reset yet. The **Forgot password?** panel on the sign-in page says to
email the address shown there, from the address they signed up with. Put `[support number]` on the
cheat sheet as well.

> **Heads-up. If MFA is skipped, staff actions fail with 401** (check in, cancel a day, approvals)
> while pages still open. The fix is the same: set up MFA, sign out, sign in with the code.

> **Heads-up. This step has three names in the app.** The setup screen says **two-factor**. The waiting
> page says **two-step sign-in**. The sign-in code box says **Authentication code**. Say "MFA" out loud and
> point at the screen.

---

## 10. Name clinicians on clinic days (Clinic admin)

**Screen:** `/hospital-admin/scheduling` → **Next 14 days** → tap a day.

Set the clinician for any day that reads **Not yet assigned**. Or edit the weekly rule and set
**Clinician**, which fixes the empty future days.

Check: the amber banner "N clinic days start within 12 hours with no clinician named" is gone.

---

## 11. Emergency number (Owner)

Two parts. Both follow [emergency-contacts-verification.md](../runbooks/emergency-contacts-verification.md).

**"Verified" means a person dialled it from a Ugandan phone and the right service answered.**
Never verify a number you have not dialled today. Never use the clinic's office switchboard.

**A. This clinic's emergency line.**

1. Dial `[clinic emergency number]` from a Ugandan SIM. Note the date, time and who answered.
2. `/admin/tenants` → the clinic's row → **Set emergency line…**. Type the number and the reason.
3. Check: the **Emergency line** column shows the number instead of **Not set**.

If the clinic has no emergency entrance that answers, leave it **Not set**. The sheet then shows the
destination alone, with no number. That is the safe state. The list calls **Not set** a launch blocker,
so decide on purpose. `[owner decision]`

**B. National numbers (once for the platform, not per clinic).** `/admin/emergency` → **Emergency
contacts**. 112, 999, 912 and the KCCA line start `unverified`. Dial each, then set it to `verified` with
the reason, as the runbook says. Skip if already done.

Last: open `/emergency` signed out in production. The primary button must show the number you verified.

---

## 12. Last check: book one test visit and check it in (Both)

Goal: a patient books, reception checks them in, and you see them in the queue. About ten taps each side.

**Setup (Clinic or Owner).**

1. Make a test patient. `/signup/patient`. Three steps: identity, district, then the account
   (**email + password**, 12 or more characters) and the consent box. Name it `[test patient name]`.
2. Sign in as the patient. If asked **Choose your hospital first**, pick the clinic. (Only **active**
   hospitals are listed. If it is missing, step 4 is not finished.)

**Book (Patient screens).**

1. `/patient/book`: **Book a visit**. Tap **Next open day** → **Ask for a day**. If it asks **Why are you
   coming?**, choose **Planned care**.
2. Pick today if the clinic runs today. If not, book the next clinic day and do the rest on that day.
3. **Who do you want to see?** Choose. Tap the button that names the fee and the day.
4. Check: "The clinic confirms it. You will see the answer in Visits." The visit is on `/patient/visits`
   as **Confirmed**, or waits for the clinician if auto-confirm is off.

Or book from the desk instead: reception → **Book** → see the RECEPTION-TRAINING script.

**Check in (Reception screens). On the day.**

1. Reception signs in with MFA. Open **Expected** (`/reception/expected`).
2. Find the test patient. Tap **Send to triage**. (**Send to clinic** also works. **Urgent** always goes to
   triage.)
3. Check: the row shows **Sent to triage**. The patient is in the triage queue. On **Today**, **Arrived**
   goes up by one.
4. A row that says **Not confirmed yet** means the clinician has not confirmed it. Confirm it at
   `/doctor/schedule`, then try again.

**Pass:** booked, confirmed, checked in, visible in the queue. Write the result: `[pass or fail, date]`.

**Clean up.** Cancel the test visit. The patient opens `/patient/visits` → the visit → **Cancel** →
a reason of 8 characters or more. Leave the test account, named so nobody calls it.

> **Heads-up. "End visit" has not been walked on the live app.** If a doctor starts the test visit, they
> must also end it (`/doctor/encounters/<id>`), or it stays open under **Needs closing**. For the last
> check, stop at "Sent to triage".

---

## If something fails on site

| What you see                                        | Likely cause, and what to do                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 401 on check in, cancel a day, approvals            | The person has no MFA this session. Set up MFA, sign out, sign in with the code.      |
| Clinic is missing from the patient's hospital list  | Not active yet. Finish step 4: **Take the hospital live**.                            |
| **Book** is disabled on a clinic day                | The day has no clinician. Step 10.                                                    |
| Patient cannot book a clinic at all                 | Service line is **Inactive**, or no published days in the next 14 days.               |
| Row says **Not confirmed yet**                      | Clinician has not confirmed it. Auto-confirm is off.                                  |
| Row says **Identity to confirm**                    | A "New caller" booking. Tap **Confirm identity** and match the person.                |
| A long error page, or "520", after cancelling a day | Supabase had a hiccup. The day stays published. Wait a few seconds and try once more. |
| Pages fail with error 431                           | Probably too many accounts in one browser. Sign out some.                             |
| Locked out, forgot password                         | No reset yet. Use the **Forgot password?** panel's email. Call `[support number]`.    |
| Lost phone                                          | Admin: **Directory** → person → **Reset MFA…**.                                       |

Owner support line while on site: `[owner number]`.
