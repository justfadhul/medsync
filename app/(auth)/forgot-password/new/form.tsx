"use client";

import type { NewPasswordState } from "../actions";
import type { FormEvent } from "react";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";

import { PasswordInput } from "@/components/forms/password-input";
import { AuthCard } from "@/components/medsync/auth-card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NEW_PASSWORD } from "@/content/auth";
import {
  AUTH_INPUT,
  AUTH_LABEL,
  AuthNotice,
  ButtonSpinner,
  FieldNote,
} from "../../_components/auth-notice";
import { setNewPasswordAction } from "../actions";

const initial: NewPasswordState = {};

export function NewPasswordForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(setNewPasswordAction, initial);
  const [offline, setOffline] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const summary = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.errors?._form) summary.current?.focus();
    else form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state]);

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
    <AuthCard title={NEW_PASSWORD.title} subtitle={NEW_PASSWORD.subtitle(email)}>
      <form
        ref={form}
        action={formAction}
        onSubmit={onSubmit}
        aria-busy={pending}
        className="flex flex-col gap-4"
      >
        <AuthNotice
          id="new-password-errors"
          role="alert"
          tabIndex={-1}
          ref={summary}
          message={offline ? NEW_PASSWORD.errors.offline : errors._form}
        />
        {/* The account's email, for the browser's password manager to file the new password under. */}
        <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password" className={AUTH_LABEL}>
            {NEW_PASSWORD.labels.password}
          </Label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            required
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "password-error password-hint" : "password-hint"}
            className={AUTH_INPUT}
          />
          <p id="password-hint" className="text-body-s text-muted-foreground">
            {NEW_PASSWORD.hint}
          </p>
          <FieldNote id="password-error" message={errors.password} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm" className={AUTH_LABEL}>
            {NEW_PASSWORD.labels.confirm}
          </Label>
          <PasswordInput
            id="confirm"
            name="confirm"
            autoComplete="new-password"
            required
            aria-invalid={!!errors.confirm}
            aria-describedby={errors.confirm ? "confirm-error" : undefined}
            className={AUTH_INPUT}
          />
          <FieldNote id="confirm-error" message={errors.confirm} />
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
              {NEW_PASSWORD.submitting}
            </>
          ) : (
            NEW_PASSWORD.submit
          )}
        </Button>
      </form>
    </AuthCard>
  );
}
