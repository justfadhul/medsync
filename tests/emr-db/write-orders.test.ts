/**
 * Orders and specimens write paths (PROMPT §5.8, §8; W2): placeOrders, cancelOrder, collectSpecimen,
 * receiveSpecimen, rejectSpecimen, on the real 0071 tables. Runs only with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane } from "./_pglite";
import type { EmrActor } from "@/lib/emr/actor";
import type { WriteCtx } from "@/lib/emr/write/context";
import { beforeAll, describe, expect, it } from "vitest";

import { orderStatusText } from "@/lib/emr/orders";
import { withPatientWrite } from "@/lib/emr/write/context";
import { cancelOrder, loadOrder, orderStatus, placeOrders } from "@/lib/emr/write/orders";
import { collectSpecimen, receiveSpecimen, rejectSpecimen } from "@/lib/emr/write/specimens";
import { decrypt, generateKey } from "@/lib/encryption";
import {
  bootLane,
  clinician,
  department,
  encounter,
  hospital,
  intake,
  laneOn,
  patient,
  reception,
} from "./_pglite";

const GLUCOSE_FASTING = "79a7098d-6585-5bff-ab14-3a4a09b3bf68";
const CHEST_XRAY = "6b303538-8f18-5044-8131-66a1db67bc3e";
const BLOOD_CULTURE = "9adb4157-13a5-5d32-8fcb-f2c3ef4b8f33"; // no container on the menu
const key = () => `k-${randomUUID()}`;

describe.skipIf(!laneOn)("orders and specimens (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let dept: string;
  let doctor: EmrActor;
  let nurse: EmrActor;
  let lab: EmrActor;
  let desk: EmrActor;
  let stranger: EmrActor;

  const actor = (
    s: { userId: string; affiliationId: string },
    cadreCode: string,
    departmentId: string,
    o: Partial<EmrActor> = {},
  ): EmrActor => ({
    userId: s.userId,
    affiliationId: s.affiliationId,
    fullName: null,
    hospitalId: h,
    departmentId,
    cadreCode,
    isClinical: true,
    surface: "doctor",
    ...o,
  });

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    lane = await bootLane();
    h = await hospital(lane.pg);
    dept = await department(lane.pg, h);
    const labDept = await department(lane.pg, h, "Laboratory");
    doctor = actor(
      await clinician(lane.pg, { hospitalId: h, departmentId: dept }),
      "MEDICAL_OFFICER",
      dept,
    );
    nurse = actor(
      await clinician(lane.pg, { hospitalId: h, departmentId: dept, cadre: "NURSE" }),
      "NURSE",
      dept,
      { surface: "nurse" },
    );
    lab = actor(
      await clinician(lane.pg, { hospitalId: h, departmentId: labDept, cadre: "LAB_TECH" }),
      "LAB_TECH",
      labDept,
      { surface: "lab" },
    );
    desk = actor(
      await reception(lane.pg, { hospitalId: h, departmentId: dept }),
      "RECEPTION",
      dept,
      {
        isClinical: false,
      },
    );
    // A doctor at another hospital with no basis for these patients.
    const other = await hospital(lane.pg, "Other");
    const otherDept = await department(lane.pg, other);
    stranger = {
      ...actor(
        await clinician(lane.pg, { hospitalId: other, departmentId: otherDept }),
        "MEDICAL_OFFICER",
        otherDept,
      ),
      hospitalId: other,
    };
  }, 180_000);

  /** A patient present today (so nurse and lab have a basis) in an encounter with the doctor. */
  async function visit(): Promise<{ p: string; enc: string }> {
    const p = await patient(lane.pg);
    await intake(lane.pg, { hospitalId: h, patientUserId: p });
    const enc = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: doctor.userId,
      departmentId: dept,
    });
    return { p, enc };
  }
  const as = <T>(a: EmrActor, p: string, fn: (ctx: WriteCtx) => Promise<T>) =>
    withPatientWrite(a, p, fn, { database: lane.db });
  const status = async (p: string, orderId: string) =>
    as(doctor, p, async (ctx) => {
      const o = await loadOrder(ctx, p, orderId);
      const s = await orderStatus(ctx.tx, o);
      return { ...s, text: orderStatusText(s, o.kind) };
    });
  const fails = (pr: Promise<unknown>) =>
    pr.then(
      () => "ok",
      (e: { code?: string }) => e.code ?? String(e),
    );

  async function orderGlucose(p: string, enc: string): Promise<string> {
    const r = await as(doctor, p, (ctx) =>
      placeOrders(ctx, {
        patientUserId: p,
        encounterId: enc,
        orders: [
          { clientKey: key(), testId: GLUCOSE_FASTING, priority: "routine", reasonText: "screen" },
        ],
      }),
    );
    return r.id;
  }

  it("places a batch: events lifecycle, encrypted reason, fasting from the menu, ionising warning", async () => {
    const { p, enc } = await visit();
    const keys = [key(), key()];
    const r = await as(doctor, p, (ctx) =>
      placeOrders(ctx, {
        patientUserId: p,
        encounterId: enc,
        orders: [
          {
            clientKey: keys[0]!,
            testId: GLUCOSE_FASTING,
            priority: "urgent",
            reasonText: "Polyuria",
          },
          { clientKey: keys[1]!, testId: CHEST_XRAY, priority: "routine", reasonText: "Cough" },
        ],
      }),
    );
    expect(r.orderIds).toHaveLength(2);
    expect(r.warnings).toEqual([expect.stringContaining("ionising radiation")]);
    const { rows } = await lane.pg.query<Record<string, unknown>>(
      `SELECT lifecycle, fasting_required, requester_cadre, intent_source, priority, reason_text_ciphertext, kind
         FROM encounter_orders WHERE id = ANY($1::uuid[]) ORDER BY kind DESC`,
      [r.orderIds],
    );
    expect(rows.map((o) => [o.kind, o.fasting_required, o.lifecycle, o.intent_source])).toEqual([
      ["lab", true, "events", "clinician"],
      ["imaging", false, "events", "clinician"],
    ]);
    expect(rows[0]!.requester_cadre).toBe("MEDICAL_OFFICER");
    expect(rows[0]!.reason_text_ciphertext).not.toContain("Polyuria");
    expect(decrypt(rows[0]!.reason_text_ciphertext as string)).toBe("Polyuria");
    const events = await lane.pg.query(
      `SELECT 1 FROM encounter_order_events WHERE order_id = ANY($1::uuid[]) AND kind = 'placed'`,
      [r.orderIds],
    );
    expect(events.rows).toHaveLength(2);
    const stamped = await lane.pg.query<{ at: Date | null }>(
      `SELECT last_activity_at AS at FROM encounters WHERE id = $1`,
      [enc],
    );
    expect(stamped.rows[0]!.at).not.toBeNull();
    expect((await status(p, r.orderIds[0]!)).text).toBe("To collect");

    // Idempotent replay: the same keys return the same orders and write nothing new.
    const again = await as(doctor, p, (ctx) =>
      placeOrders(ctx, {
        patientUserId: p,
        encounterId: enc,
        orders: [
          {
            clientKey: keys[0]!,
            testId: GLUCOSE_FASTING,
            priority: "urgent",
            reasonText: "Polyuria",
          },
          { clientKey: keys[1]!, testId: CHEST_XRAY, priority: "routine", reasonText: "Cough" },
        ],
      }),
    );
    expect(again.orderIds).toEqual(r.orderIds);
    const count = await lane.pg.query(`SELECT 1 FROM encounter_orders WHERE encounter_id = $1`, [
      enc,
    ]);
    expect(count.rows).toHaveLength(2);
  });

  it("refuses an order with no reason, a closed encounter, and forbidden actors", async () => {
    const { p, enc } = await visit();
    const line = { clientKey: key(), testId: GLUCOSE_FASTING, priority: "routine" as const };
    const place = (a: EmrActor, reasonText?: string) =>
      fails(
        as(a, p, (ctx) =>
          placeOrders(ctx, {
            patientUserId: p,
            encounterId: enc,
            orders: [{ ...line, reasonText }],
          }),
        ),
      );
    expect(await place(doctor)).toBe("invalid");
    expect(await place(nurse, "x")).toBe("forbidden"); // nurses do not order (D-EMR-16)
    expect(await place(desk, "x")).toBe("forbidden"); // not a clinical role
    expect(await place(stranger, "x")).toBe("forbidden"); // no basis at this hospital
    await lane.pg.query(
      `UPDATE encounters SET state = 'completed', ended_at = now() WHERE id = $1`,
      [enc],
    );
    expect(await place(doctor, "x")).toBe("conflict"); // closed; the intake still gives a basis
  });

  it("collects with two identifiers and the fasting chip, receives, rejects and recollects", async () => {
    const { p, enc } = await visit();
    const orderId = await orderGlucose(p, enc);
    const collect = (a: EmrActor, extra: Record<string, unknown> = {}) =>
      as(a, p, (ctx) =>
        collectSpecimen(ctx, {
          patientUserId: p,
          orderId,
          identifiersConfirmed: true,
          clientKey: key(),
          ...extra,
        } as Parameters<typeof collectSpecimen>[1]),
      );
    expect(await fails(collect(nurse))).toBe("invalid"); // the fasting chip is required
    expect(
      await fails(collect(nurse, { identifiersConfirmed: false, fastingState: "fasting" })),
    ).toBe("invalid");
    expect(await fails(collect(desk, { fastingState: "fasting" }))).toBe("forbidden");
    const first = await collect(nurse, { fastingState: "fasting", fastingHours: 10 });
    const s = await lane.pg.query<Record<string, unknown>>(
      `SELECT fasting_state, container, specimen_type, collected_by_user_id FROM specimens WHERE id = $1`,
      [first.id],
    );
    expect(s.rows[0]).toMatchObject({
      fasting_state: "fasting",
      container: "fluoride_oxalate",
      specimen_type: "venous_plasma",
      collected_by_user_id: nurse.userId,
    });
    expect((await status(p, orderId)).state).toBe("collected");
    expect(await fails(collect(nurse, { fastingState: "fasting" }))).toBe("conflict"); // already collected

    const act = (a: EmrActor, fn: typeof receiveSpecimen, specimenId: string) =>
      as(a, p, (ctx) => fn(ctx, { patientUserId: p, specimenId, clientKey: key() }));
    expect(await fails(act(nurse, receiveSpecimen, first.id))).toBe("forbidden"); // the lab receives
    await act(lab, receiveSpecimen, first.id);
    expect((await status(p, orderId)).state).toBe("in_progress");

    await as(lab, p, (ctx) =>
      rejectSpecimen(ctx, {
        patientUserId: p,
        specimenId: first.id,
        reasonCode: "haemolysed",
        clientKey: key(),
      }),
    );
    const back = await status(p, orderId);
    expect(back.state).toBe("active");
    expect(back.text).toBe("Rejected: haemolysed — recollect");

    const second = await collect(nurse, { fastingState: "non_fasting" });
    expect(second.id).not.toBe(first.id);
    expect((await status(p, orderId)).state).toBe("collected");
  });

  it("needs the container when the menu has none", async () => {
    const { p, enc } = await visit();
    const r = await as(doctor, p, (ctx) =>
      placeOrders(ctx, {
        patientUserId: p,
        encounterId: enc,
        orders: [
          { clientKey: key(), testId: BLOOD_CULTURE, priority: "immediate", reasonText: "Fever" },
        ],
      }),
    );
    const collect = (container?: string) =>
      as(nurse, p, (ctx) =>
        collectSpecimen(ctx, {
          patientUserId: p,
          orderId: r.id,
          identifiersConfirmed: true,
          container,
          clientKey: key(),
        }),
      );
    expect(await fails(collect())).toBe("invalid");
    expect((await collect("unknown")).id).toBeTruthy();
  });

  it("cancels with a reason, idempotently, and never after the order is done", async () => {
    const { p, enc } = await visit();
    const orderId = await orderGlucose(p, enc);
    const k = key();
    const cancel = (clientKey: string, reasonText?: string) =>
      as(doctor, p, (ctx) =>
        cancelOrder(ctx, { patientUserId: p, orderId, reasonText, clientKey }),
      );
    expect(await fails(cancel(key()))).toBe("invalid");
    const c = await cancel(k, "Duplicate");
    expect((await cancel(k, "Duplicate")).id).toBe(c.id);
    const st = await status(p, orderId);
    expect(st.state).toBe("cancelled");
    expect(await fails(cancel(key(), "Again"))).toBe("conflict");
    expect(
      await fails(
        as(nurse, p, (ctx) =>
          collectSpecimen(ctx, {
            patientUserId: p,
            orderId,
            identifiersConfirmed: true,
            fastingState: "fasting",
            clientKey: key(),
          }),
        ),
      ),
    ).toBe("conflict");
  });
});
