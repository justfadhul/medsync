"use server";

import type { TriageSubmitState } from "@/app/nurse/triage/actions";
import { z } from "zod";

import { submitTriageAction } from "@/app/nurse/triage/actions";
import { FLOOR_ERRORS } from "@/content/clinic-floor/floor";
import { TD } from "@/content/clinic-floor/triage-dialog";
import { EVENT_KINDS, mayRecord } from "@/lib/clinic-floor/model";
import { logger } from "@/lib/logger";
import { kampala } from "@/lib/reception/desk/model";
import { callEdge } from "@/lib/supabase/edge";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyTriageOutcome } from "@/lib/triage/notify";
import { requireTriageScope } from "@/lib/triage/scope";

/**
 * The clinic floor's writes (migration 0295, CF9). Every state change is one append-only `clinic_floor_events`
 * row, idempotent by the device's client id (S2). The triage itself goes through the existing engine action
 * (`submitTriageAction`: engine, authority, override reason, audit); the floor only adds its side of it.
 * No name, phone or vital is written here, and none goes to the logs (CF7).
 */

const EventSchema = z.object({
  clientId: z.string().uuid(),
  kind: z.enum(EVENT_KINDS),
  intakeId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  doctorUserId: z.string().uuid().nullable().optional(),
  triageRecordId: z.string().uuid().nullable().optional(),
  detail: z.string().max(20).nullable().optional(),
  room: z.string().trim().max(40).nullable().optional(),
  note: z.string().trim().max(280).nullable().optional(),
});
export type FloorEventInput = z.infer<typeof EventSchema>;
export type FloorResult = { ok: true } | { ok: false; error: string };

const CALL_KINDS = new Set(["call", "call_again"]);
const SELF_KINDS = new Set(["doctor_status", "running_late", "end_session", "user_switch"]);

export async function recordFloorEventAction(raw: FloorEventInput): Promise<FloorResult> {
  const parsed = EventSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: FLOOR_ERRORS.invalid };
  const e = parsed.data;
  const scope = await requireTriageScope();
  const service = createServiceClient();

  // A nurse works in triage only (ADR 0531): anything on the line needs a clinic session of the caller's own today,
  // the same test the floor uses to show the doctor's controls.
  if (!mayRecord("nurse", e.kind)) {
    const day = kampala(new Date()).key;
    const start = new Date(Date.parse(`${day}T00:00:00+03:00`));
    const { data: mine } = await service
      .from("clinic_sessions")
      .select("id")
      .eq("hospital_id", scope.hospitalId)
      .eq("clinician_user_id", scope.userId)
      .neq("status", "cancelled")
      .gte("starts_at", start.toISOString())
      .lt("starts_at", new Date(start.getTime() + 86_400_000).toISOString())
      .limit(1);
    if (!mine?.length) return { ok: false, error: TD.watch.viewOnly };
  }

  if (e.intakeId) {
    const { data } = await service
      .from("patient_intakes")
      .select("hospital_id")
      .eq("id", e.intakeId)
      .maybeSingle();
    if (data?.hospital_id !== scope.hospitalId)
      return { ok: false, error: FLOOR_ERRORS.notYourHospital };
  } else if (!SELF_KINDS.has(e.kind)) {
    return { ok: false, error: FLOOR_ERRORS.invalid };
  }

  // A doctor's own status, session and calls are theirs alone.
  const doctorUserId =
    SELF_KINDS.has(e.kind) || CALL_KINDS.has(e.kind) ? scope.userId : (e.doctorUserId ?? null);

  // S13: no call unless the caller is In room (no status today counts as In room).
  if (CALL_KINDS.has(e.kind)) {
    const { data: last } = await service
      .from("clinic_floor_events")
      .select("detail")
      .eq("hospital_id", scope.hospitalId)
      .eq("kind", "doctor_status")
      .eq("doctor_user_id", scope.userId)
      .gte("at", new Date(Date.now() - 24 * 3_600_000).toISOString())
      .order("at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last && last.detail !== "in_room") return { ok: false, error: FLOOR_ERRORS.notInRoom };
  }

  const { error } = await service.from("clinic_floor_events").upsert(
    {
      hospital_id: scope.hospitalId,
      intake_id: e.intakeId ?? null,
      department_id: e.departmentId ?? null,
      doctor_user_id: doctorUserId,
      triage_record_id: e.triageRecordId ?? null,
      kind: e.kind,
      detail: e.detail ?? null,
      room: e.room || null,
      note: e.note || null,
      client_id: e.clientId,
      by_user_id: scope.userId,
    },
    { onConflict: "hospital_id,client_id", ignoreDuplicates: true },
  );
  if (error) {
    logger.error("clinic_floor.event.insert_failed", { kind: e.kind, reason: error.message });
    return { ok: false, error: FLOOR_ERRORS.saveFailed };
  }
  return { ok: true };
}

