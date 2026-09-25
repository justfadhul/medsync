# PROMPT: Onboarding v2 — one page per form, no Next, ask only what approval needs

> **For Claude Code.** Work at the repo root on a new branch `feat/onboarding-v2`. Cut it from the branch that holds the current onboarding code. The 25 Sep extraction was taken from `feat/doctor-workspace`. If that branch has not merged, confirm at STOP 0 that the onboarding code on `main` is identical, and cut from `main`. Do not touch `app/doctor/**`. First copy this prompt into `docs/onboarding-v2/`, together with the extraction *"MedSync — onboarding forms, extracted from the code"* (ask Fadhul for it if it is not in the repo). The extraction is the baseline.
>
> **Mode:** gated. Eight phases (0–7), each ending in a **STOP**.
> - Documents use Stage 1: draft → critique against the checklist → revise (max two passes) → present → STOP.
> - Code uses Stage 2: build → run the real checks → fix → re-run until green → report numbers → STOP.
> - Self-refinement never replaces a real check.
>
> **The CSO is Fadhul.** No clinical rule changes here, and the Emergency affordance stays exactly as it is. Two user-facing commitments still need his signature at GATE A, and the lawyer's eye: the under-18 message and the consent summary lines.

---

## 0. What we are building, in one paragraph

**The problem.** Testers (25 Sep 2026) found the onboarding forms too long and tiring. One pointed out that the hospital application asks for a professional council number, which a non-clinical administrator won't have. Another picked the Eastern region and was offered Arua, which is in the North. Fadhul doesn't want to keep pressing Next.

**The root causes are structural.**
- The forms ask at signup for things nobody needs until after approval.
- They ask for the same fact twice: region *and* district; council *and* cadre *and* role; first name and surname *and* a display name; an email domain *and* an email.
- The geography layer is a 21-unit placeholder, and its region picker constrains nothing.

**What we build.** Each of the four forms becomes **one page with numbered sections and no Next**.
- **Ask** only what **approval needs**.
- **Derive** whatever can be derived.
- **Defer** the rest to where it is used: the patient's profile, the staff profile, or the hospital's post-approval setup checklist.
- The region, district and subcounty dropdowns become **one location field**. It is backed by the full UBOS hierarchy and has an optional **Use my location** that turns GPS into an administrative area on our own server.
- Hospitals are **found on the MoH facility registry**, not typed.

**The trust anchors do not weaken.**
- Clinicians: council number plus practising licence.
- Non-clinical staff: NIN plus employer attestation.
- Hospitals: a registry listing or operating licence, a signed authorisation, and an independent senior officer.
- The data-processing agreement is signed **after** verification and **before** any patient data exists.

---

## 1. Ground truth and reading order

1. **The repo wins** over this prompt, the extraction and the screenshots.
   - Evidence used here: the extraction (25 Sep 2026, §1–§11), tester feedback (25 Sep), and screenshots of `medsync-six.vercel.app`.
   - The screenshots show clinical signup steps 1–2, and hospital application step 1 on Test Hospital-4, where the form accepted **Region: Western + District: Gulu**.
   - Confirm each problem in code and data. Report every disagreement at STOP 0.
2. **Design and decisions:**
   - `DESIGN-medsync.md` (authoritative) and ADR 0097 (plum = place).
   - Every onboarding, reference-data, hospital-registration and reception-branch ADR.
   - The validated hospital catalogues JSON: facility level (14 options), ownership (7, plus the PNFP bureau sub-field), applicant role (21, grouped).
3. **Code:**
   - Pages: `/get-started`, `app/signup/**`, `app/onboarding/**`.
   - The four signup server actions and their Zod schemas.
   - Shared primitives: `PhoneInput`, `AvatarUpload`, `FileUpload`, the combobox, the step machinery and the consent block.
   - Modules: `lib/legal.ts`, the reference-data modules and seeds, storage and upload code.
   - Admin surfaces: the hospital admin's staff-approval action, the super-admin application review and the hospital setup wizard.
   - `db/schema/**`, `tests/**`, `tests/rls/**`.

## 2. Laws (non-negotiable)

1. **Engine-first.** No surface reads or writes an engine without real tables, real RLS policies and passing tests. Every new table, column, trigger or storage path arrives with RLS probes in the same phase.
2. **Ask only what approval needs.**
   - A field stays on a signup form only if account creation or verification needs it before approval.
   - Everything else is derived (Law 3) or deferred to the screen where it is used.
   - **Every deferred field lands on a real screen in this prompt:** the patient profile, the staff profile or the hospital setup checklist.
   - Nothing is silently dropped. The server keeps accepting the old optional fields during rollout.
3. **Never ask twice.** Derive instead:
   - region from the district;
   - council from the profession;
   - role from profession plus department;
   - display name from first name plus surname;
   - the institutional email domain from the work email;
   - a registry facility's name, level, ownership and location from the registry.
4. **No Next.** One page per form. The only primary button on the page is the submit. Sections can be filled in any order.
5. **The district is the truth.** Region is never an input. The database refuses a sub-unit that is not inside its district, and ignores any region a client sends.
6. **Location privacy.**
   - A patient's GPS position is used once to find their area, then discarded. It is never stored, never logged and never sent to a third party (no Google, Mapbox or other geocoding API).
   - Facility coordinates are not personal data. They are stored.
   - Using patient location for epidemiology still needs its own, independently declinable consent. This prompt does not introduce it.
7. **Trust anchors hold.**
   - Clinicians: council registration number plus practising licence. The licence becomes **required for approval**.
   - Non-clinical staff: NIN plus employer attestation.
   - Hospitals: a registry listing (government) or an operating licence (private/PNFP), plus a signed authorisation, an independent senior officer, and the DPA before provisioning.
8. **DPPA 2019.**
   - The consent notice is visible on every form, in layers.
   - s.8: a child's data may not be processed without a parent's or guardian's prior consent. So under-18 self-signup is blocked for now.
   - Collect the minimum.
9. **Colour.**
   - Teal = action: the submit, links, focus.
   - Plum = place: a dot on the section in view, **never a left-edge bar**.
   - Red `#DC2626` = the Emergency affordance only, on every signup and onboarding route.
   - Validation errors are **amber + icon + text**.
   - Completion ticks are **neutral ink, never green**.
   - Required fields carry no asterisk. Optional ones say "(optional)".
   - Extend the red-scarcity invariant tests to every signup and onboarding route.
10. **Built for a low-end Android on mobile data.**
    - A dropped connection loses nothing, and retries are idempotent.
    - Images are compressed before upload.
    - Search runs on the server.
    - The district list ships with the page, so a district can be chosen offline.
    - No route ships more JavaScript than it does today.
11. **Stack as found.**
    - Next.js 16 App Router; TypeScript strict (no `any`); React Hook Form plus Zod schemas shared by client and server; the ORM already on the branch.
    - **No new dependencies** without stopping to flag.
    - A clean clone must still run with Node 22 + pnpm.
12. **Verified reference data only.**
    - Catalogues come from the validated JSON.
    - Unit counts, codes, register URLs and licensing bodies come from a source recorded with its URL and date.
    - The pharmacy regulator is the **Pharmacy Board of Uganda**, never PSU.
13. **Hands off legal and gating.**
    - Don't change legal texts, consent versions or `signupsOwnerOverride`.
    - No copy promises an email or SMS that the system does not send.

---

## 3. What is wrong today

