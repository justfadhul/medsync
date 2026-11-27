/**
 * Task 24 (ADR 0541): a floor visit the doctor sent to the EU ends as "Observed in EU". The event is written by
 * ha-eu-stay (keyed by the encounter's intake), never offered in the floor's own Finish dialog (D8).
 */
import type { FloorEvent, FloorVisit } from "@/lib/clinic-floor/model";
import { describe, expect, it } from "vitest";

import { FLOOR } from "@/content/clinic-floor/floor";
import { projectVisit } from "@/lib/clinic-floor/model";

const T0 = Date.UTC(2026, 10, 24, 6, 0);
const v: FloorVisit = {
  intakeId: "i1",
  code: "C1",
  departmentId: "opd",
  doctorUserId: null,
  arrivedAt: T0,
  needsTriage: true,
  level: 2,
  triagedAt: T0 + 60_000,
  recheck: null,
  deskFlag: false,
  resultsReleasedAt: [],
};
const ev = (kind: FloorEvent["kind"], at: number, detail: string | null = null): FloorEvent => ({
  intakeId: "i1",
  kind,
  detail,
  doctorUserId: null,
  departmentId: "opd",
  room: null,
  at,
});

describe("the floor's Observed in EU outcome", () => {
  it("a finish with detail eu ends the visit as eu", () => {
    const row = projectVisit(v, [
      ev("triaged", T0 + 60_000),
      ev("here", T0 + 120_000),
      ev("finish", T0 + 180_000, "eu"),
    ]);
    expect(row).toMatchObject({ step: "done", outcome: "eu" });
  });

  it("the board says Observed in EU", () => {
    expect(FLOOR.floor.outcome.eu).toBe("Observed in EU");
  });

  it("the Finish dialog does not offer it: still the five", () => {
    expect(Object.keys(FLOOR.finish.outs)).toEqual([
      "home",
      "pharmacy_home",
      "tests_back",
      "admitted",
      "referred",
    ]);
  });
});
