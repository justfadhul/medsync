import * as z from "zod/mini";

import {
  ADULT_AGE,
  ageOn,
  emailDomain,
  isoFromParts,
  isUgMobile,
  NIN_RE,
  normalizeNin,
  normalizeUgPhone,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN,
  passwordBytes,
  UNDER_18,
} from "./fields";
import { professionById, PROFESSIONS } from "./profession";

/**
 * Onboarding v2 schemas — one per form, shared by the page (validate on blur and on submit) and
 * the server action (re-validates, then derives). Flat keys so the error summary can link each
 * message to its field by id. Values stay as typed; the server normalises after parsing.
 *
 * zod/mini, not classic zod: these ship to the phone, and classic zod alone was a 63 kB gz chunk
 * (Law 10). Same rules, functional API.
 */

export { UNDER_18 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const PLACE = /^UG\d{2,8}$/;
const tooLong = (max: number) => `Keep this under ${max} characters.`;

const text = (max: number, required: string) =>
  z.string(required).check(z.trim(), z.minLength(1, required), z.maxLength(max, tooLong(max)));
const optionalText = (max: number) =>
  z.optional(z.string().check(z.trim(), z.maxLength(max, tooLong(max))));
const optionalString = () => z.optional(z.string().check(z.trim()));

export const emailField = z.pipe(
  z
    .string("Enter your email address.")
    .check(z.trim(), z.minLength(1, "Enter your email address.")),
  z.email("Enter an email address like name@example.com."),
);
const isEmail = (v: string) => z.email().safeParse(v).success;

export const passwordField = z.string("Choose a password.").check(
  z.minLength(PASSWORD_MIN, `Use ${PASSWORD_MIN} or more characters. A short sentence works well.`),
  z.refine(
    (p) => passwordBytes(p) <= PASSWORD_MAX_BYTES,
    "That password is too long. Use a shorter one.",
  ),
);

const phoneField = (required: string, mobileOnly: boolean) =>
  z.string(required).check(
    z.trim(),
    z.minLength(1, required),
    z.refine((v) => normalizeUgPhone(v) !== null, "Enter a Ugandan number, like 0772 123 456."),
    z.refine(
      (v) => !mobileOnly || isUgMobile(normalizeUgPhone(v) ?? ""),
      "Enter a mobile number. Ugandan mobile numbers start with 07.",
    ),
  );

const consentFields = {
  consent: z.literal(true, "Tick the box to agree to the data-processing notice."),
  consentVersion: z.string().check(z.minLength(1)),
  consentSha: z.string().check(z.regex(SHA256)),
};

/**
 * Zod skips an object's refinements once any field fails; these cross-field checks must run
 * anyway, so one submit lists every problem (§5.1 error summary). Refinements read fields defensively.
 */
const ALWAYS = { when: () => true } as const;

const pickUuid = (message: string) => z.string(message).check(z.regex(UUID, message));
const placeField = (required: string) => z.string(required).check(z.regex(PLACE, required));

// ── Patient ────────────────────────────────────────────────────────────────

export const patientSchema = z
  .object({
    firstName: text(80, "Enter your first name."),
    surname: text(80, "Enter your surname."),
    sex: z.enum(["male", "female", "intersex", "prefer_not_say"], "Choose your sex at birth."),
    // One message for the three boxes (below), not three.
    dobDay: optionalString(),
    dobMonth: optionalString(),
    dobYear: optionalString(),
    phone: phoneField("Enter your mobile number.", true),
    place: placeField("Choose where you live from the list."),
    village: optionalText(200),
    email: emailField,
    password: passwordField,
    smsConsent: z.optional(z.boolean()),
    smsVersion: z.optional(z.string()),
    smsSha: z.optional(z.string().check(z.regex(SHA256))),
    ...consentFields,
  })
  .check(
    z.superRefine((v, ctx) => {
      const issue = (path: string, message: string) =>
        ctx.addIssue({ code: "custom", path: [path], message });
      if (!v.dobDay || !v.dobMonth || !v.dobYear)
        return issue("dobDay", "Enter your date of birth: day, month and year.");
      const iso = isoFromParts(v.dobDay, v.dobMonth, v.dobYear);
      if (!iso) return issue("dobDay", "That date doesn't exist. Check the day, month and year.");
      const age = ageOn(iso);
      if (age < 0) issue("dobDay", "That date is in the future.");
      else if (age > 120) issue("dobYear", "Check the year.");
      else if (age < ADULT_AGE) issue("dobDay", UNDER_18);
    }, ALWAYS),
  );
export type PatientInput = z.infer<typeof patientSchema>;

// ── Clinical staff ─────────────────────────────────────────────────────────

export const EMPLOYMENT = ["full_time", "visiting", "locum"] as const;
export const documentChoice = z.enum(["file", "later"]);

export const clinicalSchema = z
  .object({
    fullName: text(120, "Enter your full name."),
    email: emailField,
    phone: phoneField("Enter your mobile number.", true),
    password: passwordField,
    profession: z.enum(
      PROFESSIONS.map((p) => p.id) as [string, ...string[]],
      "Choose your profession from the list.",
    ),
    specialty: z.optional(z.string()),
    registrationNumber: text(60, "Enter your registration number."),
    licence: z.optional(documentChoice),
    hospitalId: pickUuid("Choose your hospital from the list."),
    departmentId: pickUuid("Choose your department."),
    employmentType: z.enum(EMPLOYMENT, "Choose your employment type."),
    ...consentFields,
  })
  .check(
    z.superRefine((v, ctx) => {
      const issue = (path: string, message: string) =>
        ctx.addIssue({ code: "custom", path: [path], message });
      if (professionById(v.profession ?? "")?.needsSpecialty && !v.specialty)
        issue("specialty", "Choose your specialty.");
      if (v.specialty && v.specialty !== "unlisted" && !UUID.test(v.specialty))
        issue("specialty", "Choose your specialty from the list.");
      if (!v.licence) issue("licence", "Add your practising licence, or choose “Add it later”.");
    }, ALWAYS),
  );
export type ClinicalInput = z.infer<typeof clinicalSchema>;

// ── Non-clinical staff ─────────────────────────────────────────────────────

export const nonClinicalSchema = z.object({
  fullName: text(120, "Enter your full name."),
  email: emailField,
  phone: phoneField("Enter your mobile number.", true),
  password: passwordField,
  nin: z.string("Enter your National ID number (NIN).").check(
    z.trim(),
    z.minLength(1, "Enter your National ID number (NIN)."),
    z.refine(
      (v) => NIN_RE.test(normalizeNin(v)),
      "Use only the letters and numbers on your card (8 to 16 of them).",
    ),
  ),
  staffNumber: optionalText(60),
  officerName: optionalText(120),
  officerRole: optionalText(120),
  letter: z.optional(documentChoice),
  hospitalId: pickUuid("Choose your hospital from the list."),
  departmentId: pickUuid("Choose your department or unit."),
  employmentType: z.enum(EMPLOYMENT, "Choose your employment type."),
  ...consentFields,
});
export type NonClinicalInput = z.infer<typeof nonClinicalSchema>;

// ── Hospital application ───────────────────────────────────────────────────

export const FACILITY_LEVELS = [
  "hc_ii",
  "hc_iii",
  "hc_iv",
  "general",
  "regional_referral",
  "national_referral",
  "private",
  "other",
] as const;
export const OWNERSHIPS = ["public_moh", "private", "pnfp", "private_clinic"] as const;
export const APPLICANT_ROLES = [
  "med_super",
  "hospital_director",
  "administrator",
  "hod",
  "it",
  "other",
] as const;
export const PRIVATE_LICENSERS = ["umdpc", "unmc", "ahpc"] as const;

/** What proof an ownership needs (DOC-2, §5.7). Government: the registry listing, no document. */
export const needsLicence = (ownership: string | undefined) =>
  ownership !== undefined && ownership !== "public_moh";

export const hospitalSchema = z
  .object({
    facilitySource: z.enum(["registry", "manual"], "Find your facility, or enter it yourself."),
    registryCode: z.optional(z.string()),
    /** Echo of the registry pick — the server re-derives it; the client needs it to show the right proof. */
    ownership: z.optional(z.enum(OWNERSHIPS, "Choose who owns the facility.")),
    correctionNote: optionalText(300),
    facilityName: optionalText(160),
    facilityLevel: z.optional(z.enum(FACILITY_LEVELS)),
    place: z.optional(z.string()),
    bureau: optionalText(80),
    applicantName: text(120, "Enter your full name."),
    applicantRole: z.enum(APPLICANT_ROLES, "Choose your role."),
    email: emailField,
    phone: phoneField("Enter your mobile number.", false),
    password: passwordField,
    licensingBody: z.optional(z.enum(PRIVATE_LICENSERS)),
    licenceNumber: optionalText(120),
    registryOrHmisCode: optionalText(60),
    licence: z.optional(documentChoice),
    officerName: text(120, "Enter the name of the officer who authorised you."),
    officerTitle: z.enum(APPLICANT_ROLES, "Choose their title."),
    officerPhone: optionalString(),
    officerEmail: optionalString(),
    letter: z.optional(documentChoice),
    ...consentFields,
  })
  .check(
    z.superRefine((v, ctx) => {
      const issue = (path: string, message: string) =>
        ctx.addIssue({ code: "custom", path: [path], message });
      if (v.facilitySource === "registry" && !v.registryCode)
        issue("registryCode", "Find your facility on the registry, or enter it yourself.");
      if (v.facilitySource === "manual") {
        if (!v.facilityName) issue("facilityName", "Enter the facility's official name.");
        if (!v.facilityLevel) issue("facilityLevel", "Choose the facility level.");
        if (!v.ownership) issue("ownership", "Choose who owns the facility.");
        if (!v.place || !PLACE.test(v.place))
          issue("place", "Choose where the facility is from the list.");
        if (v.ownership === "pnfp" && !v.bureau) issue("bureau", "Choose the facility's bureau.");
      }
      if (needsLicence(v.ownership)) {
        if (v.ownership !== "pnfp" && !v.licensingBody)
          issue("licensingBody", "Choose the council that issued the licence.");
        if (!v.licenceNumber) issue("licenceNumber", "Enter the licence number.");
        if (!v.licence) issue("licence", "Add the licence, or choose “Add it later”.");
      }
      const officerPhone = v.officerPhone ? normalizeUgPhone(v.officerPhone) : null;
      if (!v.officerPhone && !v.officerEmail)
        issue("officerPhone", "Give the officer's phone number or email — at least one.");
      if (v.officerPhone && !officerPhone)
        issue("officerPhone", "Enter a Ugandan number, like 0772 123 456.");
      if (v.officerEmail && !isEmail(v.officerEmail))
        issue("officerEmail", "Enter an email address like name@example.com.");
      if (officerPhone && officerPhone === normalizeUgPhone(v.phone ?? ""))
        issue("officerPhone", "This must be the officer's number, not yours.");
      if (
        v.officerEmail &&
        v.officerEmail.trim().toLowerCase() === (v.email ?? "").trim().toLowerCase()
      )
        issue("officerEmail", "This must be the officer's email, not yours.");
      if (!v.letter) issue("letter", "Add their signed letter, or choose “Add it later”.");
    }, ALWAYS),
  );
export type HospitalInput = z.infer<typeof hospitalSchema>;

export const institutionalDomain = (workEmail: string) => emailDomain(workEmail);

// ── Leads ("Ask us to call you", "My hospital isn't on MedSync") ───────────

export const leadSchema = z
  .object({
    hospitalName: text(160, "Enter the hospital's name."),
    leadPlace: placeField("Choose the hospital's district from the list."),
    contactName: optionalText(120),
    contactPhone: optionalString(),
    contactEmail: optionalString(),
    source: z.enum(["hospital_door", "clinical_signup"]),
  })
  .check(
    z.superRefine((v, ctx) => {
      const issue = (path: string, message: string) =>
        ctx.addIssue({ code: "custom", path: [path], message });
      if (v.contactPhone && !normalizeUgPhone(v.contactPhone))
        issue("contactPhone", "Enter a Ugandan number, like 0772 123 456.");
      if (v.contactEmail && !isEmail(v.contactEmail))
        issue("contactEmail", "Enter an email address like name@example.com.");
      if (v.source === "hospital_door" && !v.contactPhone && !v.contactEmail)
        issue("contactPhone", "Give a phone number or email so we can reach you.");
    }, ALWAYS),
  );
export type LeadInput = z.infer<typeof leadSchema>;

/** First error message per field, for a result the page can render. */
export function fieldErrors(error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of error.issues) {
    const k = String(i.path[0] ?? "_form");
    out[k] ??= i.message;
  }
  return out;
}