| # | Problem | Evidence | Severity |
|---|---|---|---|
| O1 | **Too long.** Inputs: 18 / 16 / 15 / 48 (patient / clinical / non-clinical / hospital). Continue presses: 2 / 3 / 0 / 6 | extraction §3–§7, testers | UX, drop-off |
| O2 | **Tiring.** Four dependent pickers just to say what you are (council → cadre → grade → role). A calendar picker for date of birth, so older patients scroll back decades. Uploads come at the very end | §4, testers | UX |
| O3 | **Region doesn't constrain district.** The form accepted Eastern + Arua (tester) and Western + Gulu (screenshot). "Auto-fills from district" is not implemented | tester, screenshot, §11.9 | **Data integrity; emergency routing** |
| O4 | **Geography is a placeholder.** 21 of 146 district-level units. Subcounties exist for Kampala only. No county or parish level, although the settled hierarchy needs both | §9.1, §11.10 | Data integrity |
| O5 | **Hospital asks for the applicant's professional council number.** Administrators who apply don't have one, and it adds nothing to institutional verification | tester, §7 step 5 | UX, trust |
| O6 | **Hospital asks 30+ things verification never uses:** departments, clinics, diagnostics, capacity, connectivity, EMR, phone, email, website, year, address | §7 steps 1–4 | UX, drop-off |
| O7 | Hospital asks for the email domain and the email separately | §7 step 5 | UX |
| O8 | **Licensing doesn't fit Uganda.** A government facility is asked for a "facility licence". The only options are MoH / UMDPC / Other. In fact UNMC licenses private nursing and midwifery clinics, and UMDPC licenses private clinics and hospitals and publishes a register (Appendix C) | §7 step 5 | Trust, UX |
| O9 | **The DPA is accepted before verification**, by whoever fills the form, although the lifecycle already puts `agreement_signed` after `verified` | §7 step 6, lifecycle | Legal |
| O10 | Non-clinical has two required pickers with one option each | §6 | UX |
| O11 | **Grade shows "Loading…" forever** for cadres without grades. **Roles are Internal-Medicine-only**, so a Medical Officer in Surgery must pick "— Internal Medicine" | §11.5–6 | Data integrity |
| O12 | The practising licence is optional, though it is the trust anchor | §11.12 | Trust |
| O13 | Non-clinical staff land on the clinicians' pending page, which talks about a "council registry" and a "clinician role" | §11.1 | Trust, UX |
| O14 | **Inconsistent rules.** Password: 8+ on one form vs 12–72 on the others. "Visiting" vs "Part-time" for the same value. The notice is shown on two forms, not on the other two | §11.2–4 | Consistency, legal |
| O15 | **Patient form.** A display name is asked after first name and surname. The heading promises a home facility but has no field. Under-18s can self-register | §3, §11.7 | UX, legal (DPPA s.8) |
| O16 | **Hospital data quality.** The callback contact is not format-checked. The primary-department list shows all 23 departments. OPD volume reuses the bed bands | §11.9 | Data quality |
| O17 | Nothing is measured. There's no data on where people stop or which field fails | — | Product |
| O18 | The floating Emergency button may cover Continue on small phones | screenshots, to confirm at 360 px | Safety floor, UX |
| O19 | **Documents travel inside the form submission.** A failed upload rolls back the whole hospital account. Large files can hit request-size limits (Next.js server actions default to 1 MB; Vercel functions cap at 4.5 MB) | §7 submit, to confirm (Q18) | Reliability |

---

## 4. Design direction

**Eight rules**
1. **One page, three sections, one button.**
2. **Ask once; derive the rest.**
3. **Ask now only what approval needs; ask for the rest later, where it's used.**
4. **Pick, don't type.** When the list is long, type to search.
5. **Help the phone:**
   - autofill and the right keyboard;
   - phone numbers as people write them (0772…);
   - date of birth as three number boxes;
   - camera capture and compressed uploads.
6. **Never lose work:** a session draft, idempotent retries, and "add the document later".
7. **Say what's needed before the first field.** A time estimate appears only once it has been measured (Phase 7).
8. **Errors are specific and amber**, and summarised at the top with a link to each field.

**Budgets** (baseline measured at Phase 0, met by Phase 7; full table in Section 12)

| | Patient | Clinical | Non-clinical | Hospital (registry-listed) |
|---|---|---|---|---|
| Continue presses | 2 → **0** | 3 → **0** | 0 → **0** | 6 → **0** |
| Inputs shown | 18 → **≤ 11** | 16 → **≤ 11** (+1 for consultants) | 15 → **≤ 9** (+4 optional, folded) | 48 → **≤ 15** |
| Required inputs | 12 → **≤ 9** | 11 → **≤ 10** | 10 → **≤ 8** | ~30 → **≤ 14** |

The clinical required count barely moves because the licence becomes required (Law 7). The effort still drops a lot: four dependent pickers become one, and three Continue presses become none.

---

## 5. Interface specification

### 5.1 Page anatomy (all four forms)

**Header**
- As today: MedSync · ← Choose a different door · Sign in. On phones the link shortens to "← Other doors".
- The Emergency affordance goes wherever the app-wide pattern puts it (Q17). It never covers a field or the submit button.

**Top of the page**
- A kicker, then the H1 (Fraunces 500).
- A one-sentence lead that says **what you'll need**.

**Progress**
- Phone: a sticky bar under the header ("1 of 3 done"), one segment per section.
- Desktop (≥ 1024 px): a sticky rail left of the form listing the sections, each with a state word (Done · 2 to go · Not started).
- A **plum dot** marks the section in view. Tapping an item scrolls to that section.
- Completion ticks are neutral ink.

**Sections**
- Numbered `[01]`, `[02]`, `[03]`, as in the design system. Each section is a card.
- Optional extras sit behind a disclosure inside the section, e.g. "Speed up approval (optional)".

**End of the page**
- The consent block (5.8), then the submit.
- The submit is **never disabled**. Pressing it validates everything, shows the amber error summary at the top, and moves focus there.

**Validation and reveals**
- Each field validates on blur, and again on submit.
- Conditional fields appear in place, in ≤ 200 ms (instantly under reduced motion). They never shift content above the fold.

**Draft**
- Fields autosave to `sessionStorage`, per form.
- Never saved: passwords, ID numbers, NIN, files.
- After a reload, the fields come back with "We kept what you'd typed." The draft is cleared on success.

**Submit**
- Carries a client idempotency key. A retry after a lost response returns the original result, not "email already in use".
- Offline: "You're offline. Nothing is lost. We'll try again when you're back.", with a retry button.

### 5.2 Phone: clinical staff (the doctor path runs through here)
```
┌──────────────────────────────────────┐
│ MedSync   ← Other doors     Sign in  │
│                          (Emergency) │ ← existing affordance; never over a field
│ ■■■■■■■■■■■■□□□□□□□□□□□□ 1 of 3 done │ ← sticky; one segment per section
├──────────────────────────────────────┤
│ CLINICAL STAFF                       │
│ Join your hospital on MedSync        │
│ You'll need your council registration│
│ number and your practising licence   │
│ (a phone photo is fine; you can add  │
│ it after you submit).                │
│                                      │
│ [01] YOU                      ✓ Done │ ← tick in neutral ink
│ Full name       [                  ] │
│ Email           [                  ] │
│ Mobile number   [+256][ 772 123 456] │ ← 0772… accepted
│ Password  Show  [                  ] │
│ 12 or more characters. A short       │
│ sentence works well.                 │
│                                      │
│ [02] YOUR PRACTICE       • 2 to go   │ ← plum dot = section in view
│ Profession                           │
│ [ ⌕ Registered nurse             ▾ ] │
│ Registered with UNMC                 │ ← derived, read-only
│ UNMC registration number             │
│ [                                  ] │
│ As printed on your certificate.      │
│ Practising licence                   │
│ ┌──────────────────────────────────┐ │
│ │  Take a photo  ·  Upload a file  │ │
│ │  PDF, JPG or PNG                 │ │
│ └──────────────────────────────────┘ │
│ Don't have it with you? Add it later │
│                                      │
│ [03] WHERE YOU WORK                  │
│ Hospital                             │
│ [ ⌕ Search hospitals             ▾ ] │
│ My hospital isn't on MedSync         │
│ Department                           │
│ [ ⌕ Choose your hospital first   ▾ ] │
│ Employment                           │
│ (Full-time) (Visiting/part-time)     │
│ (Locum)                              │
│                                      │
│ How we use your details              │
│ · two or three lines from v1.0 …     │
│ Read the full notice (v1.0) ▸        │
│ ☐ I agree to MedSync's data-         │
│   processing notice                  │
│ [        Submit for approval       ] │ ← teal; the only primary button
│ Your hospital admin reviews this,    │
│ then you set up two-step sign-in.    │
└──────────────────────────────────────┘
```

**The doctor path:**
1. Profession: "Medical officer".
2. The page shows "Registered with UMDPC" and asks for the "UMDPC registration number". Interns give their provisional registration number.
3. Practising licence.
4. Hospital, then department.
5. Submit.

Consultants and senior consultants also choose a **Specialty**. After approval and two-step setup they land on `/doctor`, as today.

