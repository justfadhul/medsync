"use client";

import type { HospitalApplicationErrors } from "../_lib/schema";
import type {
  HospitalApplicationState,
  loadSubcountiesForDistrictActionHospital,
  submitHospitalApplicationAction,
} from "../actions";
import type { ImSpecialty } from "./im-subspecialty-picker";
import type { ComboboxItem, MultiStepStep } from "@/components/forms";
import { useActionState, useState } from "react";
import { TriangleAlertIcon } from "lucide-react";

import {
  CascadingCombobox,
  Checkbox,
  Combobox,
  ConsentCheckbox,
  Field,
  FileUpload,
  MultiStepForm,
  PasswordInput,
  PhoneInput,
  RadioCards,
  SegmentedControl,
} from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  APPLICANT_ROLE_CHOICES,
  AUTHORITY_TITLE_CHOICES,
  BED_CAPACITY_BANDS,
  CALLBACK_KIND_CHOICES,
  CONNECTIVITY_CHOICES,
  DEPARTMENT_GROUPS,
  DIAGNOSTIC_CHOICES,
  EMR_CHOICES,
  LICENSING_BODY_CHOICES,
  OPD_BANDS,
  POWER_CHOICES,
  SERVICE_OFFERED_CHOICES,
  SIGNATORY_TITLE_CHOICES,
  SPECIALISED_CLINIC_CHOICES,
  STAFF_BANDS,
  SUPPORT_SERVICE_CHOICES,
} from "../_lib/catalog";
import { hospitalApplicationPayload, HospitalApplicationSchema } from "../_lib/schema";
import { ImSubspecialtyPicker } from "./im-subspecialty-picker";

/**
 * Hospital application form — upgraded for the registration-upgrade
 * spec (kickoff §B–§E, GATE B). Seven steps matching the kickoff
 * section structure:
 *
 *   1. Institution        (§B)
 *   2. Departments        (§C; nested IM sub-specialties revealed when
 *                          Internal Medicine is ticked)
 *   3. Clinical services  (§D part 1 — clinics + diagnostics + support)
 *   4. Operating profile  (§D part 2 — bands + connectivity + EMR)
 *   5. Verification       (§E6 — licence, applicant, authority, callback)
 *   6. Agreement          (§E7 — DPA, signatory, toggles)
 *   7. Account + consent  (applicant credentials + personal consent)
 *
 * After submit the applicant lands at `state='pending_approval'` and
 * the application enters `pending_approval`. Superadmin review (GATE
 * C of the upgrade — extended Edge Functions) advances through
 * `under_review → verified → agreement_signed → provisioning → active`.
 */
export interface HospitalApplicationFormProps {
  districts: ReadonlyArray<ComboboxItem>;
  regions: ReadonlyArray<ComboboxItem>;
  imSubspecialties: ReadonlyArray<ImSpecialty>;
  dpa: {
    id: string;
    version: string;
    bodySha256: string;
    body: string;
    isPlaceholder: boolean;
  };
  consent: {
    version: string;
    bodySha256: string;
    body: string;
  };
  loadSubcounties: typeof loadSubcountiesForDistrictActionHospital;
  submit: typeof submitHospitalApplicationAction;
}

const FACILITY_LEVEL_OPTIONS: ComboboxItem[] = [
  { value: "hc_ii", label: "Health Centre II" },
  { value: "hc_iii", label: "Health Centre III" },
  { value: "hc_iv", label: "Health Centre IV" },
  { value: "general", label: "General Hospital" },
  { value: "regional_referral", label: "Regional Referral Hospital" },
  { value: "national_referral", label: "National Referral Hospital" },
  { value: "private", label: "Private hospital / clinic" },
  { value: "other", label: "Other" },
];

const OWNERSHIP_OPTIONS = [
  {
    value: "public_moh",
    caption: "Government",
    label: "Public — MoH",
    description: "Government-owned.",
  },
  {
    value: "private",
    caption: "Private",
    label: "Private for-profit",
    description: "Fee-for-service.",
  },
  {
    value: "pnfp",
    caption: "PNFP",
    label: "Private not-for-profit",
    description: "Faith / mission-led.",
  },
  {
    value: "private_clinic",
    caption: "Clinic",
    label: "Private clinic",
    description: "Solo / small group.",
  },
];

