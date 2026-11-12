/**
 * Record rows → the monitoring payload (ADR 0189, MONITORING-CHARTS.md §2–4). Pure: the loader
 * (lib/emr/read/monitoring.ts) reads the rows, this shapes them, the views draw the result.
 *
 * Nothing here flags a value. Blank is not zero: a missing value stays null, urine "not measured"
 * stays stated, and the running balance sums recorded entries only (lib/emr/charts/fluids.ts).
 * NEWS2 is worked out by the triage engine, never re-implemented, and only for a complete set.
 */
import type { FluidEntry, FluidKind } from "./fluids";
import type {
  FluidBalanceBody,
  FluidEntryView,
  FluidHourRow,
  FluidIvLine,
  GlucoseBody,
  MarBody,
  MarCell,
  MarRow,
  MonitoringChartCard,
  MonitoringPayload,
  News2Band,
  ObservationsBody,
  Origin,
  ReferenceLine,
  TemperatureBody,
  VitalStrip,
} from "./payload";
import type { ChartFrequency, ChartKind } from "./rules";
import type { Acvpu, AdultVitals } from "@/lib/triage/types";

import { HYPO_THRESHOLD_MMOL } from "@/lib/prescribing/plan-checks";
import { durationWords, FREQUENCY_WORD, PURPOSE_WORD, ROUTE_WORD } from "@/lib/prescribing/plan-rx";
import {
  CLOSEOUT_REF,
  NEWS2_EMERGENCY_MIN,
  NEWS2_URGENT_MIN,
} from "@/lib/resus/reference/levels-of-care";
import { scoreNews2 } from "@/lib/triage/scoring/news2";
import {
  chartDayStart,
  currentFluidEntries,
  dropsPerMinute,
  fluidHours,
  fluidSummary,
  mlPerHour,
  URINE_REFERENCE_ML_PER_KG_PER_H,
  urineReferenceMlPerHour,
} from "./fluids";
import { URINE_REFERENCE_LABEL } from "./payload";
import { CHART_FREQUENCY_WORD, CHART_KINDS, CHART_NAME, CHART_RULES } from "./rules";
import { formatClock } from "./scale";

const HOUR = 3600000;
const iso = (d: Date) => d.toISOString();
const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/* ─── Rows as the record holds them ──────────────────────────────── */

export interface ChartRowIn {
  id: string;
  kind: string;
  /** monitoring_charts.opened_by: {rule, label, items}. */
  openedBy: unknown;
  frequency: string | null;
  measureUrine: boolean;
  openedAt: Date;
  closedAt: Date | null;
}

export interface FluidEntryRowIn {
  id: string;
  kind: string;
  routeDetail: string | null;
  volumeMl: string | number | null;
  measured: boolean;
  prescriptionId: string | null;
  effectiveAt: Date;
  recordedAt: Date;
  state: string;
  replacesId: string | null;
}

export interface PrescriptionRowIn {
  id: string;
  drugName: string;
  dose: string;
  route: string;
  frequency: string | null;
  prn: boolean;
  start: string | null;
  state: string;
  kind: string;
  fluidPurpose: string | null;
  volumeMl: string | number | null;
  overMinutes: number | null;
  givingSetDropsPerMl: number | null;
  createdAt: Date;
}

export interface MarRowIn {
  id: string;
  prescriptionId: string;
  state: string;
  withheldReason: string | null;
  scheduledFor: Date | null;
  administeredAt: Date;
  isHighAlert: boolean;
  cosignedByUserId: string | null;
}

/** The doses that stand: a reversal row (0281) and the dose it undoes both drop out. */
export function liveDoses<T extends { id: string; state: string; reversesId: string | null }>(
  rows: readonly T[],
): T[] {
  const undone = new Set(rows.flatMap((r) => (r.reversesId ? [r.reversesId] : [])));
  return rows.filter((r) => r.state !== "reversed" && !undone.has(r.id));
}

