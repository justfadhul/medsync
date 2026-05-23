"use client";

import type {
  HospitalApplicationErrors,
  HospitalApplicationState,
  loadSubcountiesForDistrictActionHospital,
  submitHospitalApplicationAction,
} from "./actions";
import type { ComboboxItem, MultiStepStep } from "@/components/forms";
import { useActionState } from "react";

import {
  CascadingCombobox,
  Combobox,
  ConsentCheckbox,
  Field,
  FileUpload,
  MultiStepForm,
  PhoneInput,
  RadioCards,
  SegmentedControl,
} from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * GATE E — hospital application form (Client Component).
 *
 * Five steps:
 *   1. Facility — name, level, ownership, district → subcounty,
 *      registration number + authority, physical address,
 *      institutional email domain
 *   2. Authorisation document upload
 *   3. Applicant identity (full name, role at facility, phone)
 *   4. Account credentials
 *   5. Consent + submit
 *
 * Once submitted, the applicant lands at `pending_approval` and the
 * application is in `pending_approval`. A superadmin review (GATE F
 * Edge Function `approve-hospital-application`) creates the
 * public.hospitals row, sets approved_hospital_id, and elevates the
 * applicant to hospital_admin scoped to the new hospital.
 */
export interface HospitalApplicationFormProps {
  districts: ReadonlyArray<ComboboxItem>;
  consent: {
    version: string;
    bodySha256: string;
    body: string;
    effectiveDate: string;
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
    label: "Public — Ministry of Health",
    description: "Government-owned facility under MoH.",
  },
  {
    value: "private",
    caption: "Private",
    label: "Private for-profit",
    description: "Privately-owned, fee-for-service.",
  },
  {
    value: "pnfp",
    caption: "PNFP",
    label: "Private not-for-profit",
    description: "Faith-based or community-owned, mission-led.",
  },
  {
    value: "private_clinic",
    caption: "Clinic",
    label: "Private clinic",
    description: "Solo / small group practice.",
  },
];

