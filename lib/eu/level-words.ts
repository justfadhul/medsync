import type { AcuityLevel } from "@/lib/triage/types";

import { EU_LEVEL_WORDS } from "@/content/eu/words";

/** The level in the hospital's own triage words (`triage_system`); MedSync's own form otherwise. DRAFT for the CSO. */
export function levelWords(system: string | null, level: AcuityLevel): string {
  const i = level - 1;
  if (system === "sats") return `${EU_LEVEL_WORDS.sats[i]} (L${level})`;
  if (system === "etat") return `${EU_LEVEL_WORDS.etat[i]} (L${level})`;
  return `L${level} · ${EU_LEVEL_WORDS.own[i]}`;
}
