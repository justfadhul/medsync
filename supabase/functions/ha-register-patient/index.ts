/**
 * ha-register-patient — the desk registers a walk-in who has no MedSync account (ADR 0475, migration 0291).
 *
 * The record is an ordinary patient: an `auth.users` row with no credential (no password, an undeliverable
 * `@patients.medsync.invalid` address, `app_metadata.desk_registered = true`) and a `patient_profiles` row whose
 * primary facility is this hospital. Every table that names a patient keys on that id, so the walk-in is booked,
 * checked in and seen exactly like an account patient. Nobody can sign in as it.
 *
 * Input: { hospital_id, first_name, surname, sex, date_of_birth, phone_e164, district_id, subcounty_id?, village?,
 *          consent_version, consent_sha, consent_given: true, register_despite?: patient codes }
 *
 * 1. Auth: `getCaller` (with the MFA check), then `authoriseAtHospital`; the SQL functions check again that the
 *    caller is staff at this hospital (a superadmin is refused there — 0289).
 * 2. Duplicate check FIRST: this hospital's patients with the same phone, or the same name and year of birth.
 *    Any match the desk has not already said is someone else comes back as `{ outcome: "matches" }` and nothing is
 *    created. Each name shown is logged (clinical_phi_access_log), fail closed.
 * 3. Create: the auth user, then `desk_register_patient()` — profile, consent recorded by the desk, user state and
 *    the `register_patient` audit row in one transaction. If that fails the auth user is deleted again.
 *
 * Adults only, as at sign-up: a child's record needs a parent or guardian's consent, which is not built.
 *
 * { action: "claim_code", hospital_id, patient_code } instead gives a claim code for a record this hospital registered
 * (migration 0292): the person takes the record over with it at sign-up. Same auth; the SQL refuses another
 * hospital's record, a claimed one and a login account, and audits. Only the code's blind index is stored; the code
 * itself is returned once, for the desk to hand over.
 */

import { z } from "npm:zod@4.4.3";

