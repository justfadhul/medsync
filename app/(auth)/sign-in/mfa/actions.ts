"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { safeRedirect } from "../errors";

const ChallengeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator."),
  redirect: z.string().optional(),
});

export type MfaChallengeState = {
  errors?: Partial<Record<"code" | "_form", string>>;
  /** No TOTP factor on the account: the form links to /onboarding/mfa-setup. */
  noFactor?: boolean;
};

export async function challengeMfaAction(
  _prev: MfaChallengeState,
  formData: FormData,
): Promise<MfaChallengeState> {
  const parsed = ChallengeSchema.safeParse({
    // A pasted "123 456" is still a 6-digit code.
    code: String(formData.get("code") ?? "").replace(/\s/g, ""),
    redirect: formData.get("redirect") ?? undefined,
  });
  if (!parsed.success) {
    return { errors: { code: parsed.error.flatten().fieldErrors.code?.[0] } };
  }

  const supabase = await createClient();

  // Find the user's first verified TOTP factor.
  const { data: factors, error: listErr } = await supabase.auth.mfa.listFactors();
  if (listErr || !factors?.totp.length) {
    logger.warn("mfa challenge attempted with no TOTP factor enrolled");
    return { noFactor: true };
  }
  const factor = factors.totp[0];
  if (!factor) {
    return { noFactor: true };
  }

  const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: factor.id });
  if (chErr || !ch) {
    logger.error("mfa challenge create failed", { reason: chErr?.message });
    return { errors: { _form: "Could not start MFA challenge. Try again." } };
  }

  const { error: verErr } = await supabase.auth.mfa.verify({
    factorId: factor.id,
    challengeId: ch.id,
    code: parsed.data.code,
  });
  if (verErr) {
    logger.warn("mfa verify failed", { reason: verErr.message });
    return { errors: { code: "That code didn't work. Try the next one your app shows." } };
  }

  // Same default-by-role logic as the sign-in action: admins go to
  // /admin, everyone else to /. Explicit ?redirect= always wins.
  let defaultTarget = "/";
  const { data: userData } = await supabase.auth.getUser();
  if (userData.user) {
    const service = createServiceClient();
    const { data: roles } = await service
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    if (roles?.some((r) => r.role === "superadmin" || r.role === "hospital_admin")) {
      defaultTarget = "/admin";
    }
  }

  const target = safeRedirect(parsed.data.redirect) ?? defaultTarget;

  logger.info("mfa challenge passed; session elevated to AAL2");
  redirect(target);
}
