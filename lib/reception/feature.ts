import { RECEPTION_DESK_COPY_STATUS } from "@/content/reception/desk";

/**
 * The Tether reception desk (ADR 0485): off until the owner applies migration 0294. `RECEPTION_DESK=1` turns it on
 * everywhere; a comma-separated list of hospital ids, for those only. In production it also needs the desk copy
 * signed (`RECEPTION_DESK_COPY_STATUS`). Off, `/reception` and its pages are the old workspace, unchanged.
 */
export function receptionDeskLiveFor(
  hospitalId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env.RECEPTION_DESK?.trim();
  if (!value) return false;
  if (env.VERCEL_ENV === "production" && RECEPTION_DESK_COPY_STATUS.status !== "signed")
    return false;
  return value === "1" || value.split(",").some((id) => id.trim() === hospitalId);
}
