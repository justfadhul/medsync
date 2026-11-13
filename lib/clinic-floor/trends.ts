/**
 * Trends read model → cards (prompt §4 Trends, ADR 0496) — PURE. Readings arrive per patient by code and date
 * (vitals from triage records, labs from released results); bands come from content (D-CF-08), never code.
 * Glucose carries its timing: an untimed reading never enters a timed series (S21).
 */
import type { Band, TrendBands } from "@/content/clinic-floor/bands";

import { TREND_BANDS } from "@/content/clinic-floor/bands";

export type GlucoseTiming = "fasting" | "before_lunch" | "after_meal_2h" | "bedtime";
export type ReadingCode =
  | "bp"
  | "weight"
  | "sugar_random"
  | "hba1c"
  | "glucose"
  | "ldl"
  | "total"
  | "hdl"
  | "tg";

export interface Reading {
  code: ReadingCode;
  /** Epoch ms of the visit or result. */
  at: number;
  value: number;
  /** Blood pressure only: the diastolic. */
  value2?: number;
  /** Glucose only; untimed glucose is `sugar_random`, never `glucose`. */
  timing?: GlucoseTiming;
  /** "at triage today", "lab result", … shown on hover. */
  source?: string;
}

export type CardKey = "bp" | "weight" | "sugar" | "hba1c" | "glucose" | "lipids";
export interface Series {
  /** The chip for picker cards (timing or lipid); null for single-series cards. */
  pick: GlucoseTiming | "ldl" | "total" | "hdl" | "tg" | null;
  band: Band | null;
  points: { at: number; value: number; value2?: number; out: boolean; source?: string }[];
}
export interface TrendCard {
  key: CardKey;
  kind: "vitals" | "labs";
  unit: string;
  dp: number;
  series: Series[];
}

const TIMINGS: GlucoseTiming[] = ["fasting", "before_lunch", "after_meal_2h", "bedtime"];
const LIPIDS = ["ldl", "total", "hdl", "tg"] as const;

export function bandsFor(clinicId: string): TrendBands {
  return { ...TREND_BANDS.default, ...(TREND_BANDS.byClinic[clinicId] ?? {}) };
}

export const outOf = (band: Band | null, v: number) =>
  !!band && ((band[0] != null && v < band[0]) || (band[1] != null && v > band[1]));

function series(
  rs: Reading[],
  band: Band | null,
  pick: Series["pick"],
  band2?: Band | null,
): Series {
  return {
    pick,
    band,
    points: rs
      .slice()
      .sort((a, b) => a.at - b.at)
      .map((r) => ({
        at: r.at,
        value: r.value,
        value2: r.value2,
        source: r.source,
        out: outOf(band, r.value) || (r.value2 != null && outOf(band2 ?? null, r.value2)),
      })),
  };
}

/** Cards with at least two readings in a series, in the canvas's order. */
export function trendCards(
  readings: readonly Reading[],
  clinicId: string,
  sex: "F" | "M" | null,
): TrendCard[] {
  const b = bandsFor(clinicId);
  const of = (code: ReadingCode) => readings.filter((r) => r.code === code);
  const cards: TrendCard[] = [];
  const add = (card: TrendCard) => {
    card.series = card.series.filter((s) => s.points.length >= 2);
    if (card.series.length) cards.push(card);
  };
  add({
    key: "bp",
    kind: "vitals",
    unit: "mmHg",
    dp: 0,
    series: [series(of("bp"), b.bpSystolic, null, b.bpDiastolic)],
  });
  add({
    key: "weight",
    kind: "vitals",
    unit: "kg",
    dp: 0,
    series: [series(of("weight"), null, null)],
  });
  add({
    key: "sugar",
    kind: "vitals",
    unit: "mmol/L",
    dp: 1,
    series: [series(of("sugar_random"), b.sugarRandom, null)],
  });
  add({
    key: "hba1c",
    kind: "labs",
    unit: "%",
    dp: 1,
    series: [series(of("hba1c"), b.hba1c, null)],
  });
  add({
    key: "glucose",
    kind: "labs",
    unit: "mmol/L",
    dp: 1,
    // S21: only readings that carry this exact timing; untimed glucose is never here.
    series: TIMINGS.map((t) =>
      series(
        of("glucose").filter((r) => r.timing === t),
        b[t],
        t,
      ),
    ),
  });
  const hdl = sex === "F" ? b.hdlF : sex === "M" ? b.hdlM : null;
  add({
    key: "lipids",
    kind: "labs",
    unit: "mmol/L",
    dp: 1,
    series: LIPIDS.map((k) =>
      series(of(k), k === "hdl" ? hdl : k === "ldl" ? b.ldl : k === "total" ? b.total : b.tg, k),
    ),
  });
  return cards;
}

/** "In / Above / Below target" for a value against a band. */
export function bandStatus(band: Band | null, v: number): "in" | "above" | "below" | null {
  if (!band) return null;
  if (band[1] != null && v > band[1]) return "above";
  if (band[0] != null && v < band[0]) return "below";
  return "in";
}
