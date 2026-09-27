"use client";

import type { AcceptConsentState } from "../actions";
import { useActionState } from "react";

import { ConsentCheckbox } from "@/components/forms/consent-checkbox";
import { Button } from "@/components/ui/button";
import { acceptDataProcessingConsentAction } from "../actions";

/**
 * The re-acceptance form (Gate H, ADR 0094). The text is open, not behind a
 * `<details>` as on signup: this page exists for it to be read. The same
 * `ConsentCheckbox` carries the version + hash the action cross-checks, so
 * a page left open across a new version is refused rather than misfiled.
 */
export function AcceptConsentForm({
  version,
  bodySha256,
  effectiveDate,
  body,
}: {
  version: string;
  bodySha256: string;
  effectiveDate: string;
  body: string;
}) {
  const [state, formAction, pending] = useActionState<AcceptConsentState, FormData>(
    acceptDataProcessingConsentAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <section className="bg-card dark:shadow-card flex flex-col gap-3 rounded-xl p-5 shadow-xs">
        <h2 className="text-heading-s">
          Data-processing notice · {version}, effective {effectiveDate}
        </h2>
        <p className="text-muted-foreground text-body-s leading-relaxed whitespace-pre-line">
          {body}
        </p>
      </section>

      <ConsentCheckbox
        name="data_processing_consent"
        required
        // Red only when the box itself is the problem; a save that did not
        // land is not the patient's error and the amber line below says so.
        invalid={state.field === "consent"}
        version={version}
        bodySha256={bodySha256}
        label="I agree to MedSync's data-processing notice"
        description="The exact text above is recorded against your account."
      />

      {state.error ? (
        <p role="alert" className="text-status-caution-fg text-body-s">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="min-h-11 sm:self-start">
        {pending ? "Saving…" : "Agree and continue"}
      </Button>
    </form>
  );
}
