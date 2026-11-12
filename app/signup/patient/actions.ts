"use server";

import { isIP } from "node:net";
import type { SignupResult } from "@/lib/onboarding/account";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { PATIENT_CLAIM } from "@/content/desk-register";
import { blindIndex, encrypt } from "@/lib/encryption";
import { getPlace } from "@/lib/geo";
import { assertSignupsOpen } from "@/lib/legal";
import { logger } from "@/lib/logger";
import { fetchSmsConsentVersion, setSmsConsent } from "@/lib/notifications/consent";
import { createAccount, placeIds, recordConsent, removeAccount } from "@/lib/onboarding/account";
import { isoFromParts, normalizeUgPhone } from "@/lib/onboarding/fields";
import { allow } from "@/lib/onboarding/rate-limit";
import { deskClaimSchema, patientSchema } from "@/lib/onboarding/schemas";
import { validateSignup } from "@/lib/onboarding/submit";
import { createClient, setActiveAccount, slotForSignIn } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { claimCodeIndexInput, normalizeClaimCode } from "@/supabase/functions/_shared/desk-record";

/**
 * Patient signup v2 (ADR 0119/0120). Asks identity, place and sign-in; derives the display name;
 * defers ID, next of kin, usual hospital, photo, title and language to /patient/profile.
 * Under 18 is refused before anything is stored (DPPA s.8, D13).
 */
export async function submitPatientSignup(input: unknown, key: unknown): Promise<SignupResult> {
  assertSignupsOpen(); // S8 D1: no personal data before the legal basics (also in validateSignup)
  const checked = await validateSignup(patientSchema, input, key);
  if ("result" in checked) return checked.result;
  const v = checked.data;

  const place = getPlace(v.place);
  const ids =
    place && (await placeIds(place.district.code, place.level === "subcounty" ? place.code : null));
  if (!place || !ids)
    return { ok: false, fieldErrors: { place: "Choose where you live from the list again." } };
  const phone = normalizeUgPhone(v.phone)!;
  const dob = isoFromParts(v.dobDay!, v.dobMonth!, v.dobYear!)!; // the schema refused anything else
  const fullName = `${v.firstName.trim()} ${v.surname.trim()}`;

  const account = await createAccount({
    email: v.email,
    password: v.password,
    fullName,
    key: checked.key,
  });
  if ("error" in account) return { ok: false, formError: account.error };
  if (account.replay) return { ok: true, next: "/patient/profile?welcome=1", uploads: [] };
  const userId = account.userId;

  const service = createServiceClient();
  const { error: profileError } = await service.from("patient_profiles").insert({
    id: userId,
    title_code: null,
    first_name_encrypted: encrypt(v.firstName.trim()),
    surname_encrypted: encrypt(v.surname.trim()),
    sex: v.sex,
    date_of_birth: dob,
    id_type: "none", // added later on the profile (Appendix A)
    id_number_encrypted: null,
    phone_encrypted: encrypt(phone),
    phone_hmac: blindIndex(phone),
    district_id: ids.districtId,
    subcounty_id: ids.subcountyId,
    village_address_encrypted: v.village ? encrypt(v.village) : null,
    preferred_language: null,
    primary_facility_id: null,
  });
  if (profileError) {
    logger.error("patient-signup.profile.insert_failed", { reason: profileError.message });
    await removeAccount(userId);
    return { ok: false, formError: "We couldn't save your details. Nothing was kept — try again." };
  }

  await recordConsent(userId, v.consentVersion, v.consentSha).catch((e: unknown) =>
    logger.error("signup.consent.insert_failed", { reason: String(e) }),
  );
  if (v.smsConsent && v.smsVersion) {
    const sms = await fetchSmsConsentVersion();
    if (
      sms &&
      sms.version === v.smsVersion &&
      sms.bodySha256.toLowerCase() === (v.smsSha ?? "").toLowerCase()
    )
      await setSmsConsent(userId, true, sms).catch((e: unknown) =>
        logger.error("signup.sms_consent.insert_failed", { reason: String(e) }),
      );
  }
  await service.from("users").update({ state: "verified" }).eq("id", userId);

  logger.info("patient-signup.completed", {});
  revalidatePath("/patient");
  return { ok: true, next: "/patient/profile?welcome=1", uploads: [] };
}