export type VitalKey = "rr" | "spo2" | "sbp" | "pulse" | "temp" | "acvpu" | "glucose";

/** One vital-sign value from clinical_observations (or the encounter's triage record). */
export interface VitalReading {
  id: string;
  key: VitalKey;
  /** In the concept's canonical unit; null for consciousness. */
  value: number | null;
  acvpu?: Acvpu | null;
  at: Date;
  /** Readings saved together: one reading set, one triage record, one legacy save. */
  setKey: string;
  /** From the encounter's triage record: drawn as a clerking value. */
  fromTriage?: boolean;
  /** Temperature site as recorded (axillary, oral, tympanic, rectal, temporal). */
  site?: string | null;
  oxygen?: "air" | "oxygen" | null;
  spo2Scale?: "scale1" | "scale2";
}

export interface MonitoringInput {
  charts: readonly ChartRowIn[];
  fluidEntries: readonly FluidEntryRowIn[];
  prescriptions: readonly PrescriptionRowIn[];
  mar: readonly MarRowIn[];
  vitals: readonly VitalReading[];
  weight: { kg: number; at: Date; source: string } | null;
  now: Date;
  /** Defaults to local midnight (ADR 0189 §3). */
  dayStart?: Date;
}

/* ─── The payload ────────────────────────────────────────────────── */

const isChartKind = (k: string): k is ChartKind => (CHART_KINDS as readonly string[]).includes(k);

function openedByOf(v: unknown): { rule: string | null; label: string | null } {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return {
    rule: typeof o.rule === "string" ? o.rule : null,
    label: typeof o.label === "string" && o.label.trim() ? o.label : null,
  };
}

/** A value is from clerking when it was recorded before the plan opened the chart, or at triage. */
const originOf = (at: Date, openedAt: Date, fromTriage = false): Origin =>
  fromTriage || at.getTime() < openedAt.getTime() ? "clerking" : "nursing";

export function buildMonitoringPayload(input: MonitoringInput): MonitoringPayload {
  const dayStart = input.dayStart ?? chartDayStart(input.now);
  const order = (k: string) => CHART_KINDS.indexOf(k as ChartKind);
  const charts = input.charts
    .filter((c) => isChartKind(c.kind))
    .sort(
      (a, b) =>
        order(a.kind) - order(b.kind) ||
        Number(a.closedAt !== null) - Number(b.closedAt !== null) ||
        b.openedAt.getTime() - a.openedAt.getTime(),
    )
    .map((c) => buildCard(c, input, dayStart));
  return {
    charts,
    weight: input.weight
      ? { kg: input.weight.kg, at: iso(input.weight.at), source: input.weight.source }
      : null,
    dayStart: iso(dayStart),
    now: iso(input.now),
  };
}

function buildCard(c: ChartRowIn, input: MonitoringInput, dayStart: Date): MonitoringChartCard {
  const kind = c.kind as ChartKind;
  const opened = openedByOf(c.openedBy);
  const base = {
    id: c.id,
    name: CHART_NAME[kind],
    openedByLabel: opened.label ?? "The plan",
    rule: CHART_RULES.find((r) => r.id === opened.rule)?.when ?? opened.rule ?? "The plan",
    frequency: c.frequency ? (CHART_FREQUENCY_WORD[c.frequency as ChartFrequency] ?? null) : null,
    measureUrine: c.measureUrine,
    openedAt: iso(c.openedAt),
    closedAt: c.closedAt ? iso(c.closedAt) : null,
  };
  switch (kind) {
    case "fluid_balance":
      return {
        ...base,
        kind,
        body: buildFluidBody({
          chart: c,
          entries: input.fluidEntries,
          prescriptions: input.prescriptions,
          weightKg: input.weight?.kg ?? null,
          dayStart,
          now: input.now,
        }),
      };
    case "observations":
      return { ...base, kind, body: buildObservationsBody({ chart: c, vitals: input.vitals }) };
    case "temperature":
      return { ...base, kind, body: buildTemperatureBody({ chart: c, vitals: input.vitals }) };
    case "glucose":
      return { ...base, kind, body: buildGlucoseBody({ chart: c, vitals: input.vitals }) };
    case "mar":
      return {
        ...base,
        kind,
        body: buildMarBody({
          chart: c,
          prescriptions: input.prescriptions,
          mar: input.mar,
          dayStart,
          now: input.now,
        }),
      };
  }
}

