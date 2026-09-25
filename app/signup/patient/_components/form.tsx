"use client";

import type {
  loadSubcountiesForDistrictAction,
  PatientSignupErrors,
  PatientSignupState,
  submitPatientSignupAction,
} from "../actions";
import type { ComboboxItem, MultiStepStep } from "@/components/forms";
import { useActionState, useState } from "react";
import { TriangleAlertIcon } from "lucide-react";

import {
  AvatarUpload,
  CascadingCombobox,
  ConsentCheckbox,
  DatePicker,
  Field,
  MultiStepForm,
  PasswordInput,
  PhoneInput,
  SegmentedControl,
} from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SMS_CONSENT_COPY } from "@/lib/notifications/consent-copy";
import { cn } from "@/lib/utils";

/**
 * GATE C — patient signup multi-step form (Client Component).
 *
 * Owns the in-flight field state across three steps (identity →
 * address-and-care → account-and-consent). The last step embeds its
 * own Server-Action <form>; the MultiStepForm shell yields control
 * once that step is active so the submit button is the form's own.
 *
 * Why everything lives in one client component: the FormData posted
 * to the action needs ALL fields (identity, address, consent) — they
 * have to mount inside ONE <form>. We keep step changes purely
 * visual (CSS hide/show) so the inputs stay in the DOM, validate
 * server-side in one shot, and let users navigate back and forth
 * without losing values to React remounts.
 */
export interface PatientSignupFormProps {
  districts: ReadonlyArray<ComboboxItem>;
  consent: {
    version: string;
    bodySha256: string;
    body: string;
    effectiveDate: string;
  };
  /** Gate E: SMS about bookings — declinable (PRD §5.2). Null when no text is seeded yet. */
  smsConsent: {
    version: string;
    bodySha256: string;
    body: string;
    effectiveDate: string;
  } | null;
  loadSubcounties: typeof loadSubcountiesForDistrictAction;
  submit: typeof submitPatientSignupAction;
}

const TITLE_OPTIONS = [
  { value: "mr", label: "Mr" },
  { value: "ms", label: "Ms" },
  { value: "mrs", label: "Mrs" },
  { value: "dr", label: "Dr" },
  { value: "other", label: "Other" },
];

const SEX_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "intersex", label: "Intersex" },
  { value: "prefer_not_say", label: "Prefer not to say" },
];

const ID_TYPE_OPTIONS = [
  { value: "nin", label: "NIN", description: "Uganda National ID" },
  { value: "passport", label: "Passport", description: "International travel doc" },
  { value: "none", label: "None", description: "No formal ID on hand" },
];

