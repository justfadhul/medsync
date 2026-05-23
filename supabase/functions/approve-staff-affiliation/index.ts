/**
 * approve-staff-affiliation — GATE F.
 *
 * Hospital admin (scoped to the affiliation's hospital) OR superadmin
 * approves a pending staff_affiliations row. The clinician's user.state
 * is bumped from pending_approval → approved if it was still pending
 * (and there's no rejection_reason carried forward).
 *
 * Why service-role for the UPDATE: the staff_affiliations RLS denies
 * UPDATE for authenticated entirely (state transitions are gated to
 * this function). The caller authorisation happens in code above —
 * if you bypass this Edge Function and hit the table directly, you
 * still can't change state.
 *
 * Audit:
 *   - sa_audit_log entry written by recordSaAudit() with action +
 *     before/after diff. Required reason ≥ 8 chars.
 *   - audit_log entry written automatically by the trigger on
 *     staff_affiliations (migration 0003).
 */

import { z } from "https://esm.sh/zod@4.4.3";

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

const log = makeLogger("approve-staff-affiliation");

const InputSchema = z.object({
  affiliation_id: z.string().uuid(),
  reason: z.string().min(8, "Reason ≥ 8 chars required for the approval record."),
});

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
  if (!parsed.success) {
    return badRequest("Invalid input", init, parsed.error.flatten());
  }
  const input = parsed.data;

  const caller = await getCaller(request);
  if (!caller) return unauthorized(init);

  const sb = serviceClient();
  const { data: aff, error: fetchError } = await sb
    .from("staff_affiliations")
    .select("id, user_id, hospital_id, state, approved_at, approved_by, rejection_reason")
    .eq("id", input.affiliation_id)
    .single();
  if (fetchError || !aff) return notFound(init, "affiliation not found");

  if (aff.state !== "pending_approval") {
    return badRequest("affiliation is not pending approval", init);
  }

  const isSuperadmin = await hasRole(caller.id, "superadmin");
  const isHospitalAdmin = !isSuperadmin
    ? await hasRole(caller.id, "hospital_admin", aff.hospital_id)
    : false;
  if (!isSuperadmin && !isHospitalAdmin) return forbidden(init);

  const nowIso = new Date().toISOString();
  const before = { state: aff.state, approved_at: aff.approved_at, approved_by: aff.approved_by };
  const after = { state: "approved", approved_at: nowIso, approved_by: caller.id };

  // Write the audit FIRST so a downstream UPDATE failure can't leave
  // an un-attributed transition in audit_log.
  const { ipAddress, userAgent } = networkContext(request);
  try {
    await recordSaAudit({
      actorId: caller.id,
      action: "approve_staff_affiliation",
      targetKind: "staff_affiliation",
      targetId: aff.id,
      reason: input.reason,
      requestId,
      ipAddress,
      userAgent,
      beforeData: before,
      afterData: after,
    });
  } catch (e) {
    log.error("sa_audit failed; aborting approval", { requestId, reason: String(e) });
    return serverError("audit write failed", init);
  }

  const { error: updateError } = await sb
    .from("staff_affiliations")
    .update({
      state: "approved",
      approved_at: nowIso,
      approved_by: caller.id,
      rejection_reason: null,
    })
    .eq("id", aff.id);
  if (updateError) {
    log.error("affiliation update failed", { requestId, reason: updateError.message });
    return serverError("approval write failed", init);
  }

  // Bump user.state to approved if currently pending — MFA enrollment
  // is the gate to `active` (kickoff §A.4). Best-effort: if the user
  // is at a more-advanced state already (e.g. active because they
  // hold another approved affiliation), don't downgrade.
  const { data: userRow } = await sb.from("users").select("state").eq("id", aff.user_id).single();
  if (userRow?.state === "pending_approval") {
    await sb.from("users").update({ state: "approved" }).eq("id", aff.user_id);
  }

  log.info("affiliation approved", {
    requestId,
    affiliation_id: aff.id,
    hospital_id: aff.hospital_id,
  });
  return ok({ affiliation_id: aff.id, state: "approved" }, init);
});