/* ─── Fluid balance ──────────────────────────────────────────────── */

const FLUID_KINDS: readonly FluidKind[] = ["iv_in", "oral_in", "urine_out", "other_out"];

function toFluidEntry(r: FluidEntryRowIn): FluidEntry & { row: FluidEntryRowIn } {
  return {
    id: r.id,
    kind: r.kind as FluidKind,
    volumeMl: num(r.volumeMl),
    measured: r.measured,
    effectiveAt: r.effectiveAt,
    prescriptionId: r.prescriptionId,
    state: r.state === "entered_in_error" ? "entered_in_error" : "recorded",
    replacesId: r.replacesId,
    row: r,
  };
}

/** "Ringer's lactate 1000 mL over 8 h". */
export function fluidLabel(rx: PrescriptionRowIn): string {
  const volume = num(rx.volumeMl);
  if (rx.kind !== "fluid" || volume === null) return `${rx.drugName} ${rx.dose}`.trim();
  const over = rx.overMinutes ? ` over ${durationWords(rx.overMinutes)}` : "";
  return `${rx.drugName} ${volume} mL${over}`;
}

function ivLineOf(rx: PrescriptionRowIn): FluidIvLine {
  const volume = num(rx.volumeMl);
  const rate =
    volume !== null && rx.overMinutes
      ? mlPerHour(volume, { value: rx.overMinutes, unit: "min" })
      : null;
  const set =
    rx.givingSetDropsPerMl === 20 || rx.givingSetDropsPerMl === 60 ? rx.givingSetDropsPerMl : null;
  return {
    key: rx.id,
    label: fluidLabel(rx),
    volumeMl: volume,
    overMinutes: rx.overMinutes,
    mlPerHour: rate,
    dropsPerMinute: rate !== null && set ? dropsPerMinute(rate, set) : null,
    dropsPerMl: set,
    purpose:
      rx.fluidPurpose && rx.fluidPurpose in PURPOSE_WORD
        ? PURPOSE_WORD[rx.fluidPurpose as keyof typeof PURPOSE_WORD]
        : null,
  };
}

