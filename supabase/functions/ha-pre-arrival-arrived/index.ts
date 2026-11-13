/**
 * ha-pre-arrival-arrived — the Incoming board's Arrived (PRD MS-PRD-SYM-001
 * §8.5; §9.4 `markArrived`; ADR 0098 ruling 10).
 *
 * ONE INTAKE PER PATIENT PER DAY. The intake comes from `_shared/intake.ts`
 * — the same writer as the desk's front door — never a parallel INSERT. And
 * when the named patient already holds a live intake today at this
 * facility (they walked in, or the desk registered them before the board
 * caught up), that intake is LINKED to the pre-alert rather than a second
 * one created: `linked: true` in the response, status untouched.
 *
 * Otherwise: entry type `self_presentation_prealerted` (0066 §8 — an
 * emergency type, so an unknown patient is fine and nothing blocks), entry
 * point `casualty`, priority `urgent`, the chief complaint pre-filled from
 * the red flags' lay labels (catalog keys resolved server-side from the
 * bundled package; "Isolation: fever with bleeding" appended when flagged),
 * and both link columns set so triage can read what was reported.
 *
 * Auth: `authoriseAtHospital` on the row's facility. `canTransition` to
 * `arrived` or 409. The pre-alert's own audit row lands FIRST (fail closed);
 * the intake service audits its INSERT itself.
 */

import type { PreArrivalStatus } from "../_shared/pre-arrival.ts";
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
import { authoriseAtHospital } from "../_shared/hospital-admin-scope.ts";
import { registerIntake } from "../_shared/intake.ts";
import { makeLogger } from "../_shared/logger.ts";
import { canTransition } from "../_shared/pre-arrival.ts";
import { networkContext, recordSaAudit } from "../_shared/sa-audit.ts";
import { DEFAULT_TIME_ZONE, startOfLocalDay } from "../_shared/slots.ts";
import { CATALOG, t } from "../_shared/symptom-catalog/index.ts";

const log = makeLogger("ha-pre-arrival-arrived");

const ENTRY_TYPE_CODE = "self_presentation_prealerted";
const LIVE_INTAKE_STATUSES = ["declared", "arrived", "awaiting_triage", "triaged"];
const COMPLAINT_MAX = 2000;

const InputSchema = z.object({
  pre_arrival_id: z.string().uuid(),
  patient_user_id: z.string().uuid().optional(),
  patient_unknown_label: z.string().trim().min(1).max(240).optional(),
  receiving_department_id: z.string().uuid().optional(),
  reason: z.string().trim().min(8).max(500),
});

interface PreArrivalRow {
  id: string;
  facility_id: string;
  submission_id: string | null;
  patient_user_id: string | null;
  red_flags: string[];
  isolation_flag: boolean;
  status: PreArrivalStatus;
  acknowledged_at: string | null;
}

