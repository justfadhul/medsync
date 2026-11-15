"use client";

import type { AuthLook } from "../../sign-in/form";
import type { Enrollment, MfaSetupState } from "./actions";
import { useActionState, useEffect, useRef, useState } from "react";
import { TriangleAlertIcon } from "lucide-react";

import { PlainInput, TETHER_INPUT, TETHER_LABEL } from "@/components/landing/tether/auth";
import { AuthCard } from "@/components/medsync/auth-card";
import { buttonClass } from "@/components/tide/kit";
import { Button } from "@/components/ui/button";
import { Input as ChromaInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MFA_SETUP } from "@/content/auth";
import { cn } from "@/lib/utils";
import {
  AUTH_INPUT,
  AUTH_LABEL,
  AuthNotice,
  ButtonSpinner,
  FieldNote,
} from "../../_components/auth-notice";
import { startEnrollmentAction, verifyEnrollmentAction } from "./actions";

interface MfaSetupFormProps {
  factorId: string;
  secret: string;
  qrSvg: string;
  look?: AuthLook;
  /** The sign-in page's own (ADR 0512): no card, and the redirect the password step was given. */
  inline?: { redirect: string };
}

const initial: MfaSetupState = {};

export function EnrollmentFailed({ message }: { message: string }) {
  return (
    <div className="bg-card border-border scale-in rounded-lg border p-6">
      <p className="text-body-s flex items-start gap-2 text-amber-900 dark:text-amber-200">
        <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
        <span>
          {MFA_SETUP.failed} {message}
        </span>
      </p>
    </div>
  );
}

export function MfaSetupForm({
  factorId,
  secret,
  qrSvg,
  look = "medsync",
  inline,
}: MfaSetupFormProps) {
  const tether = look === "tether";
  const Input = tether ? PlainInput : ChromaInput;
  const [state, formAction, pending] = useActionState(verifyEnrollmentAction, initial);

  const body = (
    <div className="stagger-children flex flex-col gap-4">
      {inline ? (
        <p className={cn("text-body-s", tether ? "text-pw-ink-2" : "text-muted-foreground")}>
          {MFA_SETUP.helper}
        </p>
      ) : null}
      {/* White panel regardless of theme: the QR needs dark-on-light contrast for cameras to lock on. */}
      <div
        className={cn(
          "scale-in flex items-center justify-center border border-gray-200 bg-white p-4 dark:border-gray-300",
          tether ? "rounded-3xl" : "rounded-md",
        )}
      >
        <div dangerouslySetInnerHTML={{ __html: qrSvg }} />
      </div>

      <details
        className={cn("text-body-s group", tether ? "text-pw-ink-2" : "text-muted-foreground")}
      >
        <summary
          className={cn(
            "cursor-pointer transition-colors duration-150",
            tether ? "hover:text-pw-ink" : "hover:text-foreground",
          )}
        >
          {MFA_SETUP.cantScan}
        </summary>
        <p className="text-body-s mt-2">{MFA_SETUP.secretLead}</p>
        <code className="bg-muted text-foreground scale-in text-caption mt-2 block rounded-sm border border-gray-200 p-2 font-mono break-all">
          {secret}
        </code>
      </details>

      <form action={formAction} className="flex flex-col gap-3">
        <AuthNotice message={state.errors?._form} />
        <input type="hidden" name="factor_id" value={factorId} />
        <input type="hidden" name="redirect" value={inline?.redirect ?? ""} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setup-code" className={tether ? TETHER_LABEL : AUTH_LABEL}>
            {MFA_SETUP.label}
          </Label>
          <Input
            id="setup-code"
            name="code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            // Room for a pasted "123 456"; anything but digits is dropped as it lands.
            maxLength={7}
            onInput={(e) => {
              e.currentTarget.value = e.currentTarget.value.replace(/\D/g, "");
            }}
            autoComplete="one-time-code"
            required
            aria-invalid={!!state.errors?.code}
            aria-describedby={state.errors?.code ? "setup-code-error" : undefined}
            className={cn(
              tether ? TETHER_INPUT : AUTH_INPUT,
              "font-mono tracking-[0.3em] tabular-nums",
            )}
          />
          <FieldNote id="setup-code-error" message={state.errors?.code} />
        </div>

        {tether ? (
          <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className={cn(buttonClass("accent", "l"), "w-full")}
          >
            {pending ? (
              <>
                <ButtonSpinner />
                {MFA_SETUP.submitting}
              </>
            ) : (
              MFA_SETUP.submit
            )}
          </button>
        ) : (
          <Button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            variant="primary"
            size="lg"
            className="h-12 w-full"
          >
            {pending ? (
              <>
                <ButtonSpinner />
                {MFA_SETUP.submitting}
              </>
            ) : (
              MFA_SETUP.submit
            )}
          </Button>
        )}
      </form>
    </div>
  );

  if (inline) return body;
  return (
    <AuthCard title={MFA_SETUP.title} subtitle={MFA_SETUP.helper}>
      {body}
    </AuthCard>
  );
}

/**
 * The setup step under the password (ADR 0512). It starts the enrolment once the password step has set the session
 * cookies, so it runs in its own request: the sign-in action's own request cannot see that session yet.
 */
export function InlineMfaSetup({ look, redirect }: { look?: AuthLook; redirect: string }) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // Once: a second start would remove the first factor while its QR is on screen.
    if (started.current) return;
    started.current = true;
    startEnrollmentAction()
      .then(setEnrollment)
      .catch(() => setEnrollment({ kind: "error", message: MFA_SETUP.retry }));
  }, []);

  const muted = look === "tether" ? "text-pw-ink-2" : "text-muted-foreground";
  if (!enrollment)
    return (
      <p role="status" className={cn("text-body-s inline-flex items-center gap-2", muted)}>
        <ButtonSpinner />
        {MFA_SETUP.preparing}
      </p>
    );
  if (enrollment.kind === "ready")
    return <MfaSetupForm {...enrollment} look={look} inline={{ redirect }} />;
  // Signed out or already enrolled between the two requests: a fresh sign-in sorts out either.
  if (enrollment.kind !== "error") return <AuthNotice message={MFA_SETUP.retry} />;
  return <AuthNotice message={`${MFA_SETUP.failed} ${enrollment.message}`} />;
}
