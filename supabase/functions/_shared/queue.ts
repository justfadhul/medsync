/**
 * The clinic queue's one writer of new rows, and the arrival route rule
 * (ADR 0101). Lifted from ha-check-in-patient so check-in and the front
 * door's registration number a department's day the same way.
 *
 * `sequence_number` is the department's arrivals today + 1, counted on the
 * hospital's day (UTC midnight would restart numbering at 03:00 EAT).
 * ponytail: count+1 with no lock — two simultaneous arrivals in one
 * department can share a number; the doctor rail breaks ties on arrived_at.
 * Upgrade path: an atomic per-department counter like clinic_sessions.next_position.
 * A row moved to another department keeps its old number the same way.
 */
import type { serviceClient } from "./auth.ts";

import { makeLogger } from "./logger.ts";
import { DEFAULT_TIME_ZONE, startOfLocalDay } from "./slots.ts";

const log = makeLogger("queue");

/** Where the desk sends an arrival: triage (default), or straight to the clinic's queue. */
export type ArrivalRoute = "triage" | "clinic";

/**
 * ADR 0101 safeguard: an emergency entry is always triaged, whatever the desk
 * picked — the clinic door is for patients who are not an emergency.
 */
export function effectiveRoute(requested: ArrivalRoute, isEmergency: boolean): ArrivalRoute {
  return isEmergency ? "triage" : requested;
}

/**
 * The intake status each route leaves behind. Triage keeps the worklist's own
 * word; clinic is "arrived" — here, and not waiting for triage. `routed_to`
 * (migration 0067) carries the choice itself.
 */
export function intakeStatusFor(route: ArrivalRoute): "awaiting_triage" | "arrived" {
  return route === "triage" ? "awaiting_triage" : "arrived";
}

export async function insertQueueRow(
  sb: ReturnType<typeof serviceClient>,
  args: {
    hospital_id: string;
    department_id: string | null;
    patient_user_id: string | null;
    appointment_id: string | null;
    kind: "scheduled_arrival" | "walk_in" | "urgent_walk_in";
    requestId: string;
  },
): Promise<string | null> {
  // No department or no patient → no clinic line to join (queue_entries needs both).
  if (!args.department_id || !args.patient_user_id) return null;

  // One booking, one place in line. A patient who tapped "I have arrived"
  // (ha-mark-arrived) already holds a row; the desk's check-in or a
  // registration against the same booking reuses it — moved to the desk's
  // department, keeping its arrival time — instead of queueing them twice.
  if (args.appointment_id) {
    const { data: live } = await sb
      .from("queue_entries")
      .select("id, department_id")
      .eq("appointment_id", args.appointment_id)
      .in("state", ["waiting", "being_seen"])
      .limit(1)
      .maybeSingle();
    if (live) {
      if (live.department_id !== args.department_id) {
        const { error: moveError } = await sb
          .from("queue_entries")
          .update({ department_id: args.department_id })
          .eq("id", live.id)
          .eq("state", "waiting");
        if (moveError) {
          log.warn("queue move failed (continuing)", {
            requestId: args.requestId,
            reason: moveError.message,
          });
        }
      }
      return live.id as string;
    }
  }

  const startOfDay = startOfLocalDay(new Date(), DEFAULT_TIME_ZONE);
  const { count } = await sb
    .from("queue_entries")
    .select("id", { count: "exact", head: true })
    .eq("hospital_id", args.hospital_id)
    .eq("department_id", args.department_id)
    .gte("arrived_at", startOfDay.toISOString());

  const { data: row, error } = await sb
    .from("queue_entries")
    .insert({
      hospital_id: args.hospital_id,
      department_id: args.department_id,
      appointment_id: args.appointment_id,
      patient_user_id: args.patient_user_id,
      kind: args.kind,
      state: "waiting",
      sequence_number: (count ?? 0) + 1,
    })
    .select("id")
    .single();
  if (error) {
    log.warn("queue insert failed (continuing)", {
      requestId: args.requestId,
      reason: error.message,
    });
    return null;
  }
  return (row?.id as string | undefined) ?? null;
}
