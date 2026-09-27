import { beforeEach, describe, expect, it, vi } from "vitest";

import { scriptedDb } from "./fake-db";

/**
 * D5 at the write side: one assignment per visit. A re-triage writes a new
 * triage record; assigning after it used to insert a second planned encounter
 * (W2 — the same patient three times on Assigned). Now the visit's open
 * encounter, found through any of its triage records, is re-pointed or
 * respected, and only a visit with none gets a new one.
 */

const fake = scriptedDb();
const findOpenEncounterToday = vi.fn();
const linkEncounterToVisit = vi.fn();
vi.mock("@/db", () => ({ db: fake.db }));
// EMR_V1 off: no visit id is linked (lib/encounter/handoff.ts visitIdFor/visitSet).
vi.mock("@/lib/encounter/handoff", () => ({
  findOpenEncounterToday,
  linkEncounterToVisit,
  visitIdFor: () => null,
  visitSet: () => ({}),
}));

const { assignDoctorFromIntake } = await import("@/lib/encounter/assignment");

const DOC = "doc-new";
const args = { intakeId: "intake-1", doctorUserId: DOC, assignerHospitalId: "h" };

/** The reads before the visit lookup: the intake, its latest triage, the assignable doctors, no encounter on that triage. */
function prelude() {
  fake.queue.push(
    [{ patientUserId: "pat", hospitalId: "h", receivingDepartmentId: "dept", appointmentId: null }],
    [{ id: "triage-new", departmentId: "dept" }],
    [{ userId: DOC, fullName: "Dr New", cadreCode: "CONSULTANT", departmentId: "dept" }],
    [],
  );
}

beforeEach(() => {
  fake.queue.length = 0;
  fake.writes.length = 0;
  findOpenEncounterToday.mockReset().mockResolvedValue(null);
  linkEncounterToVisit.mockReset();
});

describe("assigning after a re-triage", () => {
  it("re-points the visit's planned encounter to the new triage — no second row", async () => {
    prelude();
    fake.queue.push([{ id: "enc-1", state: "planned", clinicianUserId: "doc-old" }]);
    const res = await assignDoctorFromIntake(args);
    expect(res).toEqual({ ok: true, encounterId: "enc-1", action: "reassigned" });
    expect(fake.writes).toEqual([
      {
        kind: "update",
        table: "encounters",
        values: { clinicianUserId: DOC, triageRecordId: "triage-new" },
      },
    ]);
  });

  it("the same doctor re-assigned after re-triage is still one assignment", async () => {
    prelude();
    fake.queue.push([{ id: "enc-1", state: "planned", clinicianUserId: DOC }]);
    expect(await assignDoctorFromIntake(args)).toEqual({
      ok: true,
      encounterId: "enc-1",
      action: "assigned",
    });
    expect(fake.writes.filter((w) => w.kind === "insert")).toHaveLength(0);
  });

  it("a visit already being seen by this doctor is left as it is", async () => {
    prelude();
    fake.queue.push([{ id: "enc-1", state: "in_progress", clinicianUserId: DOC }]);
    expect(await assignDoctorFromIntake(args)).toMatchObject({ ok: true, encounterId: "enc-1" });
    expect(fake.writes).toHaveLength(0);
  });

  it("a visit being seen by another doctor is refused, not duplicated", async () => {
    prelude();
    fake.queue.push([{ id: "enc-1", state: "in_progress", clinicianUserId: "doc-other" }]);
    expect(await assignDoctorFromIntake(args)).toEqual({
      ok: false,
      error: "This patient is already being seen by another doctor — the visit is open.",
    });
    expect(fake.writes).toHaveLength(0);
  });

  it("a visit with no encounter at all still gets its first assignment", async () => {
    prelude();
    fake.queue.push([]);
    const res = await assignDoctorFromIntake(args);
    expect(res).toEqual({ ok: true, encounterId: "new-encounter", action: "assigned" });
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toMatchObject({
      kind: "insert",
      table: "encounters",
      values: { state: "planned", triageRecordId: "triage-new", clinicianUserId: DOC },
    });
  });
});
