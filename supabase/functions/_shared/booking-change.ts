/**
 * Who may cancel or move a booking at the desk, and where a move may go
 * (ADR 0473). Read by `cancel-appointment` and `reschedule-appointment`.
 *
 * ZERO imports, like `slots.ts`: the rules are plain functions over rows the
 * Edge Function already read, so Vitest checks them without Deno.
 */

/** The cadre code `lib/reception/scope.ts` admits to /reception. */
export const RECEPTION_CADRE_CODE = "RECEPTION";

/** As `lib/auth/reachable-states.ts`: who may work, where. */
const REACHABLE_AFFILIATION_STATES = ["active", "approved"];
const REACHABLE_HOSPITAL_STATES = ["provisioning", "active"];

/** One of the caller's `staff_affiliations` rows, with its cadre code and hospital state. */
export interface CallerAffiliation {
  hospitalId: string;
  state: string;
  cadreCode: string | null;
  hospitalState: string | null;
}

/**
 * True when the caller works reception at THIS hospital: a RECEPTION-cadre
 * affiliation there that is approved, at a hospital that is live. A
 * receptionist elsewhere, or a nurse here, is not.
 */
export function receptionAt(rows: ReadonlyArray<CallerAffiliation>, hospitalId: string): boolean {
  return rows.some(
    (r) =>
      r.hospitalId === hospitalId &&
      r.cadreCode === RECEPTION_CADRE_CODE &&
      REACHABLE_AFFILIATION_STATES.includes(r.state) &&
      REACHABLE_HOSPITAL_STATES.includes(r.hospitalState ?? ""),
  );
}

/** Statuses a booking can still be moved from — `reschedule-appointment`'s RESCHEDULABLE. */
export const MOVABLE_STATUSES = ["requested", "pending_approval", "confirmed"] as const;

export interface MoveFrom {
  status: string;
  hospitalId: string;
  departmentId: string;
  /** The clinic day's line for a numbered booking; null for a timed one. */
  sessionLineId: string | null;
}

export type MoveTo =
  | { kind: "session"; hospitalId: string; serviceLineId: string }
  | { kind: "slot"; departmentId: string };

/**
 * Why this move may not happen, or null. A move stays in the same clinic: a
 * numbered booking goes to another day of the same line (as
 * `pt-accept-rebooking`), a timed one to another time in the same
 * department. Capacity, opening hours and the clinic-day number are the
 * booking core's checks, applied to the new booking as to any other.
 */
export function moveRefusal(from: MoveFrom, to: MoveTo): string | null {
  if (!(MOVABLE_STATUSES as readonly string[]).includes(from.status)) {
    return "This booking can no longer be moved.";
  }
  const sameClinic =
    to.kind === "session"
      ? from.sessionLineId !== null &&
        to.serviceLineId === from.sessionLineId &&
        to.hospitalId === from.hospitalId
      : from.sessionLineId === null && to.departmentId === from.departmentId;
  return sameClinic ? null : "Move it to another day of the same clinic.";
}
