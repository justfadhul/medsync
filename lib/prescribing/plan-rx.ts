/**
 * A prescription from the Plan (ADR 0186): the draft the dialog builds, what it will read as in the
 * note, and the edits made to a signed regimen. Pure; the server re-validates the same schema and
 * recomputes the edits and checks on place.
 */
import type { ResolvedRegimen } from "./formulary";
import type { Drug, Regimen, RxCourse, RxFrequency } from "./reference/formulary-types";
import { z } from "zod";

import { dropsPerMinute, mlPerHour } from "@/lib/emr/charts/fluids";
import {
  DOSE_UNITS,
  FORMULARY_ROUTES,
  RX_COURSES,
  RX_FREQUENCIES,
} from "./reference/formulary-types";

export const INFUSION_OVER = ["15 min", "30 min", "60 min"] as const;
export const DILUENTS = ["Sodium chloride 0.9%", "Glucose 5%", "Water for injection"] as const;
export const FLUID_PURPOSES = ["bolus", "maintenance", "replacement"] as const;
export type FluidPurpose = (typeof FLUID_PURPOSES)[number];

/** Answer chips (draft wording for the CSO). Override: a stop; check: a caution. */
export const OVERRIDE_REASONS = {
  not_allergic: "Previous reaction was not allergic",
  senior_agreed: "Senior reviewed and agreed",
  no_alternative: "No suitable alternative available",
  other: "Other, I will write it",
} as const;
export const CHECK_REASONS = {
  aware_monitor: "Aware; will monitor",
  senior_agreed: "Senior reviewed and agreed",
  result_awaited: "Result awaited; will review",
  other: "Other, I will write it",
} as const;
/** D-PH1-22: the one answer to a stock Check (the other choice, "Pick something else", answers nothing). */
export const STOCK_REASONS = { prescribe_anyway: "Aware; prescribe anyway" } as const;
export type AnswerId =
  | keyof typeof OVERRIDE_REASONS
  | keyof typeof CHECK_REASONS
  | keyof typeof STOCK_REASONS;
const ANSWER_IDS = [
  "not_allergic",
  "senior_agreed",
  "no_alternative",
  "aware_monitor",
  "result_awaited",
  "other",
  "prescribe_anyway",
] as const satisfies readonly AnswerId[];

export const PlanRxAnswer = z.object({
  code: z.string().trim().min(1).max(40),
  answer: z.enum(ANSWER_IDS),
  /** Written only for "Other"; stored encrypted with the reason. */
  text: z.string().trim().max(500).optional(),
});
export type PlanRxAnswer = z.infer<typeof PlanRxAnswer>;

export const PlanRxFluid = z.object({
  purpose: z.enum(FLUID_PURPOSES),
  volumeMl: z.number().positive().max(10000),
  overMinutes: z
    .number()
    .int()
    .positive()
    .max(24 * 60),
  delivery: z.enum(["pump", "gravity"]),
  dropsPerMl: z.union([z.literal(20), z.literal(60)]).nullable(),
  warmed: z.boolean(),
});
export type PlanRxFluid = z.infer<typeof PlanRxFluid>;

/**
 * Pharmacy Phase 1 (5.4, H4, HZ-PH1-45): this line changes a placed one in answer to the pharmacy. The
 * placement cancels the old line naming this one, in the same transaction, or places nothing.
 */
