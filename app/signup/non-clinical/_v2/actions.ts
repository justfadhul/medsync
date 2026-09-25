"use server";

import type { SignupResult } from "@/lib/onboarding/account";
import { revalidatePath } from "next/cache";

import { encrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { createAccount, recordConsent, removeAccount } from "@/lib/onboarding/account";
import { normalizeNin, normalizeUgPhone } from "@/lib/onboarding/fields";
import { RECEPTION } from "@/lib/onboarding/profession";
import { nonClinicalSchema } from "@/lib/onboarding/schemas";
import { validateSignup } from "@/lib/onboarding/submit";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Non-clinical staff signup v2. The role is derived (one option today) and shown, not asked (O10).
 * Verification = NIN + the hospital admin's approval as employer attestation.
 */
export async function submitNonClinicalV2(input: unknown, key: unknown): Promise<SignupResult> {
  const checked = await validateSignup(nonClinicalSchema, input, key);
  if ("result" in checked) return checked.result;
  const v = checked.data;
  const service = createServiceClient();

  const [{ data: cadre }, { data: role }, { data: dept }] = await Promise.all([
    service.from("cadres").select("id").eq("code", RECEPTION.cadre).maybeSingle(),
    service.from("roles").select("id").eq("code", RECEPTION.role).maybeSingle(),
    service
      .from("hospital_departments")
      .select("id")
      .eq("id", v.departmentId)
      .eq("hospital_id", v.hospitalId)
      .maybeSingle(),
  ]);
  if (!cadre || !role)
    return { ok: false, formError: "We can't register this role right now. Try again later." };
  if (!dept)
    return {
      ok: false,
      fieldErrors: { departmentId: "Choose a department or unit at this hospital." },
    };

  const account = await createAccount({
    email: v.email,
    password: v.password,
    fullName: v.fullName.trim(),
    key: checked.key,
  });
  if ("error" in account) return { ok: false, formError: account.error };
  const uploads = v.letter === "file" ? ["appointment_letter"] : [];
  if (account.replay) return { ok: true, next: "/onboarding/clinical-pending", uploads };
  const userId = account.userId;

  const { error: profileError } = await service.from("staff_identity_profiles").insert({
    id: userId,
    nin_encrypted: encrypt(normalizeNin(v.nin)),
    staff_number: v.staffNumber || null,
    appointment_letter_url: null, // attached after upload (DOC-4)
    authorising_officer_name: v.officerName || null,
    authorising_officer_role: v.officerRole || null,
  });
  const { error: affError } = profileError
    ? { error: profileError }
    : await service.from("staff_affiliations").insert({
        user_id: userId,
        hospital_id: v.hospitalId,
        department_id: v.departmentId,
        cadre_id: cadre.id,
        cadre_grade_id: null,
        role_id: role.id,
        specialty_id: null,
        employment_type: v.employmentType,
        state: "pending_approval",
      });
  if (profileError || affError) {
    logger.error("non-clinical-signup-v2.insert_failed", {
      reason: (profileError ?? affError)!.message,
    });
    await removeAccount(userId);
    return { ok: false, formError: "We couldn't save your details. Nothing was kept — try again." };
  }

  await recordConsent(userId, v.consentVersion, v.consentSha).catch((e: unknown) =>
    logger.error("signup.consent.insert_failed", { reason: String(e) }),
  );
  await service
    .from("users")
    .update({ state: "pending_approval", phone: encrypt(normalizeUgPhone(v.phone)!) })
    .eq("id", userId);
  logger.info("non-clinical-signup-v2.completed", { hospital_id: v.hospitalId });
  revalidatePath("/onboarding/clinical-pending");
  return { ok: true, next: "/onboarding/clinical-pending", uploads };
}
