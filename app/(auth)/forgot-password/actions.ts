"use server";

import type { NewPasswordErrors } from "./flow";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { RESET } from "@/content/auth";
import { logger } from "@/lib/logger";
import { emailField } from "@/lib/onboarding/schemas";
import { SITE_URL } from "@/lib/site-config";
import { createClient, setActiveAccount, slotForSignIn } from "@/lib/supabase/server";
import {
  CONFIRM_PATH,
  EXPIRED_PATH,
  linkProof,
  MFA_PATH,
  needsMfa,
  NEW_PATH,
  newPasswordProblem,
  SIGN_IN_AFTER,
  updateRefusal,
  verifierSlot,
} from "./flow";

export type ResetRequestState = { sentTo?: string; errors?: { email?: string } };

export async function requestResetAction(
  _prev: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const parsed = emailField.safeParse(formData.get("email"));
  if (!parsed.success) return { errors: { email: RESET.errors.email } };
  const email = parsed.data;

  // The slot a sign-in as this email would use: a PKCE verifier lands there, and the confirm step finds it.
  const supabase = await createClient(await slotForSignIn(email));
  const origin = (await headers()).get("origin") ?? SITE_URL;
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}${CONFIRM_PATH}`,
  });

  // Every outcome reads the same. Supabase answers an unknown email with success, but a known one
  // can still fail (the per-email minute, the hourly mail limit, a refused address), and any other
  // words would say the account exists. Logged by code only: some messages quote the email.
  if (error)
    logger.warn("password-reset.request_failed", { code: error.code, status: error.status });
  return { sentTo: email };
}

/**
 * "Continue" on /forgot-password/confirm. Verifies the email link, which opens an aal1 session for the
 * account in its own slot, made active as a sign-in would; then on to choose the password. A used,
 * expired or missing link goes back to /forgot-password with a notice.
 */
export async function confirmLinkAction(_prev: null, formData: FormData): Promise<null> {
  const proof = linkProof((name) => formData.get(name));
  if (proof) {
    // A PKCE code is exchanged in the slot that holds its verifier. A token hash names no account
    // until verified: the first free slot, else the active one, as a sign-in would.
    const verifier = "code" in proof ? verifierSlot((await cookies()).getAll()) : null;
    const slot = verifier ?? (await slotForSignIn(""));
    const supabase = await createClient(slot);
    const { error } =
      "tokenHash" in proof
        ? await supabase.auth.verifyOtp({ type: "recovery", token_hash: proof.tokenHash })
        : await supabase.auth.exchangeCodeForSession(proof.code);
    if (!error) {
      await setActiveAccount(slot);
      redirect(NEW_PATH);
    }
    logger.warn("password-reset.link_refused", { code: error.code, status: error.status });
  }
  redirect(EXPIRED_PATH);
}

export type NewPasswordState = { errors?: NewPasswordErrors };

/**
 * /forgot-password/new. The same checks as the page (a session, aal2 where the account has an
 * authenticator), then the sign-up password rules, then Supabase. Afterwards every session of the
 * account ends ("global"), the link's included, and the user signs in with the new password.
 */
export async function setNewPasswordAction(
  _prev: NewPasswordState,
  formData: FormData,
): Promise<NewPasswordState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) redirect(EXPIRED_PATH);
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (needsMfa(aal)) redirect(MFA_PATH);

  const password = String(formData.get("password") ?? "");
  const problem = newPasswordProblem(password, String(formData.get("confirm") ?? ""), user.email);
  if (problem) return { errors: problem };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "insufficient_aal") redirect(MFA_PATH);
    logger.warn("password-reset.update_failed", { code: error.code, status: error.status });
    return { errors: updateRefusal(error.code) };
  }
  await supabase.auth.signOut({ scope: "global" });
  logger.info("password-reset.done");
  redirect(SIGN_IN_AFTER);
}
