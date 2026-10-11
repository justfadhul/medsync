# Pharmacy Phase 0 — GATE A proposal

For Fadhul (owner, CSO). Prompt: [PROMPT-PHARMACY-PHASE-0.md](PROMPT-PHARMACY-PHASE-0.md). Findings:
[STOP-REPORTS.md](STOP-REPORTS.md) §STOP 0. Branch `feat/pharmacy-front-door`, stacked on `feat/lab-front-door`
@ 29dc006.

Already answered at STOP 0 (10 Oct 2026, in session):

- **Branches:** pharmacy stays on its own branch, stacked on lab Phase 0. Lab Phase 1 goes elsewhere.
- **D-new-1:** add a placement id.
- **D-new-2:** read emergency doses from the resus timeline.
- **D-new-3:** narrow the open read policies.

Everything else below needs a signature (§10).

---

## 1. What changes from the prompt, and why

| #   | Change                                                                                                                            | Why (STOP 0)                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | A new role value `pharmacy_staff` carries pharmacy access. The old `pharmacist` value stays unused                                | Law 4 / D-PH0-02: a technician must never hold a role called "pharmacist"                              |
| 2   | New prescriptions get a `placement_id`. Older rows are grouped by encounter + prescriber + `created_at`, marked "grouped by time" | PQ-1: nothing groups lines (D-new-1, answered)                                                         |
| 3   | New placements store each answered check's **level** (stop, check) beside its answer                                              | Q5: the level is not stored, so "stop overridden" could not rest on data (D-new-4)                     |
| 4   | Emergency doses come from `resus_timeline_events` (kind `drug`), not `emergency_administrations`                                  | Q8: the table is empty; no code writes it (D-new-2, answered)                                          |
| 5   | The SELECT policies on prescriptions, carts and emergency administrations are narrowed                                            | Verdict 3: any affiliated staff can read them today (D-new-3, answered)                                |
| 6   | A third lane, **Visit open**                                                                                                      | Q7: the lane is known only when the visit closes; a third lane keeps "lanes add up to All" (PQ-9) true |
| 7   | Find a prescription takes the **patient number only**                                                                             | Q4: the paper carries no prescription number; none is invented (PQ-2)                                  |
| 8   | "Changed since printing" is never shown; a neutral "Changed hh:mm" appears instead                                                | Q6: no print is recorded, and only `state` changes after insert                                        |
| 9   | Weight, creatinine and allergies are always **current values with their own dates**                                               | Q12: nothing is stored at prescribing; "at prescribing" (RV-3) cannot apply                            |
| 10  | The override block shows the line's reasons as **one verbatim text**, not one reason per check                                    | Q5: reasons are stored as one encrypted string per line                                                |
| 11  | The notice counts **4 of 192** from the shipped catalogue, not "3 of 212"                                                         | Q15: the list and the signed regimens are global static data                                           |
| 12  | Grape marks the active item, not plum                                                                                             | DESIGN-medsync.md:97: one hue, grape, for "Pharmacy & lab"                                             |
| 13  | The scratch harness replaces Playwright                                                                                           | Q18; the lab precedent D-LAB0-19; no new dependency                                                    |
| 14  | The stored state `completed` gets words: **Not continued at home**                                                                | Q3: a home close moves medicines the clinician stops to `completed`; the pharmacy must not supply them |

## 2. Access model

### 2.1 Permissions (PA-1, D-PH0-01)

There are six names. Only `pharmacy.view` is granted. The other five (`pharmacy.review`, `pharmacy.dispense`,
`pharmacy.stock`, `pharmacy.controlled`, `pharmacy.manage`) are reserved: the type knows them, but no map grants
them and no code checks them.

### 2.2 The cadre map (PA-2, Appendix A)

`data/pharmacy/permission-map.v1.json`, versioned and signed like the lab's:

| Cadre (code)                          | Council (repo)                                                     | Permissions     |
| ------------------------------------- | ------------------------------------------------------------------ | --------------- |
| Pharmacist (`PHARMACIST`)             | `PHARM_BOARD` ("Pharmacy Board of Uganda")                         | `pharmacy.view` |
| Pharmacy technician (`PHARMACY_TECH`) | `PHARM_BOARD` per the profession map. **Unconfirmed** (Appendix C) | `pharmacy.view` |

- **No other pharmacy cadre exists.** There is no pharmacy intern cadre, so no row is needed (D-PH0-03).
- **Heads:** the head of Pharmacy and the in-charge of a dispensing point are recorded in the hub. They grant
  nothing beyond the cadre (D-PH0-04).

### 2.3 The carrier and the title (D-PH0-02, Law 4)

- **The carrier:** a `user_roles` row with the new value **`pharmacy_staff`**.
  - Migration 0098 widens the `user_roles` CHECK (and fixes the Drizzle drift: `reception` is missing there).
  - `pharmacy_staff` joins `MFA_REQUIRED_ROLES` (AAL2, Law 14) and the landing's clinical roles.
  - The old `pharmacist` value stays in the CHECK, unused. Nothing grants it, and `assign-role` keeps accepting it
    (out of scope; reported).
