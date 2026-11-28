import type { MonitoringPayload } from "@/lib/emr/charts/payload";

/**
 * The nurse list's line for one patient (ADR 0546, Phase 1): the latest NEWS2 with its signed band label, and when the
 * next set is due from the observations chart's own frequency. No new thresholds: the band comes from the payload
 * (the signed CO-NEWS entry) and the interval from the plan; with no frequency there is no due time.
 */
export interface NewsSummary {
  total: number | null;
  at: string | null;
  bandLabel: string | null;
  emergency: boolean;
  everyHours: number | null;
  dueAt: string | null;
  late: boolean;
}

/** "Hourly" → 1, "4-hourly" → 4, "Every 30 minutes" → 0.5; anything else → null. */
export function hoursFromWord(word: string | null): number | null {
  if (!word) return null;
  const w = word.trim().toLowerCase();
  if (w === "hourly") return 1;
  const h = /^(\d+(?:\.\d+)?)-hourly$/.exec(w);
  if (h) return Number(h[1]);
  const m = /(\d+)\s*min/.exec(w);
  return m ? Number(m[1]) / 60 : null;
}

export function summariseNews(payload: MonitoringPayload | null, now: Date): NewsSummary {
  const empty: NewsSummary = {
    total: null,
    at: null,
    bandLabel: null,
    emergency: false,
    everyHours: null,
    dueAt: null,
    late: false,
  };
  const obs = payload?.charts.find((c) => c.kind === "observations" && c.closedAt === null);
  if (!obs || obs.kind !== "observations") return empty;
  const last = obs.body.news2.reduce<(typeof obs.body.news2)[number] | null>(
    (a, p) => (!a || p.at > a.at ? p : a),
    null,
  );
  const lastSet =
    [last?.at, ...obs.body.strips.flatMap((s) => s.points.map((p) => p.at))]
      .filter((x): x is string => !!x)
      .sort()
      .at(-1) ?? null;
  const band = last
    ? obs.body.bands.find((b) => last.total >= b.from && (b.to === null || last.total <= b.to))
    : undefined;
  const everyHours = hoursFromWord(obs.frequency);
  const dueAt =
    everyHours !== null && lastSet
      ? new Date(new Date(lastSet).getTime() + everyHours * 3_600_000).toISOString()
      : null;
  return {
    total: last?.total ?? null,
    at: last?.at ?? null,
    bandLabel: band?.label ?? null,
    emergency: band?.emergency ?? false,
    everyHours,
    dueAt,
    late: dueAt !== null && new Date(dueAt) <= now,
  };
}

/** Sickest first: highest score, then the longest late, then no score at the end. */
export function bySickest<T extends { news: NewsSummary }>(a: T, b: T): number {
  const ta = a.news.total ?? -1;
  const tb = b.news.total ?? -1;
  if (ta !== tb) return tb - ta;
  return (a.news.dueAt ?? "9").localeCompare(b.news.dueAt ?? "9");
}