### 5.3 Desktop: hospital application
```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ MedSync   ← Other doors                                     Sign in  (Emergency) │
├──────────────────────┬──────────────────────────────────────────────────────────┤
│ [01] Your facility   │ HOSPITAL APPLICATION                                     │
│      ✓ Done          │ Apply to bring your hospital onto MedSync                │
│ [02] You             │ For whoever applies on the hospital's behalf, clinical   │
│    • 2 to go         │ or not. You'll need a signed letter from a senior        │
│ [03] Proof and       │ officer authorising you (you can upload it after you     │
│      authority       │ submit) and, for a private facility, its operating       │
│      Not started     │ licence.                                                 │
│ Agree and submit     │                                                          │
│                      │ [01] YOUR FACILITY                                       │
│ (plum dot = section  │ Find it on the MoH facility registry                     │
│  in view; no bars)   │ [ ⌕ example general                                    ] │
│                      │ ┌──────────────────────────────────────────────────────┐ │
│                      │ │ Example General Hospital                             │ │
│                      │ │ General Hospital · Government                        │ │
│                      │ │ Example District · Northern region · Registry 000000 │ │
│                      │ │                   Something wrong?  ·  Not this one  │ │
│                      │ └──────────────────────────────────────────────────────┘ │
│                      │ Can't find it? Enter your facility yourself              │
│                      │                                                          │
│                      │ [02] YOU, THE APPLICANT                                  │
│                      │ Full name  [                ]  Your role [ ⌕        ▾ ] │
│                      │ Work email [                ]  Mobile [+256][         ] │
│                      │ Password   [                ]  Your work email signs you │
│                      │                                in.                       │
│                      │ [03] PROOF AND AUTHORITY                                 │
│                      │ Government facility: your registry listing is the proof. │
│                      │ Who authorised you to apply? (not you)                   │
│                      │ Name  [               ]  Title [ ⌕                   ▾ ] │
│                      │ Phone [+256][         ]  Email [                       ] │
│                      │ At least one. We'll contact them to confirm.             │
│                      │ Their signed letter naming you                           │
│                      │ [ Take a photo · Upload a file ]   Add it later          │
│                      │                                                          │
│                      │ How we use your details · Read the full notice ▸         │
│                      │ ☐ I agree to MedSync's data-processing notice            │
│                      │ [ Submit application ]                                   │
│                      │ Next: we check your documents and contact the officer    │
│                      │ who authorised you. Then you sign the data-processing    │
│                      │ agreement and set up your hospital.                      │
└──────────────────────┴──────────────────────────────────────────────────────────┘
```

### 5.4 What each form asks
The full keep / derive / defer ledger is in Appendix A.

**Patient**
- **[01] About you:** first name · surname · sex at birth · date of birth (Day / Month / Year boxes) · mobile number.
- **[02] Where you live:** location (search or Use my location), then "Village or cell (optional)", which appears after a choice.
- **[03] Your sign-in:** email · password.
- **Then:** the notice and consent, and the optional, unticked "SMS about my bookings".
- **Under 18** (from the date of birth): the submit is replaced by *"MedSync accounts for people under 18 need a parent or guardian. This isn't available online yet."* Nothing is stored. The copy is for CSO and lawyer sign-off.
- **After signup:** the welcome shows a **Complete your profile** card with:
  - your ID (NIN, passport, other: D12);
  - someone we can call in an emergency (next of kin);
  - your usual hospital;
  - photo, title, and preferred language (from the language catalogue).

**Clinical**
- **[01] You:** full name · email · mobile · password.
- **[02] Your practice:**
  - profession;
  - specialty (consultant cadres only);
  - registration number (the label names the council);
  - practising licence (or "add later").
- **[03] Where you work:**
  - hospital, plus "My hospital isn't on MedSync";
  - department;
  - employment: Full-time (default) · Visiting/part-time · Locum.
- **"My hospital isn't on MedSync"** opens a short form: hospital name, district, and an optional contact at the hospital. It saves a hospital lead through the existing action and creates no account.
- **Then:** consent.
- **Deferred to the staff profile:** photo; grades that don't change scope; licence expiry (the approving admin can record it from the document).

**Non-clinical**
- **[01] You:** full name · work email · mobile · password.
- **[02] Your identity:**
  - NIN (soft format check);
  - a disclosure, "Speed up approval (optional)", holding: appointment letter · staff number · a senior who can vouch for you (name, role).
- **[03] Where you work:**
  - hospital · department or unit · employment.
  - The role is shown as text ("You're joining as Reception / Records Officer"), not asked.
- **Then:** consent.

**Hospital**
- **[01] Your facility:**
  - A registry search, then a confirmation card: name · level · ownership · district · region · registry code.
  - On the card: "Something wrong?" (a note, ≤ 300 characters) and "Not this one".
  - Fallback, "Enter it yourself": official name · facility level (14 options) · ownership (7 options; PNFP → bureau) · location.
- **[02] You, the applicant:** full name · your role (21 options, grouped) · work email (your sign-in) · mobile · password.
- **[03] Proof and authority:**
  - Proof depends on ownership (5.7).
  - "Who authorised you to apply?": name · title · phone and/or email (at least one; not yours) · their signed letter naming you (it can come later).
- **Then:** consent.
- **Below the button:** *"Next: we check your documents and contact the officer who authorised you. Then you sign the data-processing agreement and set up your hospital."*

### 5.5 The location field
```
│ [02] WHERE YOU LIVE                  │
│ [ ◎ Use my location ]                │ ← teal outline; asks permission only on tap
│ If you're at home now.               │
│ or search                            │
│ [ ⌕ kawempe                        ] │
│   Kawempe Division                   │
│   Kampala · Central region           │
│ ── after a choice ──                 │
│ Kawempe Division, Kampala            │
│ Central region                Change │
│ Found with your location (± 25 m).   │
│ We don't keep your exact position.   │
│ Village or cell (optional)  [      ] │
```

**Search**
- One field: "Search your village, parish, sub-county or district".
- Starts at 2 characters, debounced by 250 ms, runs server-side, and returns ≤ 8 results.
- Each result shows its full path. District-level units show their type ("Gulu City", "Gulu District").
- Choosing a result sets every level above it.
- The region is shown as text under the field. It is never chosen.

**Use my location**
- Asked only on tap, never on page load. Uses `enableHighAccuracy` and a 10 s timeout.
- Accuracy ≤ 2 km: fill the lowest boundary level available (parish or sub-county).
- Accuracy 2–20 km: fill the district only, with "Choose your sub-county to be more precise".
- Accuracy > 20 km, outside Uganda, or permission denied: fill nothing, and focus the search with a one-line reason.

**Offline**
- The embedded district list still works. Lower levels say "Needs a connection".

**Village or cell**
- A dataset unit if the chosen dataset has villages. Otherwise free text (encrypted, ≤ 200 characters), as today.

**Hospital form**
- Prefilled from the registry. The manual path uses the same field.
- No GPS at application: facility coordinates are set in the setup checklist (5.10).

### 5.6 The profession field
- **One searchable list, grouped by regulator:**
  - Doctors and dentists · UMDPC
  - Nurses and midwives · UNMC
  - Allied health · AHPC
  - Pharmacy · Pharmacy Board of Uganda
- Options fold the cadre together with any grade that changes scope (enrolled vs registered nurse and midwife). The full mapping is in Appendix B.
- Each option carries search keywords ("doctor", "MO", "lab", "CO", "physio").
- **The council is shown, not chosen.** It appears as text ("Registered with UNMC") and names the registration-number field ("UNMC registration number").
- Interns get the helper text "Interns: your provisional registration number."
- **Specialty** (required) appears only for consultant and senior consultant. It comes from the specialties catalogue.
- There is no grade picker and no role picker.

### 5.7 Documents: submit now, add later

**The upload box**
- Take a photo (camera) · Upload a file · PDF, JPG or PNG.
- Images are re-encoded on the device before upload: long edge ≤ 1600 px, JPEG. This also strips EXIF data, including GPS tags.
- PDFs go as they are. The server re-validates type and size, as today.

**"Add it later"**
- The link "Don't have it with you? Add it later" collapses the box to one line.
- Clinical: *"Practising licence: add it after you submit. Your admin can't approve you until it's here."*
- Hospital: *"… Review starts when it's here."*

**When uploads happen**
- **After** the account exists, directly to private storage with the new session, showing progress.
- A failed upload leaves the document outstanding. It never rolls back the account.
- The pending page shows "Still needed" cards with the same upload box.

**Hospital proof, by ownership**

