"use client";

import type { HospitalInput } from "@/lib/onboarding/schemas";

import { ConsentBlock } from "@/components/onboarding/consent-block";
import { DocumentField } from "@/components/onboarding/document-field";
import {
  ChoiceField,
  EmailField,
  PasswordField,
  PhoneField,
  revealClass,
  SelectField,
  TextField,
  useFieldValue,
} from "@/components/onboarding/fields";
import { LeadDialog } from "@/components/onboarding/lead-dialog";
import { FormHeader, Section, SectionedForm } from "@/components/onboarding/sectioned-form";
import { HOSPITAL, STAFF_COMMON } from "@/content/onboarding";
import { LICENSER_LABELS } from "@/content/onboarding-hospital";
import { hospitalSchema } from "@/lib/onboarding/schemas";
import { cn } from "@/lib/utils";
import { APPLICANT_ROLE_CHOICES } from "../_lib/catalog";
import { proofFor } from "../_lib/proof";
import { submitHospitalApplication } from "../actions";
import { FacilityFields } from "./facility";

const SECTIONS = [
  {
    id: "facility",
    title: HOSPITAL.sections.facility,
    fields: [
      "facilitySource",
      "registryCode",
      "ownership",
      "correctionNote",
      "facilityName",
      "facilityLevel",
      "bureau",
      "place",
    ],
  },
  {
    id: "applicant",
    title: HOSPITAL.sections.applicant,
    fields: ["applicantName", "applicantRole", "email", "phone", "password"],
  },
  {
    id: "proof",
    title: HOSPITAL.sections.proof,
    fields: [
      "licensingBody",
      "licenceNumber",
      "registryOrHmisCode",
      "licence",
      "officerName",
      "officerTitle",
      "officerPhone",
      "officerEmail",
      "letter",
    ],
  },
] as const;

const ROLES = APPLICANT_ROLE_CHOICES.map((c) => ({ value: c.code, label: c.label }));
const LICENSERS = Object.entries(LICENSER_LABELS).map(([value, label]) => ({ value, label }));

export function HospitalApplicationForm({
  notice,
  bureaus,
}: {
  notice: { version: string; sha: string; body: string; effective: string };
  bureaus: readonly string[];
}) {
  return (
    <SectionedForm<HospitalInput>
      form="hospital"
      schema={hospitalSchema}
      defaults={{
        facilitySource: "registry",
        consentVersion: notice.version,
        consentSha: notice.sha,
      }}
      sections={SECTIONS}
      submit={submitHospitalApplication}
      submitLabel={HOSPITAL.submit}
      pendingLabel={HOSPITAL.pending}
      header={
        <FormHeader kicker={HOSPITAL.kicker} title={HOSPITAL.title} lead={HOSPITAL.lead}>
          <LeadDialog source="hospital_door" trigger={HOSPITAL.askCall} />
        </FormHeader>
      }
      consent={
        <ConsentBlock version={notice.version} effective={notice.effective} body={notice.body} />
      }
      after={HOSPITAL.after}
    >
      <Section id="facility">
        <FacilityFields bureaus={bureaus} />
      </Section>
      <Section id="applicant">
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            name="applicantName"
            label={HOSPITAL.applicantName}
            autoComplete="name"
            autoCapitalize="words"
          />
          <SelectField name="applicantRole" label={HOSPITAL.applicantRole} options={ROLES} />
        </div>
        <EmailField name="email" label={HOSPITAL.workEmail} hint={HOSPITAL.workEmailHint} />
        <PhoneField name="phone" label={HOSPITAL.phone} />
        <PasswordField
          name="password"
          label={STAFF_COMMON.password}
          hint={STAFF_COMMON.passwordHint}
        />
      </Section>
      <Section id="proof">
        <ProofFields />
      </Section>
    </SectionedForm>
  );
}

/** [03] Proof by ownership (§5.7), then who authorised the applicant — never the applicant. */
function ProofFields() {
  const proof = proofFor(useFieldValue<string | undefined>("ownership"));
  const manual = useFieldValue<string | undefined>("facilitySource") === "manual";
  return (
    <>
      {proof === "registry" ? (
        <div className={cn("flex flex-col gap-5", revealClass)}>
          <p className="text-body-m text-foreground">{HOSPITAL.govProof}</p>
          {manual ? (
            <TextField
              name="registryOrHmisCode"
              label={HOSPITAL.govManualCode}
              optional
              mono
              maxLength={60}
            />
          ) : null}
        </div>
      ) : proof ? (
        <div className={cn("flex flex-col gap-5", revealClass)}>
          {proof === "licence" ? (
            <ChoiceField name="licensingBody" label={HOSPITAL.licensingBody} options={LICENSERS} />
          ) : null}
          <TextField
            name="licenceNumber"
            label={proof === "bureau" ? HOSPITAL.bureauLicenceNumber : HOSPITAL.licenceNumber}
            mono
            maxLength={120}
          />
          <DocumentField
            name="licence"
            kind="facility_licence"
            label={HOSPITAL.licence}
            laterText={HOSPITAL.licenceLater}
          />
        </div>
      ) : null}
      <div role="group" aria-labelledby="who-authorised" className="flex flex-col gap-5">
        <h3 id="who-authorised" className="text-body-m text-foreground font-medium">
          {HOSPITAL.whoAuthorised}
        </h3>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField name="officerName" label={HOSPITAL.officerName} autoCapitalize="words" />
          <SelectField name="officerTitle" label={HOSPITAL.officerTitle} options={ROLES} />
          <PhoneField name="officerPhone" label={HOSPITAL.officerPhone} optional />
          <EmailField name="officerEmail" label={HOSPITAL.officerEmail} optional />
        </div>
        <p className="text-body-s text-muted-foreground -mt-2">{HOSPITAL.officerHint}</p>
        <DocumentField
          name="letter"
          kind="authority_letter"
          label={HOSPITAL.letter}
          laterText={HOSPITAL.letterLater}
        />
      </div>
    </>
  );
}
