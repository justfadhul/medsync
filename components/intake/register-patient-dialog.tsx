"use client";

import type { DeskRegistered, RegisterWalkInResult } from "@/app/reception/actions";
import type { DeskPatientInput } from "@/lib/onboarding/schemas";
import type { DeskMatch } from "@/supabase/functions/_shared/identity-match";
import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { TriangleAlertIcon, UserPlusIcon } from "lucide-react";
import { FormProvider, useForm, useWatch } from "react-hook-form";

import { StatusWord } from "@/components/emr/status-word";
import { EditorDialog } from "@/components/medsync/editor-dialog";
import { ConsentBlock } from "@/components/onboarding/consent-block";
import {
  ChoiceField,
  MemorableDateInput,
  PhoneField,
  TextField,
} from "@/components/onboarding/fields";
import { LocationField } from "@/components/onboarding/location-field";
import { Button } from "@/components/ui/button";
import { DialogTrigger } from "@/components/ui/dialog";
import { Pill } from "@/components/ui/pill";
import {
  SheetBody,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { DESK_REGISTER } from "@/content/desk-register";
import { PATIENT } from "@/content/onboarding";
import { ADULT_AGE, ageOn, isoFromParts } from "@/lib/onboarding/fields";
import { deskPatientSchema } from "@/lib/onboarding/schemas";

export interface DeskNotice {
  version: string;
  sha: string;
  body: string;
  effective: string;
}

const SEX = Object.entries(PATIENT.sexOptions).map(([value, label]) => ({ value, label }));
const TARGET = "min-h-11";

/**
 * "Register a new patient" (ADR 0475): sign-up's questions and rules for a walk-in with no account, asked by the
 * desk in one centred dialog (ADR 0161). The server checks this hospital's patients first; a likely match is shown
 * instead of a new record, and the desk either uses it or says it is someone else. `onDone` gets the patient either
 * way — the new record or the one the desk chose.
 */
export function RegisterPatientDialog({
  notice,
  action,
  onDone,
  variant = "secondary",
}: {
  notice: DeskNotice;
  action: (input: DeskPatientInput, despite: string[]) => Promise<RegisterWalkInResult>;
  onDone: (patient: DeskRegistered) => void;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const [matches, setMatches] = useState<DeskMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const methods = useForm<DeskPatientInput>({
    // zodResolver's generics trip over superRefine'd schemas; the schema is the form's own type.
    resolver: zodResolver(deskPatientSchema as never) as never,
    mode: "onTouched",
    defaultValues: { consentVersion: notice.version, consentSha: notice.sha },
  });
  const dob = useWatch({ control: methods.control, name: ["dobDay", "dobMonth", "dobYear"] });
  const iso = dob[0] && dob[1] && dob[2] ? isoFromParts(dob[0], dob[1], dob[2]) : null;
  const child = iso !== null && ageOn(iso) >= 0 && ageOn(iso) < ADULT_AGE;

  const finish = (patient: DeskRegistered) => {
    setOpen(false);
    setMatches(null);
    methods.reset({ consentVersion: notice.version, consentSha: notice.sha });
    onDone(patient);
  };

  const send = (despite: string[]) =>
    methods.handleSubmit((values) =>
      start(async () => {
        setError(null);
        const r = await action(values, despite);
        if (r.outcome === "registered") return finish(r.patient);
        if (r.outcome === "matches") return setMatches(r.matches);
        for (const [name, message] of Object.entries(r.fieldErrors ?? {}))
          methods.setError(name as keyof DeskPatientInput, { message });
        setMatches(null);
        setError(r.error ?? null);
      }),
    )();

  return (
    <EditorDialog
      width="wide"
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
      trigger={
        <DialogTrigger render={<Button type="button" variant={variant} className={TARGET} />}>
          <UserPlusIcon className="size-4" aria-hidden />
          {DESK_REGISTER.open}
        </DialogTrigger>
      }
    >
      <FormProvider {...methods}>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            // The dialog is portalled, but React bubbles its events to the React parent: inside the front door's
            // own <form>, this submit would otherwise register an intake too.
            e.stopPropagation();
            send([]);
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className="flex min-h-0 flex-1 flex-col"
        >
          <SheetHeader>
            <SheetTitle>
              {matches ? DESK_REGISTER.matchesTitle(matches.length) : DESK_REGISTER.title}
            </SheetTitle>
            <SheetDescription>
              {matches ? DESK_REGISTER.matchesLead : DESK_REGISTER.lead}
            </SheetDescription>
          </SheetHeader>

          <SheetBody className="flex flex-col gap-5">
            {matches ? (
              <ul className="flex flex-col gap-2">
                {matches.map((m) => (
                  <li
                    key={m.patientUserId}
                    className="border-border flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="text-foreground text-body-s font-medium">
                        {m.displayName}
                      </span>
                      <span className="text-muted-foreground text-caption font-mono tabular-nums">
                        {m.patientCode} · born {m.dateOfBirth}
                      </span>
                      {/* The basis, as words. Never a score. */}
                      <span className="flex flex-wrap gap-1">
                        {m.basis.map((b) => (
                          <Pill key={b} tone="neutral">
                            {b}
                          </Pill>
                        ))}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      className={TARGET}
                      onClick={() => finish(m)}
                      aria-label={`${DESK_REGISTER.useThis}: ${m.displayName}, ${m.patientCode}`}
                    >
                      {DESK_REGISTER.useThis}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">
                <fieldset className="flex min-w-0 flex-col gap-4">
                  <legend className="text-heading-s text-foreground mb-3">
                    {DESK_REGISTER.sections.about}
                  </legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField name="firstName" label={PATIENT.firstName} autoCapitalize="words" />
                    <TextField name="surname" label={PATIENT.surname} autoCapitalize="words" />
                  </div>
                  <ChoiceField name="sex" label={PATIENT.sex} options={SEX} />
                  <MemorableDateInput prefix="dob" label={PATIENT.dob} hint={PATIENT.dobHint} />
                  <PhoneField name="phone" label={PATIENT.phone} hint={DESK_REGISTER.phoneHint} />
                </fieldset>
                <div className="flex min-w-0 flex-col gap-5">
                  <fieldset className="flex min-w-0 flex-col gap-4">
                    <legend className="text-heading-s text-foreground mb-3">
                      {DESK_REGISTER.sections.place}
                    </legend>
                    <LocationField village="village" noLocate />
                  </fieldset>
                  <ConsentBlock
                    version={notice.version}
                    effective={notice.effective}
                    body={notice.body}
                    agree={DESK_REGISTER.consentAgree}
                  />
                </div>
              </div>
            )}
            {child || error ? (
              <p role="alert">
                <StatusWord tone="caution" glyph={TriangleAlertIcon}>
                  {child ? DESK_REGISTER.under18 : error}
                </StatusWord>
              </p>
            ) : null}
          </SheetBody>

          <SheetFooter>
            {matches ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  className={TARGET}
                  onClick={() => setMatches(null)}
                >
                  {DESK_REGISTER.back}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className={TARGET}
                  disabled={pending}
                  onClick={() => send(matches.map((m) => m.patientCode))}
                >
                  {pending ? DESK_REGISTER.pending : DESK_REGISTER.someoneElse}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  className={TARGET}
                  onClick={() => setOpen(false)}
                >
                  {DESK_REGISTER.cancel}
                </Button>
                {/* Under 18 the action gives way to the reason (above), as sign-up does. */}
                {child ? null : (
                  <Button type="submit" className={TARGET} disabled={pending}>
                    {pending ? DESK_REGISTER.pending : DESK_REGISTER.submit}
                  </Button>
                )}
              </>
            )}
          </SheetFooter>
        </form>
      </FormProvider>
    </EditorDialog>
  );
}
