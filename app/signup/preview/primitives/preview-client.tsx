"use client";

import { BuildingIcon, StethoscopeIcon, UserIcon } from "lucide-react";

import {
  CascadingCombobox,
  Checkbox,
  Combobox,
  ConsentCheckbox,
  DatePicker,
  Field,
  FileUpload,
  OtpInput,
  PhoneInput,
  RadioCards,
  SegmentedControl,
} from "@/components/forms";

/**
 * Client body for the GATE B preview. Lives in a Client Component so
 * `loadChildren` on CascadingCombobox can be a real function (the
 * Server → Client component prop boundary disallows raw functions
 * unless marked "use server"). The sibling `page.tsx` keeps the
 * metadata export.
 */
export function PrimitivesPreview() {
  // Static demo data — not from the DB. Real flows pull via
  // `lib/reference-data.ts`. The CascadingCombobox uses an inline
  // resolver so the preview stays free of network calls.
  const councils = [
    { value: "umdpc", label: "Uganda Medical and Dental Practitioners Council" },
    { value: "unmc", label: "Uganda Nurses and Midwives Council" },
    { value: "ahpc", label: "Allied Health Professionals Council" },
    {
      value: "pharmacy-board",
      label: "Pharmacy Board",
      searchText: "psu pharmaceutical society pharmacists",
    },
  ];

  const cadresByCouncil: Record<string, Array<{ value: string; label: string }>> = {
    umdpc: [
      { value: "medical_officer", label: "Medical Officer" },
      { value: "consultant", label: "Consultant" },
      { value: "dentist", label: "Dentist" },
    ],
    unmc: [
      { value: "registered_nurse", label: "Registered Nurse" },
      { value: "enrolled_nurse", label: "Enrolled Nurse" },
      { value: "midwife", label: "Midwife" },
    ],
    ahpc: [
      { value: "lab_tech", label: "Laboratory Technician" },
      { value: "radiographer", label: "Radiographer" },
      { value: "physio", label: "Physiotherapist" },
    ],
    "pharmacy-board": [
      { value: "pharmacist", label: "Pharmacist" },
      { value: "pharm_tech", label: "Pharmacy Technician" },
    ],
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-12 px-5 py-14 sm:px-8 sm:py-20">
      <header className="flex flex-col gap-3">
        <span className="text-muted-foreground inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase">
          <span className="size-1 rounded-full bg-teal-500" />
          Onboarding · GATE B · primitives preview
        </span>
        <h1
          className="font-display text-foreground text-[34px] leading-[1.05] tracking-[-0.025em] sm:text-[44px]"
          style={{ fontWeight: 400 }}
        >
          Shared form primitives
        </h1>
        <p className="text-muted-foreground max-w-[60ch] text-[14.5px] leading-[1.55]">
          The library that powers patient, clinical and hospital signups (GATE C/D/E). Every control
          submits via native form behaviour — pair with a Server Action and the values arrive as
          FormData.
        </p>
      </header>

      <Demo
        title="Field"
        description="Wrapper providing label, helper text, required affordance, and a slot for server-side errors."
      >
        <Field
          name="display_name"
          label="Display name"
          description="What clinicians and patients will see."
          required
        >
          <input
            type="text"
            name="display_name"
            placeholder="e.g. Dr Naika"
            className="border-input bg-card w-full rounded-sm border px-2.5 py-2 text-[13px] outline-none focus-visible:border-teal-500 focus-visible:shadow-[0_0_0_2px_rgba(20,184,166,0.15)]"
          />
        </Field>
        <Field
          name="email_demo"
          label="Email"
          description="Shown with a server-side error to demo the error slot."
          serverError="That email is already linked to a clinician account."
          required
        >
          <input
            type="email"
            name="email_demo"
            defaultValue="dr.naika@medsync.test"
            className="border-destructive bg-alert-bg w-full rounded-sm border px-2.5 py-2 text-[13px] outline-none"
          />
        </Field>
      </Demo>

      <Demo
        title="Combobox"
        description="Searchable single-select. Items can carry synonyms in searchText (try typing 'PSU' against Pharmacy Board)."
      >
        <Field name="council" label="Regulatory council" required>
          <Combobox name="council" items={councils} placeholder="Search councils…" />
        </Field>
      </Demo>

      <Demo
        title="CascadingCombobox"
        description="Parent → child. Clearing or changing the parent clears any stale child value (so users can't end up with mismatched pairs)."
      >
        <CascadingCombobox
          parentName="council_cascade"
          parentLabel="Regulatory council"
          parentItems={councils}
          parentPlaceholder="Pick a council…"
          childName="cadre_cascade"
          childLabel="Cadre"
          childPlaceholder="Pick a cadre…"
          loadChildren={async (council) => cadresByCouncil[council] ?? []}
        />
      </Demo>

      <Demo
        title="SegmentedControl"
        description="Short mutually-exclusive lists. Pill row that stacks on mobile. Each option submits via a hidden radio input."
      >
        <Field name="sex" label="Sex at birth" required>
          <SegmentedControl
            name="sex"
            ariaLabel="Sex at birth"
            options={[
              { value: "male", label: "Male" },
              { value: "female", label: "Female" },
              { value: "intersex", label: "Intersex" },
              { value: "prefer_not_say", label: "Prefer not to say" },
            ]}
          />
        </Field>
      </Demo>

      <Demo
        title="RadioCards"
        description="Heavier choices where each option benefits from an explanation."
      >
        <Field name="account_type" label="What kind of account?" required>
          <RadioCards
            name="account_type"
            ariaLabel="Account type"
            options={[
              {
                value: "patient",
                caption: "Patient",
                label: "I'm seeking care",
                description: "Self / household. Books queue tickets, sees records.",
                icon: <UserIcon className="size-3.5" strokeWidth={2} />,
              },
              {
                value: "clinical",
                caption: "Clinical staff",
                label: "I work at a hospital",
                description:
                  "Council-licensed clinician or allied health. Routes via verification.",
                icon: <StethoscopeIcon className="size-3.5" strokeWidth={2} />,
              },
              {
                value: "hospital",
                caption: "Hospital",
                label: "Apply on behalf of a facility",
                description: "Admin contact for a hospital onboarding request.",
                icon: <BuildingIcon className="size-3.5" strokeWidth={2} />,
              },
            ]}
          />
        </Field>
      </Demo>

      <Demo
        title="Checkbox"
        description="Plain opt-in. Hidden native input — submits as the field name when checked."
      >
        <Checkbox
          name="sms_opt_in"
          label="Send me appointment SMS reminders"
          description="Standard rates apply. You can change this any time in settings."
        />
      </Demo>

      <Demo
        title="ConsentCheckbox"
        description="Carries version + body_sha256 in hidden inputs. The server-side action validates the hash matches the active consent_versions row before writing consent_records."
      >
        <ConsentCheckbox
          name="data_processing_consent"
          required
          version="v1.0"
          bodySha256={"0".repeat(64)}
          label="I agree to MedSync's data processing terms"
          description="Required to create an account. (Demo version + hash; real values come from consent_versions.)"
        />
      </Demo>

      <Demo
        title="PhoneInput"
        description="Uganda-only. Fixed +256 prefix; visible field auto-formats 9 digits; the form submits canonical E.164."
      >
        <Field name="phone_e164" label="Mobile phone" required>
          <PhoneInput name="phone_e164" mobileOnly />
        </Field>
      </Demo>

      <Demo
        title="DatePicker"
        description="Native input[type=date] — opens the OS wheel on mobile. minAge/maxAge convenience for DOB."
      >
        <Field
          name="dob"
          label="Date of birth"
          description="Used for age-appropriate care pathways."
          required
        >
          <DatePicker name="dob" minAge={0} maxAge={120} />
        </Field>
      </Demo>

      <Demo
        title="OtpInput"
        description="6-digit numeric code entry. Triggers iOS SMS autofill via autocomplete='one-time-code'. Used for MFA and the SMS verification step in the patient flow."
      >
        <Field
          name="otp"
          label="Verification code"
          description="We'll send a 6-digit code to your phone."
          required
        >
          <OtpInput name="otp" length={6} />
        </Field>
      </Demo>

      <Demo
        title="FileUpload"
        description="Drag-and-drop with click-to-pick fallback. Mobile camera capture wired for licence-photo workflows. Per the kickoff, the receiving action streams to a private Storage bucket and triggers an async virus scan."
      >
        <Field
          name="license_doc"
          label="Practising licence"
          description="Photo or PDF. ≤ 5MB. The server re-validates type + size."
          required
        >
          <FileUpload
            name="license_doc"
            accept="application/pdf,image/jpeg,image/png"
            maxMb={5}
            capture="environment"
            hint="PDF, JPG or PNG · max 5MB"
          />
        </Field>
      </Demo>

      <footer className="border-border bg-card flex flex-col gap-2 rounded-md border p-5">
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.18em] uppercase">
          Next gate
        </span>
        <p className="text-foreground/85 text-[13px] leading-snug">
          GATE C wires the patient signup flow using these primitives + the MultiStepForm shell.
          STOP at GATE B for primitives review.
        </p>
      </footer>
    </div>
  );
}

function Demo({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 border-t border-dashed border-gray-200 pt-8 first:border-t-0 first:pt-0 dark:border-gray-300/30">
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground text-[16px] font-medium tracking-tight">{title}</h2>
        <p className="text-muted-foreground max-w-[60ch] text-[12.5px] leading-snug">
          {description}
        </p>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}