const SendSchema = z.object({
  clientId: z.string().uuid(),
  intakeId: z.string().uuid(),
  recheck: z.boolean(),
  departmentId: z.string().uuid().nullable(),
  doctorUserId: z.string().uuid().nullable(),
  note: z.string().trim().max(280).nullable(),
  /** D4: a free EU resus space, for a Level 1–2 patient only. */
  euBedId: z.string().uuid().nullable().optional(),
});

/**
 * Triage on the floor: the engine action first (unchanged), then the floor's event carrying the engine's re-check
 * band and where they were sent. `formData` holds the engine payload (`payload`) and the floor's (`floor`).
 * A Level 1–2 patient with an EU resus space chosen is then sent there (D4, ha-eu-stay `send_to_eu_resus`).
 */
export async function triageOnFloorAction(
  prev: TriageSubmitState,
  formData: FormData,
): Promise<TriageSubmitState> {
  let floorRaw: unknown = null;
  try {
    floorRaw = JSON.parse(String(formData.get("floor") ?? "null"));
  } catch {
    return { error: FLOOR_ERRORS.invalid };
  }
  const floor = SendSchema.safeParse(floorRaw);
  if (!floor.success) return { error: FLOOR_ERRORS.invalid };
  const res = await submitTriageAction(prev, formData);
  if (!res.ok || !res.triageRecordId) return res;
  const f = floor.data;
  const ev = await recordFloorEventAction({
    clientId: f.clientId,
    kind: f.recheck ? "rechecked" : "triaged",
    intakeId: f.intakeId,
    departmentId: f.departmentId,
    doctorUserId: f.doctorUserId,
    triageRecordId: res.triageRecordId,
    detail: res.recheck ?? null,
    note: f.note,
  });
  // Level 1 or 2: the engine action has alerted the triager's own department; the floor also alerts the clinic
  // the person is sent to, and the doctor chosen for them (ADR 0531). Best-effort: it never blocks the save.
  if ((res.assignedLevel ?? 5) <= 2 && f.departmentId && !f.recheck) {
    const scope = await requireTriageScope();
    if (f.departmentId !== scope.departmentId || f.doctorUserId)
      await notifyTriageOutcome({
        service: createServiceClient(),
        hospitalId: scope.hospitalId,
        departmentId: f.departmentId,
        assignedLevel: res.assignedLevel as 1 | 2,
        patientLabel: "a patient",
        triageRecordId: res.triageRecordId,
        alsoUserId: f.doctorUserId,
        skipDepartment: f.departmentId === scope.departmentId,
      }).catch((e) => logger.warn("clinic_floor.alert_failed", { reason: String(e) }));
  }
  // D4: after the floor has the visit, so its "Observed in EU" lands on it. The level is the saved one; the
  // function checks it again, with the space and the caller. A refusal comes back beside the saved triage.
  let euError: string | null = null;
  if (f.euBedId && (res.assignedLevel ?? 5) <= 2) {
    const scope = await requireTriageScope();
    const eu = await callEdge(
      "ha-eu-stay",
      {
        op: "send_to_eu_resus",
        hospital_id: scope.hospitalId,
        intake_id: f.intakeId,
        bed_id: f.euBedId,
        reason: `Triage Level ${res.assignedLevel}: straight to EU resus.`,
      },
      "clinic_floor.eu_resus",
    );
    if (!eu.ok) euError = eu.error;
  }
  // The triage record is saved and audited either way; the floor event is replayable by its client id.
  if (!ev.ok) return { ...res, error: ev.error };
  return euError ? { ...res, error: euError } : res;
}

