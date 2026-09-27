/**
 * Handoff hygiene under EMR v1 (HARMONISATION §5.1): the triage handoff and the assignment write no
 * v1 clinical_documentation draft (the clerking desk carries forward from the triage record) and
 * every encounter they create or link carries visit_id = the intake. The real lib/encounter code
 * runs against the PGlite lane (`@/db` is the lane's drizzle). Runs only with EMR_PGLITE=1.
 */
import type { Lane } from "./_pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  bootLane,
  clinician,
  department,
  encounter,
  hospital,
  intake,
  laneOn,
  patient,
} from "./_pglite";

vi.mock("@/db", async () => {
  const { bootLane: boot } = await import("./_pglite");
  return { db: (await boot()).db };
});
// The real scope module pulls in the Supabase server client (env-validated); assignment only needs
// the cadre list from it.
vi.mock("@/lib/doctor/scope", () => ({ DOCTOR_CADRE_CODES: ["MEDICAL_OFFICER"] }));

const saved = { emr: process.env.EMR_V1, engine: process.env.ENCOUNTER_ENGINE_LIVE };

describe.skipIf(!laneOn)("handoff hygiene under EMR v1 (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let dept: string;
  let doc: string;

  beforeAll(async () => {
    process.env.EMR_V1 = "1";
    process.env.ENCOUNTER_ENGINE_LIVE = "1";
    lane = await bootLane();
    h = await hospital(lane.pg);
    dept = await department(lane.pg, h);
    doc = (await clinician(lane.pg, { hospitalId: h, departmentId: dept })).userId;
  }, 180_000);

  afterAll(() => {
    process.env.EMR_V1 = saved.emr;
    process.env.ENCOUNTER_ENGINE_LIVE = saved.engine;
  });

  async function triaged(): Promise<{ p: string; intakeId: string; triageId: string }> {
    const p = await patient(lane.pg);
    const intakeId = await intake(lane.pg, { hospitalId: h, patientUserId: p });
    const r = await lane.pg.query<{ id: string }>(
      `INSERT INTO public.triage_records (hospital_id, patient_user_id, intake_id, department_id, ruleset,
         vitals_snapshot, computed_level, computed_breakdown, assigned_level)
       VALUES ($1, $2, $3, $4, 'adult_news2', '{}'::jsonb, 3, '{}'::jsonb, 3) RETURNING id`,
      [h, p, intakeId, dept],
    );
    return { p, intakeId, triageId: r.rows[0]!.id };
  }

  const row = async (encounterId: string) =>
    (
      await lane.pg.query<{ visit_id: string | null; docs: number; state: string }>(
        `SELECT e.visit_id, e.state,
                (SELECT count(*)::int FROM public.clinical_documentation d WHERE d.encounter_id = e.id) AS docs
           FROM public.encounters e WHERE e.id = $1`,
        [encounterId],
      )
    ).rows[0]!;

  const scope = () => ({
    userId: doc,
    hospitalId: h,
    departmentId: dept,
    cadreCode: "MEDICAL_OFFICER",
    isClinical: true,
  });

  it("a triage handoff creates the encounter with visit_id and no clinical_documentation", async () => {
    const { openEncounterFromTriage } = await import("@/lib/encounter/handoff");
    const t = await triaged();
    const res = await openEncounterFromTriage(t.triageId, scope());
    expect(res).toMatchObject({ ok: true, created: true });
    if (!res.ok) return;
    expect(await row(res.encounterId)).toEqual({
      visit_id: t.intakeId,
      docs: 0,
      state: "in_progress",
    });
  });

  it("assignment plans the encounter with visit_id; starting it writes no draft", async () => {
    const { assignDoctorFromIntake } = await import("@/lib/encounter/assignment");
    const { openEncounterFromTriage } = await import("@/lib/encounter/handoff");
    const t = await triaged();
    const res = await assignDoctorFromIntake({
      intakeId: t.intakeId,
      doctorUserId: doc,
      assignerHospitalId: h,
    });
    expect(res).toMatchObject({ ok: true, action: "assigned" });
    if (!res.ok) return;
    expect(await row(res.encounterId)).toEqual({ visit_id: t.intakeId, docs: 0, state: "planned" });

    const started = await openEncounterFromTriage(t.triageId, scope());
    expect(started).toMatchObject({ ok: true, encounterId: res.encounterId, created: false });
    expect(await row(res.encounterId)).toEqual({
      visit_id: t.intakeId,
      docs: 0,
      state: "in_progress",
    });
  });

  it("a visit already running today is linked, not duplicated, and gains visit_id", async () => {
    const { openEncounterFromTriage } = await import("@/lib/encounter/handoff");
    const t = await triaged();
    const running = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: t.p,
      clinicianUserId: doc,
      departmentId: dept,
    });
    const res = await openEncounterFromTriage(t.triageId, scope());
    expect(res).toEqual({ ok: true, encounterId: running, created: false });
    expect(await row(running)).toEqual({ visit_id: t.intakeId, docs: 0, state: "in_progress" });
  });

  it("flag off: no visit_id is named (0071 may not be applied)", async () => {
    const { visitIdFor, visitSet } = await import("@/lib/encounter/handoff");
    process.env.EMR_V1 = "";
    try {
      expect(visitIdFor(h, "intake")).toBeNull();
      expect(visitSet(null)).toEqual({});
    } finally {
      process.env.EMR_V1 = "1";
    }
  });
});
