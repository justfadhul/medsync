/**
 * Small words and lookups shared by the floor's views. Levels and vital tones come from the engine
 * (`runTriage`, `interpretVitals`); nothing here reads a vital-sign number against a threshold (S10).
 */
import type { FloorPerson } from "@/lib/clinic-floor/fixture";
import type { FloorVisit } from "@/lib/clinic-floor/model";
import type { VitalKey, VitalTone } from "@/lib/triage/interpret";
import type {
  AcuityLevel,
  Acvpu,
  LifeThreatFlags,
  TriageInput,
  TriageVitals,
} from "@/lib/triage/types";

import { FLOOR } from "@/content/clinic-floor/floor";
import { fill } from "@/content/lab-workspace-v2";
import { LIFE_THREAT_DISCRIMINATORS } from "@/lib/triage/discriminators";
import { runTriage } from "@/lib/triage/engine";
import { interpretVitals } from "@/lib/triage/interpret";
import { COLOUR_WORD } from "@/lib/workspace/words";

const TZ = "Africa/Kampala";
const hmFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dayFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
});

export const hm = (t: number) => hmFmt.format(t);
export const dayLabel = (t: number) => dayFmt.format(t).replace(",", "");

export function mins(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  return m < 60
    ? fill(FLOOR.mins, { n: m })
    : fill(FLOOR.hours, { h: Math.floor(m / 60), m: m % 60 });
}

export const levelCls = (l: AcuityLevel | null) => (l ? `l${l}` : "none");
export const levelTxt = (l: AcuityLevel | null) =>
  l ? `L${l} · ${COLOUR_WORD[l]}` : FLOOR.line.groups.untriaged;

export const whoOf = (p: Pick<FloorPerson, "sex" | "age">) =>
  [p.sex ? FLOOR.sex[p.sex] : null, p.age].filter((x) => x != null).join(" · ");

export const first = (name: string) => name.split(" ")[0] ?? name;

/** CF6: the desk's keyword hint, a word only. It orders the worklist; it never sets a level. */
export function deskFlag(reason: string): string | null {
  for (const [re, label] of FLOOR.deskFlags)
    if (new RegExp(`\\b(${re})\\b`, "i").test(reason)) return label;
  return null;
}

const TONE_CLS: Record<VitalTone, string> = {
  normal: "ok",
  borderline: "high",
  abnormal: "high",
  // Red is for emergencies (L1, Step 0); a critical vital is amber with the engine's own word.
  critical: "high",
  missing: "",
  info: "",
};
export const toneCls = (t: VitalTone) => TONE_CLS[t];

const SHOWN: [VitalKey, string, (v: TriageInput["vitals"]) => string | null][] = [
  [
    "systolicBp",
    FLOOR.panel.vitals.bp[0],
    (v) => (v.systolicBp == null ? null : `${v.systolicBp}/${v.diastolicBp ?? "–"}`),
  ],
  ["pulse", FLOOR.panel.vitals.pulse[0], (v) => (v.pulse == null ? null : String(v.pulse))],
  [
    "respiratoryRate",
    FLOOR.panel.vitals.rr[0],
    (v) => (v.respiratoryRate == null ? null : String(v.respiratoryRate)),
  ],
  ["spo2", FLOOR.panel.vitals.spo2[0], (v) => (v.spo2 == null ? null : `${v.spo2}%`)],
  [
    "temperature",
    FLOOR.panel.vitals.temp[0],
    (v) => (v.temperature == null ? null : `${v.temperature}°`),
  ],
  [
    "bloodGlucose",
    FLOOR.panel.vitals.sugar[0],
    (v) => (v.bloodGlucose == null ? null : String(v.bloodGlucose)),
  ],
];

/** Vital chips: the value, and the engine's own word and tone for it. */
export function vitalChips(input: TriageInput) {
  const iv = interpretVitals(input.vitals, runTriage(input));
  return SHOWN.flatMap(([key, k, val]) => {
    const v = val(input.vitals);
    if (v == null) return [];
    const i = iv[key];
    return [{ key, k, v, tag: i.tone === "normal" ? "" : i.label, cls: toneCls(i.tone) }];
  });
}

/** A person as the pure floor model reads them. */
export function toVisit(p: FloorPerson): FloorVisit {
  return {
    intakeId: p.id,
    code: p.code,
    departmentId: p.clinic,
    doctorUserId: p.doctorId,
    arrivedAt: p.arrivedAt,
    needsTriage: p.needsTriage,
    level: p.triage?.level ?? null,
    triagedAt: p.triage?.at ?? null,
    recheck: p.triage?.recheck ?? null,
    deskFlag: !!deskFlag(p.reason),
    resultsReleasedAt: p.resultsReleasedAt,
  };
}

const KEYS = new Set(["n", "f", "h", "e", "1", "2", "3", "[", "?"]);

/** One key press → one floor action, or null. Off while typing or with a modifier; in a dialog only `?` and Esc (S5). */
export function floorKey(
  e: {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    target?: EventTarget | null;
  },
  dialogOpen: boolean,
): string | null {
  if (e.key === "Escape") return "escape";
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? "") || t.isContentEditable)) return null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (dialogOpen && e.key !== "?") return null;
  const k = e.key.toLowerCase();
  return KEYS.has(k) ? k : null;
}

/** G5: the engine's manual Step 0 signs, in its own words. */
export const THREATS: [string, keyof LifeThreatFlags][] = [
  ["airway_compromise", "airwayCompromise"],
  ["absent_agonal_breathing", "absentAgonalBreathing"],
  ["cardiac_arrest_no_pulse", "cardiacArrestNoPulse"],
  ["unresponsive", "unresponsive"],
  ["active_seizure", "activeSeizure"],
  ["exsanguinating_haemorrhage", "exsanguinatingHaemorrhage"],
];
export const THREAT_LABEL = new Map(LIFE_THREAT_DISCRIMINATORS.map((d) => [d.code, d.label]));

export type Field = "sys" | "dia" | "pulse" | "rr" | "spo2" | "temp" | "sugar";
export const NEEDED: [keyof typeof FLOOR.panel.missing, Field[]][] = [
  ["rr", ["rr"]],
  ["spo2", ["spo2"]],
  ["bp", ["sys", "dia"]],
  ["pulse", ["pulse"]],
  ["temp", ["temp"]],
];

export interface Draft {
  threats: (keyof LifeThreatFlags)[];
  none: boolean;
  v: Partial<Record<Field, string>>;
  avpu: Acvpu;
  o2: boolean;
  sugar: boolean;
  pick: AcuityLevel | null;
  why: string;
  clinic: string;
  doc: string | null;
  note: string;
}

export const num = (s: string | undefined) => {
  if (s == null || s.trim() === "") return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

export function draftInput(p: FloorPerson, d: Draft): TriageInput {
  const vitals: TriageVitals = {
    systolicBp: num(d.v.sys),
    diastolicBp: num(d.v.dia),
    pulse: num(d.v.pulse),
    respiratoryRate: num(d.v.rr),
    spo2: num(d.v.spo2),
    temperature: num(d.v.temp),
    bloodGlucose: d.sugar ? num(d.v.sugar) : null,
    oxygen: d.o2 ? "oxygen" : "air",
    consciousness: d.avpu,
  };
  return {
    context: {
      ageYears: p.age,
      pregnancy: "unknown",
      reproductiveAgeFemale: p.sex === "F" && p.age != null && p.age >= 12 && p.age < 50,
      spo2Scale2Enabled: false,
    },
    vitals,
    lifeThreatFlags: Object.fromEntries(d.threats.map((k) => [k, true])),
  };
}
