import "server-only";

import { encounterEngineLive } from "@/lib/encounter/feature";

/**
 * EMR v1 flags (HARMONISATION §4). Migrations 0071–0073 are GATED: until the owner applies them
 * the EMR tables do not exist, so every EMR surface and write path gates here. Off, every existing
 * page behaves exactly as before.
 *
 * `EMR_V1=1` turns it on everywhere; a comma list of hospital ids turns it on for those only (the
 * DOCTOR_WORKSPACE mechanism). It needs the encounter engine: the record hangs off `encounters`.
 */
function emrV1Value(): string | undefined {
  const value = process.env.EMR_V1?.trim();
  return value && encounterEngineLive() ? value : undefined;
}

/** Is EMR v1 on anywhere? For code with no hospital in hand (a global route, a script). */
export function emrV1Live(): boolean {
  return emrV1Value() !== undefined;
}

/** Is EMR v1 on for this hospital? Every per-patient surface asks this one. */
export function emrV1LiveFor(hospitalId: string): boolean {
  const value = emrV1Value();
  if (!value) return false;
  return value === "1" || value.split(",").some((id) => id.trim() === hospitalId);
}

/** Prescribing from the encounter (Phase 7). `EMR_PRESCRIBING=1`, and only where EMR v1 is on. */
export function emrPrescribingLive(hospitalId?: string): boolean {
  if (process.env.EMR_PRESCRIBING?.trim() !== "1") return false;
  return hospitalId === undefined ? emrV1Live() : emrV1LiveFor(hospitalId);
}
