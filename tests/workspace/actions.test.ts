import { beforeEach, describe, expect, it, vi } from "vitest";

import { scriptedDb } from "./fake-db";

/**
 * The workspace's own server actions (§8). Take = assign me + start, both the
 * existing idempotent steps; a recorded death asks for a reason and audits it
 * BEFORE anything opens (Law 2); retire and its audit share one transaction;
 * close intake is the existing Edge Function.
 */

const fake = scriptedDb();
const audits: Record<string, unknown>[] = [];
let auditFails = false;
const db = {
  ...fake.db,
  insert: () => ({
    values: (v: Record<string, unknown>) => ({
      then: (ok: (x: unknown) => unknown, ko: (e: unknown) => unknown) =>
        auditFails
          ? Promise.reject(new Error("audit refused")).then(ok, ko)
          : (audits.push(v), Promise.resolve([]).then(ok, ko)),
    }),
  }),
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      select: () => {
        const chain: Record<string, unknown> = {};
        for (const m of ["from", "where", "for", "limit"]) chain[m] = () => chain;
        chain.then = (ok: (x: unknown) => unknown) =>
          Promise.resolve(fake.queue.shift() ?? []).then(ok);
        return chain;
      },
      update: () => ({
        set: (v: Record<string, unknown>) => ({
          where: async () => fake.writes.push({ kind: "update", table: "encounters", values: v }),
        }),
      }),
      insert: () => ({
        values: async (v: Record<string, unknown>) => {
          if (auditFails) throw new Error("CHECK sa_audit_log_action_check");
          audits.push(v);
        },
      }),
    };
    return fn(tx);
  }),
};

const assignDoctorFromIntake = vi.fn();
const openEncounterFromTriage = vi.fn();
const deathsFor = vi.fn();
const triageAuthorityFor = vi.fn();
const callEdge = vi.fn();
const redirect = vi.fn((to: string) => {
  throw Object.assign(new Error("NEXT_REDIRECT"), { to });
});

vi.mock("@/db", () => ({ db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/doctor/scope", () => ({
  requireDoctorScope: async () => ({
    userId: "doc",
    hospitalId: "h",
    departmentId: "dept",
    cadreCode: "CONSULTANT",
  }),
}));
vi.mock("@/lib/encounter/feature", () => ({ encounterEngineLive: () => true }));
vi.mock("@/lib/encounter/assignment", () => ({ assignDoctorFromIntake }));
vi.mock("@/lib/encounter/handoff", () => ({ openEncounterFromTriage }));
vi.mock("@/lib/workspace/queries", () => ({ deathsFor, triageAuthorityFor }));
vi.mock("@/lib/supabase/edge", () => ({ callEdge }));

const { closeIntakeAction, retireAssignmentAction, startForWorkspaceAction, takePatientAction } =
  await import("@/app/doctor/_lib/workspace-actions");

const INTAKE = "11111111-1111-4111-8111-111111111111";
const TRIAGE = "22222222-2222-4222-8222-222222222222";
const ENC = "33333333-3333-4333-8333-333333333333";
const DIED = [
  {
    patientId: "pat",
    atMs: Date.parse("2026-09-24T08:06:00Z"),
    source: "resus",
    sourceId: "r",
    byName: "Dr X",
  },
];

async function expectRedirect(p: Promise<unknown>, to: string) {
  await expect(p).rejects.toMatchObject({ to });
}

beforeEach(() => {
  fake.queue.length = 0;
  fake.writes.length = 0;
  audits.length = 0;
  auditFails = false;
  assignDoctorFromIntake
    .mockReset()
    .mockResolvedValue({ ok: true, encounterId: ENC, action: "assigned" });
  openEncounterFromTriage
    .mockReset()
    .mockResolvedValue({ ok: true, encounterId: ENC, created: false });
  deathsFor.mockReset().mockResolvedValue([]);
  triageAuthorityFor.mockReset().mockResolvedValue({ mayTriage: true });
  callEdge.mockReset();
});

