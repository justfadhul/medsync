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

/** A bay's link counts only while its space is still a live resus space of an emergency unit (R66); else unlinked. */
export function withLiveLinks<B extends { bedId: string | null }>(
  bays: B[],
  liveSpaceIds: string[],
): B[] {
  const live = new Set(liveSpaceIds);
  return bays.map((b) => (b.bedId && !live.has(b.bedId) ? { ...b, bedId: null } : b));
}
