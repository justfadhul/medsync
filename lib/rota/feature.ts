/**
 * The duty rota (ADR 0534), per hospital, off by default: `DUTY_ROTA=1` or a comma list of hospital ids.
 * Independent of CARE_REQUESTS. Needs migration 0307. Off, routing stays on team lists and no rota screen shows.
 */
export function dutyRotaLiveFor(hospitalId: string): boolean {
  const value = process.env.DUTY_ROTA?.trim();
  if (!value) return false;
  return value === "1" || value.split(",").some((id) => id.trim() === hospitalId);
}
