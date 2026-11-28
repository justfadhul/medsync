import { describe, expect, it } from "vitest";

import { chartTab } from "@/components/nurse-ward/chart";
import { dueWords } from "@/components/nurse-ward/screens";

const NOW = new Date("2026-11-30T08:50:00Z");
const news = (dueIn: number | null, everyHours: number | null = 4) => ({
  total: 3,
  at: null,
  bandLabel: null,
  emergency: false,
  everyHours,
  dueAt: dueIn === null ? null : new Date(NOW.getTime() + dueIn * 60_000).toISOString(),
  late: dueIn !== null && dueIn < 0,
});

describe("the ward desk's chart and list words (ADR 0546)", () => {
  it("opens the care plan unless a known tab is named", () => {
    expect(chartTab(undefined)).toBe("care");
    expect(chartTab("meds")).toBe("meds");
    expect(chartTab("../admin")).toBe("care");
  });

  it("says when vitals are due, late or not set, without inventing a time", () => {
    expect(dueWords(news(-35), NOW)).toBe("Vitals late 35 min");
    expect(dueWords(news(10), NOW)).toBe("Vitals in 10 min");
    expect(dueWords(news(140), NOW)).toBe("Vitals at 14:10");
    expect(dueWords(news(null, null), NOW)).toBe("No vitals frequency set");
    expect(dueWords(news(null), NOW)).toBe("No vitals yet");
  });
});
