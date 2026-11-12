/**
 * Shared by the P5 protocol tests (art, se, op, nac): each seed version as the database holds it
 * after 0282 (rules) and 0286 (seed numbers), a patient's facts, and events. Pure: no database.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ChartEvent, ChartFacts, ChartVersion, Role } from "@/lib/protocols/engine/types";

const mig = (f: string) => readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8");

export function seedVersion(id: string): ChartVersion {
  const m82 = mig("0282_prescribe_protocols.sql");
  const m86 = mig("0286_protocol_seeds_art_se_op_nac.sql");
  const name = m82.match(new RegExp(`VALUES \\('${id}', NULL, '([^']*)'`))![1]!;
  const r = m82.match(
    new RegExp(
      `SELECT '${id}', NULL, 1, 'draft', \\$json\\$(.+?)\\$json\\$::jsonb, '\\{\\}'::jsonb, (\\d+), (\\d+), '([^']*)'`,
    ),
  )!;
  const seed = m86.match(
    new RegExp(`SET seed = \\$json\\$(.+?)\\$json\\$::jsonb\\nWHERE protocol_id = '${id}'`),
  )![1]!;
  return {
    protocolId: id,
    name,
    status: "draft",
    source: r[4]!,
    slotMinutes: Number(r[2]),
    slotCount: Number(r[3]),
    rules: JSON.parse(r[1]!),
    seed: JSON.parse(seed) as Record<string, unknown>,
  };
}

export const T0 = Date.UTC(2026, 10, 11, 8, 0);
export const MIN = 60000;

export const facts = (over: Partial<ChartFacts> = {}): ChartFacts => ({
  ageYears: 34,
  sex: "male",
  weightKg: 64,
  weightFrom: "weighed",
  pregnant: false,
  problems: [],
  creatinine: 90,
  egfr: 90,
  results: {},
  pending: {},
  ivLines: ["18G left forearm"],
  ivTaskOpen: false,
  ...over,
});

export const lab = (o: Record<string, number>) =>
  Object.fromEntries(Object.entries(o).map(([k, value]) => [k, { value, source: "lab", at: T0 }]));

/** An event log the test appends to, as the server would (time in minutes from the start). */
export function log() {
  let n = 0;
  const events: ChartEvent[] = [];
  const add = (type: string, payload: Record<string, unknown>, role: Role, minutes: number) => {
    events.push({
      id: `e${++n}`,
      type,
      payload,
      role,
      at: T0 + minutes * MIN,
      reversesId: null,
    });
  };
  return { events, add };
}
