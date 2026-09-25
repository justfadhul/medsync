# MedSync — onboarding forms, extracted from the code

**What this is.** A complete extraction of every sign-up / onboarding form in MedSync, a role-based digital-hospital platform for Ugandan hospitals (Internal-Medicine-first, Mulago National Referral Hospital as the first site). It covers every visible string, field, option list, validation rule and post-submit step, taken directly from the source code (branch `feat/doctor-workspace`, 25 Sep 2026). Field keys (`like_this`) are the names the server receives.

**The five paths.**

| Who | Route | Shape | After submit |
|---|---|---|---|
| Patient | `/signup/patient` | 3-step form | Account live immediately |
| Clinical staff (doctors, nurses, midwives, pharmacists, allied) | `/signup/clinical` | 4-step form | Pending hospital-admin approval, then MFA |
| Doctor | same as clinical: there is **no separate doctor form**. A doctor picks the UMDPC council and a doctor cadre (§5) | — | — |
| Non-clinical staff (reception / records) | `/signup/non-clinical` | Single page, 4 sections | Pending hospital-admin approval, then MFA |
| Hospital | `/signup/hospital` | 7-step form | Reviewed by MedSync super-admin |

Legend used below: **\*** = required. "Optional" = the server accepts it empty.

---

## 1. Entry: `/get-started` (the chooser)

- **Title:** How will you use MedSync?
- **Sub:** Patients can start right away. Staff and hospitals are verified first, to protect patient data.
- **Production notice (only shown while sign-ups are closed; currently not shown):** Registration opens once our privacy notice is published. Until then, email hello@medsync.health.
- Each option shows **"You'll need:"** + a list + the next step.

| Group | Door title | Description | You'll need | Next |
|---|---|---|---|---|
| For you | I'm a patient | Your health record, readings and reminders in one place. Your care team sees them once your hospital is on MedSync. | an email address and a Ugandan mobile number | Ready as soon as you sign up |
| For hospital staff | I'm a clinician | Doctor, nurse, midwife, pharmacist or allied health professional. | your council registration number (a photo of your practising licence helps) | Approved by your hospital admin, then you set up two-step verification |
| For hospital staff | I'm non-clinical staff | Reception or records. No access to clinical notes. | your National ID number (NIN) and the name of your hospital | Approved by your hospital admin, then you set up two-step verification |
| For hospitals | I represent a hospital | Apply to join as a founding pilot hospital. | the facility's registration number and licence, and a signed letter authorising you | Reviewed by MedSync |

Footer: "Already have an account? Sign in →"

**Signup page frame (all `/signup/*`):** header has "MedSync" (home), "← Choose a different door" (back to `/get-started`), and "Sign in". Pages are `noindex`. If no consent text is published the page shows "Signup unavailable: The current consent text isn't ready yet. Please check back shortly." (Hospital: "Applications unavailable: The current consent or agreement text isn't ready yet.")

---

## 2. Rules shared by all forms

