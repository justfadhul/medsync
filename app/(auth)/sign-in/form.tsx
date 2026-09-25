"use client";

import type { SignInState } from "./actions";
import type { FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { CheckIcon, EyeIcon, EyeOffIcon } from "lucide-react";

import { TEXT_LINK, TextLink } from "@/components/landing/primitives";
import { AuthCard } from "@/components/medsync/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SIGN_IN } from "@/content/auth";
import { cn } from "@/lib/utils";
import {
  AUTH_INPUT,
  AUTH_LABEL,
  AuthNotice,
  ButtonSpinner,
  FieldNote,
} from "../_components/auth-notice";
import { AuthCardSkeleton } from "../_components/auth-skeleton";
import { signInAction } from "./actions";

const initial: SignInState = {};

function Helper() {
  return <p className="text-body-s text-muted-foreground">{SIGN_IN.helper}</p>;
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

export function SignInForm() {
  const [state, formAction, pending] = useActionState(signInAction, initial);
  const params = useSearchParams();
  const justSignedUp = params.get("signed-up") === "1";
  const redirectTo = params.get("redirect") ?? "";

  const [offline, setOffline] = useState(false);
  const [shown, setShown] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
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

  return (
    <AuthCard
      title={SIGN_IN.title}
      subtitle={
        justSignedUp ? (
          <span className="inline-flex items-center gap-1.5 text-teal-700">
            <CheckIcon aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
            {SIGN_IN.signedUp}
          </span>
        ) : undefined
      }
      footer={<Footer />}
    >
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
          <Label htmlFor="email" className={AUTH_LABEL}>
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
            className={AUTH_INPUT}
          />
          <FieldNote id="email-error" message={errors.email} />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="password" className={AUTH_LABEL}>
              {SIGN_IN.labels.password}
            </Label>
            <button
              type="button"
              aria-expanded={resetOpen}
              aria-controls="reset-panel"
              onClick={() => setResetOpen((open) => !open)}
              className={cn(TEXT_LINK, "text-body-s -my-3 inline-flex min-h-11 items-center")}
            >
              {SIGN_IN.forgot}
            </button>
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
              className={cn(AUTH_INPUT, "pr-12")}
            />
            <button
              type="button"
              aria-pressed={shown}
              aria-label={shown ? SIGN_IN.hidePassword : SIGN_IN.showPassword}
              aria-controls="password"
              onClick={() => setShown((s) => !s)}
              className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-md transition-colors duration-150 focus-visible:-outline-offset-4!"
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

        <div
          id="reset-panel"
          hidden={!resetOpen}
          className="border-gray-150 bg-muted text-body-s rounded-md border p-4"
        >
          <h2 className="text-foreground font-medium">{SIGN_IN.resetPanel.title}</h2>
          <p className="text-muted-foreground mt-1">
            {SIGN_IN.resetPanel.body}{" "}
            <a href={`mailto:${SIGN_IN.resetPanel.email}`} className={TEXT_LINK}>
              {SIGN_IN.resetPanel.email}
            </a>
          </p>
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
              {SIGN_IN.submitting}
            </>
          ) : (
            SIGN_IN.submit
          )}
        </Button>

        <Helper />
      </form>
    </AuthCard>
  );
}
