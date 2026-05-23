"use server";

import type { ComboboxItem } from "@/components/forms";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { consentVersions } from "@/db/schema/consent-versions";
import { encrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { listSubcounties } from "@/lib/reference-data";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const PHONE_E164_UG = /^\+2567\d{8}$|^\+256[23489]\d{7,8}$/;
const EMAIL_DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

export async function loadSubcountiesForDistrictActionHospital(
  districtId: string,
): Promise<ComboboxItem[]> {
  if (!UUID_RE.test(districtId)) return [];
  const rows = await listSubcounties({ districtId });
  return rows.map((s) => ({ value: s.id, label: s.name }));
}

/* ─── Lightweight lead capture (anon) ───────────────────────────────── */

const HospitalLeadSchema = z.object({
  hospital_name: z.string().min(1, "Required.").max(160),
  facility_level: z.enum([
    "hc_ii",
    "hc_iii",
    "hc_iv",
    "general",
    "regional_referral",
    "national_referral",
    "private",
    "other",
  ]),
  ownership: z.enum(["public_moh", "private", "pnfp", "private_clinic"]),
  district_id: z.string().uuid(),
  contact_name: z.string().min(1).max(120),
  contact_role: z.string().min(1).max(80),
  contact_email: z.string().email(),
  contact_phone: z.string().regex(PHONE_E164_UG, "Enter a Ugandan phone number."),
  notes: z.string().max(2000).optional(),
  source: z.string().max(60).optional(),
});

export type HospitalLeadErrors = Partial<
  Record<keyof z.infer<typeof HospitalLeadSchema> | "_form", string>
>;
export type HospitalLeadState = {
  ok?: boolean;
  errors?: HospitalLeadErrors;
  values?: Record<string, string | undefined>;
};

/**
 * Anon lead capture (kickoff §E lighter footprint).
 *
 * Anti-spam: tag with the source CTA so a sudden burst from one
 * surface is visible in superadmin triage. Production should wrap
 * with Cloudflare Turnstile per kickoff Q4; the verification step
 * lands in GATE G ops setup. The RLS policy already restricts new
 * rows to state='new' so even bypassing the action can't smuggle a
 * lead in as "contacted".
 */
export async function submitHospitalLeadAction(
  _prev: HospitalLeadState,
  formData: FormData,
): Promise<HospitalLeadState> {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = HospitalLeadSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      errors: Object.fromEntries(
        Object.entries(fieldErrors).map(([k, v]) => [k, v?.[0]]),
      ) as HospitalLeadErrors,
      values: raw,
    };
  }
  const input = parsed.data;

  const service = createServiceClient();
  const { error } = await service.from("hospital_leads").insert({
    hospital_name: input.hospital_name,
    facility_level: input.facility_level,
    ownership: input.ownership,
    district_id: input.district_id,
    contact_name: input.contact_name,
    contact_role: input.contact_role,
    contact_email: input.contact_email.toLowerCase(),
    contact_phone: input.contact_phone,
    notes: input.notes ?? null,
    source: input.source ?? null,
  });
  if (error) {
    logger.error("hospital-lead.insert_failed", { reason: error.message });
    return {
      errors: { _form: "Couldn't save your interest right now. Please try again." },
      values: raw,
    };
  }
  logger.info("hospital-lead.captured", { source: input.source ?? null });
  return { ok: true };
}

/* ─── Full pilot application (authenticated) ────────────────────────── */

const HospitalApplicationSchema = z.object({
  // Applicant account
  applicant_full_name: z.string().min(1, "Required.").max(120),
  applicant_role: z.string().min(1, "Required.").max(80),
  applicant_email: z.string().email("Enter a valid email."),
  applicant_password: z
    .string()
    .min(12, "Password must be at least 12 characters.")
    .max(72, "Password must be 72 characters or fewer."),
  applicant_phone_e164: z.string().regex(PHONE_E164_UG, "Enter a Ugandan phone number."),

  // Facility
  hospital_name: z.string().min(1, "Required.").max(160),
  facility_level: z.enum([
    "hc_ii",
    "hc_iii",
    "hc_iv",
    "general",
    "regional_referral",
    "national_referral",
    "private",
    "other",
  ]),
  ownership: z.enum(["public_moh", "private", "pnfp", "private_clinic"]),
  registration_number: z.string().min(1, "Required.").max(120),
  registration_authority: z.string().max(160).optional(),
  district_id: z.string().uuid("Pick a district."),
  subcounty_id: z.string().uuid().optional(),
  physical_address: z.string().min(1, "Required.").max(400),
  institutional_email_domain: z
    .string()
    .regex(EMAIL_DOMAIN_RE, "Enter a domain like mulago.go.ug."),

  // Consent
  data_processing_consent: z.literal("on", {
    message: "Consent is required.",
  }),
  data_processing_consent_version: z.string().min(1),
  data_processing_consent_body_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
});

