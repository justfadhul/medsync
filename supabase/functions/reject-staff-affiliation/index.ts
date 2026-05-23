/**
 * reject-staff-affiliation — GATE F.
 *
 * Inverse of approve-staff-affiliation. Hospital_admin or superadmin
 * marks a pending affiliation `rejected` with a required reason
 * (which becomes both the sa_audit reason and the
 * staff_affiliations.rejection_reason value visible to the clinician
 * on their dashboard).
 *
 * Does NOT touch users.state — a user with no other pending/active
 * affiliations stays at pending_approval (their next try is to either
 * edit the rejected affiliation or create a new one at another
 * hospital).
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

const log = makeLogger("reject-staff-affiliation");

const InputSchema = z.object({
  affiliation_id: z.string().uuid(),
  reason: z.string().min(8, "Reason ≥ 8 chars required for the rejection record."),
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
    .select("id, user_id, hospital_id, state, rejection_reason")
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

  const before = { state: aff.state, rejection_reason: aff.rejection_reason };
  const after = { state: "rejected", rejection_reason: input.reason };

  const { ipAddress, userAgent } = networkContext(request);
  try {
    await recordSaAudit({
      actorId: caller.id,
      action: "reject_staff_affiliation",
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
    log.error("sa_audit failed; aborting rejection", { requestId, reason: String(e) });
    return serverError("audit write failed", init);
  }

  const { error: updateError } = await sb
    .from("staff_affiliations")
    .update({ state: "rejected", rejection_reason: input.reason })
    .eq("id", aff.id);
  if (updateError) {
    log.error("affiliation update failed", { requestId, reason: updateError.message });
    return serverError("rejection write failed", init);
  }

  log.info("affiliation rejected", { requestId, affiliation_id: aff.id });
  return ok({ affiliation_id: aff.id, state: "rejected" }, init);
});
