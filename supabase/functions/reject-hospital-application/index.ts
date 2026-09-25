/**
 * reject-hospital-application — GATE F.
 *
 * Superadmin-only. Marks a pending application `rejected` with a
 * required reason that becomes both the sa_audit reason and the
 * hospital_applications.rejection_reason value the applicant sees on
 * their dashboard.
 *
 * Does NOT cascade to users.state. The applicant remains at
 * pending_approval; they can edit + resubmit the rejected application
 * (RLS allows UPDATE only while state=pending_approval; this Edge
 * Function flips it back to that state if needed by the resubmit flow).
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

const log = makeLogger("reject-hospital-application");

const InputSchema = z.object({
  application_id: z.string().uuid(),
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

  const isSuperadmin = await hasRole(caller.id, "superadmin");
  if (!isSuperadmin) return forbidden(init, "superadmin required");

  const sb = serviceClient();
  const { data: app, error: fetchError } = await sb
    .from("hospital_applications")
    .select("id, applicant_user_id, state, rejection_reason")
    .eq("id", input.application_id)
    .single();
  if (fetchError || !app) return notFound(init, "application not found");

  // Mirrors approve-hospital-application: pending_approval, under_review
  // and (Onboarding v2, D7) verified are valid starting states. under_review
  // means a superadmin has begun review; verified means the applicant has
  // yet to sign the agreement. Rejecting from either is the operator
  // finalising their decision.
  const ALLOWED_STARTING_STATES = new Set(["pending_approval", "under_review", "verified"]);
  if (!ALLOWED_STARTING_STATES.has(app.state)) {
    return badRequest(
      `Application is in state '${app.state}'; must be pending_approval, under_review or verified.`,
      init,
    );
  }

  const { ipAddress, userAgent } = networkContext(request);
  try {
    await recordSaAudit({
      actorId: caller.id,
      action: "reject_hospital_application",
      targetKind: "hospital_application",
      targetId: app.id,
      reason: input.reason,
      requestId,
      ipAddress,
      userAgent,
      beforeData: { state: app.state, rejection_reason: app.rejection_reason },
      afterData: { state: "rejected", rejection_reason: input.reason },
    });
  } catch (e) {
    log.error("sa_audit failed; aborting rejection", { requestId, reason: String(e) });
    return serverError("audit write failed", init);
  }

  const { error: updateError } = await sb
    .from("hospital_applications")
    .update({
      state: "rejected",
      rejection_reason: input.reason,
      reviewed_by: caller.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", app.id);
  if (updateError) {
    log.error("application update failed", { requestId, reason: updateError.message });
    return serverError("rejection write failed", init);
  }

  log.info("application rejected", { requestId, application_id: app.id });
  return ok({ application_id: app.id, state: "rejected" }, init);
});
