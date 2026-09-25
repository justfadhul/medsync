"use server";

import type { ComboboxItem } from "@/components/forms/combobox";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { consentVersions } from "@/db/schema/consent-versions";
import { encrypt } from "@/lib/encryption";
import { assertSignupsOpen } from "@/lib/legal";
import { logger } from "@/lib/logger";
import { listCadres, listDepartments, listRoles } from "@/lib/reference-data";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { pickFromList } from "@/lib/zod-helpers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Non-clinical staff signup — parallel to /signup/clinical but
 * without the council/licence anchor. Mirrors the existing action
 * shape so the form primitives + onboarding pending flow work
 * unchanged.
 *
 * Verification basis = hospital-admin approval as employer attestation.
 * NIN is captured (encrypted) as the identity anchor. Appointment
 * letter + staff number + authorising officer are optional supporting
 * evidence — none gate signup.
 */

/* ─── Reference-data loader actions (used by the form's cascade) ── */

/**
 * Cadres filtered to is_clinical = false. The form's cadre combobox
 * only shows non-clinical options — the clinical signup path stays
 * untouched.
 */
export async function loadNonClinicalCadresAction(): Promise<ComboboxItem[]> {
  const rows = await listCadres({ isClinical: false });
  return rows.map((r) => ({ value: r.id, label: r.name }));
}

export async function loadRolesForCadreAction(cadreId: string): Promise<ComboboxItem[]> {
  if (!UUID_RE.test(cadreId)) return [];
  const rows = await listRoles({ cadreId });
  return rows.map((r) => ({ value: r.id, label: r.name }));
}

export async function loadDepartmentsForHospitalAction(
  hospitalId: string,
): Promise<ComboboxItem[]> {
  if (!UUID_RE.test(hospitalId)) return [];
  const rows = await listDepartments({ hospitalId });
  return rows.map((r) => ({ value: r.id, label: r.name }));
}

/* ─── Schema ────────────────────────────────────────────────────── */

const PHONE_E164_UG = /^\+2567\d{8}$|^\+256[23489]\d{7,8}$/;
// Uganda NIN: 14 chars, alphanumeric (e.g. CM12345678ABCDE). Permissive
// — admin verifies on approval; we just enforce shape so we don't
// store garbage.
const NIN_RE = /^[A-Z0-9]{8,16}$/i;

const NonClinicalSignupSchema = z.object({
  // Account basics
  full_name: z.string().min(2, "Required.").max(120),
  email: z.string().email("Enter a valid email."),
  password: z.string().min(8, "Use at least 8 characters."),
  phone_e164: z.string().regex(PHONE_E164_UG, "Enter a Ugandan phone number."),

  // Identity (replaces council registration)
  nin: z.string().regex(NIN_RE, "Enter your National ID number (NIN)."),
  staff_number: z.string().max(60).optional(),
  authorising_officer_name: z.string().max(120).optional(),
  authorising_officer_role: z.string().max(120).optional(),

  // Affiliation
  cadre_id: pickFromList("cadre"),
  role_id: pickFromList("role"),
  hospital_id: pickFromList("hospital"),
  department_id: pickFromList("department"),
  employment_type: z.enum(["full_time", "visiting", "locum"]),

  // Consent
  data_processing_consent: z.literal("on", { message: "Consent is required." }),
  data_processing_consent_version: z.string().min(1),
  data_processing_consent_body_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
});

export type NonClinicalSignupErrors = Partial<
  Record<keyof z.infer<typeof NonClinicalSignupSchema> | "_form", string>
>;

export type NonClinicalSignupState = {
  errors?: NonClinicalSignupErrors;
  values?: Record<string, string | undefined>;
};

