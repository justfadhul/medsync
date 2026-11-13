import { CLINIC_FLOOR_COPY_STATUS } from "@/content/clinic-floor/floor";

/**
 * The Tether clinic floor (ADR 0491): off until the owner applies migration 0295. `CLINIC_FLOOR=1` turns it on
 * everywhere; a comma-separated list of hospital ids, for those only. In production it also needs the floor copy
 * signed. Off, the triage and clinic pages are the old ones, unchanged. Deleted at Step 8's cut-over.
 */
export function clinicFloorLiveFor(
  hospitalId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env.CLINIC_FLOOR?.trim();
  if (!value) return false;
  if (env.VERCEL_ENV === "production" && CLINIC_FLOOR_COPY_STATUS.status !== "signed") return false;
  return value === "1" || value.split(",").some((id) => id.trim() === hospitalId);
}
