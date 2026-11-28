/**
 * The nurse ward desk (ADR 0546): `NURSE_WARD_V2=1` turns it on everywhere; a comma-separated list of hospital ids,
 * for those only. Off, every `/nurse` page is unchanged.
 */
export function nurseWardV2LiveFor(hospitalId: string): boolean {
  const value = process.env.NURSE_WARD_V2?.trim();
  if (!value) return false;
  return value === "1" || value.split(",").some((id) => id.trim() === hospitalId);
}