- **The title:** no screen, export or audit line ever shows a role value.
  - The top-right label, and every audit basis, carry the **approved cadre's name** ("Pharmacy technician").
  - A test scans `app/pharmacy`, `lib/pharmacy` and `content/pharmacy.ts` for "Pharmacist" outside the cadre-name
    lookup.

### 2.4 Granting and revoking (Law 3, PA-7)

This copies the lab's shape (0097, D-LAB0-18). 0097 itself stays untouched.

- **The function:** `private.sync_pharmacy_access(user, hospital, actor, reason)`.
  - It grants or revokes `pharmacy_staff` at that hospital so the user holds it exactly when they have an active
    or approved affiliation there in a mapped cadre.
  - Its cadre list is checked against the signed JSON by a test, so the two cannot drift.
- **The trigger:** `AFTER INSERT OR DELETE OR UPDATE OF state, cadre_id, hospital_id, user_id ON
staff_affiliations`. It runs in the approval's own transaction, and in every later change (suspend, deactivate,
  cadre change, move).
- **The audit row:** `audit_log`, `table_name = 'pharmacy_access'`.
  - `after_data.event` is `pharmacy_access_granted`; `before_data.event` is `pharmacy_access_revoked`.
  - `basis {affiliation_id, cadre, cadre_name, council, approved_by, approved_at, hospital_id}`.
  - The `user_roles` audit trigger writes its own generic row as well, as for the lab.
- **A hand-granted `pharmacy_staff`** with no basis is removed at the user's next affiliation change, as the lab
  does.

### 2.5 Where each check runs (PA-3, PA-6)

| Layer                  | Check                                                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `proxy.ts`             | auth and AAL2, as today                                                                                                                                                                         |
| `requirePharmacyScope` | an active or approved affiliation in a mapped cadre at a hospital where `PHARMACY_WORKSPACE` is on, plus `pharmacy.view` from the map. Otherwise not-authorised, or not-found with the flag off |
| Each read              | hospital id from the scope, never from the client; a fixed field list (RV-7)                                                                                                                    |
| RLS                    | §6.2: the narrowed policies admit `pharmacy.view` holders at their hospital and refuse reception, lab, admins and superadmin without break-glass                                                |

### 2.6 Backfill (D-PH0-16)

**The dry-run list cannot be produced from here** (no production access). The baseline query in STOP-REPORTS
counts approved pharmacy staff; the script lists them once 0098 is applied.

`npm run pharmacy:backfill-access` copies the lab script.

- With no arguments it is a dry run: it lists user id, cadre and approval date, never names.
- `-- --apply` grants through `private.sync_pharmacy_access`, so every grant is audited.
- You run it against production after 0098 is applied. It cannot be run from here.

### 2.7 Generalising the lab modules (PA-8, NV-P2, E-PH0-01)

Each is generalised **once**, and the lab re-exports what it uses. Proof: every lab test passes unchanged (75 in
`tests/lab`, plus the `lab-access` and `lab-reads` PGlite lanes).