| Ownership | Proof asked for |
|---|---|
| Government | The registry listing is the proof. No document. On the manual path, a registry or HMIS code is optional |
| PNFP | Bureau (from the registry, or asked) plus bureau accreditation or operating licence: number plus document |
| Private | Operating licence: issuing council (UMDPC / UNMC / AHPC, validated at GATE A) plus number plus document |

### 5.8 Consent block (identical on all four forms)
- **"How we use your details":** 2–3 lines restating clauses of the published notice only. No new commitments.
- **"Read the full notice (v1.0, effective 23 May 2026)"** expands the exact text.
- **Checkbox:** "I agree to MedSync's data-processing notice". The version and SHA-256 are recorded as today.
- **A gap to flag, not fix in copy:** the v1.0 notice lists four purposes, and none is verifying a staff member's credentials. Don't paper over this in UI copy; flag it for the lawyer (D19).
- **Patient only:** the separate, unticked SMS box, unchanged.

### 5.9 After submitting

**Clinical pending page**
- The structure is unchanged.
- The copy says "{council} register", not "{cadre} council registry".
- A "Still needed" card shows while the licence is missing.

**Non-clinical pending page** (its own page, or its own variant)
- *"We're confirming your employment with {hospital}. Your hospital admin checks your details against their staff records."*
- No council, no clinician role.
- After approval: two-step setup, then `/reception`.

**Hospital pending page**
- "Still needed" cards.
- After `verified`: the agreement gate (5.10).

**Promises of email or SMS**
- A line promising an email or SMS appears only if Q11 proves one is sent. Otherwise it says "Check back here for updates."

**The hospital admin's staff approval**
- Approve is blocked, on the server and in the UI, while the licence is missing ("Waiting for the licence").
- For UMDPC professions, a "Check the UMDPC register" link opens the ehealthlicense.go.ug search (verify the URL at build time). Add other councils' registers only if verified.
- An optional "Licence valid until" date, recorded from the document.

**The super-admin application review**
- Flags: `facility_source` (`registry` / `manual`), `duplicate_facility`, `public_email_domain`, `email_domain_mismatch`, the correction note, and documents outstanding.
- Registry contact details, if the export has them, shown as an independent callback.
- The queue splits in two: **Ready for review** and **Waiting for documents**.

### 5.10 Hospital: agreement gate and setup checklist

**Agreement gate** (on the pending page once `verified`)
- Reuses today's step 6 component: the full DPA text, version and hash, the amber placeholder banner, signatory name and title, "I am authorised to bind…" and "I accept…".
- Sets `agreement_signed`. Provisioning follows, as today.

**Setup checklist**
- Replaces a linear wizard (if the wizard is linear: Q7).
- Tasks can be done in any order. Each is a short page or sheet, with a count at the top. There is no Next.

```
┌ Set up Example General Hospital ────────────────────────────────┐
│ Needed to go live: 2 of 3 done                                  │
│  ✓ Backup admin ........................................ Change │
│  ✓ Wards ............................................... Change │
│  ○ Departments and where you'll start ................... Start │
│ Recommended                                                     │
│  ○ Facility location (for emergency directions) ........... Set │
│  ○ Emergency and services ............................... Start │
│  ○ Operating profile: internet, power, size ............. Start │
│ Optional                                                        │
│  ○ Contact details, website, landmark ..................... Add │
│ Agreement signed (v0.placeholder) · by … · date ........... View │
└─────────────────────────────────────────────────────────────────┘
```

**Needed to go live** (recommended set: D17)
- **Departments and where you'll start:**
  - a grouped checklist, with IM sub-specialties;
  - "Other" free text, up to 5;
  - the start-department picker lists **only the ticked departments**.
- **Backup admin.**
- **Wards**, per the existing rule.

**Recommended**
- **Facility location:**
  - Either use this device's location while you're at the facility, or confirm the registry coordinates.
  - The accuracy is shown.
  - The point must fall inside the facility's district, or the task asks again.
- **Emergency and services:**
  - Emergency 24/7, OPD, inpatient, day-care, referral;
  - clinics, diagnostics, support services;
  - on-site pharmacy.
- **Operating profile:** internet, power, capacity bands, OPD volume (on its own bands, not the bed bands), EMR.

**Optional**
- **Contact details:** main phone, official email, website, also-known-as, year established, directions or landmark.

### 5.11 The chooser (`/get-started`)
- Update each door's "You'll need" to match the new forms.
- The hospital door gains a secondary link, "Not ready to apply? Ask us to call you", wired to the existing lead action (D15).

### 5.12 Small things that remove friction

| Field | Behaviour |
|---|---|
| Mobile number | Accept 0772…, 772…, +256… and 256…, with or without spaces. Normalise to E.164. Never error on a leading 0. `inputmode="tel"`, `autocomplete="tel-national"` |
| Email | `autocomplete="email"`, lowercased. Offer "Did you mean …@gmail.com?" for common typos, from a local list (gmail, yahoo, outlook, hotmail, icloud, go.ug, ac.ug, co.ug) |
| Names | `autocomplete="given-name"` / `"family-name"` / `"name"`, `autocapitalize="words"`. Never reformat |
| Date of birth | Three boxes, `inputmode="numeric"`, `autocomplete="bday-day"` / `"bday-month"` / `"bday-year"` |
| Password | 12–72 characters (see Q2 on bytes). Show/hide. Paste and password managers allowed. Blocklist of common passwords. `autocomplete="new-password"` |
| NIN | Uppercase, monospace, `autocomplete="off"`. Soft check: 14 characters, and citizens start CM or CF. A warning, never a block |
| Registration number | Free text, as printed. No format rules |
| Every input | `enterkeyhint="next"` (`"done"` on the last one). Touch targets ≥ 44 px |

---

## 6. The engines

Every rule below gets an ID and at least one test.

### 6.1 Location (`lib/geo/**`)

**Data**
- The full hierarchy, keyed by UBOS codes:
  - region;
  - district or city;
  - county, municipality or city division;
  - sub-county, town council or division;
  - parish or ward;
  - village or cell (if the dataset has it).
- Every unit carries a denormalised `district_id` and `region_id`, a normalised search name and a centroid.
- Boundaries for the lowest polygon level available, simplified, and loaded lazily in the server process for reverse geocoding.

**Rules**
- **LOC-1** The database derives region from the district. A client-supplied region is ignored.
- **LOC-2** Every unit has exactly one parent, at the level above. Cities are district-level units, with divisions below them.
- **LOC-3** A record stores one unit id (the lowest chosen) plus optional village text. Ancestors are derived.
- **LOC-4** A trigger rejects any record whose lower unit is not inside its district.
- **LOC-5** Search ranking:
  - prefix matches first, then contains or fuzzy matches;
  - ties go to the higher level;
  - ≤ 8 results, each with its full path;
  - p95 < 150 ms server time on the full dataset.
- **LOC-6** Reverse geocoding: a bounding-box prefilter, then point-in-polygon on the lowest level available. Accuracy rules as in 5.5. Outside Uganda returns nothing.
- **LOC-7** Patient coordinates are never persisted, never logged, and never leave our server.
  - Prove it with a logger spy, a database diff and an outbound-request check.
  - Sentry and platform logs must not capture the request body of `resolvePlace`.
- **LOC-8** The district-level list (~146 units, each with its region) is embedded in the page. Report its size.
- **LOC-9** Legacy mapping.
  - Old seed ids map to new units by code or name.
  - Ambiguous city-vs-district cases (e.g. "Fort Portal", "Gulu") are listed for a human, never guessed.
  - Existing mismatched region values are recomputed and reported.
- **LOC-10** The import is repeatable. It reports counts per level against expected, orphans, duplicates, and the dataset vintage, including whether the cities created since 2020 are represented.

### 6.2 Facility registry (`lib/registry/**`)

**Data**
- `registry_facilities`, built from the MoH National Health Facility Registry export. Fallback: the MFL 2018 list.
- Fields: registry code, name, level, ownership or authority, location unit, coordinates and contacts if present, status.

**Rules**
- **REG-1** Reference data, read-only to clients.
- **REG-2** Each facility maps to a location unit through a crosswalk. Unmatched rows are reported.
- **REG-3** Picking a registry facility copies its name, level, ownership, location and code, and locks them. The applicant can only say "Not this one" or leave a correction note.
- **REG-4** One live tenant per registry code. A second application for a code with an active tenant or an open application is flagged `duplicate_facility`, not blocked.
- **REG-5** The manual path is always available, and flagged `facility_source = manual`.
- **REG-6** Registry levels and ownership map to the validated catalogues. Unmapped values are reported, not coerced.

