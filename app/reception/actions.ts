"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireReceptionScope } from "@/lib/reception/scope";
import { callEdge } from "@/lib/supabase/edge";

/**
 * Reception server actions. Thin wrappers around the Edge Functions
 * (ha-check-in-patient, ha-cancel-intake). The Edge Functions own
 * auth + audit; these wrappers handle scope-pin + form parsing +
 * revalidation.
 */

export type ReceptionActionState = {
  ok?: boolean;
  error?: string;
  /** Where a check-in sent the patient — the function's word when it gives one. */
  route?: ArrivalRoute;
};

type ArrivalRoute = "triage" | "clinic";

/**
 * Where the desk sends an arrival (ADR 0101): triage unless the clerk pressed
 * "Send to clinic", and optionally another department at this hospital. The
 * Edge Function owns the rules (an emergency entry is always triaged, the
 * department must be here); this only refuses a clinic with no department,
 * which would queue the patient nowhere.
 */
const RouteFields = {
  route: z.enum(["triage", "clinic"]).default("triage"),
  department_id: z.string().uuid().optional(),
};
const clinicHasDepartment = (v: { route: ArrivalRoute; department_id?: string }) =>
  v.route !== "clinic" || !!v.department_id;
const CLINIC_NEEDS_DEPARTMENT = { message: "Choose the clinic's department first." };

/** The route fields as a form sends them: an empty select is "no department". */
function routeFrom(formData: FormData) {
  return {
    route: formData.get("route") ?? undefined,
    department_id: formData.get("department_id") || undefined,
  };
}

/* ─── Check-in a booked patient ─────────────────────────────────── */

const CheckInSchema = z
  .object({
    appointment_id: z.string().uuid(),
    reason: z
      .string()
      .min(8, "Reason ≥ 8 chars (audited).")
      .default("Booked patient checked in at front desk."),
    ...RouteFields,
  })
  .refine(clinicHasDepartment, CLINIC_NEEDS_DEPARTMENT);

