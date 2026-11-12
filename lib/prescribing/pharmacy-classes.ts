import type { Drug } from "./reference/formulary-types";

import { CLASSES } from "@/content/pharmacy-medicines";
import { DRUGS } from "./formulary";

/**
 * One class list for Prescribe and the pharmacy (owner decision, 12 Nov 2026): every formulary class
 * id (`DRUG_CLASSES`) maps to exactly one pharmacy class (`CLASSES`). Prescribe's group chips and
 * browse list group by these, in the pharmacy list's order. A dotted id takes its parent's class.
 */
export type PharmacyClass = (typeof CLASSES)[number];

const BY_ROOT: Record<string, PharmacyClass> = {
  abx: "Antibiotics",
  antitb: "Anti-TB",
  antimalarial: "Antimalarials",
  antifungal: "Antifungals",
  antiviral: "Antivirals",
  antiretroviral: "Antiretrovirals",
  antiparasitic: "Anthelmintics",
  analgesic: "Analgesics",
  nsaid: "Analgesics",
  opioid: "Analgesics",
  acid_suppressant: "Gastrointestinal",
  antiemetic: "Gastrointestinal",
  laxative: "Gastrointestinal",
  gi: "Gastrointestinal",
  acei: "Antihypertensives",
  arb: "Antihypertensives",
  ccb: "Antihypertensives",
  beta_blocker: "Antihypertensives",
  antihypertensive: "Antihypertensives",
  diuretic: "Diuretics",
  statin: "Lipid-lowering",
  anticoagulant: "Anticoagulants",
  saba: "Respiratory",
  inhaled_antimuscarinic: "Respiratory",
  ics: "Respiratory",
  methylxanthine: "Respiratory",
  insulin: "Antidiabetics",
  oral_glucose_lowering: "Antidiabetics",
  glp1_receptor_agonist: "Antidiabetics",
  thyroid: "Thyroid",
  antithyroid: "Thyroid",
  corticosteroid: "Corticosteroids",
  antiepileptic: "Anticonvulsants",
  antipsychotic: "Psychiatric",
  antidepressant: "Psychiatric",
  haematinic: "Haematinics",
  vitamin: "Vitamins and minerals",
  fluid: "Fluids and electrolytes",
  electrolyte: "Fluids and electrolytes",
  antihistamine: "Antihistamines",
  vaccine_ig: "Vaccines",
  nitrate: "Cardiac",
  antiarrhythmic: "Cardiac",
  antiplatelet: "Antiplatelets",
  vasopressor: "Emergency and antidotes",
  antidote: "Emergency and antidotes",
  benzodiazepine: "Sedatives",
  haemostatic: "Haemostatics",
  blood_products: "Blood products",
  gout: "Gout",
  alpha_blocker: "Urology",
};

/** The pharmacy class of a formulary class id; undefined for an id the map does not know. */
export const pharmacyClassOf = (classId: string): PharmacyClass | undefined =>
  BY_ROOT[classId.split(".")[0]!];

export interface PharmacyGroup {
  name: PharmacyClass;
  drugs: Drug[];
}

/** The formulary's medicines by pharmacy class, in the pharmacy list's order, A to Z within; empty classes drop out. */
export function pharmacyGroups(drugs: readonly Drug[] = DRUGS): PharmacyGroup[] {
  const byName = (a: Drug, b: Drug) =>
    a.generic.localeCompare(b.generic, "en", { sensitivity: "base" });
  return CLASSES.map((name) => ({
    name,
    drugs: drugs.filter((d) => pharmacyClassOf(d.class) === name).sort(byName),
  })).filter((g) => g.drugs.length > 0);
}
