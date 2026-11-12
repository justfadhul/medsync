import type { DoseBand } from "./reference/formulary-types";

/**
 * Order sets (prescribing kit F2): one tap queues several medicines. The sets name medicines only,
 * never a dose: each line opens in the dialog and takes its dose from a signed regimen or the
 * prescriber. Seeded from the 11 Nov 2026 prototype; DRAFT until the CSO signs the list, so they are
 * shown outside production only (the signed-content rule).
 */
export interface OrderSet {
  id: string;
  name: string;
  /** Child sets for the child band; adult sets for adults and older adults. */
  who: "adult" | "child";
  drugIds: string[];
}

export const ORDER_SETS_STATUS: "draft" | "signed" = "draft";

export const ORDER_SETS: readonly OrderSet[] = [
  {
    id: "malaria.adult",
    name: "Uncomplicated malaria",
    who: "adult",
    drugIds: ["artemether_lumefantrine", "paracetamol"],
  },
  {
    id: "malaria.child",
    name: "Uncomplicated malaria",
    who: "child",
    drugIds: ["artemether_lumefantrine", "paracetamol"],
  },
  {
    id: "pneumonia.adult",
    name: "Pneumonia, outpatient",
    who: "adult",
    drugIds: ["amoxicillin", "paracetamol"],
  },
  {
    id: "pneumonia.child",
    name: "Pneumonia, fast breathing",
    who: "child",
    drugIds: ["amoxicillin", "paracetamol"],
  },
  {
    id: "severe_pneumonia.child",
    name: "Severe pneumonia",
    who: "child",
    drugIds: ["ceftriaxone", "paracetamol"],
  },
  { id: "pain.adult", name: "Acute pain", who: "adult", drugIds: ["paracetamol", "diclofenac"] },
  { id: "cystitis.adult", name: "Cystitis", who: "adult", drugIds: ["ciprofloxacin"] },
  { id: "htn.adult", name: "New hypertension", who: "adult", drugIds: ["amlodipine"] },
];

/** The sets for this patient's band; none in production while the list is a draft, none with no age. */
export function orderSetsFor(band: DoseBand | null, production: boolean): OrderSet[] {
  if (!band || (production && ORDER_SETS_STATUS !== "signed")) return [];
  const who = band === "child" ? "child" : "adult";
  return ORDER_SETS.filter((s) => s.who === who);
}
