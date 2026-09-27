/**
 * Encounter completion and administrative closure planning on the PGlite lane
 * (lib/emr/write/encounter.ts). The Edge Function ha-complete-encounter writes; this proves the plan
 * (rules, the three warnings, the body) and that the body's columns pass the 0071 CHECKs when
 * written the way the function writes them. EMR_PGLITE=1.
 */
import type { Lane } from "./_pglite";
import type { EmrActor } from "@/lib/emr/actor";
import type { WriteCtx } from "@/lib/emr/write/context";
import { beforeAll, describe, expect, it } from "vitest";

import { withPatientWrite } from "@/lib/emr/write/context";
import { planAdministrativeClosure, planCompletion } from "@/lib/emr/write/encounter";
import { decrypt, generateKey } from "@/lib/encryption";
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

describe.skipIf(!laneOn)("encounter completion planning (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let dept: string;
  let mo: EmrActor;
  let nurse: EmrActor;
  let reception: EmrActor;
  let elsewhere: EmrActor;

  const as = <T>(a: EmrActor, p: string, fn: (ctx: WriteCtx) => Promise<T>) =>
    withPatientWrite(a, p, fn, { database: lane.db });

  /** The update ha-complete-encounter makes, with the columns the plan's body names. */
  async function applyAsEdge(body: Record<string, unknown>, callerId: string): Promise<void> {
    const administrative = body.closure_kind === "administrative";
    await lane.pg.query(
      `UPDATE public.encounters SET state = 'completed', ended_at = now(), completion_reason = $2, completed_by = $3,
         closure_kind = $4, disposition = $5, follow_up = $6::jsonb, closure_reason = $7, closure_note_ciphertext = $8
       WHERE id = $1 AND state = ANY($9::text[])`,
      [
        body.encounter_id,
        body.completion_reason,
        callerId,
        body.closure_kind,
        body.disposition === "died" ? "deceased" : (body.disposition ?? null),
        body.follow_up ? JSON.stringify(body.follow_up) : null,
        body.closure_reason ?? null,
        body.closure_note_ciphertext ?? null,
        administrative ? ["planned", "in_progress"] : ["in_progress"],
      ],
    );
    await lane.pg.query(
      `INSERT INTO public.encounter_events (encounter_id, kind, label, actor_user_id) VALUES ($1, 'disposition', 'x', $2)`,
      [body.encounter_id, callerId],
    );
  }

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    lane = await bootLane();
    h = await hospital(lane.pg);
    dept = await department(lane.pg, h);
    const h2 = await hospital(lane.pg, "Elsewhere");
    const dept2 = await department(lane.pg, h2);
    mo = await actorOf(lane.pg, "MEDICAL_OFFICER", h, dept);
    nurse = await actorOf(lane.pg, "NURSE", h, dept);
    reception = await actorOf(lane.pg, "RECEPTION", h, dept);
    elsewhere = await actorOf(lane.pg, "MEDICAL_OFFICER", h2, dept2);
  }, 180_000);

  it("completion returns the three warnings (never throws them) and a body the table accepts", async () => {
    const p = await patient(lane.pg);
    const e = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: mo.userId,
    });
    await lane.pg.query(
      `INSERT INTO public.clinical_notes (hospital_id, patient_user_id, encounter_id, note_type, template_id, template_version,
         author_user_id, author_cadre, content_ciphertext, effective_at)
       VALUES ($1, $2, $3, 'clerking', 'tpl.clerking.adult_opd', '1.0.0', $4, 'MEDICAL_OFFICER', 'iv:tag:ct', now())`,
      [h, p, e, mo.userId],
    );
    await lane.pg.query(
      `INSERT INTO public.encounter_orders (encounter_id, patient_user_id, kind, text, authored_by_user_id, lifecycle, hospital_id,
         priority, performer, intent_source, requester_cadre, effective_at, reason_text_ciphertext, test_id)
       VALUES ($1, $2, 'lab', 'mRDT', $3, 'events', $4, 'routine', 'in_house', 'clinician', 'MEDICAL_OFFICER', now(), 'iv:tag:ct',
               (SELECT id FROM public.test_catalogue WHERE kind = 'lab' LIMIT 1))`,
      [e, p, mo.userId, h],
    );
    const plan = await as(mo, p, (ctx) =>
      planCompletion(ctx, {
        patientUserId: p,
        encounterId: e,
        disposition: "died",
        followUp: { kind: "none" },
      }),
    );
    expect(plan.warnings).toHaveLength(3);
    expect(plan.warnings.join(" ")).toMatch(/not signed.*No diagnosis.*no specimen/s);
    expect(plan.body).toMatchObject({
      encounter_id: e,
      closure_kind: "clinical",
      disposition: "died",
    });

    await applyAsEdge(plan.body, mo.userId);
    const row = (
      await lane.pg.query(
        `SELECT state, disposition, closure_kind, completed_by FROM public.encounters WHERE id = $1`,
        [e],
      )
    ).rows[0]!;
    // Died is stored as the existing 'deceased' (ADR 0115).
    expect(row).toEqual({
      state: "completed",
      disposition: "deceased",
      closure_kind: "clinical",
      completed_by: mo.userId,
    });

    await expect(
      as(mo, p, (ctx) =>
        planCompletion(ctx, { patientUserId: p, encounterId: e, disposition: "home" }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" }); // closed: no active basis left for this patient
  });

  it("a reviewer's draft is not the owner's unsigned note (only its author can sign it)", async () => {
    const p = await patient(lane.pg);
    const e = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: mo.userId,
    });
    const senior = await actorOf(lane.pg, "MEDICAL_OFFICER", h, dept);
    await lane.pg.query(
      `INSERT INTO public.clinical_notes (hospital_id, patient_user_id, encounter_id, note_type, template_id, template_version,
         author_user_id, author_cadre, content_ciphertext, effective_at)
       VALUES ($1, $2, $3, 'clerking', 'tpl.clerking.adult_opd', '1.0.0', $4, 'MEDICAL_OFFICER', 'iv:tag:ct', now())`,
      [h, p, e, senior.userId],
    );
    const plan = await as(mo, p, (ctx) =>
      planCompletion(ctx, { patientUserId: p, encounterId: e, disposition: "home" }),
    );
    expect(plan.warnings.join(" ")).not.toMatch(/not signed/);
  });

  it("refuses a closed encounter, a missing review date, a nurse, reception and another hospital", async () => {
    const p = await patient(lane.pg);
    await intake(lane.pg, { hospitalId: h, patientUserId: p });
    const e = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: mo.userId,
    });
    const done = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: mo.userId,
      state: "completed",
    });
    const plan = (a: EmrActor, extra: Partial<Parameters<typeof planCompletion>[1]> = {}) =>
      as(a, p, (ctx) =>
        planCompletion(ctx, { patientUserId: p, encounterId: e, disposition: "home", ...extra }),
      );
    await expect(plan(mo, { encounterId: done })).rejects.toMatchObject({ code: "conflict" });
    await expect(plan(mo, { followUp: { kind: "review_date", date: "" } })).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(plan(nurse)).rejects.toMatchObject({ code: "forbidden" });
    await expect(plan(reception)).rejects.toMatchObject({ code: "forbidden" });
    await expect(plan(elsewhere)).rejects.toMatchObject({ code: "forbidden" });
    expect(
      (await plan(mo, { followUp: { kind: "review_date", date: "2026-10-03" } })).warnings,
    ).toEqual(["No diagnosis is recorded for this visit."]);
  });

  it("administrative closure needs a reason (a note for 'other'), closes a planned encounter, never by itself", async () => {
    const p = await patient(lane.pg);
    await intake(lane.pg, { hospitalId: h, patientUserId: p });
    const e = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: mo.userId,
      state: "planned",
    });
    const close = (reason: "other" | "left_before_seen", note?: string) =>
      as(mo, p, (ctx) =>
        planAdministrativeClosure(ctx, { patientUserId: p, encounterId: e, reason, note }),
      );
    await expect(close("other")).rejects.toMatchObject({ code: "invalid" });
    const plan = await close("other", "Registered twice at the desk");
    expect(plan.body).toMatchObject({ closure_kind: "administrative", closure_reason: "other" });
    expect(decrypt(String(plan.body.closure_note_ciphertext))).toBe("Registered twice at the desk");
    await applyAsEdge(plan.body, mo.userId);
    const row = (
      await lane.pg.query(
        `SELECT state, closure_kind, closure_reason FROM public.encounters WHERE id = $1`,
        [e],
      )
    ).rows[0]!;
    expect(row).toEqual({
      state: "completed",
      closure_kind: "administrative",
      closure_reason: "other",
    });
    await expect(close("left_before_seen")).rejects.toMatchObject({ code: "conflict" });
  });
});