export type HospitalApplicationErrors = Partial<
  Record<keyof z.infer<typeof HospitalApplicationSchema> | "_form", string>
>;
export type HospitalApplicationState = {
  errors?: HospitalApplicationErrors;
  values?: Record<string, string | undefined>;
};

export async function submitHospitalApplicationAction(
  _prev: HospitalApplicationState,
  formData: FormData,
): Promise<HospitalApplicationState> {
  const authDoc = formData.get("authorisation_document");
  const rawEntries: Array<[string, string]> = [];
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string") rawEntries.push([k, v]);
  }
  const raw = Object.fromEntries(rawEntries) as Record<string, string>;

  const parsed = HospitalApplicationSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      errors: Object.fromEntries(
        Object.entries(fieldErrors).map(([k, v]) => [k, v?.[0]]),
      ) as HospitalApplicationErrors,
      values: raw,
    };
  }
  const input = parsed.data;

  // Consent hash cross-check.
  const [activeConsent] = await db
    .select()
    .from(consentVersions)
    .where(
      and(
        eq(consentVersions.consentType, "data_processing"),
        eq(consentVersions.version, input.data_processing_consent_version),
      ),
    )
    .limit(1);
  if (
    !activeConsent ||
    activeConsent.bodySha256.toLowerCase() !==
      input.data_processing_consent_body_sha256.toLowerCase()
  ) {
    logger.warn("hospital-application.consent.mismatch");
    return {
      errors: {
        _form:
          "The consent text on this page is out of date. Please reload to see the current version and accept again.",
      },
      values: raw,
    };
  }

  // Create the applicant account.
  const supabase = await createClient();
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: input.applicant_email.toLowerCase(),
    password: input.applicant_password,
    options: { data: { full_name: input.applicant_full_name } },
  });
  if (signUpError || !signUpData.user) {
    logger.warn("hospital-application.auth.failed", { reason: signUpError?.message });
    return {
      errors: { _form: signUpError?.message ?? "Couldn't create your account." },
      values: raw,
    };
  }
  const userId = signUpData.user.id;

  const service = createServiceClient();

  // Upload authorisation document to private Storage bucket
  // `hospital-authorisations` (GATE G provisions; skip-with-warning
  // if missing in dev).
  let authPath: string | null = null;
  if (authDoc instanceof File && authDoc.size > 0) {
    const ext = (authDoc.name.split(".").pop() ?? "bin").toLowerCase().slice(0, 5);
    const objectKey = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await service.storage
      .from("hospital-authorisations")
      .upload(objectKey, authDoc, {
        contentType: authDoc.type || "application/octet-stream",
        upsert: false,
      });
    if (uploadError) {
      logger.warn("hospital-application.doc.upload_skipped", {
        reason: uploadError.message,
      });
    } else {
      authPath = objectKey;
    }
  }

  // INSERT hospital_applications.
  const { error: insertError } = await service.from("hospital_applications").insert({
    applicant_user_id: userId,
    hospital_name: input.hospital_name,
    facility_level: input.facility_level,
    ownership: input.ownership,
    registration_number: input.registration_number,
    registration_authority: input.registration_authority ?? null,
    district_id: input.district_id,
    subcounty_id: input.subcounty_id ?? null,
    physical_address: input.physical_address,
    institutional_email_domain: input.institutional_email_domain.toLowerCase(),
    applicant_role: input.applicant_role,
    authorisation_document_path: authPath,
  });
  if (insertError) {
    logger.error("hospital-application.insert_failed", {
      reason: insertError.message,
    });
    await service.auth.admin.deleteUser(userId).catch(() => undefined);
    return {
      errors: { _form: "Couldn't save your application. Please try again." },
      values: raw,
    };
  }

  // consent_records + encrypted phone on users mirror + state bump.
  const phoneCt = encrypt(input.applicant_phone_e164);
  await service.from("consent_records").insert({
    user_id: userId,
    consent_type: "data_processing",
    consent_text_sha256: activeConsent.bodySha256,
    granted_at: new Date().toISOString(),
  });
  await service
    .from("users")
    .update({ state: "pending_approval", phone: phoneCt })
    .eq("id", userId);

  logger.info("hospital-application.submitted", {
    facility_level: input.facility_level,
    doc_uploaded: authPath !== null,
  });

  revalidatePath("/dashboard");
  redirect("/dashboard?welcomed=hospital-pending");
}