export function buildFluidBody(i: {
  chart: ChartRowIn;
  entries: readonly FluidEntryRowIn[];
  prescriptions: readonly PrescriptionRowIn[];
  weightKg: number | null;
  dayStart: Date;
  now: Date;
}): FluidBalanceBody {
  const stepHours: 1 | 4 = i.chart.frequency === "4h" ? 4 : 1;
  const step = stepHours * HOUR;
  const until = i.chart.closedAt && i.chart.closedAt < i.now ? i.chart.closedAt : i.now;
  const entries = i.entries
    .filter((e) => FLUID_KINDS.includes(e.kind as FluidKind))
    .map(toFluidEntry);
  const all = fluidHours(entries, { dayStart: i.dayStart, until, stepHours });
  // Hours before the plan opened the chart were never asked for: they are left off, not gaps.
  let first = 0;
  while (
    first < all.length &&
    all[first]!.gap &&
    all[first]!.start.getTime() + step <= i.chart.openedAt.getTime()
  )
    first++;
  const hours = all.slice(first);
  const reference = urineReferenceMlPerHour(i.weightKg);
  const summary = fluidSummary(hours, reference, stepHours);

  const rows: FluidHourRow[] = hours.map((h) => ({
    start: iso(h.start),
    ivIn: { ...h.ivIn },
    ivInTotal: h.ivInTotal,
    oralIn: h.oralIn,
    urineOut: h.urineOut,
    urineNotMeasured: h.urineNotMeasured,
    otherOut: h.otherOut,
    totalIn: h.totalIn,
    totalOut: h.totalOut,
    running: h.running,
    gap: h.gap,
    inProgress: h.start.getTime() <= i.now.getTime() && i.now.getTime() < h.start.getTime() + step,
  }));

  // One IV row per fluid prescription of the visit, plus any prescription or "other" the entries name.
  const byId = new Map(i.prescriptions.map((p) => [p.id, p]));
  const lineKeys = new Set(i.prescriptions.filter((p) => p.kind === "fluid").map((p) => p.id));
  for (const h of rows) for (const k of Object.keys(h.ivIn)) lineKeys.add(k);
  const ivLines: FluidIvLine[] = [...lineKeys].map((k) => {
    const rx = byId.get(k);
    if (rx) return ivLineOf(rx);
    return {
      key: k,
      label: k === "other" ? "IV, no prescription named" : "IV, prescription not found",
      volumeMl: null,
      overMinutes: null,
      mlPerHour: null,
      dropsPerMinute: null,
      dropsPerMl: null,
      purpose: null,
    };
  });

  const standing: FluidEntryView[] = currentFluidEntries(entries)
    .sort(
      (a, b) =>
        b.effectiveAt.getTime() - a.effectiveAt.getTime() ||
        b.row.recordedAt.getTime() - a.row.recordedAt.getTime(),
    )
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      volumeMl: e.volumeMl,
      measured: e.measured,
      routeDetail: e.row.routeDetail,
      prescriptionId: e.prescriptionId ?? null,
      effectiveAt: iso(e.effectiveAt),
      recordedAt: iso(e.row.recordedAt),
      corrects: e.replacesId != null,
    }));

  return {
    kind: "fluid_balance",
    stepHours,
    ivLines,
    hours: rows,
    summary,
    urineReference:
      reference === null
        ? null
        : {
            mlPerHour: reference,
            mlPerKgPerHour: URINE_REFERENCE_ML_PER_KG_PER_H,
            label: URINE_REFERENCE_LABEL,
          },
    entries: standing,
  };
}

/* ─── Observations and NEWS2 ─────────────────────────────────────── */

/** The signed entry's words up to its first ";": "NEWS2 ≥ 7: emergency response". */
const bandLabel = (id: string) => CLOSEOUT_REF[id]!.text.split(";")[0]!.trim();

/** RCP 2017 response bands, thresholds and words from the signed CO-NEWS entries. */
export const NEWS2_BANDS: readonly News2Band[] = [
  { from: 0, to: 0, label: bandLabel("CO-NEWS-05"), refId: "CO-NEWS-05", emergency: false },
  {
    from: 1,
    to: NEWS2_URGENT_MIN - 1,
    label: bandLabel("CO-NEWS-04"),
    refId: "CO-NEWS-04",
    emergency: false,
  },
  {
    from: NEWS2_URGENT_MIN,
    to: NEWS2_EMERGENCY_MIN - 1,
    label: bandLabel("CO-NEWS-02"),
    refId: "CO-NEWS-02",
    emergency: false,
  },
  {
    from: NEWS2_EMERGENCY_MIN,
    to: null,
    label: bandLabel("CO-NEWS-01"),
    refId: "CO-NEWS-01",
    emergency: true,
  },
];
export const NEWS2_BAND_SOURCE = "RCP 2017 NEWS2 response bands (signed entries CO-NEWS-01 to 05)";

const STRIPS: readonly Omit<VitalStrip, "points">[] = [
  { key: "rr", label: "Respiratory rate", unit: "/min" },
  { key: "spo2", label: "SpO₂", unit: "%" },
  { key: "sbp", label: "Systolic BP", unit: "mmHg" },
  { key: "pulse", label: "Pulse", unit: "/min" },
  { key: "temp", label: "Temperature", unit: "°C" },
];

