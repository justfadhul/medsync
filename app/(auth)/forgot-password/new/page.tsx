import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { EXPIRED_PATH, MFA_PATH, needsMfa } from "../flow";
import { NewPasswordForm } from "./form";

export const metadata: Metadata = { title: "Choose a new password" };

/**
 * Reached with the session the email link opened. No session: the link was never used here, or it
 * lapsed. An account with an authenticator passes it first, at /sign-in/mfa, which brings it back.
 */
export default async function NewPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) redirect(EXPIRED_PATH);
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (needsMfa(aal)) redirect(MFA_PATH);
  return <NewPasswordForm email={user.email} />;
}
