/**
 * Placing care requests (ADR 0533) on the PGlite lane: the write path, the routing loader and the
 * in-app notices. Runs with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane, Pg } from "./_pglite";
import type { PlanRequestLine } from "@/lib/clerking/plan/draft";
import type { EmrActor } from "@/lib/emr/actor";
import { beforeAll, describe, expect, it } from "vitest";

import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { withPatientWrite } from "@/lib/emr/write/context";
import { placeRequests } from "@/lib/emr/write/requests";
import { generateKey } from "@/lib/encryption";
import {
  bootLane,
  clinician,
  department,
  encounter,
  hospital,
  laneOn,
  patient,
  reception,
  staff,
} from "./_pglite";

describe.skipIf(!laneOn)("placing care requests (PGlite lane)", () => {
  let lane: Lane;
  let pg: Pg;
  let h: string;
  let home: string;
  let requester: EmrActor;

  const actor = (
    s: { userId: string; affiliationId: string },
    cadreCode: string,
    departmentId: string,
  ): EmrActor => ({
    userId: s.userId,
    affiliationId: s.affiliationId,
    fullName: null,
    hospitalId: h,
    departmentId,
    cadreCode,
    isClinical: true,
    surface: "doctor",
  });

  const deptNamed = async (name: string) => {
    const id = await department(pg, h, name);
    const n = (
      await pg.query<{ name: string }>(`SELECT name FROM hospital_departments WHERE id = $1`, [id])
    ).rows[0]!.name;
    return { id, name: n };
  };

  async function visit(by: EmrActor): Promise<{ p: string; enc: string }> {
    const p = await patient(pg);
    const enc = await encounter(pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: by.userId,
      departmentId: by.departmentId,
    });
    return { p, enc };
  }

  async function problem(p: string, enc: string, sensitivity = "standard"): Promise<string> {
    const id = randomUUID();
    await pg.query(
      `INSERT INTO public.conditions (id, logical_id, hospital_id, patient_user_id, encounter_id, effective_at,
         recorded_by_user_id, source, trust, category, text_ciphertext, clinical_status, verification, asserted_by,
         sensitivity, rank)
       VALUES ($1, $1, $2, $3, $4, now(), $5, 'clinician', 3, 'encounter_diagnosis', 'iv:tag:ct', 'active',
         'confirmed', 'clinician', $6, 'secondary')`,
      [id, h, p, enc, requester.userId, sensitivity],
    );
    return id;
  }

  const line = (o: Partial<PlanRequestLine>): PlanRequestLine => ({
    clientKey: `req-${randomUUID()}`,
    kind: "review",
    targetDepartmentId: home,
    wardId: null,
    namedUserIds: [],
    urgency: "routine",
    helpWanted: null,
    reasonConditionIds: [],
    question: "",
    phoned: null,
    display: "Request",
    ...o,
  });

  const place = (by: EmrActor, v: { p: string; enc: string }, lines: PlanRequestLine[]) =>
    withPatientWrite(
      by,
      v.p,
      (ctx) =>
        placeRequests(ctx, {
          patientUserId: v.p,
          encounterId: v.enc,
          placementId: randomUUID(),
          lines,
        }),
      { database: lane.db },
    );

  const routed = async (requestId: string) =>
    (
      await pg.query<{ recipient_user_id: string | null; step: string; level: number }>(
        `SELECT recipient_user_id, step, level FROM care_request_events
          WHERE request_id = $1 AND kind = 'routed' ORDER BY recipient_user_id`,
        [requestId],
      )
    ).rows;

  const notices = async (requestId: string) =>
    (
      await pg.query<{ recipient_user_id: string; kind: string; subject: string }>(
        `SELECT recipient_user_id, kind, subject FROM sa_notifications
          WHERE related_kind = 'care_request' AND related_id = $1`,
        [requestId],
      )
    ).rows;

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    lane = await bootLane();
    pg = lane.pg;
    h = await hospital(pg, "Requests");
    home = await department(pg, h, "Home");
    requester = actor(
      await clinician(pg, { hospitalId: h, departmentId: home }),
      "MEDICAL_OFFICER",
      home,
    );
  }, 180_000);

  it("a consult routes to the department team list", async () => {
    const neph = await deptNamed("Nephrology");
    const mo = await clinician(pg, { hospitalId: h, departmentId: neph.id });
    const nurse = await clinician(pg, { hospitalId: h, departmentId: neph.id, cadre: "NURSE" });
    const v = await visit(requester);
    const cond = await problem(v.p, v.enc);
    const [id] = await place(requester, v, [
      line({
        kind: "consult",
        targetDepartmentId: neph.id,
        helpWanted: "advice",
        reasonConditionIds: [cond],
        question: "Is this nephrotic syndrome?",
      }),
    ]);
    const rows = await routed(id!);
    expect(rows.map((r) => r.recipient_user_id).sort()).toEqual([mo.userId, nurse.userId].sort());
    expect(rows.every((r) => r.step === "team" && r.level === 0)).toBe(true);
    const sent = await notices(id!);
    expect(sent).toHaveLength(2);
    for (const n of sent) {
      expect(n.kind).toBe("care_request");
      // Staff places only, never the patient (ADR 0199).
      expect(n.subject).toBe(CARE_REQUEST_COPY.noticeSubject("care_request", neph.name));
      expect(n.subject).not.toContain(v.p);
    }
  });

  it("a pharmacist in the target department is not routed (R32)", async () => {
    const dept = await department(pg, h, "Mixed");
    const mo = await clinician(pg, { hospitalId: h, departmentId: dept });
    await clinician(pg, { hospitalId: h, departmentId: dept, cadre: "PHARMACIST" });
    await clinician(pg, { hospitalId: h, departmentId: dept, cadre: "PHARMACY_TECH" });
    const v = await visit(requester);
    const cond = await problem(v.p, v.enc);
    const [id] = await place(requester, v, [
      line({
        kind: "consult",
        targetDepartmentId: dept,
        helpWanted: "advice",
        reasonConditionIds: [cond],
        question: "Synthetic question",
      }),
    ]);
    expect(await routed(id!)).toEqual([{ recipient_user_id: mo.userId, step: "team", level: 0 }]);
  });

  it("a review routes to seniors only", async () => {
    const med = await department(pg, h, "Medicine");
    await clinician(pg, { hospitalId: h, departmentId: med, cadre: "INTERN_DOCTOR" });
    const mo = await clinician(pg, { hospitalId: h, departmentId: med });
    const v = await visit(requester);
    const [id] = await place(requester, v, [line({ targetDepartmentId: med, urgency: "now" })]);
    expect(await routed(id!)).toEqual([{ recipient_user_id: mo.userId, step: "team", level: 0 }]);
  });

  it("named people win", async () => {
    const med = await department(pg, h, "Medicine");
    await clinician(pg, { hospitalId: h, departmentId: med });
    const named = await clinician(pg, { hospitalId: h, departmentId: home, cadre: "CONSULTANT" });
    const v = await visit(requester);
    const [id] = await place(requester, v, [
      line({ targetDepartmentId: med, namedUserIds: [named.userId] }),
    ]);
    expect(await routed(id!)).toEqual([
      { recipient_user_id: named.userId, step: "named", level: 0 },
    ]);
  });

  it("a junior's review with no senior falls back to the primary supervisor, then the head", async () => {
    const surg = await department(pg, h, "Surgery");
    const intern = await clinician(pg, {
      hospitalId: h,
      departmentId: home,
      cadre: "INTERN_DOCTOR",
    });
    const junior = actor(intern, "INTERN_DOCTOR", home);
    const sup = await clinician(pg, { hospitalId: h, departmentId: home, cadre: "CONSULTANT" });
    const head = await clinician(pg, { hospitalId: h, departmentId: surg, cadre: "CONSULTANT" });
    // The head's affiliation is elsewhere; the team list is empty of seniors.
    await pg.query(`UPDATE staff_affiliations SET department_id = $1 WHERE id = $2`, [
      home,
      head.affiliationId,
    ]);
    await pg.query(
      `INSERT INTO department_heads (hospital_id, department_id, user_id, acting) VALUES ($1, $2, $3, false)`,
      [h, surg, head.userId],
    );
    await pg.query(
      `INSERT INTO clinical_supervision (hospital_id, supervisee_affiliation_id, supervisor_affiliation_id)
       VALUES ($1, $2, $3)`,
      [h, intern.affiliationId, sup.affiliationId],
    );

    const v1 = await visit(junior);
    const [a] = await place(junior, v1, [line({ targetDepartmentId: surg })]);
    expect(await routed(a!)).toEqual([
      { recipient_user_id: sup.userId, step: "supervisor", level: 0 },
    ]);

    // A junior with no supervisor: the head.
    const other = actor(
      await clinician(pg, { hospitalId: h, departmentId: home, cadre: "CLINICAL_OFFICER" }),
      "CLINICAL_OFFICER",
      home,
    );
    const v2 = await visit(other);
    const [b] = await place(other, v2, [line({ targetDepartmentId: surg })]);
    expect(await routed(b!)).toEqual([
      { recipient_user_id: head.userId, step: "department_head", level: 0 },
    ]);
  });

  it("reached nobody still places", async () => {
    const empty = await department(pg, h, "Empty");
    const v = await visit(requester);
    const [id] = await place(requester, v, [line({ targetDepartmentId: empty })]);
    expect(await routed(id!)).toEqual([{ recipient_user_id: null, step: "none", level: 0 }]);
    expect(await notices(id!)).toHaveLength(0);
  });

  it("the same client key places once", async () => {
    const v = await visit(requester);
    const l = line({ targetDepartmentId: await department(pg, h, "Once") });
    const [a] = await place(requester, v, [l]);
    const [b] = await place(requester, v, [l]);
    expect(b).toBe(a);
    const n = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM care_requests WHERE client_key = $1`,
      [l.clientKey],
    );
    expect(n.rows[0]!.n).toBe(1);
  });

  it("a superseded problem is refused", async () => {
    const v = await visit(requester);
    const cond = await problem(v.p, v.enc);
    await pg.query(
      `INSERT INTO public.conditions (id, logical_id, version, supersedes_id, hospital_id, patient_user_id,
         encounter_id, effective_at, recorded_by_user_id, source, trust, category, text_ciphertext,
         clinical_status, verification, asserted_by, sensitivity, rank)
       VALUES (gen_random_uuid(), $1, 2, $1, $2, $3, $4, now(), $5, 'clinician', 3, 'encounter_diagnosis',
         'iv:tag:ct', 'active', 'confirmed', 'clinician', 'standard', 'secondary')`,
      [cond, h, v.p, v.enc, requester.userId],
    );
    await expect(
      place(requester, v, [
        line({
          kind: "consult",
          helpWanted: "advice",
          reasonConditionIds: [cond],
          question: "Q?",
        }),
      ]),
    ).rejects.toThrow(/has changed or was entered in error/);
  });

  it("restricted reason restricts the request", async () => {
    const v = await visit(requester);
    const cond = await problem(v.p, v.enc, "restricted");
    const [id] = await place(requester, v, [
      line({
        kind: "consult",
        helpWanted: "see_patient",
        reasonConditionIds: [cond],
        question: "Q?",
      }),
    ]);
    const r = await pg.query<{ sensitivity: string }>(
      `SELECT sensitivity FROM care_requests WHERE id = $1`,
      [id],
    );
    expect(r.rows[0]!.sensitivity).toBe("restricted");
  });

  it("the question is stored encrypted", async () => {
    const v = await visit(requester);
    const cond = await problem(v.p, v.enc);
    const question = "Should we start dialysis tonight?";
    const [id] = await place(requester, v, [
      line({ kind: "consult", helpWanted: "advice", reasonConditionIds: [cond], question }),
    ]);
    const r = await pg.query<{ q: string }>(
      `SELECT question_ciphertext AS q FROM care_requests WHERE id = $1`,
      [id],
    );
    expect(r.rows[0]!.q).toBeTruthy();
    expect(r.rows[0]!.q).not.toContain(question);
  });

  it("a failed notice never rolls the request back", async () => {
    const med = await department(pg, h, "Medicine");
    const mo = await clinician(pg, { hospitalId: h, departmentId: med });
    const v = await visit(requester);
    await pg.query(`ALTER TABLE sa_notifications ADD CONSTRAINT t_refuse CHECK (false) NOT VALID`);
    let id: string | undefined;
    try {
      [id] = await place(requester, v, [line({ targetDepartmentId: med })]);
    } finally {
      await pg.query(`ALTER TABLE sa_notifications DROP CONSTRAINT t_refuse`);
    }
    const r = await pg.query(`SELECT 1 FROM care_requests WHERE id = $1`, [id]);
    expect(r.rows).toHaveLength(1);
    expect(await routed(id!)).toEqual([{ recipient_user_id: mo.userId, step: "team", level: 0 }]);
    expect(await notices(id!)).toHaveLength(0);
  });
  const skips = async (requestId: string) =>
    (
      await pg.query<{ step: string; skipped: string[] }>(
        `SELECT step, skipped_user_ids AS skipped FROM care_request_events
          WHERE request_id = $1 AND kind = 'routed'`,
        [requestId],
      )
    ).rows;

  describe("recipients are a trust boundary (R24)", () => {
    const refused = async (o: Partial<PlanRequestLine>, by: EmrActor = requester) => {
      const v = await visit(by);
      return place(by, v, [line(o)]).then(
        () => "placed",
        (e: { code?: string }) => e.code ?? String(e),
      );
    };
    const minutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

    it("a non-clinical named person is refused", async () => {
      const desk = await reception(pg, { hospitalId: h, departmentId: home });
      expect(await refused({ namedUserIds: [desk.userId] })).toBe("invalid");
    });

    it("a named or phoned pharmacist is refused (R32)", async () => {
      const pharmacist = await clinician(pg, {
        hospitalId: h,
        departmentId: home,
        cadre: "PHARMACIST",
      });
      expect(await refused({ namedUserIds: [pharmacist.userId] })).toBe("invalid");
      expect(await refused({ phoned: { userId: pharmacist.userId, at: minutes(-5) } })).toBe(
        "invalid",
      );
    });

    it("a named person at another hospital is refused", async () => {
      const other = await hospital(pg, "Elsewhere");
      const far = await clinician(pg, {
        hospitalId: other,
        departmentId: await department(pg, other),
      });
      expect(await refused({ namedUserIds: [far.userId] })).toBe("invalid");
    });

    it("a phoned user who is not a clinician here is refused", async () => {
      expect(await refused({ phoned: { userId: await patient(pg), at: minutes(-5) } })).toBe(
        "invalid",
      );
    });

    it("the requester cannot be the phoned consultant", async () => {
      expect(await refused({ phoned: { userId: requester.userId, at: minutes(-5) } })).toBe(
        "invalid",
      );
    });

    it("a phoned time in the future is refused", async () => {
      const mo = await clinician(pg, { hospitalId: h, departmentId: home });
      expect(await refused({ phoned: { userId: mo.userId, at: minutes(10) } })).toBe("invalid");
    });

    it("a phoned time over a day old is refused", async () => {
      const mo = await clinician(pg, { hospitalId: h, departmentId: home });
      expect(await refused({ phoned: { userId: mo.userId, at: minutes(-25 * 60) } })).toBe(
        "invalid",
      );
    });

    it("a clinician here phoned a moment ago is accepted", async () => {
      const mo = await clinician(pg, { hospitalId: h, departmentId: home });
      expect(await refused({ phoned: { userId: mo.userId, at: minutes(-5) } })).toBe("placed");
    });
  });

  describe("the skip is recorded (R25)", () => {
    it("a named inactive person falls through to the team and is recorded", async () => {
      const med = await department(pg, h, "Medicine");
      const mo = await clinician(pg, { hospitalId: h, departmentId: med });
      const away = await staff(pg, { hospitalId: h, departmentId: home, state: "suspended" });
      const v = await visit(requester);
      const [id] = await place(requester, v, [
        line({ targetDepartmentId: med, namedUserIds: [away.userId] }),
      ]);
      expect(await routed(id!)).toEqual([{ recipient_user_id: mo.userId, step: "team", level: 0 }]);
      expect(await skips(id!)).toEqual([{ step: "team", skipped: [away.userId] }]);
    });

    it("an inactive head is skipped and the hospital contacts reached", async () => {
      // Its own hospital: a level-2 contact would change where other tests route.
      const h2 = await hospital(pg, "Contacts");
      const d2 = await department(pg, h2, "Home");
      const target = await department(pg, h2, "Theatre");
      const asker: EmrActor = {
        ...actor(await clinician(pg, { hospitalId: h2, departmentId: d2 }), "MEDICAL_OFFICER", d2),
        hospitalId: h2,
      };
      const head = await staff(pg, { hospitalId: h2, departmentId: d2, state: "suspended" });
      const contact = await clinician(pg, {
        hospitalId: h2,
        departmentId: d2,
        cadre: "CONSULTANT",
      });
      await pg.query(
        `INSERT INTO department_heads (hospital_id, department_id, user_id, acting) VALUES ($1, $2, $3, false)`,
        [h2, target, head.userId],
      );
      await pg.query(
        `INSERT INTO critical_contacts (hospital_id, level, user_id, position) VALUES ($1, 2, $2, 0)`,
        [h2, contact.userId],
      );
      const p = await patient(pg);
      const enc = await encounter(pg, {
        hospitalId: h2,
        patientUserId: p,
        clinicianUserId: asker.userId,
        departmentId: d2,
      });
      const [id] = await place(asker, { p, enc }, [line({ targetDepartmentId: target })]);
      expect(await routed(id!)).toEqual([
        { recipient_user_id: contact.userId, step: "hospital_contacts", level: 0 },
      ]);
      expect(await skips(id!)).toEqual([{ step: "hospital_contacts", skipped: [head.userId] }]);
    });

    it("reaching nobody records its skips on the none row", async () => {
      const empty = await department(pg, h, "Quiet");
      const away = await staff(pg, { hospitalId: h, departmentId: home, state: "suspended" });
      const v = await visit(requester);
      const [id] = await place(requester, v, [
        line({ targetDepartmentId: empty, namedUserIds: [away.userId] }),
      ]);
      expect(await skips(id!)).toEqual([{ step: "none", skipped: [away.userId] }]);
    });
  });
});
