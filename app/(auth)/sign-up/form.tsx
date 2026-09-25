"use client";

import type { SignUpState } from "./actions";
import Link from "next/link";
import { useActionState } from "react";

import { PasswordInput } from "@/components/forms";
import { AuthCard, FieldError } from "@/components/medsync/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthNotice, ButtonSpinner } from "../_components/auth-notice";
import { signUpAction } from "./actions";

const initial: SignUpState = {};

export function SignUpForm() {
  const [state, formAction, pending] = useActionState(signUpAction, initial);

  return (
    <AuthCard
      title="Create your account"
      subtitle="Patients sign up here. Clinical staff are invited by an administrator."
      footer={
        <p className="text-body-s text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/sign-in"
            className="text-primary underline decoration-transparent underline-offset-2 transition-[text-decoration-color] duration-200 hover:decoration-current"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <form action={formAction} className="stagger-children flex flex-col gap-4">
        <AuthNotice message={state.errors?._form} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="full_name">Full name</Label>
          <Input
            id="full_name"
            name="full_name"
            type="text"
            autoComplete="name"
            required
            aria-invalid={!!state.errors?.full_name}
          />
          <FieldError message={state.errors?.full_name} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={!!state.errors?.email}
          />
          <FieldError message={state.errors?.email} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            minLength={12}
            required
            aria-invalid={!!state.errors?.password}
          />
          {state.errors?.password ? (
            <FieldError message={state.errors.password} />
          ) : (
            <p className="text-muted-foreground text-caption">At least 12 characters.</p>
          )}
        </div>

        <Button type="submit" disabled={pending} variant="primary" size="md" className="tap">
          {pending ? (
            <>
              <ButtonSpinner />
              Creating account…
            </>
          ) : (
            "Create account"
          )}
        </Button>
      </form>
    </AuthCard>
  );
}
