import { describe, expect, it } from "vitest";

import { ago, computeFlow, ENCOUNTER_IDLE_MS } from "@/lib/workspace/flow";
import { laneFromParam, LANES, visibleLanes } from "@/lib/workspace/lanes";
import {
  DAY,
  DAY_START,
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
  SURGERY,
  task,
  triage,
} from "./fixtures";

/**
 * The flow projection, rule by rule (prompt §6). Every describe names its FW
 * rule ID; tests/workspace/rule-coverage.test.ts fails if one goes missing.
 */

const one = (i: ReturnType<typeof input>) => {
  const { rows } = computeFlow(i);
  expect(rows).toHaveLength(1);
  return rows[0]!;
};
const kinds = (actions: { kind: string }[]) => actions.map((a) => a.kind);
const texts = (badges: { text: string }[]) => badges.map((b) => b.text);
const patients = { a: identity("MS-2026-00001"), b: identity("MS-2026-00002") };

describe("FW-1 one row per patient", () => {
  it("groups the intake, triage, assignment and resus of one patient into one row", () => {
    const row = one(
      input({
        patients,
        intakes: [intake("i1", "a", { status: "triaged" })],
        triages: [triage("t1", "i1", "a", 3)],
        encounters: [encounter("e1", "a", { triageRecordId: "t1" })],
        resus: [resus("r1", "a")],
      }),
    );
    expect(row.patientId).toBe("a");
    expect(row.itemIds.sort()).toEqual(["e1", "i1", "r1"]);
  });

  it("an arrival without an account is its own patient, keyed by the intake", () => {
    const row = one(input({ intakes: [intake("i9", null, { unknownLabel: "Unknown male ~40" })] }));
    expect(row.key).toBe("i:i9");
    expect(row.identity.unknownLabel).toBe("Unknown male ~40");
  });

  it("two unidentified arrivals are two rows", () => {
    const { rows } = computeFlow(input({ intakes: [intake("i1", null), intake("i2", null)] }));
    expect(rows.map((r) => r.key).sort()).toEqual(["i:i1", "i:i2"]);
  });

  it("an unidentified resus episode is titled Unidentified patient", () => {
    const row = one(input({ resus: [resus("r1", null)] }));
    expect(row.key).toBe("r:r1");
    expect(row.identity.unknownLabel).toBe("Unidentified patient");
  });

  it("identity comes from the audited patient map: name, MRN, age, sex", () => {
    const row = one(
      input({
        patients: {
          a: identity("MS-2026-00012", { name: "Amina Okello", ageYears: 45, sex: "female" }),
        },
        intakes: [intake("i1", "a")],
      }),
    );
    expect(row.identity).toMatchObject({
      name: "Amina Okello",
      code: "MS-2026-00012",
      ageYears: 45,
    });
  });

  it("a patient with nothing open and nothing done today has no row", () => {
    const { rows } = computeFlow(
      input({
        patients,
        encounters: [encounter("e1", "a", { state: "completed", endedAtMs: DAY_START - HOUR })],
        resus: [resus("r1", "a", { section: "ended", endedAtMs: NOW - HOUR })],
      }),
    );
    expect(rows).toHaveLength(0);
  });

  it("keys are unique across a mixed board", () => {
    const { rows } = computeFlow(
      input({
        patients,
        intakes: [intake("i1", "a"), intake("i2", "b", { status: "triaged" }), intake("i3", null)],
        triages: [triage("t2", "i2", "b", 3)],
        resus: [resus("r1", "a")],
      }),
    );
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
});

describe("FW-2 lane precedence", () => {
  it("awaiting triage → To triage, primary Triage", () => {
    const row = one(input({ patients, intakes: [intake("i1", "a", { complaint: "Fever" })] }));
    expect(row.lane).toBe("triage");
    expect(row.primary).toMatchObject({ kind: "triage", intakeId: "i1" });
    expect(row.reason).toBe("Fever");
  });

  it("triaged with no assignment → Unassigned, primary Take, Assign and Re-triage behind ⋯", () => {
    const row = one(
      input({
        patients,
        intakes: [intake("i1", "a", { status: "triaged" })],
        triages: [triage("t1", "i1", "a", 3)],
      }),
    );
    expect(row.lane).toBe("unassigned");
    expect(row.primary).toMatchObject({ kind: "take", intakeId: "i1", triageRecordId: "t1" });
    expect(kinds(row.overflow)).toEqual(["assign", "retriage"]);
  });

  it("assigned to me, not started → Waiting for you, primary Start", () => {
    const row = one(
      input({
        patients,
        intakes: [intake("i1", "a", { status: "triaged" })],
        triages: [triage("t1", "i1", "a", 3)],
        encounters: [encounter("e1", "a", { triageRecordId: "t1" })],
      }),
    );
    expect(row.lane).toBe("waiting");
    expect(row.primary).toMatchObject({ kind: "start", encounterId: "e1", triageRecordId: "t1" });
    expect(kinds(row.overflow)).toEqual(["reassign", "retriage"]);
    expect(row.stageDetail).toBe("Assigned to you");
  });

  it("my open encounter with recent activity → In progress, primary Continue", () => {
    const row = one(
      input({
        patients,
        encounters: [
          encounter("e1", "a", { state: "in_progress", lastActivityAtMs: NOW - 12 * MIN }),
        ],
      }),
    );
    expect(row.lane).toBe("in_progress");
    expect(row.primary).toMatchObject({ kind: "continue", encounterId: "e1" });
  });

  it("an active resus → Resus, primary Open desk", () => {
    const row = one(input({ patients, resus: [resus("r1", "a")] }));
    expect(row.lane).toBe("resus");
    expect(row.primary).toMatchObject({ kind: "open_desk", episodeId: "r1" });
  });

  it("resus comes before an open encounter", () => {
    const row = one(
      input({
        patients,
        resus: [resus("r1", "a")],
        encounters: [encounter("e1", "a", { state: "in_progress", lastActivityAtMs: NOW })],
      }),
    );
    expect(row.lane).toBe("resus");
    expect(row.alsoOpen.map((i) => i.id)).toEqual(["e1"]);
  });

  it("an open encounter comes before a new assignment", () => {
    const row = one(
      input({
        patients,
        encounters: [
          encounter("e1", "a", { state: "in_progress", lastActivityAtMs: NOW - MIN }),
          encounter("e2", "a"),
        ],
      }),
    );
    expect(row.lane).toBe("in_progress");
  });

  it("waiting for me comes before a second visit awaiting triage", () => {
    const row = one(
      input({
        patients,
        intakes: [intake("i1", "a", { status: "triaged" }), intake("i2", "a")],
        triages: [triage("t1", "i1", "a", 3)],
        encounters: [encounter("e1", "a", { triageRecordId: "t1" })],
      }),
    );
    expect(row.lane).toBe("waiting");
    expect(row.alsoOpen.map((i) => i.id)).toEqual(["i2"]);
  });

  it("awaiting triage comes before unassigned", () => {
    const row = one(
      input({
        patients,
        intakes: [intake("i1", "a", { status: "triaged" }), intake("i2", "a")],
        triages: [triage("t1", "i1", "a", 3)],
      }),
    );
    expect(row.lane).toBe("triage");
  });

  it("an encounter I completed today → Done today, primary View", () => {
    const row = one(
      input({
        patients,
        encounters: [encounter("e1", "a", { state: "completed", endedAtMs: NOW - HOUR })],
      }),
    );
    expect(row.lane).toBe("done");
    expect(row.primary).toMatchObject({ kind: "view", encounterId: "e1" });
    expect(row.sinceMs).toBe(NOW - HOUR);
  });

  it("an encounter completed before local midnight is not on today's board", () => {
    const { rows } = computeFlow(
      input({
        patients,
        encounters: [encounter("e1", "a", { state: "completed", endedAtMs: DAY_START - MIN })],
      }),
    );
    expect(rows).toHaveLength(0);
  });

  it("only idle or contradictory items left → Needs closing, primary Review", () => {
    const row = one(
      input({
        patients,
        encounters: [
          encounter("e1", "a", { state: "in_progress", lastActivityAtMs: NOW - 3 * DAY }),
        ],
      }),
    );
    expect(row.lane).toBe("needs_closing");
    expect(row.primary?.kind).toBe("review");
    expect(row.stageDetail).toBe("1 open item to close");
  });

  it("an intake still open after its visit ended needs closing, with Close intake", () => {
    const row = one(
      input({
        patients,
        intakes: [intake("i1", "a", { status: "triaged" })],
        triages: [triage("t1", "i1", "a", 3)],
        encounters: [
          encounter("e1", "a", { triageRecordId: "t1", state: "completed", endedAtMs: NOW - HOUR }),
        ],
      }),
    );
    expect(row.lane).toBe("needs_closing");
    const item = row.alsoOpen.find((i) => i.id === "i1")!;
    expect(item.detail).toBe("Still open after the visit ended");
    expect(kinds(item.actions)).toEqual(["close_intake"]);
    expect(texts(row.badges)).toContain("Intake still open");
  });

  it("a visit called from the queue rail the same day covers the untriaged intake", () => {
    const row = one(
      input({
        patients,
        intakes: [intake("i1", "a", { presentAtMs: NOW - 30 * MIN })],
        encounters: [
          encounter("e1", "a", {
            state: "in_progress",
            createdAtMs: NOW - 10 * MIN,
            lastActivityAtMs: NOW,
          }),
        ],
      }),
    );
    expect(row.lane).toBe("in_progress");
    expect(row.itemIds.sort()).toEqual(["e1", "i1"]);
    expect(row.alsoOpen).toHaveLength(0);
  });
});

describe("FW-3 current acuity is the visit's latest triage", () => {
  const visit = {
    patients,
    intakes: [intake("i1", "a", { status: "triaged" as const })],
    triages: [
      triage("t-old", "i1", "a", 4, { atMs: NOW - 3 * HOUR }),
      triage("t-new", "i1", "a", 2, { atMs: NOW - 20 * MIN, byName: "Nurse B", why: "RR 28" }),
    ],
  };

  it("the assignment's own older record never sets the chip", () => {
    const row = one(
      input({ ...visit, encounters: [encounter("e1", "a", { triageRecordId: "t-old" })] }),
    );
    expect(row.acuity).toMatchObject({
      level: 2,
      atMs: NOW - 20 * MIN,
      byName: "Nurse B",
      why: "RR 28",
    });
  });

  it("the older record still shows in the timeline", () => {
    const row = one(
      input({ ...visit, encounters: [encounter("e1", "a", { triageRecordId: "t-old" })] }),
    );
    expect(row.timeline.map((t) => t.text)).toEqual(
      expect.arrayContaining(["Triaged L4 · Nurse A", "Triaged L2 · Nurse B"]),
    );
  });

  it("an encounter whose visit is closed keeps its own triage record", () => {
    const row = one(
      input({
        patients,
        triages: [triage("t1", "closed-intake", "a", 3)],
        encounters: [encounter("e1", "a", { triageRecordId: "t1" })],
      }),
    );
    expect(row.acuity.level).toBe(3);
  });

  it("untriaged → no level", () => {
    const row = one(input({ patients, intakes: [intake("i1", "a")] }));
    expect(row.acuity.level).toBeNull();
  });

  it("a Resus row reads the acuity of the patient's open visit", () => {
    const row = one(input({ ...visit, resus: [resus("r1", "a")] }));
    expect(row.lane).toBe("resus");
    expect(row.acuity.level).toBe(2);
  });

  it("a booking links the encounter to its visit when there is no triage link", () => {
    const row = one(
      input({
        patients,
        intakes: [intake("i1", "a", { status: "triaged", appointmentId: "appt" })],
        triages: [triage("t1", "i1", "a", 3)],
        encounters: [encounter("e1", "a", { appointmentId: "appt" })],
      }),
    );
    expect(row.lane).toBe("waiting");
    expect(row.acuity.level).toBe(3);
    expect(row.itemIds.sort()).toEqual(["e1", "i1"]);
  });
});

describe("FW-4 duplicate assignments collapse onto the newest", () => {
  const dup = input({
    patients,
    intakes: [intake("i1", "a", { status: "triaged" })],
    triages: [
      triage("t1", "i1", "a", 3, { atMs: NOW - 3 * HOUR }),
      triage("t2", "i1", "a", 3, { atMs: NOW - 2 * HOUR }),
      triage("t3", "i1", "a", 3, { atMs: NOW - HOUR }),
    ],
    encounters: [
      encounter("e1", "a", { triageRecordId: "t1", createdAtMs: NOW - 3 * HOUR }),
      encounter("e2", "a", { triageRecordId: "t2", createdAtMs: NOW - 2 * HOUR }),
      encounter("e3", "a", { triageRecordId: "t3", createdAtMs: NOW - HOUR }),
    ],
  });

  it("one row, the newest assignment is the primary, a 3 assignments badge", () => {
    const row = one(dup);
    expect(row.lane).toBe("waiting");
    expect(row.primary?.encounterId).toBe("e3");
    expect(texts(row.badges)).toContain("3 assignments");
  });

  it("the older ones are Also open, amber, with Start and Retire", () => {
    const row = one(dup);
    for (const id of ["e1", "e2"]) {
      const item = row.alsoOpen.find((i) => i.id === id)!;
      expect(item.kind).toBe("assignment");
      expect(item.tone).toBe("amber");
      expect(kinds(item.actions)).toEqual(["start", "retire"]);
    }
  });

  it("the integrity report lists every assignment", () => {
    const flag = computeFlow(dup).integrity.find((f) => f.kind === "duplicate_assignments")!;
    expect(flag.itemIds).toEqual(["e3", "e2", "e1"]);
  });

  it("a newer assignment to a colleague leaves my older one to close (Mine)", () => {
    const row = one(
      input({
        patients,
        encounters: [
          encounter("mine", "a", { createdAtMs: NOW - 2 * HOUR }),
          encounter("theirs", "a", { clinicianId: OTHER_DOC, createdAtMs: NOW - HOUR }),
        ],
      }),
    );
    expect(row.lane).toBe("needs_closing");
    expect(row.alsoOpen.map((i) => i.id)).toEqual(["mine"]);
  });

  it("a single assignment has no badge", () => {
    const row = one(input({ patients, encounters: [encounter("e1", "a")] }));
    expect(texts(row.badges).some((t) => t.includes("assignment"))).toBe(false);
  });
});

describe("FW-5 L1 / Red routing", () => {
  const l1 = (atMs: number, hasResus = false) => ({
    patients,
    intakes: [intake("i1", "a", { status: "triaged" as const })],
    triages: [triage("t1", "i1", "a", 1, { atMs, hasResus })],
  });

  it("a fresh L1 with no assignment offers Open resus first, Take behind it", () => {
    const row = one(input(l1(NOW - HOUR)));
    expect(row.lane).toBe("unassigned");
    expect(row.primary).toMatchObject({ kind: "open_resus", intakeId: "i1", triageRecordId: "t1" });
    expect(kinds(row.overflow)).toEqual(["take", "assign", "retriage"]);
  });

  it("a fresh L1 assigned to me offers Open resus first, Start behind it", () => {
    const row = one(
      input({ ...l1(NOW - HOUR), encounters: [encounter("e1", "a", { triageRecordId: "t1" })] }),
    );
    expect(row.lane).toBe("waiting");
    expect(row.primary?.kind).toBe("open_resus");
    expect(kinds(row.overflow)).toEqual(["start", "reassign", "retriage"]);
  });

  it("an L1 that already had a resus is started normally", () => {
    const row = one(
      input({
        ...l1(NOW - HOUR, true),
        encounters: [encounter("e1", "a", { triageRecordId: "t1" })],
      }),
    );
    expect(row.primary?.kind).toBe("start");
  });

  it("an L1 older than the lookback with no resus → Needs closing, stale, re-triage or close", () => {
    const row = one(
      input({ ...l1(NOW - 2 * DAY), encounters: [encounter("e1", "a", { triageRecordId: "t1" })] }),
    );
    expect(row.lane).toBe("needs_closing");
    expect(row.acuity).toMatchObject({ level: 1, stale: true });
    expect(row.stageDetail).toBe("Re-triage or close");
    expect(texts(row.badges)).toContain("L1 · 2 d old");
  });

  it("exactly at the lookback the L1 is still fresh", () => {
    const row = one(input(l1(NOW - 24 * HOUR)));
    expect(row.primary?.kind).toBe("open_resus");
  });

  it("a stale L1 does not bury a new visit awaiting triage", () => {
    const row = one(
      input({
        patients,
        intakes: [intake("i1", "a", { status: "triaged" }), intake("i2", "a")],
        triages: [triage("t1", "i1", "a", 1, { atMs: NOW - 3 * DAY })],
        encounters: [encounter("e1", "a", { triageRecordId: "t1", createdAtMs: NOW - 3 * DAY })],
      }),
    );
    expect(row.lane).toBe("triage");
    expect(texts(row.badges)).toContain("L1 · 3 d old");
    expect(row.alsoOpen.find((i) => i.id === "e1")!.tone).toBe("amber");
  });

  it("an L2 past 24 h keeps its lane: only L1 carries a staleness rule", () => {
    const row = one(
      input({
        patients,
        intakes: [intake("i1", "a", { status: "triaged" })],
        triages: [triage("t1", "i1", "a", 2, { atMs: NOW - 5 * DAY })],
      }),
    );
    expect(row.lane).toBe("unassigned");
    expect(row.acuity.stale).toBe(false);
  });

  it("the integrity report names the stale L1", () => {
    const { integrity } = computeFlow(input(l1(NOW - 2 * DAY)));
    expect(integrity).toContainEqual({ kind: "stale_l1", patientKey: "p:a", itemIds: ["i1"] });
  });
});

describe("FW-6 idle encounters and idle resus", () => {
  it("my open encounter with no activity for 24 h needs closing", () => {
    const row = one(
      input({
        patients,
        encounters: [
          encounter("e1", "a", { state: "in_progress", lastActivityAtMs: NOW - 24 * HOUR }),
        ],
      }),
    );
    expect(row.lane).toBe("needs_closing");
    expect(row.alsoOpen[0]).toMatchObject({ id: "e1", tone: "amber", detail: "No activity 1 d" });
    expect(kinds(row.alsoOpen[0]!.actions)).toEqual(["continue", "complete"]);
  });

  it("a minute under the window it is still in progress", () => {
    const row = one(
      input({
        patients,
        encounters: [
          encounter("e1", "a", { state: "in_progress", lastActivityAtMs: NOW - 24 * HOUR + MIN }),
        ],
      }),
    );
    expect(row.lane).toBe("in_progress");
  });

  it("an idle encounter beside live work is a badge and an Also open item", () => {
    const row = one(
      input({
        patients,
        encounters: [
          encounter("old", "a", {
            state: "in_progress",
            createdAtMs: NOW - 90 * DAY,
            lastActivityAtMs: NOW - 90 * DAY,
          }),
          encounter("new", "a"),
        ],
      }),
    );
    expect(row.lane).toBe("waiting");
    expect(texts(row.badges)).toContain("1 old encounter");
    expect(row.alsoOpen.find((i) => i.id === "old")!.detail).toBe("No activity 12 w");
  });

  it("In progress measures time in stage from the last activity", () => {
    const row = one(
      input({
        patients,
        encounters: [
          encounter("e1", "a", { state: "in_progress", lastActivityAtMs: NOW - 12 * MIN }),
        ],
      }),
    );
    expect(row.sinceMs).toBe(NOW - 12 * MIN);
  });

  it("an idle resus episode (the board's own class) needs closing with Open desk and Close…", () => {
    const row = one(
      input({
        patients,
        resus: [resus("r1", "a", { section: "needs_closing", idleLabel: "No activity 3 h 5 min" })],
      }),
    );
    expect(row.lane).toBe("needs_closing");
    expect(row.alsoOpen[0]).toMatchObject({
      id: "r1",
      detail: "No activity 3 h 5 min",
      tone: "amber",
    });
    expect(kinds(row.alsoOpen[0]!.actions)).toEqual(["open_desk", "close_resus"]);
    expect(texts(row.badges)).toContain("1 idle resus");
  });

  it("the integrity report names idle encounters and idle episodes", () => {
    const { integrity } = computeFlow(
      input({
        patients,
        encounters: [
          encounter("e1", "a", { state: "in_progress", lastActivityAtMs: NOW - 2 * DAY }),
        ],
        resus: [resus("r1", "a", { section: "needs_closing" })],
      }),
    );
    expect(integrity.map((f) => f.kind).sort()).toEqual(["idle_encounter", "idle_resus"]);
  });

  it("a colleague's idle encounter is not on my board (Mine)", () => {
    const { rows } = computeFlow(
      input({
        patients,
        encounters: [
          encounter("e1", "a", {
            clinicianId: OTHER_DOC,
            state: "in_progress",
            lastActivityAtMs: NOW - 2 * DAY,
          }),
        ],
      }),
    );
    expect(rows).toHaveLength(0);
  });
});

describe("FW-7 a recorded death", () => {
  const died = (over: Partial<ReturnType<typeof input>> = {}) =>
    input({
      patients,
      intakes: [intake("i1", "a", { status: "triaged" })],
      triages: [triage("t1", "i1", "a", 2)],
      deaths: [
        { patientId: "a", atMs: NOW - 4 * MIN, source: "resus", sourceId: "r1", byName: "Dr X" },
      ],
      ...over,
    });

  it("Needs closing, a neutral Died hh:mm, primary Review, nothing to triage or take", () => {
    const row = one(died());
    expect(row.lane).toBe("needs_closing");
    expect(row.primary?.kind).toBe("review");
    expect(row.badges[0]).toEqual({ text: "Died 11:06", tone: "neutral" });
    expect(row.stageDetail).toBe("1 open item to close");
    for (const item of row.alsoOpen) expect(kinds(item.actions)).toEqual(["close_intake"]);
  });

  it("a death on another day reads as the date", () => {
    const row = one(
      died({
        deaths: [
          { patientId: "a", atMs: NOW - 2 * DAY, source: "resus", sourceId: "r1", byName: null },
        ],
      }),
    );
    expect(texts(row.badges)).toContain("Died 22 Sep");
  });

  it("a death with nothing left open puts no one on the board", () => {
    const { rows } = computeFlow(died({ intakes: [], triages: [] }));
    expect(rows).toHaveLength(0);
  });

  it("the overflow keeps Start encounter…, which the page confirms with a reason", () => {
    const row = one(died());
    expect(row.overflow).toEqual([
      { kind: "start_override", label: "Start encounter…", intakeId: "i1", triageRecordId: "t1" },
    ]);
  });

  it("a dead patient's assignment offers only Retire", () => {
    const row = one(died({ encounters: [encounter("e1", "a", { triageRecordId: "t1" })] }));
    expect(kinds(row.alsoOpen.find((i) => i.id === "e1")!.actions)).toEqual(["retire"]);
    expect(row.overflow[0]).toMatchObject({ kind: "start_override", encounterId: "e1" });
  });

  it("the chip gives way to the death: no acuity, `deceased` set", () => {
    const row = one(died());
    expect(row.acuity.level).toBeNull();
    expect(row.deceased).toEqual({ atMs: NOW - 4 * MIN, source: "resus" });
  });

  it("a death recorded on an encounter's disposition counts the same", () => {
    const row = one(
      died({
        deaths: [
          { patientId: "a", atMs: NOW - HOUR, source: "encounter", sourceId: "e9", byName: null },
        ],
      }),
    );
    expect(row.lane).toBe("needs_closing");
    expect(row.deceased?.source).toBe("encounter");
  });

  it("death outranks a running resus", () => {
    const row = one(died({ resus: [resus("r2", "a")] }));
    expect(row.lane).toBe("needs_closing");
    expect(row.alsoOpen.map((i) => i.id)).toContain("r2");
  });

  it("the integrity report names the dead patient's open items", () => {
    const { integrity } = computeFlow(died());
    expect(integrity).toContainEqual({
      kind: "deceased_open_items",
      patientKey: "p:a",
      itemIds: ["i1"],
    });
  });
});

describe("FW-8 resus supersedes triage", () => {
  it("a patient in resus never shows Triage; the pending triage is a badge", () => {
    const row = one(input({ patients, intakes: [intake("i1", "a")], resus: [resus("r1", "a")] }));
    expect(row.lane).toBe("resus");
    expect(row.primary?.kind).toBe("open_desk");
    expect(texts(row.badges)).toContain("Awaiting triage");
    expect(row.alsoOpen.find((i) => i.id === "i1")).toBeDefined();
  });

  it("the Resus row says the mode and leader, since the episode started, why it was opened", () => {
    const row = one(
      input({
        patients,
        resus: [
          resus("r1", "a", { mode: "Arrest", leader: "Dr Okello", trigger: "Step-0 life threat" }),
        ],
      }),
    );
    expect(row.stageDetail).toBe("Arrest · Leader Dr Okello");
    expect(row.sinceMs).toBe(NOW - 12 * MIN);
    expect(row.reason).toBe("Step-0 life threat");
    expect(row.resus?.id).toBe("r1");
  });
});

describe("FW-9 order inside a lane", () => {
  const waiting = (id: string, level: 1 | 3 | null, sinceAgo: number) => ({
    intake: intake(`i-${id}`, id, {
      status: level ? "triaged" : "awaiting_triage",
      presentAtMs: NOW - sinceAgo,
    }),
    triage: level ? [triage(`t-${id}`, `i-${id}`, id, level, { atMs: NOW - sinceAgo })] : [],
  });

  it("acuity L1 → L5, untriaged last", () => {
    const a = waiting("a", 3, HOUR);
    const b = waiting("b", 1, MIN);
    const { rows } = computeFlow(
      input({ intakes: [a.intake, b.intake], triages: [...a.triage, ...b.triage] }),
    );
    expect(rows.map((r) => r.patientId)).toEqual(["b", "a"]);
  });

  it("same acuity: the longest in stage first", () => {
    const a = waiting("a", 3, 10 * MIN);
    const b = waiting("b", 3, 50 * MIN);
    const { rows } = computeFlow(
      input({ intakes: [a.intake, b.intake], triages: [...a.triage, ...b.triage] }),
    );
    expect(rows.map((r) => r.patientId)).toEqual(["b", "a"]);
  });

  it("Resus keeps the board's order: arrest, active, boarding", () => {
    const { rows } = computeFlow(
      input({
        resus: [
          resus("r-board", "c", { section: "boarding" }),
          resus("r-act", "b", { section: "active" }),
          resus("r-arr", "a", { section: "arrest" }),
        ],
      }),
    );
    expect(rows.map((r) => r.resus?.id)).toEqual(["r-arr", "r-act", "r-board"]);
  });

  it("Needs closing puts the dead first", () => {
    const { rows } = computeFlow(
      input({
        intakes: [intake("i-a", "a"), intake("i-b", "b")],
        encounters: [
          encounter("e-b", "b", { state: "in_progress", lastActivityAtMs: NOW - 9 * DAY }),
        ],
        deaths: [
          { patientId: "a", atMs: NOW - HOUR, source: "resus", sourceId: "r", byName: null },
        ],
      }),
    );
    const closing = rows.filter((r) => r.lane === "needs_closing").map((r) => r.patientId);
    expect(closing[0]).toBe("a");
  });

  it("Done today: most recent first", () => {
    const { rows } = computeFlow(
      input({
        encounters: [
          encounter("e1", "a", { state: "completed", endedAtMs: NOW - 3 * HOUR }),
          encounter("e2", "b", { state: "completed", endedAtMs: NOW - HOUR }),
        ],
      }),
    );
    expect(rows.map((r) => r.patientId)).toEqual(["b", "a"]);
  });

  it("lanes come in registry order", () => {
    const { rows } = computeFlow(
      input({
        intakes: [intake("i1", "a")],
        encounters: [
          encounter("e2", "b", { state: "completed", endedAtMs: NOW - HOUR }),
          encounter("e3", "c"),
        ],
        resus: [resus("r4", "d")],
      }),
    );
    expect(rows.map((r) => r.lane)).toEqual(["resus", "triage", "waiting", "done"]);
  });
});

describe("FW-10 wait colour comes only from a signed target", () => {
  const base = {
    patients,
    intakes: [intake("i1", "a", { status: "triaged" as const })],
    triages: [triage("t1", "i1", "a", 2, { atMs: NOW - 3 * HOUR })],
  };

  it("nothing signed → neutral, however long the wait", () => {
    expect(one(input(base)).waitTone).toBe("neutral");
  });

  it("past a signed target for that acuity → amber", () => {
    const row = one(
      input({ ...base, signedRefs: { waitTargets: [{ id: "WT-2", level: 2, minutes: 10 }] } }),
    );
    expect(row.waitTone).toBe("amber");
  });

  it("inside the target → neutral", () => {
    const row = one(
      input({ ...base, signedRefs: { waitTargets: [{ id: "WT-2", level: 2, minutes: 600 }] } }),
    );
    expect(row.waitTone).toBe("neutral");
  });

  it("a target for another level does not apply", () => {
    const row = one(
      input({ ...base, signedRefs: { waitTargets: [{ id: "WT-4", level: 4, minutes: 1 }] } }),
    );
    expect(row.waitTone).toBe("neutral");
  });
});

describe("FW-11 scope and permissions", () => {
  it("Mine never shows a colleague's assignment", () => {
    const { rows } = computeFlow(
      input({ patients, encounters: [encounter("e1", "a", { clinicianId: OTHER_DOC })] }),
    );
    expect(rows).toHaveLength(0);
  });

  it("a visit assigned to a colleague is not Unassigned on my board", () => {
    const { rows } = computeFlow(
      input({
        patients,
        intakes: [intake("i1", "a", { status: "triaged" })],
        triages: [triage("t1", "i1", "a", 3)],
        encounters: [encounter("e1", "a", { triageRecordId: "t1", clinicianId: OTHER_DOC })],
      }),
    );
    expect(rows).toHaveLength(0);
  });

  it("Department shows a colleague's patient in my department, with the owner and no primary", () => {
    const row = one(
      input({
        patients,
        viewer: { userId: ME, departmentId: IM, scope: "department", mayAssign: true },
        encounters: [encounter("e1", "a", { clinicianId: OTHER_DOC, clinicianName: "Dr Okello" })],
      }),
    );
    expect(row.lane).toBe("waiting");
    expect(row.owner).toEqual({ name: "Dr Okello", me: false });
    expect(row.primary).toBeNull();
    expect(row.stageDetail).toBe("Assigned to Dr Okello");
  });

  it("Department stops at my department", () => {
    const { rows } = computeFlow(
      input({
        patients,
        viewer: { userId: ME, departmentId: IM, scope: "department", mayAssign: true },
        encounters: [encounter("e1", "a", { clinicianId: OTHER_DOC, departmentId: SURGERY })],
      }),
    );
    expect(rows).toHaveLength(0);
  });

  it("without assign permission: no Unassigned row, and To triage without a Triage button", () => {
    const { rows } = computeFlow(
      input({
        patients,
        viewer: { userId: ME, departmentId: IM, scope: "mine", mayAssign: false },
        intakes: [intake("i1", "a", { status: "triaged" }), intake("i2", "b")],
        triages: [triage("t1", "i1", "a", 3)],
      }),
    );
    expect(rows.map((r) => r.lane)).toEqual(["triage"]);
    expect(rows[0]!.primary).toBeNull();
  });

  it("lane counts add up to the rows", () => {
    const { rows, lanes } = computeFlow(
      input({ intakes: [intake("i1", "a"), intake("i2", "b")], resus: [resus("r1", "c")] }),
    );
    expect(lanes).toMatchObject({ triage: 2, resus: 1, waiting: 0 });
    expect(Object.values(lanes).reduce((a, b) => a + b, 0)).toBe(rows.length);
  });
});

describe("registry and words", () => {
  it("the registry has ten lanes in board order; the first seven keep keys 1–7 (E8)", () => {
    expect(LANES.map((l) => l.id)).toEqual([
      "resus",
      "critical_results",
      "triage",
      "unassigned",
      "waiting",
      "in_progress",
      "results_to_review",
      "to_cosign",
      "needs_closing",
      "done",
    ]);
    expect(LANES.map((l) => l.hotkey)).toEqual(["1", "8", "2", "3", "4", "5", "9", "0", "6", "7"]);
    expect(new Set(LANES.map((l) => l.hotkey)).size).toBe(LANES.length);
  });

  it("the record's lanes show only where EMR v1 is on: flag off, the board is unchanged", () => {
    const EMR_LANES = ["critical_results", "results_to_review", "to_cosign"];
    const off = visibleLanes({ mayAssign: true }).map((l) => l.id);
    expect(off).toEqual([
      "resus",
      "triage",
      "unassigned",
      "waiting",
      "in_progress",
      "needs_closing",
      "done",
    ]);
    expect(visibleLanes({ mayAssign: true, emr: true }).map((l) => l.id)).toEqual(
      LANES.map((l) => l.id),
    );
    for (const id of EMR_LANES) expect(off).not.toContain(id);
  });

  it("one idle constant: the EMR settings default is the Workspace's", async () => {
    const { EMR_SETTINGS_DEFAULTS } = await import("@/lib/emr/settings");
    expect(EMR_SETTINGS_DEFAULTS.encounterIdleMs).toBe(ENCOUNTER_IDLE_MS);
    expect(ENCOUNTER_IDLE_MS).toBe(DAY);
  });

  it("Unassigned is visible only to those who may assign (D8)", () => {
    expect(visibleLanes({ mayAssign: false }).map((l) => l.id)).not.toContain("unassigned");
    expect(visibleLanes({ mayAssign: true }).map((l) => l.id)).toContain("unassigned");
  });

  it("?lane= accepts a lane id and falls back to All", () => {
    expect(laneFromParam("waiting")).toBe("waiting");
    expect(laneFromParam("assigned")).toBe("all");
    expect(laneFromParam(null)).toBe("all");
  });

  it("time words are floored and short", () => {
    expect(ago(59 * MIN)).toBe("59 min");
    expect(ago(3 * HOUR + 59 * MIN)).toBe("3 h");
    expect(ago(13 * DAY)).toBe("13 d");
    expect(ago(16 * 7 * DAY)).toBe("16 w");
    expect(ago(-5)).toBe("0 min");
  });
});

describe("FW-2 E8 record lanes: Critical results, Results to review, To co-sign", () => {
  it("an unacknowledged critical result → Critical results, primary Review result", () => {
    const row = one(input({ patients, tasks: [task("rep1", "a", "critical_result")] }));
    expect(row.lane).toBe("critical_results");
    expect(row.primary).toEqual({ kind: "view", label: "Review result", encounterId: "enc-a" });
    expect(row.primaryItemId).toBe("rep1");
    expect(row.stageDetail).toBe("Potassium · awaiting acknowledgement");
    expect(row.sinceMs).toBe(NOW - 30 * MIN);
    expect(row.itemIds).toEqual(["rep1"]);
  });

  it("critical outranks my open clerking; the encounter stays Also open with Continue", () => {
    const row = one(
      input({
        patients,
        encounters: [encounter("e1", "a", { state: "in_progress", lastActivityAtMs: NOW - MIN })],
        tasks: [task("rep1", "a", "critical_result")],
      }),
    );
    expect(row.lane).toBe("critical_results");
    expect(row.alsoOpen.map((i) => i.id)).toEqual(["e1"]);
    expect(kinds(row.alsoOpen[0]!.actions)).toContain("continue");
  });

  it("resus outranks a critical result, which becomes an amber badge", () => {
    const row = one(
      input({ patients, resus: [resus("r1", "a")], tasks: [task("rep1", "a", "critical_result")] }),
    );
    expect(row.lane).toBe("resus");
    expect(row.badges).toContainEqual({ text: "1 critical result", tone: "amber" });
    expect(row.alsoOpen.find((i) => i.id === "rep1")).toMatchObject({
      kind: "result",
      tone: "amber",
    });
  });

  it("a recorded death keeps the row in Needs closing; the critical result is a badge", () => {
    const row = one(
      input({
        patients,
        intakes: [intake("i1", "a")],
        deaths: [
          { patientId: "a", atMs: NOW - HOUR, source: "resus", sourceId: "r", byName: null },
        ],
        tasks: [task("rep1", "a", "critical_result")],
      }),
    );
    expect(row.lane).toBe("needs_closing");
    expect(texts(row.badges)).toContain("1 critical result");
  });

  it("results to review sit below every live stage: waiting for me wins, with a badge", () => {
    const row = one(
      input({
        patients,
        encounters: [encounter("e1", "a")],
        tasks: [task("rep1", "a", "result_to_review"), task("rep2", "a", "result_to_review")],
      }),
    );
    expect(row.lane).toBe("waiting");
    expect(row.badges).toContainEqual({ text: "2 results to review", tone: "neutral" });
    expect(row.alsoOpen.map((i) => i.id).sort()).toEqual(["rep1", "rep2"]);
  });

  it("results with nothing live → Results to review, oldest first, and above Needs closing", () => {
    const row = one(
      input({
        patients,
        encounters: [
          encounter("e1", "a", {
            state: "in_progress",
            lastActivityAtMs: NOW - ENCOUNTER_IDLE_MS - MIN,
          }),
        ],
        tasks: [
          task("rep2", "a", "result_to_review", { atMs: NOW - 5 * MIN }),
          task("rep1", "a", "result_to_review", { atMs: NOW - HOUR }),
        ],
      }),
    );
    expect(row.lane).toBe("results_to_review");
    expect(row.primaryItemId).toBe("rep1");
    expect(row.primary?.label).toBe("Review results");
    expect(row.stageDetail).toBe("2 results released");
    expect(texts(row.badges)).toContain("1 old encounter");
  });

  it("a restricted result is never named on the board", () => {
    const row = one(
      input({ patients, tasks: [task("rep1", "a", "result_to_review", { label: null })] }),
    );
    expect(row.stageDetail).toBe("Result released");
  });

  it("a note to co-sign → To co-sign, primary Co-sign; below Results to review", () => {
    const alone = one(input({ patients, tasks: [task("c1", "a", "cosign")] }));
    expect(alone.lane).toBe("to_cosign");
    expect(alone.primary).toEqual({ kind: "view", label: "Co-sign", encounterId: "enc-a" });
    expect(alone.stageDetail).toBe("Clerking note awaiting co-signature");
    const both = one(
      input({
        patients,
        tasks: [task("c1", "a", "cosign"), task("rep1", "a", "result_to_review")],
      }),
    );
    expect(both.lane).toBe("results_to_review");
    expect(both.badges).toContainEqual({ text: "1 note to co-sign", tone: "neutral" });
  });

  it("a patient with only a task, done today, is in the task lane, not Done", () => {
    const row = one(
      input({
        patients,
        encounters: [encounter("e1", "a", { state: "completed", endedAtMs: NOW - HOUR })],
        tasks: [task("rep1", "a", "result_to_review")],
      }),
    );
    expect(row.lane).toBe("results_to_review");
  });

  it("the lanes sit in registry order on a mixed board", () => {
    const { rows } = computeFlow(
      input({
        encounters: [encounter("e1", "b", { state: "in_progress", lastActivityAtMs: NOW - MIN })],
        tasks: [
          task("c1", "d", "cosign"),
          task("rep2", "c", "result_to_review"),
          task("rep1", "a", "critical_result"),
        ],
      }),
    );
    expect(rows.map((r) => r.lane)).toEqual([
      "critical_results",
      "in_progress",
      "results_to_review",
      "to_cosign",
    ]);
  });
});

describe("FW-6 Needs closing: unsigned notes (§5.11)", () => {
  it("a visit ended with an unsigned note needs closing, whatever the day", () => {
    const row = one(
      input({
        patients,
        encounters: [
          encounter("e1", "a", {
            state: "completed",
            endedAtMs: NOW - 3 * DAY,
            unsignedNoteAtMs: NOW - 3 * DAY,
          }),
        ],
      }),
    );
    expect(row.lane).toBe("needs_closing");
    expect(row.primary?.kind).toBe("review");
    expect(row.itemIds).toEqual(["e1"]);
    expect(row.alsoOpen[0]).toMatchObject({
      id: "e1",
      detail: "Visit ended with an unsigned note",
      tone: "amber",
    });
    expect(kinds(row.alsoOpen[0]!.actions)).toEqual(["view"]);
    expect(texts(row.badges)).toContain("1 unsigned note");
  });

  it("ended today with an unsigned note: Needs closing, not Done today", () => {
    const row = one(
      input({
        patients,
        encounters: [
          encounter("e1", "a", {
            state: "completed",
            endedAtMs: NOW - HOUR,
            unsignedNoteAtMs: NOW - HOUR,
          }),
        ],
      }),
    );
    expect(row.lane).toBe("needs_closing");
  });

  it("a colleague's visit with an unsigned note is not on my board (Mine)", () => {
    const { rows } = computeFlow(
      input({
        encounters: [
          encounter("e1", "a", {
            clinicianId: OTHER_DOC,
            state: "completed",
            endedAtMs: NOW - DAY,
            unsignedNoteAtMs: NOW - DAY,
          }),
        ],
      }),
    );
    expect(rows).toHaveLength(0);
  });

  it("a draft idle past the window on live clerking is an amber badge, not a second row", () => {
    const row = one(
      input({
        patients,
        encounters: [
          encounter("e1", "a", {
            state: "in_progress",
            lastActivityAtMs: NOW - MIN,
            unsignedNoteAtMs: NOW - ENCOUNTER_IDLE_MS,
          }),
        ],
      }),
    );
    expect(row.lane).toBe("in_progress");
    expect(row.badges).toContainEqual({ text: "1 unsigned note", tone: "amber" });
  });

  it("a fresh draft on live clerking says nothing", () => {
    const row = one(
      input({
        patients,
        encounters: [
          encounter("e1", "a", {
            state: "in_progress",
            lastActivityAtMs: NOW - MIN,
            unsignedNoteAtMs: NOW - MIN,
          }),
        ],
      }),
    );
    expect(texts(row.badges)).not.toContain("1 unsigned note");
  });
});
