/**
 * Triage suggestions in Plan (HARMONISATION §2 R4; W2): accept places a real order that remembers
 * the recommendation; dismiss writes an encounter_events row and orders nothing. EMR_PGLITE=1 only.
 */
import { randomUUID } from "node:crypto";
import type { Lane } from "./_pglite";
import type { EmrActor } from "@/lib/emr/actor";
import type { WriteCtx } from "@/lib/emr/write/context";
import { beforeAll, describe, expect, it } from "vitest";

import { withPatientWrite } from "@/lib/emr/write/context";
import { acceptSuggestedOrder, dismissSuggestedOrder } from "@/lib/emr/write/intents";
import { generateKey } from "@/lib/encryption";
import { bootLane, clinician, department, encounter, hospital, laneOn, patient } from "./_pglite";

const GLUCOSE_RANDOM = "c2ba5229-00b1-5233-96b9-7c2a730e4400";

describe.skipIf(!laneOn)("triage suggestions (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let doctor: EmrActor;
  let nurse: EmrActor;
  let p: string;
  let enc: string;
  let triage: string;

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    lane = await bootLane();
    h = await hospital(lane.pg);
    const dept = await department(lane.pg, h);
    const base = { fullName: null, hospitalId: h, departmentId: dept, isClinical: true } as const;
    const d = await clinician(lane.pg, { hospitalId: h, departmentId: dept });
    doctor = { ...base, ...d, cadreCode: "MEDICAL_OFFICER", surface: "doctor" };
    const n = await clinician(lane.pg, { hospitalId: h, departmentId: dept, cadre: "NURSE" });
    nurse = { ...base, ...n, cadreCode: "NURSE", surface: "nurse" };
    p = await patient(lane.pg);
    enc = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: d.userId,
      departmentId: dept,
    });
    triage = (
      await lane.pg.query<{ id: string }>(
        `INSERT INTO triage_records (hospital_id, patient_user_id, ruleset, vitals_snapshot, computed_level,
           computed_breakdown, assigned_level)
         VALUES ($1, $2, 'adult_news2', '{}'::jsonb, 3, '{}'::jsonb, 3) RETURNING id`,
        [h, p],
      )
    ).rows[0]!.id;
  }, 180_000);

  const as = <T>(a: EmrActor, fn: (ctx: WriteCtx) => Promise<T>) =>
    withPatientWrite(a, p, fn, { database: lane.db });
  const ref = (recommendationKey: string) => ({
    patientUserId: p,
    encounterId: enc,
    triageRecordId: triage,
    recommendationKey,
  });

  it("accept places an order sourced from the recommendation, idempotently", async () => {
    const clientKey = `k-${randomUUID()}`;
    const accept = () =>
      as(doctor, (ctx) =>
        acceptSuggestedOrder(ctx, {
          ...ref("invx_glucose"),
          order: {
            clientKey,
            testId: GLUCOSE_RANDOM,
            priority: "urgent",
            reasonText: "Triage suggestion",
          },
        }),
      );
    const r = await accept();
    expect((await accept()).id).toBe(r.id);
    const o = await lane.pg.query<{ intent_source: string; source_intent_id: string }>(
      `SELECT intent_source, source_intent_id FROM encounter_orders WHERE encounter_id = $1`,
      [enc],
    );
    expect(o.rows).toEqual([
      { intent_source: "triage_recommendation", source_intent_id: `${triage}:invx_glucose` },
    ]);
  });

  it("dismiss records the decision once and orders nothing", async () => {
    const before = (
      await lane.pg.query(`SELECT 1 FROM encounter_orders WHERE encounter_id = $1`, [enc])
    ).rows.length;
    const a = await as(doctor, (ctx) => dismissSuggestedOrder(ctx, ref("invx_ecg")));
    const b = await as(doctor, (ctx) => dismissSuggestedOrder(ctx, ref("invx_ecg")));
    expect(b.id).toBe(a.id);
    const ev = await lane.pg.query<{ kind: string; label: string }>(
      `SELECT kind, label FROM encounter_events WHERE id = $1`,
      [a.id],
    );
    expect(ev.rows[0]).toEqual({
      kind: "order",
      label: `Suggestion dismissed: ${triage}:invx_ecg`,
    });
    const after = (
      await lane.pg.query(`SELECT 1 FROM encounter_orders WHERE encounter_id = $1`, [enc])
    ).rows.length;
    expect(after).toBe(before);
  });

  it("refuses a nurse, and a triage record that is not this patient's", async () => {
    const code = (pr: Promise<unknown>) =>
      pr.then(
        () => "ok",
        (e: { code?: string }) => e.code,
      );
    expect(await code(as(nurse, (ctx) => dismissSuggestedOrder(ctx, ref("invx_ecg"))))).toBe(
      "forbidden",
    );
    expect(
      await code(
        as(doctor, (ctx) =>
          dismissSuggestedOrder(ctx, { ...ref("invx_ecg"), triageRecordId: randomUUID() }),
        ),
      ),
    ).toBe("not_found");
  });
});
