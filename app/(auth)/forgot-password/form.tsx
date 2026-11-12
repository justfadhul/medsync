"use client";

import type { ResetRequestState } from "./actions";
import type { FormEvent } from "react";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { MailIcon } from "lucide-react";

import { TextLink } from "@/components/landing/primitives";
import { AuthCard } from "@/components/medsync/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RESET } from "@/content/auth";
import {
  AUTH_INPUT,
  AUTH_LABEL,
  AuthNotice,
  ButtonSpinner,
  FieldNote,
} from "../_components/auth-notice";
import { requestResetAction } from "./actions";

const initial: ResetRequestState = {};

function Footer() {
  return (
    <p className="text-body-m text-muted-foreground">
      {RESET.back.lead} <TextLink href={RESET.back.href} label={RESET.back.label} />
    </p>
  );
}

export function ResetRequestForm({ expired }: { expired: boolean }) {
  const [state, formAction, pending] = useActionState(requestResetAction, initial);
  const [offline, setOffline] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const sent = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.sentTo) sent.current?.focus();
    else form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state]);

  // By hand, as the sign-in form: React resets a <form action> afterwards, wiping the email.
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

  if (state.sentTo) {
    return (
      <AuthCard title={RESET.sentTitle} footer={<Footer />}>
        <div ref={sent} tabIndex={-1} role="status" className="flex items-start gap-3 outline-none">
          <MailIcon aria-hidden className="text-muted-foreground mt-0.5 size-5 shrink-0" />
          <div className="flex flex-col gap-2">
            <p className="text-body-m text-foreground">{RESET.sent(state.sentTo)}</p>
            <p className="text-body-s text-muted-foreground">{RESET.sentHelp}</p>
          </div>
        </div>
      </AuthCard>
    );
  }

  const emailError = state.errors?.email;
  return (
    <AuthCard title={RESET.title} subtitle={RESET.subtitle} footer={<Footer />}>
      <form
        ref={form}
        action={formAction}
        onSubmit={onSubmit}
        aria-busy={pending}
        className="flex flex-col gap-4"
      >
        <AuthNotice
          id="reset-errors"
          role="alert"
          tabIndex={-1}
          ref={summary}
          message={offline ? RESET.errors.offline : expired ? RESET.expired : undefined}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email" className={AUTH_LABEL}>
            {RESET.labels.email}
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
            aria-invalid={!!emailError}
            aria-describedby={emailError ? "email-error" : undefined}
            className={AUTH_INPUT}
          />
          <FieldNote id="email-error" message={emailError} />
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
              {RESET.submitting}
            </>
          ) : (
            RESET.submit
          )}
        </Button>

        <p className="text-body-s text-muted-foreground">{RESET.helper}</p>
      </form>
    </AuthCard>
  );
}
