"use server";

import type { ComboboxItem } from "@/components/forms";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { consentVersions } from "@/db/schema/consent-versions";
import { storeAvatar } from "@/lib/avatars";
import { encrypt } from "@/lib/encryption";
import { assertSignupsOpen } from "@/lib/legal";
import { logger } from "@/lib/logger";
import { listCadreGrades, listCadres, listDepartments, listRoles } from "@/lib/reference-data";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { looseUuid, pickFromList } from "@/lib/zod-helpers";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/* ─── Cascade loaders ──────────────────────────────────────────────────
 *
 * Server Actions are RPC-safe to pass into Client Components as the
 * `loadChildren` prop on CascadingCombobox. Each one validates the
 * incoming uuid so a hostile client can't probe arbitrary FK ids.
 */

export async function loadCadresForCouncilAction(councilId: string): Promise<ComboboxItem[]> {
  if (!UUID_RE.test(councilId)) return [];
  const rows = await listCadres({ councilId });
  return rows.map((c) => ({ value: c.id, label: c.name }));
}

export async function loadCadreGradesForCadreAction(cadreId: string): Promise<ComboboxItem[]> {
  if (!UUID_RE.test(cadreId)) return [];
  const rows = await listCadreGrades({ cadreId });
  return rows.map((g) => ({ value: g.id, label: g.name }));
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
  return rows.map((d) => ({ value: d.id, label: d.name }));
}

/* ─── Submit ──────────────────────────────────────────────────────────── */

/**
 * GATE D — submit the clinical staff signup.
 *
 * The order matters and roughly mirrors GATE C: parse → validate
 * consent hash → create auth user → upload licence to private Storage
 * bucket → INSERT clinician_profiles → INSERT staff_affiliations
 * (state=pending_approval) → INSERT consent_records → bump
 * users.state to `pending_approval` → redirect to a waiting page.
 *
 * State path after this completes: user.state = pending_approval.
 * Approval flow (GATE F Edge Function) transitions to `approved`,
 * after which MFA enrollment is required to reach `active`. No
 * clinical access happens before `active` (kickoff §A.4).
 *
 * Storage bucket: `clinician-licences` (private, GATE G provisions).
 * If the bucket isn't present yet (e.g. local dev with fresh DB),
 * the upload is skipped with a warning rather than blocking signup —
 * the verifier UI will show "licence missing" and the clinician can
 * re-upload from their dashboard.
 */

const PHONE_E164_UG = /^\+2567\d{8}$|^\+256[23489]\d{7,8}$/;

const ClinicalSignupSchema = z.object({
  full_name: z.string().min(1, "Required.").max(120),
  email: z.string().email("Enter a valid email."),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters.")
    .max(72, "Password must be 72 characters or fewer."),
  phone_e164: z.string().regex(PHONE_E164_UG, "Enter a Ugandan phone number."),

  // Professional
  council_id: pickFromList("council"),
  cadre_id: pickFromList("cadre"),
  cadre_grade_id: looseUuid("Pick a cadre grade from the list.").optional(),
  registration_number: z.string().min(1, "Required.").max(60),
  registration_expiry: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.")
    .optional(),

  // Affiliation
  hospital_id: pickFromList("hospital"),
  department_id: pickFromList("department"),
  role_id: pickFromList("role"),
  specialty_id: looseUuid("Pick a specialty from the list.").optional(),
  employment_type: z.enum(["full_time", "visiting", "locum"]),

  // Consent
  data_processing_consent: z.literal("on", {
    message: "Consent is required.",
  }),
  data_processing_consent_version: z.string().min(1),
  data_processing_consent_body_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
});

export type ClinicalSignupErrors = Partial<
  Record<keyof z.infer<typeof ClinicalSignupSchema> | "_form", string>
>;

export type ClinicalSignupState = {
  errors?: ClinicalSignupErrors;
  values?: Record<string, string | undefined>;
};

