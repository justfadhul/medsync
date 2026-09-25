import type { PatientFlowRow } from "./flow";

/** "N updates" behind the held-list pill: patients that arrived, left, or changed lane, next step or acuity. */
export function countChanges(before: PatientFlowRow[], after: PatientFlowRow[]): number {
  const sig = (r: PatientFlowRow) => `${r.lane}|${r.primary?.kind}|${r.acuity.level}`;
  const was = new Map(before.map((r) => [r.key, sig(r)]));
  const now = new Set(after.map((r) => r.key));
  let n = 0;
  for (const r of after) if (was.get(r.key) !== sig(r)) n++;
  for (const r of before) if (!now.has(r.key)) n++;
  return n;
}

/**
 * What the board's polite live region may say (prompt §10), and nothing else:
 * a patient newly waiting for the viewer, or newly in Resus. An arrest is
 * announced assertively by the global ArrestAlarm, not here.
 */
export function arrivals(before: PatientFlowRow[], after: PatientFlowRow[]): PatientFlowRow[] {
  const was = new Map(before.map((r) => [r.key, r.lane]));
  return after.filter(
    (r) =>
      was.get(r.key) !== r.lane &&
      (r.lane === "resus" || (r.lane === "waiting" && r.owner?.me === true)),
  );
}