| Module                                | Becomes                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/lab/access.ts`                   | `lib/workspace/access.ts`: `PermissionMap<P>`, `permissionsFor(map, cadre)`, `can`, `mapProblems`. The lab keeps its headship rule on top |
| `lib/lab/nav.ts`                      | `lib/workspace/nav.ts`: `NavItem<Id, P>`, `navFor`. Lab and pharmacy each register items                                                  |
| `lib/lab/feature.ts`                  | `lib/workspace/feature.ts`: `workspaceLiveFor(env, hospitalId)` plus the CF-3 gate over a list of `SignedCopy`                            |
| `content/lab.ts` `SignedCopy`         | `content/signed-copy.ts`                                                                                                                  |
| `app/lab/_components/flagging-notice` | `components/medsync/caution-notice.tsx`, taking the copy. The lab passes its signed text                                                  |
| `app/not-authorised`                  | a `for` → copy map: `lab`, `pharmacy`                                                                                                     |
| `lib/auth/landing.ts`                 | gains the `pharmacy` group and `active.pharmacy`. `mayOpen` refuses `/pharmacy` without it                                                |

## 3. Landing (LD-P1 to LD-P5)

**Before**: every row in STOP-REPORTS Q11 (the lab's 37-row table). **After**: the same table, plus:

| Facts                                                                                      | Before       | After                                                                |
| ------------------------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------- |
| `pharmacy_staff` role, active pharmacy affiliation, flag on at that hospital               | (none)       | `/pharmacy`                                                          |
| no role, latest affiliation approved or active, cadre PHARMACIST or PHARMACY_TECH, flag on | `/clinician` | `/pharmacy`                                                          |
| the same with the flag off                                                                 | `/clinician` | `/clinician` (unchanged)                                             |
| `pharmacy_staff` role, no active pharmacy affiliation                                      | (none)       | `/clinician`, as the lab's equivalent row                            |
| `?redirect=/pharmacy/...` without `active.pharmacy`                                        | honoured     | refused (prefix logged), default landing                             |
| a pharmacy-only user opens `/clinician`, flag on                                           | page         | 307 to `/pharmacy` (`app/clinician/layout.tsx`, beside the lab line) |

- **The flag:** `active.pharmacy` is computed in the facts loader, so `resolveLanding` stays pure. It is true only
  where `PHARMACY_WORKSPACE` covers that affiliation's hospital, which keeps sign-in unchanged with the flag off
  (5.10).
- **Several workspaces (LD-P3):** today's precedence holds, as the lab signed (D-LAB0-05). The order is doctor,
  then lab, then pharmacy, then the generic `/clinician`.

## 4. Screens

Built with Chroma components already on the branch: `SidebarNav`, `PageHeader`, `DataTable`, `StatusWord` and the
caution notice. Grape marks the active item, teal the buttons and focus, amber the cautions. There is no red and
no green.

### 4.1 Shell (desktop ≥ 1024 px; phone shows a link row, as the lab does)

```
┌─────────────────────────┬────────────────────────────────────────────────────────────────────┐
│ TEST HOSPITAL-1         │ TEST HOSPITAL-1 · PHARMACY                 Pharmacy technician ·   │
│ Pharmacy                │ Queue                                      Outpatient pharmacy     │
│ ┌─────────────────────┐ │                                                                    │
│ │ ⌕ Patient number    │ │ (page)                                                             │
│ └─────────────────────┘ │                                                                    │
│ ▣ Queue              21 │  ← grape tint, edge and text; never a left bar                     │
│ ∿ Emergency doses     7 │                                                                    │
└─────────────────────────┴────────────────────────────────────────────────────────────────────┘
```

- The search field's label is "Find by patient number" (change 7).
- Counts are neutral:
  - **Queue:** prescriptions written today, All.
  - **Emergency doses:** resus doses in the last 7 days.

### 4.2 Queue (artboard 0.1)

```
Prescriptions written today                                         Updated 10:42  [Refresh]
▲ MedSync does not record dispensing yet. Dispense from the signed prescription as you do today.
  MedSync does not check drug interactions at this hospital, and 4 of the 192 medicines on its list
  have a signed dose reference. Check each prescription yourself.
[For the window 9] [On the wards 8] [Visit open 4] [All 21]   [All states][Prescribed][Awaiting co-sign][Cancelled]
                                                     [All wards and clinics ▾]  [Today ▾]
Patient            Medicines              From                       State              Checks                 Written
Patient Nine-9     Metformin, Amlodipine  Diabetes clinic ·          Prescribed         ▲ Allergy stop          09:52 ·   [Open]
MS-2026-00009      +1                     Medical officer                               overridden · Typed dose 50 min
Patient Four-4     Amoxicillin            Outpatients ·              ▲ Awaiting co-sign  Child under 16          10:05 ·   [Open]
MS-2026-00021                             Clinical officer                                                      37 min
9 of 21 prescriptions written today, for the window. Oldest first. This list is read-only: a prescription stays here until the end of the day.
```

- **Lane tabs (PQ-3, change 6):**
  - **For the window:** the visit closed `home`, `referred_out` or `transferred`.
  - **On the wards:** the visit closed `admitted`, an `admissions` row names it, or the encounter is `inpatient`.
  - **Visit open:** everything else.
  - Lane counts are computed before the lane filter, so they add up to All.
  - The default lane follows the viewer's dispensing point (DP-4); with no point, All.
- **States:** Prescribed (neutral) · Awaiting co-sign (amber, clock icon) · Cancelled hh:mm (amber, icon) ·
  Not continued at home (amber, icon; change 14) · Changed hh:mm (neutral text; change 8).
- **Phone (390 px):** each row becomes three lines, as below. Tabs scroll sideways.

```
Patient Nine-9 · MS-2026-00009
Metformin, Amlodipine +1 · Diabetes clinic · Medical officer
Prescribed · ▲ Allergy stop overridden · 09:52 · 50 min        [Open]
```

### 4.3 Prescription, read-only (artboard 0.2)

```
Prescription  [For the window] [Diabetes clinic]  Prescribed            grouped by time (older rows only)
Patient Nine-9 · MS-2026-00009 · F · [age]   Weight [value] ([date]) · Creatinine [value] ([date]) · Allergies: [as recorded] ([date])
▲ (notice)
1  [medicine, form, strength]       [dose · route · frequency · duration]   as written, byte for byte
   For: Type 2 diabetes             Typed by the prescriber
2  [medicine, form, strength]       [directions as written]                 From a signed regimen / Typed by the prescriber
   ▲ Allergy stop, overridden by the prescriber. Reasons given: "Override allergy: tolerated before; …"
3  ~~[medicine, form, strength]~~  Cancelled: 10:20, by Senior consultant (co-sign returned)
Side column:
  Prescriber: Medical officer · Diabetes clinic · 09:52 · Co-sign: not needed / awaiting / signed by Consultant 10:15
  What MedSync checked at prescribing: Allergy (Stop: overridden) · Child under 16 (Check: answered "senior agreed")
  Not checked: drug interactions · stock ("Pharmacy not linked yet")
