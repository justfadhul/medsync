"use client";

import type { PatientInput } from "@/lib/onboarding/schemas";
import { TriangleAlertIcon } from "lucide-react";

import { ConsentBlock } from "@/components/onboarding/consent-block";
import {
  ChoiceField,
  EmailField,
  MemorableDateInput,
  PasswordField,
  PhoneField,
  TextField,
} from "@/components/onboarding/fields";
import { LocationField } from "@/components/onboarding/location-field";
import { FormHeader, Section, SectionedForm } from "@/components/onboarding/sectioned-form";
import { PATIENT } from "@/content/onboarding";
import { ADULT_AGE, ageOn, isoFromParts } from "@/lib/onboarding/fields";
import { patientSchema } from "@/lib/onboarding/schemas";
import { submitPatientSignup } from "../actions";

const SECTIONS = [
  {
    id: "about",
    title: PATIENT.sections.about,
    fields: ["firstName", "surname", "sex", "dobDay", "dobMonth", "dobYear", "phone"],
  },
  { id: "place", title: PATIENT.sections.place, fields: ["place", "village"] },
  { id: "signin", title: PATIENT.sections.signin, fields: ["email", "password"] },
] as const;

const SEX = Object.entries(PATIENT.sexOptions).map(([value, label]) => ({ value, label }));

/** DPPA s.8 (D13): under 18, the submit gives way to an honest message. Nothing is stored. */
function under18(v: PatientInput) {
  const iso =
    v.dobDay && v.dobMonth && v.dobYear ? isoFromParts(v.dobDay, v.dobMonth, v.dobYear) : null;
  if (!iso) return null;
  const age = ageOn(iso);
  if (age < 0 || age >= ADULT_AGE) return null;
  return (
    <div
      role="alert"
      className="text-body-m flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100"
    >
      <TriangleAlertIcon aria-hidden className="mt-1 size-4 shrink-0" strokeWidth={2} />
      <span>{PATIENT.under18}</span>
    </div>
  );
}

export function PatientSignupForm({
  notice,
  sms,
}: {
  notice: { version: string; sha: string; body: string; effective: string };
  sms: { version: string; sha: string; body: string; declined: string; receipt: string } | null;
}) {
  return (
    <SectionedForm<PatientInput>
      form="patient"
      schema={patientSchema}
      defaults={{
        consentVersion: notice.version,
        consentSha: notice.sha,
        smsVersion: sms?.version,
        smsSha: sms?.sha,
        smsConsent: false,
      }}
      sections={SECTIONS}
      submit={submitPatientSignup}
      submitLabel={PATIENT.submit}
      pendingLabel={PATIENT.pending}
      header={<FormHeader kicker={PATIENT.kicker} title={PATIENT.title} lead={PATIENT.lead} />}
      consent={
        <ConsentBlock
          version={notice.version}
          effective={notice.effective}
          body={notice.body}
          sms={sms}
        />
      }
      after={PATIENT.after}
      blocker={under18}
    >
      <Section id="about">
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            name="firstName"
            label={PATIENT.firstName}
            autoComplete="given-name"
            autoCapitalize="words"
          />
          <TextField
            name="surname"
            label={PATIENT.surname}
            autoComplete="family-name"
            autoCapitalize="words"
          />
        </div>
        <ChoiceField name="sex" label={PATIENT.sex} options={SEX} />
        <MemorableDateInput prefix="dob" label={PATIENT.dob} hint={PATIENT.dobHint} />
        <PhoneField name="phone" label={PATIENT.phone} hint={PATIENT.phoneHint} />
      </Section>
      <Section id="place">
        <LocationField village="village" />
      </Section>
      <Section id="signin">
        <EmailField name="email" label={PATIENT.email} hint={PATIENT.emailHint} />
        <PasswordField name="password" label={PATIENT.password} hint={PATIENT.passwordHint} />
      </Section>
    </SectionedForm>
  );
}
