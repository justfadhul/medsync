"use client";

import type { HospitalOption } from "../../_components/staff-work";
import type { Choice } from "@/components/onboarding/fields";
import type { ClinicalInput } from "@/lib/onboarding/schemas";

import { ConsentBlock } from "@/components/onboarding/consent-block";
import { DocumentField } from "@/components/onboarding/document-field";
import {
  EmailField,
  PasswordField,
  PhoneField,
  revealClass,
  SelectField,
  TextField,
  useFieldValue,
} from "@/components/onboarding/fields";
import { LeadDialog } from "@/components/onboarding/lead-dialog";
import { ProfessionField } from "@/components/onboarding/profession-field";
import { FormHeader, Section, SectionedForm } from "@/components/onboarding/sectioned-form";
import { CLINICAL, STAFF_COMMON } from "@/content/onboarding";
import { STAFF } from "@/content/onboarding-staff";
import { professionById, registrationLabel } from "@/lib/onboarding/profession";
import { clinicalSchema } from "@/lib/onboarding/schemas";
import { WorkFields } from "../../_components/staff-work";
import { submitClinicalV2 } from "./actions";

const SECTIONS = [
  { id: "you", title: CLINICAL.sections.you, fields: ["fullName", "email", "phone", "password"] },
  {
    id: "practice",
    title: CLINICAL.sections.practice,
    fields: ["profession", "specialty", "registrationNumber", "licence"],
  },
  {
    id: "work",
    title: CLINICAL.sections.work,
    fields: ["hospitalId", "departmentId", "employmentType"],
  },
] as const;

/** Files never go in the draft: a restored "file" would have no file behind it. */
const SECRET = ["licence"] as const;

export function ClinicalFormV2({
  notice,
  hospitals,
  specialties,
}: {
  notice: { version: string; sha: string; body: string; effective: string };
  hospitals: readonly HospitalOption[];
  specialties: readonly Choice[];
}) {
  return (
    <SectionedForm<ClinicalInput>
      form="clinical"
      schema={clinicalSchema}
      defaults={{
        consentVersion: notice.version,
        consentSha: notice.sha,
        employmentType: "full_time",
      }}
      sections={SECTIONS}
      secret={SECRET}
      submit={submitClinicalV2}
      submitLabel={CLINICAL.submit}
      pendingLabel={CLINICAL.pending}
      header={<FormHeader kicker={CLINICAL.kicker} title={CLINICAL.title} lead={CLINICAL.lead} />}
      consent={
        <ConsentBlock version={notice.version} effective={notice.effective} body={notice.body} />
      }
      after={CLINICAL.after}
    >
      <Section id="you">
        <TextField
          name="fullName"
          label={STAFF_COMMON.fullName}
          autoComplete="name"
          autoCapitalize="words"
        />
        <EmailField name="email" label={STAFF_COMMON.email} />
        <PhoneField name="phone" label={STAFF_COMMON.phone} />
        <PasswordField
          name="password"
          label={STAFF_COMMON.password}
          hint={STAFF_COMMON.passwordHint}
        />
      </Section>
      <Section id="practice">
        <PracticeFields specialties={specialties} />
      </Section>
      <Section id="work">
        <WorkFields
          hospitals={hospitals}
          departmentLabel={STAFF_COMMON.department}
          afterHospital={<LeadDialog source="clinical_signup" trigger={CLINICAL.notOnMedSync} />}
        />
      </Section>
    </SectionedForm>
  );
}

/** Profession first; it names the council, the registration label and whether a specialty is asked. */
function PracticeFields({ specialties }: { specialties: readonly Choice[] }) {
  const profession = professionById(useFieldValue("profession") ?? "");
  const specialtyOptions = [
    ...specialties,
    { value: "unlisted", label: CLINICAL.specialtyUnlisted },
  ];
  return (
    <>
      <ProfessionField />
      {profession?.needsSpecialty ? (
        <div className={revealClass}>
          <SelectField
            name="specialty"
            label={CLINICAL.specialty}
            options={specialtyOptions}
            placeholder={STAFF.specialtyPlaceholder}
          />
        </div>
      ) : null}
      <TextField
        name="registrationNumber"
        label={profession ? registrationLabel(profession) : STAFF.registrationNumber}
        hint={
          profession?.helper
            ? `${CLINICAL.registrationHint} ${profession.helper}`
            : CLINICAL.registrationHint
        }
        autoCapitalize="characters"
        maxLength={60}
      />
      <DocumentField
        name="licence"
        kind="licence"
        label={CLINICAL.licence}
        laterText={CLINICAL.licenceLater}
      />
    </>
  );
}
