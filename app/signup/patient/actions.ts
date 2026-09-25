"use server";

import type { ComboboxItem } from "@/components/forms";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { consentVersions } from "@/db/schema/consent-versions";
import { signupDrafts } from "@/db/schema/signup-drafts";
import { storeAvatar } from "@/lib/avatars";
import { blindIndex, encrypt } from "@/lib/encryption";
import { assertSignupsOpen } from "@/lib/legal";
import { logger } from "@/lib/logger";
import { fetchSmsConsentVersion, setSmsConsent } from "@/lib/notifications/consent";
import { listSubcounties } from "@/lib/reference-data";
import { clearDraft } from "@/lib/signup-drafts";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { looseUuid, pickFromList } from "@/lib/zod-helpers";

/**
 * Server-Action loader for the district → subcounty cascade. Returns a
 * shape the CascadingCombobox can consume directly. Living in this
 * "use server" file so it's RPC-safe to pass into a Client Component
 * as the `loadChildren` prop.
 */
export async function loadSubcountiesForDistrictAction(
  districtId: string,
): Promise<ComboboxItem[]> {
  if (!/^[0-9a-f-]{36}$/i.test(districtId)) return [];
  const rows = await listSubcounties({ districtId });
  return rows.map((s) => ({ value: s.id, label: s.name }));
}

/**
 * GATE C — submit the patient signup form.
 *
 * Order is load-bearing:
 *   1. Zod parse — never trust raw FormData.
 *   2. Look up the active consent_versions row for 'data_processing'
 *      and verify its body_sha256 matches what the user saw. If the
 *      hash drifted (we shipped a new version while their tab was
 *      open) the acceptance can't be attributed → re-render the
 *      form so they see + accept the current text.
 *   3. Create the auth user (Supabase Auth) → public.users mirrored
 *      by the migration-0004 trigger.
 *   4. Encrypt PHI columns BEFORE the INSERT (per kickoff §A.6).
 *   5. INSERT patient_profiles with the new user's auth id (RLS
 *      allows own-insert; the row inherits the DB-issued patient_code).
 *   6. INSERT consent_records.
 *   7. Bump users.state → 'verified' (post-OTP equivalent for now;
 *      real SMS hookup is a follow-up, see comment below).
 *   8. Clear the signup_drafts row.
 *   9. Redirect to the dashboard.
 *
 * Phone OTP: this build skips the SMS round-trip and goes directly
 * to 'verified'. The OTP UI primitive is in place; wiring it to a
 * real SMS provider (Twilio / Africa's Talking) is a GATE G+
 * production task. For now, server-side proof-of-phone = signup
 * completion. Flagged in CLAUDE.md and tracked.
 *
 * Errors return as a structured state (field-keyed messages). The
 * `_form` slot carries top-level failures (Supabase auth, consent
 * mismatch, etc.). Use `useActionState` on the client to render.
 */

const PHONE_E164_UG = /^\+2567\d{8}$|^\+256[23489]\d{7,8}$/;

const PatientSignupSchema = z.object({
  // Identity
  title_code: z.enum(["mr", "ms", "mrs", "dr", "other"]).optional(),
  first_name: z.string().min(1, "Required.").max(80),
  surname: z.string().min(1, "Required.").max(80),
  sex: z.enum(["male", "female", "intersex", "prefer_not_say"]),
  date_of_birth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.")
    .refine((d) => new Date(d).getTime() < Date.now(), "Date can't be in the future."),
  id_type: z.enum(["nin", "passport", "none"]),
  id_number: z.string().max(40).optional(),
  phone_e164: z.string().regex(PHONE_E164_UG, "Enter a Ugandan phone number."),

  // Geography
  district_id: pickFromList("district"),
  subcounty_id: looseUuid("Pick a subcounty from the list.").optional(),
  village_address: z.string().max(200).optional(),
  preferred_language: z.string().max(60).optional(),

  primary_facility_id: looseUuid("Pick a facility from the list.").optional(),

  // Next-of-kin (optional in this build; the form may collect later)
  nok_name: z.string().max(120).optional(),
  nok_relationship: z
    .enum(["spouse", "parent", "child", "sibling", "guardian", "friend", "other"])
    .optional(),
  nok_phone_e164: z.string().regex(PHONE_E164_UG).optional(),

  // Account
  email: z.string().email("Enter a valid email."),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters.")
    .max(72, "Password must be 72 characters or fewer."),
  full_name: z.string().min(1, "Required.").max(120),

  // Consent (cross-validated below)
  data_processing_consent: z.literal("on", {
    message: "Consent is required to create an account.",
  }),
  data_processing_consent_version: z.string().min(1),
  data_processing_consent_body_sha256: z.string().regex(/^[a-f0-9]{64}$/i),

  // Gate E (ADR 0090): SMS about bookings — optional, separately declinable.
  sms_communication_consent: z.literal("on").optional(),
  sms_communication_consent_version: z.string().min(1).optional(),
  sms_communication_consent_body_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
});

