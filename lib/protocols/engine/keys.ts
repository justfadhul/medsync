/**
 * Chart keys ↔ the record (F8). A chart value with a record concept is read from results (with its
 * source and time) and, typed on the chart, saved there too (P5). Orderable groups name a lab test
 * id of the default test menu; a group with no test is a bedside value. No clinical number here.
 */

export interface KeyConcept {
  concept: string;
  unit: string;
  specimen?: string;
  fastingState?: string;
}

export const KEY_CONCEPTS: Readonly<Record<string, KeyConcept>> = {
  cbg: { concept: "obs.glucose_capillary", unit: "mmol/L", specimen: "capillary_whole_blood" },
  ket: { concept: "obs.bhb", unit: "mmol/L", specimen: "capillary_whole_blood" },
  k: { concept: "obs.potassium", unit: "mmol/L", specimen: "venous_whole_blood" },
  na: { concept: "obs.sodium", unit: "mmol/L", specimen: "venous_serum" },
  urea: { concept: "obs.urea", unit: "mmol/L" },
  cl: { concept: "obs.chloride", unit: "mmol/L", specimen: "venous_serum" },
  lact: { concept: "obs.lactate", unit: "mmol/L", specimen: "venous_whole_blood" },
  lglu: {
    concept: "obs.glucose",
    unit: "mmol/L",
    specimen: "venous_plasma",
    fastingState: "unknown",
  },
  ph: { concept: "obs.bg_ph", unit: "[pH]" },
  hco3: { concept: "obs.bg_hco3", unit: "mmol/L" },
  creat: { concept: "obs.creatinine", unit: "umol/L" },
  sbp: { concept: "obs.bp_systolic", unit: "mm[Hg]" },
  dbp: { concept: "obs.bp_diastolic", unit: "mm[Hg]" },
  pulse: { concept: "obs.heart_rate", unit: "/min" },
  rr: { concept: "obs.resp_rate", unit: "/min" },
  gcs: { concept: "obs.gcs", unit: "{score}" },
  spo2: { concept: "obs.spo2", unit: "%" },
  temp: { concept: "obs.temperature", unit: "Cel" },
};

/** The chart key a record concept fills. */
export const KEY_OF_CONCEPT: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(KEY_CONCEPTS).map(([k, c]) => [c.concept, k]),
);

/** Orderable groups (the prototype's LABGRP): name, keys, the lab test (none: bedside). */
export const LAB_GROUPS: readonly { name: string; keys: readonly string[]; test: string | null }[] =
  [
    { name: "Venous gas", keys: ["ph", "hco3", "lact"], test: null },
    { name: "U&Es", keys: ["na", "k", "urea"], test: "test.urea_electrolytes" },
    { name: "Chloride", keys: ["cl"], test: "test.urea_electrolytes" },
    { name: "Lab glucose", keys: ["lglu"], test: "test.glucose_random" },
    { name: "Capillary glucose", keys: ["cbg"], test: null },
    { name: "Capillary ketones", keys: ["ket"], test: null },
    { name: "Creatinine", keys: ["creat"], test: "test.creatinine" },
  ];

export const groupOf = (k: string) => LAB_GROUPS.find((g) => g.keys.includes(k)) ?? null;

/** Measured at the bedside: never ordered from the lab. */
export const BEDSIDE = new Set(["gcs", "pulse", "spo2", "sbp", "dbp", "rr", "ews", "temp"]);

/** The vitals card's base set: BP (systolic/diastolic), pulse, RR, GCS (entered as E/V/M). */
export const VITAL_KEYS = ["sbp", "dbp", "pulse", "rr", "gcs"] as const;
/** GCS parts: key, letter, highest score. */
export const GCS_PARTS = [
  ["gcsE", "E", 4],
  ["gcsV", "V", 5],
  ["gcsM", "M", 6],
] as const;

/** The reference a custom parameter reads by its name (SpO₂, temperature). */
export const PARAM_REF: Readonly<Record<string, string>> = {
  "SpO₂": "spo2",
  Temperature: "temp",
};