export async function submitClinicalSignupAction(
  _prev: ClinicalSignupState,
  formData: FormData,
): Promise<ClinicalSignupState> {
  assertSignupsOpen(); // S8 D1: production collects no personal data until the legal basics exist
  // FormData entries include the licence File at `licence_document` —
  // pull it before turning the rest into a string map.
  const licenceFile = formData.get("licence_document");
  const photo = formData.get("photo");
  const rawEntries: Array<[string, string]> = [];
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string") rawEntries.push([k, v]);
  }
  const raw = Object.fromEntries(rawEntries) as Record<string, string>;
  // Strip empty strings so Zod .optional() actually skips unfilled
  // optional UUID / regex fields (cadre_grade_id, registration_expiry, etc.).
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== "") cleaned[k] = v;
  }

  const parsed = ClinicalSignupSchema.safeParse(cleaned);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      errors: Object.fromEntries(
        Object.entries(fieldErrors).map(([k, v]) => [k, v?.[0]]),
      ) as ClinicalSignupErrors,
      values: raw,
    };
  }
  const input = parsed.data;

  // 1. Consent hash cross-check.
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
    logger.warn("clinical-signup.consent.mismatch");
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
    logger.warn("clinical-signup.auth.failed", { reason: signUpError?.message });
    return {
      errors: { _form: signUpError?.message ?? "Couldn't create your account." },
      values: raw,
    };
  }
  const userId = signUpData.user.id;

  // 3. Encrypt phone for the public.users mirror update + upload licence.
  const phoneCt = encrypt(input.phone_e164);
  const service = createServiceClient();

  let licencePath: string | null = null;
  if (licenceFile instanceof File && licenceFile.size > 0) {
    const ext = (licenceFile.name.split(".").pop() ?? "bin").toLowerCase().slice(0, 5);
    const objectKey = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await service.storage
      .from("clinician-licences")
      .upload(objectKey, licenceFile, {
        contentType: licenceFile.type || "application/octet-stream",
        upsert: false,
      });
    if (uploadError) {
      // Bucket missing in local dev is the common case — log and
      // continue so signup isn't blocked. Verifier UI will show
      // "licence missing" and the user can re-upload later.
      logger.warn("clinical-signup.licence.upload_skipped", {
        reason: uploadError.message,
      });
    } else {
      licencePath = objectKey;
    }
  }

  // 4. INSERT clinician_profiles.
  const { error: profileError } = await service.from("clinician_profiles").insert({
    id: userId,
    council_id: input.council_id,
    registration_number: input.registration_number,
    registration_expiry: input.registration_expiry ?? null,
    licence_document_path: licencePath,
  });
  if (profileError) {
    logger.error("clinical-signup.profile.insert_failed", {
      reason: profileError.message,
    });
    await service.auth.admin.deleteUser(userId).catch(() => undefined);
    return {
      errors: { _form: "Could not save your professional profile. Please try again." },
      values: raw,
    };
  }

  // 4b. Photo — optional, never blocks the account (ADR 0085 §1).
  if (photo instanceof File && photo.size > 0) await storeAvatar(userId, photo);

  // 5. INSERT staff_affiliations (pending_approval).
  const { error: affiliationError } = await service.from("staff_affiliations").insert({
    user_id: userId,
    hospital_id: input.hospital_id,
    department_id: input.department_id,
    cadre_id: input.cadre_id,
    cadre_grade_id: input.cadre_grade_id ?? null,
    role_id: input.role_id,
    specialty_id: input.specialty_id ?? null,
    employment_type: input.employment_type,
    state: "pending_approval",
  });
  if (affiliationError) {
    logger.error("clinical-signup.affiliation.insert_failed", {
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

  logger.info("clinical-signup.completed", {
    hospital_id: input.hospital_id,
    licence_uploaded: licencePath !== null,
  });

  revalidatePath("/");
  redirect("/onboarding/clinical-pending");
}
