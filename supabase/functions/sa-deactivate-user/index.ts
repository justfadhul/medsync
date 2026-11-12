/**
 * sa-deactivate-user — soft deactivation. Sets users.state =
 * 'deactivated'. Recoverable for 30 days via sa-reactivate-user (not
 * shipped here — flagged as a follow-up).
 *
 * Refuses to deactivate a superadmin (that path is deactivate_superadmin,
 * four-eyes-class, deferred). Refuses to deactivate the caller (no self-
 * deactivation; protects against accidental lockout).
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

const log = makeLogger("sa-deactivate-user");

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
  if (input.user_id === caller.id) {
    return forbidden(init, "cannot deactivate your own account from this surface");
  }
  if (await hasRole(input.user_id, "superadmin")) {
    return forbidden(init, "deactivating a superadmin is four-eyes-class (deferred)");
  }

  const sb = serviceClient();
  const { data: user } = await sb
    .from("users")
    .select("id, state")
    .eq("id", input.user_id)
    .maybeSingle();
  if (!user) return notFound(init, "user not found");
  if (user.state === "deactivated") {
    return ok({ user_id: user.id, already_deactivated: true }, init);
  }

  const { ipAddress, userAgent } = networkContext(request);
  try {
    await recordSaAudit({
      actorId: caller.id,
      action: "deactivate_user",
      targetKind: "user",
      targetId: user.id,
      reason: input.reason,
      requestId,
      ipAddress,
      userAgent,
      beforeData: { state: user.state },
      afterData: { state: "deactivated" },
    });
  } catch (e) {
    log.error("audit insert failed", { requestId, reason: String(e) });
    return serverError("audit write failed", init);
  }

  // If the user was previously suspended we need to clear the
  // suspension trio because the CHECK constraint enforces "all set
  // when state=suspended, all null otherwise."
  // Ban first: if it fails nothing is saved, so a retry is clean (review C-4).
  const banError = await banAuthUser(user.id);
  if (banError) {
    log.error("ban failed", { requestId, reason: banError });
    return serverError("sign-in ban failed", init);
  }

  const { error } = await sb
    .from("users")
    .update({
      state: "deactivated",
      suspended_by: null,
      suspended_at: null,
      suspension_reason: null,
    })
    .eq("id", user.id);
  if (error) {
    log.error("update failed", { requestId, reason: error.message });
    return serverError("update failed", init);
  }

  log.info("user deactivated", { requestId, user_id: user.id });
  return ok({ user_id: user.id, state: "deactivated" }, init);
});
