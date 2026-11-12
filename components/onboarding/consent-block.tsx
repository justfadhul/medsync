"use client";

import { useFormContext } from "react-hook-form";

import { CONSENT } from "@/content/onboarding";
import { FieldError, fieldId, useFieldError } from "./fields";

/**
 * The consent block, identical on all four forms (§5.8): a layered summary that restates the
 * published notice, the full text one tap away, and the box. Version + SHA-256 ride as values the
 * page was given, so acceptance is bound to the exact text shown. Patients also get the separate,
 * unticked SMS box (ADR 0090).
 */
export function ConsentBlock({
  version,
  effective,
  body,
  sms,
  agree = CONSENT.agree,
}: {
  version: string;
  effective: string;
  body: string;
  sms?: { body: string; declined: string; receipt: string } | null;
  /** The box's words: the person's own by default; the desk records an agreement given in front of it (ADR 0475). */
  agree?: string;
}) {
  const { register } = useFormContext();
  const error = useFieldError("consent");
  const id = fieldId("consent");
  return (
    <section
      aria-labelledby="consent-title"
      className="flex flex-col gap-4 rounded-lg bg-gray-50 p-5 sm:p-6 dark:bg-gray-900"
    >
      <h2 id="consent-title" className="text-heading-s text-foreground">
        {CONSENT.title}
      </h2>
      <ul className="text-body-m text-foreground flex list-disc flex-col gap-1.5 pl-5">
        {CONSENT.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <details className="group">
        <summary className="text-body-s cursor-pointer font-medium text-teal-700 underline underline-offset-4 dark:text-teal-400">
          {CONSENT.readFull(version, effective)}
        </summary>
        <p className="text-body-s text-muted-foreground mt-3 whitespace-pre-line">{body}</p>
      </details>
      <div className="flex flex-col gap-1.5" data-field="consent">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            {...register("consent")}
            id={id}
            type="checkbox"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className="mt-0.5 size-5 shrink-0 accent-teal-700"
          />
          <span className="text-body-m text-foreground">{agree}</span>
        </label>
        <FieldError name="consent" />
      </div>
      {sms ? (
        <label className="flex cursor-pointer items-start gap-3">
          <input
            {...register("smsConsent")}
            type="checkbox"
            className="mt-0.5 size-5 shrink-0 accent-teal-700"
          />
          <span className="flex flex-col gap-1">
            <span className="text-body-m text-foreground">{CONSENT.smsLabel}</span>
            <span className="text-body-s text-muted-foreground">
              {sms.body} {sms.declined} {sms.receipt}
            </span>
          </span>
        </label>
      ) : null}
    </section>
  );
}