const FollowUpSchema = z.object({
  intakeId: z.string().uuid(),
  clinicId: z.string().uuid(),
  day: z.number().int().positive(),
  doctorUserId: z.string().uuid().nullable(),
  reason: z.string().trim().max(200),
});
export type FloorFollowUpInput = z.infer<typeof FollowUpSchema>;

/**
 * Follow-up from Finish visit (follow-up 5, owner ruling 16 Nov). The same path as the EMR close
 * (`lib/emr/actions/close.ts` `bookFollowUp`): `ha-book-on-behalf` with `origin: 'clinician'`, reason `follow_up`,
 * which already accepts any active staff affiliation (no Edge Function change). The floor picks a clinic and a day,
 * so this books into that day's first published session for the clinic (the chosen doctor's, if one was chosen).
 * One booking per visit and session (idempotency key). A visit with no patient account is left to the desk.
 */
export async function bookFloorFollowUpAction(
  raw: FloorFollowUpInput,
): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const parsed = FollowUpSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: FLOOR_ERRORS.invalid };
  const f = parsed.data;
  const scope = await requireTriageScope();
  const service = createServiceClient();

  const { data: intake } = await service
    .from("patient_intakes")
    .select("hospital_id, patient_user_id")
    .eq("id", f.intakeId)
    .maybeSingle();
  if (intake?.hospital_id !== scope.hospitalId)
    return { ok: false, error: FLOOR_ERRORS.notYourHospital };
  if (!intake.patient_user_id) return { ok: false, error: FLOOR_ERRORS.followUpDesk };

  const start = new Date(Date.parse(`${kampala(new Date(f.day)).key}T00:00:00+03:00`));
  const end = new Date(start.getTime() + 86_400_000);
  let q = service
    .from("clinic_sessions")
    .select("id")
    .eq("hospital_id", scope.hospitalId)
    .eq("department_id", f.clinicId)
    .eq("status", "published")
    .gte("starts_at", start.toISOString())
    .lt("starts_at", end.toISOString())
    .order("starts_at", { ascending: true })
    .limit(1);
  if (f.doctorUserId) q = q.eq("clinician_user_id", f.doctorUserId);
  const { data: sessions, error } = await q;
  if (error) {
    logger.error("clinic_floor.follow_up_session_failed", { reason: error.message });
    return { ok: false, error: FLOOR_ERRORS.saveFailed };
  }
  const sessionId = sessions?.[0]?.id;
  if (!sessionId) return { ok: false, error: FLOOR_ERRORS.noSession };

  const r = await callEdge<{ data?: { appointment_id?: string; booking_code?: string | null } }>(
    "ha-book-on-behalf",
    {
      hospital_id: scope.hospitalId,
      idempotency_key: `floor-follow-up:${f.intakeId}:${sessionId}`,
      channel: "desk",
      origin: "clinician",
      reason: "follow_up",
      note: f.reason || null,
      patient_user_id: intake.patient_user_id,
      session: { session_id: sessionId },
    },
    "clinic_floor.follow_up",
  );
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.data?.data?.appointment_id) return { ok: false, error: FLOOR_ERRORS.saveFailed };
  return { ok: true, code: r.data.data.booking_code ?? "" };
}
