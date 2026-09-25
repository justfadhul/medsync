import type {
  Acuity,
  FlowDeath,
  FlowEncounter,
  FlowIntake,
  FlowResus,
  FlowTriage,
} from "@/lib/workspace/flow";
import { describe, expect, it } from "vitest";

import { computeFlow } from "@/lib/workspace/flow";
import {
  DAY,
  encounter,
  HOUR,
  identity,
  IM,
  input,
  intake,
  ME,
  MIN,
  NOW,
  OTHER_DOC,
  resus,
  triage,
} from "./fixtures";

/**
 * Law 3 as a property: for random source sets, every patient appears exactly
 * once, and every open item is the row's primary item, an intake covered by
 * the row's encounter, or listed under "Also open" — nothing disappears.
 * Seeded (mulberry32), so a failure names its seed and replays exactly.
 */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function world(seed: number) {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const ago = () => Math.floor(rnd() * 40 * DAY);
  const intakes: FlowIntake[] = [];
  const triages: FlowTriage[] = [];
  const encounters: FlowEncounter[] = [];
  const resusRows: FlowResus[] = [];
  const deaths: FlowDeath[] = [];
  const patientCount = 1 + Math.floor(rnd() * 12);
  for (let p = 0; p < patientCount; p++) {
    const pid = rnd() < 0.1 ? null : `p${p}`;
    const visits = Math.floor(rnd() * 3);
    for (let v = 0; v < visits; v++) {
      const iid = `i${p}-${v}`;
      intakes.push(
        intake(iid, pid, {
          status: pick(["arrived", "awaiting_triage", "triaged"] as const),
          presentAtMs: NOW - ago(),
        }),
      );
      const records = Math.floor(rnd() * 3);
      for (let t = 0; t < records; t++) {
        triages.push(
          triage(`t${p}-${v}-${t}`, iid, pid, pick([1, 2, 3, 4, 5] as Acuity[]), {
            atMs: NOW - ago(),
            hasResus: rnd() < 0.2,
          }),
        );
      }
    }
    if (!pid) continue;
    const encs = Math.floor(rnd() * 4);
    for (let e = 0; e < encs; e++) {
      const own = triages.filter((t) => t.patientId === pid);
      const created = NOW - ago();
      encounters.push(
        encounter(`e${p}-${e}`, pid, {
          clinicianId: pick([ME, OTHER_DOC]),
          state: pick(["planned", "in_progress", "completed"] as const),
          // Every encounter links through a triage record (or none), so the test can tell coverage.
          triageRecordId: own.length && rnd() < 0.8 ? pick(own).id : null,
          createdAtMs: created,
          startedAtMs: created,
          lastActivityAtMs: created + Math.floor(rnd() * (NOW - created)),
          endedAtMs: rnd() < 0.5 ? NOW - Math.floor(rnd() * 2 * DAY) : null,
        }),
      );
    }
    for (let r = 0; r < Math.floor(rnd() * 2); r++) {
      resusRows.push(
        resus(`r${p}-${r}`, pid, {
          section: pick(["arrest", "active", "boarding", "needs_closing", "ended"] as const),
          startedAtMs: NOW - ago(),
        }),
      );
    }
    if (rnd() < 0.15) {
      deaths.push({
        patientId: pid,
        atMs: NOW - ago(),
        source: "resus",
        sourceId: "x",
        byName: null,
      });
    }
  }
  const patients = Object.fromEntries(
    [...new Set([...intakes.map((i) => i.patientId), ...encounters.map((e) => e.patientId)])]
      .filter((x): x is string => !!x)
      .map((pid) => [pid, identity(`MS-2026-${pid}`)]),
  );
  return input({
    patients,
    // Department scope and assign permission: every item is visible, so every item must appear.
    viewer: { userId: ME, departmentId: IM, scope: "department", mayAssign: true },
    intakes,
    triages,
    // An encounter in progress with no triage link falls back to the same-day heuristic; keep it linked
    // or planned so coverage is decidable here (the heuristic has its own tests).
    encounters: encounters.map((e) =>
      e.triageRecordId || e.state !== "in_progress" ? e : { ...e, state: "planned" },
    ),
    resus: resusRows,
    deaths,
  });
}

const OPEN_RESUS = new Set(["arrest", "active", "boarding", "needs_closing"]);

describe("the flow projection's invariants hold for random boards", () => {
  for (let seed = 1; seed <= 400; seed++) {
    it(`seed ${seed}`, () => {
      const src = world(seed);
      const { rows, lanes } = computeFlow(src);

      // FW-1: one row per patient.
      const keys = rows.map((r) => r.key);
      expect(new Set(keys).size).toBe(keys.length);

      // Law 3: every open item is on exactly one row …
      const openIds = [
        ...src.intakes.map((i) => i.id),
        ...src.encounters.filter((e) => e.state !== "completed").map((e) => e.id),
        ...src.resus.filter((r) => OPEN_RESUS.has(r.section)).map((r) => r.id),
      ];
      const owners = new Map<string, number>();
      for (const r of rows) for (const id of r.itemIds) owners.set(id, (owners.get(id) ?? 0) + 1);
      for (const id of openIds) expect(owners.get(id), `item ${id}`).toBe(1);

      // … as the primary item, an intake its encounter answers, or under Also open.
      const triageIntake = new Map(src.triages.map((t) => [t.id, t.intakeId]));
      for (const r of rows) {
        const also = new Set(r.alsoOpen.map((i) => i.id));
        const coveredHere = new Set(
          src.encounters
            .filter((e) => r.itemIds.includes(e.id) && e.triageRecordId)
            .map((e) => triageIntake.get(e.triageRecordId!))
            .filter((x): x is string => !!x),
        );
        for (const id of r.itemIds) {
          expect(
            id === r.primaryItemId || also.has(id) || coveredHere.has(id),
            `seed ${seed}: ${id} on ${r.key} is neither primary, covered nor also open`,
          ).toBe(true);
        }
      }

      // A dead patient is never offered triage, take, start or open-resus as the next step.
      for (const r of rows) {
        if (!r.deceased) continue;
        expect(["triage", "take", "start", "open_resus"]).not.toContain(r.primary?.kind);
      }

      // Every row can be told apart: a name, an MRN or the desk's label.
      for (const r of rows) {
        expect(r.identity.name ?? r.identity.code ?? r.identity.unknownLabel).toBeTruthy();
      }

      // Counts add up; the board is deterministic.
      expect(Object.values(lanes).reduce((a, b) => a + b, 0)).toBe(rows.length);
      expect(computeFlow(src)).toEqual({ rows, lanes, integrity: computeFlow(src).integrity });
    });
  }

  it("the generator covers the ground it claims to (sanity)", () => {
    const lanesSeen = new Set<string>();
    for (let seed = 1; seed <= 400; seed++)
      for (const r of computeFlow(world(seed)).rows) lanesSeen.add(r.lane);
    expect([...lanesSeen].sort()).toEqual(
      ["done", "in_progress", "needs_closing", "resus", "triage", "unassigned", "waiting"].sort(),
    );
    expect(MIN * 60).toBe(HOUR);
  });
});