export async function checkInPatientAction(
  _prev: ReceptionActionState,
  formData: FormData,
): Promise<ReceptionActionState> {
  const parsed = CheckInSchema.safeParse({
    appointment_id: formData.get("appointment_id"),
    reason: formData.get("reason") ?? undefined,
    ...routeFrom(formData),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  await requireReceptionScope();
  const result = await callEdge<{ data?: { route?: ArrivalRoute } }>(
    "ha-check-in-patient",
    parsed.data,
    "reception",
  );
  if (!result.ok) return { error: result.error };
  revalidatePath("/reception");
  revalidatePath("/reception/expected");
  revalidatePath("/reception/flow");
  return { ok: true, route: result.data?.data?.route ?? parsed.data.route };
}

/* ─── Check-in a declared (patient-initiated) intake ───────────── */

const CheckInDeclaredSchema = z
  .object({
    intake_id: z.string().uuid(),
    reason: z
      .string()
      .min(8, "Reason ≥ 8 chars (audited).")
      .default("Patient-declared queue ticket checked in at front desk."),
    ...RouteFields,
  })
  .refine(clinicHasDepartment, CLINIC_NEEDS_DEPARTMENT);

/**
 * Reception flips a patient-declared 'declared' intake to 'arrived'
 * + stamps checked_in_at + inserts the dept queue row. Same Edge
 * Function as appointment check-in; just dispatched by intake_id
 * (book-or-queue, migration 0035).
 */
export async function checkInDeclaredIntakeAction(
  _prev: ReceptionActionState,
  formData: FormData,
): Promise<ReceptionActionState> {
  const parsed = CheckInDeclaredSchema.safeParse({
    intake_id: formData.get("intake_id"),
    reason: formData.get("reason") ?? undefined,
    ...routeFrom(formData),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  await requireReceptionScope();
  const result = await callEdge<{ data?: { route?: ArrivalRoute } }>(
    "ha-check-in-patient",
    parsed.data,
    "reception",
  );
  if (!result.ok) return { error: result.error };
  revalidatePath("/reception");
  revalidatePath("/reception/expected");
  revalidatePath("/reception/find");
  revalidatePath("/reception/flow");
  return { ok: true, route: result.data?.data?.route ?? parsed.data.route };
}

/** A refine's message has no field, so `fieldErrors` would drop it; the first issue never does. */
function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the values.";
}

/* ─── Cancel an intake ──────────────────────────────────────────── */

const CancelIntakeSchema = z.object({
  intake_id: z.string().uuid(),
  reason: z.string().min(8, "Reason ≥ 8 chars (audited)."),
});

export async function cancelIntakeAction(
  _prev: ReceptionActionState,
  formData: FormData,
): Promise<ReceptionActionState> {
  const parsed = CancelIntakeSchema.safeParse({
    intake_id: formData.get("intake_id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat().find(Boolean);
    return { error: first ?? "Please check the values." };
  }
  await requireReceptionScope();
  const result = await callEdge("ha-cancel-intake", parsed.data, "reception");
  if (!result.ok) return { error: result.error };
  revalidatePath("/reception");
  revalidatePath("/reception/flow");
  return { ok: true };
}

/* ─── Mark a booked patient no-show ─────────────────────────────── */

const NoShowSchema = z.object({
  appointment_id: z.string().uuid(),
  reason: z.string().min(8, "Reason ≥ 8 chars (audited)."),
});

/**
 * Reception marks a confirmed, past-start booking as no_show. The Edge
 * Function admits any active/approved affiliation at the appointment's
 * hospital (Gate A′ (d)); the reason is typed, not defaulted — a no-show
 * is a status the patient cannot undo, so the audit row says why.
 */
export async function markNoShowAction(
  _prev: ReceptionActionState,
  formData: FormData,
): Promise<ReceptionActionState> {
  const parsed = NoShowSchema.safeParse({
    appointment_id: formData.get("appointment_id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat().find(Boolean);
    return { error: first ?? "Please check the values." };
  }
  await requireReceptionScope();
  const result = await callEdge("ha-mark-no-show", parsed.data, "reception");
  if (!result.ok) return { error: result.error };
  revalidatePath("/reception");
  revalidatePath("/reception/expected");
  revalidatePath("/reception/flow");
  return { ok: true };
}

/* ─── Confirm who a provisional booking is for (Gate D, PRD §2.8) ── */

const ReconcileSchema = z
  .object({
    provisional_patient_id: z.string().uuid(),
    action: z.enum(["confirm", "reject"]),
    patient_user_id: z.string().uuid().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((i) => i.action !== "confirm" || !!i.patient_user_id, {
    message: "Choose the patient this booking is for.",
  });

/**
 * Confirm or reject a candidate match. The chosen `patient_user_id` is
 * whichever card the clerk pressed — nothing here picks one, and the panel
 * never pre-selects one (a wrong merge is a wrong chart). Un-reconcile is a
 * hospital-admin action and has no control on this surface.
 */
export async function reconcileIdentityAction(
  _prev: ReceptionActionState,
  formData: FormData,
): Promise<ReceptionActionState> {
  const parsed = ReconcileSchema.safeParse({
    provisional_patient_id: formData.get("provisional_patient_id"),
    action: formData.get("action"),
    patient_user_id: formData.get("patient_user_id") || undefined,
    reason: formData.get("reason") || undefined,
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message;
    return { error: first ?? "Please check the values." };
  }
  const scope = await requireReceptionScope();
  const result = await callEdge(
    "ha-reconcile-identity",
    { ...parsed.data, hospital_id: scope.hospitalId },
    "reception",
  );
  if (!result.ok) return { error: result.error };
  revalidatePath("/reception");
  revalidatePath("/reception/expected");
  revalidatePath("/reception/flow");
  return { ok: true };
}
