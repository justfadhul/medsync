/**
 * The floor's visit ends as "Observed in EU" (Task 24, R70): written when the doctor's encounter of the visit takes
 * the stay over (ha-eu-stay send_to_eu; ha-complete-encounter for a triage stay), never at the triage send. Only a
 * visit the floor already has and has not finished, keyed by its intake; no name, room or note. The department is
 * the visit's, else the intake's receiving clinic. It never fails the caller: the error comes back to be logged.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.106.1";

export async function floorFinishEu(
  sb: SupabaseClient,
  hospitalId: string,
  intakeId: string,
  department: string | null,
  byUserId: string,
): Promise<{ code?: string } | null> {
  const seen = await sb.from("clinic_floor_events").select("kind").eq("intake_id", intakeId);
  if (
    seen.error ||
    !seen.data?.length ||
    seen.data.some((e: { kind: string }) => e.kind === "finish")
  )
    return seen.error;
  let departmentId = department;
  if (!departmentId) {
    const visit = await sb
      .from("patient_intakes")
      .select("receiving_department_id")
      .eq("id", intakeId)
      .maybeSingle();
    departmentId = visit.data?.receiving_department_id ?? null;
  }
  const ins = await sb.from("clinic_floor_events").insert({
    hospital_id: hospitalId,
    intake_id: intakeId,
    department_id: departmentId,
    kind: "finish",
    detail: "eu",
    client_id: crypto.randomUUID(),
    by_user_id: byUserId,
  });
  return ins.error;
}