- **Phone (`PhoneInput`)**: fixed `+256` prefix, placeholder `7XX XXX XXX`, formatted `XXX XXX XXX`. Sent as E.164. Server regex: `^\+2567\d{8}$` (mobile) or `^\+256[23489]\d{7,8}$` (landline). Inline hints: "Mobile numbers in Uganda start with 7." (mobile-only fields) and "N more digits…". Error: "Enter a Ugandan phone number."
- **Password**: 12–72 characters on patient, clinical and hospital forms ("At least 12 characters."). **Non-clinical: minimum 8, no maximum.**
- **Email**: must be valid ("Enter a valid email."); stored lowercased; it is the sign-in identity. Sign-in is email + password only (no phone sign-in).
- **Photo (`AvatarUpload`)**: optional; JPEG/PNG/WebP; server cap 8 MB; downscaled to a 512×512 JPEG. Never blocks signup.
- **Document uploads (`FileUpload`)**: PDF, JPG or PNG, ≤ 5 MB, stored in private storage buckets. Phone camera capture allowed.
- **Data-processing consent**: every form has a required checkbox tied to the live `data_processing` consent version. The page sends the version + SHA-256 of the text shown. If the text changed while the tab was open, the server rejects with: "The consent text on this page is out of date. Please reload to see the current version and accept again." Acceptance is stored in `consent_records` (the legal proof under Uganda's Data Protection and Privacy Act 2019).
- **Encryption**: names, ID numbers, NIN, phone numbers, village address and next-of-kin details are encrypted before they reach the database.
- **Server errors** appear in an amber alert box above the submit button.
- **Production gate**: sign-ups are meant to open only after a privacy notice is published and PDPO registration is done. The owner turned them on in production on 2026-09-23 ahead of both (`signupsOwnerOverride = true` in `lib/legal.ts`).

---

## 3. Patient signup: `/signup/patient`

Page title "Patient signup · MedSync". 3-step form (flow label "Patient signup"), with Back / Continue between steps. All steps post together at the end.

### Step 1: "About you"
**Heading:** Tell us who you are
**Intro:** All identifying details are encrypted before they reach the database. We never store your ID number in plaintext.

| Label | Key | Input | Req | Options / validation | Helper text |
|---|---|---|---|---|---|
| Title | `title_code` | segmented | optional | Mr · Ms · Mrs · Dr · Other | — |
| First name | `first_name` | text | \* | max 80 | — |
| Surname | `surname` | text | \* | max 80 | — |
| Sex at birth | `sex` | segmented | \* | Male · Female · Intersex · Prefer not to say | — |
| Date of birth | `date_of_birth` | date picker | \* | 0–120 years ago; not in the future ("Date can't be in the future.") | Used for age-appropriate care. |
| ID type | `id_type` | segmented | \* | **NIN** (Uganda National ID, default) · **Passport** (International travel doc) · **None** (No formal ID on hand) | — |
| ID number | `id_number` | text | \* unless ID type = None (hidden when None) | max 40; error "Required for the ID type selected." | Encrypted at rest. Visible only to you and care teams you authorise. |
| Phone | `phone_e164` | phone, mobile only | \* | Ugandan number | We'll text appointment reminders. Visible only to you and care teams you authorise. |
| Photo (optional) | `photo` | avatar upload | optional | see §2 | Shown to the care team who see your record. |

### Step 2: "Where & care"
**Heading:** Where you live & your home facility
**Intro:** We use this to route SMS, suggest nearby queues, and connect you to your usual hospital.

| Label | Key | Input | Req | Options / validation | Helper text |
|---|---|---|---|---|---|
| District | `district_id` | searchable combobox ("Search districts…") | \* | list in §9.1 | — |
| Subcounty | `subcounty_id` | searchable combobox ("Search subcounties…"), loads after district | optional | list in §9.1 | — |
| Village or street address (optional) | `village_address` | text | optional | max 200 | Free-text. Encrypted at rest. |
| Preferred language for communications (optional) | `preferred_language` | text | optional | max 60; placeholder "e.g. English, Luganda, Runyoro" | — |

### Step 3: "Account"
**Heading:** Create your account
**Intro:** You'll sign in with this email. Pick a long password — a passphrase works well.

| Label | Key | Input | Req | Validation | Helper text |
|---|---|---|---|---|---|
| Name to display | `full_name` | text | \* | max 120 | — |
| Email | `email` | email | \* | valid email | — |
| Password | `password` | password (show/hide) | \* | 12–72 chars | At least 12 characters. |

Then:
- Expandable panel: **"Read the consent text (v1.0, effective 2026-05-23)"**, which shows the full data-processing notice (§10.1).
- Checkbox \* **"I agree to MedSync's data-processing notice"**. Sub-text: "v1.0 · effective 2026-05-23. The exact text above is recorded against your account." Error: "Consent is required to create an account."
- Checkbox (optional, **unticked by default**, a separate box) **"Send me SMS about my bookings"**. Sub-text: "MedSync may send SMS about your bookings: confirmation, reminders and changes. No marketing. Reply STOP to opt out. Without SMS we can only reach you inside the app. People who turn this off miss visits more often. You will still get one SMS with the code each time you book."
- Button: **Create account** (while submitting: "Creating account…")

### What happens on submit
1. Validate everything; check the consent hash.
2. Create the login account → encrypt personal details → save the patient profile (the database issues a **patient code**) → save the photo → record consent (and SMS consent if ticked).
3. Account state goes straight to **verified**. The phone is **not** verified by SMS code yet (the one-time-code UI exists but no SMS provider is wired).
4. Redirect to `/?welcomed=patient`.

Error messages: "The consent text has been updated. Please reload the page, re-read, and accept the new version." · "Could not save your profile. Please try again." (the login account is rolled back).

**Collected by the server but not on the form yet:** home facility (`primary_facility_id`), next of kin (`nok_name`, `nok_relationship` = spouse/parent/child/sibling/guardian/friend/other, `nok_phone_e164`).

---

## 4. Clinical staff signup: `/signup/clinical`

Page title "Clinical staff signup · MedSync". 4-step form (flow label "Clinical staff signup").

### Step 1: "About you"
**Heading:** Tell us who you are
**Intro:** We'll use these details to contact you about your verification.

| Label | Key | Input | Req | Validation | Helper text |
|---|---|---|---|---|---|
| Full name | `full_name` | text | \* | max 120 | — |
| Email | `email` | email | \* | valid email | — |
| Mobile phone | `phone_e164` | phone, mobile only | \* | Ugandan number | — |
| Photo (optional) | `photo` | avatar upload | optional | see §2 | Shown to patients who can book you and to colleagues. |

### Step 2: "Professional"
**Heading:** Your council registration
**Intro:** We verify your registration number against the relevant council before granting clinical access. Your licence document is stored privately and only shared with your hospital admin and our verification team.

| Label | Key | Input | Req | Options / validation | Helper text |
|---|---|---|---|---|---|
| Regulatory council | `council_id` | searchable combobox ("Search councils…", also matches council code) | \* | 4 councils (§9.2) | — |
| Cadre | `cadre_id` | searchable combobox ("Search cadres…"), filtered by council | \* | §9.3 | — |
| Cadre grade (optional) | `cadre_grade_id` | combobox; placeholder "Pick a cadre first" → "Loading…" → "Search grades…" | optional | §9.4 (only 4 cadres have grades) | — |
| Role | `role_id` | combobox; placeholder "Pick a cadre first" → "Loading…" → "Search roles…" | \* | filtered by cadre (§9.5) | — |
| Registration number | `registration_number` | text | \* | max 60 | As printed on your practising certificate. |
| Practising certificate expiry (optional) | `registration_expiry` | date | optional | YYYY-MM-DD | If your practising certificate has an expiry, we'll prompt you to re-upload before it lapses. |
| Practising licence (PDF or photo) | `licence_document` | file upload (camera allowed) | optional | PDF/JPG/PNG ≤ 5 MB; hint "PDF, JPG or PNG · max 5MB" | ≤ 5 MB. Stored privately. Re-validated server-side. |

Changing the council clears the cadre; changing the cadre reloads grades and roles.

### Step 3: "Affiliation"
**Heading:** Where you'll work
**Intro:** Your hospital admin will get an approval request as soon as you submit. You won't have clinical access until they approve.

| Label | Key | Input | Req | Options | Helper text |
|---|---|---|---|---|---|
| Hospital | `hospital_id` | searchable combobox ("Search hospitals…") | \* | every hospital on MedSync (seeded: Mulago National Referral Hospital) | — |
| Department | `department_id` | searchable combobox ("Search departments…"), loads after hospital | \* | that hospital's departments (Mulago seed: Internal Medicine + 13 sub-specialties, §9.6) | — |
| Employment type | `employment_type` | segmented | \* | **Full-time** (default) · Visiting · Locum | — |

### Step 4: "Account"
**Heading:** Set up your account
**Intro:** MFA enrollment is required before you can access clinical surfaces.

| Label | Key | Input | Req | Validation | Helper text |
|---|---|---|---|---|---|
| Password | `password` | password | \* | 12–72 chars | At least 12 characters. |

- Expandable "Read the consent text (v1.0, effective 2026-05-23)" (§10.1).
- Checkbox \* "I agree to MedSync's data-processing notice". Sub-text: "v1.0 · effective 2026-05-23." Error: "Consent is required."
- Button: **Submit for review** (while submitting: "Submitting for review…")

### What happens on submit
1. Create the login account → upload the licence (if the storage bucket is missing, the upload is skipped with a warning and signup continues) → save the clinician profile (council, registration number, expiry, licence path) → save the photo.
2. Create the **staff affiliation** (hospital, department, cadre, grade, role, employment type) in state **pending_approval** → record consent → user state **pending_approval** (the phone is saved encrypted on the user).
3. Redirect to `/onboarding/clinical-pending` (§8.1).
4. Lifecycle: the hospital admin approves (or rejects, or asks for more information) → user sets up an authenticator app (TOTP MFA) at `/onboarding/mfa-setup` → **active**. There is no clinical access before active.

Errors: "Could not save your professional profile. Please try again." (login account rolled back) · "Could not record your affiliation. Your account is created — sign in and try adding the affiliation from your profile."

**Collected by the server but not on the form:** `specialty_id` (optional).

---

## 5. Doctor onboarding (a path through the clinical form)

There is no doctor-specific form. A doctor uses `/signup/clinical` and picks:

- **Regulatory council:** Uganda Medical and Dental Practitioners Council (UMDPC)
- **Cadre** (in this order) → **Role** options that then appear:

| Cadre | Roles offered |
|---|---|
| Intern Doctor | Intern Doctor — Internal Medicine |
| Medical Officer | Medical Officer — Internal Medicine |
| Medical Officer (Special Grade) | Medical Officer SG — Internal Medicine |
| Consultant | Consultant Physician — Cardiology · — Nephrology · — Endocrinology · — Pulmonology · — Gastroenterology · — Hepatology · — Neurology · — Infectious Diseases · — Oncology · — Haematology · — Rheumatology · — Dermatology · — Geriatrics |
| Senior Consultant | Senior Consultant · Senior Consultant — Internal Medicine · — Surgery · — Paediatrics · — Obstetrics & Gynaecology |
| Dental Officer | Dental Officer |
| Dental Surgeon | Dental Surgeon |

- **Cadre grade:** no doctor cadre has grades, so this dropdown stays empty.
- Everything else is the clinical form (§4): registration number = UMDPC number, practising-licence upload, hospital + department, employment type.
- After hospital-admin approval and MFA, the doctor reaches the doctor workspace (`/doctor`). `/clinician` is the general workspace for other clinical staff.

Invited staff also have a basic account page at `/sign-up` (Full name, Email, Password "At least 12 characters."; creates a plain account and sends the user to sign-in with "Account created. Sign in to continue."). Roles are granted separately by an admin.

---

## 6. Non-clinical staff signup: `/signup/non-clinical`

Page title "Non-clinical staff signup · MedSync". **One page** (not multi-step), four sections.

**Kicker:** NON-CLINICAL STAFF
**Heading:** Sign up to work the front desk
**Lead:** For reception, records and other non-clinical hospital staff. If you're a clinician, nurse, pharmacist or lab tech, use the [clinical signup](/signup/clinical) instead.

### Section "Account"

| Label | Key | Input | Req | Validation | Helper text |
|---|---|---|---|---|---|
| Full name | `full_name` | text | \* | 2–120 chars | — |
| Work email | `email` | email | \* | valid email | Use your hospital email if you have one — it helps your admin recognise you. |
| Phone | `phone_e164` | phone, mobile only | \* | Ugandan number | — |
| Password | `password` | password | \* | **min 8** ("Use at least 8 characters.") | — |

### Section "Identity"
Note: *Reception staff don't hold a professional council registration. The hospital admin who approves your account is verifying that you're genuinely employed. We use your **NIN** for identity; everything else is optional but strengthens trust.*

| Label | Key | Input | Req | Validation | Helper text |
|---|---|---|---|---|---|
| National ID (NIN) | `nin` | text (monospace, uppercased) | \* | 8–16 letters/digits; error "Enter your National ID number (NIN)." | As printed on your national ID. Stored encrypted. |
| Internal staff number (optional) | `staff_number` | text | optional | max 60 | If your hospital has assigned you one. |
| Authorising officer (optional) | `authorising_officer_name` | text | optional | max 120 | A senior who can vouch for you. |
| Their role (optional) | `authorising_officer_role` | text | optional | max 120 | E.g. Records HOD, Front-Desk Lead. |
| Appointment letter (optional) | `appointment_letter` | file upload | optional | PDF/JPG/PNG ≤ 5 MB | PDF or image, ≤ 5MB. Helps your admin approve faster. |

### Section "Where you work"

| Label | Key | Input | Req | Options | Helper text |
|---|---|---|---|---|---|
| Role category | `cadre_id` | native select ("Choose…") | \* | **Reception / Records Officer** (the only non-clinical cadre) | Reception is the only non-clinical option today. |
| Role | `role_id` | native select ("Pick a role category first") | \* | **Reception / Records Officer** | — |
| Hospital | `hospital_id` | native select ("Choose your hospital") | \* | every hospital on MedSync | — |
| Department / unit | `department_id` | native select ("Pick a hospital first") | \* | that hospital's departments | — |
| Employment | `employment_type` | native select | \* | Full-time (default) · **Part-time** (stored as `visiting`) · Locum | — |

### Section "Consent"
- Checkbox \* **"I agree to MedSync's data-processing terms"**. Sub-text: "We process the data you've entered to verify your role and provide the workspace." (The full notice text is **not** displayed on this page.)

Button: **Create my account** (while submitting: "Creating account…")
Footnote: "We'll create your account in a `pending` state. Your hospital admin reviews and approves. Once approved you'll sign in to the reception workspace."

### What happens on submit
Create the login account → encrypt the NIN (uppercased) and phone → upload the appointment letter (skipped with a warning on failure) → save the staff identity profile → staff affiliation **pending_approval** (no grade, no specialty) → record consent → user **pending_approval** → redirect to **`/onboarding/clinical-pending`** (the same page clinicians see, §8.1). After approval: MFA, then the `/reception` workspace. Basis of verification: the hospital admin's approval stands as employer attestation.

---

## 7. Hospital application: `/signup/hospital`

Page title "Hospital application · MedSync". 7-step form (flow label "Hospital application"). **Each step is validated when Continue is pressed** (same rules as the server). The applicant's account becomes the hospital's **first hospital admin** once approved.

### Step 1: "Institution"
**Heading:** About the hospital
**Intro:** We'll cross-check this against the MoH facility list during verification.

| Label | Key | Input | Req | Options / validation | Helper text |
|---|---|---|---|---|---|
| Official hospital name | `hospital_name` | text | \* | max 160 | — |
| Also known as (optional) | `hospital_aka` | text | optional | max 160 | — |
| Facility level | `facility_level` | combobox ("Pick the MoH level") | \* | Health Centre II · Health Centre III · Health Centre IV · General Hospital · Regional Referral Hospital · National Referral Hospital · Private hospital / clinic · Other | — |
| Ownership model | `ownership` | radio cards | \* | **Government / Public — MoH** "Government-owned." · **Private / Private for-profit** "Fee-for-service." · **PNFP / Private not-for-profit** "Faith / mission-led." · **Clinic / Private clinic** "Solo / small group." | — |
| Year established (optional) | `year_established` | number | optional | 1900 to the current year ("Year cannot be in the future.") | Year between 1900 and now. |
| Region (optional) | `region_id` | combobox ("Pick the region") | optional | Central · Eastern · Northern · Western | Auto-fills from district where possible. |
| District | `district_id` | searchable combobox | \* | §9.1 | — |
| Subcounty (optional) | `subcounty_id` | searchable combobox | optional | §9.1 | — |
| Physical address | `physical_address` | text | \* | max 400 | — |
| Main phone | `main_phone` | phone (landline allowed) | \* | Ugandan number | — |
| Official email | `official_email` | email | \* | valid email | — |
| Website (optional) | `website` | url (placeholder "https://") | optional | valid URL, max 300 | — |

### Step 2: "Departments"
**Heading:** Clinical departments
**Intro:** Tick the departments you actively run. Pick the one to launch MedSync in first.

Checkboxes (`departments`, **at least one**: "Pick at least one department."), grouped:

| Group | Departments (code) |
|---|---|
| Medicine | Internal Medicine (`INTERNAL_MEDICINE`) · Family Medicine (`FAMILY_MEDICINE`) |
| Surgery | General Surgery · Orthopaedics · Urology · Neurosurgery · Cardiothoracic · Paediatric Surgery · Plastic / Reconstructive · ENT · Maxillofacial |
| Women & children | Obstetrics & Gynaecology · Paediatrics & Child Health · Neonatology |
| Acute & critical | Emergency / Casualty · Anaesthesia · Intensive Care (ICU/HDU) |
| Mental & rehab | Psychiatry / Mental Health · Physiotherapy & Rehabilitation · Palliative Care |
| Other | Dental / Oral Health · Public / Community Health · Ophthalmology |

Inside the Medicine group: **"Internal Medicine sub-specialties"** (`im_subspecialties`, optional multi-select), greyed out until Internal Medicine is ticked. Caption: "Tick Internal Medicine above to enable." → "Pick the ones you actively run." Options: Cardiology · Nephrology · Endocrinology / Diabetology · Pulmonology · Gastroenterology · Hepatology · Neurology · Infectious Diseases · Oncology · Haematology · Rheumatology · Dermatology · Geriatrics.

| Label | Key | Input | Req | Validation | Helper text |
|---|---|---|---|---|---|
| Primary department for MedSync rollout | `primary_department` | combobox ("Pick one of your ticked departments") | \* | must be one of the ticked departments: "Primary must be one of your selected departments." | The first deployable slice. |

### Step 3: "Clinical services"
**Heading:** Specialised clinics & diagnostics
**Intro:** Selection only — these become the basis for clinic / lab modules later.

- **Specialised clinics / programs** (`specialised_clinics`, optional multi): Diabetes · Hypertension / cardiac · Renal / dialysis · Oncology · HIV / ART · TB · Antenatal / maternal · Asthma / COPD · Mental health
- **Diagnostic services** (`diagnostic_services`, optional multi): Lab — Clinical chemistry · Lab — Haematology · Lab — Microbiology · Lab — Histopathology / Cytology · Imaging — X-ray · Imaging — Ultrasound · Imaging — CT · Imaging — MRI · Imaging — Mammography · ECG · Echocardiography · Endoscopy
- **Support services** (`support_services`, optional multi): Pharmacy · Blood bank · Operating theatres · Mortuary · Ambulance
- **On-site pharmacy?** \* (`has_onsite_pharmacy`, segmented): Yes · No

### Step 4: "Operating"
**Heading:** Operating profile
**Intro:** Capacity bands + infrastructure — drives offline-first / SMS configuration later.

| Label | Key | Input | Req | Options |
|---|---|---|---|---|
| Services offered | `services_offered` | checkboxes | optional | OPD · Inpatient · Day-care · Emergency 24/7 · Referral |
| Bed capacity | `bed_capacity_band` | combobox ("Pick a range") | optional | Under 25 · 25–99 · 100–299 · 300–799 · 800+ |
| Clinical staff count | `clinical_staff_band` | combobox | optional | Under 10 · 10–49 · 50–199 · 200–499 · 500+ |
| Daily OPD volume | `daily_opd_band` | combobox | optional | Under 25 · 25–99 · 100–299 · 300–799 · 800+ |
| Internet connectivity | `internet_connectivity` | segmented | \* | Reliable · Intermittent · Limited |
| Power / backup | `power_backup` | segmented | optional | Reliable · With generator backup · Unreliable |
| Existing EMR | `existing_emr` | combobox ("None / Paper / Existing") | optional | None · Paper · Existing EMR |
| Existing EMR name (if Existing) | `existing_emr_name` | text, max 160 | optional | Helper: "Skip if you don't run an EMR today." (saved only when Existing EMR is chosen) |

### Step 5: "Verification"
**Heading:** Verification & authority
**Intro:** This is the trust anchor — superadmin uses the callback contact to confirm you have authority to apply.

| Label | Key | Input | Req | Options / validation | Helper text |
|---|---|---|---|---|---|
| Facility licence / registration number | `registration_number` | text | \* | max 120 | — |
| Issuing authority (optional, free text) | `registration_authority` | text (placeholder "e.g. MoH Facility List, UMDPC") | optional | max 160 | — |
| Licensing body | `licensing_body` | combobox | \* | Ministry of Health · UMDPC · Other | — |
| Facility licence document | `facility_licence_document` | file upload (camera allowed; hint "Licence / registration certificate") | \* | PDF/JPG/PNG ≤ 5 MB | PDF / JPG / PNG, ≤ 5 MB. Stored privately. |
| Institutional email domain | `institutional_email_domain` | text (placeholder "mulago.go.ug") | \* | a domain; error "Enter a domain like mulago.go.ug." | e.g. mulago.go.ug — your work email below must match this. |

*"About you (the applicant):"*

| Label | Key | Input | Req | Options / validation | Helper text |
|---|---|---|---|---|---|
| Your full name | `applicant_full_name` | text | \* | max 120 | — |
| Your role / title | `applicant_role` | combobox ("Pick your role") | \* | Medical Superintendent · Hospital Director · Administrator · Head of Department · IT · Other | — |
| Your work email | `applicant_work_email` | email | \* | valid email. **This becomes the login.** | Must use the institutional domain above (mismatch is flagged for stricter review, never silently rejected). |
| Your phone | `applicant_phone` | phone | \* | Ugandan number | — |
| Professional council number (optional, adds weight) | `applicant_council_number` | text | optional | max 80 | UMDPC / nursing / pharmacy council, etc. |

*"Independent callback contact — a senior officer (NOT you) who can confirm your authority by phone or email."*

| Label | Key | Input | Req | Options / validation | Helper text |
|---|---|---|---|---|---|
| Senior officer's name | `authority_officer_name` | text | \* | max 120 | — |
| Senior officer's title | `authority_officer_title` | combobox | \* | same 6 titles as above | — |
| Signed authorisation letter | `authority_letter_document` | file upload (hint "Letter on letterhead") | \* | PDF/JPG/PNG ≤ 5 MB | On letterhead, naming you as the authorised applicant. PDF / JPG / PNG, ≤ 5 MB. |
| Callback channel | `callback_contact_kind` | segmented | \* | Phone · Email | — |
| Callback contact | `callback_contact_value` | text | \* | max 200 (format not checked) | Phone (Ugandan E.164) or email — the officer's, not yours. Encrypted at rest. |

### Step 6: "Agreement"
**Heading:** Data-Processing Agreement
**Intro:** An authorised signatory accepts on behalf of the institution. Acceptance is recorded with the SHA-256 of the exact text shown.

- Amber banner (while the DPA is a placeholder): "This is a placeholder DPA pending Ugandan-counsel review. Acceptance is recorded; hospitals on the placeholder will be re-prompted when the approved version lands."
- Scrollable box with the full DPA text (§10.3), then "Version: v0.placeholder · SHA-256 (first 12): …"

| Label | Key | Input | Req | Options / validation |
|---|---|---|---|---|
| Authorised signatory — full name | `signatory_name` | text | \* | max 120 |
| Signatory title | `signatory_title` | combobox | \* | same 6 titles |
| I am authorised to bind this institution to this agreement. | `authorised_to_bind` | checkbox | \* | "You must confirm authority." |
| I accept the Data-Processing Agreement above. | `accept_agreement` | checkbox | \* | "Acceptance is required." |

### Step 7: "Account"
**Heading:** Create your account
**Intro:** Your account becomes the first hospital admin after approval. The work email + password sign you in.
Note: "We'll create the account with the work email you entered on the Verification step."

| Label | Key | Input | Req | Validation | Helper text |
|---|---|---|---|---|---|
| Password | `applicant_password` | password | \* | 12–72 chars | At least 12 characters. |
| I consent to MedSync processing my personal data as described in the privacy notice. | `data_processing_consent` | checkbox | \* | "Consent is required." (the notice text is not displayed on this step) | — |

Button: **Submit application** (while submitting: "Submitting application…")

### What happens on submit
1. Check that the primary department is among the ticked ones, that both documents are present, and the consent and DPA hashes. Flag `email_domain_mismatch` if the work email's domain differs from the declared domain (flagged, not rejected).
2. Create the applicant's login account (work email) → upload both documents to the private `hospital-authorisations` bucket (if either fails, the account is rolled back: "Couldn't upload your documents. Try again with smaller files.") → encrypt the callback contact → save the application → save departments (with the primary marked) and IM sub-specialties → record consent → applicant **pending_approval**.
3. Redirect to `/onboarding/hospital-pending` (§8.2).
4. Super-admin lifecycle: `pending_approval → under_review → verified → agreement_signed → provisioning → active` (or `rejected`). On approval the applicant becomes **hospital admin**, a tenant is provisioned, and they complete a setup wizard (departments, wards, backup admin).

**Accepted by the server but no input on the form:** `departments_other`, `specialised_clinics_other` (free text, up to 5 each).
**Also in code but not linked from any page:** a lightweight "hospital lead" capture action (hospital name, level, ownership, district, contact name/role/email/phone, notes, source).

---

## 8. After submission: holding pages

Status labels used: Unverified · Verified · Pending approval · Approved · Active · Rejected · Suspended · Deactivated · Under review · Agreement signed · Provisioning · Offboarded · Agreement expired.

### 8.1 `/onboarding/clinical-pending` (clinical **and** non-clinical staff)
Header: MedSync · Sign out. Status pill shows the affiliation state.

- **Under review:** H1 "We're verifying your affiliation". Body: "Thanks, {first name}. We've sent your affiliation with **{hospital}** to that hospital's admin team for verification against the {cadre} council registry. You'll be emailed the moment a decision is made."
  - "What happens next": 1. The hospital admin verifies your registration against the council registry. 2. They confirm your role and department against their internal records. 3. On approval: you complete MFA enrolment and your clinician role is activated for that hospital.
  - If the admin left a note: "The hospital admin needs more information" + "“{note}”" + "Update what they asked for and email support@medsync.health when ready — they'll re-open the queue. Your affiliation is still on file."
- **Rejected:** H1 "Your affiliation wasn't approved". Body: "Our review found: {reason or '(no reason recorded yet)'}. Reach out to your hospital admin or to MedSync support if you'd like to discuss next steps."
- **Approved / active:** H1 "Your affiliation is approved". Body: "Welcome, {first name}. Your {role} affiliation with **{hospital}** has been verified. Finish setting up two-factor below — clinical features are landing in the next release and will be available here when they do."
  - "Two-factor" card: **Required**, "Add an authenticator app (1Password, Google Authenticator, Authy, etc.) so clinical actions can be tied back to you with confidence." + "Set up two-factor →" / or **On file**, "An authenticator app is enrolled on your account. You'll use it whenever you sign in."
- "Affiliation on file": Hospital · Department · Role (cadre) · Employment · Submitted · Status.
- Footer: "You can close this tab — we'll notify you by email." (approved: "We'll email you the moment the clinical workspace is available.")

### 8.2 `/onboarding/hospital-pending`
- **Under review:** H1 "We're reviewing your application". Body: "Thanks for applying on behalf of **{hospital}**. A superadmin is verifying the documents you uploaded and confirming with the senior officer on your callback contact. We'll email {work email} the moment a decision is made."
  - What happens next: 1. A platform superadmin reviews your facility licence + authorisation letter. 2. They call the senior officer on your callback contact to confirm authority. 3. On approval: your account is upgraded to hospital admin, a tenant is provisioned, and you complete a short setup wizard (departments, wards, backup admin) before going live.
- **Rejected:** H1 "Your application wasn't approved". Body: "Our review found: {reason}. Reach out if you'd like to discuss next steps."
- "Application on file": Hospital · Facility level · Submitted · Status.
- Once the agreement is signed, the page redirects to `/admin`.
- Footer: "You can close this tab — we'll notify you by email."

---

## 9. Reference lists (as seeded in the database migrations)

The live database may have more rows added through the admin tools.

### 9.1 Geography: **placeholder subset**, pending the full UBOS NPHC 2024 dataset
- **Regions:** Central, Eastern, Northern, Western
- **Districts (21, alphabetical in the dropdown):** Central: Kampala, Wakiso, Mukono, Mpigi, Luwero, Masaka · Eastern: Jinja, Mbale, Soroti, Tororo, Iganga · Northern: Gulu, Lira, Arua, Kitgum, Moroto · Western: Mbarara, Kabale, Kasese, Hoima, Fort Portal
- **Subcounties:** Kampala only: Kampala Central Division, Kawempe Division, Makindye Division, Nakawa Division, Rubaga Division. Every other district has **no subcounties** yet.

### 9.2 Councils (dropdown sorted by name)
| Code | Name | Regulates |
|---|---|---|
| AHPC | Allied Health Professionals Council | clinical officers, lab, radiography, physiotherapy, other allied disciplines |
| PHARM_BOARD | Pharmacy Board | pharmacists & pharmacy cadres (with the National Drug Authority) |
| UMDPC | Uganda Medical and Dental Practitioners Council | doctors and dentists |
| UNMC | Uganda Nurses and Midwives Council | nurses and midwives (enrolled vs registered) |

### 9.3 Cadres by council
- **UMDPC:** Intern Doctor · Medical Officer · Medical Officer (Special Grade) · Consultant · Senior Consultant · Dental Officer · Dental Surgeon
- **UNMC:** Nurse · Midwife · Specialist Nurse
- **AHPC:** Clinical Officer · Laboratory Technician · Laboratory Technologist · Radiographer · Physiotherapist · Occupational Therapist · Nutritionist
- **Pharmacy Board:** Pharmacist · Pharmacy Technician
- **Non-clinical (no council):** Reception / Records Officer

### 9.4 Cadre grades
- Nurse: Enrolled Nurse · Registered Nurse · Specialist Nurse
- Midwife: Enrolled Midwife · Registered Midwife
- Clinical Officer: Diploma · Bachelor's
- Laboratory Technician: Certificate · Diploma
- All other cadres: none

### 9.5 Roles by cadre
| Cadre | Roles |
|---|---|
| Intern Doctor | Intern Doctor — Internal Medicine |
| Medical Officer | Medical Officer — Internal Medicine |
| Medical Officer (Special Grade) | Medical Officer SG — Internal Medicine |
| Consultant | Consultant Physician — {Cardiology, Nephrology, Endocrinology, Pulmonology, Gastroenterology, Hepatology, Neurology, Infectious Diseases, Oncology, Haematology, Rheumatology, Dermatology, Geriatrics} |
| Senior Consultant | Senior Consultant · — Internal Medicine · — Surgery · — Paediatrics · — Obstetrics & Gynaecology |
| Dental Officer | Dental Officer |
| Dental Surgeon | Dental Surgeon |
| Nurse | Nurse — Internal Medicine |
| Midwife | Midwife |
| Specialist Nurse | Specialist Nurse — Internal Medicine |
| Clinical Officer | Clinical Officer — Internal Medicine |
| Laboratory Technician | Laboratory Technician — IM |
| Laboratory Technologist | Laboratory Technologist |
| Radiographer | Radiographer |
| Physiotherapist | Physiotherapist |
| Occupational Therapist | Occupational Therapist |
| Nutritionist | Nutritionist |
| Pharmacist | Ward Pharmacist |
| Pharmacy Technician | Pharmacy Technician |
| Reception / Records Officer | Reception / Records Officer |

### 9.6 Specialties / seeded hospital
- Internal Medicine + 13 sub-specialties: Cardiology, Nephrology, Endocrinology / Diabetology, Pulmonology, Gastroenterology, Hepatology, Neurology, Infectious Diseases, Oncology, Haematology, Rheumatology, Dermatology, Geriatrics.
- Seeded hospital: **Mulago National Referral Hospital** (Central, Kampala), with departments Internal Medicine plus the 13 sub-specialties above.

---

## 10. Consent and agreement texts (verbatim)

### 10.1 Data-processing notice, `data_processing` v1.0, effective 2026-05-23 (all four forms)
> PLACEHOLDER — MedSync Data Processing Notice (v1.0)
>
> This is interim text pending review by counsel. By signing up you agree that MedSync may process the personal and health information you provide for the purpose of (a) creating and operating your account, (b) issuing you a patient code, (c) connecting you to partner facilities, and (d) producing aggregate, de-identified statistics for service improvement. We will not share identifying information with third parties for marketing. You can request a copy of your data or its deletion at any time by contacting support.
>
> A finalised consent notice will supersede this one before any patient data is used for purposes beyond the four named above. Acceptance of this version is recorded in consent_records with the SHA-256 of this exact text so we can prove which version you saw.

### 10.2 SMS consent, `sms_communication` v1.0, effective 2026-09-13 (patient only, optional)
> MedSync may send SMS about your bookings: confirmation, reminders and changes. No marketing. Reply STOP to opt out.

UI copy around it (marked provisional, pending Clinical Safety Officer sign-off): label "Send me SMS about my bookings"; "Without SMS we can only reach you inside the app. People who turn this off miss visits more often."; "You will still get one SMS with the code each time you book."

### 10.3 Hospital Data-Processing Agreement, `v0.placeholder` (hospital only)
> {{LEGAL REVIEW — PLACEHOLDER}}
>
> This Data-Processing Agreement (DPA) is a placeholder pending review by Ugandan counsel. It captures the structural intent of the agreement between MedSync and the institution accepting it.
>
> The institution agrees to lawful processing of personal health information on the MedSync platform, in compliance with the Uganda Personal Data Protection Office (PDPO) and the Data Protection and Privacy Act, 2019. The institution warrants that it has the authority to bind itself to this agreement and that the named signatory holds that authority.
>
> This placeholder will be superseded by a lawyer-reviewed v1 once available. Acceptance of this version is recorded in hospital_agreements with the SHA-256 of this exact text so we can prove which version each hospital saw.

---

## 11. Gaps and inconsistencies found while extracting

1. **Non-clinical staff land on the clinicians' pending page.** It says their affiliation is being verified "against the Reception / Records Officer council registry", and that "your clinician role is activated". Neither is true for reception staff.
2. **Password rules differ:** the non-clinical form accepts 8+ characters with no maximum; every other form needs 12–72.
3. **Same value, different labels:** employment `visiting` shows as "Visiting" on the clinical form and "Part-time" on the non-clinical form.
4. **Consent text isn't always shown:** patient and clinical show the full notice; non-clinical and hospital step 7 show only a checkbox.
5. **The cadre-grade dropdown reads "Loading…" forever** for any cadre with no grades (every doctor, dental, pharmacy and most allied cadres).
6. **Roles are mostly Internal-Medicine-only:** a Medical Officer, MO (SG), Intern, Nurse or Clinical Officer outside IM must still pick "… — Internal Medicine"; Consultants can only pick IM sub-specialties.
7. **Patient step 2 heading promises "your home facility"**, but there is no facility field. Next-of-kin fields exist on the server but not on the form.
8. **Patient phone is not verified** (no SMS one-time code yet); finishing the signup marks the account verified.
9. **Hospital form:** "Region: Auto-fills from district where possible" isn't implemented. The primary-department dropdown lists all 23 departments, not just the ticked ones (the mismatch is caught on Continue). The callback contact isn't format-checked. Daily OPD volume reuses the bed-capacity bands ("Under 25 … 800+"). The "other department" and "other clinic" free-text fields have no inputs.
10. **Reference data is a placeholder:** 21 of 146 districts, and subcounties for Kampala only.
11. **Legal texts are placeholders**, and production sign-ups were opened by owner override before the privacy notice was published and PDPO registration was done.
12. **The practising licence is optional** on the clinical form, although verification relies on it (the get-started page says a photo "helps").
