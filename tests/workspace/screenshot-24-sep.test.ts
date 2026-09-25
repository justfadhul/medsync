import { describe, expect, it } from "vitest";

import { computeFlow } from "@/lib/workspace/flow";
import { DAY, encounter, HOUR, identity, input, intake, MIN, NOW, resus, triage } from "./fixtures";

/**
 * W1–W4 as they were seen on 24 Sep 2026, 11:10 (Test Hospital-1, a Senior
 * Consultant in Internal Medicine). Written at STOP 0, before the projection
 * existed; it is the contract the projection was built to.
 */

const at = (iso: string) => Date.parse(iso);

const fixture = input({
  patients: {
    two: identity("MS-2026-00003", { name: "Patient Two-2", ageYears: 26, sex: "male" }),
    three: identity("MS-2026-00004", { name: "Patient Three-3", ageYears: 76, sex: "male" }),
    five: identity("MS-2026-00009", { name: "Patient Five-5", ageYears: 34, sex: "female" }),
    seven: identity("MS-2026-00012", { name: "Patient Seven-7", ageYears: 45, sex: "female" }),
  },
  intakes: [
    // W1: still on the Triage worklist as "L2 · re-triage" with Assign Dr.
    intake("i-two", "two", { status: "triaged", presentAtMs: at("2026-09-22T06:00:00Z") }),
    intake("i-three", "three", { status: "triaged", presentAtMs: at("2026-09-05T08:40:00Z") }),
    intake("i-five", "five", { complaint: "Fever", presentAtMs: NOW - 18 * MIN }),
    intake("i-seven", "seven", {
      status: "triaged",
      complaint: "Chest pain",
      presentAtMs: NOW - 58 * MIN,
    }),
  ],
  triages: [
    triage("t-two", "i-two", "two", 2, { atMs: at("2026-09-22T06:20:00Z") }),
    triage("t-two-old", null, "two", 4, { atMs: at("2026-09-10T07:00:00Z") }),
    // W2 + W3: three triage records, three assignments; two of them L1, all older than 24 h.
    triage("t3a", "i-three", "three", 1, { atMs: at("2026-09-05T09:00:00Z") }),
    triage("t3b", "i-three", "three", 4, { atMs: at("2026-09-12T09:00:00Z") }),
    triage("t3c", "i-three", "three", 1, { atMs: at("2026-09-20T09:00:00Z") }),
    triage("t-seven", "i-seven", "seven", 2, { atMs: NOW - 42 * MIN }),
  ],
  encounters: [
    // W1: an L4 "Start" row on Assigned, and two OPEN emergency encounters from June and July.
    encounter("e2-planned", "two", {
      triageRecordId: "t-two-old",
      createdAtMs: at("2026-09-10T07:05:00Z"),
    }),
    encounter("e2-june", "two", {
      state: "in_progress",
      createdAtMs: at("2026-06-05T09:00:00Z"),
      lastActivityAtMs: at("2026-06-05T09:40:00Z"),
    }),
    encounter("e2-july", "two", {
      state: "in_progress",
      createdAtMs: at("2026-07-07T10:00:00Z"),
      lastActivityAtMs: at("2026-07-07T10:30:00Z"),
    }),
    // W2: MS-2026-00004 three times on Assigned (L1, L4, L1), twice on Encounters.
    encounter("e3a", "three", { triageRecordId: "t3a", createdAtMs: at("2026-09-05T09:05:00Z") }),
    encounter("e3b", "three", { triageRecordId: "t3b", createdAtMs: at("2026-09-12T09:05:00Z") }),
    encounter("e3c", "three", { triageRecordId: "t3c", createdAtMs: at("2026-09-20T09:05:00Z") }),
    encounter("e3-aug-1", "three", {
      state: "in_progress",
      createdAtMs: at("2026-08-02T08:00:00Z"),
      lastActivityAtMs: at("2026-08-02T08:30:00Z"),
    }),
    encounter("e3-aug-2", "three", {
      state: "in_progress",
      createdAtMs: at("2026-08-19T08:00:00Z"),
      lastActivityAtMs: at("2026-08-19T09:00:00Z"),
    }),
    encounter("e-seven", "seven", { triageRecordId: "t-seven", createdAtMs: NOW - 41 * MIN }),
  ],
  resus: [
    // W1: Recently ended — Died · Mortuary · ended 11:06 …
    resus("r-died", "two", {
      section: "ended",
      outcome: "Died",
      startedAtMs: at("2026-09-24T07:30:00Z"),
      endedAtMs: at("2026-09-24T08:06:00Z"),
    }),
    // … and three more under Needs closing.
    ...["r-idle-1", "r-idle-2", "r-idle-3"].map((id, n) =>
      resus(id, "two", {
        section: "needs_closing",
        startedAtMs: at("2026-09-11T06:00:00Z") + n * HOUR,
        lastActivityAtMs: at("2026-09-11T06:30:00Z") + n * HOUR,
        idleLabel: "No activity 13 d 1 h",
      }),
    ),
  ],
  deaths: [
    {
      patientId: "two",
      atMs: at("2026-09-24T08:06:00Z"),
      source: "resus",
      sourceId: "r-died",
      byName: "Dr Okello",
    },
  ],
});

