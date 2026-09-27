/**
 * Chart actions on the PGlite lane (lib/emr/write/facts.ts over the real 0071 tables and triggers):
 * access (no basis, reception, other hospital), idempotent replay, unit re-check, duplicate flag,
 * allergies (coded, uncoded, NKDA outranked, supersession), one primary diagnosis per visit, EIE keeps
 * the concept, medicines, pregnancy, procedures. Runs only with EMR_PGLITE=1.
 */
import type { Lane } from "./_pglite";
import type { EmrActor } from "@/lib/emr/actor";
import type { WriteCtx } from "@/lib/emr/write/context";
import { beforeAll, describe, expect, it } from "vitest";

import { loadAllergyInput } from "@/lib/emr/read/allergies";
import { withPatientWrite } from "@/lib/emr/write/context";
import * as facts from "@/lib/emr/write/facts";
import { generateKey } from "@/lib/encryption";
import { projectObservation } from "@/lib/facts/project/observation";
import {
  bootLane,
  department,
  encounter,
  hospital,
  intake,
  laneOn,
  patient,
  staff,
} from "./_pglite";

type Pg = Lane["pg"];
const key = () => `k-${crypto.randomUUID()}`;

async function actorOf(
  pg: Pg,
  cadre: string,
  hospitalId: string,
  departmentId: string,
): Promise<EmrActor> {
  const s = await staff(pg, { hospitalId, departmentId, cadre });
  return {
    userId: s.userId,
    fullName: null,
    hospitalId,
    departmentId,
    affiliationId: s.affiliationId,
    cadreCode: cadre,
    isClinical: cadre !== "RECEPTION",
    surface: "doctor",
  };
}

