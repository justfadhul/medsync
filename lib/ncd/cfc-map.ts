import type { ClinicalFact } from "@/lib/facts/types";
import type { Assessed } from "@/lib/ncd/catalog/schema";
import type { CaptureMap, CaptureValue } from "@/lib/ncd/engine/evaluate";

import { isEntry, isSeries } from "@/lib/ncd/engine/evaluate";

/**
 * The NCD capture ↔ clinical fact bridge (HARMONISATION §5.3). PURE.
 *
 * The diabetes catalog (ADR 0082/0083) and the CFC catalogue describe some of the same things in
 * different words: `capillary_glucose` is `obs.glucose` on capillary blood, `polyuria` is the
 * finding `sx.polyuria`. This table is that overlap, written once, so
 *   - at signing, the NCD section of a note commits its values as facts (factsFromCapture), and
 *   - the NCD form pre-fills from facts recorded anywhere, not only at triage (captureFromFacts).
 *
 * Only honest mappings are listed. Where one side says less than the other, the direction that
 * would invent information is left out: a captured "dehydrated: yes" does not say whether it is
 * some or severe, so it is never written as a grade (only "no" → none is); a computed value (BMI,
 * eGFR) is derived from its inputs and never written from the form, only read back into it.
 * Nothing here is a threshold: values move, verdicts stay in their engines.
 */

type Presence = "present" | "absent";
type FactValue = { code: string } | { presence: Presence };

export type CfcValue =
  | { type: "quantity"; value: number; unit: string }
  | { type: "coded"; code: string }
  | { type: "presence"; presence: Presence };

/** One fact to write, in the shape lib/emr/write/facts.ts takes. */
export interface CfcObservation {
  conceptId: string;
  effectiveAt: string;
  value: CfcValue;
  /** Findings: elicitedBy; exams: laterality (the loader reads both from the context jsonb). */
  context?: Record<string, string>;
  specimen?: string;
  pointOfCare?: boolean;
}

type Scalar = string | boolean;

type Rule =
  | {
      feature: string;
      concept: string;
      kind: "quantity";
      /** The UCUM unit the feature's number is in (the NCD form's SI unit). */
      unit: string;
      /** Derived on read (BMI, eGFR): pre-filled from facts, never written from the form. */
      readOnly?: true;
      /** Captured as a timed series in the form (the vitals). */
      series?: true;
      specimen?: string;
      pointOfCare?: true;
    }
  | {
      feature: string;
      concept: string;
      kind: "select";
      /** Captured value (option, or "true"/"false") → fact value. Absent key = not written. */
      to: Record<string, FactValue & { laterality?: "bilateral" }>;
      /** Fact code or presence → captured value. Absent key = not pre-filled. */
      from: Record<string, Scalar>;
      elicitedBy?: "history" | "examination";
    };

const qty = (
  feature: string,
  concept: string,
  unit: string,
  extra: Partial<Extract<Rule, { kind: "quantity" }>> = {},
): Rule => ({ feature, concept, kind: "quantity", unit, ...extra });

/** A yes/no symptom or sign ↔ a presence finding. */
const flag = (feature: string, concept: string, elicitedBy: "history" | "examination"): Rule => ({
  feature,
  concept,
  kind: "select",
  to: { true: { presence: "present" }, false: { presence: "absent" } },
  from: { present: true, absent: false },
  elicitedBy,
});

/** A single-select whose options read as present / absent. */
const presenceSelect = (
  feature: string,
  concept: string,
  absent: string[],
  present: string[],
): Rule => ({
  feature,
  concept,
  kind: "select",
  to: Object.fromEntries([
    ...absent.map((o) => [o, { presence: "absent" as const }]),
    ...present.map((o) => [o, { presence: "present" as const }]),
  ]),
  // More than one option means "present": only the one-to-one side pre-fills.
  from: { absent: absent[0]!, ...(present.length === 1 ? { present: present[0]! } : {}) },
  elicitedBy: "examination",
});

const DIPSTICK_TO = {
  neg: "negative",
  trace: "trace",
  "1plus": "plus1",
  "2plus": "plus2",
  "3plus": "plus3",
};
const invert = (m: Record<string, string>) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k]));
const codes = (m: Record<string, string>) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { code: v }]));

