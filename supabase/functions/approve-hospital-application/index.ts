/**
 * approve-hospital-application — extended for the hospital-registration-upgrade.
 *
 * Superadmin-only. On success:
 *   1. Creates the public.hospitals row in state='provisioning' (NOT
 *      'active' — the setup wizard owns the transition to active per
 *      ADR 0018, gated by the agreement EXISTS check in
 *      sa-activate-hospital).
 *   2. Writes the public.hospital_agreements row from the application's
 *      §E7 metadata (signatory_name, signatory_title,
 *      agreement_accepted_version, agreement_accepted_at). This is
 *      the applicant_flow path of the agreement gate (ADR 0017).
 *   3. Updates the application: state='agreement_signed' (no longer
 *      'approved'), approved_hospital_id, reviewed_by/at.
 *   4. Grants the applicant a `hospital_admin` user_role scoped to
 *      the new hospital + a primary row in hospital_admin_roster.
 *   5. Bumps users.state pending_approval → approved for the applicant.
 *
 * Idempotency: a partial failure mid-chain leaves audit_log + sa_audit
 * entries pinpointing exactly what happened for manual remediation.
 * Hospital row is rolled back on application-update failure to avoid
 * orphan facilities.
 *
 * Pre-conditions enforced on the application row:
 *   - state ∈ { pending_approval, under_review }
 *   - agreement_accepted_version IS NOT NULL (E7 toggle was completed)
 *   - signatory_name + signatory_title present
 *
 * Without those the function returns 400 — the applicant flow MUST
 * have captured the agreement metadata at submission time (GATE B).
 *
 * Onboarding v2 (D7, ADR 0125) — Verify → sign → Approve & provision:
 *   - An application with no agreement yet is VERIFIED, not provisioned:
 *     documents_complete must hold (DOC-2), state → 'verified', audited
 *     as verify_hospital_application. The applicant then signs the DPA on
 *     the pending page.
 *   - A 'verified' application with a signed agreement provisions exactly
 *     as below. v1 applications (agreement captured at submission) keep
 *     the one-step path.
 *   - Provisioning also copies the application's district and region
 *     names onto hospitals.district / hospitals.region (emergency
 *     contacts match on hospitals.district).
 */

import { z } from "npm:zod@4.4.3";

