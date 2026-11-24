import { describe, expect, it } from "vitest";

import { euReport, type EuReportStay } from "@/lib/eu/report";
import type { ReportWindow } from "@/lib/hospital-admin/reports";

const T0 = Date.parse("2026-11-10T00:00:00Z");
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
const window: ReportWindow = { days: 28, from: new Date(T0 - 86_400_000), to: new Date(T0 + 10 * 86_400_000) };

const stay = (o: Partial<EuReportStay> = {}): EuReportStay => ({
  hospitalArrivedAt: null,
  decidedAt: iso(0),
  endedAt: iso(60),
  endKind: "home",
  admissionDecidedAt: null,
  ...o,
});
/** A death `m` minutes after hospital arrival. */
const death = (m: number) => stay({ hospitalArrivedAt: iso(0), decidedAt: iso(10), endedAt: iso(m), endKind: "died" });
const many = (n: number, o: (i: number) => Partial<EuReportStay>) =>
  Array.from({ length: n }, (_, i) => stay(o(i)));

describe("euReport", () => {
  it("a death at exactly 2 h counts in 2, 8 and 24 h", () => {
    expect(euReport([death(120)], window, 24).deaths).toEqual({ within2h: 1, within8h: 1, within24h: 1, noArrivalTime: 0 });
  });
  it("at 2 h + 1 min it counts in 8 and 24 h only; at 25 h in none", () => {
    expect(euReport([death(121)], window, 24).deaths).toMatchObject({ within2h: 0, within8h: 1, within24h: 1 });
    expect(euReport([death(25 * 60)], window, 24).deaths).toMatchObject({ within2h: 0, within8h: 0, within24h: 0 });
  });
  it("a death with no arrival time counts in noArrivalTime only", () => {
    const r = euReport([stay({ endKind: "died" })], window, 24);
    expect(r.deaths).toEqual({ within2h: 0, within8h: 0, within24h: 0, noArrivalTime: 1 });
  });
  it("19 ended stays give null medians, 20 give numbers", () => {
    const s = (i: number) => ({ endedAt: iso(30 + i) });
    expect(euReport(many(19, s), window, 24).lengthOfStay).toEqual({ medianMin: null, p90Min: null, n: 19 });
    const r = euReport(many(20, s), window, 24).lengthOfStay;
    expect(r.n).toBe(20);
    expect(r.medianMin).toBe(40); // 39.5 rounds to 40
    expect(r.p90Min).toBe(47);
  });
  it("boarding comes only from stays ended admitted", () => {
    const s = many(20, () => ({ endKind: "admitted", admissionDecidedAt: iso(20), endedAt: iso(80) }));
    const r = euReport([...s, stay({ admissionDecidedAt: iso(0), endedAt: iso(999) })], window, 24);
    expect(r.boarding).toEqual({ medianMin: 60, p90Min: 60, n: 20 });
    expect(euReport(many(20, () => ({})), window, 24).boarding.n).toBe(0);
  });
  it("window: decidedAt at from counts, at to does not", () => {
    const w: ReportWindow = { days: 7, from: new Date(T0), to: new Date(T0 + 60_000) };
    const r = euReport([stay({ decidedAt: iso(0) }), stay({ decidedAt: iso(1) }), stay({ decidedAt: iso(-1) })], w, 24);
    expect(r.stays).toBe(1);
  });
  it("overLimit counts ended stays only; exactly the limit is not over", () => {
    const s = [
      ...many(19, () => ({ endedAt: iso(24 * 60) })),
      stay({ endedAt: iso(24 * 60 + 1) }),
      stay({ endedAt: null, endKind: null }),
    ];
    const o = euReport(s, window, 24).overLimit;
    expect([o.numerator, o.denominator]).toEqual([1, 20]);
    expect(o.share).toBe(0.05);
  });
  it("a negative duration (clock skew) is excluded from medians and counted nowhere", () => {
    const s = [...many(20, () => ({ endedAt: iso(60) })), stay({ endedAt: iso(-5) })];
    const r = euReport(s, window, 24);
    expect(r.lengthOfStay).toEqual({ medianMin: 60, p90Min: 60, n: 20 });
    expect(r.overLimit.denominator).toBe(20);
  });
  it("an unparsable decidedAt does not corrupt the measures", () => {
    const r = euReport([...many(20, () => ({ endedAt: iso(60) })), stay({ decidedAt: "nonsense" })], window, 24);
    expect(r.lengthOfStay).toEqual({ medianMin: 60, p90Min: 60, n: 20 });
    expect(r.overLimit.denominator).toBe(20);
  });
  it("a death before arrival, or with an unparsable time, counts in noArrivalTime only", () => {
    const before = stay({ hospitalArrivedAt: iso(100), endedAt: iso(50), endKind: "died" });
    const nan = stay({ hospitalArrivedAt: "nonsense", endedAt: iso(50), endKind: "died" });
    expect(euReport([before, nan], window, 24).deaths).toEqual({ within2h: 0, within8h: 0, within24h: 0, noArrivalTime: 2 });
  });
  it("a length-of-stay-skewed admitted stay still counts in boarding", () => {
    const s = many(20, () => ({ endKind: "admitted", decidedAt: iso(100), admissionDecidedAt: iso(0), endedAt: iso(60) }));
    const r = euReport(s, window, 24);
    expect(r.lengthOfStay.n).toBe(0);
    expect(r.boarding).toEqual({ medianMin: 60, p90Min: 60, n: 20 });
  });
});