/**
 * Taking over the record the desk registered (ADR 0475, migration 0292). The phone the desk took and the claim code
 * it gave prove it is theirs; then THAT auth user gets the person's email and password. Same id, so every booking,
 * intake and note stays theirs, and nothing is created or deleted. A wrong, expired, spent or used code changes
 * nothing: the person fixes it, comes back later with a new code, or signs up without one (a separate record).
 *
 *   desk_claim_begin   checks the code (wrong tries counted) and opens a 5-minute permit
 *   updateUserById     email + password; the 0292 guard on auth.users lets it through only under that permit
 *   desk_claim_finish  marks the code used, records the person's own consent, audits (claim_desk_record)
 */
export async function submitDeskClaim(input: unknown, key: unknown): Promise<SignupResult> {
  assertSignupsOpen(); // S8 D1, as sign-up (also in validateSignup)
  const checked = await validateSignup(deskClaimSchema, input, key);
  if ("result" in checked) return checked.result;
  if (!(await allow("desk-claim", 10))) return { ok: false, formError: PATIENT_CLAIM.errors.busy };
  const v = checked.data;
  const service = createServiceClient();

  const { data: begun, error: beginError } = await service.rpc("desk_claim_begin", {
    p_phone_hmac: blindIndex(normalizeUgPhone(v.phone)!),
    p_code_hash: blindIndex(claimCodeIndexInput(normalizeClaimCode(v.claimCode)!)),
  });
  const row = (begun as { outcome: string; user_id: string | null }[] | null)?.[0];
  if (beginError || !row) {
    logger.error("desk-claim.begin_failed", { reason: beginError?.message });
    return { ok: false, formError: PATIENT_CLAIM.errors.failed };
  }
  if (row.outcome !== "ok" || !row.user_id) {
    logger.warn("desk-claim.refused", { outcome: row.outcome });
    const errors: Record<string, string> = PATIENT_CLAIM.errors;
    return {
      ok: false,
      fieldErrors: { claimCode: errors[row.outcome] ?? PATIENT_CLAIM.errors.wrong_code },
      formError: row.outcome === "already_claimed" ? undefined : PATIENT_CLAIM.errors.later,
    };
  }
  const userId = row.user_id;

  const { error: authError } = await service.auth.admin.updateUserById(userId, {
    email: v.email,
    password: v.password,
    email_confirm: true, // as sign-up does today (ADR 0010: the project confirms at sign-up)
    app_metadata: { desk_registered: false, desk_claimed_at: new Date().toISOString() },
  });
  if (authError) {
    logger.warn("desk-claim.auth_update_failed", { code: authError.code });
    if (authError.code === "email_exists" || /already (been )?registered/i.test(authError.message))
      return { ok: false, fieldErrors: { email: PATIENT_CLAIM.errors.emailTaken } };
    return { ok: false, formError: PATIENT_CLAIM.errors.failed };
  }

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const finish = () =>
    service.rpc("desk_claim_finish", {
      p_user_id: userId,
      p_email: v.email,
      p_consent_version: v.consentVersion,
      p_consent_sha: v.consentSha,
      p_ip: isIP(ip) ? ip : "", // the SQL casts it to inet
      p_user_agent: h.get("user-agent") ?? "",
    });
  // ponytail: the credential is already on the record here, so a failed finish cannot be undone; one retry, then a
  // loud log with the id for the owner to reconcile. Atomic would mean auditing inside the auth.users trigger.
  const { error: finishError } = (await finish()).error ? await finish() : { error: null };
  if (finishError)
    logger.error("desk-claim.finish_failed", { userId, reason: finishError.message });

  const slot = await slotForSignIn(v.email);
  const { error: signInError } = await (
    await createClient(slot)
  ).auth.signInWithPassword({ email: v.email, password: v.password });
  if (signInError) return { ok: true, next: "/sign-in", uploads: [] };
  await setActiveAccount(slot);

  logger.info("desk-claim.completed", {});
  revalidatePath("/patient");
  return { ok: true, next: "/patient/profile?welcome=1", uploads: [] };
}