Read-only. To change this prescription, speak to the prescriber.
```

- **Facts:** the weight, creatinine and allergy values come from the same loaders the Plan uses (`lib/facts`,
  `lib/emr/read/allergies.ts`), each with its own date.
- **Restricted indications:** shown as written, under D-PH0-06 (recommended), because every open is logged.

### 4.4 Emergency doses (artboard 0.3)

```
Emergency doses                                                 [Today] [Last 7 days] [Last 30 days]
ⓘ Cart restocking is not recorded in MedSync yet. Use this list beside the cart's own checklist when you restock.
[All carts 7] [ED cart 1  4] [No cart 3]
Given            Patient                       Medicine             Amount (as recorded)   Cart        Given by          Episode
10 Oct 09:14     Patient Two-2 · MS-2026-00002 [medicine]           [amount as recorded]   ED cart 1   Nurse             Resus 10 Oct 09:02
                                                                    Controlled: witnessed by Medical officer
08 Oct 22:40     Unidentified patient          [medicine]           [amount as recorded]   No cart     Medical officer   Resus 08 Oct 22:31
```

- **Source:** one row per `resus_timeline_events` row of kind `drug` that no later event supersedes, for episodes
  at the viewer's hospital.
- **Fields:**
  - **Medicine, dose and route:** the text in `payload.prescribing`.
  - **Cart:** the stored text. Cart tabs group exact strings.
  - **Given by:** the giver's cadre name.
  - **Witness:** a witness user's cadre, or "Witness named at the bedside" when only a typed name exists. The name
    itself is never shown.
- **Pathway doses:** these are kind `drug` events without `payload.prescribing`. They show the recorded label and
  "No cart". Step 3 confirms their payload before this rule is final.
- **No stock figure** is read or shown (ED-5).

### 4.5 Dispensing points (artboard 0.4, hub present)

- **Where:** Departments → Pharmacy gets a **Dispensing points** panel listing the units of Pharmacy.
- **Each point:**
  - name, place, hours and in-charge (the hub's own unit fields), and a staff count;
  - **Serves:** Outpatients, clinics and discharges · Wards · Emergency unit · Everything.
- **The note**, as Appendix B.
- **Derived values:** with one or more points, `pharmacy_dispensing_points` and `pharmacy_24h` are derived. The
  derivation reads `service_hours` text "24 hours" exactly; anything else is not 24 h.
- **Not built:** the canvas's "Live on MedSync" chip and the per-unit Archive button. The hub has neither today (§5.11).

### 4.6 Refused, and flag off

- **Refused:** `/not-authorised?for=pharmacy` shows "You do not have access to the pharmacy workspace. Ask your
  hospital admin."
- **Flag off:** `/pharmacy` returns the standard 404, and sign-in and `/clinician` are as today.

## 5. Rules, with worked examples

Examples use the harness fixture at Test Hospital-1. Every name is a fixture label and every medicine is a fixture.

### 5.1 Queue projection (PQ)

| Rule  | Statement                                                                                                                                   | Worked example                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| PQ-1  | One row per placement: `placement_id`; for rows without one, (`encounter_id`, `prescriber_user_id`, `created_at`), marked "grouped by time" | A Plan placement of 3 lines at 09:52:07.413 → 1 row, 3 medicines. Two sheet prescriptions 4 min apart on the same visit → 2 rows        |
| PQ-2  | No number is shown                                                                                                                          | —                                                                                                                                       |
| PQ-3  | Lane from the encounter's close and admission (§4.2); an open visit → Visit open                                                            | Outpatient visit closed `home` → For the window. Emergency visit closed `admitted` → On the wards. Clinic visit still open → Visit open |
| PQ-4  | Only `is_emergency = false` rows; resus doses never enter the queue                                                                         | —                                                                                                                                       |
| PQ-5  | Row state ranks Awaiting co-sign > Prescribed > Not continued at home > Cancelled. "Cancelled" shows only when every line is cancelled      | 3 lines: 1 pending co-sign, 2 active → Awaiting co-sign. 3 lines all cancelled → Cancelled 10:20                                        |
| PQ-6  | Cancelled lines and rows stay                                                                                                               | The co-sign is returned on 1 of 3 lines: the row stays Prescribed, gains "Changed 10:20"; the line is struck through in the view        |
| PQ-7  | No print record: "Changed hh:mm" (neutral) when any line's `updated_at` > `created_at`                                                      | As above                                                                                                                                |
| PQ-8  | Checks from stored data only. Order: stop overridden, controlled, child under 16, renal answered, typed dose. At most 2 chips, then "+n"    | An allergy stop answered "tolerated before" plus no regimen → "Allergy stop overridden" · "Typed dose"                                  |
| PQ-9  | Lane counts ignore the lane filter; state counts respect it                                                                                 | Lanes 9 + 8 + 4 = All 21                                                                                                                |
| PQ-10 | Oldest first by `created_at`; stable                                                                                                        | —                                                                                                                                       |
| PQ-11 | Hospital-scoped                                                                                                                             | Fixture rows at Test Hospital-2 never appear                                                                                            |
| PQ-12 | Two identifiers through `identitiesFor` (surface `pharmacy_queue`), batched                                                                 | —                                                                                                                                       |
| PQ-13 | Property: every placement in the period appears exactly once under All; lanes sum to All                                                    | 500 seeded random inputs                                                                                                                |

**Check levels (change 3, D-new-4):**

- **New placements:** each `check_answers` entry also stores `outcome: "stop" | "check"`, a one-field change in
  `verifyAnswers`' caller (`lib/emr/write/plan.ts`).
- **Older rows:** `allergy` is the only code that is always a stop (`plan-checks.ts:147`), so it reads "Allergy stop
  overridden". Every other answered code reads "{Check} answered", with no "stop".
- **Renal:** `kidney` answered.
- **Child under 16:** `child` answered, or the patient is under 16 at the prescription's date (computed from the
  date of birth the identity module already returns, not a check result). **Recommended: show only the stored
  answer**, to keep Law 6.
- **Typed dose:** a drug line with `regimen_id` null.
- **Controlled drug, witnessed:** `controlled` true.

### 5.2 Read model (RV)

| Rule | Statement                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RV-1 | Fields, and nothing else: each line's stored text fields and `kind`; the indication (`conditions` display text via `condition_id`, or `indication`); `check_answers`, `confirmed_flags` and the decrypted reasons; prescriber cadre (name) and the encounter's department; co-sign state, reviewer cadre and time per line; state and `updated_at`. For the patient: two identifiers, sex, age, allergies, the latest weight and creatinine, each with its date |
| RV-2 | Text passes through untouched. Test strings: `"1/2 tab "`, `"0,5 mg"`, `"5mg/kg (max 500mg)"`                                                                                                                                                                                                                                                                                                                                                                   |
| RV-3 | Current values only, each with its own date (change 9)                                                                                                                                                                                                                                                                                                                                                                                                          |
| RV-4 | A restricted indication is shown (D-PH0-06)                                                                                                                                                                                                                                                                                                                                                                                                                     |
| RV-5 | No outcome that was not stored                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| RV-6 | One `audit_log` row per open: `table_name 'pharmacy_prescription_view'`, `after_data {event: 'pharmacy_prescription_viewed', placement, hospital_id}`. None if the same actor opened the same placement within the last minute. The reveal's own `clinical_phi_access_log` row (surface `pharmacy_prescription`) comes from `identitiesFor`                                                                                                                     |
| RV-7 | A server function with this list, reading as the owner after `requirePharmacyScope`. No table grant on encounters, notes, results or observations                                                                                                                                                                                                                                                                                                               |

### 5.2a The read list (D-PH0-05), field by field

| Field                                  | Source                                                                    | Why the pharmacy needs it                         |
| -------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------- |
| Name and patient number                | `patient_profiles` through `identitiesFor` (reveal logged)                | Match the person and the paper (two identifiers)  |
| Sex, age                               | the same reveal                                                           | Check the dose against the patient                |
| Allergies, with dates                  | `allergies` + `allergy_status_assertions` (`lib/emr/read/allergies.ts`)   | Catch an allergy the paper does not mention       |
| Latest weight, with date               | `lib/facts` concept `obs.weight`                                          | Weight-based doses                                |
| Latest creatinine, with date           | `lib/facts` concept `obs.creatinine`                                      | Renal dose adjustment                             |
| Each line's medicine, form, directions | `prescriptions` text columns, as stored                                   | It is the prescription                            |
| Instructions                           | `prescriptions.instructions_ciphertext`, decrypted                        | Part of the prescription                          |
| Indication                             | `conditions` via `condition_id`, or `prescriptions.indication`            | Check the medicine fits the problem               |
| Dose source                            | `regimen_id` (signed regimen or typed)                                    | A typed dose needs closer checking                |
| Check answers and reasons              | `check_answers`, `confirmed_flags`, `confirm_reason_ciphertext` decrypted | What the prescriber was warned about and answered |
| Controlled                             | `prescriptions.controlled`                                                | Controlled-drug handling                          |
| Prescriber cadre, department           | `prescriptions.prescriber_cadre` (name), `encounters.department_id`       | Who to call; never the person's name              |
| Co-sign state, reviewer cadre, time    | `clinical_cosign_requests` per line                                       | An unsigned prescription                          |
| Line state, last change                | `prescriptions.state`, `updated_at`; reviewer for a returned co-sign      | Cancelled or not continued                        |
| Visit close, admission                 | `encounters.disposition`, `encounter_type`, `admissions`                  | The lane only; never shown as clinical detail     |

**Not read:** notes, history, examination, results, observations other than weight and creatinine, other
encounters, the problem list beyond each line's own indication.

### 5.3 Check state (CS) and the notice

- `pharmacyChecksState(h)` returns `{dispensingRecorded: false, interactionsChecked: false, doseReferences: {signed: 4, total: 192}}`.
  The counts are read at run time from `FORMULARY_DRUGS` and the signed overlay, never typed.
- **The notice:** every queue and prescription view shows it while any part is not done. It has no close button
  and uses `role="status"`.
- **CS-5:** in production, `PHARMACY_WORKSPACE` is refused for every hospital while any notice string is `draft`.
  The refusal is logged once.

### 5.4 Emergency doses (ED)

ED-1 to ED-5 as the prompt states, over the resus timeline (§4.4). The property test is the same as PQ-13: cart
counts sum to All.

### 5.5 Dispensing points (DP)

DP-1 to DP-4 as the prompt states. `serves` lives in a 1:1 extension table, because units are shared by every
department (§6.1).

### 5.6 Navigation (NV-P)

The registry holds Queue and Emergency doses only. Later phases add items with their pages.

### 5.7 Copy (Appendix B), with status

Every string lives in `content/pharmacy.ts` as a `SignedCopy` entry. The notice strings, the awaiting-co-sign
line and D-PH0-19 need the CSO's signature. The rest are interface copy.

| Key                            | Text                                                                                                                                                                                                                                | Status                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `notice.lead`                  | MedSync does not record dispensing yet.                                                                                                                                                                                             | draft                                          |
| `notice.bodyCounts`            | Dispense from the signed prescription as you do today. MedSync does not check drug interactions at this hospital, and {signed} of the {total} medicines on its list have a signed dose reference. Check each prescription yourself. | draft                                          |
| `notice.bodyNoCounts`          | Dispense from the signed prescription as you do today. MedSync does not check drug interactions at this hospital, and its dose references are still being signed. Check each prescription yourself.                                 | draft                                          |
| `cosign.view`                  | Not yet co-signed. A senior has not signed this prescription.                                                                                                                                                                       | draft                                          |
| `state.cancelledRow`           | Cancelled {time}                                                                                                                                                                                                                    | interface                                      |
| `state.cancelledView`          | Cancelled {time} by {cadre}                                                                                                                                                                                                         | interface                                      |
| `state.notContinued` (new)     | Not continued at home                                                                                                                                                                                                               | draft (D-PH0-19)                               |
| `state.changed`                | Changed {time}                                                                                                                                                                                                                      | interface                                      |
| `override.block`               | {check} stop, overridden by the prescriber. Reasons given: "{reasons}".                                                                                                                                                             | draft (changed: one reasons text per line)     |
| `override.answered` (new)      | {check}: answered "{answer}".                                                                                                                                                                                                       | interface                                      |
| `notChecked`                   | Drug interactions. · Stock. The prescriber saw "Pharmacy not linked yet".                                                                                                                                                           | interface                                      |
| `view.footer`                  | Read-only. To change this prescription, speak to the prescriber.                                                                                                                                                                    | interface                                      |
| `view.groupedByTime` (new)     | Grouped by time: written before MedSync recorded which medicines were placed together.                                                                                                                                              | interface                                      |
| `queue.footer`                 | {n} of {N} prescriptions written {period}, {lane}. Oldest first. This list is read-only: a prescription stays here until the end of the day.                                                                                        | interface                                      |
| `queue.oneLane`                | MedSync cannot yet tell window prescriptions from ward prescriptions at this hospital, so all are shown together.                                                                                                                   | interface (unused while the lanes can be told) |
| `queue.emptyLane`              | Nothing {lane} yet today. {n} {other lane}.                                                                                                                                                                                         | interface                                      |
| `queue.emptyAll`               | No prescriptions have been written today.                                                                                                                                                                                           | interface                                      |
| `find.label` (new)             | Find by patient number                                                                                                                                                                                                              | interface                                      |
| `find.none`                    | No prescription with that number at this hospital.                                                                                                                                                                                  | interface                                      |
| `emergency.notice`             | Cart restocking is not recorded in MedSync yet. Use this list beside the cart's own checklist when you restock.                                                                                                                     | draft                                          |
| `emergency.unidentified`       | Unidentified patient                                                                                                                                                                                                                | interface                                      |
| `emergency.witnessTyped` (new) | Witness named at the bedside                                                                                                                                                                                                        | interface                                      |
| `points.note`                  | A dispensing point names where pharmacy staff work and which prescriptions their queue shows first. It holds no stock and records no dispensing yet.                                                                                | interface                                      |
| `refused`                      | You do not have access to the pharmacy workspace. Ask your hospital admin.                                                                                                                                                          | interface                                      |

## 6. Schema diff, RLS, flag

### 6.1 Migrations (numbers from the ledger; every one GATED, owner-applied)

| #    | File                                       | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0098 | `0098_pharmacy_access.sql`                 | `user_roles` CHECK + `pharmacy_staff`; `private.sync_pharmacy_access` and the `staff_affiliations` trigger (§2.4); revoked from `PUBLIC`, `anon`, `authenticated`                                                                                                                                                                                                                                                                                                                                          |
| 0099 | `0099_prescription_placement.sql`          | `prescriptions.placement_id uuid NULL`; index `(hospital_id, created_at)` if Step 2's `EXPLAIN` shows a sequential scan; no backfill (older rows group by time)                                                                                                                                                                                                                                                                                                                                            |
| 0100 | `0100_prescription_reads.sql`              | Replaces `prescriptions_select_scoped`, `emergency_administrations_select`, `crash_carts_select` and `crash_cart_stock_select`: patient own rows (the restrictive policy stays), prescriber or giver own rows, clinical staff (doctor, nurse and clinical-officer cadres) at the hospital, and `pharmacy_staff` at the hospital. Superadmin only through break-glass. Adds a pharmacy SELECT on `resus_timeline_events` kind `drug` only if Step 2 finds an RLS read is needed (the server reads as owner) |
| 0120 | `0120_pharmacy_outside_clinical_reads.sql` | **Added at Step 3:** the two pharmacy cadres leave the generic clinical-staff RLS predicate (one function, nine inline policies), so pharmacy staff read the chart only through server reads (D-PH0-05, S13)                                                                                                                                                                                                                                                                                               |
| 0121 | `0121_pharmacy_dispensing_points.sql`      | `pharmacy_dispensing_points (department_id PK → hospital_departments, serves CHECK IN ('window','wards','emergency','all'), updated_*)`, RLS on, no client write; the hub's Edge Function writes it                                                                                                                                                                                                                                                                                                        |

- **No change** to prescription rows, orders, administrations, the catalogue or any stock table.
- **0099's writer change** is one line in each writer (`placePlan` and the sheet's `prescribe`), plus
  `check_answers.outcome` (change 3). These are the only prescribing-code edits, and they are covered by the
  existing Plan and sheet tests plus new ones.

### 6.2 RLS probes (PGlite lane, every migration replayed)

| Actor                                          | prescriptions | emergency_administrations, carts | user_roles writes | sync function |
| ---------------------------------------------- | ------------- | -------------------------------- | ----------------- | ------------- |
| Pharmacy staff, same hospital, granted         | read          | read                             | denied            | denied        |
| Pharmacy cadre before grant, after revoke      | denied        | denied                           | denied            | denied        |
| Doctor, clinical officer, nurse, same hospital | read          | read                             | denied            | denied        |
| Lab staff, reception, hospital admin           | **denied**    | **denied**                       | denied            | denied        |
| Staff of another hospital                      | denied        | denied                           | denied            | denied        |
| Superadmin without break-glass                 | **denied**    | **denied**                       | as today          | denied        |
| Patient: own standard rows / restricted        | read / denied | own only                         | denied            | denied        |
| Anonymous                                      | denied        | denied                           | denied            | denied        |
| Any client INSERT, UPDATE, DELETE              | denied        | denied                           | denied            | —             |

Plus the trigger probes, copying `lab-access.test.ts`: approve each cadre; nurse approved (no grant); suspend;
deactivate; reactivate; cadre change; second hospital; hand-granted row; idempotency; backfill path.

### 6.3 Flag

`PHARMACY_WORKSPACE` takes `1` or a comma list of hospital ids, read through the generalised
`workspaceLiveFor`, with CS-5 enforced on the server.

## 7. Test plan

| Lane                          | Covers                                                                                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/pharmacy` (unit)       | PA, LD-P (table), PQ (with 500-run property), RV-2 byte equality, CS, ED (property), DP, NV-P, the wrong-clock test, the title scan, the no-clinical-write scan of `/pharmacy` actions |
| `tests/lab` (unchanged)       | The lab regression after the generalisation                                                                                                                                            |
| `tests/emr-db` (PGlite)       | `pharmacy-access` (trigger + RLS probes, §6.2), `pharmacy-reads` (queue, view, emergency doses against real migrations; the query counter)                                             |
| `tests/emr`, `tests/clerking` | `placement_id` and `outcome` written by both prescribing writers; existing tests unchanged                                                                                             |
| `tests/design`                | red scarcity over `app/pharmacy`, `lib/pharmacy`, `content/pharmacy.ts`; never colour alone                                                                                            |
| Harness (`pharm0-harness`)    | Screens at 3 widths, light and dark; axe; budgets (TTFB with 500 placements, lane switch, JS); flag-off pixel comparison; S1–S22                                                       |

