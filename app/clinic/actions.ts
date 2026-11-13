"use server";

import type { TriageSubmitState } from "@/app/nurse/triage/actions";
import { z } from "zod";

import { submitTriageAction } from "@/app/nurse/triage/actions";
import { FLOOR_ERRORS } from "@/content/clinic-floor/floor";
import { EVENT_KINDS } from "@/lib/clinic-floor/model";
import { logger } from "@/lib/logger";
import { createServiceClient } from "@/lib/supabase/service";
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
});

/**
 * Triage on the floor: the engine action first (unchanged), then the floor's event carrying the engine's re-check
 * band and where they were sent. `formData` holds the engine payload (`payload`) and the floor's (`floor`).
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
  // The triage record is saved and audited either way; the floor event is replayable by its client id.
  return ev.ok ? res : { ...res, error: ev.error };
}
