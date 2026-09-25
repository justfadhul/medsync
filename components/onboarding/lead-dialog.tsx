"use client";

import type { LeadInput } from "@/lib/onboarding/schemas";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";

import { submitHospitalLead } from "@/app/signup/hospital/actions";
import { Button } from "@/components/ui/button";
import { LEAD } from "@/content/onboarding";
import { leadSchema } from "@/lib/onboarding/schemas";
import { EmailField, PhoneField, TextField } from "./fields";
import { LocationField } from "./location-field";

/**
 * The short lead (D15): "Ask us to call you" (hospital door) and "My hospital isn't on MedSync"
 * (clinical form). A native <dialog>, portalled to <body> so it never nests inside the page's form.
 * Creates no account; saves a hospital_leads row through submitHospitalLead.
 */
export function LeadDialog({ source, trigger }: { source: LeadInput["source"]; trigger: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const methods = useForm<LeadInput>({
    resolver: zodResolver(leadSchema as never) as never,
    mode: "onTouched",
    defaultValues: { source },
  });
  const hospitalDoor = source === "hospital_door";
  // The portal target exists only in the browser; render it after hydration, never on the server.
  const inBrowser = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  // /get-started's "Ask us to call you" lands on /signup/hospital#call with the dialog open.
  useEffect(() => {
    if (inBrowser && hospitalDoor && window.location.hash === "#call") ref.current?.showModal();
  }, [inBrowser, hospitalDoor]);

  const onSubmit = methods.handleSubmit(async (v) => {
    setBusy(true);
    setFormError(null);
    try {
      const r = await submitHospitalLead(v);
      if (r.ok) setSent(true);
      else {
        for (const [k, m] of Object.entries(r.fieldErrors ?? {}))
          methods.setError(k as keyof LeadInput, { type: "server", message: m });
        setFormError(r.formError ?? null);
      }
    } catch {
      setFormError(LEAD.retry);
    } finally {
      setBusy(false);
    }
  });

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="text-body-s self-start font-medium text-teal-700 underline underline-offset-4 dark:text-teal-400"
      >
        {trigger}
      </button>
      {inBrowser
        ? createPortal(
            <dialog
              ref={ref}
              aria-labelledby={`lead-${source}-title`}
              className="bg-background text-foreground shadow-popover m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl p-0 backdrop:bg-black/40"
              onClose={() => setSent(false)}
            >
              <FormProvider {...methods}>
                <form
                  noValidate
                  onSubmit={(e) => void onSubmit(e)}
                  className="flex flex-col gap-5 p-5 sm:p-6"
                >
                  <h2
                    id={`lead-${source}-title`}
                    className="font-display text-heading-l text-foreground"
                  >
                    {hospitalDoor ? LEAD.title : LEAD.hospitalTitle}
                  </h2>
                  {sent ? (
                    <p role="status" className="text-body-m">
                      {LEAD.sent}
                    </p>
                  ) : (
                    <>
                      <p className="text-body-m text-muted-foreground">
                        {hospitalDoor ? LEAD.lead : LEAD.clinicalLead}
                      </p>
                      <TextField
                        name="hospitalName"
                        label={LEAD.hospitalName}
                        autoCapitalize="words"
                      />
                      <LocationField name="leadPlace" label={LEAD.district} districtOnly />
                      <TextField
                        name="contactName"
                        label={LEAD.contactName}
                        optional={!hospitalDoor}
                        autoComplete="name"
                        autoCapitalize="words"
                      />
                      <PhoneField
                        name="contactPhone"
                        label={LEAD.contactPhone}
                        optional={!hospitalDoor}
                      />
                      <EmailField name="contactEmail" label={LEAD.contactEmail} optional />
                      {formError ? (
                        <p role="alert" className="text-body-s text-amber-800 dark:text-amber-300">
                          {formError}
                        </p>
                      ) : null}
                    </>
                  )}
                  <div className="flex flex-wrap gap-3">
                    {!sent ? (
                      <Button type="submit" variant="primary" size="lg" aria-busy={busy}>
                        {LEAD.send}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="secondary"
                      size="lg"
                      onClick={() => ref.current?.close()}
                    >
                      {LEAD.close}
                    </Button>
                  </div>
                </form>
              </FormProvider>
            </dialog>,
            document.body,
          )
        : null}
    </>
  );
}
