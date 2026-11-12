"use client";

import type { DeskClaimInput } from "@/lib/onboarding/schemas";
import Link from "next/link";

import { ConsentBlock } from "@/components/onboarding/consent-block";
import { EmailField, PasswordField, PhoneField, TextField } from "@/components/onboarding/fields";
import { FormHeader, Section, SectionedForm } from "@/components/onboarding/sectioned-form";
import { PATIENT_CLAIM } from "@/content/desk-register";
import { PATIENT } from "@/content/onboarding";
import { deskClaimSchema } from "@/lib/onboarding/schemas";
import { submitDeskClaim } from "../actions";

const SECTIONS = [
  { id: "record", title: PATIENT_CLAIM.sections.record, fields: ["phone", "claimCode"] },
  { id: "signin", title: PATIENT_CLAIM.sections.signin, fields: ["email", "password"] },
] as const;

export function DeskClaimForm({
  notice,
}: {
  notice: { version: string; sha: string; body: string; effective: string };
}) {
  return (
    <SectionedForm<DeskClaimInput>
      form="patient"
      draft="patient-claim"
      secret={["claimCode"]}
      schema={deskClaimSchema}
      defaults={{ consentVersion: notice.version, consentSha: notice.sha }}
      sections={SECTIONS}
      submit={submitDeskClaim}
      submitLabel={PATIENT_CLAIM.submit}
      pendingLabel={PATIENT_CLAIM.pending}
      header={
        <FormHeader
          kicker={PATIENT_CLAIM.kicker}
          title={PATIENT_CLAIM.title}
          lead={PATIENT_CLAIM.lead}
        >
          <Link
            href="/signup/patient"
            className="text-body-s self-start font-medium text-teal-700 underline underline-offset-4 dark:text-teal-400"
          >
            {PATIENT_CLAIM.noCodeLink}
          </Link>
        </FormHeader>
      }
      consent={
        <ConsentBlock version={notice.version} effective={notice.effective} body={notice.body} />
      }
      after={PATIENT_CLAIM.after}
    >
      <Section id="record">
        <PhoneField name="phone" label={PATIENT_CLAIM.phone} hint={PATIENT_CLAIM.phoneHint} />
        <TextField
          name="claimCode"
          label={PATIENT_CLAIM.code}
          hint={PATIENT_CLAIM.codeHint}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          maxLength={9}
          mono
        />
      </Section>
      <Section id="signin">
        <EmailField name="email" label={PATIENT.email} hint={PATIENT.emailHint} />
        <PasswordField name="password" label={PATIENT.password} hint={PATIENT.passwordHint} />
      </Section>
    </SectionedForm>
  );
}
