import type { AllergyStatus } from "@/lib/emr/allergy";
import type { PrescribePatient, SafetyFlag } from "@/lib/prescribing/engine";
import type { AdminRoute, EmergencyDrug } from "@/lib/prescribing/reference/emergency-drug-catalog";

import { runSafetyChecks } from "@/lib/prescribing/engine";
import { EMERGENCY_DRUGS } from "@/lib/prescribing/reference/emergency-drug-catalog";

/**
 * The prescribe sheet's pure model, shared by the screen and the server (which re-runs the same
 * checks). lib/prescribing owns the formulary and the checks: nothing here suggests a dose.
 */

/** The engine's patient plus what the allergy record says: an empty list is only "no allergy"
 *  when NKDA is asserted; not recorded and unable to assess are unknowns the sheet must say. */
export type PrescribeSheetPatient = PrescribePatient & { allergyStatus: AllergyStatus["kind"] };

/** Record-only entries (RSI agents, operator-titrated infusions) are never prescribed. */
export const FORMULARY: readonly EmergencyDrug[] = (
  EMERGENCY_DRUGS as readonly EmergencyDrug[]
).filter((d) => !d.recordOnly);

export const ROUTES = [
  "oral",
  "iv",
  "im",
  "sc",
  "inhaled",
  "nebulised",
  "infusion",
  "pr",
  "buccal",
  "sublingual",
  "intranasal",
  "io",
  "ett",
] as const satisfies readonly AdminRoute[];

/** The entry has a mg reference, so the engine's range check can read a mg dose (the resus
 *  dialog's rule): the dose is then asked in mg. */
export const mgChecked = (drug: EmergencyDrug) =>
  drug.unitDoseMg != null || drug.doseRangeMg != null;

export function checkPrescription(
  drug: EmergencyDrug,
  patient: PrescribePatient,
  input: { doseMg?: number; route?: AdminRoute; concentration?: string },
): SafetyFlag[] {
  return runSafetyChecks({
    drug,
    patient,
    priorAdministrations: [],
    edit: { doseMg: input.doseMg, route: input.route, concentration: input.concentration },
  });
}

/** What the prescriber must answer with a reason: blocks and warnings. An info note is shown. */
export const mustConfirm = (flags: readonly SafetyFlag[]) =>
  flags.filter((f) => f.severity !== "info");

export function searchFormulary(query: string): readonly EmergencyDrug[] {
  const q = query.trim().toLowerCase();
  if (!q) return FORMULARY;
  return FORMULARY.filter((d) =>
    [d.name, d.brand, d.drugClass, ...d.indications].some((s) => s?.toLowerCase().includes(q)),
  );
}

export interface PrescribeDraft {
  clientKey: string;
  drugId: string | null;
  doseMg: string;
  dose: string;
  route: AdminRoute | "";
  concentration: string;
  frequency: string;
  duration: string;
  quantity: string;
  instructions: string;
  confirmReason: string;
  typedDose: string;
}

export const emptyDraft = (clientKey: string): PrescribeDraft => ({
  clientKey,
  drugId: null,
  doseMg: "",
  dose: "",
  route: "",
  concentration: "",
  frequency: "",
  duration: "",
  quantity: "",
  instructions: "",
  confirmReason: "",
  typedDose: "",
});

const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
const opt = (s: string) => s.trim() || undefined;

export function draftFlags(drug: EmergencyDrug, patient: PrescribePatient, d: PrescribeDraft) {
  return checkPrescription(drug, patient, {
    doseMg: num(d.doseMg),
    route: d.route || undefined,
    concentration: opt(d.concentration),
  });
}

/** Why "Prescribe" is not ready yet, in words; null when it is. */
export function draftIssue(
  drug: EmergencyDrug | null,
  d: PrescribeDraft,
  flags: readonly SafetyFlag[],
): string | null {
  if (!drug) return "Choose a medicine.";
  if (mgChecked(drug) ? num(d.doseMg) === undefined : !d.dose.trim()) return "Write the dose.";
  if (!d.route) return "Choose the route.";
  if (!d.frequency.trim()) return "Say how often.";
  if (!d.duration.trim()) return "Say for how long.";
  const hard = flags.find((f) => !f.overrideable);
  if (hard) return hard.message;
  if (mustConfirm(flags).length && d.confirmReason.trim().length < 3)
    return "Record your reason to prescribe.";
  if (flags.some((f) => f.egregious) && num(d.typedDose) !== num(d.doseMg))
    return "Type the dose to confirm it.";
  return null;
}

export function toRequest(
  d: PrescribeDraft,
  base: { surface: "doctor" | "clinician"; patientUserId: string; encounterId: string },
) {
  return {
    ...base,
    clientKey: d.clientKey,
    drugId: d.drugId ?? "",
    dose: opt(d.dose),
    doseMg: num(d.doseMg),
    route: d.route as AdminRoute,
    concentration: opt(d.concentration),
    frequency: d.frequency.trim(),
    duration: d.duration.trim(),
    quantity: opt(d.quantity),
    instructions: opt(d.instructions),
    confirmReason: opt(d.confirmReason),
    typedDose: num(d.typedDose),
  };
}
