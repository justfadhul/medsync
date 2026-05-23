"use client";

import type { SignInState } from "./actions";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";

import { AuthCard, FieldError, FormError } from "@/components/medsync/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAction } from "./actions";

const initial: SignInState = {};

export function SignInForm() {
  const [state, formAction, pending] = useActionState(signInAction, initial);
  const params = useSearchParams();
  const justSignedUp = params.get("signed-up") === "1";
  const redirectTo = params.get("redirect") ?? "";

  return (
    <AuthCard
      title="Sign in"
      subtitle={
        justSignedUp
          ? "Account created. Sign in to continue."
          : "Welcome back. Sign in to continue."
      }
      footer={
        <p className="text-body-s text-muted-foreground">
          New here?{" "}
          <Link href="/sign-up" className="text-primary hover:underline">
            Create an account
          </Link>
        </p>
      }
    >
      <form action={formAction} className="flex flex-col gap-4">
        <FormError message={state.errors?._form} />
        <input type="hidden" name="redirect" value={redirectTo} />

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
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={!!state.errors?.password}
          />
          <FieldError message={state.errors?.password} />
        </div>

        <Button type="submit" disabled={pending} variant="primary" size="md">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}
