/**
 * sa-suspend-user — sets users.state = 'suspended' and stamps the
 * suspension trio (suspended_by/at/reason). Reversible via
 * sa-reactivate-user.
 *
 * Superadmin-only. Audited. NOT four-eyes (suspension is forward-
 * direction and rapidly reversible — distinct from deactivate which
 * is the deferred four-eyes-class action).
 *
 * Refuses to suspend another superadmin (that path is
 * sa-deactivate-superadmin, four-eyes-class, currently deferred).
 */

import { z } from "npm:zod@4.4.3";

import { banAuthUser, getCaller, hasRole, serviceClient } from "../_shared/auth.ts";
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

const log = makeLogger("sa-suspend-user");

const InputSchema = z.object({
  user_id: z.string().uuid(),
  reason: z.string().min(8),
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
  if (!parsed.success) return badRequest("Invalid input", init, parsed.error.flatten());
  const input = parsed.data;

  const caller = await getCaller(request);
  if (!caller) return unauthorized(init);
  if (!(await hasRole(caller.id, "superadmin"))) return forbidden(init, "superadmin required");

  // Refuse to suspend another superadmin via this path.
  if (await hasRole(input.user_id, "superadmin")) {
    return forbidden(
      init,
      "Cannot suspend a superadmin via this path. Use the deactivate-superadmin flow (four-eyes-class, currently deferred).",
    );
  }

  const sb = serviceClient();
  const { data: user } = await sb
    .from("users")
    .select("id, state, email")
    .eq("id", input.user_id)
    .maybeSingle();
  if (!user) return notFound(init, "user not found");
  if (user.state === "suspended") {
    return badRequest("user is already suspended", init);
  }

  const nowIso = new Date().toISOString();
  const { ipAddress, userAgent } = networkContext(request);
  try {
    await recordSaAudit({
      actorId: caller.id,
      action: "suspend_user",
      targetKind: "user",
      targetId: user.id,
      reason: input.reason,
      requestId,
      ipAddress,
      userAgent,
      beforeData: { state: user.state },
      afterData: {
        state: "suspended",
        suspended_by: caller.id,
        suspended_at: nowIso,
        suspension_reason: input.reason,
      },
    });
  } catch (e) {
    log.error("audit insert failed", { requestId, reason: String(e) });
    return serverError("audit write failed", init);
  }

  // Ban first: if it fails nothing is saved, so a retry is clean (review C-4).
  const banError = await banAuthUser(user.id);
  if (banError) {
    log.error("ban failed", { requestId, reason: banError });
    return serverError("sign-in ban failed", init);
  }

  const { error } = await sb
    .from("users")
    .update({
      state: "suspended",
      suspended_by: caller.id,
      suspended_at: nowIso,
      suspension_reason: input.reason,
    })
    .eq("id", user.id);
  if (error) {
    log.error("update failed", { requestId, reason: error.message });
    return serverError("update failed", init);
  }

  log.info("user suspended", { requestId, user_id: user.id });
  return ok({ user_id: user.id, state: "suspended" }, init);
});
