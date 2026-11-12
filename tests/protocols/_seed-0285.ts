/**
 * Shared by the P5 hyperkalaemia, labetalol and magnesium tests: each version as the database holds
 * it after 0282 (rules) and 0285 (the seed's numbers), plus event and fact builders. Pure: no DB.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ChartEvent, ChartFacts, ChartVersion, Role } from "@/lib/protocols/engine/types";

const mig = (f: string) => readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8");

export function versionOf(id: "hyperk" | "htn" | "mgso4"): ChartVersion {
  const m82 = mig("0282_prescribe_protocols.sql");
  const m85 = mig("0285_protocol_seeds_hyperk_htn_mgso4.sql");
  const r = m82.match(
    new RegExp(
      `SELECT '${id}', NULL, 1, 'draft', \\$json\\$(.+?)\\$json\\$::jsonb, '\\{\\}'::jsonb, (\\d+), (\\d+), '([^']*)'`,
    ),
  )!;
  const s = m85.match(
    new RegExp(`SET seed = \\$json\\$([^$]+)\\$json\\$::jsonb\\nWHERE protocol_id = '${id}'`),
  )!;
  return {
    protocolId: id,
    name: id,
    status: "draft",
    source: r[4]!,
    slotMinutes: Number(r[2]),
    slotCount: Number(r[3]),
    rules: JSON.parse(r[1]!),
    seed: JSON.parse(s[1]!) as Record<string, unknown>,
  };
}

export const T0 = Date.UTC(2026, 10, 11, 8, 0);
export const MIN = 60000;

export const facts = (over: Partial<ChartFacts> = {}): ChartFacts => ({
  ageYears: 40,
  sex: "female",
  weightKg: 64,
  weightFrom: "weighed",
  pregnant: false,
  problems: [],
  creatinine: 90,
  egfr: 75,
  results: {},
  pending: {},
  ivLines: ["18G left forearm"],
  ivTaskOpen: false,
  ...over,
});

export const lab = (o: Record<string, number>) =>
  Object.fromEntries(Object.entries(o).map(([k, value]) => [k, { value, source: "lab", at: T0 }]));

let n = 0;
/** An event `minutes` after the start. */
export const ev = (
  type: string,
  payload: Record<string, unknown>,
  role: Role,
  minutes: number,
): ChartEvent => ({
  id: `e${++n}`,
  type,
  payload,
  role,
  at: T0 + minutes * MIN,
  reversesId: null,
});
