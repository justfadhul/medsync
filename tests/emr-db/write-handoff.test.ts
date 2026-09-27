/**
 * consumeResusHandoff on the PGlite lane (lib/emr/write/handoff.ts): one transaction creates or links
 * the encounter, writes the signed ISBAR handover note authored by the resus leader, and clears
 * pending_encounter_handoff; a second call changes nothing. EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane } from "./_pglite";
import type { EmrActor } from "@/lib/emr/actor";
import { beforeAll, describe, expect, it } from "vitest";

import { deriveOrderStatus } from "@/lib/emr/orders";
import { withPatientWrite } from "@/lib/emr/write/context";
import { consumeResusHandoff, HANDOVER_REASON } from "@/lib/emr/write/handoff";
import { acceptSuggestedOrder, dismissSuggestedOrder } from "@/lib/emr/write/intents";
import { saveNoteDraft } from "@/lib/emr/write/notes";
import { loadOrderRecords } from "@/lib/emr/write/orders";
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

const HMAC_KEY = Buffer.alloc(32, 9).toString("base64");
// Default-menu tests (0072 seeds); ids only, no clinical values.
const TROPONIN = "85bce91e-1271-53d4-a176-bc4a95172f45";
const LACTATE = "0f3fe0a8-5ada-56d2-a9dc-d1314609d1b4";
const CHEST_XRAY = "6b303538-8f18-5044-8131-66a1db67bc3e";

describe.skipIf(!laneOn)("resus → encounter handoff (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let dept: string;
  let nurse: EmrActor;
  let leaderId: string;

  const consume = (p: string, episodeId: string) =>
    withPatientWrite(nurse, p, (ctx) => consumeResusHandoff(ctx, { patientUserId: p, episodeId }), {
      database: lane.db,
    });

  async function episode(
    p: string | null,
    state: "active" | "concluded" = "concluded",
    recommendation = "Repeat glucose hourly.",
    outstandingTests?: unknown,
  ): Promise<string> {
    const ep = (
      await lane.pg.query<{ id: string }>(
        `INSERT INTO public.resus_episodes (hospital_id, department_id, patient_user_id, trigger_kind, state, opened_by_user_id,
           outcome_code, closure_kind, ended_at, pending_encounter_handoff)
         VALUES ($1, $2, $3, 'triage_red', $4, $5, CASE WHEN $4 = 'concluded' THEN 'stabilised' END,
                 CASE WHEN $4 = 'concluded' THEN 'bedside' END, CASE WHEN $4 = 'concluded' THEN now() END, $4 = 'concluded')
         RETURNING id`,
        [h, dept, p, state, nurse.userId],
      )
    ).rows[0]!.id;
    await lane.pg.query(
      `INSERT INTO public.resus_role_assignments (episode_id, user_id, role) VALUES ($1, $2, 'leader')`,
      [ep, leaderId],
    );
    await lane.pg.query(
      `INSERT INTO public.resus_timeline_events (episode_id, kind, step, recorded_by_user_id, payload)
       VALUES ($1, 'handover', 'post', $2, $3::jsonb)`,
      [
        ep,
        leaderId,
        JSON.stringify({
          sbar: {
            situation: "Stabilised after fluids.",
            background: "Known diabetic.",
            assessment: "Airway patent, perfusing.",
            recommendation,
          },
          receiving: { unit: "Medical ward", cadre: "MEDICAL_OFFICER" },
          ...(outstandingTests === undefined ? {} : { outstandingTests }),
        }),
      ],
    );
    return ep;
  }

  let mo: EmrActor;

  const proposals = (encounterId: string) =>
    lane.pg
      .query<{
        id: string;
        test_id: string;
        lifecycle: string;
        intent_source: string;
        source_intent_id: string;
        authored_by_user_id: string;
        requester_cadre: string;
        priority: string;
        reason_text_ciphertext: string;
      }>(
        `SELECT id, test_id, lifecycle, intent_source, source_intent_id, authored_by_user_id, requester_cadre,
                priority, reason_text_ciphertext
           FROM public.encounter_orders WHERE encounter_id = $1 ORDER BY source_intent_id`,
        [encounterId],
      )
      .then((r) => r.rows);
  const stateOf = async (orderId: string) => {
    const [o] = (
      await lane.pg.query<{ id: string; lifecycle: string; status: string; kind: string }>(
        `SELECT id, lifecycle, status, kind FROM public.encounter_orders WHERE id = $1`,
        [orderId],
      )
    ).rows;
    const records = await lane.db.transaction((tx) => loadOrderRecords(tx as never, [orderId]));
    return deriveOrderStatus(o!, records).status.state;
  };
  const as = <T>(a: EmrActor, p: string, fn: Parameters<typeof withPatientWrite<T>>[2]) =>
    withPatientWrite(a, p, fn, { database: lane.db });

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    process.env.MEDSYNC_NOTE_HMAC_KEY ??= HMAC_KEY;
    lane = await bootLane();
    h = await hospital(lane.pg);
    dept = await department(lane.pg, h);
    const n = await staff(lane.pg, { hospitalId: h, departmentId: dept, cadre: "NURSE" });
    nurse = {
      userId: n.userId,
      fullName: null,
      hospitalId: h,
      departmentId: dept,
      affiliationId: n.affiliationId,
      cadreCode: "NURSE",
      isClinical: true,
      surface: "nurse",
    };
    leaderId = (
      await staff(lane.pg, { hospitalId: h, departmentId: dept, cadre: "MEDICAL_OFFICER" })
    ).userId;
    const m = await staff(lane.pg, { hospitalId: h, departmentId: dept, cadre: "MEDICAL_OFFICER" });
    mo = {
      ...nurse,
      userId: m.userId,
      affiliationId: m.affiliationId,
      cadreCode: "MEDICAL_OFFICER",
    };
  }, 180_000);

  it("creates the encounter, writes the ISBAR note as the leader, clears the flag; idempotent", async () => {
    const p = await patient(lane.pg);
    await intake(lane.pg, { hospitalId: h, patientUserId: p });
    const ep = await episode(p);
    const r = await consume(p, ep);

    const note = (
      await lane.pg.query(
        `SELECT note_type, template_id, state, author_user_id, author_cadre, encounter_id, content_ciphertext
           FROM public.clinical_notes WHERE id = $1`,
        [r.id],
      )
    ).rows[0]!;
    expect(note).toMatchObject({
      note_type: "handover",
      template_id: "tpl.handover.isbar",
      state: "signed",
      author_user_id: leaderId,
      author_cadre: "MEDICAL_OFFICER",
      encounter_id: r.encounterId,
    });
    const content = JSON.parse(decrypt(String(note.content_ciphertext)));
    expect(content.sections.s02.narrative).toBe("Stabilised after fluids.");
    expect(content.sections.s05.items[0]).toMatchObject({
      kind: "tasks",
      text: "Repeat glucose hourly.",
    });
    expect(content.sections.s01.items[0]).toMatchObject({ kind: "identify", resusEpisodeId: ep });

    const e = (
      await lane.pg.query(`SELECT state, encounter_type FROM public.encounters WHERE id = $1`, [
        r.encounterId,
      ])
    ).rows[0]!;
    expect(e).toEqual({ state: "in_progress", encounter_type: "emergency" });
    const epRow = (
      await lane.pg.query(
        `SELECT pending_encounter_handoff, encounter_id FROM public.resus_episodes WHERE id = $1`,
        [ep],
      )
    ).rows[0]!;
    expect(epRow).toEqual({ pending_encounter_handoff: false, encounter_id: r.encounterId });

    expect(await consume(p, ep)).toEqual(r);
    const n = (
      await lane.pg.query(
        `SELECT count(*)::int n FROM public.encounters WHERE patient_user_id = $1`,
        [p],
      )
    ).rows[0]!.n;
    expect(n).toBe(1);
  });

  it("links the patient's open encounter instead of opening a second", async () => {
    const p = await patient(lane.pg);
    await intake(lane.pg, { hospitalId: h, patientUserId: p });
    const open = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: leaderId,
      state: "planned",
    });
    const r = await consume(p, await episode(p));
    expect(r.encounterId).toBe(open);
  });

  it("refuses a running resus and an unidentified patient", async () => {
    const p = await patient(lane.pg);
    await intake(lane.pg, { hospitalId: h, patientUserId: p });
    await expect(consume(p, await episode(p, "active"))).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(consume(p, await episode(null))).rejects.toMatchObject({ code: "invalid" });
    // The access check ran for p: another patient's episode is refused.
    const other = await patient(lane.pg);
    await expect(consume(p, await episode(other))).rejects.toMatchObject({ code: "forbidden" });
  });

  it("an empty recommendation is written as not recorded, never as 'none'", async () => {
    const p = await patient(lane.pg);
    await intake(lane.pg, { hospitalId: h, patientUserId: p });
    const r = await consume(p, await episode(p, "concluded", ""));
    const [row] = (
      await lane.pg.query<{ c: string }>(
        `SELECT content_ciphertext c FROM public.clinical_notes WHERE id = $1`,
        [r.id],
      )
    ).rows;
    const tasks = JSON.parse(decrypt(row!.c)).sections.s05.items[0];
    expect(tasks).toEqual({ kind: "tasks", text: null, notRecorded: true });
  });

  it("a draft that took the server's handoff key is not mistaken for the handover", async () => {
    const p = await patient(lane.pg);
    await intake(lane.pg, { hospitalId: h, patientUserId: p });
    const ep = await episode(p);
    const enc = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: nurse.userId,
    });
    await withPatientWrite(
      nurse,
      p,
      (ctx) =>
        saveNoteDraft(ctx, {
          patientUserId: p,
          encounterId: enc,
          templateId: "tpl.nursing",
          clientKey: `resus-handoff:${ep}`,
          content: { sections: {} },
        }),
      { database: lane.db },
    );
    // The action's Zod refuses a ':' key; this is the write function reached past it.
    await expect(consume(p, ep)).rejects.toMatchObject({ code: "conflict" });
  });
  it("outstanding tests become proposed orders by the leader; a re-consume proposes nothing twice", async () => {
    const p = await patient(lane.pg);
    await intake(lane.pg, { hospitalId: h, patientUserId: p });
    const ep = await episode(p, "concluded", "Repeat glucose hourly.", [
      { testId: TROPONIN, reason: "  Chest pain before the arrest " },
      { testId: LACTATE, reason: null },
      { testId: TROPONIN, reason: "a repeat is dropped" },
      { testId: randomUUID(), reason: "not on the menu: left out" },
      { testId: "not-a-uuid" },
    ]);
    const r = await consume(p, ep);
    const rows = await proposals(r.encounterId);
    expect(rows.map((o) => o.test_id).sort()).toEqual([LACTATE, TROPONIN].sort());
    for (const o of rows) {
      expect(o).toMatchObject({
        lifecycle: "events",
        intent_source: "resus_handover",
        source_intent_id: `${ep}:${o.test_id}`,
        authored_by_user_id: leaderId,
        requester_cadre: "MEDICAL_OFFICER",
        priority: "routine",
      });
      expect(await stateOf(o.id)).toBe("proposed");
    }
    const reasons = Object.fromEntries(
      rows.map((o) => [o.test_id, decrypt(o.reason_text_ciphertext)]),
    );
    expect(reasons).toEqual({
      [TROPONIN]: "Chest pain before the arrest",
      [LACTATE]: HANDOVER_REASON,
    });

    // Re-consume, including after the flag was set again: nothing twice.
    expect(await consume(p, ep)).toEqual(r);
    await lane.pg.query(
      `UPDATE public.resus_episodes SET pending_encounter_handoff = true WHERE id = $1`,
      [ep],
    );
    expect(await consume(p, ep)).toEqual(r);
    expect(await proposals(r.encounterId)).toHaveLength(2);
    // An older handover event (no list) proposes nothing.
    const plain = await patient(lane.pg);
    await intake(lane.pg, { hospitalId: h, patientUserId: plain });
    const r2 = await consume(plain, await episode(plain));
    expect(await proposals(r2.encounterId)).toEqual([]);
  });

  it("accept places the proposal (the same order), dismiss records it; both idempotent; nurse refused", async () => {
    const p = await patient(lane.pg);
    await intake(lane.pg, { hospitalId: h, patientUserId: p });
    const ep = await episode(p, "concluded", "", [
      { testId: TROPONIN, reason: null },
      { testId: CHEST_XRAY, reason: null },
      { testId: LACTATE, reason: null },
    ]);
    const { encounterId } = await consume(p, ep);
    const byTest = Object.fromEntries((await proposals(encounterId)).map((o) => [o.test_id, o.id]));
    const ref = (id: string) => ({ patientUserId: p, encounterId, proposedOrderId: id });

    // Law 6: a nurse proposes through the handoff but never accepts or dismisses.
    await expect(
      as(nurse, p, (ctx) => acceptSuggestedOrder(ctx, ref(byTest[TROPONIN]!))),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      as(nurse, p, (ctx) => dismissSuggestedOrder(ctx, ref(byTest[TROPONIN]!))),
    ).rejects.toMatchObject({ code: "forbidden" });

    const a = await as(mo, p, (ctx) => acceptSuggestedOrder(ctx, ref(byTest[TROPONIN]!)));
    expect(a).toEqual({ id: byTest[TROPONIN], orderIds: [byTest[TROPONIN]] });
    expect(await stateOf(byTest[TROPONIN]!)).toBe("active");
    expect(await as(mo, p, (ctx) => acceptSuggestedOrder(ctx, ref(byTest[TROPONIN]!)))).toEqual(a);
    const xr = await as(mo, p, (ctx) => acceptSuggestedOrder(ctx, ref(byTest[CHEST_XRAY]!)));
    expect(xr.warnings?.[0]).toMatch(/ionising radiation/);

    await as(mo, p, (ctx) => dismissSuggestedOrder(ctx, ref(byTest[LACTATE]!)));
    await as(mo, p, (ctx) => dismissSuggestedOrder(ctx, ref(byTest[LACTATE]!)));
    expect(await stateOf(byTest[LACTATE]!)).toBe("cancelled");
    const kinds = (
      await lane.pg.query<{ kind: string; reason_code: string | null; actor_user_id: string }>(
        `SELECT kind, reason_code, actor_user_id FROM public.encounter_order_events WHERE order_id = $1 ORDER BY recorded_at, kind DESC`,
        [byTest[LACTATE]],
      )
    ).rows;
    expect(kinds).toEqual([
      { kind: "proposed", reason_code: null, actor_user_id: leaderId },
      { kind: "dismissed", reason_code: "suggestion_dismissed", actor_user_id: mo.userId },
    ]);

    // Decided one way, never the other; a clinician's own order is not a suggestion.
    await expect(
      as(mo, p, (ctx) => acceptSuggestedOrder(ctx, ref(byTest[LACTATE]!))),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      as(mo, p, (ctx) => dismissSuggestedOrder(ctx, ref(byTest[TROPONIN]!))),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      as(mo, p, (ctx) => acceptSuggestedOrder(ctx, ref(randomUUID()))),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      as(mo, p, (ctx) =>
        acceptSuggestedOrder(ctx, { ...ref(byTest[TROPONIN]!), encounterId: randomUUID() }),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
