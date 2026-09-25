"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireDoctorScope } from "@/lib/doctor/scope";
import { callEdge } from "@/lib/supabase/edge";

/**
 * Doctor scheduling actions — thin wrappers around existing Edge
 * Functions (no engine change beyond ha-record-walkin, which is the
 * one net-new Edge Function flagged in the GATE A proposal §2).
 *
 *   - confirm / decline a pending appointment (reuse existing fns)
 *   - record a walk-in (ha-record-walkin — net-new)
 *   - start an encounter (ha-start-encounter — existing)
 *   - end the visit (ha-complete-encounter — existing)
 *   - set scheduling settings (ha-set-clinician-settings — existing)
 */

export type DoctorScheduleActionState = { ok?: boolean; error?: string };

/* ─── Approve / decline a pending appointment ────────────────────── */

const ApprovalSchema = z.object({
  appointment_id: z.string().uuid(),
  reason: z.string().min(8, "Note ≥ 8 chars (audited)."),
});

export async function approveAppointmentAction(
  _prev: DoctorScheduleActionState,
  formData: FormData,
): Promise<DoctorScheduleActionState> {
  const parsed = ApprovalSchema.safeParse({
    appointment_id: formData.get("appointment_id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors.reason?.[0] ?? "Invalid input." };
  }
  await requireDoctorScope();
  const result = await callEdge("ha-confirm-appointment-request", parsed.data, "doctor.schedule");
  if (!result.ok) return { error: result.error };
  revalidatePath("/doctor/schedule");
  return { ok: true };
}

export async function declineAppointmentAction(
  _prev: DoctorScheduleActionState,
  formData: FormData,
): Promise<DoctorScheduleActionState> {
  const parsed = ApprovalSchema.safeParse({
    appointment_id: formData.get("appointment_id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors.reason?.[0] ?? "Invalid input." };
  }
  await requireDoctorScope();
  const result = await callEdge("ha-decline-appointment-request", parsed.data, "doctor.schedule");
  if (!result.ok) return { error: result.error };
  revalidatePath("/doctor/schedule");
  return { ok: true };
}

/* ─── Record walk-in ─────────────────────────────────────────────── */

const WalkinSchema = z.object({
  patient_user_id: z.string().uuid(),
  urgent: z.boolean().optional().default(false),
  notes: z.string().max(500).optional(),
  reason: z.string().min(8, "Reason ≥ 8 chars (audited)."),
});

export async function recordWalkinAction(
  _prev: DoctorScheduleActionState,
  formData: FormData,
): Promise<DoctorScheduleActionState> {
  const parsed = WalkinSchema.safeParse({
    patient_user_id: formData.get("patient_user_id"),
    urgent: formData.get("urgent") === "true",
    notes: (formData.get("notes") as string | null)?.trim() || undefined,
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat().find(Boolean);
    return { error: first ?? "Check the form values." };
  }
  const scope = await requireDoctorScope();
  const result = await callEdge(
    "ha-record-walkin",
    { hospital_id: scope.hospitalId, department_id: scope.departmentId, ...parsed.data },
    "doctor.schedule",
  );
  if (!result.ok) return { error: result.error };
  revalidatePath("/doctor/schedule");
  return { ok: true };
}

/* ─── Start encounter from a queue entry ─────────────────────────── */

const StartEncounterSchema = z.object({
  appointment_id: z.string().uuid().optional(),
  queue_entry_id: z.string().uuid().optional(),
  reason: z.string().min(8, "Reason ≥ 8 chars (audited).").default("Calling next patient."),
});

export async function startEncounterAction(payload: {
  appointmentId?: string;
  queueEntryId?: string;
  reason?: string;
}): Promise<DoctorScheduleActionState> {
  const parsed = StartEncounterSchema.safeParse({
    appointment_id: payload.appointmentId,
    queue_entry_id: payload.queueEntryId,
    reason: payload.reason ?? "Calling next patient.",
  });
  if (!parsed.success) {
    return { error: "Need an appointment or queue entry to start." };
  }
  if (!parsed.data.appointment_id && !parsed.data.queue_entry_id) {
    return { error: "Need an appointment or queue entry to start." };
  }
  await requireDoctorScope();
  const result = await callEdge("ha-start-encounter", parsed.data, "doctor.schedule");
  if (!result.ok) return { error: result.error };
  revalidatePath("/doctor/schedule");
  return { ok: true };
}

/* ─── End the visit (ADR 0101 R3) ────────────────────────────────── */

/**
 * The completion reason and the audited reason are FIXED here, not taken from
 * the client: the button says "End visit" and nothing else, so the audit row
 * must say exactly that. ha-complete-encounter re-checks that the caller is the
 * encounter's clinician (or a scoped admin) and cascades the close to the queue
 * row, the intake and the booking — the desk and triage boards drop the patient
 * from the same write, hence the four revalidations.
 */
export async function completeEncounterAction(
  encounterId: string,
): Promise<DoctorScheduleActionState> {
  if (!z.string().uuid().safeParse(encounterId).success) {
    return { error: "Need an encounter to end." };
  }
  await requireDoctorScope();
  const result = await callEdge(
    "ha-complete-encounter",
    {
      encounter_id: encounterId,
      completion_reason: "ended_by_clinician",
      reason: "Visit ended by the clinician.",
    },
    "doctor.schedule",
  );
  if (!result.ok) return { error: result.error };
  revalidatePath("/doctor/schedule");
  revalidatePath("/doctor");
  revalidatePath("/doctor/encounters");
  revalidatePath(`/doctor/encounters/${encounterId}`);
  revalidatePath("/reception/expected");
  revalidatePath("/nurse/triage");
  return { ok: true };
}

/* ─── Set scheduling settings (auto-confirm, slot, buffer, virtual, OOH) ─ */

const SettingsSchema = z.object({
  auto_confirm: z.boolean(),
  default_slot_minutes: z.number().int().min(5).max(240),
  buffer_minutes: z.number().int().min(0).max(60),
  allow_virtual: z.boolean(),
  allow_out_of_hours_override: z.boolean(),
  reason: z.string().min(8, "Reason ≥ 8 chars (audited).").default("Adjusted scheduling settings."),
});

export async function updateSchedulingSettingsAction(
  _prev: DoctorScheduleActionState,
  formData: FormData,
): Promise<DoctorScheduleActionState> {
  const parsed = SettingsSchema.safeParse({
    auto_confirm: formData.get("auto_confirm") === "true",
    default_slot_minutes: Number(formData.get("default_slot_minutes")),
    buffer_minutes: Number(formData.get("buffer_minutes")),
    allow_virtual: formData.get("allow_virtual") === "true",
    allow_out_of_hours_override: formData.get("allow_out_of_hours_override") === "true",
    reason: (formData.get("reason") as string | null) ?? undefined,
  });
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat().find(Boolean);
    return { error: first ?? "Check the values." };
  }
  const scope = await requireDoctorScope();
  const result = await callEdge(
    "ha-set-clinician-settings",
    { clinician_user_id: scope.userId, hospital_id: scope.hospitalId, ...parsed.data },
    "doctor.schedule",
  );
  if (!result.ok) return { error: result.error };
  revalidatePath("/doctor/schedule");
  return { ok: true };
}
