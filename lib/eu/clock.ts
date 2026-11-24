/**
 * The stay's four clocks (ADR 0541). Pure: `nowMs` is passed in, and every count is elapsed time between
 * two recorded instants, so it is the same in Africa/Kampala (UTC+3, no DST), in UTC and across any DST
 * change on the viewer's device. Clocks are text, never colour.
 */
export const EU_STAY_LIMIT_DEFAULT_HOURS = 24;

export interface EuClocks {
  inHospitalMs: number | null;
  inEuMs: number;
  inSpaceMs: number | null;
  boardingMs: number | null;
}

const since = (nowMs: number, iso: string | null): number | null =>
  iso ? Math.max(0, nowMs - Date.parse(iso)) : null;

export function euClocks(i: {
  nowMs: number;
  hospitalArrivedAt: string | null;
  decidedAt: string;
  spaceStartedAt: string | null;
  admissionDecidedAt: string | null;
}): EuClocks {
  return {
    inHospitalMs: since(i.nowMs, i.hospitalArrivedAt),
    inEuMs: since(i.nowMs, i.decidedAt) ?? 0,
    inSpaceMs: since(i.nowMs, i.spaceStartedAt),
    boardingMs: since(i.nowMs, i.admissionDecidedAt),
  };
}

/** "45 min", "3 h 10 min", "26 h 5 min": whole minutes, never days. */
export function durationWords(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Strictly past the limit: exactly the limit is still within it. */
export const overLimit = (inEuMs: number, limitHours: number): boolean =>
  inEuMs > limitHours * 3_600_000;