describe("the 24 Sep screenshots, through the projection", () => {
  const { rows } = computeFlow(fixture);
  const rowsOf = (patientId: string) => rows.filter((r) => r.patientId === patientId);

  it("W1: Patient Two-2 appears once, in Needs closing, as Died 11:06, with nothing to triage or start", () => {
    const [row, ...rest] = rowsOf("two");
    expect(rest).toHaveLength(0);
    expect(row!.lane).toBe("needs_closing");
    expect(row!.badges.map((b) => b.text)).toContain("Died 11:06");
    expect(row!.primary?.kind).toBe("review");
    expect(["triage", "take", "start", "assign"]).not.toContain(row!.primary?.kind);
  });

  it("W1: every open item of the dead patient is listed for closing — none disappears", () => {
    const [row] = rowsOf("two");
    const ids = row!.alsoOpen.map((i) => i.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "i-two",
        "e2-planned",
        "e2-june",
        "e2-july",
        "r-idle-1",
        "r-idle-2",
        "r-idle-3",
      ]),
    );
    for (const item of row!.alsoOpen) {
      expect(item.actions.map((a) => a.kind)).not.toContain("triage");
      expect(item.actions.map((a) => a.kind)).not.toContain("start");
    }
  });

  it("W2: MS-2026-00004 appears once, with the latest acuity and a 3 assignments badge", () => {
    const [row, ...rest] = rowsOf("three");
    expect(rest).toHaveLength(0);
    expect(row!.acuity.level).toBe(1);
    expect(row!.acuity.atMs).toBe(at("2026-09-20T09:00:00Z"));
    expect(row!.badges.map((b) => b.text)).toContain("3 assignments");
  });

  it("W3: an L1 older than the 24 h lookback with no resus goes to Needs closing, not a plain Start", () => {
    const [row] = rowsOf("three");
    expect(row!.lane).toBe("needs_closing");
    expect(row!.primary?.kind).not.toBe("start");
    expect(row!.acuity.stale).toBe(true);
    expect(row!.badges.map((b) => b.text)).toContain("L1 · 3 d old");
  });

  it("W4: the June, July and August encounters are items to close, flagged by how long they sat", () => {
    const two = rowsOf("two")[0]!;
    const three = rowsOf("three")[0]!;
    for (const [row, id] of [
      [two, "e2-june"],
      [two, "e2-july"],
      [three, "e3-aug-1"],
      [three, "e3-aug-2"],
    ] as const) {
      const item = row.alsoOpen.find((i) => i.id === id);
      expect(item, id).toBeDefined();
      expect(item!.tone).toBe("amber");
      expect(item!.actions.map((a) => a.kind)).toEqual(["continue", "complete"]);
    }
  });

  it("no patient appears in two lanes, and today's patients land where they should", () => {
    const patients = rows.map((r) => r.patientId);
    expect(new Set(patients).size).toBe(patients.length);
    expect(rowsOf("five")[0]!.lane).toBe("triage");
    expect(rowsOf("seven")[0]!.lane).toBe("waiting");
    expect(rowsOf("seven")[0]!.primary?.kind).toBe("start");
  });

  it("the integrity report names every contradiction it resolved", () => {
    const kinds = computeFlow(fixture).integrity.map((f) => f.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "deceased_open_items",
        "duplicate_assignments",
        "stale_l1",
        "idle_encounter",
        "idle_resus",
      ]),
    );
  });

  it("stays deterministic: the same sources give the same board", () => {
    expect(computeFlow(fixture)).toEqual(computeFlow(fixture));
    expect(DAY).toBe(24 * HOUR);
  });
});