export type PatientSignupErrors = Partial<
  Record<keyof z.infer<typeof PatientSignupSchema> | "_form", string>
>;

export type PatientSignupState = {
  errors?: PatientSignupErrors;
  values?: Record<string, string | undefined>;
};

export async function submitPatientSignupAction(
  _prev: PatientSignupState,
  formData: FormData,
): Promise<PatientSignupState> {
  assertSignupsOpen(); // S8 D1: production collects no personal data until the legal basics exist
  // The optional photo rides FormData as a File under `photo` — it is
  // not part of the Zod object and must not be echoed back in `values`.
  const photo = formData.get("photo");
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string") raw[k] = v;
  }
  // Strip empty strings so Zod .optional() actually skips unfilled
  // optional UUID / regex fields (subcounty, primary_facility, NOK, etc.).
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== "") cleaned[k] = v;
  }
  const parsed = PatientSignupSchema.safeParse(cleaned);

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      errors: Object.fromEntries(
        Object.entries(fieldErrors).map(([k, v]) => [k, v?.[0]]),
      ) as PatientSignupErrors,
      values: raw,
    };
  }

  const input = parsed.data;

  // Cross-field check: id_number required iff id_type ≠ 'none'.
  if (input.id_type !== "none" && !input.id_number) {
    return {
      errors: { id_number: "Required for the ID type selected." },
      values: raw,
    };
  }

  // 1. Validate consent hash against the live consent_versions row.
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

  if (!activeConsent) {
    logger.warn("patient-signup.consent.unknown_version", {
      version: input.data_processing_consent_version,
    });
    return {
      errors: {
        _form:
          "The consent text has been updated. Please reload the page, re-read, and accept the new version.",
      },
      values: raw,
    };
  }

  if (
    activeConsent.bodySha256.toLowerCase() !==
    input.data_processing_consent_body_sha256.toLowerCase()
  ) {
    logger.warn("patient-signup.consent.hash_mismatch", {
      version: input.data_processing_consent_version,
    });
    return {
      errors: {
        _form:
          "The consent text on this page is out of date. Please reload to see the current version and accept again.",
      },
      values: raw,
    };
  }

  // 2. Create the auth user. Supabase Auth handles password hashing;
  //    the migration-0004 trigger mirrors into public.users.
  const supabase = await createClient();
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: input.email.toLowerCase(),
    password: input.password,
    options: { data: { full_name: input.full_name } },
  });

  if (signUpError || !signUpData.user) {
    logger.warn("patient-signup.auth.failed", { reason: signUpError?.message });
    return {
      errors: { _form: signUpError?.message ?? "Couldn't create your account." },
      values: raw,
    };
  }

  const userId = signUpData.user.id;

  // 3. Encrypt PHI columns. Per §A.6 this happens BEFORE the DB write.
  const firstNameCt = encrypt(input.first_name);
  const surnameCt = encrypt(input.surname);
  const phoneCt = encrypt(input.phone_e164);
  const idNumberCt = input.id_number ? encrypt(input.id_number) : null;
  const villageAddressCt = input.village_address ? encrypt(input.village_address) : null;
  const nokNameCt = input.nok_name ? encrypt(input.nok_name) : null;
  const nokPhoneCt = input.nok_phone_e164 ? encrypt(input.nok_phone_e164) : null;

  // 4. INSERT patient_profiles using the service-role client. The
  //    user has no session yet (signUp returned but they're not
  //    "logged in" until they click the confirmation link / first
  //    sign in). RLS would block their own insert; we attribute the
  //    write via auth.users(id) FK + the audit trigger logs actor=null
  //    (service-role) with the row's user id captured in the diff.
  const service = createServiceClient();
  const { error: profileError } = await service.from("patient_profiles").insert({
    id: userId,
    title_code: input.title_code ?? null,
    first_name_encrypted: firstNameCt,
    surname_encrypted: surnameCt,
    sex: input.sex,
    date_of_birth: input.date_of_birth,
    id_type: input.id_type,
    id_number_encrypted: idNumberCt,
    phone_encrypted: phoneCt,
    // Gate F (0062): the blind index USSD/SMS look this phone up by.
    phone_hmac: blindIndex(input.phone_e164),
    district_id: input.district_id,
    subcounty_id: input.subcounty_id ?? null,
    village_address_encrypted: villageAddressCt,
    preferred_language: input.preferred_language ?? null,
    primary_facility_id: input.primary_facility_id ?? null,
    nok_name_encrypted: nokNameCt,
    nok_relationship: input.nok_relationship ?? null,
    nok_phone_encrypted: nokPhoneCt,
  });

  if (profileError) {
    logger.error("patient-signup.profile.insert_failed", {
      reason: profileError.message,
    });
    // Best-effort: tear down the auth user so they can retry without
    // a stranded account. Idempotent — if the user is already gone
    // the delete is a no-op.
    await service.auth.admin.deleteUser(userId).catch(() => undefined);
    return {
      errors: { _form: "Could not save your profile. Please try again." },
      values: raw,
    };
  }

  // 4b. Photo — optional, never blocks the account (ADR 0085 §1).
  if (photo instanceof File && photo.size > 0) await storeAvatar(userId, photo);

  // 5. consent_records — record exactly which text was accepted.
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

  // 5b. SMS consent, only when ticked, only against the live text — a stale
  //     hash means the page showed words that are no longer the version, so
  //     nothing is recorded (the patient can turn it on in Settings).
  if (input.sms_communication_consent === "on" && input.sms_communication_consent_version) {
    const sms = await fetchSmsConsentVersion();
    if (
      sms &&
      sms.version === input.sms_communication_consent_version &&
      sms.bodySha256.toLowerCase() ===
        (input.sms_communication_consent_body_sha256 ?? "").toLowerCase()
    ) {
      await setSmsConsent(userId, true, sms).catch((e: unknown) =>
        logger.error("signup.sms_consent.insert_failed", { reason: String(e) }),
      );
    } else {
      logger.warn("patient-signup.sms_consent.stale_version", {});
    }
  }

  // 6. Bump lifecycle: 'unverified' → 'verified'. Real OTP wiring is
  //    a follow-up; today the signup completing IS the verification
  //    signal. Tracked in docs/onboarding-schema-proposal.md.
  await service.from("users").update({ state: "verified" }).eq("id", userId);

  // 7. Clear any in-flight draft for this email so re-signups start
  //    fresh. Best-effort — failure here doesn't block the user.
  await clearDraft({ kind: "patient", ownerKey: input.email.toLowerCase() }).catch(() => undefined);
  // Also clear any drafts keyed by the new uid in case the user
  // mid-flowed across an account boundary.
  await db
    .delete(signupDrafts)
    .where(eq(signupDrafts.ownerKey, userId))
    .catch(() => undefined);

  logger.info("patient-signup.completed", {
    patient_code_issued: true,
  });

  revalidatePath("/");
  redirect("/?welcomed=patient");
}
