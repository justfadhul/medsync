import { z } from "zod";

import { looseUuid, pickFromList } from "@/lib/zod-helpers";
import {
  ALL_DEPARTMENT_CODES,
  BED_CAPACITY_BANDS,
  CONNECTIVITY_CHOICES,
  DIAGNOSTIC_CHOICES,
  EMR_CHOICES,
  LICENSING_BODY_CHOICES,
  OPD_BANDS,
  POWER_CHOICES,
  SERVICE_OFFERED_CHOICES,
  SPECIALISED_CLINIC_CHOICES,
  STAFF_BANDS,
  SUPPORT_SERVICE_CHOICES,
} from "./catalog";

/**
 * The hospital application's rules, shared by the server action (the whole
 * form on submit) and the form itself (one step at a time, on Continue).
 */
export const UUID_RE = /^[0-9a-f-]{36}$/i;
export const PHONE_E164_UG = /^\+2567\d{8}$|^\+256[23489]\d{7,8}$/;
const EMAIL_DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
const YEAR_NOW = new Date().getFullYear();

const departmentCodes = ALL_DEPARTMENT_CODES;
const clinicCodes = SPECIALISED_CLINIC_CHOICES.map((c) => c.code);
const diagnosticCodes = DIAGNOSTIC_CHOICES.map((c) => c.code);
const supportCodes = SUPPORT_SERVICE_CHOICES.map((c) => c.code);
const serviceCodes = SERVICE_OFFERED_CHOICES.map((c) => c.code);
const bedBands = BED_CAPACITY_BANDS.map((c) => c.code);
const staffBands = STAFF_BANDS.map((c) => c.code);
const opdBands = OPD_BANDS.map((c) => c.code);
const connectivityCodes = CONNECTIVITY_CHOICES.map((c) => c.code);
const powerCodes = POWER_CHOICES.map((c) => c.code);
const emrCodes = EMR_CHOICES.map((c) => c.code);
const licensingCodes = LICENSING_BODY_CHOICES.map((c) => c.code);

/** Parse repeated FormData fields (multi-select / multi-checkbox). */
function getAll(formData: FormData, key: string): string[] {
  return formData.getAll(key).filter((v): v is string => typeof v === "string" && v.length > 0);
}

function subsetCheck<T extends string>(allowed: ReadonlyArray<T>, field: string) {
  const allowedSet = new Set<string>(allowed);
  return z.array(z.string()).refine((arr) => arr.every((v) => allowedSet.has(v)), {
    message: `Invalid ${field} selection.`,
  });
}

