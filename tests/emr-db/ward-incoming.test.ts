/**
 * The nurse in charge is told at admission (ADR 0533): afterClose writes a `ward_incoming` notice to the
 * ward's open in-charge assignments (substantive and acting), in a savepoint, never naming the patient
 * (ADR 0199). Runs with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane, Pg } from "./_pglite";
import type { EmrActor } from "@/lib/emr/actor";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { withPatientWrite } from "@/lib/emr/write/context";
import { afterClose } from "@/lib/emr/write/encounter";
import { generateKey } from "@/lib/encryption";
import {
  authUser,
  bootLane,
  department,
  encounter,
  hospital,
  laneOn,
  patient,
  staff,
} from "./_pglite";

const FLAGS = ["CARE_REQUESTS", "EMR_V1", "ENCOUNTER_ENGINE_LIVE"] as const;
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));

describe.skipIf(!laneOn)("the nurse in charge is told at admission (PGlite lane)", () => {
  let lane: Lane;
  let pg: Pg;
  let h: string;
  let dept: string;
  let doctor: EmrActor;

  async function makeWard(): Promise<{ id: string; name: string }> {
    const s = randomUUID().slice(0, 8);
    const name = `Medical ${s}`;
    const id = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.hospital_wards (hospital_id, department_id, name, slug, bed_count)
         VALUES ($1, $2, $3, $4, 1) RETURNING id`,
        [h, dept, name, `med-${s}`],
      )
    ).rows[0]!.id;
    await pg.query(
      `INSERT INTO public.hospital_beds (hospital_id, ward_id, label) VALUES ($1, $2, '1')`,
      [h, id],
    );
    return { id, name };
  }

  const inCharge = async (wardId: string, acting: boolean, endsAt: string | null = null) => {
    const u = await authUser(pg, "nurse");
    await pg.query(
      `INSERT INTO public.ward_in_charge_assignments (hospital_id, ward_id, nurse_user_id, acting, ends_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz)`,
      [h, wardId, u, acting, endsAt],
    );
    return u;
  };

  /** Admits a fresh patient to the ward (no bed), then runs afterClose as the clinician would. */
  async function admit(wardId: string) {
    const p = await patient(pg);
    const e = await encounter(pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: doctor.userId,
      departmentId: dept,
    });
    const r = (
      await pg.query<{ r: { admission_id: string } }>(
        `SELECT public.admit_from_encounter($1::jsonb) AS r`,
        [
          JSON.stringify({
            encounter_id: e,
            actor: doctor.userId,
            ward_id: wardId,
            bed_wait_reason: "no_free_bed",
            disposition_detail: { plan_said: "admit" },
          }),
        ],
      )
    ).rows[0]!.r;
    const warnings = await withPatientWrite(
      doctor,
      p,
      (ctx) =>
        afterClose(ctx, {
          patientUserId: p,
          encounterId: e,
          stopRxIds: [],
          admissionId: r.admission_id,
        }),
      { database: lane.db },
    );
    return { p, admissionId: r.admission_id, warnings };
  }

  const sent = async (admissionId: string) =>
    (
      await pg.query<{ recipient_user_id: string; subject: string; body: string }>(
        `SELECT recipient_user_id, subject, body FROM public.sa_notifications
          WHERE kind = 'ward_incoming' AND related_id = $1`,
        [admissionId],
      )
    ).rows;

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    lane = await bootLane();
    pg = lane.pg;
    h = await hospital(pg, "Incoming");
    dept = await department(pg, h);
    const s = await staff(pg, { hospitalId: h, departmentId: dept });
    doctor = {
      userId: s.userId,
      affiliationId: s.affiliationId,
      fullName: null,
      hospitalId: h,
      departmentId: dept,
      cadreCode: "MEDICAL_OFFICER",
      isClinical: true,
      surface: "doctor",
    };
  }, 180_000);

  const flags = (on: boolean) => {
    for (const k of FLAGS) {
      if (on) process.env[k] = "1";
      else delete process.env[k];
    }
  };

  afterAll(() => {
    for (const k of FLAGS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("admission tells the in-charge and the acting in-charge", async () => {
    flags(true);
    const ward = await makeWard();
    const sister = await inCharge(ward.id, false);
    const acting = await inCharge(ward.id, true);
    const { p, admissionId } = await admit(ward.id);
    const rows = await sent(admissionId);
    expect(rows.map((r) => r.recipient_user_id).sort()).toEqual([sister, acting].sort());
    for (const n of rows) {
      // The ward and fixed words only: never the patient (ADR 0199).
      expect(n.subject).toBe(CARE_REQUEST_COPY.noticeSubject("ward_incoming", ward.name));
      expect(n.body).toBe(CARE_REQUEST_COPY.wardIncomingBody);
      expect(`${n.subject} ${n.body}`).not.toContain(p);
    }
  });

  it("an acting in-charge with a future end is told", async () => {
    flags(true);
    const ward = await makeWard();
    const acting = await inCharge(ward.id, true, new Date(Date.now() + 86_400_000).toISOString());
    const { admissionId } = await admit(ward.id);
    expect((await sent(admissionId)).map((r) => r.recipient_user_id)).toEqual([acting]);
  });

  it("no in-charge, no notice, no error", async () => {
    flags(true);
    const ward = await makeWard();
    // An ended assignment does not count.
    const old = await inCharge(ward.id, false);
    await pg.query(
      `UPDATE public.ward_in_charge_assignments SET ends_at = now() WHERE nurse_user_id = $1`,
      [old],
    );
    const { admissionId } = await admit(ward.id);
    expect(await sent(admissionId)).toEqual([]);
  });

  it("flag off, nothing is written", async () => {
    flags(false);
    const ward = await makeWard();
    await inCharge(ward.id, false);
    const { admissionId } = await admit(ward.id);
    expect(await sent(admissionId)).toEqual([]);
  });
});
