import { overLimit } from "@/lib/eu/clock";
import { median } from "@/lib/hospital-admin/pilot";
import { MIN_RATE_SAMPLE, ratio, type Ratio, type ReportWindow } from "@/lib/hospital-admin/reports";
import { percentile } from "@/lib/lab/indicators";

/** MoH EU indicators (pure): deaths by time since hospital arrival, length of stay, boarding, over-limit. */
export interface EuReportStay {
  hospitalArrivedAt: string | null;
  decidedAt: string;
  endedAt: string | null;
  endKind: string | null;
  admissionDecidedAt: string | null;
}

interface Spread {
  medianMin: number | null;
  p90Min: number | null;
  n: number;
}

export interface EuReport {
  stays: number;
  deaths: { within2h: number; within8h: number; within24h: number; noArrivalTime: number };
  lengthOfStay: Spread;
  boarding: Spread;
  overLimit: Ratio;
}

const HOUR_MS = 3_600_000;

function spread(ms: number[]): Spread {
  const min = ms.map((d) => Math.round(d / 60_000));
  const ok = min.length >= MIN_RATE_SAMPLE;
  return {
    medianMin: ok ? Math.round(median(min)!) : null,
    p90Min: ok ? percentile(min, 90) : null,
    n: min.length,
  };
}

export function euReport(stays: EuReportStay[], window: ReportWindow, limitHours: number): EuReport {
  // Same rule as the other report windows: from inclusive, to exclusive.
  const inWindow = stays.filter((s) => {
    const t = Date.parse(s.decidedAt);
    return t >= window.from.getTime() && t < window.to.getTime();
  });
  const deaths = { within2h: 0, within8h: 0, within24h: 0, noArrivalTime: 0 };
  const stayMs: number[] = [];
  const boardMs: number[] = [];
  for (const s of inWindow) {
    if (!s.endedAt) continue;
    const end = Date.parse(s.endedAt);
    const usable = (d: number) => Number.isFinite(d) && d >= 0;
    if (s.endKind === "died") {
      // noArrivalTime means no usable arrival time (null, unparsable, or after the end).
      const d = s.hospitalArrivedAt ? end - Date.parse(s.hospitalArrivedAt) : NaN;
      if (!usable(d)) deaths.noArrivalTime++;
      else {
        if (d <= 2 * HOUR_MS) deaths.within2h++;
        if (d <= 8 * HOUR_MS) deaths.within8h++;
        if (d <= 24 * HOUR_MS) deaths.within24h++;
      }
    }
    const los = end - Date.parse(s.decidedAt);
    if (usable(los)) stayMs.push(los);
    if (s.endKind === "admitted" && s.admissionDecidedAt) {
      const b = end - Date.parse(s.admissionDecidedAt);
      if (usable(b)) boardMs.push(b);
    }
  }
  return {
    stays: inWindow.length,
    deaths,
    lengthOfStay: spread(stayMs),
    boarding: spread(boardMs),
    overLimit: ratio(stayMs.filter((d) => overLimit(d, limitHours)).length, stayMs.length, window),
  };
}