/** The board's lay labels, joined; unknown keys print as themselves rather than dropping a sign. */
function presentingComplaint(redFlags: string[], isolation: boolean): string | null {
  const byKey = new Map(CATALOG.items.map((i) => [i.key, i]));
  const parts = redFlags.map((k) => {
    const item = byKey.get(k);
    return item ? t(CATALOG, item.labelKey) : k;
  });
  if (isolation) parts.push("Isolation: fever with bleeding");
  return parts.length ? parts.join(" · ").slice(0, COMPLAINT_MAX) : null;
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

  const sb = serviceClient();
  const { data: row, error: rowError } = await sb
    .from("emergency_pre_arrivals")
    .select(
      "id, facility_id, submission_id, patient_user_id, red_flags, isolation_flag, status, acknowledged_at",
    )
    .eq("id", input.pre_arrival_id)
    .maybeSingle();
  if (rowError) return serverError(rowError.message, init);
  const pa = (row as PreArrivalRow | null) ?? null;
  if (!pa) return notFound(init, "pre-alert not found");

  const denied = await authoriseAtHospital(caller.id, pa.facility_id);
  if (denied) return forbidden(init, denied);

  if (!canTransition(pa.status, "arrived")) {
    return conflict(`Cannot mark a ${pa.status} pre-alert as arrived.`, init, {
      status: pa.status,
    });
  }

  // The desk's identification wins over the alert's own guess at who it is about.
  const patientUserId = input.patient_user_id ?? pa.patient_user_id ?? null;

  // A live intake today at this facility for that patient → link, never duplicate.
  let existingIntakeId: string | null = null;
  let existingIntakeStatus: string | null = null;
  if (patientUserId) {
    const { data: live, error: liveError } = await sb
      .from("patient_intakes")
      .select("id, status")
      .eq("hospital_id", pa.facility_id)
      .eq("patient_user_id", patientUserId)
      .in("status", LIVE_INTAKE_STATUSES)
      .gte("arrived_at", startOfLocalDay(new Date(), DEFAULT_TIME_ZONE).toISOString())
      .order("arrived_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (liveError) return serverError(liveError.message, init);
    const liveRow = live as { id: string; status: string } | null;
    existingIntakeId = liveRow?.id ?? null;
    existingIntakeStatus = liveRow?.status ?? null;
  }

  const { ipAddress, userAgent } = networkContext(request);
  try {
    await recordSaAudit({
      actorId: caller.id,
      action: "update_pre_arrival",
      targetKind: "emergency_pre_arrival",
      targetId: pa.id,
      reason: input.reason,
      requestId,
      ipAddress,
      userAgent,
      beforeData: { status: pa.status },
      afterData: {
        status: "arrived",
        facility_id: pa.facility_id,
        linked_existing_intake: existingIntakeId !== null,
        patient_known: patientUserId !== null,
      },
    });
  } catch (e) {
    log.error("sa_audit failed; aborting", { requestId, reason: String(e) });
    return serverError("audit write failed", init);
  }

  let intakeId: string;
  if (existingIntakeId) {
    // A `declared` row is the patient's remote queue ticket: they are here
    // now, so it checks in the way `ha-check-in-patient` mode B does, and
    // the pre-alert's urgency reaches the worklist.
    const { error: linkError } = await sb
      .from("patient_intakes")
      .update({
        pre_arrival_id: pa.id,
        priority_hint: "urgent",
        // A pre-alerted emergency is always triaged, even if the desk had sent
        // this patient to the clinic (ADR 0101 safeguard).
        routed_to: "triage",
        ...(pa.submission_id ? { symptom_submission_id: pa.submission_id } : {}),
        ...(existingIntakeStatus === "declared"
          ? { status: "arrived", checked_in_at: new Date().toISOString() }
          : {}),
      })
      .eq("id", existingIntakeId);
    if (linkError) {
      log.error("intake link failed", { requestId, reason: linkError.message });
      return serverError("could not link the intake", init);
    }
    intakeId = existingIntakeId;
  } else {
    const result = await registerIntake(
      { sb, init, log },
      {
        hospitalId: pa.facility_id,
        entryTypeCode: ENTRY_TYPE_CODE,
        entryPoint: "casualty",
        receivingDepartmentId: input.receiving_department_id ?? null,
        patientUserId,
        patientUnknownLabel: patientUserId
          ? null
          : (input.patient_unknown_label ?? "Pre-alerted arrival"),
        presentingComplaint: presentingComplaint(pa.red_flags ?? [], pa.isolation_flag),
        priorityHintOverride: "urgent",
        registeredByUserId: caller.id,
        preArrivalId: pa.id,
        symptomSubmissionId: pa.submission_id,
        audit: { actorId: caller.id, reason: input.reason, requestId, ipAddress, userAgent },
      },
    );
    if (!result.ok) return result.response;
    intakeId = result.intakeId;
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error: updateError } = await sb
    .from("emergency_pre_arrivals")
    .update({
      status: "arrived",
      arrived_at: nowIso,
      arrived_intake_id: intakeId,
      closed_at: nowIso,
      // Migration 0294 (D-RD-19): an arrival is never unacknowledged; whoever registers it has seen it.
      ...(pa.acknowledged_at
        ? {}
        : { acknowledged_by_user_id: caller.id, acknowledged_at: nowIso }),
      ...(patientUserId && !pa.patient_user_id ? { patient_user_id: patientUserId } : {}),
    })
    .eq("id", pa.id)
    .eq("status", pa.status)
    .select("id")
    .maybeSingle();
  if (updateError) {
    log.error("pre-arrival update failed", { requestId, reason: updateError.message });
    return serverError("the intake exists but the pre-alert could not be closed", init);
  }
  if (!updated) {
    // The intake is real either way; the card was closed by someone else first.
    log.warn("pre-alert closed concurrently; intake stands", {
      requestId,
      pre_arrival_id: pa.id,
      intake_id: intakeId,
    });
    return conflict(
      "Someone else closed this pre-alert first — the intake was still registered.",
      init,
      {
        intake_id: intakeId,
      },
    );
  }

  log.info("pre-alert arrived", {
    requestId,
    pre_arrival_id: pa.id,
    facility_id: pa.facility_id,
    intake_id: intakeId,
    linked: existingIntakeId !== null,
  });
  return ok(
    { pre_arrival_id: pa.id, intake_id: intakeId, linked: existingIntakeId !== null },
    init,
  );
});
