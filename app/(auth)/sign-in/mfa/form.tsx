"use client";

import type { MfaChallengeState } from "./actions";
import type { FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { TextLink } from "@/components/landing/primitives";
import { AuthCard } from "@/components/medsync/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MFA, SIGN_IN } from "@/content/auth";
import { cn } from "@/lib/utils";
import {
  AUTH_INPUT,
  AUTH_LABEL,
  AuthNotice,
  ButtonSpinner,
  FieldNote,
} from "../../_components/auth-notice";
import { AuthCardSkeleton } from "../../_components/auth-skeleton";
import { challengeMfaAction } from "./actions";

const initial: MfaChallengeState = {};

/** The Suspense fallback: the same card, copy and field geometry, so the swap doesn't shift. */
export function MfaSkeleton() {
  return <AuthCardSkeleton title={MFA.title} subtitle={MFA.helper} fields={1} />;
}

export function MfaChallengeForm() {
  const [state, formAction, pending] = useActionState(challengeMfaAction, initial);
  const params = useSearchParams();
  const redirectTo = params.get("redirect") ?? "";

  const [offline, setOffline] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  const code = useRef<HTMLInputElement>(null);

  // After a failed attempt, focus goes to what went wrong. React has already
  // reset the form, so a wrong code leaves an empty field ready for the next one.
  useEffect(() => {
    if (state.errors?._form || state.noFactor) summary.current?.focus();
    else if (state.errors?.code) code.current?.focus();
  }, [state]);
  useEffect(() => {
    if (offline) summary.current?.focus();
  }, [offline]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (navigator.onLine) return setOffline(false);
    event.preventDefault();
    setOffline(true);
    summary.current?.focus();
  }

  const message = offline ? (
    SIGN_IN.errors.offline
  ) : state.noFactor ? (
    <>
      {MFA.noFactor}{" "}
      <TextLink
        href={MFA.setUp.href}
        label={MFA.setUp.label}
        className="text-body-s min-h-0 align-baseline"
      />
    </>
  ) : (
    state.errors?._form
  );

  return (
    <AuthCard title={MFA.title} subtitle={MFA.helper}>
      <form
        action={formAction}
        onSubmit={onSubmit}
        aria-busy={pending}
        className="flex flex-col gap-4"
      >
        <AuthNotice id="mfa-errors" role="alert" tabIndex={-1} ref={summary} message={message} />
        <input type="hidden" name="redirect" value={redirectTo} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="code" className={AUTH_LABEL}>
            {MFA.label}
          </Label>
          <Input
            ref={code}
            id="code"
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
            autoFocus
            required
            aria-invalid={!!state.errors?.code}
            aria-describedby={state.errors?.code ? "code-error" : undefined}
            className={cn(AUTH_INPUT, "font-mono tracking-[0.3em] tabular-nums")}
          />
          <FieldNote id="code-error" message={state.errors?.code} />
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={pending}
          aria-busy={pending}
          className="h-12 w-full"
        >
          {pending ? (
            <>
              <ButtonSpinner />
              {MFA.submitting}
            </>
          ) : (
            MFA.submit
          )}
        </Button>
      </form>
    </AuthCard>
  );
}
