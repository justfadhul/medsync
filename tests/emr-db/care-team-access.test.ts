/**
 * Migration 0306 section 5 on the PGlite lane: the `care_team` access basis. A clinician a request was
 * routed to, or who accepted it, may open the patient's chart while the request is open and for 30 days
 * after the reply; a cancel ends it at once. Both bodies of the rule must agree (the set form backs RLS).
 * Runs with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane, Pg } from "./_pglite";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { clinicalPhiAccessLog } from "@/db/schema";
import { logChartAccess, resolveEmrAccess } from "@/lib/emr/access";
import { asClinicalWriter } from "@/lib/emr/db";
import {
  actAs,
  bootLane,
  clinician,
  department,
  encounter,
  hospital,
  laneOn,
  patient,
  readMigration,
} from "./_pglite";

describe.skipIf(!laneOn)("0306 — care_team access basis", () => {
  let lane: Lane;
  let pg: Pg;
  let hA: string;
  let hB: string;
  let medicine: string;
  let target: string;
  let requester: string;
  let recipient: string;
  let recipient2: string;
  let newRecipient: string;
  let cardiology: string;
  let member: string;
  let unrelated: string;
  let doctorB: string;

  const basis = async (user: string, p: string, h: string) =>
    (
      await pg.query<{ b: string | null }>(`SELECT private.patient_access_basis($1, $2, $3) AS b`, [
        user,
        p,
        h,
      ])
    ).rows[0]!.b;

  const inSet = (user: string, h: string, p: string) =>
    actAs(pg, { userId: user, role: "medsync_clinical_reader", hospitalId: h }, async (tx) =>
      (await tx.query<{ id: string }>(`SELECT private.accessible_patient_ids() AS id`)).rows.some(
        (r) => r.id === p,
      ),
    );

  const event = (requestId: string, cols: Record<string, unknown>) => {
    const names = ["request_id", "hospital_id", ...Object.keys(cols)];
    const values = [requestId, hA, ...Object.values(cols)];
    return pg.query(
      `INSERT INTO public.care_request_events (${names.join(", ")})
       VALUES (${values.map((_, i) => `$${i + 1}`).join(", ")})`,
      values,
    );
  };

  /** A new patient seen by the requester in Medicine, and a consult to Surgery routed to `recipient`
   *  (or, with `phoned`, phoned to that user at placement and routed to nobody). */
  async function routedRequest(
    o: { phoned?: string } = {},
  ): Promise<{ p: string; enc: string; id: string }> {
    const p = await patient(pg);
    const enc = await encounter(pg, {
      hospitalId: hA,
      patientUserId: p,
      clinicianUserId: requester,
      departmentId: medicine,
      state: "completed",
    });
    const id = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.care_requests (hospital_id, patient_user_id, encounter_id, kind, target_department_id,
           urgency, help_wanted, reason_condition_ids, question_ciphertext, requester_user_id, requester_cadre,
           requested_at, placement_id, client_key, phoned_user_id, phoned_at)
         VALUES ($1, $2, $3, 'consult', $4, 'routine', 'advice', ARRAY[gen_random_uuid()], 'cipher', $5,
           'MEDICAL_OFFICER', now(), gen_random_uuid(), $6, $7::uuid, CASE WHEN $7::uuid IS NOT NULL THEN now() END)
         RETURNING id`,
        [hA, p, enc, target, requester, randomUUID(), o.phoned ?? null],
      )
    ).rows[0]!.id;
    if (!o.phoned) await event(id, { kind: "routed", recipient_user_id: recipient, step: "named" });
    return { p, enc, id };
  }

  async function reply(r: { p: string; enc: string; id: string }, daysAgo: number) {
    const note = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.clinical_notes (hospital_id, patient_user_id, encounter_id, note_type, template_id,
           template_version, author_user_id, author_cadre, content_ciphertext, effective_at)
         VALUES ($1, $2, $3, 'consult', 'tpl.consult', '1', $4, 'MEDICAL_OFFICER', 'cipher', now())
         RETURNING id`,
        [hA, r.p, r.enc, recipient],
      )
    ).rows[0]!.id;
    // Inserted with the old `at` directly: the append-only trigger forbids moving it later.
    await event(r.id, {
      kind: "replied",
      actor_user_id: recipient,
      note_id: note,
      at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    });
  }

  beforeAll(async () => {
    lane = await bootLane();
    pg = lane.pg;
    hA = await hospital(pg, "Care team A");
    hB = await hospital(pg, "Care team B");
    medicine = await department(pg, hA, "Medicine");
    target = await department(pg, hA, "Surgery");
    const paeds = await department(pg, hA, "Paediatrics");
    const obstetrics = await department(pg, hA, "Obstetrics");
    requester = (await clinician(pg, { hospitalId: hA, departmentId: medicine })).userId;
    recipient = (await clinician(pg, { hospitalId: hA, departmentId: paeds })).userId;
    recipient2 = (await clinician(pg, { hospitalId: hA, departmentId: paeds })).userId;
    cardiology = await department(pg, hA, "Cardiology");
    newRecipient = (await clinician(pg, { hospitalId: hA, departmentId: cardiology })).userId;
    member = (await clinician(pg, { hospitalId: hA, departmentId: target })).userId;
    unrelated = (await clinician(pg, { hospitalId: hA, departmentId: obstetrics })).userId;
    doctorB = (await clinician(pg, { hospitalId: hB, departmentId: await department(pg, hB) }))
      .userId;
  }, 180_000);

  it("a routed recipient in another department has care_team access", async () => {
    const { p } = await routedRequest();
    expect(await basis(recipient, p, hA)).toBe("care_team");
    expect(await inSet(recipient, hA, p)).toBe(true);
  });

  it("an accepter has it; a target-department member who did not accept has none", async () => {
    const { p, id } = await routedRequest();
    expect(await basis(member, p, hA)).toBeNull();
    expect(await inSet(member, hA, p)).toBe(false);
    await event(id, { kind: "accepted", actor_user_id: member });
    expect(await basis(member, p, hA)).toBe("care_team");
    expect(await inSet(member, hA, p)).toBe(true);
  });

  it("access lasts 30 days after the reply, then ends", async () => {
    const recent = await routedRequest();
    await reply(recent, 29);
    expect(await basis(recipient, recent.p, hA)).toBe("care_team");
    expect(await inSet(recipient, hA, recent.p)).toBe(true);

    const old = await routedRequest();
    await reply(old, 31);
    expect(await basis(recipient, old.p, hA)).toBeNull();
    expect(await inSet(recipient, hA, old.p)).toBe(false);
  });

  it("cancelled ends access at once", async () => {
    const r = await routedRequest();
    expect(await basis(recipient, r.p, hA)).toBe("care_team");
    await event(r.id, { kind: "cancelled", actor_user_id: requester, reason_code: "not_needed" });
    expect(await basis(recipient, r.p, hA)).toBeNull();
    expect(await inSet(recipient, hA, r.p)).toBe(false);
  });

  it("cancelled after a reply ends it too", async () => {
    const r = await routedRequest();
    await reply(r, 1);
    await event(r.id, { kind: "cancelled", actor_user_id: requester, reason_code: "not_needed" });
    expect(await basis(recipient, r.p, hA)).toBeNull();
  });

  it("closed without a reply ends access", async () => {
    const r = await routedRequest();
    await event(r.id, { kind: "closed", actor_user_id: requester });
    expect(await basis(recipient, r.p, hA)).toBeNull();
    expect(await inSet(recipient, hA, r.p)).toBe(false);
  });

  it("a decliner loses it; another current-round recipient keeps it", async () => {
    const r = await routedRequest();
    await event(r.id, { kind: "routed", recipient_user_id: recipient2, step: "named" });
    await event(r.id, { kind: "declined", actor_user_id: recipient, reason_code: "busy" });
    expect(await basis(recipient, r.p, hA)).toBeNull();
    expect(await inSet(recipient, hA, r.p)).toBe(false);
    expect(await basis(recipient2, r.p, hA)).toBe("care_team");
    expect(await inSet(recipient2, hA, r.p)).toBe(true);
  });

  it("a redirect moves access to the new round; an earlier accepter keeps it", async () => {
    const p = await patient(pg);
    const enc = await encounter(pg, {
      hospitalId: hA,
      patientUserId: p,
      clinicianUserId: requester,
      departmentId: medicine,
      state: "completed",
    });
    const id = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.care_requests (hospital_id, patient_user_id, encounter_id, kind, target_department_id,
           urgency, help_wanted, reason_condition_ids, question_ciphertext, requester_user_id, requester_cadre,
           requested_at, placement_id, client_key)
         VALUES ($1, $2, $3, 'consult', $4, 'routine', 'advice', ARRAY[gen_random_uuid()], 'cipher', $5,
           'MEDICAL_OFFICER', now() - interval '4 hours', gen_random_uuid(), $6)
         RETURNING id`,
        [hA, p, enc, target, requester, randomUUID()],
      )
    ).rows[0]!.id;
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    const redirectAt = ago(120);
    await event(id, { kind: "routed", recipient_user_id: recipient, step: "named", at: ago(180) });
    await event(id, { kind: "accepted", actor_user_id: member, at: ago(150) });
    await event(id, {
      kind: "redirected",
      actor_user_id: member,
      reason_code: "wrong_team",
      redirect_department_id: cardiology,
      at: redirectAt,
    });
    // Written with the redirect in one transaction: the same `at`, and still the new round.
    await event(id, {
      kind: "routed",
      recipient_user_id: recipient2,
      step: "team",
      at: redirectAt,
    });
    await event(id, { kind: "routed", recipient_user_id: newRecipient, step: "team", at: ago(60) });

    expect(await basis(recipient, p, hA)).toBeNull();
    expect(await inSet(recipient, hA, p)).toBe(false);
    expect(await basis(member, p, hA)).toBe("care_team");
    expect(await basis(recipient2, p, hA)).toBe("care_team");
    expect(await basis(newRecipient, p, hA)).toBe("care_team");
    expect(await inSet(newRecipient, hA, p)).toBe(true);
  });

  it("the phoned consultant has it without being routed; a cancel ends it", async () => {
    const r = await routedRequest({ phoned: newRecipient });
    expect(await basis(newRecipient, r.p, hA)).toBe("care_team");
    expect(await inSet(newRecipient, hA, r.p)).toBe(true);
    expect(await basis(recipient, r.p, hA)).toBeNull();
    await event(r.id, { kind: "cancelled", actor_user_id: requester, reason_code: "not_needed" });
    expect(await basis(newRecipient, r.p, hA)).toBeNull();
    expect(await inSet(newRecipient, hA, r.p)).toBe(false);
  });

  it("an unrelated clinician has none", async () => {
    const { p } = await routedRequest();
    expect(await basis(unrelated, p, hA)).toBeNull();
    expect(await inSet(unrelated, hA, p)).toBe(false);
  });

  it("another hospital gets nothing, even when routed", async () => {
    const r = await routedRequest();
    await event(r.id, { kind: "routed", recipient_user_id: doctorB, step: "named" });
    expect(await basis(doctorB, r.p, hA)).toBeNull(); // no clinical affiliation at A
    expect(await basis(doctorB, r.p, hB)).toBeNull(); // the request is A's
    expect(await inSet(doctorB, hB, r.p)).toBe(false);
    expect(await basis(recipient, r.p, hB)).toBeNull();
  });

  it("a suspended recipient loses it", async () => {
    const { p } = await routedRequest();
    await pg.query(`UPDATE public.staff_affiliations SET state = 'suspended' WHERE user_id = $1`, [
      recipient,
    ]);
    expect(await basis(recipient, p, hA)).toBeNull();
    expect(await inSet(recipient, hA, p)).toBe(false);
    await pg.query(`UPDATE public.staff_affiliations SET state = 'active' WHERE user_id = $1`, [
      recipient,
    ]);
  });

  it("the two bodies agree", async () => {
    const open = await routedRequest();
    const cancelled = await routedRequest();
    await event(cancelled.id, {
      kind: "cancelled",
      actor_user_id: requester,
      reason_code: "not_needed",
    });
    const accepted = await routedRequest();
    await event(accepted.id, { kind: "accepted", actor_user_id: member });
    const declined = await routedRequest();
    await event(declined.id, { kind: "declined", actor_user_id: recipient, reason_code: "busy" });
    const phoned = await routedRequest({ phoned: member });
    for (const user of [recipient, member, unrelated, doctorB])
      for (const p of [open.p, cancelled.p, accepted.p, declined.p, phoned.p])
        expect(
          { user, p, granted: (await basis(user, p, hA)) !== null },
          `basis vs set for ${user} / ${p}`,
        ).toEqual({ user, p, granted: await inSet(user, hA, p) });
  });

  it("the chart open is logged as care_team", async () => {
    const { p } = await routedRequest();
    const scope = { userId: recipient, hospitalId: hA };
    await asClinicalWriter(
      scope,
      async (tx) => {
        const access = await resolveEmrAccess(tx, { ...scope, patientUserId: p });
        expect(access).toEqual({ allowed: true, basis: "care_team" });
        await logChartAccess(tx, {
          ...scope,
          patientUserId: p,
          basis: access.basis!,
          surface: "emr_chart",
        });
      },
      lane.db,
    );
    const logged = await lane.db
      .select({ basis: clinicalPhiAccessLog.accessBasis })
      .from(clinicalPhiAccessLog)
      .where(
        and(
          eq(clinicalPhiAccessLog.clinicianUserId, recipient),
          eq(clinicalPhiAccessLog.patientUserId, p),
        ),
      );
    expect(logged).toEqual([{ basis: "care_team" }]);
  });

  it("the migration re-runs cleanly", async () => {
    await expect(pg.exec(readMigration("0306_care_requests.sql"))).resolves.toBeTruthy();
    const { p } = await routedRequest();
    expect(await basis(recipient, p, hA)).toBe("care_team");
  });
});
