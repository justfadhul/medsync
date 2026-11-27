/**
 * Migration 0306 on the PGlite lane: care_requests and care_request_events. The CHECKs that make a
 * request well formed, append-only rows, and who reads a request through the clinical reader (the
 * requester, a routed recipient, the target department while open, its head), never anyone else.
 * Runs with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Pg } from "./_pglite";
import { beforeAll, describe, expect, it } from "vitest";

import {
  actAs,
  bootLane,
  clinician,
  department,
  encounter,
  hospital,
  laneOn,
  patient,
  probe,
  readMigration,
  staff,
  superadmin,
} from "./_pglite";

describe.skipIf(!laneOn)("0306 — care requests schema", () => {
  let pg: Pg;
  let hA: string;
  let hB: string;
  let requester: string;
  let recipient: string;
  let member: string;
  let nurse: string;
  let doctorB: string;
  let sa: string;
  let p: string;
  let enc: string;
  let target: string;

  async function request(o: { kind?: string; question?: string | null } = {}): Promise<string> {
    const kind = o.kind ?? "consult";
    const r = await pg.query<{ id: string }>(
      `INSERT INTO public.care_requests (hospital_id, patient_user_id, encounter_id, kind, target_department_id,
         urgency, help_wanted, reason_condition_ids, question_ciphertext, requester_user_id, requester_cadre,
         requested_at, placement_id, client_key)
       VALUES ($1, $2, $3, $4, $5, 'routine', CASE WHEN $4 = 'consult' THEN 'advice' END,
         CASE WHEN $4 = 'consult' THEN ARRAY[gen_random_uuid()] ELSE '{}'::uuid[] END, $6, $7, 'MEDICAL_OFFICER',
         now(), gen_random_uuid(), $8)
       RETURNING id`,
      [
        hA,
        p,
        enc,
        kind,
        target,
        o.question === undefined ? "cipher" : o.question,
        requester,
        randomUUID(),
      ],
    );
    return r.rows[0]!.id;
  }

  const event = (requestId: string, cols: Record<string, unknown>) => {
    const names = ["request_id", "hospital_id", ...Object.keys(cols)];
    const values = [requestId, hA, ...Object.values(cols)];
    return pg.query(
      `INSERT INTO public.care_request_events (${names.join(", ")})
       VALUES (${values.map((_, i) => `$${i + 1}`).join(", ")})`,
      values,
    );
  };

  const reads = (userId: string, hospitalId: string, requestId: string) =>
    actAs(
      pg,
      { userId, role: "medsync_clinical_reader", hospitalId },
      async (tx) =>
        (await tx.query(`SELECT id FROM public.care_requests WHERE id = $1`, [requestId])).rows
          .length,
    );

  beforeAll(async () => {
    ({ pg } = await bootLane());
    hA = await hospital(pg, "Requests A");
    hB = await hospital(pg, "Requests B");
    const medicine = await department(pg, hA, "Medicine");
    target = await department(pg, hA, "Surgery");
    const other = await department(pg, hA, "Paediatrics");
    const unrelated = await department(pg, hA, "Obstetrics");
    requester = (await clinician(pg, { hospitalId: hA, departmentId: medicine })).userId;
    recipient = (await clinician(pg, { hospitalId: hA, departmentId: other })).userId;
    member = (await clinician(pg, { hospitalId: hA, departmentId: target })).userId;
    nurse = (await staff(pg, { hospitalId: hA, departmentId: unrelated, cadre: "NURSE" })).userId;
    doctorB = (await clinician(pg, { hospitalId: hB, departmentId: await department(pg, hB) }))
      .userId;
    sa = await superadmin(pg);
    p = await patient(pg);
    enc = await encounter(pg, {
      hospitalId: hA,
      patientUserId: p,
      clinicianUserId: requester,
      departmentId: medicine,
    });
  }, 180_000);

  it("a consult without a question is refused", async () => {
    await expect(request({ question: null })).rejects.toThrow(/care_requests_consult_question/);
    // a review needs none
    await expect(request({ kind: "review", question: null })).resolves.toBeTruthy();
  });

  it("rows are append-only", async () => {
    const id = await request();
    await event(id, { kind: "routed", recipient_user_id: recipient, step: "named" });
    await expect(
      pg.query(`UPDATE public.care_requests SET urgency = 'routine' WHERE id = $1`, [id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      pg.query(`DELETE FROM public.care_request_events WHERE request_id = $1`, [id]),
    ).rejects.toThrow(/append-only/);
  });

  it("a declined event needs a reason code", async () => {
    const id = await request();
    await expect(event(id, { kind: "declined", actor_user_id: member })).rejects.toThrow(
      /care_request_events_reason_check/,
    );
    await expect(
      event(id, { kind: "declined", actor_user_id: member, reason_code: "not_our_specialty" }),
    ).resolves.toBeTruthy();
  });

  it("who reads a request", async () => {
    const open = await request();
    await event(open, { kind: "routed", recipient_user_id: recipient, step: "named" });
    const cancelled = await request();
    await event(cancelled, { kind: "cancelled", actor_user_id: requester, reason_code: "other" });

    expect(await reads(requester, hA, open)).toBe(1);
    expect(await reads(recipient, hA, open)).toBe(1);
    expect(
      await actAs(
        pg,
        { userId: recipient, role: "medsync_clinical_reader", hospitalId: hA },
        async (tx) =>
          (
            await tx.query(`SELECT id FROM public.care_request_events WHERE request_id = $1`, [
              open,
            ])
          ).rows.length,
      ),
    ).toBe(1);
    expect(await reads(member, hA, open)).toBe(1);
    expect(await reads(member, hA, cancelled)).toBe(0);
    expect(await reads(nurse, hA, open)).toBe(0);
    expect(await reads(doctorB, hB, open)).toBe(0);
    expect(await reads(doctorB, hA, open)).toBe(0);
    expect(await reads(sa, hA, open)).toBe(0);

    const asAuthenticated = await probe(
      pg,
      { userId: requester, role: "authenticated", aal: "aal2" },
      `SELECT id FROM public.care_requests WHERE id = $1`,
      [open],
    );
    expect(asAuthenticated.ok ? asAuthenticated.rows.length : 0).toBe(0);
  });

  it("the head of the target department reads it, even once closed", async () => {
    const head = (await clinician(pg, { hospitalId: hA, departmentId: await department(pg, hA) }))
      .userId;
    await pg.query(
      `INSERT INTO public.department_heads (hospital_id, department_id, user_id) VALUES ($1, $2, $3)`,
      [hA, target, head],
    );
    const id = await request();
    await event(id, { kind: "cancelled", actor_user_id: requester, reason_code: "other" });
    expect(await reads(head, hA, id)).toBe(1);
  });

  it("re-runs cleanly", async () => {
    await expect(pg.exec(readMigration("0306_care_requests.sql"))).resolves.toBeTruthy();
  });

  it("clinical_notes takes note_type consult", async () => {
    await expect(
      pg.query(
        `INSERT INTO public.clinical_notes (hospital_id, patient_user_id, encounter_id, note_type, template_id,
           template_version, author_user_id, author_cadre, content_ciphertext, effective_at)
         VALUES ($1, $2, $3, 'consult', 'tpl.consult', '1', $4, 'MEDICAL_OFFICER', 'cipher', now())`,
        [hA, p, enc, member],
      ),
    ).resolves.toBeTruthy();
  });
});