describe("takePatientAction — Take & start", () => {
  it("assigns me, starts the visit's encounter, audits and opens the clerking", async () => {
    fake.queue.push([{ patientUserId: "pat", hospitalId: "h" }], [{ triageRecordId: TRIAGE }]);
    await expectRedirect(takePatientAction({ intakeId: INTAKE }), `/doctor/encounters/${ENC}`);
    expect(assignDoctorFromIntake).toHaveBeenCalledWith({
      intakeId: INTAKE,
      doctorUserId: "doc",
      assignerHospitalId: "h",
    });
    expect(openEncounterFromTriage).toHaveBeenCalledWith(
      TRIAGE,
      expect.objectContaining({ userId: "doc" }),
    );
    expect(audits).toEqual([
      expect.objectContaining({
        action: "start_encounter",
        targetKind: "encounter",
        targetId: ENC,
      }),
    ]);
  });

  it("refuses a cadre that may not assign here", async () => {
    triageAuthorityFor.mockResolvedValue({ mayTriage: false });
    expect(await takePatientAction({ intakeId: INTAKE })).toEqual({
      ok: false,
      error: "Your cadre may not assign patients at this hospital.",
    });
    expect(assignDoctorFromIntake).not.toHaveBeenCalled();
  });

  it("a patient outside my hospital is not found", async () => {
    fake.queue.push([{ patientUserId: "pat", hospitalId: "other" }]);
    expect(await takePatientAction({ intakeId: INTAKE })).toMatchObject({
      ok: false,
      error: "Patient not found.",
    });
  });

  it("a recorded death asks for a reason and changes nothing", async () => {
    fake.queue.push([{ patientUserId: "pat", hospitalId: "h" }]);
    deathsFor.mockResolvedValue(DIED);
    const res = await takePatientAction({ intakeId: INTAKE });
    expect(res).toMatchObject({ ok: false, deceased: { source: "resus" } });
    expect((res as { error: string }).error).toMatch(
      /^Recorded as died 24 Sep 11:06\. Give a reason to continue\.$/,
    );
    expect(assignDoctorFromIntake).not.toHaveBeenCalled();
    expect(audits).toHaveLength(0);
  });

  it("with a reason, the override is audited first, then the visit opens", async () => {
    fake.queue.push([{ patientUserId: "pat", hospitalId: "h" }], [{ triageRecordId: TRIAGE }]);
    deathsFor.mockResolvedValue(DIED);
    await expectRedirect(
      takePatientAction({
        intakeId: INTAKE,
        overrideReason: "Death recorded against the wrong patient",
      }),
      `/doctor/encounters/${ENC}`,
    );
    expect(audits[0]).toMatchObject({
      action: "start_encounter",
      targetKind: "patient_intake",
      targetId: INTAKE,
      reason: "Death recorded against the wrong patient",
      afterData: { override: "started_despite_recorded_death" },
    });
    expect(assignDoctorFromIntake.mock.invocationCallOrder[0]).toBeGreaterThan(0);
  });

  it("no reason on record, no encounter: an audit failure stops the override", async () => {
    fake.queue.push([{ patientUserId: "pat", hospitalId: "h" }]);
    deathsFor.mockResolvedValue(DIED);
    auditFails = true;
    expect(
      await takePatientAction({
        intakeId: INTAKE,
        overrideReason: "Wrong patient on the death record",
      }),
    ).toEqual({
      ok: false,
      error: "The reason could not be recorded, so nothing was started.",
    });
    expect(assignDoctorFromIntake).not.toHaveBeenCalled();
  });

  it("a short reason is refused before anything is read", async () => {
    expect(await takePatientAction({ intakeId: INTAKE, overrideReason: "short" })).toMatchObject({
      ok: false,
    });
    expect(fake.queue).toHaveLength(0);
  });

  it("if starting fails after the assignment, the patient is left clearly assigned", async () => {
    fake.queue.push([{ patientUserId: "pat", hospitalId: "h" }], [{ triageRecordId: TRIAGE }]);
    openEncounterFromTriage.mockResolvedValue({
      ok: false,
      error: "Failed to open the encounter.",
    });
    expect(await takePatientAction({ intakeId: INTAKE })).toEqual({
      ok: false,
      error: "Failed to open the encounter. The patient is assigned to you under Waiting for you.",
    });
  });
});