export const NCD_CFC_RULES: readonly Rule[] = [
  // Measurements. The NCD units are numerically the CFC canonical ones (mmHg = mm[Hg], °C = Cel).
  qty("capillary_glucose", "obs.glucose", "mmol/L", {
    specimen: "capillary_whole_blood",
    pointOfCare: true,
  }),
  qty("hba1c", "obs.hba1c", "%"),
  qty("bp_systolic", "obs.bp_systolic", "mm[Hg]", { series: true }),
  qty("bp_diastolic", "obs.bp_diastolic", "mm[Hg]", { series: true }),
  qty("pulse", "obs.heart_rate", "/min", { series: true }),
  qty("respiratory_rate", "obs.resp_rate", "/min", { series: true }),
  qty("temperature", "obs.temperature", "Cel", { series: true }),
  qty("spo2", "obs.spo2", "%", { series: true }),
  qty("weight_kg", "obs.weight", "kg"),
  qty("height_cm", "obs.height", "cm"),
  qty("waist_cm", "obs.waist", "cm"),
  qty("bmi", "derived.bmi", "kg/m2", { readOnly: true }),
  qty("sodium", "obs.sodium", "mmol/L"),
  qty("urea", "obs.urea", "mmol/L"),
  qty("bicarbonate", "obs.bicarbonate", "mmol/L"),
  qty("egfr", "derived.egfr", "mL/min/{1.73_m2}", { readOnly: true }),
  qty("urine_acr", "obs.uacr", "mg/mmol"),
  qty("gcs_total", "obs.gcs", "{score}"),
  // Symptoms (history)
  flag("polyuria", "sx.polyuria", "history"),
  flag("polyuria_nocturia", "sx.nocturia", "history"),
  flag("polydipsia", "sx.polydipsia", "history"),
  flag("polyphagia", "sx.polyphagia", "history"),
  flag("unexplained_weight_loss", "sx.weight_loss_unintended", "history"),
  flag("fatigue", "sx.fatigue", "history"),
  flag("slow_healing_wound", "sx.slow_healing_wound", "history"),
  flag("vomiting", "sx.vomiting", "history"),
  flag("abdominal_pain", "sx.abdominal_pain", "history"),
  // Signs (examination)
  flag("deep_rapid_breathing", "sign.kussmaul_breathing", "examination"),
  flag("acetone_breath", "sign.ketotic_breath", "examination"),
  flag("pallor", "sign.pallor", "examination"),
  flag("jaundice", "sign.jaundice", "examination"),
  flag("acanthosis_nigricans", "sign.acanthosis_nigricans", "examination"),
  flag("lymphadenopathy", "sign.lymphadenopathy", "examination"),
  flag("peripheral_oedema", "sign.oedema", "examination"),
  flag("foot_deformity", "sign.foot_deformity", "examination"),
  flag("active_foot_ulcer", "sign.foot_ulcer", "examination"),
  presenceSelect("cyanosis", "sign.cyanosis", ["none"], ["peripheral", "central"]),
  presenceSelect("foot_callus", "sign.foot_callus", ["none"], ["callus", "callus_haemorrhage"]),
  presenceSelect(
    "foot_infection_grade",
    "sign.foot_infection",
    ["none"],
    ["mild", "moderate", "severe"],
  ),
  {
    // Boolean in the form, graded in the catalogue: only "no" has an honest grade.
    feature: "dehydration",
    concept: "sign.dehydration",
    kind: "select",
    to: { false: { code: "none" } },
    from: { none: false, some: true, severe: true },
    elicitedBy: "examination",
  },
  // Point-of-care and examination results
  {
    feature: "urine_ketones",
    concept: "obs.ketones_urine",
    kind: "select",
    to: codes(DIPSTICK_TO),
    from: invert(DIPSTICK_TO),
  },
  {
    feature: "urine_protein_strip",
    concept: "obs.urine_protein_dipstick",
    kind: "select",
    to: codes(DIPSTICK_TO),
    from: invert(DIPSTICK_TO),
  },
  {
    feature: "avpu",
    concept: "obs.avpu",
    kind: "select",
    to: codes({ alert: "alert", voice: "voice", pain: "pain", unresponsive: "unresponsive" }),
    from: { alert: "alert", voice: "voice", pain: "pain", unresponsive: "unresponsive" },
  },
  {
    feature: "pedal_pulses",
    concept: "exam.pedal_pulses",
    kind: "select",
    to: {
      both: { code: "present", laterality: "bilateral" },
      reduced: { code: "reduced" },
      absent: { code: "absent" },
    },
    from: { reduced: "reduced", absent: "absent" },
  },
  {
    // "Felt at every site on both feet" is normal on both sides; one foot does not say which.
    feature: "monofilament_10g",
    concept: "exam.monofilament",
    kind: "select",
    to: {
      none: { code: "normal", laterality: "bilateral" },
      one_foot: { code: "abnormal" },
      both_feet: { code: "abnormal", laterality: "bilateral" },
    },
    from: {},
  },
  {
    // The form grades the worse eye, so no laterality is claimed.
    feature: "retinopathy_stage",
    concept: "exam.retinopathy_grade",
    kind: "select",
    to: codes({
      none: "none",
      mild_npdr: "mild_npdr",
      moderate_npdr: "moderate_npdr",
      severe_npdr: "severe_npdr",
      pdr: "pdr",
    }),
    from: {},
  },
];

const recordedValue = (a: Assessed<CaptureValue> | undefined) =>
  a?.state === "recorded" ? a : undefined;

