import type { AvailabilityOrigin } from "./pharmacy";
import type { LineStatus } from "@/lib/pharmacy/lines";

import { PRESCRIBE_HANDOFF_COPY } from "@/content/pharmacy-prescriber";
import { keyOf } from "@/lib/pharmacy/lines";

/**
 * The places that prescribe (prescribing kit F1). Each sets where the medicines are collected: the
 * pharmacy point whose stock the checks read (`origin`, the AV-2 word) and the words the dialog shows
 * when no live point names it. Resus is given from the cart first; the line only restocks it.
 */
export const PRESCRIBE_PLACES = [
  "clinic",
  "clerking",
  "ward",
  "resus",
  "ncd",
  "going_home",
] as const;
export type PrescribePlace = (typeof PRESCRIBE_PLACES)[number];

export const PLACE: Record<
  PrescribePlace,
  { label: string; origin: AvailabilityOrigin; collect: string }
> = {
  clinic: { label: "Clinic visit", origin: "window", collect: "Main window" },
  clerking: { label: "Clerking · Plan", origin: "wards", collect: "the ward" },
  ward: { label: "Ward round", origin: "wards", collect: "the ward" },
  resus: { label: "Resus", origin: "emergency", collect: "Resus cart" },
  ncd: { label: "NCD clinic", origin: "window", collect: "Main window" },
  going_home: { label: "Going home", origin: "window", collect: "Main window" },
};

/**
 * The place the encounter desk prescribes from: an inpatient visit is a ward round, any other visit a
 * clinic visit. Resus is only the resus page (given from the cart), never an emergency visit's desk.
 */
export const placeOfEncounter = (encounterType: string | null): PrescribePlace =>
  encounterType === "inpatient" ? "ward" : "clinic";

/**
 * The prescriber's word for a placed line (kit F1, F4). With the pharmacy's folded stage or outcome
 * (lib/pharmacy/lines.ts, read where pharmacy dispensing is on) the kit's line states: Waiting at
 * pharmacy, Pharmacy asks you, Owed, Handed over, Stopped. A resus line is given from the cart and
 * never dispensed, so the pharmacy's fold does not apply to it.
 */
export function rxWord(
  r: { state: string; awaitingCosign: boolean; cosignWithheld: boolean },
  place: PrescribePlace,
  pharmacy?: LineStatus | null,
): string {
  if (r.cosignWithheld) return "Co-sign withheld";
  if (place === "resus") return r.state === "cancelled" ? "Stopped" : "Given from the cart";
  if (pharmacy) return PRESCRIBE_HANDOFF_COPY.line[keyOf(pharmacy)];
  if (r.awaitingCosign) return "Waiting for co-sign";
  if (r.state === "cancelled") return "Stopped";
  if (r.state === "administered") return "Given";
  if (r.state === "completed") return "Completed";
  return "Waiting at pharmacy";
}
