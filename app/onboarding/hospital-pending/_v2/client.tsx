"use client";

import type { AgreementState } from "./actions";
import type { DocumentKind } from "@/lib/onboarding/documents";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState } from "react";
import { TriangleAlertIcon } from "lucide-react";

import { APPLICANT_ROLE_CHOICES } from "@/app/signup/hospital/_lib/catalog";
import { DocumentUploadNow } from "@/components/onboarding/document-upload";
import { inputClass } from "@/components/onboarding/styles";
import { Button } from "@/components/ui/button";
import { PENDING } from "@/content/onboarding";
import { HOSPITAL_PENDING } from "@/content/onboarding-hospital";
import { signAgreementAction } from "./actions";

/** A "Still needed" document: pick it and it uploads now; the page then re-reads what's owed. */
export function UploadNow({ kind }: { kind: DocumentKind }) {
  const router = useRouter();
  return <DocumentUploadNow kind={kind} onDone={() => router.refresh()} />;
}

function Problem({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p
      id={id}
      role="alert"
      className="text-body-s flex items-start gap-1.5 text-amber-800 dark:text-amber-300"
    >
      <TriangleAlertIcon aria-hidden className="mt-[3px] size-3.5 shrink-0" strokeWidth={2} />
      <span>{children}</span>
    </p>
  );
}

const P = PENDING.hospital;

/**
 * The agreement gate (§5.10): the full DPA text, its version and hash, the placeholder banner,
 * the signatory, and the two boxes. Submitted without a form reset, so a correction keeps what
 * was typed; the server validates everything.
 */
export function AgreementGate({
  dpa,
}: {
  dpa: { id: string; version: string; sha: string; body: string; placeholder: boolean };
}) {
  const [state, dispatch, pending] = useActionState<AgreementState, FormData>(
    signAgreementAction,
    {},
  );
  const err = (k: string) => state.fieldErrors?.[k];
  const a11y = (k: string) => ({
    "aria-invalid": err(k) ? true : undefined,
    "aria-describedby": err(k) ? `ag-${k}-error` : undefined,
  });
  return (
    <section
      aria-labelledby="agreement-title"
      className="border-border bg-card shadow-card flex flex-col gap-5 rounded-lg border p-5 sm:p-6"
    >
      <h2 id="agreement-title" className="text-heading-s text-foreground font-medium">
        {P.agreementTitle}
      </h2>
      <p className="text-body-m text-muted-foreground text-pretty">{P.agreementLead}</p>
      {dpa.placeholder ? (
        <p className="text-body-s flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
          <TriangleAlertIcon aria-hidden className="mt-[3px] size-3.5 shrink-0" strokeWidth={2} />
          <span>{HOSPITAL_PENDING.placeholder}</span>
        </p>
      ) : null}
      <article
        tabIndex={0}
        aria-labelledby="agreement-title"
        className="border-border text-body-s text-foreground max-h-[40svh] overflow-y-auto rounded-md border p-4 whitespace-pre-wrap"
      >
        {dpa.body}
      </article>
      <p className="text-muted-foreground font-mono text-[11px] tabular-nums">
        {HOSPITAL_PENDING.version(dpa.version, dpa.sha.slice(0, 12))}
      </p>
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          const data = new FormData(e.currentTarget);
          startTransition(() => dispatch(data));
        }}
      >
        <input type="hidden" name="dpaId" value={dpa.id} />
        <input type="hidden" name="dpaSha" value={dpa.sha} />
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="ag-signatoryName" className="text-body-s text-foreground font-medium">
              {P.signatoryName}
            </label>
            <input
              id="ag-signatoryName"
              name="signatoryName"
              autoComplete="name"
              autoCapitalize="words"
              maxLength={120}
              className={inputClass}
              {...a11y("signatoryName")}
            />
            <Problem id="ag-signatoryName-error">{err("signatoryName")}</Problem>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="ag-signatoryTitle" className="text-body-s text-foreground font-medium">
              {P.signatoryTitle}
            </label>
            <select
              id="ag-signatoryTitle"
              name="signatoryTitle"
              defaultValue=""
              className={`${inputClass} pr-8`}
              {...a11y("signatoryTitle")}
            >
              <option value="" disabled>
                {HOSPITAL_PENDING.titlePlaceholder}
              </option>
              {APPLICANT_ROLE_CHOICES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
            <Problem id="ag-signatoryTitle-error">{err("signatoryTitle")}</Problem>
          </div>
        </div>
        {(["bind", "accept"] as const).map((k) => (
          <div key={k} className="flex flex-col gap-1.5">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                name={k}
                type="checkbox"
                className="mt-0.5 size-5 shrink-0 accent-teal-700"
                {...a11y(k)}
              />
              <span className="text-body-m text-foreground">{P[k]}</span>
            </label>
            <Problem id={`ag-${k}-error`}>{err(k)}</Problem>
          </div>
        ))}
        <Problem id="ag-form-error">{state.formError}</Problem>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          aria-busy={pending}
          className="tap w-full sm:w-auto sm:self-start"
        >
          {pending ? P.signing : P.sign}
        </Button>
      </form>
    </section>
  );
}
