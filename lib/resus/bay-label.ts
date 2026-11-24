/** A bay's desk label: "<ward> <space> · <device>" when it is drawn in an emergency unit, else "<bay> · <device>". */
export function bayLabel(b: {
  bayLabel: string;
  deviceModel: string | null;
  ward: string | null;
  space: string | null;
}): string {
  const place = b.ward && b.space ? `${b.ward} ${b.space}` : b.bayLabel;
  return b.deviceModel ? `${place} · ${b.deviceModel}` : place;
}
