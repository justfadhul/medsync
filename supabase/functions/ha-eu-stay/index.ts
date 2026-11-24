/**
 * ha-eu-stay — the emergency unit's stay (ADR 0541).
 *
 *   op send_to_eu: the doctor sends the patient to an EU from the close; the visit stays open.
 *     A space (bed_id) or why the patient waits for one (space_wait_reason; 'other' needs the encrypted
 *     note). One SQL transaction (observe_in_eu, 0311) writes the stay, the space and the event; an open
 *     triage stay of the patient's is adopted.
 *
 * Auth as ha-complete-encounter: the clinician on the encounter (still clinical staff at its hospital),
 * hospital_admin (scoped), or superadmin.
 * Off (EU_OBSERVATION not set for the hospital) it refuses. Refusals return the SQL's words after
 * "EU4xx "; a deadlock asks to try again; a database message never reaches the caller or the log.
 */
import { z } from "npm:zod@4.4.3";

import { getCaller, hasRole, serviceClient } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
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
import { euObservationOn, euRefusal } from "../_shared/eu.ts";
import { requireHospitalAdminScope } from "../_shared/hospital-admin-scope.ts";
import { makeLogger } from "../_shared/logger.ts";
import { networkContext, recordSaAudit } from "../_shared/sa-audit.ts";

const log = makeLogger("ha-eu-stay");

const SendToEu = z
  .object({
    op: z.literal("send_to_eu"),
    encounter_id: z.string().uuid(),
    ward_id: z.string().uuid(),
    bed_id: z.string().uuid().optional(),
    space_wait_reason: z.enum(["no_free_bed", "extra_bed", "floor", "other"]).optional(),
    space_wait_note_ciphertext: z.string().max(20_000).optional(),
    reason: z.string().min(8, "Reason ≥ 8 chars required (audited)."),
  })
  .refine((v) => !!v.bed_id !== !!v.space_wait_reason, {
    message: "Send a space, or why the patient waits for one.",
  })
  .refine((v) => v.space_wait_reason !== "other" || !!v.space_wait_note_ciphertext, {
    message: "Waiting for 'other' needs a note.",
  });

const InputSchema = z.discriminatedUnion("op", [SendToEu]);

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
  const { op: _op, reason, ...payload } = parsed.data;

  const caller = await getCaller(request);
  if (!caller) return unauthorized(init);

  const sb = serviceClient();
  const { data: enc, error: encErr } = await sb
    .from("encounters")
    .select("id, hospital_id, clinician_user_id, state")
    .eq("id", payload.encounter_id)
    .maybeSingle();
  if (encErr) {
    log.error("encounter read failed", { requestId, code: encErr.code });
    return serverError("encounter read failed", init);
  }
  if (!enc) return notFound(init, "encounter not found");

  const isSuperadmin = await hasRole(caller.id, "superadmin");
  // The encounter's clinician, still clinical staff at its hospital (ha-start-encounter's affiliation check).
  let isOwner = caller.id === enc.clinician_user_id;
  if (isOwner && !isSuperadmin) {
    const { data: aff } = await sb
      .from("staff_affiliations")
      .select("id, cadres!inner(is_clinical)")
      .eq("user_id", caller.id)
      .eq("hospital_id", enc.hospital_id)
      .in("state", ["active", "approved"])
      .eq("cadres.is_clinical", true)
      .limit(1)
      .maybeSingle();
    isOwner = !!aff;
  }
  if (!isSuperadmin && !isOwner) {
    if (!(await hasRole(caller.id, "hospital_admin", enc.hospital_id))) {
      return forbidden(init);
    }
    const scope = await requireHospitalAdminScope(caller.id, enc.hospital_id);
    if (!scope.ok) return forbidden(init, scope.reason);
  }
  if (!euObservationOn(Deno.env.get("EU_OBSERVATION"), enc.hospital_id)) {
    return conflict("The emergency unit is not switched on at this hospital.", init);
  }

  const { ipAddress, userAgent } = networkContext(request);
  try {
    await recordSaAudit({
      actorId: caller.id,
      action: "send_to_eu",
      targetKind: "encounter",
      targetId: enc.id,
      reason,
      requestId,
      ipAddress,
      userAgent,
      beforeData: { state: enc.state },
      afterData: {
        ward_id: payload.ward_id,
        bed_id: payload.bed_id ?? null,
        space_wait_reason: payload.space_wait_reason ?? null,
      },
    });
  } catch (e) {
    log.error("sa_audit failed", { requestId, name: e instanceof Error ? e.name : "unknown" });
    return serverError("audit write failed", init);
  }

  // The actor is the caller, and the encounter the one authorised above: never the body's.
  const r = await sb.rpc("observe_in_eu", {
    p: { ...payload, encounter_id: enc.id, actor: caller.id },
  });
  if (r.error) {
    const words = euRefusal(r.error);
    if (words) return badRequest(words, init);
    log.error("observe_in_eu failed", { requestId, name: r.error.name, code: r.error.code });
    return serverError("sending to the EU failed", init);
  }
  return ok({ stay: r.data }, init);
});