import { getCaller, hasRole, serviceClient } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import {
  badRequest,
  forbidden,
  methodNotAllowed,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "../_shared/errors.ts";
import { makeLogger } from "../_shared/logger.ts";
import { networkContext, recordSaAudit } from "../_shared/sa-audit.ts";

const log = makeLogger("approve-hospital-application");

const InputSchema = z.object({
  application_id: z.string().uuid(),
  reason: z.string().min(8, "Reason ≥ 8 chars required for the approval record."),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Map a department_family code → human label. Mirror of
 * app/signup/hospital/_catalog.ts (see migration 0026 for the SQL
 * mirror used in the historical backfill). Update all three when the
 * catalog grows. Codes not in the map fall back to a humanise() pass.
 */
const DEPARTMENT_LABELS: Record<string, string> = {
  INTERNAL_MEDICINE: "Internal Medicine",
  FAMILY_MEDICINE: "Family Medicine",
  GENERAL_SURGERY: "General Surgery",
  ORTHOPAEDICS: "Orthopaedics",
  UROLOGY: "Urology",
  NEUROSURGERY: "Neurosurgery",
  CARDIOTHORACIC: "Cardiothoracic",
  PAEDIATRIC_SURGERY: "Paediatric Surgery",
  PLASTIC_RECONSTRUCTIVE: "Plastic / Reconstructive",
  ENT: "ENT",
  MAXILLOFACIAL: "Maxillofacial",
  OBSTETRICS_GYNAECOLOGY: "Obstetrics & Gynaecology",
  PAEDIATRICS_CHILD_HEALTH: "Paediatrics & Child Health",
  NEONATOLOGY: "Neonatology",
  EMERGENCY: "Emergency / Casualty",
  ANAESTHESIA: "Anaesthesia",
  INTENSIVE_CARE: "Intensive Care (ICU/HDU)",
  PSYCHIATRY: "Psychiatry / Mental Health",
  PHYSIOTHERAPY_REHAB: "Physiotherapy & Rehabilitation",
  PALLIATIVE_CARE: "Palliative Care",
  DENTAL_ORAL: "Dental / Oral Health",
  PUBLIC_HEALTH: "Public / Community Health",
  OPHTHALMOLOGY: "Ophthalmology",
};

function departmentLabel(code: string): string {
  return (
    DEPARTMENT_LABELS[code] ??
    code
      .toLowerCase()
      .split("_")
      .map((p) => (p.length > 0 ? p[0]!.toUpperCase() + p.slice(1) : p))
      .join(" ")
  );
}

function departmentSlug(code: string): string {
  return code.toLowerCase().replace(/_/g, "-");
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
  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid input", init, parsed.error.flatten());
  const input = parsed.data;

  const caller = await getCaller(request);
  if (!caller) return unauthorized(init);
  if (!(await hasRole(caller.id, "superadmin"))) return forbidden(init, "superadmin required");

  const sb = serviceClient();
  const { data: app, error: fetchError } = await sb
    .from("hospital_applications")
    .select(
      "id, applicant_user_id, hospital_name, facility_level, district_id, state, " +
        "approved_hospital_id, signatory_name, signatory_title, " +
        "agreement_accepted_version, agreement_accepted_at, documents_complete",
    )
    .eq("id", input.application_id)
    .single();
  if (fetchError || !app) return notFound(init, "application not found");

  const ALLOWED_STARTING_STATES = new Set(["pending_approval", "under_review", "verified"]);
  if (!ALLOWED_STARTING_STATES.has(app.state)) {
    return badRequest(
      `Application is in state '${app.state}'; must be pending_approval, under_review or verified.`,
      init,
    );
  }

  // ── VERIFY (v2, D7): no agreement yet → check documents, mark verified, don't provision ──
  if (!app.agreement_accepted_version) {
    if (app.state === "verified") {
      return badRequest("Waiting for the applicant to sign the agreement.", init);
    }
    if (!app.documents_complete) return badRequest("Documents outstanding", init);
    const { ipAddress, userAgent } = networkContext(request);
    try {
      await recordSaAudit({
        actorId: caller.id,
        action: "verify_hospital_application",
        targetKind: "hospital_application",
        targetId: app.id,
        reason: input.reason,
        requestId,
        ipAddress,
        userAgent,
        beforeData: { state: app.state },
        afterData: { state: "verified" },
      });
    } catch (e) {
      log.error("sa_audit failed; aborting verification", { requestId, reason: String(e) });
      return serverError("audit write failed", init);
    }
    const { error: verifyError } = await sb
      .from("hospital_applications")
      .update({
        state: "verified",
        reviewed_by: caller.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", app.id)
      .eq("state", app.state);
    if (verifyError) {
      log.error("application verify failed", { requestId, reason: verifyError.message });
      return serverError("verification write failed", init);
    }
    log.info("application verified; waiting for the agreement", {
      requestId,
      application_id: app.id,
    });
    return ok({ application_id: app.id, state: "verified" }, init);
  }

  if (!app.signatory_name || !app.signatory_title) {
    return badRequest(
      "Application is missing agreement metadata (§E7). Cannot approve until the applicant " +
        "completes the agreement step.",
      init,
    );
  }

  // Reserve a unique slug for the new hospital.
  const baseSlug = slugify(app.hospital_name) || "hospital";
  let slug = baseSlug;
  let attempt = 0;
  while (attempt < 10) {
    const { data: existing } = await sb
      .from("hospitals")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!existing) break;
    attempt += 1;
    slug = `${baseSlug}-${attempt + 1}`;
  }
  if (attempt >= 10) {
    return serverError("could not allocate a unique slug; pick a different hospital name", init);
  }

  // Audit FIRST so failure here aborts the chain.
  const { ipAddress, userAgent } = networkContext(request);
  try {
    await recordSaAudit({
      actorId: caller.id,
      action: "approve_hospital_application",
      targetKind: "hospital_application",
      targetId: app.id,
      reason: input.reason,
      requestId,
      ipAddress,
      userAgent,
      beforeData: { state: app.state, approved_hospital_id: app.approved_hospital_id },
      afterData: { state: "agreement_signed", new_hospital_slug: slug },
    });
  } catch (e) {
    log.error("sa_audit failed; aborting approval", { requestId, reason: String(e) });
    return serverError("audit write failed", init);
  }

  // 1. Create the hospital row in `provisioning`. The kickoff state
  //    machine puts the hospital here until the setup wizard + agreement
  //    gate complete, and only then sa-activate-hospital transitions it
  //    to `active`.
  const levelMap: Record<string, string> = {
    hc_ii: "hc3",
    hc_iii: "hc3",
    hc_iv: "hc4",
    general: "district",
    regional_referral: "regional",
    national_referral: "national_referral",
    private: "private",
    other: "private",
  };
  // The district and region by name — emergency contacts match on hospitals.district, which was
  // NULL for every onboarded hospital. A failed lookup leaves them NULL, as before.
  const { data: districtRow } = await sb
    .from("districts")
    .select("name, region_id")
    .eq("id", app.district_id)
    .maybeSingle();
  const { data: regionRow } = districtRow
    ? await sb.from("regions").select("name").eq("id", districtRow.region_id).maybeSingle()
    : { data: null };
  if (!districtRow) log.warn("district lookup failed (continuing)", { requestId });

  const { data: hospitalRow, error: hospitalError } = await sb
    .from("hospitals")
    .insert({
      name: app.hospital_name,
      slug,
      level: levelMap[app.facility_level] ?? "private",
      state: "provisioning",
      district: districtRow?.name ?? null,
      region: regionRow?.name ?? null,
    })
    .select("id")
    .single();
  if (hospitalError || !hospitalRow) {
    log.error("hospital insert failed", { requestId, reason: hospitalError?.message });
    return serverError("hospital create failed", init);
  }

  // 2. Write the hospital_agreements row from the application's §E7
  //    metadata. This is the applicant_flow side of the agreement gate
  //    (ADR 0017). Failing here rolls back the hospital row so we
  //    don't leave a tenant without legal basis.
  const { error: agreementError } = await sb.from("hospital_agreements").insert({
    hospital_id: hospitalRow.id,
    dpa_version_id: app.agreement_accepted_version,
    signed_at: app.agreement_accepted_at ?? new Date().toISOString(),
    signed_by_user_id: app.applicant_user_id,
    signatory_name: app.signatory_name,
    signatory_title: app.signatory_title,
    source: "applicant_flow",
  });
  if (agreementError) {
    log.error("agreement insert failed; rolled back hospital", {
      requestId,
      reason: agreementError.message,
    });
    await sb.from("hospitals").delete().eq("id", hospitalRow.id);
    return serverError("agreement insert failed", init);
  }

  // 2b. Materialise hospital_departments from the application's
  //     department picks. Without this, clinicians can't pick a
  //     department for this hospital at /signup/clinical (the dropdown
  //     reads from hospital_departments, not the application junction).
  //     Failure is logged but doesn't roll back — the agreement is
  //     legally load-bearing; departments are operational and can be
  //     added later via the admin setup wizard.
  const { data: deptPicks, error: deptPicksError } = await sb
    .from("hospital_application_departments")
    .select("department_family")
    .eq("application_id", app.id);
  if (deptPicksError) {
    log.warn("could not fetch department picks (continuing)", {
      requestId,
      reason: deptPicksError.message,
    });
  } else if (deptPicks && deptPicks.length > 0) {
    const deptRows = deptPicks.map((d: { department_family: string }) => ({
      hospital_id: hospitalRow.id,
      parent_id: null,
      name: departmentLabel(d.department_family),
      slug: departmentSlug(d.department_family),
    }));
    const { error: deptInsertError } = await sb.from("hospital_departments").insert(deptRows);
    if (deptInsertError) {
      log.warn("hospital_departments insert failed (continuing)", {
        requestId,
        reason: deptInsertError.message,
        count: deptRows.length,
      });
    } else {
      log.info("hospital_departments materialised", { requestId, count: deptRows.length });
    }
  }

  // 3. Update the application row.
  const { error: appUpdateError } = await sb
    .from("hospital_applications")
    .update({
      state: "agreement_signed",
      approved_hospital_id: hospitalRow.id,
      reviewed_by: caller.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", app.id);
  if (appUpdateError) {
    // Best-effort rollback of hospital + agreement rows. Audit row stays.
    await sb.from("hospital_agreements").delete().eq("hospital_id", hospitalRow.id);
    await sb.from("hospitals").delete().eq("id", hospitalRow.id);
    log.error("application update failed; rolled back hospital + agreement", {
      requestId,
      reason: appUpdateError.message,
    });
    return serverError("application update failed", init);
  }

  // 4. Grant the applicant hospital_admin + record in roster.
  const { error: roleError } = await sb.from("user_roles").insert({
    user_id: app.applicant_user_id,
    role: "hospital_admin",
    hospital_id: hospitalRow.id,
    created_by: caller.id,
  });
  if (roleError && roleError.code !== "23505" /* unique violation = role already held */) {
    log.error("user_role insert failed (continuing)", { requestId, reason: roleError.message });
  }

  const { error: rosterError } = await sb.from("hospital_admin_roster").insert({
    hospital_id: hospitalRow.id,
    user_id: app.applicant_user_id,
    designation: "primary",
    designated_by: caller.id,
  });
  if (rosterError && rosterError.code !== "23505") {
    log.warn("admin_roster insert failed (continuing)", {
      requestId,
      reason: rosterError.message,
    });
  }

  // 5. Bump user.state.
  const { data: userRow } = await sb
    .from("users")
    .select("state")
    .eq("id", app.applicant_user_id)
    .single();
  if (userRow?.state === "pending_approval") {
    await sb.from("users").update({ state: "approved" }).eq("id", app.applicant_user_id);
  }

  log.info("application approved + agreement recorded; hospital in provisioning", {
    requestId,
    application_id: app.id,
    hospital_id: hospitalRow.id,
  });
  return ok(
    {
      application_id: app.id,
      hospital_id: hospitalRow.id,
      hospital_slug: slug,
      hospital_state: "provisioning",
      application_state: "agreement_signed",
    },
    init,
  );
});
