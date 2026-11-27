import type { MonitoringPayload } from "@/lib/emr/charts/payload";
import { describe, expect, it } from "vitest";

import { bySickest, hoursFromWord, summariseNews } from "@/lib/nurse/news-summary";

const bands = [
  { from: 0, to: 4, label: "Low", refId: "r1", emergency: false },
  { from: 5, to: 6, label: "Urgent response", refId: "r2", emergency: false },
  { from: 7, to: null, label: "Emergency response", refId: "r3", emergency: true },
];
const payload = (frequency: string | null, news2: { at: string; total: number }[]) =>
  ({
    charts: [
      {
        kind: "observations",
        closedAt: null,
        frequency,
        body: { news2: news2.map((p) => ({ ...p, origin: "nursing" })), bands, strips: [] },
      },
    ],
  }) as unknown as MonitoringPayload;

describe("the nurse list's NEWS2 line (ADR 0545)", () => {
  it("reads the plan's frequency words", () => {
    expect(hoursFromWord("Hourly")).toBe(1);
    expect(hoursFromWord("4-hourly")).toBe(4);
    expect(hoursFromWord("Every 30 minutes")).toBe(0.5);
    expect(hoursFromWord(null)).toBeNull();
    expect(hoursFromWord("When needed")).toBeNull();
  });

  it("takes the latest score, its signed band, and the next set from the chart's frequency", () => {
    const s = summariseNews(
      payload("4-hourly", [
        { at: "2026-11-30T06:00:00.000Z", total: 3 },
        { at: "2026-11-30T08:00:00.000Z", total: 7 },
      ]),
      new Date("2026-11-30T13:00:00.000Z"),
    );
    expect(s.total).toBe(7);
    expect(s.bandLabel).toBe("Emergency response");
    expect(s.emergency).toBe(true);
    expect(s.dueAt).toBe("2026-11-30T12:00:00.000Z");
    expect(s.late).toBe(true);
  });

  it("gives no due time without a frequency, and nothing without an open chart", () => {
    expect(
      summariseNews(payload(null, [{ at: "2026-11-30T08:00:00.000Z", total: 2 }]), new Date())
        .dueAt,
    ).toBeNull();
    expect(summariseNews(null, new Date()).total).toBeNull();
  });

  it("sorts the sickest first and puts no score last", () => {
    const mk = (total: number | null) => ({ news: { ...summariseNews(null, new Date()), total } });
    expect([mk(null), mk(3), mk(7)].sort(bySickest).map((x) => x.news.total)).toEqual([7, 3, null]);
  });
});
