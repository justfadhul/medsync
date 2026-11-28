/**
 * Running the ward (ADR 0545 Phase 4): the standing state of append-only rows. Pure, shared by pages and tests.
 */
interface Replaceable {
  id: string;
  replacesId: string | null;
}

/** Rows not ended by a later row naming them. */
export function standing<T extends Replaceable>(rows: T[]): T[] {
  const ended = new Set(rows.map((r) => r.replacesId).filter(Boolean));
  return rows.filter((r) => !ended.has(r.id));
}

/** Each person's latest attendance word for an event. */
export function attendance<T extends { userId: string; kind: string; recordedAt: Date }>(
  rows: T[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of [...rows].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime()))
    out.set(r.userId, r.kind);
  return out;
}

/** Reported incidents (not withdrawn) by kind. */
export function incidentCounts<T extends Replaceable & { kind: string; state: string }>(
  rows: T[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of standing(rows)) if (r.state === "reported") out[r.kind] = (out[r.kind] ?? 0) + 1;
  return out;
}

export const CAL_KINDS = {
  ward_meeting: "Ward meeting",
  teaching: "Teaching",
  audit: "Audit",
  infection_control: "Infection control",
  stock: "Stock and equipment",
  department_meeting: "Department meeting",
  mortality_audit: "Mortality audit",
  clinic: "Clinic",
  other: "Other",
} as const;
export const LEAVE_KINDS = {
  annual: "Annual leave",
  sick: "Sick leave",
  study: "Study leave",
  maternity: "Maternity leave",
  compassionate: "Compassionate leave",
  other: "Other",
} as const;
export const INCIDENT_KINDS = {
  fall: "Fall",
  pressure_injury: "Pressure injury",
  medication: "Medication incident",
  other: "Other",
} as const;
export const HARM = {
  none: "No harm",
  low: "Low harm",
  moderate: "Moderate harm",
  severe: "Severe harm",
  death: "Death",
} as const;