describe.skipIf(!laneOn)("fact writes (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let mo: EmrActor;
  let intern: EmrActor;
  let nurse: EmrActor;
  let consultant: EmrActor;
  let lab: EmrActor;
  let reception: EmrActor;
  let elsewhere: EmrActor;
  let p: string;
  let enc: string;

  const as = <T>(a: EmrActor, fn: (ctx: WriteCtx) => Promise<T>, patientUserId = p) =>
    withPatientWrite(a, patientUserId, fn, { database: lane.db });
  const count = async (sql: string, params: unknown[]) =>
    (await lane.pg.query<{ n: number }>(sql, params)).rows[0]!.n;

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    lane = await bootLane();
    h = await hospital(lane.pg);
    const dept = await department(lane.pg, h);
    const h2 = await hospital(lane.pg, "Elsewhere");
    const dept2 = await department(lane.pg, h2);
    mo = await actorOf(lane.pg, "MEDICAL_OFFICER", h, dept);
    intern = await actorOf(lane.pg, "INTERN_DOCTOR", h, dept);
    nurse = await actorOf(lane.pg, "NURSE", h, dept);
    consultant = await actorOf(lane.pg, "CONSULTANT", h, dept);
    lab = await actorOf(lane.pg, "LAB_TECH", h, dept);
    reception = await actorOf(lane.pg, "RECEPTION", h, dept);
    elsewhere = await actorOf(lane.pg, "MEDICAL_OFFICER", h2, dept2);
    p = await patient(lane.pg);
    enc = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: mo.userId,
      departmentId: dept,
    });
    // Present today: every clinical cadre at this hospital has the open_intake basis.
    await intake(lane.pg, { hospitalId: h, patientUserId: p });
  }, 180_000);

  const bp = (value: number) => ({
    conceptId: "obs.bp_systolic",
    value: { type: "quantity" as const, value, unit: "mm[Hg]" },
  });

  it("records a batch, stamps activity, and the rows project as facts", async () => {
    const r = await as(nurse, (ctx) =>
      facts.recordObservations(ctx, {
        patientUserId: p,
        encounterId: enc,
        clientKey: key(),
        observations: [
          bp(128),
          {
            conceptId: "obs.glucose",
            value: { type: "quantity", value: "<1.1", unit: "mmol/L" },
            specimen: "capillary_whole_blood",
          },
          { conceptId: "sx.polyuria", value: { type: "presence", presence: "present" } },
        ],
      }),
    );
    expect(r.ids).toHaveLength(3);
    const { rows } = await lane.pg.query(
      `SELECT * FROM public.clinical_observations WHERE id = ANY($1::uuid[]) ORDER BY concept_id`,
      [r.ids],
    );
    expect(rows.map((o) => [o.concept_id, o.source, o.trust])).toEqual([
      ["obs.bp_systolic", "poc_staff", 3],
      ["obs.glucose", "poc_staff", 3],
      ["sx.polyuria", "poc_staff", 3],
    ]);
    expect(rows[1]).toMatchObject({ value_comparator: "<", value_num: "1.1" });
    const drizzleRows = await lane.db.query.clinicalObservations.findMany({
      where: (o, { inArray }) => inArray(o.id, r.ids),
    });
    for (const row of drizzleRows) expect(projectObservation(row).quarantined).toEqual([]);
    expect(
      await count(
        `SELECT count(*)::int n FROM public.encounters WHERE id = $1 AND last_activity_at IS NOT NULL`,
        [enc],
      ),
    ).toBe(1);
  });

  it("converts units, refuses an unconfirmed mismatch with the ask, accepts it confirmed", async () => {
    const mgdl = await as(mo, (ctx) =>
      facts.recordObservations(ctx, {
        patientUserId: p,
        clientKey: key(),
        observations: [
          { conceptId: "obs.glucose", value: { type: "quantity", value: 90, unit: "mg/dL" } },
        ],
      }),
    );
    const { rows } = await lane.pg.query(
      `SELECT value_canonical FROM public.clinical_observations WHERE id = $1`,
      [mgdl.id],
    );
    expect(Number(rows[0]!.value_canonical)).toBeCloseTo(90 / 18.0156, 6);

    const high = {
      conceptId: "obs.glucose",
      value: { type: "quantity" as const, value: 90, unit: "mmol/L" },
    };
    await expect(
      as(mo, (ctx) =>
        facts.recordObservations(ctx, { patientUserId: p, clientKey: key(), observations: [high] }),
      ),
    ).rejects.toMatchObject({
      code: "invalid",
      message: expect.stringMatching(/Is this mg\/dL\?/),
    });
    const ok = await as(mo, (ctx) =>
      facts.recordObservations(ctx, {
        patientUserId: p,
        clientKey: key(),
        observations: [{ ...high, unitConfirmed: true }],
      }),
    );
    expect(ok.ids).toHaveLength(1);
  });

  it("is idempotent on the client key", async () => {
    const k = key();
    const write = () =>
      as(mo, (ctx) =>
        facts.recordObservations(ctx, {
          patientUserId: p,
          clientKey: k,
          observations: [bp(141), bp(139)],
        }),
      );
    const a = await write();
    const b = await write();
    expect(b.ids).toEqual(a.ids);
    expect(
      await count(
        `SELECT count(*)::int n FROM public.clinical_observations WHERE client_key LIKE $1`,
        [`${k}#%`],
      ),
    ).toBe(2);
  });

  it("flags the same value at the same time from another source as a possible duplicate", async () => {
    const at = new Date(Date.now() - 3_600_000);
    await as(nurse, (ctx) =>
      facts.recordObservations(ctx, {
        patientUserId: p,
        clientKey: key(),
        observations: [{ ...bp(155), effectiveAt: at }],
      }),
    );
    const r = await as(mo, (ctx) =>
      facts.recordObservations(ctx, {
        patientUserId: p,
        clientKey: key(),
        observations: [{ ...bp(155), effectiveAt: new Date(at.getTime() + 60_000) }],
      }),
    );
    expect(r.warnings?.[0]).toMatch(/possible duplicate/);
    const { rows } = await lane.pg.query(
      `SELECT context FROM public.clinical_observations WHERE id = $1`,
      [r.id],
    );
    expect(rows[0]!.context).toHaveProperty("duplicateOf");
  });

  it("refuses no basis, reception and another hospital; refuses the lab cadre for observations", async () => {
    const stranger = await patient(lane.pg);
    const write = (a: EmrActor, who = p) =>
      as(
        a,
        (ctx) =>
          facts.recordObservations(ctx, {
            patientUserId: who,
            clientKey: key(),
            observations: [bp(120)],
          }),
        who,
      );
    await expect(write(mo, stranger)).rejects.toMatchObject({ code: "forbidden" });
    await expect(write(reception)).rejects.toMatchObject({ code: "forbidden" });
    await expect(write(elsewhere)).rejects.toMatchObject({ code: "forbidden" });
    await expect(write(lab)).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      as(lab, (ctx) =>
        facts.recordAllergy(ctx, {
          patientUserId: p,
          clientKey: key(),
          substance: { text: "Latex" },
        }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("allergies: coded and uncoded, NKDA outranked by an active allergy, supersession keeps the substance", async () => {
    const q = await patient(lane.pg);
    await intake(lane.pg, { hospitalId: h, patientUserId: q });
    const nkda = await as(
      nurse,
      (ctx) =>
        facts.assertAllergyStatus(ctx, {
          patientUserId: q,
          clientKey: key(),
          assertion: "no_known_drug_allergies",
        }),
      q,
    );
    expect(nkda.warnings).toEqual([]);
    expect((await loadAllergyInput(lane.db, q)).status.kind).toBe("no_known_drug_allergies");

    const coded = await as(
      mo,
      (ctx) =>
        facts.recordAllergy(ctx, {
          patientUserId: q,
          clientKey: key(),
          substance: { kind: "drug_ingredient", code: "amiodarone" },
          criticality: "high",
          manifestations: ["anaphylaxis"],
        }),
      q,
    );
    expect(coded.warnings).toEqual([]);
    const text = await as(
      nurse,
      (ctx) =>
        facts.recordAllergy(ctx, {
          patientUserId: q,
          clientKey: key(),
          substance: { text: "Groundnuts" },
        }),
      q,
    );
    expect(text.warnings).toEqual([expect.stringMatching(/name only/)]);
    const input = await loadAllergyInput(lane.db, q);
    // An active allergy outranks the NKDA assertion without touching it.
    expect(input.status.kind).toBe("listed");
    expect(input.allergies).toEqual(expect.arrayContaining(["amiodarone", "Groundnuts"]));
    expect(
      await count(
        `SELECT count(*)::int n FROM public.allergy_status_assertions WHERE patient_user_id = $1`,
        [q],
      ),
    ).toBe(1);

    const again = await as(
      mo,
      (ctx) =>
        facts.assertAllergyStatus(ctx, {
          patientUserId: q,
          clientKey: key(),
          assertion: "no_known_drug_allergies",
        }),
      q,
    );
    expect(again.warnings?.[0]).toMatch(/outranks/);

    // Refute needs a reason; the new version keeps the logical item and the substance.
    await expect(
      as(
        mo,
        (ctx) =>
          facts.recordAllergy(ctx, {
            patientUserId: q,
            clientKey: key(),
            supersedesId: coded.id,
            verification: "refuted",
          }),
        q,
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    const v2 = await as(
      mo,
      (ctx) =>
        facts.recordAllergy(ctx, {
          patientUserId: q,
          clientKey: key(),
          supersedesId: coded.id,
          verification: "refuted",
          reasonText: "Tolerated a full course last year",
        }),
      q,
    );
    const { rows } = await lane.pg.query(
      `SELECT logical_id, version, substance_code, supersedes_id FROM public.allergies WHERE id = $1`,
      [v2.id],
    );
    expect(rows[0]).toMatchObject({
      logical_id: coded.id,
      version: 2,
      substance_code: "amiodarone",
      supersedes_id: coded.id,
    });
    expect((await loadAllergyInput(lane.db, q)).allergies).toEqual(["Groundnuts"]);
  });

  it("one primary diagnosis per visit; interns record working diagnoses; resolve needs a reason", async () => {
    const q = await patient(lane.pg);
    const e = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: q,
      clinicianUserId: mo.userId,
    });
    await intake(lane.pg, { hospitalId: h, patientUserId: q });
    const dx = (a: EmrActor, extra: Partial<facts.EncounterDiagnosisInput> = {}) =>
      as(
        a,
        (ctx) =>
          facts.recordEncounterDiagnosis(ctx, {
            patientUserId: q,
            encounterId: e,
            clientKey: key(),
            text: "Fever",
            ...extra,
          }),
        q,
      );

    const first = await dx(mo);
    const second = await dx(intern, { verification: "confirmed" });
    expect(second.warnings).toEqual([expect.stringMatching(/working/)]);
    await expect(dx(mo, { rank: "primary" })).rejects.toMatchObject({ code: "conflict" });
    const { rows } = await lane.pg.query(
      `SELECT id, rank, verification FROM public.conditions WHERE encounter_id = $1 ORDER BY recorded_at, rank`,
      [e],
    );
    expect(rows.map((r) => [r.rank, r.verification])).toEqual([
      ["primary", "provisional"],
      ["secondary", "provisional"],
    ]);
    // Moving primary to the second needs the first demoted.
    await expect(
      as(
        mo,
        (ctx) =>
          facts.updateProblemStatus(ctx, {
            patientUserId: q,
            id: second.id,
            clientKey: key(),
            rank: "primary",
          }),
        q,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await as(
      mo,
      (ctx) =>
        facts.updateProblemStatus(ctx, {
          patientUserId: q,
          id: first.id,
          clientKey: key(),
          rank: "secondary",
        }),
      q,
    );
    await as(
      mo,
      (ctx) =>
        facts.updateProblemStatus(ctx, {
          patientUserId: q,
          id: second.id,
          clientKey: key(),
          rank: "primary",
        }),
      q,
    );

    const problem = await as(
      mo,
      (ctx) =>
        facts.recordProblem(ctx, { patientUserId: q, clientKey: key(), text: "Hypertension" }),
      q,
    );
    await expect(
      as(
        mo,
        (ctx) =>
          facts.updateProblemStatus(ctx, {
            patientUserId: q,
            id: problem.id,
            clientKey: key(),
            clinicalStatus: "resolved",
          }),
        q,
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      as(
        intern,
        (ctx) =>
          facts.updateProblemStatus(ctx, {
            patientUserId: q,
            id: problem.id,
            clientKey: key(),
            clinicalStatus: "resolved",
            reasonCode: "x",
          }),
        q,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    const resolved = await as(
      mo,
      (ctx) =>
        facts.updateProblemStatus(ctx, {
          patientUserId: q,
          id: problem.id,
          clientKey: key(),
          clinicalStatus: "resolved",
          reasonCode: "treated",
        }),
      q,
    );
    const r = (
      await lane.pg.query(
        `SELECT clinical_status, abatement_at FROM public.conditions WHERE id = $1`,
        [resolved.id],
      )
    ).rows[0]!;
    expect(r.clinical_status).toBe("resolved");
    expect(r.abatement_at).not.toBeNull();
  });

  it("entered in error keeps the concept and term; author or senior only; reason required", async () => {
    const obs = await as(nurse, (ctx) =>
      facts.recordObservations(ctx, { patientUserId: p, clientKey: key(), observations: [bp(99)] }),
    );
    const eie = (a: EmrActor, extra: Partial<facts.MarkFactEnteredInErrorInput> = {}) =>
      as(a, (ctx) =>
        facts.markFactEnteredInError(ctx, {
          patientUserId: p,
          kind: "observation",
          id: obs.id,
          clientKey: key(),
          reasonText: "Wrong patient",
          ...extra,
        }),
      );
    await expect(eie(nurse, { reasonText: undefined })).rejects.toMatchObject({ code: "invalid" });
    await expect(eie(intern)).rejects.toMatchObject({ code: "forbidden" });
    const v = await eie(consultant);
    const { rows } = await lane.pg.query(
      `SELECT concept_id, status, logical_id, version FROM public.clinical_observations WHERE id = $1`,
      [v.id],
    );
    expect(rows[0]).toMatchObject({
      concept_id: "obs.bp_systolic",
      status: "entered_in_error",
      logical_id: obs.id,
      version: 2,
    });

    const dx = await as(mo, (ctx) =>
      facts.recordEncounterDiagnosis(ctx, {
        patientUserId: p,
        encounterId: enc,
        clientKey: key(),
        text: "Cough",
        rank: "secondary",
      }),
    );
    const k = key();
    const cv = await as(mo, (ctx) =>
      facts.markFactEnteredInError(ctx, {
        patientUserId: p,
        kind: "condition",
        id: dx.id,
        clientKey: k,
        reasonCode: "wrong_patient",
      }),
    );
    const replay = await as(mo, (ctx) =>
      facts.markFactEnteredInError(ctx, {
        patientUserId: p,
        kind: "condition",
        id: dx.id,
        clientKey: k,
        reasonCode: "wrong_patient",
      }),
    );
    expect(replay.id).toBe(cv.id);
    const c = (await lane.pg.query(`SELECT * FROM public.conditions WHERE id = $1`, [cv.id]))
      .rows[0]!;
    expect(c).toMatchObject({
      status: "entered_in_error",
      category: "encounter_diagnosis",
      logical_id: dx.id,
      rank: "secondary",
    });
    expect(c.text_ciphertext).not.toBeNull();
    // The voided version is final: voiding it again conflicts.
    await expect(
      as(mo, (ctx) =>
        facts.markFactEnteredInError(ctx, {
          patientUserId: p,
          kind: "condition",
          id: dx.id,
          clientKey: key(),
          reasonCode: "x",
        }),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("medicines, reconciliation, pregnancy and procedures", async () => {
    const m = await as(nurse, (ctx) =>
      facts.recordMedicationStatements(ctx, {
        patientUserId: p,
        clientKey: key(),
        statements: [
          {
            drugText: "Herbal tea",
            productKind: "herbal_traditional",
            medicationStatus: "active",
            medicationSource: "patient_reported",
          },
          {
            drugCode: "metformin",
            medicationStatus: "active",
            medicationSource: "external_record",
          },
        ],
      }),
    );
    expect(m.ids).toHaveLength(2);
    await expect(
      as(mo, (ctx) =>
        facts.confirmCurrentMedicines(ctx, {
          patientUserId: p,
          encounterId: enc,
          clientKey: key(),
          items: [{ id: m.ids[0]!, reconciliation: "stopped" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    const rec = await as(mo, (ctx) =>
      facts.confirmCurrentMedicines(ctx, {
        patientUserId: p,
        encounterId: enc,
        clientKey: key(),
        items: [
          { id: m.ids[0]!, reconciliation: "stopped", reasonText: "Stopped by the patient" },
          { id: m.ids[1]!, reconciliation: "continued" },
        ],
      }),
    );
    const { rows } = await lane.pg.query(
      `SELECT medication_status, reconciliation, version, encounter_id FROM public.medication_statements WHERE id = ANY($1::uuid[]) ORDER BY reconciliation DESC`,
      [rec.ids],
    );
    expect(rows.map((r) => [r.medication_status, r.reconciliation, r.version])).toEqual([
      ["stopped", "stopped", 2],
      ["active", "continued", 2],
    ]);

    const preg = await as(mo, (ctx) =>
      facts.recordPregnancy(ctx, {
        patientUserId: p,
        clientKey: key(),
        pregnancyState: "pregnant",
        lnmp: "2026-07-01",
      }),
    );
    const preg2 = await as(mo, (ctx) =>
      facts.recordPregnancy(ctx, {
        patientUserId: p,
        clientKey: key(),
        supersedesId: preg.id,
        pregnancyState: "pregnant",
        edd: "2027-04-07",
        eddBasis: "lmp",
      }),
    );
    const pr = (
      await lane.pg.query(
        `SELECT logical_id, version, lnmp FROM public.pregnancy_episodes WHERE id = $1`,
        [preg2.id],
      )
    ).rows[0]!;
    expect(pr).toMatchObject({ logical_id: preg.id, version: 2 });

    await expect(
      as(mo, (ctx) =>
        facts.recordProcedure(ctx, {
          patientUserId: p,
          clientKey: key(),
          conceptId: "obs.glucose",
          outcome: "completed",
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    const proc = await as(nurse, (ctx) =>
      facts.recordProcedure(ctx, {
        patientUserId: p,
        clientKey: key(),
        conceptId: "proc.foot_exam",
        outcome: "completed",
      }),
    );
    expect(proc.id).toBeTruthy();
  });
});