function selectKey(v: CaptureValue): string | undefined {
  if (typeof v === "boolean") return String(v);
  if (typeof v === "string") return v;
  if (isEntry(v)) return v.option;
  return undefined;
}

/** A quantity capture as readings: a series is its readings, a number is one at `at`. */
function readingsOf(
  a: Extract<Assessed<CaptureValue>, { state: "recorded" }>,
  at: string,
): { value: number; at: string }[] {
  if (isSeries(a.value)) return a.value.map((r) => ({ value: r.value, at: r.at }));
  return typeof a.value === "number" ? [{ value: a.value, at: a.at ?? at }] : [];
}

/** The facts an NCD capture commits at signing. `at` is the note's effective time; a value with
 *  its own time (a series reading, a timed entry) keeps it. `pulled` is what the form was pre-filled
 *  with from the record (triage, ward, lab): a reading still exactly as pulled (same value, same
 *  time) is already on the record, projected, so it is never written again as the clinician's own
 *  point-of-care value (HARMONISATION §5.1). */
export function factsFromCapture(
  values: CaptureMap,
  at: string,
  pulled: CaptureMap = {},
): CfcObservation[] {
  const out: CfcObservation[] = [];
  for (const rule of NCD_CFC_RULES) {
    const a = recordedValue(values[rule.feature]);
    if (!a) continue;
    const effectiveAt = a.at ?? at;
    if (rule.kind === "quantity") {
      if (rule.readOnly) continue;
      const p = recordedValue(pulled[rule.feature]);
      const fromRecord = p ? readingsOf(p, "") : [];
      for (const r of readingsOf(a, effectiveAt)) {
        if (!Number.isFinite(r.value)) continue;
        if (fromRecord.some((x) => x.value === r.value && x.at === r.at)) continue;
        out.push({
          conceptId: rule.concept,
          effectiveAt: r.at,
          value: { type: "quantity", value: r.value, unit: rule.unit },
          ...(rule.specimen ? { specimen: rule.specimen } : {}),
          ...(rule.pointOfCare ? { pointOfCare: true } : {}),
        });
      }
      continue;
    }
    const key = selectKey(a.value);
    const mapped = key === undefined ? undefined : rule.to[key];
    if (!mapped) continue;
    const context: Record<string, string> = {};
    if (rule.elicitedBy) context.elicitedBy = rule.elicitedBy;
    if (mapped.laterality) context.laterality = mapped.laterality;
    out.push({
      conceptId: rule.concept,
      effectiveAt,
      value:
        "presence" in mapped
          ? { type: "presence", presence: mapped.presence }
          : { type: "coded", code: mapped.code },
      ...(Object.keys(context).length ? { context } : {}),
    });
  }
  return out;
}

const effectiveOf = (f: ClinicalFact): string =>
  "at" in f.effective ? f.effective.at : f.effective.start;

/**
 * Pre-fill for the NCD form: the newest usable fact per mapped concept, recorded anywhere (facts
 * are already restricted to what the reader may see). A quantity with a comparator ("<0.5") is not
 * a number the form can hold, so it is left for the clinician. Voided facts never pre-fill.
 */
export function captureFromFacts(facts: readonly ClinicalFact[]): CaptureMap {
  const newest = new Map<string, ClinicalFact>();
  for (const f of facts) {
    if (f.status === "entered_in_error" || f.status === "cancelled") continue;
    const cur = newest.get(f.concept);
    if (!cur || effectiveOf(f) > effectiveOf(cur)) newest.set(f.concept, f);
  }
  const out: CaptureMap = {};
  for (const rule of NCD_CFC_RULES) {
    const f = newest.get(rule.concept);
    if (!f) continue;
    const at = effectiveOf(f);
    if (rule.kind === "quantity") {
      if (f.kind !== "observation" || f.value.type !== "quantity" || f.value.comparator) continue;
      const value = f.value.canonical.value;
      out[rule.feature] = { state: "recorded", value: rule.series ? [{ value, at }] : value, at };
      continue;
    }
    const key =
      f.kind === "finding"
        ? f.presence
        : f.kind === "observation" && f.value.type === "coded"
          ? f.value.code
          : undefined;
    const value = key === undefined ? undefined : rule.from[key];
    if (value !== undefined) out[rule.feature] = { state: "recorded", value, at };
  }
  return out;
}

/** The note section that carries the NCD capture: `{ items: [{ kind: "ncd_capture", values }] }`. */
export const NCD_NOTE_SECTION = "ncd";

export function captureFromNote(
  content: {
    sections: Record<string, { items?: { kind: string; [k: string]: unknown }[] }>;
  },
  /** `pulled`: what the form was pre-filled with from the record (kept beside the values). */
  field: "values" | "pulled" = "values",
): CaptureMap | undefined {
  const item = content.sections[NCD_NOTE_SECTION]?.items?.find((i) => i.kind === "ncd_capture");
  const values = item?.[field];
  return values && typeof values === "object" ? (values as CaptureMap) : undefined;
}
