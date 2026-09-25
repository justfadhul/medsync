import { describe, expect, it } from "vitest";

import { arrivals, countChanges } from "@/lib/workspace/changes";
import { computeFlow } from "@/lib/workspace/flow";
import { encounter, identity, input, intake, ME, OTHER_DOC, resus, triage } from "./fixtures";

const patients = { five: identity("MS-2026-00009"), nine: identity("MS-2026-00021") };
const dept = { userId: ME, departmentId: "dept-im", scope: "department" as const, mayAssign: true };
const board = (over: Parameters<typeof input>[0]) =>
  computeFlow(input({ patients, viewer: dept, ...over })).rows;

const arrived = board({ intakes: [intake("i5", "five"), intake("i9", "nine")] });
const triaged = {
  intakes: [intake("i5", "five", { status: "triaged" }), intake("i9", "nine")],
  triages: [triage("t5", "i5", "five", 3)],
};

describe("held updates and the polite live region (§10, E3)", () => {
  it("the same board twice: nothing to count, nothing to say", () => {
    expect(countChanges(arrived, arrived)).toBe(0);
    expect(arrivals(arrived, arrived)).toEqual([]);
  });

  it("a patient newly waiting for me is announced, and counted once", () => {
    const after = board({
      ...triaged,
      encounters: [encounter("e5", "five", { triageRecordId: "t5" })],
    });
    expect(arrivals(arrived, after).map((r) => r.patientId)).toEqual(["five"]);
    expect(countChanges(arrived, after)).toBe(1);
  });

  it("a patient waiting for a colleague (Department scope) is not announced", () => {
    const after = board({
      ...triaged,
      encounters: [encounter("e5", "five", { triageRecordId: "t5", clinicianId: OTHER_DOC })],
    });
    expect(after.find((r) => r.patientId === "five")?.lane).toBe("waiting");
    expect(arrivals(arrived, after)).toEqual([]);
  });

  it("a patient moving into Resus is announced", () => {
    const after = board({
      ...triaged,
      triages: [triage("t5", "i5", "five", 1, { hasResus: true })],
      resus: [resus("r5", "five")],
    });
    expect(arrivals(arrived, after).map((r) => [r.patientId, r.lane])).toEqual([["five", "resus"]]);
  });

  it("a patient who leaves the board is counted but not announced", () => {
    const after = board({ intakes: [intake("i9", "nine")] });
    expect(countChanges(arrived, after)).toBe(1);
    expect(arrivals(arrived, after)).toEqual([]);
  });
});
