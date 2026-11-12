/**
 * Quick protocols in Prescribe, acceptance scenario S6 (prescribing kit §4) on the PGlite lane, with
 * 0282 replayed: Prescribe › Protocols › DKA for Namusoke Grace → no potassium on file, ordered →
 * potassium 3.2 from the record holds the insulin and changes the plan → refused in production while
 * a draft → two different consultants sign (the database refuses one signer twice, a signed version
 * without two, and any change once signed) → sign and send: one placement to the pharmacy with what
 * the prescriber saw. A builder draft previews but cannot start in production. Fictional patient.
 * Runs only with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane } from "./_pglite";
import type { EmrActor } from "@/lib/emr/actor";
import type { WriteCtx } from "@/lib/emr/write/context";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { withPatientWrite } from "@/lib/emr/write/context";
import { recordAllergy, recordObservations } from "@/lib/emr/write/facts";
import {
  listProtocols,
  orderStartTest,
  previewProtocol,
  saveProtocolDraft,
  signProtocolVersion,
  startProtocol,
} from "@/lib/emr/write/protocols";
import { encrypt, generateKey } from "@/lib/encryption";
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

const key = () => `k-${randomUUID()}`;

describe.skipIf(!laneOn)("quick protocols, S6 (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let dept: string;
  let mo: EmrActor;
  let cons1: EmrActor;
  let cons2: EmrActor;

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await lane.pg.query<T>(sql, params)).rows;
  const as = <T>(a: EmrActor, p: string, fn: (ctx: WriteCtx) => Promise<T>) =>
    withPatientWrite(a, p, fn, { database: lane.db });
  const actor = async (cadreCode: string): Promise<EmrActor> => {
    const s = await clinician(lane.pg, { hospitalId: h, departmentId: dept, cadre: cadreCode });
    return {
      userId: s.userId,
      affiliationId: s.affiliationId,
      fullName: null,
      hospitalId: h,
      departmentId: dept,
      cadreCode,
      isClinical: true,
      surface: "doctor",
    };
  };
  const env = process.env.VERCEL_ENV;
  afterEach(() => {
    if (env === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = env;
  });

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    process.env.ENCOUNTER_ENGINE_LIVE = "1";
    process.env.EMR_V1 = "1";
    process.env.EMR_PRESCRIBING = "1";
    process.env.PRESCRIBE_V2 = "1";
    lane = await bootLane();
    h = await hospital(lane.pg);
    dept = await department(lane.pg, h);
    mo = await actor("MEDICAL_OFFICER");
    cons1 = await actor("CONSULTANT");
    cons2 = await actor("SENIOR_CONSULTANT");
  }, 180_000);

  async function grace() {
    const p = await patient(lane.pg);
    await lane.pg.query(
      `INSERT INTO public.patient_profiles (id, first_name_encrypted, surname_encrypted, sex, date_of_birth, id_type,
         phone_encrypted, district_id)
       VALUES ($1, $2, $3, 'female', '1990-03-01', 'none', $4, (SELECT id FROM public.districts LIMIT 1))`,
      [p, encrypt("Namusoke"), encrypt("Grace"), encrypt("0700000000")],
    );
    await intake(lane.pg, { hospitalId: h, patientUserId: p });
    const e = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: mo.userId,
      departmentId: dept,
    });
    await as(mo, p, async (ctx) => {
      await recordAllergy(ctx, {
        patientUserId: p,
        encounterId: null,
        clientKey: key(),
        substance: { text: "Penicillin" },
        informant: "patient",
      });
      await recordObservations(ctx, {
        patientUserId: p,
        encounterId: e,
        clientKey: key(),
        observations: [
          { conceptId: "obs.weight", value: { type: "quantity", value: 64, unit: "kg" } },
          { conceptId: "obs.creatinine", value: { type: "quantity", value: 168, unit: "umol/L" } },
        ],
      });
    });
    return { p, e };
  }

  it("S6: DKA for Namusoke Grace: potassium from results holds the insulin, two consultants sign, sign and send", async () => {
    const g = await grace();
    const list = await as(mo, g.p, (ctx) => listProtocols(ctx));
    expect(list.items).toHaveLength(10);
    expect(list.canSign).toBe(false);
    const seed = list.items.find((i) => i.protocolId === "dka")!;
    expect(seed).toMatchObject({
      status: "draft",
      signatures: 0,
      group: "endo",
      slotMinutes: 60,
      slotCount: 24,
    });
    const input = { patientUserId: g.p, encounterId: g.e, place: "ward" as const, typed: {} };

    // No potassium on file: a hard stop, and "Order it" goes through the lab order writer.
    const before = await as(mo, g.p, (ctx) =>
      previewProtocol(ctx, { ...input, versionId: seed.versionId }),
    );
    expect(before.start[0]).toMatchObject({ key: "k", value: null, orderable: true });
    expect(before.checks.find((c) => c.id === "start")).toMatchObject({ hard: true });
    await as(mo, g.p, (ctx) =>
      orderStartTest(ctx, {
        patientUserId: g.p,
        encounterId: g.e,
        versionId: seed.versionId,
        key: "k",
        clientKey: key(),
      }),
    );
    expect(
      await q(`SELECT 1 FROM public.encounter_orders WHERE encounter_id = $1`, [g.e]),
    ).toHaveLength(1);

    // Potassium 3.2 on the record: the band holds the insulin and changes bag 1.
    await as(mo, g.p, (ctx) =>
      recordObservations(ctx, {
        patientUserId: g.p,
        encounterId: g.e,
        clientKey: key(),
        observations: [
          { conceptId: "obs.potassium", value: { type: "quantity", value: 3.2, unit: "mmol/L" } },
        ],
      }),
    );
    const seen = await as(mo, g.p, (ctx) =>
      previewProtocol(ctx, { ...input, versionId: seed.versionId }),
    );
    expect(seen.start[0]).toMatchObject({
      value: "3.2",
      typed: false,
      source: expect.any(String),
      at: expect.any(String),
    });
    expect(seen.start[0]!.bands.find((b) => b.on)).toMatchObject({
      range: "Under 3.3",
      stop: true,
    });
    expect(seen.checks.find((c) => c.id === "band_k")).toMatchObject({
      level: "stop",
      answers: ["plan_changed"],
    });
    expect(seen.plan.find((s) => s.id === "ins")).toMatchObject({ held: true });
    expect(seen.plan.find((s) => s.id === "f1")!.title).toContain("with potassium");
    expect(seen.supply.map((s) => s.name)).toEqual([
      "Sodium chloride 0.9%",
      expect.stringContaining("Insulin, soluble"),
      "Potassium chloride",
      "Glucose 10%",
    ]);
    expect(seen.supply[1]!.dose).toContain("6.4 units/h");

    const answers = Object.fromEntries(
      seen.checks.filter((c) => c.answers.length).map((c) => [c.id, c.answers[0]!]),
    );
    const send = (a: EmrActor, versionId: string, ans = answers) =>
      as(a, g.p, (ctx) =>
        startProtocol(ctx, { ...input, versionId, clientKey: key(), answers: ans, witness: null }),
      );

    // A draft cannot start in production (P1).
    process.env.VERCEL_ENV = "production";
    await expect(send(mo, seed.versionId)).rejects.toThrow(/Not signed off/);

    // Sign-off: consultants only, two different ones; the seed is copied for this hospital.
    await expect(
      as(mo, g.p, (ctx) => signProtocolVersion(ctx, { versionId: seed.versionId })),
    ).rejects.toThrow(/cadre/);
    const first = await as(cons1, g.p, (ctx) =>
      signProtocolVersion(ctx, { versionId: seed.versionId }),
    );
    expect(first.signed).toBe(false);
    expect(first.id).not.toBe(seed.versionId);
    await expect(
      as(cons1, g.p, (ctx) => signProtocolVersion(ctx, { versionId: seed.versionId })),
    ).rejects.toThrow(/second, different/);
    // [DB] the same rules hold without the server: one signer twice, signed with one signature.
    await expect(
      q(
        `UPDATE public.protocol_versions SET signer2_user_id = signer1_user_id, signer2_role = 'CONSULTANT', signer2_at = now(),
           status = 'signed', signed_at = now() WHERE id = $1`,
        [first.id],
      ),
    ).rejects.toThrow();
    await expect(
      q(`UPDATE public.protocol_versions SET status = 'signed', signed_at = now() WHERE id = $1`, [
        first.id,
      ]),
    ).rejects.toThrow();
    await expect(
      q(`UPDATE public.protocol_versions SET rules = '{"x":1}' WHERE id = $1`, [first.id]),
    ).rejects.toThrow(/being signed/);
    const second = await as(cons2, g.p, (ctx) => signProtocolVersion(ctx, { versionId: first.id }));
    expect(second).toEqual({ id: first.id, signed: true });
    await expect(
      q(`UPDATE public.protocol_versions SET source = 'x' WHERE id = $1`, [first.id]),
    ).rejects.toThrow(/frozen/);
    await expect(
      q(`DELETE FROM public.protocol_versions WHERE id = $1`, [first.id]),
    ).rejects.toThrow(/never deleted/);
    await expect(
      q(
        `UPDATE public.protocol_versions SET status = 'signed' WHERE hospital_id IS NULL AND protocol_id = 'hhs'`,
      ),
    ).rejects.toThrow();

    const after = await as(mo, g.p, (ctx) => listProtocols(ctx));
    const signed = after.items.find((i) => i.protocolId === "dka")!;
    expect(signed).toMatchObject({
      versionId: first.id,
      status: "signed",
      signatures: 2,
      startable: true,
    });

    // Sign and send: every answer needed, then one placement with what the prescriber saw.
    await expect(send(mo, signed.versionId, {})).rejects.toThrow(/Answer/);
    const sent = await send(mo, signed.versionId);
    expect(sent.prescriptionIds).toHaveLength(4);
    const rows = await q<{
      drug_id: string;
      dose: string;
      quantity: string | null;
      placement_id: string;
      protocol_version_id: string;
      protocol_start: {
        held: string[];
        start: { value: string; source: string }[];
        answers: Record<string, string>;
      };
      prescribe_place: string;
    }>(
      `SELECT drug_id, dose, quantity, placement_id, protocol_version_id, protocol_start, prescribe_place
          FROM public.prescriptions WHERE patient_user_id = $1 ORDER BY placement_line`,
      [g.p],
    );
    expect(rows.map((r) => r.drug_id)).toEqual([
      "sodium_chloride_0_9",
      "insulin_soluble",
      "potassium_chloride",
      "glucose_10",
    ]);
    expect(new Set(rows.map((r) => r.placement_id)).size).toBe(1);
    expect(
      rows.every((r) => r.protocol_version_id === first.id && r.prescribe_place === "ward"),
    ).toBe(true);
    expect(rows[0]!.quantity).toBe("6 bags of 1,000 ml");
    expect(rows[1]!.dose).toContain("6.4 units/h");
    expect(rows[1]!.protocol_start).toMatchObject({
      held: ["ins"],
      start: [{ value: "3.2" }],
      answers: { band_k: "plan_changed" },
    });

    // A second run must be on purpose.
    const again = await as(mo, g.p, (ctx) =>
      previewProtocol(ctx, { ...input, versionId: signed.versionId }),
    );
    expect(again.checks.find((c) => c.id === "running")).toMatchObject({ answers: ["on_purpose"] });
  });

  it("S6: a builder draft previews for the patient but cannot start in production", async () => {
    const g = await grace();
    const made = await as(mo, g.p, (ctx) =>
      saveProtocolDraft(ctx, {
        name: "Ward fluids",
        intro: "",
        who: "adult",
        steps: [
          {
            kind: "infusion",
            title: "",
            drug: "sodium_chloride_0_9",
            amt: null,
            unit: "",
            at: 0,
            every: 0,
            count: 0,
            vol: 1000,
            over: 480,
            conc: 0,
            checks: "",
            double: false,
            input: "",
            inUnit: "",
            bands: "",
            note: "",
          },
        ],
      }),
    );
    const list = await as(mo, g.p, (ctx) => listProtocols(ctx));
    expect(list.items.find((i) => i.versionId === made.id)).toMatchObject({
      group: "custom",
      status: "draft",
    });
    process.env.VERCEL_ENV = "production";
    const view = await as(mo, g.p, (ctx) =>
      previewProtocol(ctx, {
        patientUserId: g.p,
        encounterId: g.e,
        place: "ward",
        versionId: made.id,
        typed: {},
      }),
    );
    expect(view.protocol).toMatchObject({ status: "draft", startable: false });
    expect(view.plan[0]!.detail).toContain("1,000 ml over 8 hours");
    expect(view.checks[0]).toMatchObject({ id: "signed", hard: true });
    await expect(
      as(mo, g.p, (ctx) =>
        startProtocol(ctx, {
          patientUserId: g.p,
          encounterId: g.e,
          place: "ward",
          versionId: made.id,
          typed: {},
          clientKey: key(),
          answers: {},
          witness: null,
        }),
      ),
    ).rejects.toThrow(/Not signed off/);
  });
});