interface ReadingSet {
  key: string;
  at: Date;
  fromTriage: boolean;
  readings: VitalReading[];
}

function readingSets(vitals: readonly VitalReading[]): ReadingSet[] {
  const sets = new Map<string, ReadingSet>();
  for (const v of vitals) {
    const s = sets.get(v.setKey) ?? { key: v.setKey, at: v.at, fromTriage: false, readings: [] };
    s.readings.push(v);
    if (v.at > s.at) s.at = v.at;
    s.fromTriage ||= !!v.fromTriage;
    sets.set(v.setKey, s);
  }
  return [...sets.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
}

function setVitals(s: ReadingSet): AdultVitals & { any: boolean } {
  const value = (k: VitalKey) =>
    s.readings.find((r) => r.key === k && r.value !== null)?.value ?? null;
  const spo2 = s.readings.find((r) => r.key === "spo2");
  const acvpu =
    s.readings.find((r) => r.key === "acvpu" && r.acvpu)?.acvpu ??
    s.readings.find((r) => r.acvpu)?.acvpu ??
    null;
  const v: AdultVitals = {
    respiratoryRate: value("rr"),
    spo2: value("spo2"),
    spo2Scale: spo2?.spo2Scale ?? "scale1",
    oxygen: spo2?.oxygen ?? s.readings.find((r) => r.oxygen)?.oxygen ?? null,
    systolicBp: value("sbp"),
    pulse: value("pulse"),
    consciousness: acvpu,
    temperature: value("temp"),
  };
  const any =
    v.respiratoryRate !== null ||
    v.spo2 !== null ||
    v.systolicBp !== null ||
    v.pulse !== null ||
    v.temperature !== null ||
    v.consciousness !== null;
  return { ...v, any };
}

export function buildObservationsBody(i: {
  chart: Pick<ChartRowIn, "openedAt">;
  vitals: readonly VitalReading[];
}): ObservationsBody {
  const news2: ObservationsBody["news2"] = [];
  const consciousness: ObservationsBody["consciousness"] = [];
  let incompleteSets = 0;
  for (const s of readingSets(i.vitals)) {
    const v = setVitals(s);
    if (!v.any) continue;
    const origin = originOf(s.at, i.chart.openedAt, s.fromTriage);
    if (v.consciousness) consciousness.push({ at: iso(s.at), value: v.consciousness, origin });
    // A partial set scores its missing inputs as 0: no score is drawn from it (research doc §10).
    const r = scoreNews2(v);
    if (r.provisional) incompleteSets++;
    else news2.push({ at: iso(s.at), total: r.total, origin });
  }
  const strips: VitalStrip[] = STRIPS.map((s) => ({
    ...s,
    points: i.vitals
      .filter((v) => v.key === s.key && v.value !== null)
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map((v) => ({
        at: iso(v.at),
        value: v.value!,
        origin: originOf(v.at, i.chart.openedAt, v.fromTriage),
      })),
  }));
  return {
    kind: "observations",
    news2,
    incompleteSets,
    bands: [...NEWS2_BANDS],
    bandSource: NEWS2_BAND_SOURCE,
    strips,
    consciousness,
  };
}

/* ─── Temperature and capillary glucose ──────────────────────────── */

/** Sites that read core temperature; the exam catalogue offers rectal of these today. */
export const CORE_TEMPERATURE_SITES: ReadonlySet<string> = new Set([
  "rectal",
  "oesophageal",
  "bladder",
]);
/** MONITORING-CHARTS.md §2: a draft reference line, labelled as such; it never flags. */
export const TEMPERATURE_REFERENCE: ReferenceLine = { value: 35, label: "35 °C, to verify" };
/** The signed hypoglycaemia threshold (JBDS 2023, lib/prescribing/plan-checks.ts). */
export const GLUCOSE_REFERENCE: ReferenceLine = {
  value: HYPO_THRESHOLD_MMOL,
  label: `${HYPO_THRESHOLD_MMOL.toFixed(1)} mmol/L (JBDS 2023)`,
};

const pointsOf = (vitals: readonly VitalReading[], key: VitalKey) =>
  vitals
    .filter((v) => v.key === key && v.value !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

export function buildTemperatureBody(i: {
  chart: Pick<ChartRowIn, "openedAt">;
  vitals: readonly VitalReading[];
}): TemperatureBody {
  return {
    kind: "temperature",
    points: pointsOf(i.vitals, "temp").map((v) => ({
      at: iso(v.at),
      value: v.value!,
      site: v.site && CORE_TEMPERATURE_SITES.has(v.site) ? "core" : "peripheral",
      siteLabel: v.site ?? null,
      origin: originOf(v.at, i.chart.openedAt, v.fromTriage),
    })),
    reference: TEMPERATURE_REFERENCE,
  };
}

export function buildGlucoseBody(i: {
  chart: Pick<ChartRowIn, "openedAt">;
  vitals: readonly VitalReading[];
}): GlucoseBody {
  return {
    kind: "glucose",
    points: pointsOf(i.vitals, "glucose").map((v) => ({
      at: iso(v.at),
      value: v.value!,
      origin: originOf(v.at, i.chart.openedAt, v.fromTriage),
    })),
    reference: GLUCOSE_REFERENCE,
  };
}

/* ─── Medicine administration record ─────────────────────────────── */

const INTERVAL_HOURS: Readonly<Record<string, number>> = {
  daily: 24,
  "12h": 12,
  "8h": 8,
  "6h": 6,
  "4h": 4,
};
const OMITTED_WORD: Readonly<Record<string, string>> = {
  withheld: "withheld",
  refused: "patient refused",
  wasted: "wasted",
};

const recordTime = (r: MarRowIn) => r.scheduledFor ?? r.administeredAt;

function recordCell(r: MarRowIn, at: Date): MarCell {
  if (r.state !== "administered") {
    const reason = r.withheldReason?.trim() || OMITTED_WORD[r.state] || r.state;
    return { at: iso(at), state: "omitted", word: `Omitted (${reason})`, detail: null };
  }
  const given = `Given ${formatClock(r.administeredAt)}`;
  if (r.isHighAlert && !r.cosignedByUserId)
    return { at: iso(at), state: "awaiting_cosign", word: "Awaiting co-sign", detail: given };
  return { at: iso(at), state: "given", word: given, detail: null };
}

/** A due time with nothing recorded against it: still to come, or past and not yet recorded. */
const openCell = (at: Date, now: Date): MarCell =>
  at.getTime() > now.getTime()
    ? { at: iso(at), state: "due", word: "Due", detail: null }
    : { at: iso(at), state: "delayed", word: "Delayed", detail: null };

/**
 * One MAR row: a cell per due time in the window, each matched to the dose recorded for it (the
 * nearest within half an interval). A dose that matches no due time gets its own cell. A fluid has
 * one cell: Running while its time is not up, then Given with its start.
 */
export function buildMarRow(
  rx: PrescriptionRowIn,
  records: readonly MarRowIn[],
  opts: { windowStart: Date; dayEnd: Date; now: Date },
): MarRow {
  const sorted = [...records].sort((a, b) => recordTime(a).getTime() - recordTime(b).getTime());
  const active = rx.state === "active";

  if (rx.kind === "fluid") {
    const volume = num(rx.volumeMl);
    const rate =
      volume !== null && rx.overMinutes
        ? mlPerHour(volume, { value: rx.overMinutes, unit: "min" })
        : null;
    const cells: MarCell[] = sorted
      .filter((r) => r.state !== "administered")
      .map((r) => recordCell(r, recordTime(r)));
    const started = sorted.find((r) => r.state === "administered");
    let note: string | null = null;
    if (started) {
      const from = started.administeredAt;
      const ends = rx.overMinutes ? from.getTime() + rx.overMinutes * 60000 : null;
      cells.push(
        ends !== null && opts.now.getTime() < ends
          ? {
              at: iso(from),
              state: "running",
              word: "Running",
              detail: `From ${formatClock(from)}`,
            }
          : {
              at: iso(from),
              state: "given",
              word: `Given ${formatClock(from)}`,
              detail: rx.overMinutes ? `Over ${durationWords(rx.overMinutes)}` : null,
            },
      );
    } else if (active && rx.start !== "next_round") cells.push(openCell(rx.createdAt, opts.now));
    else if (active) note = "From the next drug round";
    return {
      prescriptionId: rx.id,
      label: fluidLabel(rx),
      detail: `IV${rate !== null ? ` · ${rate} mL/h` : ""}`,
      fluid: true,
      cells: cells.sort((a, b) => a.at.localeCompare(b.at)),
      note,
    };
  }

  const interval = rx.frequency ? INTERVAL_HOURS[rx.frequency] : undefined;
  const firstRecord = sorted[0];
  const anchor = firstRecord
    ? recordTime(firstRecord)
    : rx.start === "next_round"
      ? null
      : rx.createdAt;
  const due: Date[] = [];
  if (active && !rx.prn && anchor) {
    if (rx.frequency === "stat") due.push(anchor);
    else if (interval)
      for (let t = anchor.getTime(); t < opts.dayEnd.getTime(); t += interval * HOUR)
        if (t >= opts.windowStart.getTime()) due.push(new Date(t));
  }
  const tolerance = interval ? (interval * HOUR) / 2 : Number.POSITIVE_INFINITY;
  const used = new Set<number>();
  const cells: MarCell[] = [];
  for (const r of sorted) {
    const key = recordTime(r).getTime();
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    due.forEach((d, i) => {
      const distance = Math.abs(d.getTime() - key);
      if (!used.has(i) && distance < tolerance && distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    if (best >= 0) {
      used.add(best);
      cells.push(recordCell(r, due[best]!));
    } else cells.push(recordCell(r, recordTime(r)));
  }
  due.forEach((d, i) => {
    if (!used.has(i)) cells.push(openCell(d, opts.now));
  });
  const inWindow = cells
    .filter((c) => {
      const t = Date.parse(c.at);
      return t >= opts.windowStart.getTime() && t < opts.dayEnd.getTime();
    })
    .sort((a, b) => a.at.localeCompare(b.at));

  const frequency = rx.frequency
    ? (FREQUENCY_WORD[rx.frequency as keyof typeof FREQUENCY_WORD] ?? rx.frequency)
    : "no frequency given";
  const note = !active
    ? rx.state === "cancelled"
      ? "Stopped"
      : "Completed"
    : rx.prn
      ? "As needed"
      : !anchor
        ? "From the next drug round"
        : null;
  return {
    prescriptionId: rx.id,
    label: `${rx.drugName} ${rx.dose}`.trim(),
    detail: `${ROUTE_WORD[rx.route] ?? rx.route} · ${frequency}${rx.prn ? " as needed" : ""}`,
    fluid: false,
    cells: inWindow,
    note,
  };
}

export function buildMarBody(i: {
  chart: Pick<ChartRowIn, "openedAt">;
  prescriptions: readonly PrescriptionRowIn[];
  mar: readonly MarRowIn[];
  dayStart: Date;
  now: Date;
}): MarBody {
  // The chart day, and the first night's doses when the plan opened the chart before midnight.
  const windowStart = new Date(Math.min(i.dayStart.getTime(), i.chart.openedAt.getTime()));
  const dayEnd = new Date(i.dayStart.getTime() + 24 * HOUR);
  const rows = [...i.prescriptions]
    .sort(
      (a, b) =>
        Number(a.kind !== "fluid") - Number(b.kind !== "fluid") ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    )
    .map((rx) =>
      buildMarRow(
        rx,
        i.mar.filter((m) => m.prescriptionId === rx.id),
        { windowStart, dayEnd, now: i.now },
      ),
    );
  return { kind: "mar", rows };
}
