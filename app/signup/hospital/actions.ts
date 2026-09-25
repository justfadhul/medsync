"use server";

import type { SignupResult } from "@/lib/onboarding/account";
import { revalidatePath } from "next/cache";

import { encrypt } from "@/lib/encryption";
import { getPlace } from "@/lib/geo";
import { assertSignupsOpen } from "@/lib/legal";
import { logger } from "@/lib/logger";
import { createAccount, placeIds, recordConsent, removeAccount } from "@/lib/onboarding/account";
import { emailDomain, normalizeUgPhone, PUBLIC_EMAIL_DOMAINS } from "@/lib/onboarding/fields";
import { allow } from "@/lib/onboarding/rate-limit";
import { fieldErrors, hospitalSchema, leadSchema, needsLicence } from "@/lib/onboarding/schemas";
import { validateSignup } from "@/lib/onboarding/submit";
import { getRegistryFacility } from "@/lib/registry";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Hospital application v2 (ADRs 0120, 0122, 0124, 0125). Asks facility, applicant, proof and
 * authority — nothing verification doesn't use (O6). A registry pick is re-read here and its facts
 * copied by the server (REG-3); the proof asked depends on the ownership the server derives. No
 * DPA at application: it is signed after verification, on the pending page (D7).
 */
export async function submitHospitalApplication(
  input: unknown,
  key: unknown,
): Promise<SignupResult> {
  assertSignupsOpen(); // S8 D1: no personal data before the legal basics (also in validateSignup)
  const checked = await validateSignup(hospitalSchema, input, key);
  if ("result" in checked) return checked.result;
  const v = checked.data;

  // ── The facility: registry (locked facts) or entered by hand ──
  let facility: {
    name: string;
    level: string;
    ownership: string;
    placeCode: string;
    bureau: string | null;
  };
  if (v.facilitySource === "registry") {
    const f = getRegistryFacility(v.registryCode ?? "");
    if (!f)
      return {
        ok: false,
        fieldErrors: { registryCode: "Find your facility on the registry again." },
      };
    if (!f.placeCode)
      return {
        ok: false,
        fieldErrors: {
          registryCode:
            "We can't place this facility on our map yet. Choose “Enter it yourself” instead.",
        },
      };
    const bureau =
      f.ownership === "pnfp" && f.authority !== "Private Authority"
        ? f.authority
        : (v.bureau ?? null);
    facility = {
      name: f.name,
      level: f.level,
      ownership: f.ownership,
      placeCode: f.placeCode,
      bureau,
    };
  } else {
    facility = {
      name: v.facilityName!.trim(),
      level: v.facilityLevel!,
      ownership: v.ownership!,
      placeCode: v.place!,
      bureau: v.ownership === "pnfp" ? (v.bureau ?? null) : null,
    };
  }
  // The proof the *derived* ownership needs — the page may have shown another if it was tampered with.
  if (facility.ownership !== v.ownership) {
    const again = hospitalSchema.safeParse({ ...v, ownership: facility.ownership });
    if (!again.success) return { ok: false, fieldErrors: fieldErrors(again.error) };
  }
  const place = getPlace(facility.placeCode);
  const ids =
    place && (await placeIds(place.district.code, place.level === "subcounty" ? place.code : null));
  if (!place || !ids)
    return {
      ok: false,
      fieldErrors: { place: "Choose where the facility is from the list again." },
    };

  const service = createServiceClient();
  let duplicate = false;
  if (v.facilitySource === "registry") {
    const { data: open } = await service
      .from("hospital_applications")
      .select("id")
      .eq("registry_code", v.registryCode!)
      .neq("state", "rejected")
      .limit(1);
    duplicate = (open?.length ?? 0) > 0; // REG-4: flagged for the reviewer, never blocked
  }
  const domain = emailDomain(v.email);
  const licence = needsLicence(facility.ownership);

  const account = await createAccount({
    email: v.email,
    password: v.password,
    fullName: v.applicantName.trim(),
    key: checked.key,
  });
  if ("error" in account) return { ok: false, formError: account.error };
  const uploads = [
    ...(v.letter === "file" ? ["authority_letter"] : []),
    ...(licence && v.licence === "file" ? ["facility_licence"] : []),
  ];
  if (account.replay) return { ok: true, next: "/onboarding/hospital-pending", uploads };
  const userId = account.userId;

  const officerPhone = v.officerPhone ? normalizeUgPhone(v.officerPhone) : null;
  const { error: insertError } = await service.from("hospital_applications").insert({
    applicant_user_id: userId,
    hospital_name: facility.name,
    facility_level: facility.level,
    ownership: facility.ownership,
    registration_number: licence ? v.licenceNumber!.trim() : v.registryOrHmisCode?.trim() || null,
    registration_authority: null,
    district_id: ids.districtId,
    subcounty_id: ids.subcountyId,
    physical_address: place.label, // refined later under "Contact details" in the setup checklist
    institutional_email_domain: domain,
    applicant_role: v.applicantRole,
    licensing_body: licence ? (facility.ownership === "pnfp" ? "bureau" : v.licensingBody!) : null,
    applicant_full_name: v.applicantName.trim(),
    applicant_work_email: v.email,
    applicant_phone: normalizeUgPhone(v.phone),
    applicant_council_number: null, // removed (O5, D8)
    authority_officer_name: v.officerName.trim(),
    authority_officer_title: v.officerTitle,
    authority_officer_phone: officerPhone ? encrypt(officerPhone) : null,
    authority_officer_email: v.officerEmail ? encrypt(v.officerEmail.trim().toLowerCase()) : null,
    email_domain_mismatch: false, // the domain is derived from the work email now (O7)
    public_email_domain: PUBLIC_EMAIL_DOMAINS.has(domain),
    registry_code: v.facilitySource === "registry" ? v.registryCode : null,
    facility_source: v.facilitySource,
    registry_correction_note:
      v.facilitySource === "registry" ? v.correctionNote?.trim() || null : null,
    duplicate_facility: duplicate,
    pnfp_bureau: facility.bureau,
    authorised_to_bind: false, // the agreement gate, after verification (D7)
  });
  if (insertError) {
    logger.error("hospital-application.insert_failed", { reason: insertError.message });
    await removeAccount(userId);
    return {
      ok: false,
      formError: "We couldn't save your application. Nothing was kept — try again.",
    };
  }

  await recordConsent(userId, v.consentVersion, v.consentSha).catch((e: unknown) =>
    logger.error("signup.consent.insert_failed", { reason: String(e) }),
  );
  await service
    .from("users")
    .update({ state: "pending_approval", phone: encrypt(normalizeUgPhone(v.phone)!) })
    .eq("id", userId);
  logger.info("hospital-application.submitted", {
    source: v.facilitySource,
    duplicate,
    public_domain: PUBLIC_EMAIL_DOMAINS.has(domain),
  });
  revalidatePath("/onboarding/hospital-pending");
  return { ok: true, next: "/onboarding/hospital-pending", uploads };
}

