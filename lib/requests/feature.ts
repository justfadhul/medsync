import { emrV1LiveFor } from "@/lib/emr/feature";

/**
 * Care requests (reviews and consults, one record), per hospital, off by default: `CARE_REQUESTS=1`
 * or a comma list of hospital ids, and only where EMR v1 is on. The Plan entry also needs
 * CLERKING_PLAN_V2. Off, nothing changes.
 */
export function careRequestsLiveFor(hospitalId: string): boolean {
  const value = process.env.CARE_REQUESTS?.trim();
  if (!value || !emrV1LiveFor(hospitalId)) return false;
  return value === "1" || value.split(",").some((id) => id.trim() === hospitalId);
}
