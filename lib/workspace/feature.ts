import "server-only";

import { encounterEngineLive } from "@/lib/encounter/feature";
import { resusDeskV2 } from "@/lib/resus/feature";

/**
 * Is the doctor workspace on for this hospital?
 *
 * `DOCTOR_WORKSPACE=1` turns it on everywhere; a comma list of hospital ids
 * turns it on for those only — the per-hospital switch the prompt asks for,
 * on the env mechanism the other clinical flags use (Q14). It also needs the
 * encounter engine (Waiting, In progress) and resus v2 (the Resus lane reads
 * its board). Off, the four old pages render exactly as before.
 */
export function doctorWorkspace(hospitalId: string): boolean {
  const value = process.env.DOCTOR_WORKSPACE?.trim();
  if (!value || !encounterEngineLive() || !resusDeskV2()) return false;
  return value === "1" || value.split(",").some((id) => id.trim() === hospitalId);
}