export async function submitNonClinicalSignupAction(
  _prev: NonClinicalSignupState,
  formData: FormData,
): Promise<NonClinicalSignupState> {
  assertSignupsOpen(); // S8 D1: production collects no personal data until the legal basics exist
  // Pull the optional appointment-letter file before string conversion.
  const appointmentLetterFile = formData.get("appointment_letter");
  const rawEntries: Array<[string, string]> = [];
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string") rawEntries.push([k, v]);
  }
  const raw = Object.fromEntries(rawEntries) as Record<string, string>;
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== "") cleaned[k] = v;
  }

  const parsed = NonClinicalSignupSchema.safeParse(cleaned);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      errors: Object.fromEntries(
        Object.entries(fieldErrors).map(([k, v]) => [k, v?.[0]]),
      ) as NonClinicalSignupErrors,
      values: raw,
    };
  }
  const input = parsed.data;

  // 1. Consent hash cross-check (same pattern as clinical).
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
    logger.warn("non-clinical-signup.consent.mismatch");
    return {
      errors: {
        _form:
          "The consent text on this page is out of date. Please reload to see the current version and accept again.",
      },
      values: raw,
    };
  }

  // 2. Create the auth user.
  const supabase = await createClient();
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: input.email.toLowerCase(),
    password: input.password,
    options: { data: { full_name: input.full_name } },
  });
  if (signUpError || !signUpData.user) {
    logger.warn("non-clinical-signup.auth.failed", { reason: signUpError?.message });
    return {
      errors: { _form: signUpError?.message ?? "Couldn't create your account." },
      values: raw,
    };
  }
  const userId = signUpData.user.id;

  // 3. Encrypt PII + (optional) upload appointment letter.
  const phoneCt = encrypt(input.phone_e164);
  const ninCt = encrypt(input.nin.toUpperCase());
  const service = createServiceClient();

  let appointmentLetterPath: string | null = null;
  if (appointmentLetterFile instanceof File && appointmentLetterFile.size > 0) {
    const ext = (appointmentLetterFile.name.split(".").pop() ?? "bin").toLowerCase().slice(0, 5);
    const objectKey = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await service.storage
      .from("staff-identity-documents")
      .upload(objectKey, appointmentLetterFile, {
        contentType: appointmentLetterFile.type || "application/octet-stream",
        upsert: false,
      });
    if (uploadError) {
      logger.warn("non-clinical-signup.letter.upload_skipped", {
        reason: uploadError.message,
      });
    } else {
      appointmentLetterPath = objectKey;
    }
  }

  // 4. INSERT staff_identity_profiles.
  const { error: profileError } = await service.from("staff_identity_profiles").insert({
    id: userId,
    nin_encrypted: ninCt,
    staff_number: input.staff_number ?? null,
    appointment_letter_url: appointmentLetterPath,
    authorising_officer_name: input.authorising_officer_name ?? null,
    authorising_officer_role: input.authorising_officer_role ?? null,
  });
  if (profileError) {
    logger.error("non-clinical-signup.profile.insert_failed", {
      reason: profileError.message,
    });
    await service.auth.admin.deleteUser(userId).catch(() => undefined);
    return {
      errors: { _form: "Could not save your identity profile. Please try again." },
      values: raw,
    };
  }

  // 5. INSERT staff_affiliations (pending_approval).
  const { error: affiliationError } = await service.from("staff_affiliations").insert({
    user_id: userId,
    hospital_id: input.hospital_id,
    department_id: input.department_id,
    cadre_id: input.cadre_id,
    cadre_grade_id: null, // non-clinical cadres don't use grades
    role_id: input.role_id,
    specialty_id: null,
    employment_type: input.employment_type,
    state: "pending_approval",
  });
  if (affiliationError) {
    logger.error("non-clinical-signup.affiliation.insert_failed", {
      reason: affiliationError.message,
    });
    return {
      errors: {
        _form:
          "Could not record your affiliation. Your account is created — sign in and try adding the affiliation from your profile.",
      },
      values: raw,
    };
  }

  // 6. consent_records + phone on users + state bump.
  // The row is the legal proof (DPPA 2019) — a failed write is logged, never
  // swallowed. `version` is NOT NULL and `accepted_at` is the column's name.
  const { error: consentError } = await service.from("consent_records").insert({
    user_id: userId,
    consent_type: "data_processing",
    version: activeConsent.version,
    consent_text_sha256: activeConsent.bodySha256,
    accepted_at: new Date().toISOString(),
  });
  if (consentError) {
    logger.error("signup.consent.insert_failed", { reason: consentError.message });
  }
  await service
    .from("users")
    .update({ state: "pending_approval", phone: phoneCt })
    .eq("id", userId);

  logger.info("non-clinical-signup.completed", {
    hospital_id: input.hospital_id,
    appointment_letter_uploaded: appointmentLetterPath !== null,
  });

  revalidatePath("/");
  redirect("/onboarding/clinical-pending");
}
