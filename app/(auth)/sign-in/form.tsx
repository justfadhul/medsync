"use client";

import type { SignInState } from "./actions";
import type { FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { CheckIcon, EyeIcon, EyeOffIcon } from "lucide-react";

import { TextLink } from "@/components/landing/primitives";
import { AuthHead, PlainInput, TETHER_INPUT, TETHER_LABEL } from "@/components/landing/tether/auth";
import { AuthCard } from "@/components/medsync/auth-card";
import { buttonClass } from "@/components/tide/kit";
import { Button } from "@/components/ui/button";
import { Input as ChromaInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SIGN_IN } from "@/content/auth";
import { PATIENT_WEB_COPY } from "@/content/patient/web";
import { AUTH } from "@/content/tether-landing/copy";
import { cn } from "@/lib/utils";
import {
  AUTH_INPUT,
  AUTH_LABEL,
  AuthNotice,
  ButtonSpinner,
  FieldNote,
} from "../_components/auth-notice";
import { AuthCardSkeleton } from "../_components/auth-skeleton";
import { InlineMfaSetup } from "../onboarding/mfa-setup/form";
import { signInAction } from "./actions";
import { MfaChallengeForm } from "./mfa/form";

const initial: SignInState = {};

/** The hospital app's look, or the Tether site's (ADR 0498): same form, same action, different drawing. */
export type AuthLook = "medsync" | "tether";

function Helper({ look = "medsync" }: { look?: AuthLook }) {
  return (
    <p
      className={
        look === "tether"
          ? "text-pw-ink-2 text-[15px] leading-[22px]"
          : "text-body-s text-muted-foreground"
      }
    >
      {SIGN_IN.helper}
    </p>
  );
}

function Footer() {
  return (
    <p className="text-body-m text-muted-foreground">
      {SIGN_IN.create.lead} <TextLink href={SIGN_IN.create.href} label={SIGN_IN.create.label} />
    </p>
  );
}

/** The Suspense fallback: the same card, copy and field geometry, so the swap doesn't shift. */
export function SignInSkeleton() {
  return (
    <AuthCardSkeleton title={SIGN_IN.title} fields={2} footer={<Footer />}>
      <Helper />
    </AuthCardSkeleton>
  );
}

export function SignInForm({ look = "medsync" }: { look?: AuthLook }) {
  const tether = look === "tether";
  const Input = tether ? PlainInput : ChromaInput;
  const label = tether ? TETHER_LABEL : AUTH_LABEL;
  const input = tether ? TETHER_INPUT : AUTH_INPUT;
  const [state, formAction, pending] = useActionState(signInAction, initial);
  const params = useSearchParams();
  const justSignedUp = params.get("signed-up") === "1";
  // /forgot-password/new lands here with ?reset=1 after the new password is saved.
  const passwordChanged = params.get("reset") === "1";
  // The patient web's idle sign-out (D-PW-06) lands here with ?idle=1; nothing else sets it.
  const idle = params.get("idle") === "1";
  const redirectTo = params.get("redirect") ?? "";

  const [offline, setOffline] = useState(false);
  const [shown, setShown] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const summary = useRef<HTMLDivElement>(null);

  // After a failed attempt, focus goes to what went wrong: the summary, or the
  // first field the server rejected.
  useEffect(() => {
    if (state.errors?._form) summary.current?.focus();
    else form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state]);
  useEffect(() => {
    if (offline) summary.current?.focus();
  }, [offline]);

  // Dispatch by hand rather than through <form action>: React resets the form
  // after an action, which would wipe the email after every failed attempt.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!navigator.onLine) {
      setOffline(true);
      summary.current?.focus();
      return;
    }
    setOffline(false);
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  const errors = state.errors ?? {};

  const notice =
    justSignedUp || passwordChanged ? (
      <span className="inline-flex items-center gap-1.5 text-teal-700">
        <CheckIcon aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
        {justSignedUp ? SIGN_IN.signedUp : SIGN_IN.passwordChanged}
      </span>
    ) : idle ? (
      PATIENT_WEB_COPY.idleSignedOut
    ) : undefined;

  const submitLabel = pending ? (
    <>
      <ButtonSpinner />
      {SIGN_IN.submitting}
    </>
  ) : (
    SIGN_IN.submit
  );

  const body = (
    <form
      ref={form}
      action={formAction}
      onSubmit={onSubmit}
      aria-busy={pending}
      className="flex flex-col gap-4"
    >
      <AuthNotice
        id="sign-in-errors"
        role="alert"
        tabIndex={-1}
        ref={summary}
        message={offline ? SIGN_IN.errors.offline : errors._form}
      />
      <input type="hidden" name="redirect" value={redirectTo} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email" className={label}>
          {SIGN_IN.labels.email}
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? "email-error" : undefined}
          readOnly={!!(state.mfa || state.setup)}
          className={input}
        />
        <FieldNote id="email-error" message={errors.email} />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="password" className={label}>
            {SIGN_IN.labels.password}
          </Label>
          <TextLink
            href={SIGN_IN.forgot.href}
            label={SIGN_IN.forgot.label}
            className="text-body-s -my-3"
          />
        </div>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={shown ? "text" : "password"}
            autoComplete="current-password"
            required
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "password-error" : undefined}
            readOnly={!!(state.mfa || state.setup)}
            className={cn(input, tether ? "pr-14" : "pr-12")}
          />
          <button
            type="button"
            aria-pressed={shown}
            aria-label={shown ? SIGN_IN.hidePassword : SIGN_IN.showPassword}
            aria-controls="password"
            onClick={() => setShown((s) => !s)}
            className={cn(
              "absolute flex items-center justify-center transition-colors duration-150 focus-visible:-outline-offset-4!",
              tether
                ? "text-pw-ink-2 hover:text-pw-ink hover:bg-pw-surface-3 inset-y-1 right-1 w-11 rounded-full"
                : "text-muted-foreground hover:text-foreground inset-y-0 right-0 w-12 rounded-md",
            )}
          >
            {shown ? (
              <EyeOffIcon aria-hidden className="size-5" />
            ) : (
              <EyeIcon aria-hidden className="size-5" />
            )}
          </button>
        </div>
        <FieldNote id="password-error" message={errors.password} />
      </div>

      {/* Once the password is accepted the code or setup step below takes over (it has its own button). */}
      {state.mfa || state.setup ? null : tether ? (
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className={cn(buttonClass("accent", "l"), "w-full")}
        >
          {submitLabel}
        </button>
      ) : (
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={pending}
          aria-busy={pending}
          className="h-12 w-full"
        >
          {submitLabel}
        </Button>
      )}

      {state.mfa || state.setup ? null : <Helper look={look} />}
    </form>
  );
  const codeStep = state.mfa ? (
    <MfaChallengeForm look={look} inline={state.mfa} />
  ) : state.setup ? (
    <InlineMfaSetup look={look} redirect={state.setup.redirect} />
  ) : null;

  return tether ? (
    <AuthHead title={AUTH.title} lead={notice ?? AUTH.lead}>
      {body}
      {codeStep}
    </AuthHead>
  ) : (
    <AuthCard title={SIGN_IN.title} subtitle={notice} footer={<Footer />}>
      {body}
      {codeStep}
    </AuthCard>
  );
}