### 6.3 Profession and role (`lib/onboarding/profession.ts`)
- **PRO-1** Every profession option maps to exactly one triple: council, cadre, and grade or null (Appendix B). The council is never chosen.
- **PRO-2** Role and specialty.
  - The role is the cadre's generic role, added by migration.
  - Consultant cadres require a specialty.
  - The department comes from the affiliation.
  - No new affiliation is tied to Internal Medicine unless its department is.
- **PRO-3** Existing affiliations keep their role ids. Everything that reads roles (Q5) keeps working.
- **PRO-4** The registration-number label and the pending-page copy name the derived council.

### 6.4 Documents outstanding (`lib/onboarding/documents.ts`)
- **DOC-1** A clinical affiliation cannot be approved without a licence on file. The server enforces it, and the UI says why.
- **DOC-2** A hospital application is `ready_for_review` only when its required documents are on file: the letter always, plus the licence for private and PNFP facilities. Incomplete applications sit in "Waiting for documents".
- **DOC-3** Only the account owner uploads their outstanding documents (storage RLS on the owner's path). The existing readers (hospital admin, super-admin) are unchanged.
- **DOC-4** A document is attached only after the server re-validates the stored object: type, size and path.

### 6.5 Funnel events (`onboarding_events`)
- **EV-1** No values, names, emails, phones, IDs, coordinates or IP addresses. Events carry only:
  - form;
  - event (`start`, `section_complete`, `submit_attempt`, `submit_ok`, `field_error`);
  - section, field key, error code;
  - elapsed ms;
  - a random per-tab id.
- **EV-2** Written only through a rate-limited server action. Readable by super-admins only.
- **EV-3** Retention: 180 days, as a setting.

---

## 7. Data changes (only what GATE A approves; additive; next free migration number)

**Geography**
- Either the hierarchy tables or one `geo_units` table (E1), plus the search index, consistency triggers and legacy mapping.
- Boundary files go under `data/geo/`. Report their size; no git-lfs.

**Registry**
- `registry_facilities`, plus the crosswalk.

**Roles**
- One generic role per cadre.
- Server validation: a specialty is required for consultant cadres.

**Hospital applications**
- New columns: `registry_code`, `facility_source` (`registry` | `manual`), `registry_correction_note`.
- New flags: `duplicate_facility`, `public_email_domain`.
- Officer phone and officer email replace the callback kind + value pair. Migrate the existing rows.
- A documents-complete view.
- `region_id` becomes derived.
- The step 2–4 and contact columns stay; the setup checklist writes them.
- The DPA columns are written by the agreement gate.

**Facility location**
- `facility_locations`: hospital, lat, lng, accuracy (m), source (`registry` | `device`), captured by/at, confirmed by/at.

**Other tables**
- Setup-checklist state per hospital. Reuse the wizard's state if it exists.
- `onboarding_events`.
- Idempotency keys: form, key hash, result reference, expiry after 24 h.

**Rate limiting**
- Reuse the existing mechanism (Q18). If there is none, use a fixed-window counter keyed by a salted hash of the IP. Never store the raw IP.

**RLS probes** for every new table, column, trigger and storage path:
- Actors: anonymous, patient, same-hospital staff, other-hospital staff, hospital admin, super-admin.
- Reference data is read-only to clients.
- Client INSERT, UPDATE and DELETE are denied except where named.

## 8. Server actions

Reuse, don't duplicate.

**Changed: the four signup actions**
- v2 schemas.
- They derive region, council, role, display name and email domain.
- They accept the old optional fields during rollout.
- They take an idempotency key.

**New**
- `searchPlaces({ q })`: public, rate-limited.
- `resolvePlace({ lat, lng, accuracyM })`: public, rate-limited. Logs nothing about the position (LOC-7).
- `searchRegistryFacilities({ q })`: public, rate-limited.
- `attachDocument({ kind })`: owner only, after a direct upload (DOC-4).
- `recordOnboardingEvent(...)`: public, rate-limited, with a PII-free schema (EV-1).
- Setup checklist: `saveDepartments`, `saveServices`, `saveOperatingProfile`, `saveFacilityContacts`, `setFacilityLocation`, `confirmFacilityLocation`. Reuse existing wizard actions where they exist.
- `signAgreement`: reuse the step 6 logic.
- Hospital lead: link the existing action from the hospital door and from "My hospital isn't on MedSync".

**Contract, as elsewhere**
- `'use server'` and Zod.
- Auth and role checks where the caller is authenticated.
- One transaction per action, and an audit row for state changes.
- A typed result.
- Notification failures never throw.

---

## 9. Phases and gates

### Phase 0 — Discovery and baseline (no product changes)

**Answer and report:**
- **Q1** ORM, migration pattern, and database locally (PGlite?) and in production. Is `pg_trgm` available in both?
- **Q2** Auth library and password hasher (does bcrypt's 72-byte ceiling apply?). How does each action create and roll back the login account?
- **Q3** File map for the four forms and every shared primitive. Are the client and server Zod schemas shared?
- **Q4** Geography schema.
  - Every column that stores region, district or subcounty, and every consumer (SMS routing, queue suggestions, reports).
  - Write **failing** tests: Eastern + an Arua unit saved; Western + Gulu saved.
- **Q5** Every reader of `role_id`, role codes or role names: RBAC, `/doctor` vs `/clinician` routing, workspace cadre checks. Can generic roles land without breaking them?
- **Q6** The seeded cadres, grades and roles. Confirm that "Specialist Nurse" exists as both a cadre and a grade. Root-cause the grade "Loading…" bug with a failing test.
- **Q7** Hospital lifecycle.
  - Where is each state set?
  - Is the application's DPA reused at `agreement_signed`?
  - Does provisioning read the application's departments?
  - What does the setup wizard hold, and is it linear?
- **Q8** Where does the validated catalogues JSON live, and why does the form show 8 levels, 4 ownership options and 6 roles?
- **Q9** Profile pages for patients and staff: what exists and what can be edited there? Can a clinician add a licence after submitting today?
- **Q10** The hospital admin's approve action and the super-admin review. Can the licence precondition and the new flags be added cleanly?
- **Q11** Does anything send email or SMS on approval or rejection? List every copy line that promises one.
- **Q12** Is there any invite or token mechanism for staff (the `/sign-up` page)? Could it later prefill hospital and department?
- **Q13** The hospital-lead action: file, fields, storage, readers.
- **Q14** The feature-flag mechanism.
- **Q15** Are Playwright, axe and Lighthouse present? If not, STOP and flag (Law 11).
- **Q16** Tokens in `DESIGN-medsync.md` for fields, errors, segmented controls, radio cards, section numbers, the plum marker and the focus ring. Is the required asterisk `#DC2626`?
- **Q17** The Emergency affordance on public pages: floating or in the header? Does it cover Continue at 360×640?
- **Q18** Uploads and limits.
  - Buckets, path pattern and storage RLS.
  - The request-size limits in play: the server-action body limit and Vercel's 4.5 MB.
  - Any existing compression.
  - Any existing rate limiter.
- **Q19** Production data per form (accounts, applications, uploaded licences), and whether any belong to real people. Needed for migration safety.
- **Q20** Which datasets are to hand:
  - the UBOS unit list (vintage, levels, codes);
  - boundary files (source, licence, levels);
  - the NHFR export or the MFL 2018 list.

**Baseline:**
- Screenshots of every step of every form at 360×740, 390×844 and 1440×900. The patient form also in dark mode.
- Per form: inputs, required inputs, Continue presses, dependent pickers, and taps to finish the council → role chain.
- A scripted completion per form (Playwright, fixed typing speed): time to submit. For relative comparison only.
- axe and Lighthouse (mobile) per route. First-load JS per route.
- Failing tests for O3, O11, O13, O15 (under-18 accepted) and O16 (callback format).

**STOP 0.** Report Q1–Q20, every prompt-vs-repo difference, the failing tests and the baseline.

### Phase 1 — GATE A proposal (documents only)
Write `docs/onboarding-v2/gate-a-proposal.md`:
- **Annotated wireframes** (phone and desktop) for the four forms, the three pending states, the agreement gate and the setup checklist. Start from Section 5; improve it, don't bloat it.
- **Appendix A** (field ledger) corrected against the repo, and **Appendix B** (profession mapping) checked against the seed.
- **The location engine:** chosen dataset(s), levels, codes, expected counts, boundary level, crosswalk plan, legacy mapping.
- **The registry import plan** and crosswalk.
- **The schema diff** (Section 7), with the migration and legacy-data plan: report, never guess.
- **A copy deck** for every heading, helper, error and pending state, and for the under-18 message.
- **The test plan, the ADR drafts, and the decision table** (Section 13) with a signature block.

**STOP 1.** Nothing proceeds without Fadhul's signature.

### Phase 2 — Engines and data
Build the Section 6 engines and the Section 7 changes: migrations, imports, triggers, RLS probes, rate limiting and the funnel table.

**STOP 2.** Report:
- The import reports: counts per level against expected, orphans, unmatched facilities, dataset vintage.
- Rule coverage: every LOC, REG, PRO, DOC and EV rule mapped to its tests.
- The RLS probe table.
- p95 for search and reverse geocoding.
- The Phase 0 tests for O3 and O11 passing at the engine level.

### Phase 3 — Form kit

| Component | Does |
|---|---|
| `SectionedForm` | Sections, progress bar/rail, error summary, draft, idempotent submit, offline retry, funnel events |
| `LocationField` | Search plus Use my location (5.5) |
| `ProfessionField` | One grouped, searchable list with derived council (5.6) |
| `MemorableDateInput` | Day / Month / Year boxes |
| `PhoneInput` | Accepts 0772… and other ways of writing a number; normalises to E.164 |
| `EmailField` | Typo hint |
| `PasswordField` | Policy plus blocklist |
| `DocumentUpload` | Camera, compression, "add later", direct upload |
| `ConsentBlock` | The layered notice (5.8) |

Write component tests, plus a kit test page behind the flag.

**STOP 3.** Report:
- Screenshots of each component in every state: empty, filled, error, loading, offline, reduced motion, dark.
- axe clean.
- The JS delta.
- The upload size of a 4 MB phone photo.

### Phase 4 — Patient
- Patient form v2.
- The under-18 guard.
- The "Complete your profile" page and welcome card: ID (per D12), next of kin, usual hospital, photo, title, language.

**STOP 4.** S1–S4 and S12–S13 results, counts against budget, screenshots.

### Phase 5 — Staff
- Clinical and non-clinical forms v2.
- Pending pages: split copy, "Still needed" cards.
- The approval precondition, register link and licence date.
- The "My hospital isn't on MedSync" lead.

**STOP 5.** S5–S8, counts against budget, screenshots.

### Phase 6 — Hospital
- Application v2: registry search, manual path, proof by ownership, the authority section, the derived email domain.
- The agreement gate after verification.
- The setup checklist.
- Super-admin review flags and the split queue.
- Chooser updates and the "Ask us to call you" lead.

**STOP 6.** S9–S11, counts against budget, screenshots, and a full lifecycle run on a test application.

### Phase 7 — Verification, usability, hardening

**Scenarios**
- S1–S15 green on 360 px and on desktop.
- Flag off: the old forms are unchanged (S14).

**Usability kit for Fadhul**
- The test build URL (flag on) and a one-page script.
- 5 testers per form:
  - patient: at least 2 aged 50+ or less confident with phones;
  - clinical: a doctor, a nurse and an allied professional;
  - non-clinical: a receptionist if possible;
  - hospital: an administrator with no clinical background.
- Tasks, and a results sheet recording:
  - completed (y/n), time, errors;
  - Single Ease Question (1–7);
  - "What was most tiring?"
- A funnel report: a super-admin page or a script, whichever is smaller (flag the choice at STOP).

**Time estimates**
- Once measured, add "About N minutes" to each form's lead (the median, rounded up).

**Hardening**
- Performance, reduced motion, dark mode, ADRs, final report.

**STOP 7 (final).** Section 12, filled in.

### Scenarios
- **S1** Patient on a 360 px phone, mocked GPS at ± 25 m:
  - the location fills to the lowest level;
  - submit creates the account, with no Continue anywhere;
  - no coordinates in the database or logs.
- **S2** Patient types "Arua". Both Arua City and Arua District appear, each labelled "Northern region". No region control exists.
- **S3** A crafted request sends Eastern + an Arua unit: the saved region is Northern (or the request is rejected). A sub-county from another district is rejected.
- **S4** A date of birth under 18 shows the guardian message. Nothing is stored.
- **S5** "Registered nurse":
  - the page shows "Registered with UNMC" and asks for the "UNMC registration number";
  - department Surgery saves a generic Nurse role plus Surgery;
  - no grade or role picker appears.
- **S6** Clinical submit with "Add it later":
  - pending shows "Still needed";
  - the admin's Approve is blocked, with the reason;
  - after an upload from the pending page, Approve works.
- **S7** Consultant: Specialty is required, and it is saved.
- **S8** Non-clinical: no role pickers; its own pending copy, with no "council" and no "clinician role".
- **S9** Hospital, government, registry-listed:
  - ≤ 12 inputs, no licence field, no DPA;
  - lifecycle: agreement gate after `verified` → provisioning → setup checklist.
- **S10** Hospital, private, not listed:
  - a manual facility plus a council licence;
  - the letter is added later from pending, and the application moves to Ready for review.
- **S11** A second application for a registry code with an active tenant shows the `duplicate_facility` flag to the super-admin.
- **S12** The network drops at submit:
  - nothing is lost, and the retry succeeds exactly once (idempotent);
  - a reload restores the draft, without the password, ID numbers or files.
- **S13** Phone typed as "0772 123 456" is accepted and stored as `+256772123456`.
- **S14** Flag off: the four old forms behave exactly as at baseline.
- **S15** At 360×640 the Emergency affordance never covers a field or the submit button. Red appears nowhere else on any signup route.

---

## 10. Accessibility, motion, colour
- **Standard:** WCAG 2.2 AA, in light and dark.
- **Fields:**
  - every input has a visible label;
  - helper and error text are linked with `aria-describedby`;
  - errors set `aria-invalid`.
- **Error summary:** focused on submit; each entry links to its field.
- **Controls:**
  - segmented controls are radio groups;
  - the profession and location fields are ARIA comboboxes whose options read the full path.
- **Progress rail:** a `nav`. The current section carries `aria-current="step"`, not colour alone, and each item has its state word.
- **Colour is never alone.** Amber errors carry an icon and text.
- **Reduced motion:** reveals are instant.
- **Plain language:**
  - patient copy at reading grade 8 or lower (report the score);
  - no "cadre", "affiliation" or "tenant" on public forms.

## 11. Performance budgets

| Measure | Budget |
|---|---|
| First-load JS per route | ≤ baseline |
| Search | p95 < 150 ms server time |
| Reverse geocoding | p95 < 200 ms warm (report cold) |
| Embedded district list | ≤ 8 KB gzipped |
| A 4 MB phone photo | uploads as ≤ 1 MB |
| Layout shift from reveals | zero |
| Lighthouse mobile | accessibility ≥ 95; performance ≥ baseline |

## 12. Numbers to report at the final STOP

| Metric | Baseline | Target | Result |
|---|---|---|---|
| Continue presses (patient / clinical / non-clinical / hospital) | 2 / 3 / 0 / 6 | 0 / 0 / 0 / 0 | |
| Inputs shown by default | 18 / 16 / 15 / 48 | ≤ 11 / ≤ 11 / ≤ 9 / ≤ 15 | |
| Required inputs | 12 / 11 / 10 / ~30 | ≤ 9 / ≤ 10 / ≤ 8 / ≤ 14 | |
| Pickers to say what you are (clinical) | 4 | 1 (+ specialty for consultants) | |
| Single-option pickers | 2 | 0 | |
| Region inputs | 1 | 0 | |
| Impossible location pairs accepted (fixture) | P0 | 0 | |
| District-level units available | 21 | all in the dataset (report vs 146) | |
| Lowest searchable level | sub-county (Kampala only) | parish, or the lowest in the dataset | |
| Registry facilities imported / matched to a district | — | report / ≥ 98 % | |
| Scripted time to submit, per form | P0 | ≥ 40 % less | |
| Usability per form: completion / median time / SEQ | — | ≥ 90 % / report / ≥ 6 of 7 | |
| Patient coordinates found in DB, logs or outbound requests | — | 0 | |
| Rule IDs without a test | — | 0 | |
| RLS probes passed | — | 100 % | |
| axe serious/critical | P0 | 0 | |
| Lighthouse mobile accessibility | P0 | ≥ 95 | |
| First-load JS per route | P0 | ≤ baseline | |
| Upload size of a 4 MB phone photo | ~4 MB | ≤ 1 MB | |
| Red outside the Emergency affordance on signup routes | P0 | 0 | |

## 13. GATE A decisions (Fadhul owns; recommendations given)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Form pattern | One page per form: numbered sections, no Next, a progress rail, a session draft |
| D2 | What each form asks | Approve Appendix A as written |
| D3 | Location dataset (the long-open UBOS decision) | UBOS units from the 2024 census frame for names and codes down to parish. Villages if UBOS provides them, otherwise free text. Boundaries from OCHA COD-AB or geoBoundaries, chosen on licence, vintage and level. A repeatable import |
| D4 | Patient location precision | Keep the chosen unit (down to parish) plus optional village text. GPS is used once and discarded. A home GPS point for emergencies comes later, as its own opt-in |
| D5 | Facility source of truth | The MoH National Health Facility Registry export, requested through MoH's health-information side. MFL 2018 as the fallback |
| D6 | Hospital application scope | Facility, applicant, proof and authority. Everything else moves to the setup checklist |
| D7 | DPA timing | After `verified` and before provisioning, signed by an authorised signatory. This matches the existing lifecycle states |
| D8 | Applicant's council number | Remove it |
| D9 | Proof by ownership | Government: the registry listing, no document. PNFP: bureau accreditation or a licence. Private: the council operating licence (UMDPC / UNMC / AHPC; confirm AHPC's scope) |
| D10 | Documents after submitting | Allow it for the clinical licence and for the hospital letter and licence. Approval and review wait for them. The clinical licence becomes required for approval |
| D11 | Profession and roles | One profession picker and a generic role per cadre. Consultants choose a specialty. "Specialist nurse" exists as a cadre only; drop the duplicate grade |
| D12 | Patient ID and extras | Move them to "Complete your profile". Add "Refugee ID" as an ID type, for inclusion and to honour the non-blocking ID law |
| D13 | Under-18 self-signup | Block it with an honest message until the guardian model exists (DPPA s.8) |
| D14 | Passwords | 12–72 on every form, plus a blocklist, show/hide and paste. Record the deviation from NIST SP 800-63B-4, which asks for 15 characters when a password is the only factor (patients). Revisit when phone codes arrive |
| D15 | Leads | Link the existing lead action from the hospital door ("Ask us to call you") and from "My hospital isn't on MedSync" |
| D16 | Measurement | PII-free funnel events, plus a small report |
| D17 | Needed to go live | The DPA (before provisioning), departments with a start department, a backup admin, and wards per the existing rule. Location and services are recommended, not required |
| D18 | Rollout | Behind the flag `onboardingV2`. The old forms stay until the Phase 7 targets are met |
| D19 | Notice purposes | Ask the lawyer for staff-verification wording: v1.0 lists four patient-oriented purposes. Until then, UI summaries restate v1.0 only |
| E1 | Geography model | One `geo_units` adjacency table, unless Q4 finds hard foreign keys that make per-level tables cheaper |
| E2 | Search | `pg_trgm` if it's available both locally and in production. Otherwise a normalised prefix + contains search |
| E3 | Reverse geocoding | In-process point-in-polygon on simplified polygons. No PostGIS, no third-party geocoder |
| E4 | Draft storage | `sessionStorage`. Never passwords, ID numbers, NIN or files |
| E5 | Images | Re-encode on the device (≤ 1600 px, JPEG): smaller uploads, and EXIF GPS is stripped |
| E6 | Uploads | After account creation, directly to private storage. Attach only after the server re-validates the object |

## 14. Out of scope (leave clean seams)

**Needs another engine first**
- **Phone-first patient sign-in and SMS codes.** This needs the notifications engine. The patient form keeps email for now, and reception-assisted registration covers people without email.
- **Staff invite links that prefill hospital and department.** Seam: the forms accept a locked-field prefill object. Wire it once Q12's mechanism or the notifications engine exists.

**Uses what this prompt stores, later**
- **Emergency signposting and booking** that use facility coordinates and the Emergency 24/7 flag. This prompt only stores them. Signposting must signpost, never assess.
- **Saving a patient's home GPS point for emergencies.** A separate, explicit opt-in, later.

**Needs its own decision**
- **Guardian accounts** for under-18s.
- **A map picker for facility location.** Leaflet plus a tile provider is a dependency decision.

**Not planned here**
- **OCR of licences, and automated council register checks.** Links only.
- **Translation.** There's no clinical translation review process yet.
- **The Expo app's signup.** It can reuse these server actions later.
- **Legal texts and the production sign-up gate.**

## 15. ADRs (next free numbers)
- Onboarding v2: one page per form, no Next.
- Ask, derive, defer: the field ledger.
- Location engine: UBOS hierarchy, derived region, self-hosted reverse geocoding, patient GPS not kept.
- The MoH facility registry as the hospital source of truth.
- The profession picker and generic roles.
- Submit now, documents later; uploads after account creation.
- The DPA after verification.
- A PII-free onboarding funnel.
- One password policy, and the NIST SP 800-63B-4 deviation for patients.
- The interim under-18 block.

## 16. Definition of Done
- [ ] O1–O19 resolved, or deferred with a reason.
- [ ] No Continue or Next on any signup form. The budgets in Section 12 are met.
- [ ] Every rule ID has a test. The Eastern + Arua and Western + Gulu tests pass. No region input exists anywhere.
- [ ] Every deferred field has a working home: a profile or the setup checklist.
- [ ] A licence is required for clinical approval. Hospital review waits for documents. The DPA is signed after verification.
- [ ] Proved: no patient coordinates in the database, logs or third-party requests.
- [ ] RLS probes are green for every new object. Client writes are denied except where named.
- [ ] axe is clean. Red-scarcity tests are green on every signup route. Reduced motion is honoured. Dark mode works on patient pages.
- [ ] S1–S15 pass. With the flag off, the old forms are unchanged.
- [ ] The usability kit is delivered and Fadhul's results are recorded. Time estimates come from those measurements.
- [ ] ADRs written. The final report has its numbers. The diff on `feat/onboarding-v2` is reviewable.

---

## Appendix A — Field ledger (keep · derive · defer · remove)

**Patient**

| Field (key) | Today | v2 | Why |
|---|---|---|---|
| `title_code` | step 1, optional | Profile | Not needed to create an account |
| `first_name`, `surname` | step 1 | [01] | Identity |
| `sex` | step 1 | [01] | Clinically needed |
| `date_of_birth` | step 1, calendar picker | [01], three boxes | Care by age; DPPA s.8 check |
| `id_type`, `id_number` | step 1, required ("None" allowed) | Profile | Optional by design; checked in person at the hospital |
| `phone_e164` | step 1 | [01], accepts 07… | Reminders |
| `photo` | step 1, optional | Profile | Optional |
| `district_id`, `subcounty_id` | step 2, two pickers | [02], one location field (down to parish) | Fixes O3 and O4 |
| `village_address` | step 2, optional | [02], appears after a choice | Free-text fallback |
| `preferred_language` | step 2, free text | Profile, from the language catalogue | No translated UI yet |
| `full_name` (display name) | step 3 | Derived from first name + surname | Asked twice |
| `email`, `password` | step 3 | [03] | Sign-in |
| consent, SMS consent | step 3 | End of the form | Same mechanism; notice visible |
| `primary_facility_id` (server only) | — | Profile ("Your usual hospital") | The heading promised it |
| `nok_*` (server only) | — | Profile ("Someone we can call") | Useful in emergencies |

**Clinical**

| Field (key) | Today | v2 | Why |
|---|---|---|---|
| `full_name`, `email`, `phone_e164` | step 1 | [01] | Contact, sign-in |
| `photo` | step 1 | Staff profile, after approval | Not needed for approval |
| `council_id` | step 2 | Derived from profession | Never chosen |
| `cadre_id` | step 2 | [02] Profession | The one thing asked |
| `cadre_grade_id` | step 2 | Folded in where it changes scope (nurse, midwife); others in the profile | O11 |
| `role_id` | step 2 | Derived: the cadre's generic role, plus the department | O11 |
| `specialty_id` (server only) | — | [02], consultants only | Makes the role precise |
| `registration_number` | step 2 | [02], labelled with the council | Trust anchor |
| `registration_expiry` | step 2, optional | Recorded by the admin at approval; the clinician can add it in the profile | Read off the document |
| `licence_document` | step 2, optional | [02]. Required for approval; can follow the submission | Trust anchor (O12) |
| `hospital_id`, `department_id` | step 3 | [03] | Where you'll work |
| `employment_type` | step 3 | [03]. Defaults to Full-time; labels unified | O14 |
| `password` | step 4 | [01] | Sign-in fields together |
| consent | step 4 | End of the form | Notice visible |

**Non-clinical**

| Field (key) | Today | v2 | Why |
|---|---|---|---|
| `full_name`, `email`, `phone_e164` | Account | [01] | — |
| `password` | Account, min 8 | [01], 12–72 | O14 |
| `nin` | Identity | [02], soft format check | Identity anchor |
| `staff_number`, `authorising_officer_name`, `authorising_officer_role`, `appointment_letter` | Identity, optional | [02], behind "Speed up approval (optional)" | Optional by design |
| `cadre_id`, `role_id` | Where you work, one option each | Derived, and shown as text | O10 |
| `hospital_id`, `department_id` | Where you work | [03] | — |
| `employment_type` | "Part-time" label | [03], labels unified | O14 |
| consent | Notice not shown | End of the form, notice visible | O14 |

**Hospital**

| Field (key) | Today | v2 | Why |
|---|---|---|---|
| `hospital_name`, `facility_level`, `ownership` | step 1 | [01], from the registry; manual fallback | O6, D5 |
| `hospital_aka`, `year_established`, `website`, `main_phone`, `official_email`, `physical_address` | step 1 | Setup: Contact details | O6 |
| `region_id` | step 1 | Derived | O3 |
| `district_id`, `subcounty_id` | step 1 | [01], from the registry or the location field | O3 |
| `departments`, `im_subspecialties`, `primary_department` | step 2 | Setup: Departments. The start list shows ticked departments only | O6, O16 |
| `specialised_clinics`, `diagnostic_services`, `support_services`, `has_onsite_pharmacy` | step 3 | Setup: Emergency and services | O6 |
| `services_offered`, bed / staff / OPD bands, `internet_connectivity`, `power_backup`, `existing_emr`, `existing_emr_name` | step 4 | Setup: Emergency and services, and Operating profile. OPD gets its own bands | O6, O16 |
| `registration_number`, `licensing_body`, `facility_licence_document` | step 5 | [03], by ownership (none for government) | O8 |
| `registration_authority` (free text) | step 5 | **Removed.** Derived from the licensing body | Duplicate |
| `institutional_email_domain` | step 5 | Derived from the work email; public domains flagged | O7 |
| `applicant_full_name`, `applicant_role`, `applicant_work_email`, `applicant_phone` | step 5 | [02] | — |
| `applicant_council_number` | step 5 | **Removed** | O5 (tester) |
| `authority_officer_name`, `authority_officer_title`, `authority_letter_document` | step 5 | [03] "Who authorised you?" The letter can follow | Trust anchor |
| `callback_contact_kind` + `callback_contact_value` | step 5 | Officer phone and/or email: validated, and must differ from the applicant's | O16 |
| `signatory_name`, `signatory_title`, `authorised_to_bind`, `accept_agreement` | step 6 | Agreement gate, after `verified` | O9 |
| `applicant_password` | step 7 | [02] | Sign-in fields together |
| `data_processing_consent` | step 7, notice not shown | End of the form, notice visible | O14 |
| `departments_other`, `specialised_clinics_other` (server only) | — | Setup, as "Other" inputs (up to 5 each) | Gap in the extraction |

## Appendix B — Profession mapping (check against the seed at Phase 1)

| Option shown | Group · council | Cadre | Grade | Role (generic) | Extra | Keywords |
|---|---|---|---|---|---|---|
| Intern doctor | Doctors and dentists · UMDPC | Intern Doctor | — | Intern Doctor | Helper: provisional registration | doctor, intern |
| Medical officer | UMDPC | Medical Officer | — | Medical Officer | — | doctor, MO |
| Medical officer (special grade) | UMDPC | Medical Officer (Special Grade) | — | Medical Officer SG | — | doctor, MOSG |
| Consultant | UMDPC | Consultant | — | Consultant | Specialty required | doctor, specialist |
| Senior consultant | UMDPC | Senior Consultant | — | Senior Consultant | Specialty required | doctor, specialist |
| Dental officer | UMDPC | Dental Officer | — | Dental Officer | — | dentist |
| Dental surgeon | UMDPC | Dental Surgeon | — | Dental Surgeon | — | dentist |
| Enrolled nurse | Nurses and midwives · UNMC | Nurse | Enrolled Nurse | Nurse | — | nurse, EN |
| Registered nurse | UNMC | Nurse | Registered Nurse | Nurse | — | nurse, RN |
| Specialist nurse | UNMC | Specialist Nurse | — | Specialist Nurse | Duplicate grade removed (D11) | nurse |
| Enrolled midwife | UNMC | Midwife | Enrolled Midwife | Midwife | — | midwife |
| Registered midwife | UNMC | Midwife | Registered Midwife | Midwife | — | midwife |
| Clinical officer | Allied health · AHPC | Clinical Officer | profile | Clinical Officer | — | CO |
| Laboratory technician | AHPC | Laboratory Technician | profile | Laboratory Technician | — | lab |
| Laboratory technologist | AHPC | Laboratory Technologist | — | Laboratory Technologist | — | lab |
| Radiographer | AHPC | Radiographer | — | Radiographer | — | x-ray, imaging |
| Physiotherapist | AHPC | Physiotherapist | — | Physiotherapist | — | physio |
| Occupational therapist | AHPC | Occupational Therapist | — | Occupational Therapist | — | OT |
| Nutritionist | AHPC (as seeded; confirm) | Nutritionist | — | Nutritionist | — | diet |
| Pharmacist | Pharmacy · Pharmacy Board of Uganda | Pharmacist | — | Pharmacist (was "Ward Pharmacist") | — | pharmacy |
| Pharmacy technician | Pharmacy Board of Uganda | Pharmacy Technician | — | Pharmacy Technician | — | pharmacy |

The catalogue's scope (for example, comprehensive nurses, or pharmacy interns) remains Fadhul's open GATE A decision. This prompt changes structure, not scope.

## Appendix C — Sources checked (25 Sep 2026; re-verify at build time)

**Councils**
- **UMDPC.** Provisional registration, full registration and the annual practising licence. Licensing of private clinics and hospitals. An online "Doctor Search" and a licensed health facilities register. Links: https://www.umdpc.go.ug/ · https://ehealthlicense.go.ug/index.php/search
- **UNMC.** Private nursing clinic and midwifery domiciliary clinic licences, valid for one year and renewed by 31 March. Link: https://unmc.ug/how-to-obtain-a-license/

**Facility registry**
- MoH National Health Facility Registry: https://nhfr.health.go.ug/
- National Health Facility Master List 2018: https://www.health.go.ug/cause/national-health-facility-master-list-2018/

**Geography**
- Boundaries: OCHA COD-AB Uganda (https://data.humdata.org/dataset/cod-ab-uga), and geoBoundaries UGA, whose ADM4 simplified layer is on HDX. Check the licence, vintage and level meanings at Phase 0.
- Districts: 135 districts plus Kampala as of 1 July 2020, plus the cities created since. The extraction counts 146 district-level units. Confirm with UBOS: https://en.wikipedia.org/wiki/Districts_of_Uganda

**Law and standards**
- **DPPA 2019.** s.8: a child's data needs the prior consent of a parent or guardian. s.19: processing outside Uganda. The Act doesn't define "child"; the Constitution (art. 257) defines a child as a person under 18. Link: https://ulii.org/akn/ug/act/2019/9/eng@2019-05-03
- **NIST SP 800-63B-4** (26 Aug 2025), §3.1.1.2:
  - a minimum of 15 characters when the password is the only factor, 8 with MFA;
  - allow at least 64 characters;
  - a blocklist; no composition rules; allow paste; offer show-password; never truncate.
  - Link: https://pages.nist.gov/800-63-4/sp800-63b.html
- **NIN format.** 14 characters; citizens start CM or CF. From public explanations (e.g. https://ssmusoke.com/2018/02/26/crowdsourcing-validation-rules-for-uganda-national-id/). Use it as a soft check only.
