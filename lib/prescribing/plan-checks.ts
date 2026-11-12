/**
 * The checks a Plan prescription runs (ADR 0186 §4). Pure: the dialog runs them live and the server
 * runs them again on place, from the record, whatever the screen showed.
 *
 * The existing engine (`runSafetyChecks`) runs for the drugs that come from the signed emergency
 * formulary. Every other check here is new and marked `proposed` until the CSO signs it. A check
 * never invents a threshold: it states what the record holds and asks for an answer.
 *
 *   stop   — "Stop and check": needs an override reason (or refuses, when not overrideable)
 *   check  — "Check": needs an answer
 *   note   — "Note": shown, no answer
 *   passed / not_applicable / not_checked — behind "Show n more checks", each with its reason
 */
import type { PharmacyAvailability, StockLine } from "./pharmacy";
import type { PlanRx } from "./plan-rx";
import type { Drug } from "./reference/formulary-types";
import type { Fired } from "@/lib/pharmacy/clinical/interactions";
import type { InteractionContext } from "@/lib/pharmacy/clinical/read";

import { CLINICAL_B, firedLine } from "@/content/pharmacy-clinical";
import { egfr, kdigoG } from "@/lib/ncdreg/standard/calculations";
import { checkInteractions } from "@/lib/pharmacy/clinical/interactions";
import { PAEDIATRIC_AGE_THRESHOLD, runSafetyChecks } from "./engine";
import {
  allergyGroupName,
  classById,
  drugById,
  DRUGS,
  emergencyOriginOf,
  isFluid,
  regimenById,
} from "./formulary";
import { stockLineWords } from "./pharmacy";
import { CHECK_REASONS, OVERRIDE_REASONS, STOCK_REASONS } from "./plan-rx";
import { getEmergencyDrug } from "./reference/emergency-drug-catalog";

export type PlanCheckOutcome =
  | "stop"
  | "check"
  | "note"
  | "passed"
  | "not_applicable"
  | "not_checked";

export type PlanCheckCode =
  | "allergy"
  | "allergy_status"
  | "dose_reference"
  | "kidney"
  | "weight"
  | "child"
  | "duplicate"
  | "indication"
  | "cultures"
  | "interactions"
  | "stock"
  | "cosign"
  | "controlled"
  | "pregnancy"
  | "limits"
  | "engine_concentration"
  | "engine_max_cumulative"
  | "engine_contraindication";

export interface PlanCheck {
  code: PlanCheckCode;
  outcome: PlanCheckOutcome;
  title: string;
  message: string;
  /** New in the Plan and not yet signed by the CSO. */
  proposed: boolean;
  /** A stop that may be overridden with a reason. False: the prescription cannot be added. */
  overrideable: boolean;
  /** The dose is dangerously far out: the prescriber types it to confirm. */
  egregious?: boolean;
  /** IX-5: the signed entries this interaction check answers (id, key, version), stored with the answer. */
  entries?: { id: string; key: string; version: number }[];
}

export const OUTCOME_WORD: Record<PlanCheckOutcome, string> = {
  stop: "Stop and check",
  check: "Check",
  note: "Note",
  passed: "Passed",
  not_applicable: "Does not apply",
  not_checked: "Not checked",
};

export interface CheckAllergy {
  substance: string;
}

export interface OtherMedicine {
  drugId?: string;
  /** Formulary class, where known. */
  classId?: string;
  display: string;
  source: "this_visit" | "basket" | "admission";
}

export type CultureState = "none" | "in_basket" | "ordered" | "collected" | "resulted";