describe("startForWorkspaceAction — Start with the death check", () => {
  it("starts and opens the clerking", async () => {
    fake.queue.push([{ patientUserId: "pat", hospitalId: "h" }]);
    await expectRedirect(
      startForWorkspaceAction({ triageRecordId: TRIAGE }),
      `/doctor/encounters/${ENC}`,
    );
  });

  it("a recorded death needs a reason; with one it is audited against the triage record first", async () => {
    deathsFor.mockResolvedValue(DIED);
    fake.queue.push([{ patientUserId: "pat", hospitalId: "h" }]);
    expect(await startForWorkspaceAction({ triageRecordId: TRIAGE })).toMatchObject({
      ok: false,
      deceased: {},
    });
    expect(openEncounterFromTriage).not.toHaveBeenCalled();
    fake.queue.push([{ patientUserId: "pat", hospitalId: "h" }]);
    await expectRedirect(
      startForWorkspaceAction({
        triageRecordId: TRIAGE,
        overrideReason: "Family confirm he is alive",
      }),
      `/doctor/encounters/${ENC}`,
    );
    expect(audits[0]).toMatchObject({ targetKind: "triage_record", targetId: TRIAGE });
  });
});

describe("retireAssignmentAction — D5", () => {
  it("planned → cancelled with the reason, audited in the same transaction", async () => {
    fake.queue.push([{ state: "planned", clinicianUserId: "doc", hospitalId: "h" }]);
    expect(
      await retireAssignmentAction({
        encounterId: ENC,
        reason: "Superseded by the 20 Sep assignment",
      }),
    ).toEqual({ ok: true });
    expect(fake.writes[0]!.values).toMatchObject({
      state: "cancelled",
      completionReason: "assignment_retired",
    });
    expect(audits[0]).toMatchObject({
      action: "retire_assignment",
      targetKind: "encounter",
      targetId: ENC,
    });
  });

  it("without migration 0069 the audit is refused and nothing is changed", async () => {
    fake.queue.push([{ state: "planned", clinicianUserId: "doc", hospitalId: "h" }]);
    auditFails = true;
    expect(
      await retireAssignmentAction({
        encounterId: ENC,
        reason: "Superseded by the 20 Sep assignment",
      }),
    ).toEqual({
      ok: false,
      error: "The assignment could not be retired — nothing was changed.",
    });
  });

  it("only a not-yet-started assignment, only by the doctor it is assigned to", async () => {
    fake.queue.push([{ state: "in_progress", clinicianUserId: "doc", hospitalId: "h" }]);
    expect(
      await retireAssignmentAction({ encounterId: ENC, reason: "Superseded assignment" }),
    ).toMatchObject({ ok: false });
    fake.queue.push([{ state: "planned", clinicianUserId: "someone-else", hospitalId: "h" }]);
    expect(
      await retireAssignmentAction({ encounterId: ENC, reason: "Superseded assignment" }),
    ).toEqual({
      ok: false,
      error: "Only the doctor it is assigned to can retire it.",
    });
    expect(fake.writes).toHaveLength(0);
  });
});

describe("closeIntakeAction", () => {
  it("is the existing ha-cancel-intake with the reason", async () => {
    callEdge.mockResolvedValue({ ok: true, data: {} });
    expect(
      await closeIntakeAction({ intakeId: INTAKE, reason: "Patient died in resus 24 Sep" }),
    ).toEqual({ ok: true });
    expect(callEdge).toHaveBeenCalledWith(
      "ha-cancel-intake",
      { intake_id: INTAKE, reason: "Patient died in resus 24 Sep" },
      "doctor.workspace",
    );
  });

  it("returns the function's refusal word for word", async () => {
    callEdge.mockResolvedValue({ ok: false, error: "Not allowed at this hospital." });
    expect(
      await closeIntakeAction({ intakeId: INTAKE, reason: "Patient died in resus 24 Sep" }),
    ).toEqual({
      ok: false,
      error: "Not allowed at this hospital.",
    });
  });
});