/**
 * D15: the short lead — "Ask us to call you" (hospital door) and "My hospital isn't on MedSync"
 * (clinical form). Creates no account. The old submitHospitalLeadAction stays for its callers (none).
 */
export async function submitHospitalLead(
  input: unknown,
): Promise<{ ok: boolean; fieldErrors?: Record<string, string>; formError?: string }> {
  assertSignupsOpen();
  if (!(await allow("lead", 5, 10 * 60_000)))
    return { ok: false, formError: "Too many requests from here. Try again later." };
  const parsed = leadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const place = getPlace(v.leadPlace);
  const ids = place && (await placeIds(place.district.code, null));
  if (!ids)
    return { ok: false, fieldErrors: { leadPlace: "Choose the district from the list again." } };
  const { error } = await createServiceClient()
    .from("hospital_leads")
    .insert({
      hospital_name: v.hospitalName.trim(),
      district_id: ids.districtId,
      contact_name: v.contactName?.trim() || null,
      contact_phone: v.contactPhone ? normalizeUgPhone(v.contactPhone) : null,
      contact_email: v.contactEmail?.trim().toLowerCase() || null,
      source: v.source,
    });
  if (error) {
    logger.error("hospital-lead.insert_failed", { reason: error.message });
    return { ok: false, formError: "We couldn't save that just now. Try again." };
  }
  return { ok: true };
}