## 8. ADR drafts (0227–0237)

| ADR  | Title                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------- |
| 0227 | Pharmacy access: six names, one grant, derived from cadre; the `pharmacy_staff` carrier and the title rule |
| 0228 | Pharmacy access granted and revoked by a trigger on staff affiliations                                     |
| 0229 | Access, landing, navigation, flag and notice as workspace-neutral modules                                  |
| 0230 | The pharmacy queue as a projection: the placement id, the three lanes, nothing disappears                  |
| 0231 | What pharmacy staff may read: the server read model and the read log                                       |
| 0232 | Narrowing who may read prescriptions and emergency doses in the database                                   |
| 0233 | As written, and no second check engine; check levels stored from now on                                    |
| 0234 | The check-state seam and the pharmacy notice                                                               |
| 0235 | Emergency doses from the resus timeline                                                                    |
| 0236 | Dispensing points as units of the Pharmacy department; derived capability values                           |
| 0237 | The numbers ledger                                                                                         |

## 9. Decisions

The prompt's recommendations stand except where marked **changed**.

| #           | Decision                           | Recommendation                                                                                                                                                                                  |
| ----------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-PH0-01    | Access model                       | Six names, one granted: `pharmacy.view`                                                                                                                                                         |
| D-PH0-02    | Carrier and title (CSO)            | **New role value `pharmacy_staff`** (§2.3); the cadre name everywhere a person is labelled                                                                                                      |
| D-PH0-03    | Who gets access (CSO)              | Pharmacist and Pharmacy technician on approval with a licence on file. No intern cadre exists. **You confirm the technician's registering body from a primary source before the map is signed** |
| D-PH0-04    | Pharmacy management                | Recorded in the hub; grants nothing                                                                                                                                                             |
| D-PH0-05    | What pharmacy staff may read (CSO) | §5.2 RV-1, nothing else                                                                                                                                                                         |
| D-PH0-06    | Restricted indications             | Show them; every open is logged                                                                                                                                                                 |
| D-PH0-07    | Notice wording (CSO)               | Appendix B with counts 4 of 192; **sign before any production hospital is switched on**                                                                                                         |
| D-PH0-08    | One queue row                      | **Answered:** `placement_id` from now on; older rows grouped by time, marked                                                                                                                    |
| D-PH0-09    | Finding                            | **Changed:** patient number only (no prescription number exists); 30 days; this hospital                                                                                                        |
| D-PH0-10    | Awaiting co-sign                   | Amber, in words, row and view; nothing gated                                                                                                                                                    |
| D-PH0-11    | Cancelled and changed              | **Changed:** both stay; "Changed hh:mm" in neutral (no print record)                                                                                                                            |
| D-PH0-12    | Period and order                   | Today, oldest first                                                                                                                                                                             |
| D-PH0-13    | Emergency doses                    | **Answered:** from the resus timeline; no stock figure                                                                                                                                          |
| D-PH0-14    | Dispensing points                  | Units of Pharmacy with `serves`; derived count and 24 h                                                                                                                                         |
| D-PH0-15    | Names on lists                     | Name and MRN with batched reveal logging                                                                                                                                                        |
| D-PH0-16    | Backfill                           | Dry run, review, apply                                                                                                                                                                          |
| D-PH0-17    | Rollout                            | `PHARMACY_WORKSPACE` per hospital, test hospital first; signed notice required in production                                                                                                    |
| D-PH0-18    | **New:** third lane                | "Visit open" for visits not yet closed (§4.2)                                                                                                                                                   |
| D-PH0-19    | **New:** `completed` wording (CSO) | "Not continued at home", amber, with icon                                                                                                                                                       |
| D-PH0-20    | **New:** check levels              | Store `outcome` beside each answer from now on; older rows: only `allergy` reads as a stop                                                                                                      |
| D-PH0-21    | **New:** the open read             | **Answered:** narrow the four policies (0100); superadmin by break-glass only                                                                                                                   |
| D-PH0-22    | **New:** tooling                   | The scratch harness, no Playwright (as D-LAB0-19)                                                                                                                                               |
| E-PH0-01–06 | Engineering                        | As the prompt: generalise the lab's modules once; a projection with no queue table; a server read model; one check-state function; the ledger; server clock plus a 30 s tick                    |