export const HospitalApplicationSchema = z.object({
  /* ─── Section B — Institution profile ─────────────────────────── */
  hospital_name: z.string().min(1, "Required.").max(160),
  hospital_aka: z.string().max(160).optional(),
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
  year_established: z.coerce
    .number()
    .int()
    .min(1900)
    .max(YEAR_NOW, `Year cannot be in the future.`)
    .optional(),
  region_id: looseUuid("Pick a region from the list.").optional(),
  district_id: pickFromList("district"),
  subcounty_id: looseUuid("Pick a subcounty from the list.").optional(),
  physical_address: z.string().min(1, "Required.").max(400),
  main_phone: z.string().regex(PHONE_E164_UG, "Enter a Ugandan phone number."),
  official_email: z.string().email(),
  website: z.string().url().max(300).optional(),

  /* ─── Section C — Departments ─────────────────────────────────── */
  departments: subsetCheck(departmentCodes, "department").refine((arr) => arr.length >= 1, {
    message: "Pick at least one department.",
  }),
  /** UUIDs from `specialties` table — IM sub-specialties (kickoff §C nested list). */
  im_subspecialties: z.array(z.string().regex(UUID_RE)).optional(),
  /** Free-text "other department" entries — capped at 5. */
  departments_other: z.array(z.string().min(1).max(120)).max(5).optional(),
  /** Must be one of the codes in `departments`. Enforced post-parse. */
  primary_department: z.string().min(1, "Pick a primary department."),

  /* ─── Section D — Clinical & operating profile ────────────────── */
  specialised_clinics: subsetCheck(clinicCodes, "clinic").optional(),
  specialised_clinics_other: z.array(z.string().min(1).max(120)).max(5).optional(),
  diagnostic_services: subsetCheck(diagnosticCodes, "diagnostic").optional(),
  support_services: subsetCheck(supportCodes, "support service").optional(),
  has_onsite_pharmacy: z.enum(["yes", "no"], { message: "Required." }),
  services_offered: subsetCheck(serviceCodes, "service offered").optional(),
  bed_capacity_band: z.enum(bedBands as [string, ...string[]]).optional(),
  clinical_staff_band: z.enum(staffBands as [string, ...string[]]).optional(),
  daily_opd_band: z.enum(opdBands as [string, ...string[]]).optional(),
  internet_connectivity: z.enum(connectivityCodes as [string, ...string[]], {
    message: "Required.",
  }),
  power_backup: z.enum(powerCodes as [string, ...string[]]).optional(),
  existing_emr: z.enum(emrCodes as [string, ...string[]]).optional(),
  existing_emr_name: z.string().max(160).optional(),

  /* ─── Section E6 — Verification & authority ───────────────────── */
  registration_number: z.string().min(1, "Required.").max(120),
  registration_authority: z.string().max(160).optional(),
  licensing_body: z.enum(licensingCodes as [string, ...string[]], { message: "Required." }),
  institutional_email_domain: z
    .string()
    .regex(EMAIL_DOMAIN_RE, "Enter a domain like mulago.go.ug."),

  applicant_full_name: z.string().min(1, "Required.").max(120),
  applicant_role: z.string().min(1, "Required.").max(80),
  applicant_work_email: z.string().email("Enter a valid email."),
  applicant_phone: z.string().regex(PHONE_E164_UG, "Enter a Ugandan phone number."),
  applicant_council_number: z.string().max(80).optional(),

  authority_officer_name: z.string().min(1, "Required.").max(120),
  authority_officer_title: z.string().min(1, "Required.").max(80),
  callback_contact_value: z.string().min(1, "Required.").max(200),
  callback_contact_kind: z.enum(["phone", "email"], { message: "Required." }),

  /* ─── Section E7 — Agreement + account ─────────────────────────── */
  signatory_name: z.string().min(1, "Required.").max(120),
  signatory_title: z.string().min(1, "Required.").max(80),
  authorised_to_bind: z.literal("on", { message: "You must confirm authority." }),
  accept_agreement: z.literal("on", { message: "Acceptance is required." }),
  agreement_version_id: z.string().regex(UUID_RE, "Reload the page."),
  agreement_body_sha256: z.string().regex(/^[a-f0-9]{64}$/i),

  applicant_password: z
    .string()
    .min(12, "Password must be at least 12 characters.")
    .max(72, "Password must be 72 characters or fewer."),

  /* ─── Patient-style data-processing consent (applicant's own data) ─── */
  data_processing_consent: z.literal("on", { message: "Consent is required." }),
  data_processing_consent_version: z.string().min(1),
  data_processing_consent_body_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
});

export type HospitalApplicationErrors = Partial<
  Record<keyof z.infer<typeof HospitalApplicationSchema> | "_form", string>
>;
/** FormData → the shape the schema parses: arrays for multi-selects, empty optional scalars dropped. */
export function hospitalApplicationPayload(formData: FormData) {
  // Mixed-shape raw payload: arrays for multi-selects, strings for scalars.
  const raw: Record<string, string | string[]> = {};
  for (const [k] of formData.entries()) {
    if (raw[k] !== undefined) continue; // already collected
    const all = getAll(formData, k);
    if (all.length === 0) continue;
    const first = all[0];
    if (all.length === 1 && first !== undefined) raw[k] = first;
    else raw[k] = all;
  }
  // Convert known multi-select keys to arrays even when only one option ticked.
  for (const key of [
    "departments",
    "im_subspecialties",
    "departments_other",
    "specialised_clinics",
    "specialised_clinics_other",
    "diagnostic_services",
    "support_services",
    "services_offered",
  ]) {
    raw[key] = getAll(formData, key);
  }

  // Drop empty optional scalars before Zod sees them.
  const cleaned: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) cleaned[k] = v;
    else if (v !== "") cleaned[k] = v;
  }
  return { raw, cleaned };
}