export function HospitalApplicationForm({
  districts,
  consent,
  loadSubcounties,
  submit,
}: HospitalApplicationFormProps) {
  const [state, formAction, isPending] = useActionState<HospitalApplicationState, FormData>(
    submit,
    {},
  );
  const errors: HospitalApplicationErrors = state.errors ?? {};
  const v = state.values ?? {};

  const steps: MultiStepStep[] = [
    {
      key: "facility",
      label: "Facility",
      heading: "About the hospital",
      intro:
        "Tell us about the facility you're applying on behalf of. We'll cross-check the registration number with the MoH facility list before approval.",
      render: () => (
        <>
          <Field
            name="hospital_name"
            label="Hospital name"
            required
            serverError={errors.hospital_name}
          >
            <Input
              name="hospital_name"
              defaultValue={v.hospital_name ?? ""}
              aria-invalid={!!errors.hospital_name || undefined}
            />
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
              defaultValue={v.facility_level}
              invalid={!!errors.facility_level}
              placeholder="Pick the MoH level"
            />
          </Field>

          <Field name="ownership" label="Ownership model" required serverError={errors.ownership}>
            <RadioCards
              name="ownership"
              ariaLabel="Ownership"
              defaultValue={typeof v.ownership === "string" ? v.ownership : undefined}
              options={OWNERSHIP_OPTIONS}
              invalid={!!errors.ownership}
            />
          </Field>

          <CascadingCombobox
            parentName="district_id"
            parentLabel="District"
            parentItems={districts}
            parentPlaceholder="Search districts…"
            parentDefaultValue={v.district_id}
            parentInvalid={!!errors.district_id}
            childName="subcounty_id"
            childLabel="Subcounty (optional)"
            childPlaceholder="Search subcounties…"
            childDefaultValue={v.subcounty_id}
            childInvalid={!!errors.subcounty_id}
            loadChildren={loadSubcounties}
          />

          <Field
            name="physical_address"
            label="Physical address"
            description="Street / plot / village as it appears on registration documents."
            required
            serverError={errors.physical_address}
          >
            <Input
              name="physical_address"
              defaultValue={v.physical_address ?? ""}
              aria-invalid={!!errors.physical_address || undefined}
            />
          </Field>

          <Field
            name="registration_number"
            label="Registration / licence number"
            description="As issued by the MoH facility registry or relevant council."
            required
            serverError={errors.registration_number}
          >
            <Input
              name="registration_number"
              defaultValue={v.registration_number ?? ""}
              aria-invalid={!!errors.registration_number || undefined}
            />
          </Field>

          <Field
            name="registration_authority"
            label="Issuing authority (optional)"
            description="e.g. MoH Facility List, UMDPC."
          >
            <Input name="registration_authority" defaultValue={v.registration_authority ?? ""} />
          </Field>

          <Field
            name="institutional_email_domain"
            label="Institutional email domain"
            description="e.g. mulago.go.ug. We use this as a verification signal."
            required
            serverError={errors.institutional_email_domain}
          >
            <Input
              name="institutional_email_domain"
              autoComplete="off"
              placeholder="mulago.go.ug"
              defaultValue={v.institutional_email_domain ?? ""}
              aria-invalid={!!errors.institutional_email_domain || undefined}
            />
          </Field>
        </>
      ),
    },
    {
      key: "document",
      label: "Authorisation",
      heading: "Upload your authorisation",
      intro:
        "A signed letter or registration certificate from the facility leadership authorising you to apply on their behalf. Stored privately; only superadmin reviewers see it.",
      render: () => (
        <Field
          name="authorisation_document"
          label="Authorisation document"
          description="PDF, JPG or PNG. ≤ 5 MB."
        >
          <FileUpload
            name="authorisation_document"
            accept="application/pdf,image/jpeg,image/png"
            maxMb={5}
            capture="environment"
            hint="Letter of authorisation, registration certificate, etc."
          />
        </Field>
      ),
    },
    {
      key: "applicant",
      label: "You",
      heading: "About you",
      intro:
        "You'll be the primary contact and the first hospital admin for this facility on MedSync.",
      render: () => (
        <>
          <Field
            name="applicant_full_name"
            label="Your name"
            required
            serverError={errors.applicant_full_name}
          >
            <Input
              name="applicant_full_name"
              autoComplete="name"
              defaultValue={v.applicant_full_name ?? ""}
              aria-invalid={!!errors.applicant_full_name || undefined}
            />
          </Field>

          <Field
            name="applicant_role"
            label="Your role at the facility"
            description="e.g. Hospital Director, Administrator, IT Lead."
            required
            serverError={errors.applicant_role}
          >
            <Input
              name="applicant_role"
              defaultValue={v.applicant_role ?? ""}
              aria-invalid={!!errors.applicant_role || undefined}
            />
          </Field>

          <Field
            name="applicant_phone_e164"
            label="Mobile phone"
            required
            serverError={errors.applicant_phone_e164}
          >
            <PhoneInput
              name="applicant_phone_e164"
              defaultValue={v.applicant_phone_e164}
              invalid={!!errors.applicant_phone_e164}
              mobileOnly
            />
          </Field>
        </>
      ),
    },
    {
      key: "account",
      label: "Account & consent",
      heading: "Create your account",
      intro:
        "You'll review your hospital's invite link and onboard your first clinicians once approved.",
      render: () => (
        <>
          <Field
            name="applicant_email"
            label="Email"
            description="Ideally on your institutional domain."
            required
            serverError={errors.applicant_email}
          >
            <Input
              type="email"
              name="applicant_email"
              autoComplete="email"
              defaultValue={v.applicant_email ?? ""}
              aria-invalid={!!errors.applicant_email || undefined}
            />
          </Field>

          <Field
            name="applicant_password"
            label="Password"
            description="At least 12 characters."
            required
            serverError={errors.applicant_password}
          >
            <Input
              type="password"
              name="applicant_password"
              autoComplete="new-password"
              minLength={12}
              maxLength={72}
              aria-invalid={!!errors.applicant_password || undefined}
            />
          </Field>

          <details className="border-border bg-card rounded-md border p-4 text-[12.5px]">
            <summary className="text-foreground cursor-pointer font-medium">
              Read the consent text (v{consent.version}, effective {consent.effectiveDate})
            </summary>
            <p className="text-muted-foreground mt-3 leading-snug whitespace-pre-line">
              {consent.body}
            </p>
          </details>

          <ConsentCheckbox
            name="data_processing_consent"
            required
            invalid={!!errors.data_processing_consent}
            version={consent.version}
            bodySha256={consent.bodySha256}
            label="I agree to MedSync's data-processing notice"
            description={`v${consent.version} · effective ${consent.effectiveDate}.`}
          />

          {errors._form ? (
            <p
              role="alert"
              className="text-destructive border-destructive bg-alert-bg rounded-sm border px-3 py-2 text-[12.5px]"
            >
              {errors._form}
            </p>
          ) : null}

          <Button type="submit" variant="primary" size="lg" disabled={isPending}>
            {isPending ? "Submitting for review…" : "Submit application"}
          </Button>
        </>
      ),
    },
  ];

  return (
    <form
      action={formAction}
      className={cn("mx-auto flex w-full max-w-3xl flex-col gap-7 px-5 py-12 sm:px-8 sm:py-16")}
      noValidate
      encType="multipart/form-data"
    >
      <MultiStepForm flowLabel="Hospital application" steps={steps} />
    </form>
  );
}

/* SegmentedControl unused for now — kept imported so the field
 * primitive set is visible if reviewers swap representations. */
void SegmentedControl;
