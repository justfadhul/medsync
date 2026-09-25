# Onboarding v2: GATE A proposal

Scope: `PROMPT-ONBOARDING-V2.md`. Baseline: `extraction-2026-09-25.md`. Discovery: `STOP-REPORTS.md` § STOP 0.

**Status.** Signed by the owner's instruction "go through all gates" (25 Sep 2026) for every decision in §13, **except** the items marked **PROVISIONAL**. Those wait on the CSO (Fadhul) and, for the notice lines, the lawyer.

**How this proposal is shaped.** The prompt's §5 wireframes are the design. This document records only where the build **departs** from them, and why. Where §5 is silent, the rules are `DESIGN-medsync.md` first, then the design and animation skills.

---

## 1. Visual design plan (inside DESIGN-medsync.md)

| Token role | Value | Rule |
|---|---|---|
| Ground | `bg-background` (#fff) / section cards `bg-card`, `shadow-card`, radius 12 | DESIGN § Cards |
| Action | teal-600 `#0D9488` (the submit, links, focus ring `#14B8A6`) | one primary button per page |
| Place | plum-500 dot (`#C953A3`) on the section in view; `SectionNumber` `[01]` (plum, ADR 0097) | never on a selected control |
| Validation | amber: border `#D97706`, fill `#FFFBEB`, text amber-800 `#92400E` + `TriangleAlert` icon + words | Law 9. Scoped to the v2 kit, so the shared `Field`/`Input` stay untouched |
| Done | neutral ink `#171717` check + the word "Done" | never green |
| Alarm | `#DC2626` only in the header Emergency button | red-scarcity test on every signup and onboarding route |

- **Type:** Fraunces 500 for the H1 (as `/get-started`); Geist Sans for UI, with labels at 13/500 (Body S). A mobile form label is 13 px, not DESIGN's 11 px: 11 px is too small for 50+ testers on a low-end Android. Geist Mono only for the NIN and registry codes.
- **The one memorable thing:** the progress rail. A calm, exact "where you are" that follows scroll (IntersectionObserver): the plum dot moves to the section in view, and each item carries its state word. Everything else stays quiet.
- **Motion:** conditional reveals use `@starting-style` (opacity + 4 px translate, 150 ms `cubic-bezier(0.16,1,0.3,1)`). Reduced motion makes them instant. Buttons use the existing `tap` press. There is no decorative motion.

## 2. Deltas from the §5 wireframes

1. **Emergency (Q17):** on `/signup/*` and `/onboarding/*` the header carries the existing `EmergencyButton` (the `/get-started` pattern), and `data-emergency-inline` hides the floating pill. This applies only with v2 on, so flag-off pages are unchanged (S14).
2. **Location levels (Q20):** search reaches **sub-county** (COD-AB has no parishes). "Village or cell (optional)" stays free text (encrypted, ≤ 200). Cities are found as "<Name> Municipality" (2020 vintage). Typing "Gulu city" finds them through a sourced alias list (the 10 cities created 1 July 2020).
3. **Registry card:** the registry has no coordinates and almost no contacts, so the card shows name · level · ownership · district · region · registry code, with no map and no contacts.
4. **Hospital proof:** the manual path keeps the **existing 8 facility levels and 4 ownership options** (the 14/7/21 catalogue JSON does not exist: Q8, D2a). The PNFP bureau list is the set of authorities the registry itself uses for PNFP facilities (UCMB, UPMB, UMMB, UOMB, SDA, UCBHCA, NGO), plus "Other".
5. **Applicant role:** keeps the existing 6 options until the 21-role JSON is supplied.
6. **Specialty (consultants):** the specialties catalogue holds only Internal Medicine and its 13 sub-specialties. So the picker also offers **"My specialty isn't listed yet"**, which saves NULL and shows the approver "Specialty: not listed". This is structure, not scope (Appendix B note).
7. **Agreement gate:** because `approve-hospital-application` provisions in one call, the gate is **Verify → the applicant signs → Approve & provision**. The super-admin's first Approve on a v2 application sets `verified` (no provisioning). The applicant signs on the pending page. The second Approve provisions exactly as today (`agreement_signed` + hospital row + agreement row + departments + hospital_admin). v1 applications, which carry their DPA already, keep the one-step path.
8. **Setup checklist:** `/admin/setup` is already non-linear (Q7), so it is **extended**, not replaced. It gains Facility location, Emergency and services, Operating profile, and Contact details tasks. The Departments task gains "Other" (≤ 5), IM sub-specialties, and a start-department picker limited to the ticked departments.
9. **Staff deferred fields:** there is no staff profile page outside `/doctor/profile`, so the **staff pending page** gains a "Your details" card: licence (Still needed), photo, and the optional grade for CO/lab tech. The approver records "Licence valid until" in the approval sheet.

## 3. Location engine (LOC)

- **Dataset:** OCHA COD-AB Uganda v01 (UBOS boundaries, valid 2020-08-24, CC BY-IGO). The import is `scripts/import-geo.mjs` and is deterministic. Report: 4 / 135 / 203 / 1,520, 0 orphans, 0 duplicate codes.
- **Files:**
  - `data/geo/uganda-admin.json` (70 kB): all units, server-only.
  - `data/geo/uganda-districts.json` (4.2 kB, **1.1 kB gz**): embedded in the page for offline district choice (LOC-8 ✓ ≤ 8 kB).
  - `data/geo/uganda-shapes.json` (2.8 MB, 0.95 MB gz): 1,520 sub-county outer rings, Douglas-Peucker 0.0005° (≈ 55 m), lazy-loaded in the server process.
- **Search:** runs in-process on the server over the units file (E2: pg_trgm is not installed in production, and an in-memory index of 1,658 names beats a DB round trip). Prefix matches first, then contains; ties go to the higher level; ≤ 8 results with full paths. Districts also match client-side from the embedded list, so they work offline.
- **Reverse geocoding:** bounding-box prefilter, then ray-cast point-in-polygon. A point in a simplification gap takes the nearest ring within 1 km. Outside Uganda, or with nothing within 1 km, it returns nothing. The accuracy tiers follow §5.5.
- **Storage (E1):** keep the **per-level tables**. `patient_profiles`, `hospital_applications` and `hospital_leads` have hard FKs to `districts`/`subcounties`, so a `geo_units` table would mean rewriting all three.
  - Add `pcode` (unique) and `retired_at` to both tables, and `county_pcode` + `county_name` to `subcounties`.
  - The form submits one pcode. The server resolves `district_id`/`subcounty_id`.
- **Rules in the database:**
  - LOC-1: a trigger sets `hospital_applications.region_id` from the district, so any client value is overwritten.
  - LOC-4: a trigger on `patient_profiles` and `hospital_applications` rejects a sub-county outside its district.
- **Legacy mapping (LOC-9):**
  - 20 of the 21 seeded districts map by exact name to one COD-AB district (the 2020 vintage has no separate cities, so there is no city/district ambiguity).
  - **Fort Portal** has no district of that name. It is `retired_at` (hidden from pickers), kept for FKs, and reported. 0 production rows reference it.
  - The 5 Kampala divisions map by name ("Kampala Central Division" → "Central Division"; listed for a human to confirm).
  - The one production application saved as **Kampala + Western** is recomputed to Central, and the migration reports it with a `NOTICE`.

## 4. Registry (REG)

- **Source:** the NHFR public list API, 6,801 facilities, 2026-09-25. The import is `scripts/import-registry.mjs` and is repeatable (live fetch, or a saved file). It writes `data/registry/nhfr-facilities.json` (988 kB, 160 kB gz), server-only.
- **Crosswalk (REG-2):**
  - **99.54 %** of facilities matched a district (target ≥ 98 %).
  - Registry cities map to the district holding "<Name> Municipality".
  - One reviewed spelling alias: Sembabule ↔ Ssembabule.
  - 31 facilities in **Terego** (created after the 2020 vintage) are unmatched and reported.
  - Sub-county match: 74.9 %. The sub-county is optional.
- **Level and ownership map (REG-6):**
  - Levels: HC II/III/IV, General, RRH, NRH → the existing catalogue. **Clinic (432) is unmapped** and reported. At application a registry clinic stores `private` (PFP; the catalogue label is "Private hospital / clinic") or `other` (PNFP/GOV).
  - Ownership: GOV → `public_moh`, PFP → `private`, PNFP → `pnfp`.
- **No `registry_facilities` table:** read-only reference data ships with the server (REG-1 holds by construction). The application stores `registry_code`, and the **server** copies name, level, ownership and location from the file (REG-3), so a client can't alter them.
- **REG-4:** at submit, a registry code already on an open, verified or provisioned application sets `duplicate_facility` (flagged, not blocked).
- **REG-5:** the manual path is always available and sets `facility_source = 'manual'`.

## 5. Profession (PRO)

`lib/onboarding/profession.ts` holds the 21 options of Appendix B. The seed was checked: every cadre and grade code exists.

- **Role:** the cadre's generic role. Migration 0070 adds 9 `*_GENERAL` roles; the other 11 cadres already have one.
- **Council:** derived from the cadre. It is shown as text and names the registration-number field.
- **Grade:** set only where it changes scope (enrolled vs registered nurse and midwife). The NURSE/SPECIALIST grade is no longer offered: "Specialist nurse" is the cadre (D11). The row stays in place for FKs; `lib/nurse/scope.ts` reads both.
- **Why nothing breaks:** every router keys on cadre and grade codes (Q5), so existing affiliations keep their role ids (PRO-3).

## 6. Schema diff: `0070_onboarding_v2.sql` (GATED, additive, idempotent)

1. **Geography:**
   - `districts.pcode UNIQUE`, `districts.retired_at`, `subcounties.pcode UNIQUE`, `.county_pcode`, `.county_name`, `.retired_at`.
   - Legacy UPDATEs, then 115 new districts and 1,515 new sub-counties (generated from the JSON).
   - A `reference_data_versions` row, triggers LOC-1 and LOC-4, and the region recompute.
2. **Roles:** 9 generic roles (`INTERN_DOCTOR_GENERAL`, `MO_GENERAL`, `MO_SG_GENERAL`, `CONSULTANT_GENERAL`, `NURSE_GENERAL`, `SPECIALIST_NURSE_GENERAL`, `CLINICAL_OFFICER_GENERAL`, `LAB_TECH_GENERAL`, `PHARMACIST_GENERAL`).
3. **`patient_profiles.id_type`:** adds `refugee_id` and `other` (D12).
4. **`hospital_applications`:**
   - `registration_number` becomes NULLable (government facilities).
   - New columns: `registry_code`, `facility_source`, `registry_correction_note` (≤ 300), `duplicate_facility`, `public_email_domain`, `pnfp_bureau`, `authority_officer_phone`, `authority_officer_email` (both app-encrypted).
   - `licensing_body` extended with `unmc`, `ahpc` and `bureau`.
   - Generated `documents_complete`: the authority letter is present, and so is the facility licence unless the facility is `public_moh`.
   - An index on `registry_code`.
5. **`hospital_leads`:** `facility_level`, `ownership`, `contact_role` and `contact_email` become NULLable, so the short leads ("Ask us to call you", "My hospital isn't on MedSync") fit.
6. **`facility_locations`:** `hospital_id` PK, lat, lng, `accuracy_m`, `source` (`registry`|`device`), `captured_by/at`, `confirmed_by/at`. RLS: select for the hospital's staff and superadmin; no client writes.
7. **`onboarding_events`:** form, event, section, `field_key`, `error_code`, `elapsed_ms`, `tab_id`, `created_at`. RLS: superadmin select only; no client writes. Retention of 180 days is enforced by the existing `cleanup-drafts` cron.
8. **Not added (ponytail, recorded):**
   - **An idempotency table:** the submit key's SHA-256 rides in the new account's `user_metadata`. A retry that hits "already registered" with the same key returns the original result.
   - **A setup-state table:** checklist state is derived from the data, as the wizard already does.
   - **A `registry_facilities` table:** see §4.
   - **The officer contact split** replaces `callback_*` for **new** rows only. The 5 existing rows keep `callback_*` because SQL can't decrypt app-encrypted values, and the admin view reads both.

**Edge functions changed** (they deploy with the web):
- `approve-hospital-application`: the verify step, `verified` added as a starting state, and it now sets `hospitals.district`/`region` text (emergency contacts match on it; today it is NULL for every onboarded hospital).
- `reject-hospital-application`: accepts `verified`.
- `approve-staff-affiliation`: the DOC-1 licence guard for clinical cadres, plus an optional `licence_valid_until`.

## 7. Copy deck
Every visible v2 string lives in **`content/onboarding.ts`** (data, as in `content/auth.ts`). A test enforces the invariants: no "email you", "we'll text", "notify you by email", "cadre", "affiliation" or "tenant" on public v2 surfaces, and reading grade ≤ 8 on patient copy.
- **PROVISIONAL (CSO + lawyer):**
  - the under-18 message: *"MedSync accounts for people under 18 need a parent or guardian. This isn't available online yet."*
  - the three "How we use your details" lines, each restating one v1.0 clause: (a)+(c) running your account and connecting you with partner facilities; no identifying data shared for marketing; a copy or deletion on request.
- **D19 (lawyer):** v1.0 names no staff-verification purpose. The staff forms show the same three lines, with nothing added.

## 8. Test plan

| Layer | Where | What |
|---|---|---|
| Engine units | `tests/onboarding-v2/*.test.ts` (vitest, node) | LOC-1..10, REG-1..6, PRO-1..4, DOC-1..4, EV-1..3 rule ids; phone normalisation; NIN soft check; password policy; under-18; idempotency; the email-typo hint; the copy invariants; red scarcity on the v2 kit and routes |
| SQL | harness `pg/probe.mjs` (PGlite, all 71 migrations) | LOC-1 and LOC-4 triggers; the legacy mapping; generated `documents_complete`; RLS probes for `facility_locations` and `onboarding_events` (anon, patient, same-hospital staff, other-hospital staff, hospital admin, superadmin) |
| UI | harness `cdp.mjs` (headless Chrome) | S1–S15 at 360 px and 1440 px: screenshots, axe, mocked geolocation, network drop, the Emergency overlap measure, first-load JS against the §11 budgets |
| Live | after the owner applies 0070 | one lifecycle run per form on a test account, cleaned up afterwards |

## 9. ADR drafts (0119–0128)
- 0119: one page per form, no Next.
- 0120: the field ledger (ask, derive, defer).
- 0121: the location engine.
- 0122: the MoH registry as the source.
- 0123: profession picker and generic roles.
- 0124: documents after submit.
- 0125: the DPA after verification.
- 0126: a PII-free onboarding funnel.
- 0127: one password policy (and the NIST SP 800-63B-4 deviation for patients).
- 0128: the interim under-18 block.

Written at STOP 7 from the build record.

## 10. Appendix A and B corrections
- **Appendix A** holds, with these changes:
  - `physical_address` (NOT NULL) is derived from the place path at application; "directions or landmark" in the setup checklist refines it.
  - `institutional_email_domain` (NOT NULL) is derived from the work email.
  - `applicant_role` stays 6 options.
  - The patient's `title_code`, ID and language go to `/patient/profile`, which gains ID (NIN / passport / refugee ID / other) and title editing.
- **Appendix B** holds, except:
  - Pharmacist's generic role is new (`PHARMACIST_GENERAL`, "Pharmacist"). `PHARMACIST_WARD` stays for existing rows.
  - Nutritionist is seeded under AHPC (confirm).
  - Grades for Clinical officer and Lab technician are optional on the pending page, not in the form.

## 11–12. Performance budgets and final numbers
As in the prompt §11–§12. Baseline first-load JS (gz, measured 25 Sep):

| Route | kB |
|---|---|
| `/signup/patient` | 313.3 |
| `/signup/clinical` | 313.3 |
| `/signup/non-clinical` | 313.1 |
| `/signup/hospital` | 381.8 |
| `/onboarding/*-pending` | 236.6 |
| `/admin/setup` | 313.9 |
| `/patient/profile` | 316.1 |

## 13. Decisions

D1–D19 and E1–E6 as recommended in the prompt, with these amendments:

| # | Amendment |
|---|---|
| D2a | The catalogue lists stay at 8 / 4 / 6 until the validated JSON is supplied (Q8). **Owner action: send the JSON.** |
| D3 | The dataset is COD-AB v01 (UBOS 2020). Parish and village are deferred until a UBOS parish list with codes is supplied. |
| D5 | NHFR public API (live). MFL 2018 is not needed. |
| D7 | Implemented as Verify → sign → Approve & provision (§2.7). |
| D9 | AHPC is included in the private licence list; **its scope still needs confirming (PROVISIONAL)**. |
| D12 | ID types: NIN, passport, refugee ID, other. |
| D16 | The funnel report is a script (`scripts/onboarding-funnel.mjs`), which is smaller than a page. |
| E1 | Per-level tables (§3). |
| E2 | In-process search (§3). |
| New | A per-browser preview: visiting `/signup/preview` sets a cookie that turns v2 on for that browser only. `ONBOARDING_V2=1` turns it on for everyone. This lets the owner see v2 in production while the old forms stay the default (D18). |

**Signature:** the owner, by instruction "go through all gates", 25 Sep 2026.
**CSO confirmation outstanding:** the under-18 message, the consent summary lines, and D9's AHPC scope.
**Lawyer:** D19.
