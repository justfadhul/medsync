"use server";

import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { safeRedirect } from "../../sign-in/errors";
import { landingFor } from "../../sign-in/landing";

const VerifySchema = z.object({
  factor_id: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator."),
  redirect: z.string().optional(),
});

export type MfaSetupState = {
  errors?: Partial<Record<"code" | "_form", string>>;
};

export type Enrollment =
  | { kind: "ready"; factorId: string; secret: string; qrSvg: string }
  | { kind: "signed-out" }
  | { kind: "enrolled" }
  | { kind: "error"; message: string };

/**
 * Starts a TOTP enrolment for the signed-in account: the setup page calls it while rendering, the sign-in page
 * (ADR 0512) once the password is accepted. The factor stays "unverified" in Supabase until a matching 6-digit
 * code comes back (verifyEnrollmentAction). Any unverified factor from an earlier attempt is removed first.
 */
export async function startEnrollmentAction(): Promise<Enrollment> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: "signed-out" };

  // listFactors().totp is verified-only; unverified factors live in .all.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  if (factors?.totp?.[0]) return { kind: "enrolled" };

  const unverified =
    factors?.all?.filter((f) => f.factor_type === "totp" && f.status === "unverified") ?? [];
  for (const stale of unverified) {
    await supabase.auth.mfa.unenroll({ factorId: stale.id });
  }

  const { data: enroll, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `MedSync (${new Date().toISOString().slice(0, 10)})`,
    issuer: "MedSync",
  });
  if (error || !enroll || enroll.type !== "totp") {
    logger.error("mfa enroll start failed", { reason: error?.message });
    return { kind: "error", message: error?.message ?? "unknown error" };
  }

  const qrSvg = await QRCode.toString(enroll.totp.uri, {
    type: "svg",
    margin: 1,
    width: 200,
    color: { dark: "#0D9488", light: "#FFFFFF00" },
  });
  return { kind: "ready", factorId: enroll.id, secret: enroll.totp.secret, qrSvg };
}

export async function verifyEnrollmentAction(
  _prev: MfaSetupState,
  formData: FormData,
): Promise<MfaSetupState> {
  const parsed = VerifySchema.safeParse({
    factor_id: formData.get("factor_id"),
    code: String(formData.get("code") ?? "").replace(/\s/g, ""),
    redirect: formData.get("redirect") ?? undefined,
  });
  if (!parsed.success) {
    return { errors: { code: parsed.error.flatten().fieldErrors.code?.[0] } };
  }

  const supabase = await createClient();
  const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({
    factorId: parsed.data.factor_id,
  });
  if (chErr || !ch) {
    logger.error("mfa enroll challenge failed", { reason: chErr?.message });
    return { errors: { _form: "Could not start verification. Try again." } };
  }

  const { error: verErr } = await supabase.auth.mfa.verify({
    factorId: parsed.data.factor_id,
    challengeId: ch.id,
    code: parsed.data.code,
  });
  if (verErr) {
    logger.warn("mfa enroll verify failed", { reason: verErr.message });
    return { errors: { code: "That code didn't work. Try the next one your app shows." } };
  }

  // Where signing in would have gone (ADR 0512); it used to be /admin for everyone.
  const { data: userData } = await supabase.auth.getUser();
  const target = userData.user
    ? (await landingFor(userData.user.id, parsed.data.redirect)).target
    : (safeRedirect(parsed.data.redirect) ?? "/");

  logger.info("mfa enrollment complete");
  redirect(target);
}

export async function unenrollAction(factorId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.mfa.unenroll({ factorId });
  logger.info("mfa factor unenrolled");
  redirect("/onboarding/mfa-setup");
}
