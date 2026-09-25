"use server";

import type { SignupResult } from "@/lib/onboarding/account";
import { revalidatePath } from "next/cache";

import { blindIndex, encrypt } from "@/lib/encryption";
import { getPlace } from "@/lib/geo";
import { logger } from "@/lib/logger";
import { fetchSmsConsentVersion, setSmsConsent } from "@/lib/notifications/consent";
import { createAccount, placeIds, recordConsent, removeAccount } from "@/lib/onboarding/account";
import { isoFromParts, normalizeUgPhone } from "@/lib/onboarding/fields";
import { patientSchema } from "@/lib/onboarding/schemas";
import { validateSignup } from "@/lib/onboarding/submit";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Patient signup v2 (ADR 0119/0120). Asks identity, place and sign-in; derives the display name;
 * defers ID, next of kin, usual hospital, photo, title and language to /patient/profile.
 * Under 18 is refused before anything is stored (DPPA s.8, D13).
 */
export async function submitPatientV2(input: unknown, key: unknown): Promise<SignupResult> {
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
    logger.error("patient-signup-v2.profile.insert_failed", { reason: profileError.message });
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

  logger.info("patient-signup-v2.completed", {});
  revalidatePath("/patient");
  return { ok: true, next: "/patient/profile?welcome=1", uploads: [] };
}