import { getCaller, serviceClient } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { claimCodeIndexInput, formatClaimCode, newClaimCode } from "../_shared/desk-record.ts";
import { blindIndex, decrypt, encrypt } from "../_shared/encryption.ts";
import {
  badRequest,
  conflict,
  forbidden,
  methodNotAllowed,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "../_shared/errors.ts";
import { authoriseAtHospital } from "../_shared/hospital-admin-scope.ts";
import { deskMatches } from "../_shared/identity-match.ts";
import { makeLogger } from "../_shared/logger.ts";
import { networkContext } from "../_shared/sa-audit.ts";
import { DEFAULT_TIME_ZONE, localDateKey } from "../_shared/slots.ts";

const log = makeLogger("ha-register-patient");

/** DRAFT (owner): the desk's refusal for a child. */
const MINOR_REFUSAL =
  "Registering a child is not available yet. A parent or guardian must consent.";
const ADULT_YEARS = 18;
/** A Ugandan mobile, as sign-up requires (`isUgMobile`). */
const UG_MOBILE = /^[+]2567[0-9]{8}$/;
/** Undeliverable on purpose (RFC 2606): no mail, no magic link, no reset ever reaches it. */
const DESK_EMAIL_DOMAIN = "patients.medsync.invalid";

const InputSchema = z.object({
  hospital_id: z.string().uuid(),
  first_name: z.string().trim().min(1).max(80),
  surname: z.string().trim().min(1).max(80),
  sex: z.enum(["male", "female", "intersex", "prefer_not_say"]),
  date_of_birth: z.string().date(),
  phone_e164: z.string().regex(UG_MOBILE, "Enter a Ugandan mobile number."),
  district_id: z.string().uuid(),
  subcounty_id: z.string().uuid().nullable().optional(),
  village: z.string().trim().max(200).nullable().optional(),
  consent_version: z.string().min(1).max(40),
  consent_sha: z.string().regex(/^[a-f0-9]{64}$/i),
  consent_given: z.literal(true),
  register_despite: z.array(z.string().max(32)).max(20).default([]),
});

const ClaimSchema = z.object({
  action: z.literal("claim_code"),
  hospital_id: z.string().uuid(),
  patient_code: z.string().trim().min(1).max(32),
});

function yearsBetween(dob: string, today: string): number {
  const years = Number(today.slice(0, 4)) - Number(dob.slice(0, 4));
  return today.slice(5) < dob.slice(5) ? years - 1 : years;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const init = { origin, requestId };

  const pre = preflight(request);
  if (pre) return pre;
  if (request.method !== "POST") return methodNotAllowed(init);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Body must be JSON", init);
  }
  const claim = ClaimSchema.safeParse(body);
  if (claim.success) return giveClaimCode(request, claim.data, init);
  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid input", init, parsed.error.flatten());
  const input = parsed.data;

  const age = yearsBetween(input.date_of_birth, localDateKey(new Date(), DEFAULT_TIME_ZONE));
  if (age < 0 || age > 120) return badRequest("Check the date of birth.", init);
  if (age < ADULT_YEARS) return badRequest(MINOR_REFUSAL, init);

  const caller = await getCaller(request);
  if (!caller) return unauthorized(init);
  const authError = await authoriseAtHospital(caller.id, input.hospital_id);
  if (authError) return forbidden(init, authError);

  const key = Deno.env.get("MEDSYNC_PHI_KEY");
  if (!key) return serverError("MEDSYNC_PHI_KEY is not configured for Functions.", init);

  const sb = serviceClient();
  const name = `${input.first_name} ${input.surname}`;
  const phoneHmac = await blindIndex(input.phone_e164, key);

  // ── 2. The duplicate check ──
  const { data: rows, error: candError } = await sb.rpc("desk_patient_candidates", {
    p_hospital_id: input.hospital_id,
    p_actor_id: caller.id,
    p_phone_hmac: phoneHmac,
    p_birth_year: Number(input.date_of_birth.slice(0, 4)),
  });
  if (candError) {
    if (candError.message.includes("not_staff_here"))
      return forbidden(init, "You are not staff at this hospital.");
    log.error("candidates failed", { requestId, reason: candError.message });
    return serverError("Couldn't check for an existing record.", init);
  }
  const matches = (
    await deskMatches(
      { name, phone: input.phone_e164, phoneHmac, dateOfBirth: input.date_of_birth },
      rows ?? [],
      (c) => decrypt(c, key),
    )
  ).filter((m) => !input.register_despite.includes(m.patientCode));

  if (matches.length > 0) {
    // The names are an operational reveal, logged like the desk's other name matches (lib/reception/queries).
    const { error: revealError } = await sb.from("clinical_phi_access_log").insert(
      matches.map((m) => ({
        hospital_id: input.hospital_id,
        clinician_user_id: caller.id,
        patient_user_id: m.patientUserId,
        access_basis: "department_recent",
        request_id: requestId,
        surface: "reception_register_duplicates#operational_today",
      })),
    );
    if (revealError) {
      log.error("reveal audit failed", { requestId, reason: revealError.message });
      return serverError("Couldn't check for an existing record.", init);
    }
    return ok({ outcome: "matches", matches }, init);
  }

  // ── 3. Create ──
  const { data: created, error: userError } = await sb.auth.admin.createUser({
    email: `desk-${crypto.randomUUID()}@${DESK_EMAIL_DOMAIN}`,
    email_confirm: false,
    user_metadata: { full_name: name },
    app_metadata: {
      desk_registered: true,
      desk_hospital_id: input.hospital_id,
      registered_by: caller.id,
    },
  });
  if (userError || !created.user) {
    log.error("auth user create failed", { requestId, reason: userError?.message });
    return serverError("Couldn't create the record. Nothing was kept.", init);
  }
  const userId = created.user.id;

  const { ipAddress, userAgent } = networkContext(request);
  const { data: code, error: regError } = await sb.rpc("desk_register_patient", {
    p_user_id: userId,
    p_hospital_id: input.hospital_id,
    p_actor_id: caller.id,
    p_first_name_encrypted: await encrypt(input.first_name, key),
    p_surname_encrypted: await encrypt(input.surname, key),
    p_sex: input.sex,
    p_date_of_birth: input.date_of_birth,
    p_phone_encrypted: await encrypt(input.phone_e164, key),
    p_phone_hmac: phoneHmac,
    p_district_id: input.district_id,
    p_subcounty_id: input.subcounty_id ?? null,
    p_village_encrypted: input.village ? await encrypt(input.village, key) : null,
    p_consent_version: input.consent_version,
    p_consent_sha: input.consent_sha,
    p_despite_codes: input.register_despite,
    p_request_id: /^[0-9a-f-]{36}$/i.test(requestId) ? requestId : null,
    p_ip: ipAddress,
    p_user_agent: userAgent,
  });
  if (regError || typeof code !== "string") {
    const { error: delError } = await sb.auth.admin.deleteUser(userId);
    if (delError) log.error("orphan desk auth user", { requestId, userId });
    const reason = regError?.message ?? "";
    log.warn("register failed", { requestId, reason });
    if (reason.includes("not_staff_here"))
      return forbidden(init, "You are not staff at this hospital.");
    if (reason.includes("under_18")) return badRequest(MINOR_REFUSAL, init);
    if (reason.includes("consent_mismatch"))
      return conflict("The notice has changed. Close the form and open it again.", init);
    return serverError("Couldn't create the record. Nothing was kept.", init);
  }

  return ok(
    {
      outcome: "registered",
      patient: {
        patientUserId: userId,
        patientCode: code,
        displayName: name,
        sex: input.sex,
        dateOfBirth: input.date_of_birth,
      },
    },
    init,
  );
});

