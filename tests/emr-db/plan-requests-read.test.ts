/**
 * The Plan's request read (ADR 0537) on the PGlite lane: the departments and live clinical staff a
 * request can go to (names only), and this visit's placed requests with their state words, a
 * redirected one naming its new department. Runs with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane, Pg } from "./_pglite";
import type { PlanRequestLine } from "@/lib/clerking/plan/draft";
import type { EmrActor } from "@/lib/emr/actor";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asClinicalWriter } from "@/lib/emr/db";
import { loadPlanRequests } from "@/lib/emr/read/plan";
import { withPatientWrite } from "@/lib/emr/write/context";
import {
  declineRequest,
  placeRequests,
  redirectRequest,
  withRequestWrite,
} from "@/lib/emr/write/requests";
import { generateKey } from "@/lib/encryption";
import { bootLane, clinician, department, encounter, hospital, laneOn, patient } from "./_pglite";

describe.skipIf(!laneOn)("the Plan's request read (PGlite lane)", () => {
  let lane: Lane;
  let pg: Pg;
  let h: string;

  const actor = (s: { userId: string; affiliationId: string }, departmentId: string): EmrActor => ({
    userId: s.userId,
    affiliationId: s.affiliationId,
    fullName: null,
    hospitalId: h,
    departmentId,
    cadreCode: "MEDICAL_OFFICER",
    isClinical: true,
    surface: "doctor",
  });
  const named = async (dept: string, name: string, cadre = "MEDICAL_OFFICER") => {
    const s = await clinician(pg, { hospitalId: h, departmentId: dept, cadre });
    await pg.query(`UPDATE public.users SET full_name = $2 WHERE id = $1`, [s.userId, name]);
    return actor(s, dept);
  };
  const key = () => `k-${randomUUID()}`;

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    lane = await bootLane();
    pg = lane.pg;
    h = await hospital(pg, "Plan read");
  }, 180_000);
  afterAll(() => {});

  it("lists departments with live clinical staff, placed requests with state words, and a redirect's new department", async () => {
    const home = await department(pg, h, "Home");
    const neph = await department(pg, h, "Nephrology");
    const cardio = await department(pg, h, "Cardiology");
    const me = await named(home, "Requester Self");
    const nephrologist = await named(neph, "Nephrologist One");
    await clinician(pg, { hospitalId: h, departmentId: neph, cadre: "RECEPTION" }); // not clinical
    const suspended = await clinician(pg, { hospitalId: h, departmentId: neph });
    await pg.query(`UPDATE staff_affiliations SET state = 'suspended' WHERE id = $1`, [
      suspended.affiliationId,
    ]);
    await named(cardio, "Cardiologist One");
    const ward = (
      await pg.query<{ id: string }>(
        `INSERT INTO hospital_wards (hospital_id, department_id, name, slug)
         VALUES ($1, $2, 'Renal ward', $3) RETURNING id`,
        [h, neph, `renal-${randomUUID().slice(0, 6)}`],
      )
    ).rows[0]!.id;

    const p = await patient(pg);
    const enc = await encounter(pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: me.userId,
      departmentId: home,
    });
    const line = (kind: "review" | "consult", target: string, cond?: string): PlanRequestLine => ({
      clientKey: key(),
      kind,
      targetDepartmentId: target,
      wardId: null,
      namedUserIds: [],
      urgency: kind === "consult" ? "routine" : "within_1h",
      helpWanted: kind === "consult" ? "advice" : null,
      reasonConditionIds: cond ? [cond] : [],
      question: kind === "consult" ? "Is this nephrotic?" : "",
      phoned: null,
      display: "Request",
    });
    const cond = randomUUID();
    await pg.query(
      `INSERT INTO public.conditions (id, logical_id, hospital_id, patient_user_id, encounter_id, effective_at,
         recorded_by_user_id, source, trust, category, text_ciphertext, clinical_status, verification, asserted_by,
         sensitivity, rank)
       VALUES ($1, $1, $2, $3, $4, now(), $5, 'clinician', 3, 'encounter_diagnosis', 'iv:tag:ct', 'active',
         'confirmed', 'clinician', 'standard', 'secondary')`,
      [cond, h, p, enc, me.userId],
    );
    const [review, consult] = await withPatientWrite(
      me,
      p,
      (ctx) =>
        placeRequests(ctx, {
          patientUserId: p,
          encounterId: enc,
          placementId: randomUUID(),
          lines: [line("review", neph), line("consult", neph, cond)],
        }),
      { database: lane.db },
    );
    const as = <T>(
      who: EmrActor,
      id: string,
      fn: Parameters<typeof withRequestWrite<T>>[2],
    ): Promise<T> => withRequestWrite(who, id, fn, { database: lane.db });
    await as(nephrologist, consult!, (c) =>
      declineRequest(c, { clientKey: key(), reasonCode: "needs_other_team" }),
    );
    await as(me, consult!, (c) =>
      redirectRequest(c, { clientKey: key(), departmentId: cardio, reasonCode: "other" }),
    );

    const read = await asClinicalWriter(
      { userId: me.userId, hospitalId: h },
      (tx) => loadPlanRequests(tx, me, enc, [ward], new Date()),
      lane.db,
    );

    const byId = new Map(read.payload.departments.map((d) => [d.id, d]));
    expect(read.payload.ownDepartmentId).toBe(home);
    expect(byId.get(neph)).toEqual({
      id: neph,
      name: expect.stringMatching(/^Nephrology/),
      wardIds: [ward],
      staff: [{ userId: nephrologist.userId, name: "Nephrologist One", cadre: expect.any(String) }],
    });
    // The viewer is never offered to themselves; staff carry names and cadres only.
    expect(byId.get(home)!.staff).toEqual([]);
    expect(Object.keys(byId.get(cardio)!.staff[0]!).sort()).toEqual(["cadre", "name", "userId"]);

    const placed = new Map(read.placed.map((r) => [r.id, r]));
    expect(placed.get(review!)).toMatchObject({
      kind: "review",
      urgency: "within_1h",
      helpWanted: null,
      targetWords: expect.stringMatching(/^Nephrology/),
      stateWord: "Sent",
    });
    expect(placed.get(consult!)).toMatchObject({
      kind: "consult",
      helpWanted: "advice",
      targetWords: expect.stringMatching(/^Cardiology/),
      stateWord: "Sent",
    });
  });
});
