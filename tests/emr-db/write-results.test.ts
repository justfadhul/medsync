/**
 * Results write paths (PROMPT §5.8, D-EMR-06/07/08; W2): the full loop order → collect → receive →
 * preliminary → final → acknowledge; reject → recollect; amend → re-acknowledge; transcription and
 * uncatalogued values; critical only from a signed entry; and the /lab re-point under EMR_V1 against
 * the legacy encounter_results path. Runs only with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane } from "./_pglite";
import type { EmrActor } from "@/lib/emr/actor";
import type { CriticalRef } from "@/lib/emr/reference/critical";
import type { WriteCtx } from "@/lib/emr/write/context";
import type { ResultValueInput } from "@/lib/emr/write/results";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { loadResultsToReview } from "@/lib/emr/read/results";
import { CRITICAL_REFS } from "@/lib/emr/reference/critical";
import { withPatientWrite } from "@/lib/emr/write/context";
import { markFactEnteredInError } from "@/lib/emr/write/facts";
import { loadOrder, orderStatus, placeOrders } from "@/lib/emr/write/orders";
import {
  acknowledgeResults,
  amendResults,
  enterResults,
  recordCriticalCommunication,
  releaseResults,
} from "@/lib/emr/write/results";
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
} from "./_pglite";

// The /lab actions run for real against the lane; only identity and Next's cache are stubbed.
const held = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));
vi.mock("@/db", () => ({
  get db() {
    return held.db;
  },
}));
vi.mock("@/lib/emr/actor", () => ({ requireEmrActor: async () => held.actor }));
vi.mock("@/lib/lab-tech/scope", () => ({ requireLabTechScope: async () => held.actor }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const GLUCOSE_FASTING = "79a7098d-6585-5bff-ab14-3a4a09b3bf68";
const MALARIA_RDT = "461e61e7-1f95-589b-a8e4-87e9e007d16e";
const key = () => `k-${randomUUID()}`;

describe.skipIf(!laneOn)("results (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let dept: string;
  let doctor: EmrActor;
  let cover: EmrActor;
  let elsewhere: EmrActor;
  let nurse: EmrActor;
  let lab: EmrActor;

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    lane = await bootLane();
    held.db = lane.db;
    h = await hospital(lane.pg);
    dept = await department(lane.pg, h);
    const surgery = await department(lane.pg, h, "Surgery");
    const labDept = await department(lane.pg, h, "Laboratory");
    const make = async (
      departmentId: string,
      cadreCode: string,
      surface: EmrActor["surface"],
    ): Promise<EmrActor> => ({
      ...(await clinician(lane.pg, { hospitalId: h, departmentId, cadre: cadreCode })),
      fullName: null,
      hospitalId: h,
      departmentId,
      cadreCode,
      isClinical: true,
      surface,
    });
    doctor = await make(dept, "MEDICAL_OFFICER", "doctor");
    cover = await make(dept, "MEDICAL_OFFICER", "doctor");
    elsewhere = await make(surgery, "MEDICAL_OFFICER", "doctor");
    nurse = await make(dept, "NURSE", "nurse");
    lab = await make(labDept, "LAB_TECH", "lab");
  }, 180_000);

  afterEach(() => {
    delete process.env.EMR_V1;
    delete process.env.ENCOUNTER_ENGINE_LIVE;
    delete process.env.LAB_RESULTS_LIVE;
  });

  const as = <T>(a: EmrActor, p: string, fn: (ctx: WriteCtx) => Promise<T>) =>
    withPatientWrite(a, p, fn, { database: lane.db });
  const code = (pr: Promise<unknown>) =>
    pr.then(
      () => "ok",
      (e: { code?: string }) => e.code ?? String(e),
    );
  const status = (p: string, orderId: string) =>
    as(doctor, p, async (ctx) => orderStatus(ctx.tx, await loadOrder(ctx, p, orderId)));
  const obs = (reportId: string) =>
    lane.pg
      .query<Record<string, unknown>>(
        `SELECT id, concept_id, logical_id, version, value_num, value_unit, value_canonical, value_comparator, trust,
                status, entry_mode, order_id, fasting_state, context, value_type, note_ciphertext, sensitivity
           FROM clinical_observations WHERE report_id = $1 ORDER BY concept_id`,
        [reportId],
      )
      .then((r) => r.rows);
  const report = (id: string) =>
    lane.pg
      .query<Record<string, unknown>>(`SELECT * FROM diagnostic_reports WHERE id = $1`, [id])
      .then((r) => r.rows[0]!);

  /** A patient present today, an encounter with the doctor, one ordered test. */
  async function ordered(testId = GLUCOSE_FASTING): Promise<{ p: string; orderId: string }> {
    const p = await patient(lane.pg);
    await intake(lane.pg, { hospitalId: h, patientUserId: p });
    const enc = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: doctor.userId,
      departmentId: dept,
    });
    const r = await as(doctor, p, (ctx) =>
      placeOrders(ctx, {
        patientUserId: p,
        encounterId: enc,
        orders: [{ clientKey: key(), testId, priority: "routine", reasonText: "Check" }],
      }),
    );
    return { p, orderId: r.id };
  }
  async function received(): Promise<{ p: string; orderId: string; specimenId: string }> {
    const o = await ordered();
    const s = await as(nurse, o.p, (ctx) =>
      collectSpecimen(ctx, {
        patientUserId: o.p,
        orderId: o.orderId,
        identifiersConfirmed: true,
        fastingState: "fasting",
        fastingHours: 9,
        clientKey: key(),
      }),
    );
    await as(lab, o.p, (ctx) =>
      receiveSpecimen(ctx, { patientUserId: o.p, specimenId: s.id, clientKey: key() }),
    );
    return { ...o, specimenId: s.id };
  }
  const glucose = (value: string, extra: Record<string, unknown> = {}) => ({
    conceptId: "obs.glucose",
    value,
    unit: "mmol/L",
    referenceRange: { low: 1, high: 2, unit: "mmol/L" }, // the lab's own (test) range
    labInterpretation: "H" as const,
    ...extra,
  });
  const enter = (
    a: EmrActor,
    p: string,
    orderId: string,
    status: "preliminary" | "final",
    values: ResultValueInput[] = [glucose("5.1")],
    refs?: readonly CriticalRef[],
  ) =>
    as(a, p, (ctx) =>
      enterResults(ctx, { patientUserId: p, orderId, status, values, clientKey: key() }, refs),
    );
  const ack = (
    a: EmrActor,
    p: string,
    reportId: string,
    action: "seen" | "acted" = "seen",
    note?: string,
  ) =>
    as(a, p, (ctx) =>
      acknowledgeResults(ctx, {
        patientUserId: p,
        items: [{ reportId, action, note }],
        clientKey: key(),
      }),
    );

  it("runs the loop: collect → receive → preliminary → final → acknowledge", async () => {
    const { p, orderId, specimenId } = await received();
    // Direct entry before receipt is refused; after receipt, preliminary is trust 3.
    const prelim = await enter(lab, p, orderId, "preliminary");
    const v1 = await obs(prelim.id);
    expect(v1).toHaveLength(1);
    expect(v1[0]).toMatchObject({
      concept_id: "obs.glucose",
      version: 1,
      value_unit: "mmol/L",
      trust: 3,
      status: "preliminary",
      entry_mode: "direct",
      order_id: orderId,
      fasting_state: "fasting",
    });
    expect(v1[0]!.context).toMatchObject({
      referenceRange: { low: 1, high: 2, unit: "mmol/L", source: "lab" },
      labInterpretation: "H",
      fastingHours: 9,
    });
    expect((await report(prelim.id)).specimen_id).toBe(specimenId);
    expect(await status(p, orderId)).toMatchObject({ state: "resulted", review: "not_released" });
    expect(await code(ack(doctor, p, prelim.id))).toBe("conflict"); // preliminary is not reviewed

    const final = await as(lab, p, (ctx) =>
      releaseResults(ctx, { patientUserId: p, reportId: prelim.id, clientKey: key() }),
    );
    const f = await report(final.id);
    expect(f).toMatchObject({ status: "final", trust: 4, version: 2, supersedes_id: prelim.id });
    const v2 = await obs(final.id);
    // The same logical value, next version, same concept (STOP 3 invariant).
    expect(v2[0]).toMatchObject({
      concept_id: "obs.glucose",
      logical_id: v1[0]!.logical_id,
      version: 2,
      trust: 4,
      status: "final",
    });
    expect(await status(p, orderId)).toMatchObject({ state: "resulted", review: "needs_review" });

    expect(await code(ack(elsewhere, p, final.id))).toBe("forbidden"); // not the orderer's department
    const a = await ack(doctor, p, final.id, "acted", "Started treatment");
    const row = await lane.pg.query<{ note_ciphertext: string; action: string }>(
      `SELECT note_ciphertext, action FROM result_acknowledgements WHERE id = $1`,
      [a.id],
    );
    expect(row.rows[0]!.action).toBe("acted");
    expect(decrypt(row.rows[0]!.note_ciphertext)).toBe("Started treatment");
    expect(await status(p, orderId)).toMatchObject({ state: "acknowledged", action: "acted" });
    // A result is never hidden by a cancel.
    expect(
      await code(
        as(doctor, p, async (ctx) => {
          const { cancelOrder } = await import("@/lib/emr/write/orders");
          return cancelOrder(ctx, {
            patientUserId: p,
            orderId,
            reasonText: "late",
            clientKey: key(),
          });
        }),
      ),
    ).toBe("conflict");
  });

  it("refuses entry before receipt, and a replay returns the same version", async () => {
    const { p, orderId } = await ordered();
    expect(await code(enter(lab, p, orderId, "preliminary"))).toBe("conflict");
    const r = await received();
    const clientKey = key();
    const once = () =>
      as(lab, r.p, (ctx) =>
        enterResults(ctx, {
          patientUserId: r.p,
          orderId: r.orderId,
          status: "final",
          values: [glucose("5.1")],
          clientKey,
        }),
      );
    const a = await once();
    expect((await once()).id).toBe(a.id);
    expect((await report(a.id)).trust).toBe(4); // direct laboratory final
  });

  it("the orderer's cover acknowledges; a forward needs a colleague here", async () => {
    const { p, orderId } = await received();
    const r = await enter(lab, p, orderId, "final");
    const fwd = (to: string) =>
      as(doctor, p, (ctx) =>
        acknowledgeResults(ctx, {
          patientUserId: p,
          items: [{ reportId: r.id, action: "forwarded", forwardedToUserId: to }],
          clientKey: key(),
        }),
      );
    expect(await code(fwd(randomUUID()))).toBe("invalid");
    await fwd(elsewhere.userId);
    // The forward target may now acknowledge, as may the same-department cover.
    await ack(elsewhere, p, r.id, "seen");
    await ack(cover, p, r.id, "seen");
    expect(await status(p, orderId)).toMatchObject({ state: "acknowledged" });
  });

  it("a forward hands the result over: open for the forwardee, off the orderer's list, until seen", async () => {
    const { p, orderId } = await received();
    const r = await enter(lab, p, orderId, "final");
    const review = async (a: EmrActor) =>
      (await loadResultsToReview(a, { database: lane.db })).map((i) => i.reportId);
    expect(await review(doctor)).toContain(r.id);
    expect(await review(elsewhere)).not.toContain(r.id);
    await as(doctor, p, (ctx) =>
      acknowledgeResults(ctx, {
        patientUserId: p,
        items: [{ reportId: r.id, action: "forwarded", forwardedToUserId: elsewhere.userId }],
        clientKey: key(),
      }),
    );
    expect(await review(elsewhere)).toContain(r.id);
    expect(await review(doctor)).not.toContain(r.id);
    expect(await status(p, orderId)).toMatchObject({ state: "resulted", review: "forwarded" });
    await ack(elsewhere, p, r.id, "seen");
    expect(await review(elsewhere)).not.toContain(r.id);
    expect(await status(p, orderId)).toMatchObject({ state: "acknowledged" });
  });

  it("rejects a received specimen after a preliminary: withdrawn, back to collect with the reason", async () => {
    const { p, orderId, specimenId } = await received();
    const prelim = await enter(lab, p, orderId, "preliminary");
    await as(lab, p, (ctx) =>
      rejectSpecimen(ctx, {
        patientUserId: p,
        specimenId,
        reasonCode: "clotted",
        clientKey: key(),
      }),
    );
    const chain = await lane.pg.query<{ status: string }>(
      `SELECT status FROM diagnostic_reports WHERE logical_id = $1 ORDER BY version`,
      [(await report(prelim.id)).logical_id],
    );
    expect(chain.rows.map((r) => r.status)).toEqual(["preliminary", "cancelled"]);
    expect(await status(p, orderId)).toMatchObject({
      state: "active",
      rejection: { reasonCode: "clotted" },
    });
    // Recollect, receive, and the order moves on again.
    const s = await as(nurse, p, (ctx) =>
      collectSpecimen(ctx, {
        patientUserId: p,
        orderId,
        identifiersConfirmed: true,
        fastingState: "unknown",
        clientKey: key(),
      }),
    );
    await as(lab, p, (ctx) =>
      receiveSpecimen(ctx, { patientUserId: p, specimenId: s.id, clientKey: key() }),
    );
    expect((await enter(lab, p, orderId, "final")).id).toBeTruthy();
  });

  it("amends: a new version superseding, concept kept, re-acknowledgement required", async () => {
    const { p, orderId } = await received();
    const final = await enter(lab, p, orderId, "final");
    await ack(doctor, p, final.id);
    const before = await obs(final.id);
    expect(
      await code(
        as(doctor, p, (ctx) =>
          amendResults(ctx, {
            patientUserId: p,
            reportId: final.id,
            status: "amended",
            values: [glucose("6.2")],
            reasonText: "Recalibrated",
            clientKey: key(),
          }),
        ),
      ),
    ).toBe("forbidden"); // neither the laboratory nor the one who entered it
    const amended = await as(lab, p, (ctx) =>
      amendResults(ctx, {
        patientUserId: p,
        reportId: final.id,
        status: "amended",
        values: [glucose("6.2")],
        reasonText: "Recalibrated",
        clientKey: key(),
      }),
    );
    expect(amended.warnings).toEqual([expect.stringContaining("acknowledge the amended result")]);
    const r = await report(amended.id);
    expect(r).toMatchObject({ status: "amended", supersedes_id: final.id, version: 2 });
    expect(decrypt(r.reason_ciphertext as string)).toBe("Recalibrated");
    const after = await obs(amended.id);
    expect(after[0]).toMatchObject({
      concept_id: "obs.glucose",
      logical_id: before[0]!.logical_id,
      version: 2,
      value_num: "6.2",
    });
    expect(await status(p, orderId)).toMatchObject({ state: "resulted", review: "needs_re_ack" });
    await ack(doctor, p, amended.id);
    expect(await status(p, orderId)).toMatchObject({ state: "acknowledged" });
    // The superseded version cannot be amended again.
    expect(
      await code(
        as(lab, p, (ctx) =>
          amendResults(ctx, {
            patientUserId: p,
            reportId: final.id,
            status: "corrected",
            values: [glucose("6.3")],
            reasonText: "x",
            clientKey: key(),
          }),
        ),
      ),
    ).toBe("conflict");
  });

  it("a value voided on a preliminary stays voided through release (no duplicate version)", async () => {
    const { p, orderId } = await received();
    const prelim = await enter(lab, p, orderId, "preliminary");
    const [o] = await obs(prelim.id);
    await as(lab, p, (ctx) =>
      markFactEnteredInError(ctx, {
        kind: "observation",
        patientUserId: p,
        id: o!.id as string,
        reasonText: "Wrong sample",
        clientKey: key(),
      }),
    );
    const final = await as(lab, p, (ctx) =>
      releaseResults(ctx, { patientUserId: p, reportId: prelim.id, clientKey: key() }),
    );
    const v = await obs(final.id);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({
      logical_id: o!.logical_id,
      version: 3,
      status: "entered_in_error",
    });
    expect(decrypt(v[0]!.note_ciphertext as string)).toBe("Wrong sample");
  });

  it("asks before saving a unit-mismatch value, keeps comparators, stores uncatalogued as typed", async () => {
    const { p, orderId } = await received();
    const high = [
      glucose("", { value: "90", referenceRange: undefined, labInterpretation: undefined }),
    ];
    expect(await code(enter(lab, p, orderId, "preliminary", high))).toBe("invalid");
    const r = await enter(lab, p, orderId, "preliminary", [
      glucose("<1.1", { referenceRange: undefined, labInterpretation: undefined }),
      { conceptId: "obs.uncatalogued", name: "Serum osmolality", value: "abc", unit: "mOsm/kg" },
    ]);
    const rows = await obs(r.id);
    const g = rows.find((o) => o.concept_id === "obs.glucose")!;
    expect(g).toMatchObject({ value_comparator: "<", value_num: "1.1" });
    const u = rows.find((o) => o.concept_id === "obs.uncatalogued")!;
    expect(u.value_type).toBe("as_typed");
    expect(JSON.parse(decrypt(u.note_ciphertext as string))).toMatchObject({
      name: "Serum osmolality",
    });
    expect((await report(r.id)).uncatalogued).toBe(true);
    // Confirmed, the mismatching value saves (a genuine extreme is never blocked).
    const { p: p2, orderId: o2 } = await received();
    const ok = await enter(lab, p2, o2, "preliminary", [
      glucose("90", {
        unitConfirmed: true,
        referenceRange: undefined,
        labInterpretation: undefined,
      }),
    ]);
    expect((await obs(ok.id))[0]).toMatchObject({ value_num: "90" });
  });

  it("a clinician transcription is trust 3 until verified; nurses enter point-of-care only", async () => {
    const { p, orderId } = await ordered();
    const t = await enter(doctor, p, orderId, "final");
    expect(await report(t.id)).toMatchObject({
      entry_mode: "transcribed",
      trust: 3,
      verified_by_user_id: null,
    });
    expect((await obs(t.id))[0]).toMatchObject({ trust: 3, entry_mode: "transcribed" });
    const g = await received();
    expect(await code(enter(nurse, g.p, g.orderId, "final"))).toBe("forbidden");
    // A bedside malaria RDT, collected by the nurse, entered by the nurse (coded answer).
    const m = await ordered(MALARIA_RDT);
    const s = await as(nurse, m.p, (ctx) =>
      collectSpecimen(ctx, {
        patientUserId: m.p,
        orderId: m.orderId,
        identifiersConfirmed: true,
        clientKey: key(),
      }),
    );
    expect(s.id).toBeTruthy();
    const poc = await enter(nurse, m.p, m.orderId, "final", [
      { conceptId: "obs.malaria_test", code: "negative" },
    ]);
    expect(await report(poc.id)).toMatchObject({ source: "poc_staff", trust: 3 });
  });

  it("critical only from a signed entry: none signed → no flag; a TEST-signed entry → flag, warning, call record", async () => {
    const a = await received();
    const unsigned = await enter(lab, a.p, a.orderId, "final");
    expect(unsigned.critical).toBe(false);
    expect(unsigned.warnings).toEqual([]);
    expect((await report(unsigned.id)).critical).toBe(false);

    // A TEST-only signed entry: the value is a fixture, never a clinical limit.
    const base = CRITICAL_REFS.find((r) => r.conceptId === "obs.glucose" && r.operator === ">")!;
    const testSigned: CriticalRef[] = [
      { ...base, id: "REF-CRIT-TEST", status: "signed", value: "5" },
    ];
    const b = await received();
    const crit = await enter(lab, b.p, b.orderId, "final", [glucose("5.1")], testSigned);
    expect(crit.critical).toBe(true);
    expect(crit.warnings).toEqual([expect.stringContaining("critical")]);
    expect((await report(crit.id)).critical).toBe(true);

    const call = (x: EmrActor) =>
      as(x, b.p, (ctx) =>
        recordCriticalCommunication(ctx, {
          patientUserId: b.p,
          reportId: crit.id,
          communicatedToUserId: doctor.userId,
          communicatedToRole: "orderer",
          method: "phone",
          readBack: true,
          clientKey: key(),
        }),
      );
    expect(await code(call(doctor))).toBe("forbidden");
    const c = await call(lab);
    const row = await lane.pg.query(
      `SELECT method, read_back FROM critical_result_communications WHERE id = $1`,
      [c.id],
    );
    expect(row.rows[0]).toEqual({ method: "phone", read_back: true });
  });

  describe("the /lab re-point", () => {
    const labActions = () => import("@/app/lab/actions");
    const worklist = () => import("@/app/lab/_lib/emr");

    it("flag off: EMR-shaped calls fall to the legacy path, which runs as before", async () => {
      held.actor = { ...lab };
      const { enterLabResultAction, releaseLabResultAction } = await labActions();
      const { p, orderId } = await received();
      // No EMR_V1: the EMR shape is not an EMR call; the legacy module is off too.
      expect(await enterLabResultAction({ orderId, patientUserId: p, values: [] })).toEqual({
        ok: false,
        error: "Lab results module is not active.",
      });
      // Legacy module on: a legacy order is entered and released on encounter_results.
      process.env.ENCOUNTER_ENGINE_LIVE = "1";
      process.env.LAB_RESULTS_LIVE = "1";
      const legacy = await legacyOrder(p);
      const e = await enterLabResultAction({ orderId: legacy, value: "5.0", unit: "mmol/L" });
      expect(e).toMatchObject({ ok: true });
      const resultId = (e as { resultId: string }).resultId;
      expect(await releaseLabResultAction({ resultId })).toEqual({ ok: true, resultId });
      const r = await lane.pg.query<{ quality_status: string; status: string }>(
        `SELECT r.quality_status, o.status FROM encounter_results r JOIN encounter_orders o ON o.id = r.order_id
          WHERE r.id = $1`,
        [resultId],
      );
      expect(r.rows[0]).toEqual({ quality_status: "released", status: "resulted" });
    });

    it("flag on: enter → preliminary, release → final, reject → rejection; legacy entry on an events order refused", async () => {
      process.env.ENCOUNTER_ENGINE_LIVE = "1";
      process.env.EMR_V1 = h;
      held.actor = { ...lab };
      const { enterLabResultAction, rejectLabResultAction, releaseLabResultAction } =
        await labActions();
      const { loadEmrLabWorklist } = await worklist();
      const { p, orderId, specimenId } = await received();

      expect(
        (await loadEmrLabWorklist(h, lane.db)).find((i) => i.orderId === orderId),
      ).toMatchObject({ stage: "received", specimenId });
      expect(await enterLabResultAction({ orderId, value: "5.0" })).toMatchObject({ ok: false });

      const e = await enterLabResultAction({
        orderId,
        patientUserId: p,
        values: [glucose("5.1")],
        clientKey: key(),
      });
      expect(e).toMatchObject({ ok: true });
      const prelimId = (e as { id: string }).id;
      expect((await report(prelimId)).status).toBe("preliminary");
      expect(
        (await loadEmrLabWorklist(h, lane.db)).find((i) => i.orderId === orderId),
      ).toMatchObject({ stage: "preliminary", reportId: prelimId });

      const rel = await releaseLabResultAction({
        patientUserId: p,
        reportId: prelimId,
        clientKey: key(),
      });
      expect(rel).toMatchObject({ ok: true });
      expect((await report((rel as { id: string }).id)).status).toBe("final");
      expect((await loadEmrLabWorklist(h, lane.db)).some((i) => i.orderId === orderId)).toBe(false);

      const b = await received();
      const rej = await rejectLabResultAction({
        patientUserId: b.p,
        specimenId: b.specimenId,
        reasonCode: "insufficient",
        clientKey: key(),
      });
      expect(rej).toMatchObject({ ok: true });
      expect(await status(b.p, b.orderId)).toMatchObject({
        state: "active",
        rejection: { reasonCode: "insufficient" },
      });
      // No legacy result was written for the EMR orders.
      const legacyRows = await lane.pg.query(
        `SELECT 1 FROM encounter_results WHERE order_id = ANY($1::uuid[])`,
        [[orderId, b.orderId]],
      );
      expect(legacyRows.rows).toHaveLength(0);
      // Another hospital's flag does not switch this one on.
      process.env.EMR_V1 = randomUUID();
      expect(
        await enterLabResultAction({
          orderId: b.orderId,
          patientUserId: b.p,
          values: [glucose("5")],
          clientKey: key(),
        }),
      ).toMatchObject({ ok: false, code: "config" });
    });

    async function legacyOrder(p: string): Promise<string> {
      const enc = await lane.pg.query<{ id: string }>(
        `SELECT id FROM encounters WHERE patient_user_id = $1 LIMIT 1`,
        [p],
      );
      return (
        await lane.pg.query<{ id: string }>(
          `INSERT INTO encounter_orders (encounter_id, patient_user_id, kind, text, authored_by_user_id)
           VALUES ($1, $2, 'bloods', 'Glucose', $3) RETURNING id`,
          [enc.rows[0]!.id, p, doctor.userId],
        )
      ).rows[0]!.id;
    }
  });
});