export function PatientSignupForm({
  districts,
  consent,
  smsConsent,
  loadSubcounties,
  submit,
}: PatientSignupFormProps) {
  const [state, formAction, isPending] = useActionState<PatientSignupState, FormData>(submit, {});

  const [idType, setIdType] = useState<string>("nin");
  const errors: PatientSignupErrors = state.errors ?? {};
  // state.values intentionally unused — user input persists across
  // action error re-renders via native DOM / base-ui internal state.

  const steps: MultiStepStep[] = [
    {
      key: "identity",
      label: "About you",
      heading: "Tell us who you are",
      intro:
        "All identifying details are encrypted before they reach the database. We never store your ID number in plaintext.",
      render: () => (
        <>
          <Field name="title_code" label="Title">
            <SegmentedControl name="title_code" ariaLabel="Title" options={TITLE_OPTIONS} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="first_name" label="First name" required serverError={errors.first_name}>
              <Input
                name="first_name"
                autoComplete="given-name"
                aria-invalid={!!errors.first_name || undefined}
              />
            </Field>
            <Field name="surname" label="Surname" required serverError={errors.surname}>
              <Input
                name="surname"
                autoComplete="family-name"
                aria-invalid={!!errors.surname || undefined}
              />
            </Field>
          </div>

          <Field name="sex" label="Sex at birth" required serverError={errors.sex}>
            <SegmentedControl
              name="sex"
              ariaLabel="Sex at birth"
              options={SEX_OPTIONS}
              invalid={!!errors.sex}
            />
          </Field>

          <Field
            name="date_of_birth"
            label="Date of birth"
            description="Used for age-appropriate care."
            required
            serverError={errors.date_of_birth}
          >
            <DatePicker
              name="date_of_birth"
              minAge={0}
              maxAge={120}
              invalid={!!errors.date_of_birth}
            />
          </Field>

          <Field name="id_type" label="ID type" required serverError={errors.id_type}>
            <SegmentedControl
              name="id_type"
              ariaLabel="ID type"
              defaultValue={"nin"}
              options={ID_TYPE_OPTIONS}
              onValueChange={(next) => setIdType(next)}
              invalid={!!errors.id_type}
            />
          </Field>

          {idType !== "none" ? (
            <Field
              name="id_number"
              label="ID number"
              description="Encrypted at rest. Visible only to you and care teams you authorise."
              required
              serverError={errors.id_number}
            >
              <Input
                name="id_number"
                autoComplete="off"
                inputMode="text"
                aria-invalid={!!errors.id_number || undefined}
              />
            </Field>
          ) : null}

          <Field
            name="phone_e164"
            label="Phone"
            description="We'll text appointment reminders. Visible only to you and care teams you authorise."
            required
            serverError={errors.phone_e164}
          >
            <PhoneInput name="phone_e164" invalid={!!errors.phone_e164} mobileOnly />
          </Field>

          <Field
            name="photo"
            label="Photo (optional)"
            description="Shown to the care team who see your record."
          >
            <AvatarUpload name="photo" />
          </Field>
        </>
      ),
    },
    {
      key: "address",
      label: "Where & care",
      heading: "Where you live & your home facility",
      intro:
        "We use this to route SMS, suggest nearby queues, and connect you to your usual hospital.",
      render: () => (
        <>
          <CascadingCombobox
            parentName="district_id"
            parentLabel="District"
            parentItems={districts}
            parentPlaceholder="Search districts…"
            parentInvalid={!!errors.district_id}
            childName="subcounty_id"
            childLabel="Subcounty"
            childPlaceholder="Search subcounties…"
            childInvalid={!!errors.subcounty_id}
            loadChildren={loadSubcounties}
          />

          <Field
            name="village_address"
            label="Village or street address (optional)"
            description="Free-text. Encrypted at rest."
          >
            <Input name="village_address" autoComplete="address-level3" />
          </Field>

          <Field name="preferred_language" label="Preferred language for communications (optional)">
            <Input
              name="preferred_language"
              autoComplete="off"
              placeholder="e.g. English, Luganda, Runyoro"
            />
          </Field>
        </>
      ),
    },
    {
      key: "account",
      label: "Account",
      heading: "Create your account",
      intro: "You'll sign in with this email. Pick a long password — a passphrase works well.",
      render: () => (
        <>
          <Field name="full_name" label="Name to display" required serverError={errors.full_name}>
            <Input
              name="full_name"
              autoComplete="name"
              aria-invalid={!!errors.full_name || undefined}
            />
          </Field>

          <Field name="email" label="Email" required serverError={errors.email}>
            <Input
              type="email"
              name="email"
              autoComplete="email"
              aria-invalid={!!errors.email || undefined}
            />
          </Field>

          <Field
            name="password"
            label="Password"
            description="At least 12 characters."
            required
            serverError={errors.password}
          >
            <PasswordInput
              name="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={72}
              aria-invalid={!!errors.password || undefined}
            />
          </Field>

          <details className="border-border bg-card rounded-md border p-4 text-[12.5px]">
            <summary className="text-foreground hover:text-brand-700 dark:hover:text-brand-300 cursor-pointer font-medium transition-colors duration-150">
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
            description={`v${consent.version} · effective ${consent.effectiveDate}. The exact text above is recorded against your account.`}
          />

          {/* Gate E (ADR 0090, PRD §5.2): its own box, never bundled with the
              notice above. Unticked by default — consent is opt-in — and the
              form submits either way. The honest sentence says what declining
              means; nothing is lost but the SMS. */}
          {smsConsent ? (
            <ConsentCheckbox
              name="sms_communication_consent"
              invalid={!!errors.sms_communication_consent}
              version={smsConsent.version}
              bodySha256={smsConsent.bodySha256}
              label={SMS_CONSENT_COPY.label}
              description={`${smsConsent.body} ${SMS_CONSENT_COPY.declined} ${SMS_CONSENT_COPY.receiptException}`}
            />
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
                Creating account…
              </>
            ) : (
              "Create account"
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
      <MultiStepForm flowLabel="Patient signup" steps={steps} />
    </form>
  );
}