export interface PlanCheckContext {
  ageYears: number | null;
  weight: { kg: number; at: string; source: string } | null;
  allergies: readonly CheckAllergy[];
  /** "none_known" = no known allergies recorded; "unknown" = never asked. */
  allergyStatus: "has_allergies" | "none_known" | "unknown";
  /** Condition words for the engine's contraindication check (e.g. "pregnancy"). */
  conditions: readonly string[];
  creatinine: { value: number; unit: string; at: string } | null;
  /** A U&E (or creatinine) is ordered or in the basket but not resulted. */
  kidneyTestPlanned: boolean;
  /** Latest glucose, mmol/L. */
  glucose: { value: number; at: string } | null;
  /** The linked problem is one whose catalogue tests include a blood culture. */
  sepsisTypeProblem: boolean;
  bloodCulture: CultureState;
  others: readonly OtherMedicine[];
  cosign: "allowed" | "cosign_required" | "blocked";
  /** The ADR 0190 seam; absent reads as "not linked" (the stock answer below replaces it). */
  pharmacy?: PharmacyAvailability;
  /** Pharmacy Phase 1 (5.10): the real answer, behind `pharmacyStockAnswer`; absent → `pharmacy` as before. */
  stock?: StockLine | null;
  /** Pharmacy Phase 3 (5.3): the signed pairs and the patient's current medicines, behind `pharmacyInteractions`. */
  interactions?: InteractionContext | null;
  /**
   * PRESCRIBE_V2 (prescribing kit F3): allergy cross-reactivity, eGFR by CKD-EPI 2021, pregnancy and
   * limits. Off, every check reads exactly as before.
   */
  v2?: boolean;
  /** Sex recorded for physiological calculations (eGFR, pregnancy question). */
  sex?: "female" | "male" | null;
  /** The pregnancy record: null = never asked. */
  pregnancy?: { state: "pregnant" | "not_pregnant" | "postpartum"; weeks: number | null } | null;
}

/** Hypoglycaemia threshold (JBDS-IP 2023, signed in the emergency formulary: "CBG < 4.0 mmol/L"). */
export const HYPO_THRESHOLD_MMOL = 4.0;
const HYPO_TREATMENTS = new Set(["glucose_10", "glucose_50", "glucagon"]);

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Kampala",
  });

