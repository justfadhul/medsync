"use server";

import type { SimpleResult } from "@/components/wards/editor/ward-editor";
import type { WaitReason } from "@/lib/wards/eu-guard";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { encrypt } from "@/lib/encryption";
import { requireNurseScope } from "@/lib/nurse/scope";
import { callEdge } from "@/lib/supabase/edge";
import { euAssignRefusal } from "@/lib/wards/eu-guard";
import { wardBuilderLiveFor } from "@/lib/wards/feature";

/*
 * The nurse's bed board actions (ADR 0194 §3). The scope ALWAYS comes from requireNurseScope();
 * ha-services-hub decides whether this nurse may act on this ward (in-charge, acting in-charge, or an
 * open nursing assignment on it) and writes the audit row.
 */

const uuid = z.string().uuid();

async function scope() {
  const s = await requireNurseScope();
  if (!wardBuilderLiveFor(s.hospitalId))
    throw new Error("The bed board is not on for this hospital.");
  return s;
}

async function hub(body: Record<string, unknown>): Promise<SimpleResult> {
  const s = await scope();
  const r = await callEdge("ha-services-hub", { ...body, hospital_id: s.hospitalId }, "nurse.beds");
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/nurse/beds");
  return { ok: true };
}

export async function nurseSetBedState(
  _wardId: string,
  bedId: string,
  state: "free" | "cleaning" | "reserved",
  reason: string | null,
): Promise<SimpleResult> {
  if (!uuid.safeParse(bedId).success) return { ok: false, error: "Unknown bed." };
  return hub({ op: "set_bed_state", bed_id: bedId, state, ...(reason ? { reason } : {}) });
}

export async function nurseAssignBed(
  _wardId: string,
  bedId: string,
  patientUserId: string,
): Promise<SimpleResult> {
  if (!uuid.safeParse(bedId).success || !uuid.safeParse(patientUserId).success)
    return { ok: false, error: "Unknown bed or patient." };
  const s = await scope();
  const refused = await euAssignRefusal(s.hospitalId, bedId);
  if (refused) return { ok: false, error: refused };
  return hub({ op: "assign_bed", bed_id: bedId, patient_user_id: patientUserId });
}

export async function nurseReleaseBed(
  _wardId: string,
  assignmentId: string,
  reason: string,
  next: "cleaning" | "free" | null,
): Promise<SimpleResult> {
  if (!uuid.safeParse(assignmentId).success) return { ok: false, error: "Unknown bed assignment." };
  return hub({
    op: "release_bed",
    assignment_id: assignmentId,
    reason,
    ...(next ? { next_state: next } : {}),
  });
}

export async function nurseMoveEuSpace(
  _wardId: string,
  stayId: string,
  target: { wardId?: string; bedId?: string; waitReason?: WaitReason; waitNote?: string },
): Promise<SimpleResult> {
  if (
    ![stayId, target.wardId ?? stayId, target.bedId ?? stayId].every(
      (x) => uuid.safeParse(x).success,
    )
  )
    return { ok: false, error: "Unknown stay, ward or space." };
  const note = target.waitNote?.trim();
  return hub({
    op: "move_eu_space",
    stay_id: stayId,
    ...(target.wardId ? { ward_id: target.wardId } : {}),
    ...(target.bedId ? { bed_id: target.bedId } : {}),
    ...(!target.bedId && target.waitReason ? { space_wait_reason: target.waitReason } : {}),
    ...(!target.bedId && note ? { space_wait_note_ciphertext: encrypt(note) } : {}),
  });
}

/* ─── admissions (ADR 0199): allocate from the waiting list, Arrived, cancel ─── */

export async function nurseAllocateAdmissionBed(
  _wardId: string,
  admissionId: string,
  bedId: string,
): Promise<SimpleResult> {
  if (!uuid.safeParse(admissionId).success || !uuid.safeParse(bedId).success)
    return { ok: false, error: "Unknown admission or bed." };
  return hub({ op: "allocate_admission_bed", admission_id: admissionId, bed_id: bedId });
}

export async function nurseConfirmArrival(
  _wardId: string,
  assignmentId: string,
): Promise<SimpleResult> {
  if (!uuid.safeParse(assignmentId).success) return { ok: false, error: "Unknown bed assignment." };
  return hub({ op: "confirm_arrival", assignment_id: assignmentId });
}

export async function nurseReleaseAdmissionBed(
  _wardId: string,
  admissionId: string,
  reason: string,
  outcome: "wait" | "end",
): Promise<SimpleResult> {
  if (!uuid.safeParse(admissionId).success) return { ok: false, error: "Unknown admission." };
  return hub({ op: "release_admission_bed", admission_id: admissionId, reason, outcome });
}