const PHARMACY_SEGMENTS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

function asComboItems<T extends { code: string; label: string }>(
  list: ReadonlyArray<T>,
): ComboboxItem[] {
  return list.map((c) => ({ value: c.code, label: c.label }));
}

export function HospitalApplicationForm({
  districts,
  regions,
  imSubspecialties,
  dpa,
  consent,
  loadSubcounties,
  submit,
}: HospitalApplicationFormProps) {
  const [state, formAction, isPending] = useActionState<HospitalApplicationState, FormData>(
    submit,
    {},
  );
  // Continue checks the step against the server's own schema (the fields this step renders);
  // those errors sit over the last submit's.
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});
  const errors: HospitalApplicationErrors & Record<string, string | undefined> = {
    ...state.errors,
    ...stepErrors,
  };

  function validateStep(section: HTMLElement): boolean {
    const form = section.closest("form");
    if (!form) return true;
    const data = new FormData(form);
    const { cleaned } = hospitalApplicationPayload(data);
    const here = new Set(
      Array.from(section.querySelectorAll("[name]"), (el) => el.getAttribute("name")),
    );
    const found: Record<string, string> = {};
    for (const issue of HospitalApplicationSchema.safeParse(cleaned).error?.issues ?? []) {
      const key = String(issue.path[0]);
      if (here.has(key) && !found[key]) found[key] = key in cleaned ? issue.message : "Required.";
    }
    // The server's cross-field and upload checks, a step early.
    const departments = cleaned.departments;
    if (
      here.has("primary_department") &&
      !found.primary_department &&
      Array.isArray(departments) &&
      !departments.includes(String(cleaned.primary_department))
    ) {
      found.primary_department = "Primary must be one of your selected departments.";
    }
    for (const name of ["facility_licence_document", "authority_letter_document"]) {
      const file = data.get(name);
      if (here.has(name) && !(file instanceof File && file.size > 0)) found[name] = "Required.";
    }
    setStepErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      section
        .querySelector(`[name="${first}"]`)
        ?.closest("div")
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    return !first;
  }

  const steps: MultiStepStep[] = [
    /* ─── Step 1 — Institution (§B) ────────────────────────────── */
    {
      key: "institution",
      label: "Institution",
      heading: "About the hospital",
      intro: "We'll cross-check this against the MoH facility list during verification.",
      render: () => (
        <>
          <Field
            name="hospital_name"
            label="Official hospital name"
            required
            serverError={errors.hospital_name}
          >
            <Input name="hospital_name" aria-invalid={!!errors.hospital_name || undefined} />
          </Field>
          <Field name="hospital_aka" label="Also known as (optional)">
            <Input name="hospital_aka" />
          </Field>
          <Field
            name="facility_level"
            label="Facility level"
            required
            serverError={errors.facility_level}
          >
            <Combobox
              name="facility_level"
              items={FACILITY_LEVEL_OPTIONS}
              invalid={!!errors.facility_level}
              placeholder="Pick the MoH level"
            />
          </Field>
          <Field name="ownership" label="Ownership model" required serverError={errors.ownership}>
            <RadioCards
              name="ownership"
              ariaLabel="Ownership"
              options={OWNERSHIP_OPTIONS}
              invalid={!!errors.ownership}
            />
          </Field>
          <Field
            name="year_established"
            label="Year established (optional)"
            description="Year between 1900 and now."
            serverError={errors.year_established}
          >
            <Input
              name="year_established"
              type="number"
              min={1900}
              max={new Date().getFullYear()}
              inputMode="numeric"
            />
          </Field>
          <Field
            name="region_id"
            label="Region (optional)"
            description="Auto-fills from district where possible."
          >
            <Combobox
              name="region_id"
              items={regions}
              invalid={!!errors.region_id}
              placeholder="Pick the region"
            />
          </Field>
          <CascadingCombobox
            parentName="district_id"
            parentLabel="District"
            parentItems={districts}
            parentPlaceholder="Search districts…"
            parentInvalid={!!errors.district_id}
            childName="subcounty_id"
            childLabel="Subcounty (optional)"
            childPlaceholder="Search subcounties…"
            childInvalid={!!errors.subcounty_id}
            loadChildren={loadSubcounties}
          />
          <Field
            name="physical_address"
            label="Physical address"
            required
            serverError={errors.physical_address}
          >
            <Input name="physical_address" aria-invalid={!!errors.physical_address || undefined} />
          </Field>
          <Field name="main_phone" label="Main phone" required serverError={errors.main_phone}>
            <PhoneInput name="main_phone" invalid={!!errors.main_phone} />
          </Field>
          <Field
            name="official_email"
            label="Official email"
            required
            serverError={errors.official_email}
          >
            <Input
              name="official_email"
              type="email"
              autoComplete="off"
              aria-invalid={!!errors.official_email || undefined}
            />
          </Field>
          <Field name="website" label="Website (optional)" serverError={errors.website}>
            <Input name="website" type="url" placeholder="https://" />
          </Field>
        </>
      ),
    },

    /* ─── Step 2 — Departments (§C) ────────────────────────────── */
    {
      key: "departments",
      label: "Departments",
      heading: "Clinical departments",
      intro: "Tick the departments you actively run. Pick the one to launch MedSync in first.",
      render: () => (
        <>
          {DEPARTMENT_GROUPS.map((group) => (
            <fieldset key={group.groupLabel} className="border-border rounded-md border p-3">
              <legend className="text-foreground px-1 text-[12px] font-medium">
                {group.groupLabel}
              </legend>
              <div className="grid grid-cols-1 gap-1.5 pt-1 sm:grid-cols-2">
                {group.items.map((d) => (
                  <Checkbox key={d.code} name="departments" value={d.code} label={d.label} />
                ))}
              </div>
              {group.nested === "im_subspecialties" ? (
                <ImSubspecialtyPicker
                  specialties={imSubspecialties}
                  internalMedicineCheckboxName="departments"
                />
              ) : null}
            </fieldset>
          ))}
          {errors.departments ? (
            <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">
              {errors.departments}
            </p>
          ) : null}

          <Field
            name="primary_department"
            label="Primary department for MedSync rollout"
            description="The first deployable slice."
            required
            serverError={errors.primary_department}
          >
            <Combobox
              name="primary_department"
              items={DEPARTMENT_GROUPS.flatMap((g) =>
                g.items.map((i) => ({ value: i.code, label: i.label })),
              )}
              invalid={!!errors.primary_department}
              placeholder="Pick one of your ticked departments"
            />
          </Field>
        </>
      ),
    },

    /* ─── Step 3 — Clinical services (§D part 1) ────────────────── */
    {
      key: "clinical",
      label: "Clinical services",
      heading: "Specialised clinics & diagnostics",
      intro: "Selection only — these become the basis for clinic / lab modules later.",
      render: () => (
        <>
          <fieldset className="border-border rounded-md border p-3">
            <legend className="text-foreground px-1 text-[12px] font-medium">
              Specialised clinics / programs
            </legend>
            <div className="grid grid-cols-1 gap-1.5 pt-1 sm:grid-cols-2">
              {SPECIALISED_CLINIC_CHOICES.map((c) => (
                <Checkbox key={c.code} name="specialised_clinics" value={c.code} label={c.label} />
              ))}
            </div>
          </fieldset>

          <fieldset className="border-border rounded-md border p-3">
            <legend className="text-foreground px-1 text-[12px] font-medium">
              Diagnostic services
            </legend>
            <div className="grid grid-cols-1 gap-1.5 pt-1 sm:grid-cols-2">
              {DIAGNOSTIC_CHOICES.map((c) => (
                <Checkbox key={c.code} name="diagnostic_services" value={c.code} label={c.label} />
              ))}
            </div>
          </fieldset>

          <fieldset className="border-border rounded-md border p-3">
            <legend className="text-foreground px-1 text-[12px] font-medium">
              Support services
            </legend>
            <div className="grid grid-cols-1 gap-1.5 pt-1 sm:grid-cols-2">
              {SUPPORT_SERVICE_CHOICES.map((c) => (
                <Checkbox key={c.code} name="support_services" value={c.code} label={c.label} />
              ))}
            </div>
          </fieldset>

          <Field
            name="has_onsite_pharmacy"
            label="On-site pharmacy?"
            required
            serverError={errors.has_onsite_pharmacy}
          >
            <SegmentedControl
              name="has_onsite_pharmacy"
              ariaLabel="On-site pharmacy"
              options={PHARMACY_SEGMENTS}
              invalid={!!errors.has_onsite_pharmacy}
            />
          </Field>
        </>
      ),
    },

    /* ─── Step 4 — Operating profile (§D part 2) ────────────────── */
    {
      key: "operating",
      label: "Operating",
      heading: "Operating profile",
      intro: "Capacity bands + infrastructure — drives offline-first / SMS configuration later.",
      render: () => (
        <>
          <fieldset className="border-border rounded-md border p-3">
            <legend className="text-foreground px-1 text-[12px] font-medium">
              Services offered
            </legend>
            <div className="grid grid-cols-1 gap-1.5 pt-1 sm:grid-cols-2">
              {SERVICE_OFFERED_CHOICES.map((c) => (
                <Checkbox key={c.code} name="services_offered" value={c.code} label={c.label} />
              ))}
            </div>
          </fieldset>

          <Field name="bed_capacity_band" label="Bed capacity">
            <Combobox
              name="bed_capacity_band"
              items={asComboItems(BED_CAPACITY_BANDS)}
              placeholder="Pick a range"
            />
          </Field>
          <Field name="clinical_staff_band" label="Clinical staff count">
            <Combobox
              name="clinical_staff_band"
              items={asComboItems(STAFF_BANDS)}
              placeholder="Pick a range"
            />
          </Field>
          <Field name="daily_opd_band" label="Daily OPD volume">
            <Combobox
              name="daily_opd_band"
              items={asComboItems(OPD_BANDS)}
              placeholder="Pick a range"
            />
          </Field>
          <Field
            name="internet_connectivity"
            label="Internet connectivity"
            required
            serverError={errors.internet_connectivity}
          >
            <SegmentedControl
              name="internet_connectivity"
              ariaLabel="Internet connectivity"
              options={CONNECTIVITY_CHOICES.map((c) => ({ value: c.code, label: c.label }))}
              invalid={!!errors.internet_connectivity}
            />
          </Field>
          <Field name="power_backup" label="Power / backup">
            <SegmentedControl
              name="power_backup"
              ariaLabel="Power / backup"
              options={POWER_CHOICES.map((c) => ({ value: c.code, label: c.label }))}
            />
          </Field>
          <Field name="existing_emr" label="Existing EMR">
            <Combobox
              name="existing_emr"
              items={asComboItems(EMR_CHOICES)}
              placeholder="None / Paper / Existing"
            />
          </Field>
          <Field
            name="existing_emr_name"
            label="Existing EMR name (if Existing)"
            description="Skip if you don't run an EMR today."
          >
            <Input name="existing_emr_name" />
          </Field>
        </>
      ),
    },

    /* ─── Step 5 — Verification & authority (§E6) ────────────────── */
    {
      key: "verification",
      label: "Verification",
      heading: "Verification & authority",
      intro:
        "This is the trust anchor — superadmin uses the callback contact to confirm you have authority to apply.",
      render: () => (
        <>
          <Field
            name="registration_number"
            label="Facility licence / registration number"
            required
            serverError={errors.registration_number}
          >
            <Input
              name="registration_number"
              aria-invalid={!!errors.registration_number || undefined}
            />
          </Field>
          <Field name="registration_authority" label="Issuing authority (optional, free text)">
            <Input name="registration_authority" placeholder="e.g. MoH Facility List, UMDPC" />
          </Field>
          <Field
            name="licensing_body"
            label="Licensing body"
            required
            serverError={errors.licensing_body}
          >
            <Combobox
              name="licensing_body"
              items={asComboItems(LICENSING_BODY_CHOICES)}
              invalid={!!errors.licensing_body}
            />
          </Field>
          <Field
            name="facility_licence_document"
            label="Facility licence document"
            description="PDF / JPG / PNG, ≤ 5 MB. Stored privately."
            required
            serverError={errors.facility_licence_document}
          >
            <FileUpload
              name="facility_licence_document"
              accept="application/pdf,image/jpeg,image/png"
              maxMb={5}
              capture="environment"
              hint="Licence / registration certificate"
            />
          </Field>
          <Field
            name="institutional_email_domain"
            label="Institutional email domain"
            description="e.g. mulago.go.ug — your work email below must match this."
            required
            serverError={errors.institutional_email_domain}
          >
            <Input name="institutional_email_domain" placeholder="mulago.go.ug" />
          </Field>

          <hr className="border-border my-2" />
          <p className="text-muted-foreground text-[12px]">About you (the applicant):</p>

          <Field
            name="applicant_full_name"
            label="Your full name"
            required
            serverError={errors.applicant_full_name}
          >
            <Input name="applicant_full_name" autoComplete="name" />
          </Field>
          <Field
            name="applicant_role"
            label="Your role / title"
            required
            serverError={errors.applicant_role}
          >
            <Combobox
              name="applicant_role"
              items={asComboItems(APPLICANT_ROLE_CHOICES)}
              invalid={!!errors.applicant_role}
              placeholder="Pick your role"
            />
          </Field>
          <Field
            name="applicant_work_email"
            label="Your work email"
            description="Must use the institutional domain above (mismatch is flagged for stricter review, never silently rejected)."
            required
            serverError={errors.applicant_work_email}
          >
            <Input name="applicant_work_email" type="email" autoComplete="email" />
          </Field>
          <Field
            name="applicant_phone"
            label="Your phone"
            required
            serverError={errors.applicant_phone}
          >
            <PhoneInput name="applicant_phone" invalid={!!errors.applicant_phone} />
          </Field>
          <Field
            name="applicant_council_number"
            label="Professional council number (optional, adds weight)"
            description="UMDPC / nursing / pharmacy council, etc."
          >
            <Input name="applicant_council_number" />
          </Field>

          <hr className="border-border my-2" />
          <p className="text-muted-foreground text-[12px]">
            Independent callback contact — a senior officer (NOT you) who can confirm your authority
            by phone or email.
          </p>

          <Field
            name="authority_officer_name"
            label="Senior officer's name"
            required
            serverError={errors.authority_officer_name}
          >
            <Input name="authority_officer_name" />
          </Field>
          <Field
            name="authority_officer_title"
            label="Senior officer's title"
            required
            serverError={errors.authority_officer_title}
          >
            <Combobox
              name="authority_officer_title"
              items={asComboItems(AUTHORITY_TITLE_CHOICES)}
              invalid={!!errors.authority_officer_title}
            />
          </Field>
          <Field
            name="authority_letter_document"
            label="Signed authorisation letter"
            description="On letterhead, naming you as the authorised applicant. PDF / JPG / PNG, ≤ 5 MB."
            required
            serverError={errors.authority_letter_document}
          >
            <FileUpload
              name="authority_letter_document"
              accept="application/pdf,image/jpeg,image/png"
              maxMb={5}
              capture="environment"
              hint="Letter on letterhead"
            />
          </Field>
          <Field
            name="callback_contact_kind"
            label="Callback channel"
            required
            serverError={errors.callback_contact_kind}
          >
            <SegmentedControl
              name="callback_contact_kind"
              ariaLabel="Callback channel"
              options={CALLBACK_KIND_CHOICES.map((c) => ({ value: c.code, label: c.label }))}
              invalid={!!errors.callback_contact_kind}
            />
          </Field>
          <Field
            name="callback_contact_value"
            label="Callback contact"
            description="Phone (Ugandan E.164) or email — the officer's, not yours. Encrypted at rest."
            required
            serverError={errors.callback_contact_value}
          >
            <Input name="callback_contact_value" />
          </Field>
        </>
      ),
    },

    /* ─── Step 6 — Agreement (§E7) ──────────────────────────────── */
    {
      key: "agreement",
      label: "Agreement",
      heading: "Data-Processing Agreement",
      intro:
        "An authorised signatory accepts on behalf of the institution. Acceptance is recorded with the SHA-256 of the exact text shown.",
      render: () => (
        <>
          {dpa.isPlaceholder ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] leading-snug text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
              <TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" strokeWidth={2} />
              <span>
                This is a placeholder DPA pending Ugandan-counsel review. Acceptance is recorded;
                hospitals on the placeholder will be re-prompted when the approved version lands.
              </span>
            </div>
          ) : null}

          <article className="border-border bg-card max-h-[40svh] overflow-y-auto rounded-md border p-4 text-[12.5px] leading-relaxed whitespace-pre-wrap">
            {dpa.body}
          </article>
          <p className="text-muted-foreground font-mono text-[10px]">
            Version: {dpa.version} · SHA-256 (first 12): {dpa.bodySha256.slice(0, 12)}…
          </p>
          <input type="hidden" name="agreement_version_id" value={dpa.id} />
          <input type="hidden" name="agreement_body_sha256" value={dpa.bodySha256} />

          <Field
            name="signatory_name"
            label="Authorised signatory — full name"
            required
            serverError={errors.signatory_name}
          >
            <Input name="signatory_name" />
          </Field>
          <Field
            name="signatory_title"
            label="Signatory title"
            required
            serverError={errors.signatory_title}
          >
            <Combobox
              name="signatory_title"
              items={asComboItems(SIGNATORY_TITLE_CHOICES)}
              invalid={!!errors.signatory_title}
            />
          </Field>
          <Checkbox
            name="authorised_to_bind"
            label="I am authorised to bind this institution to this agreement."
            required
            invalid={!!errors.authorised_to_bind}
          />
          {errors.authorised_to_bind ? (
            <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">
              {errors.authorised_to_bind}
            </p>
          ) : null}
          <Checkbox
            name="accept_agreement"
            label="I accept the Data-Processing Agreement above."
            required
            invalid={!!errors.accept_agreement}
          />
          {errors.accept_agreement ? (
            <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">
              {errors.accept_agreement}
            </p>
          ) : null}
        </>
      ),
    },

    /* ─── Step 7 — Account + consent ────────────────────────────── */
    {
      key: "account",
      label: "Account",
      heading: "Create your account",
      intro:
        "Your account becomes the first hospital admin after approval. The work email + password sign you in.",
      render: () => (
        <>
          <p className="text-muted-foreground text-[12px]">
            We&apos;ll create the account with the work email you entered on the Verification step.
          </p>
          <Field
            name="applicant_password"
            label="Password"
            description="At least 12 characters."
            required
            serverError={errors.applicant_password}
          >
            <PasswordInput name="applicant_password" autoComplete="new-password" minLength={12} />
          </Field>

          <ConsentCheckbox
            name="data_processing_consent"
            label="I consent to MedSync processing my personal data as described in the privacy notice."
            version={consent.version}
            bodySha256={consent.bodySha256}
            invalid={!!errors.data_processing_consent}
          />
          {errors.data_processing_consent ? (
            <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">
              {errors.data_processing_consent}
            </p>
          ) : null}

          {errors._form ? (
            <p
              role="alert"
              className="scale-in flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] leading-snug text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-200"
            >
              <TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" strokeWidth={2} />
              <span>{errors._form}</span>
            </p>
          ) : null}

          <Button type="submit" variant="primary" size="lg" disabled={isPending} className="tap">
            {isPending ? (
              <>
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-full border-2 border-current/30 border-t-current motion-safe:animate-spin"
                />
                Submitting application…
              </>
            ) : (
              "Submit application"
            )}
          </Button>
        </>
      ),
    },
  ];

  return (
    <form
      action={formAction}
      className={cn(
        "reveal-up mx-auto flex w-full max-w-3xl flex-col gap-7 px-5 py-12 sm:px-8 sm:py-16",
      )}
      noValidate
    >
      <MultiStepForm flowLabel="Hospital application" steps={steps} validateStep={validateStep} />
    </form>
  );
}
