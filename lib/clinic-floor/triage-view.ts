/*
 * What the floor's triage pop-up shows beside the engine's verdict (ADR 0531): the NEWS2 chart, the other scores
 * with their working, the trend against earlier triages, the temperature word and the Glasgow Coma Scale total.
 * Pure. Every vital-sign cut-off is the engine's own: the chart is drawn by asking the engine what it scores at
 * each value, and the other scores read the engine's constants. The two exceptions are marked DRAFT below.
 */
import type { AcuityLevel, TriageInput, TriageResult, TriageVitals } from "@/lib/triage/types";

import {
  GLUCOSE,
  MEOWS,
  PULSE_PRESSURE_NARROW_FRACTION,
  QSOFA,
  SHOCK_INDEX,
} from "@/lib/triage/constants";
import { runTriage } from "@/lib/triage/engine";

/* ─── the NEWS2 chart, read from the engine ────────────────────────── */

export type ScoredKey = "respiratoryRate" | "spo2" | "systolicBp" | "pulse" | "temperature";
const SCAN: [ScoredKey, string, number, number, number][] = [
  ["respiratoryRate", "respiratory_rate", 4, 40, 1],
  ["spo2", "spo2", 75, 100, 1],
  ["systolicBp", "systolic_bp", 60, 240, 1],
  ["pulse", "pulse", 25, 150, 1],
  ["temperature", "temperature", 34, 40.5, 0.1],
];
const NORMAL: TriageVitals = {
  respiratoryRate: 16,
  spo2: 98,
  oxygen: "air",
  systolicBp: 120,
  diastolicBp: 80,
  pulse: 70,
  consciousness: "A",
  temperature: 37,
  bloodGlucose: null,
};

/** NEWS2 points the engine gives one sign at one value, with everything else normal. Null: not scored. */
export function pointsFor(
  key: ScoredKey,
  value: number,
  scale2: boolean,
  oxygen: "air" | "oxygen",
): number | null {
  const par = SCAN.find((s) => s[0] === key)![1];
  const input: TriageInput = {
    context: {
      ageYears: 40,
      pregnancy: "not_pregnant",
      reproductiveAgeFemale: false,
      spo2Scale2Enabled: scale2,
    },
    // Scale 2 on oxygen scores a high SpO₂, so the resting value sits inside its normal band.
    vitals: { ...NORMAL, oxygen, spo2: scale2 && oxygen === "oxygen" ? 90 : 98, [key]: value },
  };
  return runTriage(input).news2?.parameters.find((q) => q.parameter === par)?.points ?? null;
}

export interface Band {
  from: number;
  to: number;
  points: number;
}
export interface ChartRow {
  key: ScoredKey;
  bands: Band[];
  /** Seven cells in the chart's order 3 2 1 0 1 2 3 (low side, normal, high side); null where the sign has none. */
  cells: (Band & { label: string })[] | (null | (Band & { label: string }))[];
}

const cache = new Map<string, ChartRow[]>();