/** Words for matching, singular, lower case: "Penicillins (rash)" → ["penicillin", "rash"]. */
function words(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4)
    .map((w) => (w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/** What an allergy is matched against: the name, the class and the allergy groups, never the notes. */
function allergyHaystack(drug: Drug): Set<string> {
  const cls = classById(drug.class);
  const parent = cls?.parent ? classById(cls.parent) : undefined;
  const names = [
    drug.generic,
    drug.id.replace(/_/g, " "),
    cls?.name ?? "",
    parent?.name ?? "",
    ...drug.allergyGroups.flatMap((g) => [g, allergyGroupName(g).split("(")[0]!]),
  ];
  return new Set(names.flatMap(words));
}

function allergyCheck(drug: Drug, ctx: PlanCheckContext): PlanCheck {
  const hay = allergyHaystack(drug);
  const hit = ctx.allergies.find((a) => words(a.substance).some((w) => hay.has(w)));
  const beta = drug.allergyGroups.includes("beta-lactam");
  if (hit)
    return {
      code: "allergy",
      outcome: "stop",
      title: "Allergy",
      message: `Allergy record: "${hit.substance}" matches ${drug.generic} by name, class or allergy group.`,
      proposed: true,
      overrideable: true,
    };
  const cross = ctx.v2 ? crossReactive(drug, ctx) : null;
  if (cross)
    return {
      code: "allergy",
      outcome: "check",
      title: "Allergy",
      message: `Allergy record: "${cross.substance}". ${drug.generic} shares the ${allergyGroupName(cross.group).split(" (")[0]!.toLowerCase()} group with it, so a cross-reaction is possible. Check what the reaction was before giving.`,
      proposed: true,
      overrideable: true,
    };
  if (ctx.allergyStatus === "unknown")
    return {
      code: "allergy_status",
      outcome: "check",
      title: "Allergy",
      message: "Allergies have not been asked about on this record. Ask before giving.",
      proposed: true,
      overrideable: true,
    };
  return {
    code: "allergy",
    outcome: "passed",
    title: "Allergy",
    message:
      (ctx.allergyStatus === "none_known"
        ? "No known allergies recorded."
        : "No recorded allergy matches by name, class or allergy group.") +
      (beta && !ctx.v2 ? " Cross-reactivity between beta-lactams is not checked." : ""),
    proposed: true,
    overrideable: true,
  };
}

/**
 * Cross-reactivity (v2): an allergy that names other formulary medicines by name, class or group,
 * where this medicine shares one of their allergy groups. Read from the formulary's groups only.
 */
function crossReactive(
  drug: Drug,
  ctx: PlanCheckContext,
): { substance: string; group: string } | null {
  for (const a of ctx.allergies) {
    const w = words(a.substance);
    const named = DRUGS.filter((d) => d.id !== drug.id && w.some((x) => allergyHaystack(d).has(x)));
    const group = drug.allergyGroups.find((g) => named.some((d) => d.allergyGroups.includes(g)));
    if (group) return { substance: a.substance, group };
  }
  return null;
}

/** eGFR by CKD-EPI 2021 (creatinine in µmol/L), with its KDIGO category; null when it cannot be worked out. */
export function egfrOf(ctx: Pick<PlanCheckContext, "creatinine" | "ageYears" | "sex">) {
  const cr = ctx.creatinine;
  if (!cr || ctx.ageYears == null || ctx.ageYears < 18 || !ctx.sex) return null;
  if (!/^(u|µ)mol\/L$/i.test(cr.unit.replace("μ", "µ"))) return null;
  const value = egfr(cr.value, ctx.ageYears, ctx.sex);
  return { value, category: kdigoG(value) };
}

function kidneyCheck(drug: Drug, ctx: PlanCheckContext): PlanCheck {
  const base = {
    code: "kidney" as const,
    title: "Kidney function",
    proposed: true,
    overrideable: true,
  };
  if (!drug.flags.renal)
    return {
      ...base,
      outcome: "not_applicable",
      message: "Not marked as needing a kidney-function check.",
    };
  const e = ctx.v2 ? egfrOf(ctx) : null;
  if (e && ctx.creatinine)
    return {
      ...base,
      // KDIGO G1–G2 is not decreased kidney function; G3a and below asks for the dose to be checked.
      outcome: e.category === "G1" || e.category === "G2" ? "passed" : "check",
      message: `eGFR ${e.value} mL/min/1.73 m² (${e.category}), worked out with CKD-EPI 2021 from creatinine ${ctx.creatinine.value} ${ctx.creatinine.unit} at ${time(ctx.creatinine.at)}, ${ctx.sex}, ${ctx.ageYears} y. Check the ${drug.generic} dose for kidney function.`,
    };
  if (ctx.creatinine)
    return {
      ...base,
      outcome: ctx.v2 ? "check" : "note",
      message: `Creatinine ${ctx.creatinine.value} ${ctx.creatinine.unit} at ${time(ctx.creatinine.at)}. Check the dose for kidney function.`,
    };
  return {
    ...base,
    outcome: "check",
    message: ctx.kidneyTestPlanned
      ? "No creatinine resulted yet: U&E is in the plan, not resulted."
      : "No creatinine on the record and no U&E in the plan.",
  };
}

function weightCheck(drug: Drug, rx: PlanRx, ctx: PlanCheckContext): PlanCheck {
  const base = { code: "weight" as const, title: "Weight", proposed: true, overrideable: true };
  const child = ctx.ageYears != null && ctx.ageYears < PAEDIATRIC_AGE_THRESHOLD;
  const weightBased = child ? drug.flags.weightBasedInChildren : drug.flags.weightBasedInAdults;
  const perKg = rx.regimenId ? regimenById(drug, rx.regimenId)?.perKg : undefined;
  if (!weightBased && !perKg)
    return { ...base, outcome: "not_applicable", message: "Not dosed by weight for this patient." };
  if (ctx.weight)
    return {
      ...base,
      outcome: perKg ? "passed" : "note",
      message: `${ctx.weight.kg} kg · ${time(ctx.weight.at)} · ${ctx.weight.source}.${perKg ? "" : " Arithmetic runs only with a verified per-kg regimen."}`,
    };
  return {
    ...base,
    outcome: "check",
    message:
      "No weight in the vitals: per-kg dose not worked out. Weigh the patient or record the weight.",
  };
}

function duplicateCheck(drug: Drug, ctx: PlanCheckContext): PlanCheck {
  const same = ctx.others.find(
    (o) => (o.drugId && o.drugId === drug.id) || (o.classId && o.classId === drug.class),
  );
  const base = {
    code: "duplicate" as const,
    title: "Already prescribed",
    proposed: true,
    overrideable: true,
  };
  if (!same)
    return {
      ...base,
      outcome: "passed",
      message: "No other medicine of this class this visit or on admission.",
    };
  const where = {
    this_visit: "this visit",
    basket: "in the basket",
    admission: "on the admission list",
  }[same.source];
  return {
    ...base,
    outcome: "check",
    message: `${same.display} is ${where}${same.drugId === drug.id ? "" : `, the same class (${classById(drug.class)?.name ?? drug.class})`}.`,
  };
}

function indicationCheck(drug: Drug, rx: PlanRx, ctx: PlanCheckContext): PlanCheck {
  const base = {
    code: "indication" as const,
    title: "Indication against the latest result",
    proposed: true,
    overrideable: true,
  };
  const hypoUse =
    HYPO_TREATMENTS.has(drug.id) && !(rx.kind === "fluid" && rx.fluid?.purpose !== "bolus");
  if (!hypoUse)
    return {
      ...base,
      outcome: "not_applicable",
      message: "No result-linked indication for this medicine.",
    };
  if (!ctx.glucose)
    return { ...base, outcome: "not_checked", message: "No glucose result on the record." };
  if (ctx.glucose.value > HYPO_THRESHOLD_MMOL)
    return {
      ...base,
      outcome: "check",
      message: `Latest glucose ${ctx.glucose.value} mmol/L at ${time(ctx.glucose.at)} is above ${HYPO_THRESHOLD_MMOL.toFixed(1)}.`,
    };
  return {
    ...base,
    outcome: "passed",
    message: `Latest glucose ${ctx.glucose.value} mmol/L at ${time(ctx.glucose.at)}.`,
  };
}

function culturesCheck(drug: Drug, ctx: PlanCheckContext): PlanCheck {
  const base = {
    code: "cultures" as const,
    title: "Cultures before antibiotics",
    proposed: true,
    overrideable: true,
  };
  if (!drug.class.startsWith("abx."))
    return { ...base, outcome: "not_applicable", message: "Not an antibiotic." };
  if (!ctx.sepsisTypeProblem)
    return {
      ...base,
      outcome: "not_applicable",
      message: "The linked problem does not call for a blood culture.",
    };
  switch (ctx.bloodCulture) {
    case "none":
      return { ...base, outcome: "check", message: "No blood culture in the plan." };
    case "in_basket":
      return {
        ...base,
        outcome: "check",
        message: "Blood culture is in the basket, not yet placed.",
      };
    case "ordered":
      return { ...base, outcome: "check", message: "Blood culture ordered, not yet collected." };
    default:
      return { ...base, outcome: "passed", message: "Blood culture collected." };
  }
}

function stockCheck(ctx: PlanCheckContext): PlanCheck {
  const base = {
    code: "stock" as const,
    title: "Pharmacy stock",
    proposed: true,
    overrideable: true,
  };
  // D-PH1-22: a linked answer is a Note or a Check from the mapping, never a Stop.
  if (ctx.stock && ctx.stock.level !== "not_checked")
    return { ...base, outcome: ctx.stock.level, message: stockLineWords(ctx.stock) };
  const pharmacy: PharmacyAvailability = ctx.pharmacy ?? { status: "not_linked" };
  switch (pharmacy.status) {
    case "not_linked":
      return { ...base, outcome: "not_checked", message: "Pharmacy not linked yet." };
    case "out":
      return {
        ...base,
        outcome: "check",
        message: `Out of stock${pharmacy.point ? ` at ${pharmacy.point}` : ""}.`,
      };
    case "low":
      return {
        ...base,
        outcome: "note",
        message: `Low stock${pharmacy.point ? ` at ${pharmacy.point}` : ""}.`,
      };
    default:
      return { ...base, outcome: "passed", message: "In stock." };
  }
}

function cosignCheck(drug: Drug, ctx: PlanCheckContext): PlanCheck {
  const base = { code: "cosign" as const, title: "Co-sign", proposed: false };
  if (ctx.cosign === "blocked")
    return {
      ...base,
      outcome: "stop",
      overrideable: false,
      message: drug.flags.controlled
        ? "Controlled-substance prescriptions are above your scope here."
        : "Prescribing is above your scope here.",
    };
  if (ctx.cosign === "cosign_required")
    return {
      ...base,
      outcome: "note",
      overrideable: true,
      message: "A senior co-signs this before it is given.",
    };
  return {
    ...base,
    outcome: "passed",
    overrideable: true,
    message: "No co-sign needed for your role.",
  };
}

function childCheck(drug: Drug, rx: PlanRx, ctx: PlanCheckContext, fromEngine: boolean): PlanCheck {
  const base = {
    code: "child" as const,
    title: "Child",
    proposed: !fromEngine,
    overrideable: true,
  };
  if (ctx.ageYears == null || ctx.ageYears >= PAEDIATRIC_AGE_THRESHOLD)
    return { ...base, outcome: "not_applicable", message: "Not a child." };
  const regimen = rx.regimenId ? regimenById(drug, rx.regimenId) : undefined;
  if (regimen?.band === "child")
    return { ...base, outcome: "passed", message: "A signed child regimen is used." };
  return {
    ...base,
    outcome: "check",
    message: `Under ${PAEDIATRIC_AGE_THRESHOLD}: never the adult dose. No signed child regimen is used; confirm this is a child dose.`,
  };
}

/** All checks for one prescription, most severe first. */
/**
 * Pharmacy Phase 3 (5.3, IX-1 to IX-8): one check row for every signed pair that fires for this medicine, at the
 * highest signed level; answered once, the answer stored with each entry (IX-5). With the flag off, or nothing in
 * force, the baseline line stays (S23).
 */
function interactionCheck(drug: Drug, ctx: PlanCheckContext): PlanCheck {
  const base = {
    code: "interactions" as const,
    title: "Interactions",
    proposed: false,
    overrideable: true,
  };
  const ix = ctx.interactions;
  if (!ix || !ix.pairs)
    return {
      ...base,
      proposed: true,
      outcome: "not_checked",
      message: "Interactions are not checked until an interaction reference is signed.",
    };
  if (!ix.levels) return { ...base, outcome: "not_checked", message: CLINICAL_B.levelsUnsigned };
  const others = ctx.others
    .filter((o) => o.drugId && o.drugId !== drug.id)
    .map((o) => ({ medicineId: o.drugId!, source: "active_line" as const, since: new Date(0) }));
  const fired = checkInteractions({
    entries: ix.entries,
    levels: ix.levels,
    current: [...ix.current, ...others],
    adding: [drug.id],
    mode: "dialog",
    earlier: ix.earlier,
    now: new Date(),
  });
  // Law 4: "no alert" is a Note that says how little is checked, never "Passed".
  if (!fired.length)
    return { ...base, outcome: "note", message: CLINICAL_B.dialogNothingFired(ix.pairs) };
  const top = fired[0]!.level;
  return {
    ...base,
    outcome: top,
    message: fired.map(firedWords).join(" "),
    entries: fired.map((f) => ({ id: f.entryId, key: f.key, version: f.version })),
  };
}

const nameOf = (id: string) =>
  id === "restricted" ? "a medicine in a restricted class" : (drugById(id)?.generic ?? id);
const firedWords = (f: Fired) =>
  f.suppressedBy
    ? CLINICAL_B.suppressed(
        new Date(f.suppressedBy.answeredAt).toISOString().slice(0, 10),
        f.suppressedBy.cadre,
        f.suppressedBy.reason,
      )
    : firedLine({ ...f, adding: nameOf(f.adding), other: nameOf(f.other) });

/** Pregnancy (v2): asked for women aged 12 to 55 (kit F1); signed pregnancy advice shown only when signed. */
function pregnancyCheck(drug: Drug, ctx: PlanCheckContext): PlanCheck {
  const base = {
    code: "pregnancy" as const,
    title: "Pregnancy",
    proposed: true,
    overrideable: true,
  };
  const ofAge =
    ctx.sex === "female" && ctx.ageYears != null && ctx.ageYears >= 12 && ctx.ageYears <= 55;
  if (!ofAge) return { ...base, outcome: "not_applicable", message: "Not a woman aged 12 to 55." };
  if (!ctx.pregnancy)
    return {
      ...base,
      outcome: "check",
      message: "Pregnancy has not been asked about on this record. Ask before giving.",
    };
  if (ctx.pregnancy.state !== "pregnant")
    return { ...base, outcome: "passed", message: "Not pregnant, as recorded." };
  const signed = drug.dose.csoSigned && drug.dose.pregnancy;
  return {
    ...base,
    outcome: "check",
    message: signed
      ? `Pregnant${ctx.pregnancy.weeks != null ? `, ${ctx.pregnancy.weeks} weeks` : ""}. ${drug.dose.pregnancy}`
      : `Pregnant${ctx.pregnancy.weeks != null ? `, ${ctx.pregnancy.weeks} weeks` : ""}. No signed pregnancy advice for ${drug.generic} yet: check it before giving.`,
  };
}

/** Limits (v2): a dose above the signed regimen's own maximum. No maximum is invented. */
function limitsCheck(drug: Drug, rx: PlanRx): PlanCheck {
  const base = { code: "limits" as const, title: "Limits", proposed: true, overrideable: true };
  const max = rx.regimenId ? regimenById(drug, rx.regimenId)?.perKg?.max : undefined;
  if (max == null)
    return {
      ...base,
      outcome: "not_checked",
      message: `No signed maximum dose for ${drug.generic} yet.`,
    };
  if (rx.doseNum != null && rx.doseNum > max)
    return {
      ...base,
      outcome: "stop",
      message: `${rx.doseNum} ${rx.unit} is above the regimen's maximum of ${max} ${rx.unit}.`,
    };
  return {
    ...base,
    outcome: "passed",
    message: `Within the regimen's maximum of ${max} ${rx.unit}.`,
  };
}

export function planChecks(drug: Drug, rx: PlanRx, ctx: PlanCheckContext): PlanCheck[] {
  const out: PlanCheck[] = [];
  const origin = emergencyOriginOf(drug.id);
  const emergency = origin ? getEmergencyDrug(origin) : undefined;
  out.push(allergyCheck(drug, ctx));

  // The existing engine, for the signed emergency entries: its paediatric and dose-range rules.
  if (emergency) {
    const doseMg =
      rx.kind === "drug" && rx.doseNum != null && ["mg", "g", "µg"].includes(rx.unit)
        ? rx.unit === "g"
          ? rx.doseNum * 1000
          : rx.unit === "µg"
            ? rx.doseNum / 1000
            : rx.doseNum
        : undefined;
    const flags = runSafetyChecks({
      drug: emergency,
      patient: {
        ageYears: ctx.ageYears,
        weightKg: ctx.weight?.kg ?? null,
        allergies: [],
        conditions: [...ctx.conditions],
      },
      priorAdministrations: [],
      edit: doseMg != null && emergency.unitDoseMg != null ? { doseMg } : undefined,
    });
    const fromEngine = flags.some(
      (f) => f.code === "weight_missing" || f.code === "paediatric_routing",
    );
    const blockNoWeight = flags.find((f) => f.code === "weight_missing");
    if (blockNoWeight)
      out.push({
        code: "child",
        outcome: "stop",
        title: "Child",
        message: blockNoWeight.message,
        proposed: false,
        overrideable: false,
      });
    else out.push(childCheck(drug, rx, ctx, fromEngine));
    const range = flags.find((f) => f.code === "dose_range");
    out.push(
      range
        ? {
            code: "dose_reference",
            outcome: range.severity === "block" ? "stop" : "check",
            title: "Dose against reference",
            message: range.message,
            proposed: false,
            overrideable: range.overrideable,
            egregious: range.egregious,
          }
        : {
            code: "dose_reference",
            outcome: emergency.unitDoseMg != null && rx.unit !== "mL" ? "passed" : "not_checked",
            title: "Dose against reference",
            message:
              emergency.unitDoseMg != null && rx.unit !== "mL"
                ? "Within the signed reference."
                : "The signed reference has no single mg dose to compare with.",
            proposed: false,
            overrideable: true,
          },
    );
    for (const f of flags) {
      const code =
        f.code === "concentration"
          ? "engine_concentration"
          : f.code === "max_cumulative"
            ? "engine_max_cumulative"
            : f.code === "contraindication"
              ? "engine_contraindication"
              : null;
      if (!code) continue;
      out.push({
        code,
        outcome: f.severity === "block" ? "stop" : f.severity === "warn" ? "check" : "note",
        title:
          code === "engine_contraindication"
            ? "Contraindication"
            : code === "engine_max_cumulative"
              ? "Maximum dose"
              : "Concentration",
        message: f.message,
        proposed: false,
        overrideable: f.overrideable,
      });
    }
  } else {
    out.push(childCheck(drug, rx, ctx, false));
    out.push({
      code: "dose_reference",
      outcome: "not_checked",
      title: "Dose against reference",
      message: `No signed reference dose for ${drug.generic} yet: the dose is not checked.`,
      proposed: true,
      overrideable: true,
    });
  }

  out.push(kidneyCheck(drug, ctx));
  if (ctx.v2) {
    out.push(pregnancyCheck(drug, ctx));
    if (rx.kind === "drug") out.push(limitsCheck(drug, rx));
  }
  out.push(weightCheck(drug, rx, ctx));
  if (!isFluid(drug) || rx.kind === "drug") out.push(duplicateCheck(drug, ctx));
  out.push(indicationCheck(drug, rx, ctx));
  out.push(culturesCheck(drug, ctx));
  out.push(interactionCheck(drug, ctx));
  out.push(stockCheck(ctx));
  out.push(cosignCheck(drug, ctx));
  out.push(
    drug.flags.controlled
      ? {
          code: "controlled",
          outcome: "check",
          title: "Controlled drug",
          message: "Controlled drug: record a witness.",
          proposed: false,
          overrideable: true,
        }
      : {
          code: "controlled",
          outcome: "not_applicable",
          title: "Controlled drug",
          message: "Not a controlled drug.",
          proposed: false,
          overrideable: true,
        },
  );

  const rank: Record<PlanCheckOutcome, number> = {
    stop: 0,
    check: 1,
    note: 2,
    passed: 3,
    not_checked: 4,
    not_applicable: 5,
  };
  return out.sort((a, b) => rank[a.outcome] - rank[b.outcome]);
}

/** The checks that need the prescriber's answer (a stop that can be overridden, or a check). */
export function needingAnswer(checks: readonly PlanCheck[]): PlanCheck[] {
  return checks.filter(
    (c) =>
      (c.outcome === "stop" && c.overrideable) ||
      (c.outcome === "check" && c.code !== "controlled"),
  );
}

export interface AnswerVerdict {
  ok: boolean;
  /** In words, for the disabled button and the server's refusal. */
  reason: string | null;
  /** The reason text stored (encrypted) with the prescription. */
  reasonText: string;
}

/**
 * Whether every check has what it needs: a non-overrideable stop refuses; every stop and check has
 * an answer ("Other" with words); a controlled drug has a witness; an egregious dose is typed.
 */
export function verifyAnswers(checks: readonly PlanCheck[], rx: PlanRx): AnswerVerdict {
  const hard = checks.find((c) => c.outcome === "stop" && !c.overrideable);
  if (hard) return { ok: false, reason: hard.message, reasonText: "" };
  const lines: string[] = [];
  for (const c of needingAnswer(checks)) {
    const a = rx.answers.find((x) => x.code === c.code);
    if (!a) return { ok: false, reason: `Answer "${c.title}" to continue.`, reasonText: "" };
    const words =
      a.answer === "other"
        ? a.text?.trim()
        : c.code === "stock"
          ? STOCK_REASONS[a.answer as keyof typeof STOCK_REASONS]
          : c.outcome === "stop"
            ? OVERRIDE_REASONS[a.answer as keyof typeof OVERRIDE_REASONS]
            : CHECK_REASONS[a.answer as keyof typeof CHECK_REASONS];
    if (!words || words.length < 3)
      return { ok: false, reason: `Write your reason for "${c.title}".`, reasonText: "" };
    lines.push(`${c.outcome === "stop" ? "Override" : "Check"} ${c.title.toLowerCase()}: ${words}`);
  }
  if (
    checks.some((c) => c.code === "controlled" && c.outcome === "check") &&
    !(rx.witness && rx.witness.length >= 2)
  )
    return { ok: false, reason: "Record a witness for the controlled drug.", reasonText: "" };
  if (checks.some((c) => c.egregious) && rx.typedDose !== rx.doseNum)
    return { ok: false, reason: "Type the dose to confirm it.", reasonText: "" };
  return { ok: true, reason: null, reasonText: lines.join("; ") };
}
