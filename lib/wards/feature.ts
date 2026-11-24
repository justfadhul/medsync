import { encounterCloseV2LiveFor } from "@/lib/emr/feature";

/**
 * The ward builder and the live bed board (ADR 0191 §6): off until the owner applies migration 0090.
 * `WARD_BUILDER=1` turns it on everywhere; a comma-separated list of hospital ids, for those only.
 * Off, the ward panel has no Layout button, the layout and board pages 404, and the nurse workspace
 * has no Bed board.
 */
export function wardBuilderLiveFor(hospitalId: string): boolean {
  const value = process.env.WARD_BUILDER?.trim();
  if (!value) return false;
  return value === "1" || value.split(",").some((id) => id.trim() === hospitalId);
}

/**
 * The emergency unit's observation layer (ADRs 0539–0544): `EU_OBSERVATION=1` or a comma list of
 * hospital ids, and only where WARD_BUILDER and ENCOUNTER_CLOSE_V2 are both on. Off, nothing changes.
 */
export function euObservationLiveFor(hospitalId: string): boolean {
  const value = process.env.EU_OBSERVATION?.trim();
  if (!value || !wardBuilderLiveFor(hospitalId) || !encounterCloseV2LiveFor(hospitalId))
    return false;
  return value === "1" || value.split(",").some((id) => id.trim() === hospitalId);
}
