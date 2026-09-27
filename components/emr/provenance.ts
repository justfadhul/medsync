import type { ClinicalFact, FactSnapshot, ObservationFact } from "@/lib/facts/types";

import { formatters } from "./format";

/**
 * Where a value came from, in words (PROMPT §5.2: "tapping any value opens its provenance: who
 * recorded it, where, method, specimen, fasting state, device or laboratory, effective and
 * recorded times, and trust"). PURE: built from the same snapshot the chart payload came from, so
 * the fixture harness gets it without a database. Keyed by fact id (= the payload's cell / result
 * item ids). Missing context is said as missing, never filled in.
 */
export interface Provenance {
  /** [label, value] rows, in reading order. */
  rows: [string, string][];
}

const SOURCE: Record<string, string> = {
  lab: "Laboratory",
  poc_staff: "Point-of-care test by staff",
  clinician: "Clinician",
  patient_reported: "Patient-reported",
  device_synced: "Patient device",
  imported: "Imported record",
};
const TRUST: Record<number, string> = {
  4: "T4 — laboratory final",
  3: "T3 — staff point of care or examination",
  2: "T2 — validated patient device",
  1: "T1 — patient-typed or unverified",
};
const FASTING: Record<string, string> = {
  fasting: "Fasting",
  non_fasting: "Not fasting",
  unknown: "Not known",
};
const humanise = (s: string) => {
  const t = s.replace(/_/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const at = (f: ClinicalFact) => ("at" in f.effective ? f.effective.at : f.effective.start);

export function observationProvenance(
  f: ObservationFact,
  names: Readonly<Record<string, string>> = {},
  timeZone?: string,
): Provenance {
  const fmt = formatters(timeZone);
  const c = f.context;
  const rows: [string, string][] = [
    ["Status", `${humanise(f.status)}, version ${f.provenance.version}`],
    ["Source", SOURCE[f.source] ?? humanise(f.source)],
  ];
  const range = c.referenceRange?.source === "lab" ? c.referenceRange : undefined;
  if (f.source === "lab" || c.labId || range)
    rows.push([
      "Laboratory range",
      range
        ? `${range.low ?? "—"} to ${range.high ?? "—"} ${range.unit}, as reported by the laboratory`
        : "Not reported by the laboratory",
    ]);
  if (c.specimen) rows.push(["Specimen", humanise(c.specimen)]);
  if (c.container) rows.push(["Container", humanise(c.container)]);
  if (c.fastingState) rows.push(["Fasting", FASTING[c.fastingState] ?? c.fastingState]);
  if (c.method) rows.push(["Method", humanise(c.method)]);
  if (c.pointOfCare !== undefined) rows.push(["Point of care", c.pointOfCare ? "Yes" : "No"]);
  if (c.deviceId || f.provenance.deviceId) rows.push(["Device", "Recorded device"]);
  if (c.qualityFlags?.length)
    rows.push(["Specimen quality", c.qualityFlags.map((q) => humanise(q)).join(", ")]);
  const author = f.provenance.authorId ? names[f.provenance.authorId] : undefined;
  rows.push([
    "Recorded by",
    author
      ? `${author}${f.provenance.authorCadre ? ` (${humanise(f.provenance.authorCadre.toLowerCase())})` : ""}`
      : "Not recorded",
  ]);
  rows.push(["Effective", fmt.dateTime(at(f))]);
  rows.push(["Recorded", fmt.dateTime(f.recordedAt)]);
  rows.push(["Trust", TRUST[f.trust] ?? String(f.trust)]);
  if (f.interpretable.ok === false)
    rows.push(["Interpretable", `No — missing ${f.interpretable.missing.join(", ")}`]);
  return { rows };
}

/** Provenance for every observation in the snapshot, by fact id. */
export function provenanceFor(
  snapshot: FactSnapshot,
  names: Readonly<Record<string, string>> = {},
  timeZone?: string,
): Record<string, Provenance> {
  const out: Record<string, Provenance> = {};
  for (const f of snapshot.facts)
    if (f.kind === "observation") out[f.id] = observationProvenance(f, names, timeZone);
  return out;
}
