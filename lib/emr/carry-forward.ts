import type { AllergyStatus } from "./allergy";
import type { Condition, MedicationStatement } from "@/db/schema/emr";
import type { TriageRecord } from "@/db/schema/triage";
import type { AcuityLevel } from "@/lib/triage/types";

/**
 * What a new encounter pre-fills (PROMPT §5.12, note-templates rules.noCopyForward). PURE.
 *
 * - From triage: acuity, the complaint and the fired discriminators, with zero taps, each marked
 *   with its source. Vital signs are already observations: they are SHOWN from the record (a
 *   reference to the triage record), never copied into the note.
 * - From the record: the problem list, the allergy status and current medicines, each as a
 *   "still true?" item pending a one-tap confirm, stop or change. Nothing is re-asserted until the
 *   clinician answers.
 * - Narrative never carries forward.
 */

export type CarrySource = { kind: "triage"; triageRecordId: string; at: Date } | { kind: "record" };

export interface TriagePrefill {
  acuity: { level: AcuityLevel; source: CarrySource };
  complaint: { text: string; source: CarrySource } | null;
  discriminators: { code: string; label: string; source: CarrySource }[];
  /** Shown from the record, never copied (the loader projects the triage vitals snapshot). */
  vitals: { mode: "shown_from_record"; triageRecordId: string };
}

type TriageInput = Pick<TriageRecord, "id" | "assignedLevel" | "triagedAt" | "computedBreakdown">;

function firedDiscriminators(breakdown: unknown): { code: string; label: string }[] {
  const fired = (breakdown as { firedDiscriminators?: unknown } | null)?.firedDiscriminators;
  if (!Array.isArray(fired)) return [];
  return fired.filter(
    (d): d is { code: string; label: string } =>
      !!d && typeof d === "object" && typeof d.code === "string" && typeof d.label === "string",
  );
}

/** Triage → encounter. The complaint is the intake's presenting complaint (the triage record has
 *  none of its own). */
export function triagePrefill(
  triage: TriageInput,
  presentingComplaint: string | null,
): TriagePrefill {
  const source: CarrySource = { kind: "triage", triageRecordId: triage.id, at: triage.triagedAt };
  const complaint = presentingComplaint?.trim();
  const seen = new Set<string>();
  return {
    acuity: { level: triage.assignedLevel as AcuityLevel, source },
    complaint: complaint ? { text: complaint, source } : null,
    discriminators: firedDiscriminators(triage.computedBreakdown)
      .filter((d) => !seen.has(d.code) && seen.add(d.code))
      .map((d) => ({ code: d.code, label: d.label, source })),
    vitals: { mode: "shown_from_record", triageRecordId: triage.id },
  };
}

/* ─── "Still true?" items ─────────────────────────────────────────── */

export type StillTrueAnswer = "pending" | "confirmed" | "stopped" | "changed";

export interface CarriedItem<T> {
  kind: "problem" | "medicine" | "allergy_status";
  /** logical_id for facts; "allergy_status" for the status line. */
  key: string;
  item: T;
  answer: StillTrueAnswer;
  source: CarrySource;
}

type ConditionRow = Pick<
  Condition,
  | "id"
  | "logicalId"
  | "version"
  | "category"
  | "subjectRelation"
  | "clinicalStatus"
  | "verification"
  | "status"
>;
type MedicineRow = Pick<
  MedicationStatement,
  "id" | "logicalId" | "version" | "medicationStatus" | "status"
>;

function newest<R extends { logicalId: string; version: number }>(rows: R[]): R[] {
  const m = new Map<string, R>();
  for (const r of rows) if ((m.get(r.logicalId)?.version ?? 0) < r.version) m.set(r.logicalId, r);
  return [...m.values()];
}

const voided = (status: string) => status === "entered_in_error" || status === "cancelled";
const pending = <T>(kind: CarriedItem<T>["kind"], key: string, item: T): CarriedItem<T> => ({
  kind,
  key,
  item,
  answer: "pending",
  source: { kind: "record" },
});

/** The patient's own active problem-list items (family history and encounter diagnoses stay put). */
export function carryProblems<R extends ConditionRow>(rows: R[]): CarriedItem<R>[] {
  return newest(rows)
    .filter(
      (c) =>
        !voided(c.status) &&
        c.category === "problem_list_item" &&
        c.subjectRelation === "self" &&
        c.verification !== "refuted" &&
        ["active", "recurrence", "relapse"].includes(c.clinicalStatus),
    )
    .map((c) => pending("problem", c.logicalId, c));
}

/** Current medicines: active, on hold or intended (what a patient may still be taking). */
export function carryMedicines<R extends MedicineRow>(rows: R[]): CarriedItem<R>[] {
  return newest(rows)
    .filter(
      (m) => !voided(m.status) && ["active", "on_hold", "intended"].includes(m.medicationStatus),
    )
    .map((m) => pending("medicine", m.logicalId, m));
}

/**
 * The allergy status line. NKDA is re-confirmed with one tap at each new encounter (clinical
 * reference [05]); listed allergies and unable-to-assess carry as they are, pending review;
 * "not recorded" carries nothing (there is nothing to confirm; the prompt asks instead).
 */
export function carryAllergyStatus(status: AllergyStatus): CarriedItem<AllergyStatus> | null {
  return status.kind === "not_recorded"
    ? null
    : pending("allergy_status", "allergy_status", status);
}

/**
 * One tap. Allowed answers per kind: a problem is confirmed, or stopped (resolved) or changed;
 * a medicine is confirmed (continued), stopped or changed; the allergy status is confirmed or
 * changed (stopping a status is not a thing: it is changed by recording an allergy or assertion).
 * Answering again replaces the earlier answer until the note is signed; "pending" undoes.
 */
export function answerStillTrue<T>(item: CarriedItem<T>, answer: StillTrueAnswer): CarriedItem<T> {
  if (item.kind === "allergy_status" && answer === "stopped") {
    throw new Error("the allergy status is changed, not stopped");
  }
  return { ...item, answer };
}

/** The reconciliation value to write for an answered medicine (medication_statements.reconciliation). */
export function reconciliationFor(
  answer: StillTrueAnswer,
): "continued" | "stopped" | "changed" | null {
  return answer === "confirmed" ? "continued" : answer === "pending" ? null : answer;
}

/** Items still waiting for an answer (the sign sheet's "medicines not reconciled" reads this). */
export function unanswered<T>(items: CarriedItem<T>[]): CarriedItem<T>[] {
  return items.filter((i) => i.answer === "pending");
}