## 10. Signature

| Item                                                          | Signed by           | Date        | Basis                                                                                                                                                        |
| ------------------------------------------------------------- | ------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-PH0-08, -13, -21 and the stacked branch                     | Fadhul              | 10 Oct 2026 | Answers in session at STOP 0                                                                                                                                 |
| D-PH0-01 to -07, -09 to -12, -14 to -20, -22; E-PH0-01 to -06 | Fadhul (owner, CSO) | 10 Oct 2026 | Answer in session at STOP 1: "Sign as recommended"                                                                                                           |
| Permission map v1 (§2.2), both cadres                         | Fadhul (CSO)        | 10 Oct 2026 | Answer in session at STOP 1: "Both cadres, sign map"; the technician's registering body to be confirmed later (view-only access carries no supply authority) |
| Notice and caution wording (§5.7)                             | Fadhul (CSO)        | 11 Oct 2026 | Signed as written, all five, in the sign-off portal (https://claude.ai/artifact/PrEYQNLnd2Ng7zaq58Rtj6); `content/pharmacy.ts` status `signed`               |
| Technicians' registering body (D-PH0-03, Appendix C)          | Fadhul (CSO)        | 11 Oct 2026 | Confirmed in the same portal: the Pharmacy Board of Uganda. No source was cited                                                                              |