type Init = Parameters<typeof forbidden>[0];

/** DRAFT (owner): the desk's words for each refusal. */
const CLAIM_REFUSALS: Record<string, (init: Init) => Response> = {
  not_staff_here: (init) => forbidden(init, "You are not staff at this hospital."),
  other_hospital: (init) =>
    forbidden(init, "Another hospital registered this patient. Their code comes from there."),
  no_such_patient: (init) => notFound(init, "No patient has that code."),
  already_claimed: (init) =>
    conflict("This patient already took the record over. They sign in with their email.", init),
  has_account: (init) =>
    conflict("This patient has their own account. They sign in; no code is needed.", init),
};

async function giveClaimCode(
  request: Request,
  input: z.infer<typeof ClaimSchema>,
  init: Init,
): Promise<Response> {
  const caller = await getCaller(request);
  if (!caller) return unauthorized(init);
  const authError = await authoriseAtHospital(caller.id, input.hospital_id);
  if (authError) return forbidden(init, authError);

  const key = Deno.env.get("MEDSYNC_PHI_KEY");
  if (!key) return serverError("MEDSYNC_PHI_KEY is not configured for Functions.", init);

  const code = newClaimCode();
  const { ipAddress, userAgent } = networkContext(request);
  const { data: expiresAt, error } = await serviceClient().rpc("desk_issue_claim_code", {
    p_hospital_id: input.hospital_id,
    p_actor_id: caller.id,
    p_patient_code: input.patient_code,
    p_code_hash: await blindIndex(claimCodeIndexInput(code), key),
    p_request_id: /^[0-9a-f-]{36}$/i.test(init.requestId ?? "") ? init.requestId : null,
    p_ip: ipAddress,
    p_user_agent: userAgent,
  });
  if (error) {
    const refusal = Object.keys(CLAIM_REFUSALS).find((k) => error.message.includes(k));
    if (refusal) return CLAIM_REFUSALS[refusal]!(init);
    log.error("claim code failed", { requestId: init.requestId, reason: error.message });
    return serverError("Couldn't give a code. Try again.", init);
  }
  return ok({ code: formatClaimCode(code), expiresAt }, init);
}
