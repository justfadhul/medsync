/**
 * ha-eu-stay — the emergency unit's stay (ADR 0541).
 *
 *   op send_to_eu: the doctor sends the patient to an EU from the close; the visit stays open.
 *     A space (bed_id) or why the patient waits for one (space_wait_reason; 'other' needs the encrypted
 *     note). One SQL transaction (observe_in_eu, 0311) writes the stay, the space and the event; an open
 *     triage stay of the patient's is adopted. A visit on the clinic floor then ends there as Observed in EU.
 *
 *   op send_to_eu_resus (D4): triage sends a Level 1–2 patient straight to a free resus space of an EU. One SQL
 *     transaction (send_to_eu_resus, 0313) writes the triage nurse's stay (no encounter, the intake named) and the
 *     Arriving space; the doctor's Send to EU later adopts it. The floor's visit stays in the doctor's line (R70)
 *     until the doctor's encounter of that visit adopts or ends the stay, which ends it as Observed in EU.
 *
 * Auth (R58): sending is a clinical decision, so only the encounter's own clinician, with a live clinical
 * affiliation at the encounter's hospital. No admin or superadmin arm. send_to_eu_resus: triage-capable clinical
 * staff at the hospital (a live clinical affiliation whose cadre may triage there, as requireTriageScope).
 * Off (EU_OBSERVATION not set for the hospital) it refuses. Refusals return the SQL's words after
 * "EU4xx "; a deadlock asks to try again; a database message never reaches the caller or the log.
 */
import { z } from "npm:zod@4.4.3";

import { getCaller, serviceClient } from "../_shared/auth.ts";
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
import { floorFinishEu } from "../_shared/eu-floor.ts";
import { euObservationOn, euRefusal } from "../_shared/eu.ts";
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

const SendToEuResus = z.object({
  op: z.literal("send_to_eu_resus"),
  hospital_id: z.string().uuid(),
  intake_id: z.string().uuid(),
  bed_id: z.string().uuid(),
  reason: z.string().min(8, "Reason ≥ 8 chars required (audited)."),
});

const InputSchema = z.discriminatedUnion("op", [SendToEu, SendToEuResus]);
type Init = { origin: string | null; requestId: string };

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

  const caller = await getCaller(request);
  if (!caller) return unauthorized(init);
  if (parsed.data.op === "send_to_eu_resus")
    return sendToEuResus(parsed.data, caller.id, request, init);
  const { op: _op, reason, ...payload } = parsed.data;

  const sb = serviceClient();
  const { data: enc, error: encErr } = await sb
    .from("encounters")
    .select("id, hospital_id, clinician_user_id, state, department_id")
    .eq("id", payload.encounter_id)
    .maybeSingle();
  if (encErr) {
    log.error("encounter read failed", { requestId, code: encErr.code });
    return serverError("encounter read failed", init);
  }
  if (!enc) return notFound(init, "encounter not found");

  // A clinical decision (R58): only the encounter's own clinician, still clinical staff at its hospital.
  if (caller.id !== enc.clinician_user_id) return forbidden(init);
  const { data: aff, error: affErr } = await sb
    .from("staff_affiliations")
    .select("id, cadres!inner(is_clinical)")
    .eq("user_id", caller.id)
    .eq("hospital_id", enc.hospital_id)
    .in("state", ["active", "approved"])
    .eq("cadres.is_clinical", true)
    .limit(1)
    .maybeSingle();
  if (affErr) {
    log.error("affiliation read failed", { requestId, code: affErr.code });
    return serverError("affiliation read failed", init);
  }
  if (!aff) return forbidden(init);
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

  // A visit on the clinic floor ends there as "Observed in EU" (Task 24), keyed by the stay's intake:
  // observe_in_eu names one only when it is this patient's at this hospital (no intake, no floor event).
  const intakeId: string | null = r.data?.intake_id ?? null;
  if (intakeId) {
    const err = await floorFinishEu(
      sb,
      enc.hospital_id,
      intakeId,
      enc.department_id ?? null,
      caller.id,
    );
    if (err) log.error("floor finish failed (non-fatal)", { requestId, code: err.code });
  }
  return ok({ stay: r.data }, init);
});

/**
 * Triage sends a Level 1–2 patient to EU resus (D4). The level, the visit, the space and the patient are the SQL
 * function's to check; this checks who may ask.
 */
async function sendToEuResus(
  input: z.infer<typeof SendToEuResus>,
  callerId: string,
  request: Request,
  init: Init,
): Promise<Response> {
  const { op: _op, reason, ...p } = input;
  const { requestId } = init;
  const sb = serviceClient();

  // Triage-capable (requireTriageScope): a live clinical affiliation at this hospital whose cadre the hospital's
  // policy lets triage.
  const { data: affs, error: affErr } = await sb
    .from("staff_affiliations")
    .select("id, cadres!inner(code, is_clinical)")
    .eq("user_id", callerId)
    .eq("hospital_id", p.hospital_id)
    .in("state", ["active", "approved"])
    .eq("cadres.is_clinical", true);
  if (affErr) {
    log.error("affiliation read failed", { requestId, code: affErr.code });
    return serverError("affiliation read failed", init);
  }
  const cadres = ((affs ?? []) as { cadres: unknown }[]).flatMap((a) => {
    const c = a.cadres as { code?: string } | { code?: string }[] | null;
    return (Array.isArray(c) ? c : c ? [c] : []).flatMap((x) => (x.code ? [x.code] : []));
  });
  if (!cadres.length) return forbidden(init);
  const { data: policy, error: polErr } = await sb
    .from("clinical_cosign_policies")
    .select("id")
    .eq("hospital_id", p.hospital_id)
    .in("cadre_code", cadres)
    .eq("action_kind", "triage_patient")
    .eq("requirement", "allowed")
    .limit(1)
    .maybeSingle();
  if (polErr) {
    log.error("policy read failed", { requestId, code: polErr.code });
    return serverError("policy read failed", init);
  }
  if (!policy) return forbidden(init);
  if (!euObservationOn(Deno.env.get("EU_OBSERVATION"), p.hospital_id)) {
    return conflict("The emergency unit is not switched on at this hospital.", init);
  }

  const { ipAddress, userAgent } = networkContext(request);
  try {
    await recordSaAudit({
      actorId: callerId,
      action: "send_to_eu_resus",
      targetKind: "patient_intake",
      targetId: p.intake_id,
      reason,
      requestId,
      ipAddress,
      userAgent,
      afterData: { bed_id: p.bed_id },
    });
  } catch (e) {
    log.error("sa_audit failed", { requestId, name: e instanceof Error ? e.name : "unknown" });
    return serverError("audit write failed", init);
  }

  // The actor is the caller, never the body's.
  const r = await sb.rpc("send_to_eu_resus", { p: { ...p, actor: callerId } });
  if (r.error) {
    const words = euRefusal(r.error);
    if (words) return badRequest(words, init);
    log.error("send_to_eu_resus failed", { requestId, name: r.error.name, code: r.error.code });
    return serverError("sending to EU resus failed", init);
  }
  return ok({ stay: r.data }, init);
}
