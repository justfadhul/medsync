"use client";

import type { HospitalOption } from "../../_components/staff-work";
import type { NonClinicalInput } from "@/lib/onboarding/schemas";
import Link from "next/link";
import { useFormContext } from "react-hook-form";

import { ConsentBlock } from "@/components/onboarding/consent-block";
import { DocumentField } from "@/components/onboarding/document-field";
import {
  EmailField,
  fieldId,
  PasswordField,
  PhoneField,
  TextField,
  useFieldValue,
} from "@/components/onboarding/fields";
import { FormHeader, Section, SectionedForm } from "@/components/onboarding/sectioned-form";
import { KIT, NON_CLINICAL, STAFF_COMMON } from "@/content/onboarding";
import { STAFF } from "@/content/onboarding-staff";
import { ninWarning } from "@/lib/onboarding/fields";
import { RECEPTION } from "@/lib/onboarding/profession";
import { nonClinicalSchema } from "@/lib/onboarding/schemas";
import { WorkFields } from "../../_components/staff-work";
import { submitNonClinicalV2 } from "./actions";

const SECTIONS = [
  {
    id: "you",
    title: NON_CLINICAL.sections.you,
    fields: ["fullName", "email", "phone", "password"],
  },
  {
    id: "identity",
    title: NON_CLINICAL.sections.identity,
    fields: ["nin", "staffNumber", "officerName", "officerRole", "letter"],
  },
  {
    id: "work",
    title: NON_CLINICAL.sections.work,
    fields: ["hospitalId", "departmentId", "employmentType"],
  },
] as const;

/** Never in the draft: the NIN (§5.1) and files (a restored "file" would have no file behind it). */
const SECRET = ["nin", "letter"] as const;

export function NonClinicalFormV2({
  notice,
  hospitals,
}: {
  notice: { version: string; sha: string; body: string; effective: string };
  hospitals: readonly HospitalOption[];
}) {
  return (
    <SectionedForm<NonClinicalInput>
      form="non_clinical"
      schema={nonClinicalSchema}
      defaults={{
        consentVersion: notice.version,
        consentSha: notice.sha,
        employmentType: "full_time",
      }}
      sections={SECTIONS}
      secret={SECRET}
      submit={submitNonClinicalV2}
      submitLabel={NON_CLINICAL.submit}
      pendingLabel={NON_CLINICAL.pending}
      header={
        <FormHeader
          kicker={NON_CLINICAL.kicker}
          title={NON_CLINICAL.title}
          lead={NON_CLINICAL.lead}
        >
          <Link
            href="/signup/clinical"
            className="text-body-s self-start font-medium text-teal-700 underline underline-offset-4 dark:text-teal-400"
          >
            {NON_CLINICAL.clinicalLink}
          </Link>
        </FormHeader>
      }
      consent={
        <ConsentBlock version={notice.version} effective={notice.effective} body={notice.body} />
      }
      after={NON_CLINICAL.after}
    >
      <Section id="you">
        <TextField
          name="fullName"
          label={STAFF_COMMON.fullName}
          autoComplete="name"
          autoCapitalize="words"
        />
        <EmailField name="email" label={STAFF_COMMON.workEmail} hint={STAFF_COMMON.workEmailHint} />
        <PhoneField name="phone" label={STAFF_COMMON.phone} />
        <PasswordField
          name="password"
          label={STAFF_COMMON.password}
          hint={STAFF_COMMON.passwordHint}
        />
      </Section>
      <Section id="identity">
        <div className="flex flex-col gap-1.5">
          <TextField
            name="nin"
            label={NON_CLINICAL.nin}
            hint={NON_CLINICAL.ninHint}
            mono
            autoCapitalize="characters"
            maxLength={20}
          />
          <NinNote />
        </div>
        <details className="group flex flex-col">
          <summary className="text-body-s cursor-pointer font-medium text-teal-700 underline underline-offset-4 dark:text-teal-400">
            {NON_CLINICAL.speedUp}
          </summary>
          <div className="mt-4 flex flex-col gap-5">
            <TextField
              name="staffNumber"
              label={NON_CLINICAL.staffNumber}
              optional
              maxLength={60}
            />
            <TextField
              name="officerName"
              label={NON_CLINICAL.officerName}
              optional
              autoCapitalize="words"
            />
            <TextField
              name="officerRole"
              label={NON_CLINICAL.officerRole}
              hint={NON_CLINICAL.officerRoleHint}
              optional
            />
            <DocumentField
              name="letter"
              kind="appointment_letter"
              label={`${NON_CLINICAL.letter} ${KIT.optional}`}
              laterText={STAFF.letterLater}
            />
          </div>
        </details>
      </Section>
      <Section id="work">
        <WorkFields hospitals={hospitals} departmentLabel={NON_CLINICAL.department}>
          <p className="text-body-m text-foreground">{NON_CLINICAL.joiningAs(RECEPTION.label)}</p>
        </WorkFields>
      </Section>
    </SectionedForm>
  );
}

/** The soft NIN check (§5.12): a note after they leave the field, never an error, never a block. */
function NinNote() {
  const nin = useFieldValue("nin") ?? "";
  const { formState } = useFormContext();
  // A soft check: quiet, and silent while the hard rule is already showing its error.
  const note = formState.touchedFields.nin && !formState.errors.nin ? ninWarning(nin) : null;
  return note ? (
    <p
      id={`${fieldId("nin")}-note`}
      aria-live="polite"
      className="text-body-s text-muted-foreground"
    >
      {note}
    </p>
  ) : null;
}