export const PlanRxReplaces = z.object({
  lineId: z.uuid(),
  /** The query's id, or the not-supplied line event's. */
  ref: z.uuid(),
  kind: z.enum(["query", "notice"]),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Pharmacy Phase 4 (5.2, RP-1): the prescriber's typed repeat terms; the system computes no quantity or date. */
export const PlanRxRepeats = z.object({
  furtherSupplies: z.number().int().min(1).max(99),
  minIntervalDays: z.number().int().min(1).max(3660),
  notAfter: isoDate,
  reviewBy: isoDate.nullable(),
});
export type PlanRxRepeats = z.infer<typeof PlanRxRepeats>;

export const PlanRxSchema = z.object({
  clientKey: z.string().trim().min(8).max(120),
  kind: z.enum(["drug", "fluid"]),
  drugId: z.string().trim().min(1).max(80),
  /** The problem: a conditions version id (null only for a problem not yet on the record). */
  conditionId: z.uuid().nullable(),
  regimenId: z.string().trim().max(120).nullable(),
  doseNum: z.number().positive().max(1_000_000).nullable(),
  unit: z.enum(DOSE_UNITS),
  strength: z.string().trim().max(40).nullable(),
  route: z.enum(FORMULARY_ROUTES),
  method: z.string().trim().max(120).nullable(),
  infusionOver: z.enum(INFUSION_OVER).nullable(),
  diluent: z.enum(DILUENTS).nullable(),
  frequency: z.enum(RX_FREQUENCIES),
  prn: z.boolean(),
  course: z.enum(RX_COURSES).nullable(),
  start: z.enum(["now", "next_round"]),
  note: z.string().trim().max(500).nullable(),
  fluid: PlanRxFluid.nullable(),
  answers: z.array(PlanRxAnswer).max(20),
  /** Controlled drug: the witness's name or staff ID. */
  witness: z.string().trim().max(120).nullable(),
  /** The time of the vitals weight a per-kg dose was worked out from. */
  weightAt: z.string().max(40).nullable(),
  /** The typed dose, when the dose check calls the dose egregious. */
  typedDose: z.number().nullable(),
  replaces: PlanRxReplaces.optional(),
  /** Pharmacy Phase 4: repeats for this line (RP-1), and the renewal request this placement answers (RN-3). */
  repeats: PlanRxRepeats.nullable().optional(),
  renewalId: z.uuid().optional(),
  /** Prescribing kit F2 (PRESCRIBE_V2): the brand chosen (pharmacy_products id); absent = any brand. */
  productId: z.uuid().nullable().optional(),
});
export type PlanRx = z.infer<typeof PlanRxSchema>;

/* ─── Words ──────────────────────────────────────────────────────── */

export const FREQUENCY_WORD: Record<RxFrequency, string> = {
  stat: "Once (stat)",
  daily: "Once daily",
  "12h": "12-hourly",
  "8h": "8-hourly",
  "6h": "6-hourly",
  "4h": "4-hourly",
};

export const COURSE_WORD: Record<RxCourse, string> = {
  single: "Single dose",
  "3d": "3 days",
  "5d": "5 days",
  "7d": "7 days",
  "14d": "14 days",
  until_review: "Until review",
};

export const ROUTE_WORD: Record<string, string> = {
  oral: "oral",
  iv: "IV",
  im: "IM",
  sc: "SC",
  pr: "PR",
  inhaled: "inhaled",
  nebulised: "nebulised",
  topical: "topical",
  sublingual: "sublingual",
  buccal: "buccal",
  intranasal: "intranasal",
  infusion: "IV infusion",
};

export const PURPOSE_WORD: Record<FluidPurpose, string> = {
  bolus: "Bolus",
  maintenance: "Maintenance",
  replacement: "Replacement",
};

const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** "8 h", "30 min", "1 h 30 min". */
export function durationWords(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export interface FluidRate {
  mlPerHour: number | null;
  dropsPerMinute: number | null;
}

export function fluidRate(f: PlanRxFluid): FluidRate {
  const rate = mlPerHour(f.volumeMl, { value: f.overMinutes, unit: "min" });
  return {
    mlPerHour: rate,
    dropsPerMinute:
      f.delivery === "gravity" && f.dropsPerMl && rate != null
        ? dropsPerMinute(rate, f.dropsPerMl)
        : null,
  };
}

/** The prescription as it will read in the note. */
export function willRead(rx: PlanRx, drug: Pick<Drug, "generic">): string {
  if (rx.kind === "fluid" && rx.fluid) {
    const f = rx.fluid;
    const rate = fluidRate(f);
    const parts = [
      `${drug.generic} ${num(f.volumeMl)} mL IV over ${durationWords(f.overMinutes)}`,
      rate.mlPerHour != null ? `(${num(rate.mlPerHour)} mL/h)` : null,
    ].filter(Boolean);
    const how =
      f.delivery === "pump"
        ? "infusion pump"
        : `gravity drip, ${f.dropsPerMl ?? "?"}-drop set${rate.dropsPerMinute != null ? ` (${rate.dropsPerMinute} drops/min)` : ""}`;
    const tail = [PURPOSE_WORD[f.purpose].toLowerCase(), how, f.warmed ? "warmed" : null];
    return `${parts.join(" ")}, ${tail.filter(Boolean).join(", ")}${rx.start === "next_round" ? ", from the next round" : ""}`;
  }
  const dose = rx.doseNum != null ? `${num(rx.doseNum)} ${rx.unit}` : `[dose] ${rx.unit}`;
  // "Glucose 10% 150 mL", not "… of 10%" when the name already carries the strength.
  const strength = rx.strength && !drug.generic.includes(rx.strength) ? ` of ${rx.strength}` : "";
  const how = [
    rx.method ? rx.method.toLowerCase() : null,
    rx.infusionOver ? `over ${rx.infusionOver}` : null,
    rx.diluent ? `in ${rx.diluent}` : null,
  ].filter(Boolean);
  const when = rx.prn
    ? rx.frequency === "stat"
      ? "as needed"
      : `${FREQUENCY_WORD[rx.frequency]} as needed`
    : FREQUENCY_WORD[rx.frequency];
  return [
    `${drug.generic} ${dose}${strength} ${ROUTE_WORD[rx.route] ?? rx.route}`,
    how.length ? how.join(" ") : null,
    when,
    rx.course ? COURSE_WORD[rx.course] : null,
    rx.start === "next_round" ? "from the next drug round" : "give now",
  ]
    .filter(Boolean)
    .join(", ");
}

/* ─── Edits against the regimen ──────────────────────────────────── */

export interface RxEdit {
  field: "dose" | "unit" | "strength" | "route" | "method" | "frequency" | "course";
  from: string;
  to: string;
}

export const EDIT_FIELD_WORD: Record<RxEdit["field"], string> = {
  dose: "Dose",
  unit: "Unit",
  strength: "Strength",
  route: "Route",
  method: "How given",
  frequency: "How often",
  course: "Course",
};

/**
 * What the prescriber changed from the regimen they chose. A dose inside a signed range (a bolus of
 * 250–500 mL) is a choice, not an edit; outside it is. A per-kg dose is compared with the dose
 * worked out from the vitals weight.
 */
export function regimenEdits(rx: PlanRx, resolved: ResolvedRegimen | null): RxEdit[] {
  if (!resolved) return [];
  const r: Regimen = resolved.regimen;
  const out: RxEdit[] = [];
  const dose = rx.kind === "fluid" ? (rx.fluid?.volumeMl ?? null) : rx.doseNum;
  const d = resolved.dose;
  if (d.num != null && dose !== d.num)
    out.push({
      field: "dose",
      from: `${num(d.num)} ${d.unit}`,
      to: dose != null ? `${num(dose)} ${rx.unit}` : "blank",
    });
  else if (d.low != null && d.high != null && (dose == null || dose < d.low || dose > d.high))
    out.push({
      field: "dose",
      from: `${num(d.low)}–${num(d.high)} ${d.unit}`,
      to: dose != null ? `${num(dose)} ${rx.unit}` : "blank",
    });
  if (rx.unit !== r.unit) out.push({ field: "unit", from: r.unit, to: rx.unit });
  if ((r.strength ?? null) !== (rx.strength ?? null) && r.strength)
    out.push({ field: "strength", from: r.strength, to: rx.strength ?? "none" });
  if (rx.route !== r.route)
    out.push({
      field: "route",
      from: ROUTE_WORD[r.route] ?? r.route,
      to: ROUTE_WORD[rx.route] ?? rx.route,
    });
  if (r.method && rx.method !== r.method)
    out.push({ field: "method", from: r.method, to: rx.method ?? "none" });
  if (rx.frequency !== r.freq)
    out.push({
      field: "frequency",
      from: FREQUENCY_WORD[r.freq],
      to: FREQUENCY_WORD[rx.frequency],
    });
  if (r.course && rx.course !== r.course)
    out.push({
      field: "course",
      from: COURSE_WORD[r.course],
      to: rx.course ? COURSE_WORD[rx.course] : "none",
    });
  return out;
}
