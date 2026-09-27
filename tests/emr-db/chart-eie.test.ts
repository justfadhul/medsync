/**
 * The chart keeps entered-in-error items visible (Law 4): loadChartFor reads the voided facts and
 * their reasons into the payload — struck in the Timeline and in each section's history — while
 * the engines' snapshot still drops them. Runs only with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane } from "./_pglite";
import type { EmrActor } from "@/lib/emr/actor";
import type { EmrTx } from "@/lib/emr/db";
import type { WriteCtx } from "@/lib/emr/write/context";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { asClinicalReader } from "@/lib/emr/db";
import { loadChartFor } from "@/lib/emr/read/chart";
import { withPatientWrite } from "@/lib/emr/write/context";
import { markFactEnteredInError, recordAllergy, recordObservations } from "@/lib/emr/write/facts";
import { encrypt, generateKey } from "@/lib/encryption";
import { loadFactSnapshot } from "@/lib/facts/loader";
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

const held = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({
  get db() {
    return held.db;
  },
}));
vi.mock("@/lib/workspace/queries", () => ({ deathsFor: async () => [] }));

const key = () => `k-${randomUUID()}`;

describe.skipIf(!laneOn)("chart: entered in error stays visible (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let mo: EmrActor;

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    lane = await bootLane();
    held.db = lane.db;
    h = await hospital(lane.pg);
    const dept = await department(lane.pg, h);
    mo = {
      ...(await clinician(lane.pg, { hospitalId: h, departmentId: dept })),
      fullName: null,
      hospitalId: h,
      departmentId: dept,
      cadreCode: "MEDICAL_OFFICER",
      isClinical: true,
      surface: "doctor",
    };
  }, 180_000);

  const as = <T>(p: string, fn: (ctx: WriteCtx) => Promise<T>) =>
    withPatientWrite(mo, p, fn, { database: lane.db });

  it("a voided vital and a voided allergy are struck with their reasons; engines still drop them", async () => {
    const p = await patient(lane.pg);
    await intake(lane.pg, { hospitalId: h, patientUserId: p });
    const enc = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: mo.userId,
    });
    await lane.pg.query(
      `INSERT INTO public.patient_profiles (id, first_name_encrypted, surname_encrypted, sex, date_of_birth, id_type,
         phone_encrypted, district_id)
       VALUES ($1, $2, $3, 'female', '1988-07-01', 'none', $4, (SELECT id FROM public.districts LIMIT 1))`,
      [p, encrypt("Test"), encrypt("Patient"), encrypt("0700000000")],
    );
    const hr = await as(p, (ctx) =>
      recordObservations(ctx, {
        patientUserId: p,
        encounterId: enc,
        clientKey: key(),
        observations: [
          { conceptId: "obs.heart_rate", value: { type: "quantity", value: 88, unit: "/min" } },
        ],
      }),
    );
    const allergy = await as(p, (ctx) =>
      recordAllergy(ctx, {
        patientUserId: p,
        encounterId: enc,
        clientKey: key(),
        substance: { text: "Penicillin" },
        informant: "patient",
      }),
    );
    await as(p, (ctx) =>
      markFactEnteredInError(ctx, {
        kind: "observation",
        patientUserId: p,
        id: hr.id,
        reasonText: "Recorded on the wrong patient",
        clientKey: key(),
      }),
    );
    await as(p, (ctx) =>
      markFactEnteredInError(ctx, {
        kind: "allergy",
        patientUserId: p,
        id: allergy.id,
        reasonCode: "duplicate",
        clientKey: key(),
      }),
    );

    const chart = await loadChartFor(mo, p, { logSurface: "test", database: lane.db });
    const payload = chart!.payload;
    expect(payload.flowsheet.rows).toEqual([]);
    expect(payload.summary.allergies.state).toBe("not_recorded");
    expect(
      payload.enteredInError.map((i) => [i.section, i.title.split(" ")[0], i.reason]).sort(),
    ).toEqual([
      ["allergies", "Penicillin", "Duplicate"],
      ["results", "Heart", "Recorded on the wrong patient"],
    ]);
    expect(payload.timeline.filter((t) => t.struck)).toHaveLength(2);

    // The engines' read is unchanged: a voided item is gone.
    const snap = await asClinicalReader(
      { userId: mo.userId, hospitalId: h },
      (tx) =>
        loadFactSnapshot(tx as EmrTx, p, {
          manifest: ["obs.heart_rate", "allergy"],
          purpose: "interactive",
        }),
      lane.db,
    );
    expect(snap.facts).toEqual([]);
  });
});