/** The NEWS2 chart for this SpO₂ scale and air/oxygen, one row per scored sign. */
export function news2Chart(scale2: boolean, oxygen: "air" | "oxygen"): ChartRow[] {
  const k = `${scale2}:${oxygen}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const rows = SCAN.map(([key, , lo, hi, step]): ChartRow => {
    const bands: Band[] = [];
    for (let x = lo; x <= hi + 1e-9; x += step) {
      const v = Math.round(x * 10) / 10;
      const p = pointsFor(key, v, scale2, oxygen);
      if (p == null) continue;
      const last = bands[bands.length - 1];
      if (last && last.points === p) last.to = v;
      else bands.push({ from: v, to: v, points: p });
    }
    const z = bands.findIndex((b) => b.points === 0);
    const cells: ChartRow["cells"] = Array.from({ length: 7 }, () => null);
    bands.forEach((b, i) => {
      const label =
        i === 0 && b.from <= lo
          ? `≤${b.to}`
          : i === bands.length - 1 && b.to >= hi
            ? `≥${b.from}`
            : b.from === b.to
              ? `${b.from}`
              : `${b.from}–${b.to}`;
      cells[i < z ? 3 - b.points : i === z ? 3 : 3 + b.points] = { ...b, label };
    });
    return { key, bands, cells };
  });
  cache.set(k, rows);
  return rows;
}

/** The band a value falls in: below the first counts as the first, above the last as the last. */
export function bandOf(bands: readonly Band[], value: number): Band | null {
  return (
    bands.find(
      (b, i) => (i === 0 || value > bands[i - 1]!.to) && (i === bands.length - 1 || value <= b.to),
    ) ?? null
  );
}

/** What a NEWS2 total means for the level, as the engine maps it; `on` marks this person's row. */
export function news2Classes(total: number, singleThree: boolean) {
  return [
    { key: "low", level: 4 as AcuityLevel, on: total < 5 && !singleThree },
    { key: "single3", level: 3 as AcuityLevel, on: total < 5 && singleThree },
    { key: "medium", level: 3 as AcuityLevel, on: total >= 5 && total < 7 },
    { key: "high", level: 2 as AcuityLevel, on: total >= 7 },
  ] as const;
}

/* ─── trend against earlier triages ────────────────────────────────── */

export interface Trend {
  last: number;
  /** now − last, to one decimal; null until a new value is typed. */
  delta: number | null;
  dir: "up" | "down" | "same" | null;
  /** Fewer NEWS2 points than last time is better, more is worse; null when the score did not change or the sign is not scored. */
  verdict: "better" | "worse" | null;
  /** Earlier readings oldest first, then the new one when typed: the little line. */
  series: number[];
}

export function trendOf(
  key: keyof TriageVitals,
  earlier: readonly (number | null)[],
  now: number | null,
  ctx: { scale2: boolean; oxygen: "air" | "oxygen" },
): Trend | null {
  const hist = earlier.filter((x): x is number => x != null);
  if (!hist.length) return null;
  const last = hist[hist.length - 1]!;
  if (now == null) return { last, delta: null, dir: null, verdict: null, series: hist };
  const delta = Math.round((now - last) * 10) / 10;
  const scored = SCAN.some((s) => s[0] === key);
  const a = scored ? pointsFor(key as ScoredKey, last, ctx.scale2, ctx.oxygen) : null;
  const b = scored ? pointsFor(key as ScoredKey, now, ctx.scale2, ctx.oxygen) : null;
  return {
    last,
    delta,
    dir: delta > 0 ? "up" : delta < 0 ? "down" : "same",
    verdict: a == null || b == null || a === b ? null : b < a ? "better" : "worse",
    series: [...hist, now],
  };
}

/* ─── the other scores, with their working ─────────────────────────── */

export type Tone = "ok" | "warn" | "bad";
export interface ScoreBand {
  /** The cut-off as shown ("≤ 0.9"). */
  cut: string;
  word: "normal" | "hiddenShock" | "shock" | "bleeding" | "narrow" | "low" | "high";
  tone: Tone;
  on: boolean;
}

export function otherScores(r: TriageResult, v: TriageVitals) {
  const d = r.derived;
  const narrow =
    v.systolicBp == null ? null : Math.round(v.systolicBp * PULSE_PRESSURE_NARROW_FRACTION);
  const f1 = (n: number) => n.toFixed(1);
  return {
    shockIndex: {
      value: d.shockIndex,
      bands: [
        {
          cut: `≤ ${SHOCK_INDEX.OCCULT_SHOCK_GT}`,
          word: "normal",
          tone: "ok",
          on: d.shockIndexFlag === "normal",
        },
        {
          cut: `> ${SHOCK_INDEX.OCCULT_SHOCK_GT}`,
          word: "hiddenShock",
          tone: "warn",
          on: d.shockIndexFlag === "occult_shock",
        },
        {
          cut: `≥ ${f1(SHOCK_INDEX.SHOCK_GTE)}`,
          word: "shock",
          tone: "bad",
          on: d.shockIndexFlag === "shock",
        },
      ] satisfies ScoreBand[],
    },
    modifiedShockIndex: {
      value: d.modifiedShockIndex,
      bands: [
        {
          cut: `≤ ${MEOWS.MSI_HAEMORRHAGE_GT}`,
          word: "normal",
          tone: "ok",
          on: d.modifiedShockIndexFlag === "normal",
        },
        {
          cut: `> ${MEOWS.MSI_HAEMORRHAGE_GT}`,
          word: "bleeding",
          tone: "bad",
          on: d.modifiedShockIndexFlag === "haemorrhage",
        },
      ] satisfies ScoreBand[],
    },
    qsofa: {
      score: d.qsofa?.score ?? null,
      positive: (d.qsofa?.score ?? 0) >= QSOFA.POSITIVE_THRESHOLD,
      positiveAt: QSOFA.POSITIVE_THRESHOLD,
      criteria: [
        {
          key: "rr" as const,
          cut: `≥ ${QSOFA.RESP_RATE_GTE}`,
          value: v.respiratoryRate,
          met: !!d.qsofa?.respiratoryRatePoint,
        },
        {
          key: "sbp" as const,
          cut: `≤ ${QSOFA.SYSTOLIC_BP_LTE}`,
          value: v.systolicBp,
          met: !!d.qsofa?.hypotensionPoint,
        },
        {
          key: "mind" as const,
          cut: "",
          value: v.consciousness,
          met: !!d.qsofa?.alteredMentationPoint,
        },
      ],
    },
    map: { value: d.meanArterialPressure },
    pulsePressure: {
      value: d.pulsePressure,
      narrowPercent: PULSE_PRESSURE_NARROW_FRACTION * 100,
      bands: [
        {
          cut: narrow == null ? "" : `< ${narrow}`,
          word: "narrow",
          tone: "warn",
          on: d.pulsePressureFlag === "narrow",
        },
        {
          cut: narrow == null ? "" : `≥ ${narrow}`,
          word: "normal",
          tone: "ok",
          on: d.pulsePressureFlag === "normal",
        },
      ] satisfies ScoreBand[],
    },
    glucose: {
      value: v.bloodGlucose,
      dkaAbove: GLUCOSE.HYPER_DKA_SCREEN_GT,
      bands: [
        {
          cut: `< ${GLUCOSE.HYPO_LT}`,
          word: "low",
          tone: "bad",
          on: d.glucoseFlag === "hypoglycaemia",
        },
        {
          cut: `${GLUCOSE.HYPO_LT}–${GLUCOSE.HYPER_DKA_SCREEN_GT}`,
          word: "normal",
          tone: "ok",
          on: d.glucoseFlag === "normal",
        },
        {
          cut: `> ${GLUCOSE.HYPER_DKA_SCREEN_GT}`,
          word: "high",
          tone: "warn",
          on: d.glucoseFlag === "hyperglycaemia_dka_screen",
        },
      ] satisfies ScoreBand[],
    },
  };
}

/** The tone a score takes from the band it falls in. */
export const toneOfBands = (bands: readonly ScoreBand[]): Tone | null =>
  bands.find((b) => b.on)?.tone ?? null;

/* ─── DRAFT: temperature in plain words (owner's request 22 Nov 2026; the CSO confirms the cut-offs) ─── */

export const TEMPERATURE_WORDS_CSO_SIGNED = false;
export type TempWord = "hypothermia" | "low" | "normal" | "raised" | "fever" | "highFever";
/** The word and its flag colour. Display only: it never changes a score or a level. */
export function temperatureWord(t: number): { word: TempWord; tone: Tone | "mild" } {
  if (t < 35) return { word: "hypothermia", tone: "bad" };
  if (t <= 36) return { word: "low", tone: "mild" };
  if (t <= 37.5) return { word: "normal", tone: "ok" };
  if (t <= 38) return { word: "raised", tone: "mild" };
  if (t <= 39) return { word: "fever", tone: "warn" };
  return { word: "highFever", tone: "bad" };
}

/* ─── Glasgow Coma Scale: recorded beside the triage, never read by the engine ─── */

export interface Gcs {
  e: number | null;
  v: number | null;
  m: number | null;
}
export const GCS_MAX = { e: 4, v: 5, m: 6 } as const;
export const gcsTotal = (g: Gcs) => (g.e && g.v && g.m ? g.e + g.v + g.m : null);
/** The standard bands: 13 to 15 mild, 9 to 12 moderate, 8 or less severe. */
export const gcsBand = (total: number): "mild" | "moderate" | "severe" =>
  total >= 13 ? "mild" : total >= 9 ? "moderate" : "severe";
/** How it is written into the visit's note, the one place it is kept. */
export const gcsNote = (g: Gcs) => {
  const t = gcsTotal(g);
  return t == null ? null : `GCS ${t} (E${g.e} V${g.v} M${g.m})`;
};

/* ─── Send to: what each doctor is doing now ───────────────────────── */

export interface DoctorLoad {
  /** People waiting for them (in the line or called), not yet in the room. */
  queue: number;
  state: "free" | "with" | "break" | "away";
  /** End of a short break, epoch ms. */
  until: number | null;
}

/**
 * One doctor's load from the floor's own rows and statuses; `doctorId` null is "Any doctor", the clinic's
 * unassigned queue. A break that has run out counts as back in the room.
 */
export function doctorLoad(
  rows: readonly { doctorUserId: string | null; step: string; departmentId?: string | null }[],
  states: ReadonlyMap<string, { status: string; until: number | null }>,
  doctorId: string | null,
  now: number,
  clinicId?: string,
): DoctorLoad {
  const mine = rows.filter(
    (r) => r.doctorUserId === doctorId && (doctorId != null || r.departmentId === clinicId),
  );
  const queue = mine.filter((r) => r.step === "line" || r.step === "called").length;
  const st = doctorId ? states.get(doctorId) : undefined;
  if (st?.status === "away") return { queue, state: "away", until: null };
  if (st?.status.startsWith("break") && st.until != null && st.until > now)
    return { queue, state: "break", until: st.until };
  return { queue, state: mine.some((r) => r.step === "with") ? "with" : "free", until: null };
}
