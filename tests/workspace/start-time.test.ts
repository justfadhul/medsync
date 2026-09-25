import { beforeEach, describe, expect, it, vi } from "vitest";

import { scriptedDb } from "./fake-db";

/**
 * Starting an assignment stamps `started_at` (GATE A §5): the planned row kept
 * its insert time, so a patient assigned yesterday and seen today read as "in
 * progress since yesterday", and In progress measured the wrong wait.
 */

const fake = scriptedDb();
vi.mock("@/db", () => ({ db: fake.db }));
vi.mock("@/lib/encounter/clerkship", () => ({ seedClerkshipFromTriage: () => ({}) }));
vi.mock("@/lib/encounter/record", () => ({ recordClerkshipVersion: async () => ({}) }));

const { openEncounterFromTriage } = await import("@/lib/encounter/handoff");

const scope = {
  userId: "doc",
  hospitalId: "h",
  departmentId: "dept",
  cadreCode: "CONSULTANT",
  isClinical: true,
};

beforeEach(() => {
  fake.queue.length = 0;
  fake.writes.length = 0;
});

describe("starting a planned encounter", () => {
  it("sets it in progress, makes the caller the clinician, and starts the clock now", async () => {
    fake.queue.push(
      [
        {
          hospitalId: "h",
          patientUserId: "pat",
          departmentId: "dept",
          intakeId: "intake-1",
          assignedLevel: 3,
          vitalsSnapshot: {},
        },
      ],
      [{ pc: "Fever", appointmentId: null }],
      [{ id: "enc-1", state: "planned" }],
      [], // no visit running today
      [], // no documentation yet
    );
    const before = Date.now();
    const res = await openEncounterFromTriage("triage-1", scope);
    expect(res).toEqual({ ok: true, encounterId: "enc-1", created: false });
    const update = fake.writes.find((w) => w.kind === "update")!;
    expect(update.values).toMatchObject({ state: "in_progress", clinicianUserId: "doc" });
    const startedAt = update.values.startedAt as Date;
    expect(startedAt).toBeInstanceOf(Date);
    expect(startedAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});
