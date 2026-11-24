/**
 * Routing resolves posts to holders (ADR 0534, Task 19) on the PGlite lane: with DUTY_ROTA on, the holder in
 * post at the request time wins over the team list and the routed rows record the post. A review takes senior
 * holders only (R7), leave takes a holder out of post, an inactive holder is skipped and recorded (R25), and
 * a rota read failure falls through to the team list. Flag off, Phase 1 routing is unchanged. Runs with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane, Pg } from "./_pglite";
import type { PlanRequestLine } from "@/lib/clerking/plan/draft";
import type { EmrActor } from "@/lib/emr/actor";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { withPatientWrite } from "@/lib/emr/write/context";
import { placeRequests } from "@/lib/emr/write/requests";
import { generateKey } from "@/lib/encryption";
import {
  authUser,
  bootLane,
  clinician,
  department,
  encounter,
  hospital,
  laneOn,
  patient,
} from "./_pglite";

const HOUR = 3_600_000;

describe.skipIf(!laneOn)("routing to post holders (PGlite lane)", () => {
  let lane: Lane;
  let pg: Pg;
  let h: string;
  let home: string;
  let admin: string;
  let requester: EmrActor;

  const actor = (s: { userId: string; affiliationId: string }, cadreCode: string): EmrActor => ({
    userId: s.userId,
    affiliationId: s.affiliationId,
    fullName: null,
    hospitalId: h,
    departmentId: home,
    cadreCode,
    isClinical: true,
    surface: "doctor",
  });

  async function post(o: {
    departmentId: string;
    level: string;
    cadres: string[];
    takesConsults?: boolean;
    wardId?: string;
  }): Promise<string> {
    const r = await pg.query<{ id: string }>(
      `INSERT INTO public.duty_posts (hospital_id, department_id, ward_id, scope_kind, name, level,
         eligible_cadres, takes_consults, created_by)
       VALUES ($1, $2, $3, $4, 'On call', $5, $6, $7, $8) RETURNING id`,
      [
        h,
        o.departmentId,
        o.wardId ?? null,
        o.wardId ? "ward" : "department",
        o.level,
        o.cadres,
        o.takesConsults ?? false,
        admin,
      ],
    );
    return r.rows[0]!.id;
  }

  /** On duty from an hour ago to eight hours from now (the request is placed now). */
  const assign = (postId: string, userId: string, fromH = -1, toH = 8) =>
    pg.query(
      `INSERT INTO public.duty_assignments (hospital_id, post_id, user_id, starts_at, ends_at, kind, created_by)
       VALUES ($1, $2, $3, $4, $5, 'rostered', $6)`,
      [
        h,
        postId,
        userId,
        new Date(Date.now() + fromH * HOUR),
        new Date(Date.now() + toH * HOUR),
        admin,
      ],
    );

  const visit = async () => {
    const p = await patient(pg);
    const enc = await encounter(pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: requester.userId,
      departmentId: home,
    });
    return { p, enc };
  };

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

  /** A consult needs a reason on the problem list (0306's CHECK). */
  async function problem(p: string, enc: string): Promise<string> {
    const id = randomUUID();
    await pg.query(
      `INSERT INTO public.conditions (id, logical_id, hospital_id, patient_user_id, encounter_id, effective_at,
         recorded_by_user_id, source, trust, category, text_ciphertext, clinical_status, verification, asserted_by,
         sensitivity, rank)
       VALUES ($1, $1, $2, $3, $4, now(), $5, 'clinician', 3, 'encounter_diagnosis', 'iv:tag:ct', 'active',
         'confirmed', 'clinician', 'standard', 'secondary')`,
      [id, h, p, enc, requester.userId],
    );
    return id;
  }

  async function place(o: Partial<PlanRequestLine>): Promise<string> {
    const v = await visit();
    if (o.kind === "consult") o = { ...o, reasonConditionIds: [await problem(v.p, v.enc)] };
    const [id] = await withPatientWrite(
      requester,
      v.p,
      (ctx) =>
        placeRequests(ctx, {
          patientUserId: v.p,
          encounterId: v.enc,
          placementId: randomUUID(),
          lines: [line(o)],
        }),
      { database: lane.db },
    );
    return id!;
  }

  const consult = (departmentId: string) =>
    place({
      kind: "consult",
      targetDepartmentId: departmentId,
      helpWanted: "advice",
      question: "Synthetic question",
    });

  const routed = async (requestId: string) =>
    (
      await pg.query<{
        recipient_user_id: string | null;
        step: string;
        post_id: string | null;
        skipped_user_ids: string[];
      }>(
        `SELECT recipient_user_id, step, post_id, skipped_user_ids FROM care_request_events
          WHERE request_id = $1 AND kind = 'routed' ORDER BY recipient_user_id`,
        [requestId],
      )
    ).rows;

  /** A department with a medical officer and a consultant on its team list. */
  async function team(name: string) {
    const d = await department(pg, h, name);
    const mo = (await clinician(pg, { hospitalId: h, departmentId: d })).userId;
    const cons = (await clinician(pg, { hospitalId: h, departmentId: d, cadre: "CONSULTANT" }))
      .userId;
    return { d, mo, cons };
  }

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    lane = await bootLane();
    pg = lane.pg;
    h = await hospital(pg, "Rota routing");
    home = await department(pg, h, "Home");
    admin = await authUser(pg, "admin");
    await pg.query(
      `INSERT INTO public.user_roles (user_id, role, hospital_id) VALUES ($1, 'hospital_admin', $2)`,
      [admin, h],
    );
    requester = actor(
      await clinician(pg, { hospitalId: h, departmentId: home }),
      "MEDICAL_OFFICER",
    );
  }, 180_000);

  afterEach(() => {
    delete process.env.DUTY_ROTA;
  });

  it("a consult goes to the takes-consults post holder, not the whole team", async () => {
    process.env.DUTY_ROTA = "1";
    const t = await team("Nephrology");
    const p = await post({
      departmentId: t.d,
      level: "senior",
      cadres: ["MEDICAL_OFFICER"],
      takesConsults: true,
    });
    await assign(p, t.mo);
    expect(await routed(await consult(t.d))).toEqual([
      { recipient_user_id: t.mo, step: "post", post_id: p, skipped_user_ids: [] },
    ]);
  });

  it("a review goes to the ward's senior post holder", async () => {
    process.env.DUTY_ROTA = "1";
    const t = await team("Medicine");
    const ward = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.hospital_wards (hospital_id, department_id, name, slug) VALUES ($1, $2, 'Ward 9', $3)
         RETURNING id`,
        [h, t.d, `ward-${randomUUID().slice(0, 8)}`],
      )
    ).rows[0]!.id;
    const p = await post({
      departmentId: t.d,
      wardId: ward,
      level: "consultant",
      cadres: ["CONSULTANT"],
    });
    await assign(p, t.cons);
    expect(await routed(await place({ targetDepartmentId: t.d, wardId: ward }))).toEqual([
      { recipient_user_id: t.cons, step: "post", post_id: p, skipped_user_ids: [] },
    ]);
  });

  it("a review skips a junior holder and uses the senior team list (R7)", async () => {
    process.env.DUTY_ROTA = "1";
    const t = await team("Surgery");
    const intern = (
      await clinician(pg, { hospitalId: h, departmentId: t.d, cadre: "INTERN_DOCTOR" })
    ).userId;
    const p = await post({
      departmentId: t.d,
      level: "senior",
      cadres: ["INTERN_DOCTOR"],
      takesConsults: true,
    });
    await assign(p, intern);
    const rows = await routed(await place({ targetDepartmentId: t.d }));
    expect(rows.every((r) => r.step === "team" && r.post_id === null)).toBe(true);
    expect(rows.map((r) => r.recipient_user_id).sort()).toEqual([t.mo, t.cons].sort());
  });

  it("nobody in post falls back to the team list", async () => {
    process.env.DUTY_ROTA = "1";
    const t = await team("Paediatrics");
    const p = await post({
      departmentId: t.d,
      level: "senior",
      cadres: ["MEDICAL_OFFICER"],
      takesConsults: true,
    });
    await assign(p, t.mo, 2, 10); // a later duty, not now
    const rows = await routed(await consult(t.d));
    expect(rows.every((r) => r.step === "team")).toBe(true);
    expect(rows.map((r) => r.recipient_user_id).sort()).toEqual([t.mo, t.cons].sort());
  });

  it("a holder on leave is skipped and the team list is used", async () => {
    process.env.DUTY_ROTA = "1";
    const t = await team("Obstetrics");
    const p = await post({
      departmentId: t.d,
      level: "senior",
      cadres: ["MEDICAL_OFFICER"],
      takesConsults: true,
    });
    await assign(p, t.mo);
    await pg.query(
      `INSERT INTO public.availability_blocks (hospital_id, clinician_user_id, kind, starts_at, ends_at, state)
       VALUES ($1, $2, 'leave', $3, $4, 'active')`,
      [h, t.mo, new Date(Date.now() - HOUR), new Date(Date.now() + HOUR)],
    );
    const rows = await routed(await consult(t.d));
    expect(rows.every((r) => r.step === "team")).toBe(true);
  });

  it("an inactive holder is skipped and the skip recorded (R25)", async () => {
    process.env.DUTY_ROTA = "1";
    const t = await team("Cardiology");
    const p = await post({
      departmentId: t.d,
      level: "senior",
      cadres: ["MEDICAL_OFFICER"],
      takesConsults: true,
    });
    await assign(p, t.mo);
    await pg.query(`UPDATE public.staff_affiliations SET state = 'suspended' WHERE user_id = $1`, [
      t.mo,
    ]);
    expect(await routed(await consult(t.d))).toEqual([
      { recipient_user_id: t.cons, step: "team", post_id: null, skipped_user_ids: [t.mo] },
    ]);
  });

  it("a rota read failure falls through to the team list", async () => {
    process.env.DUTY_ROTA = "1";
    const t = await team("Neurology");
    await pg.exec(`ALTER TABLE public.duty_posts RENAME TO duty_posts_gone`);
    try {
      const rows = await routed(await consult(t.d));
      expect(rows.every((r) => r.step === "team")).toBe(true);
      expect(rows).toHaveLength(2);
    } finally {
      await pg.exec(`ALTER TABLE public.duty_posts_gone RENAME TO duty_posts`);
    }
  });

  it("flag off routes as Phase 1", async () => {
    const t = await team("Dermatology");
    const p = await post({
      departmentId: t.d,
      level: "senior",
      cadres: ["MEDICAL_OFFICER"],
      takesConsults: true,
    });
    await assign(p, t.mo);
    const rows = await routed(await consult(t.d));
    expect(rows.every((r) => r.step === "team" && r.post_id === null)).toBe(true);
    expect(rows.map((r) => r.recipient_user_id).sort()).toEqual([t.mo, t.cons].sort());
  });
});
