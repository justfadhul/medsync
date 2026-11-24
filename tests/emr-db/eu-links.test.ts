/**
 * Migration 0313 section 3 on the PGlite lane (ADR 0541, D4): triage sends a Level 1–2 patient straight to a free
 * resus space of an EU. The stay is the triage nurse's (no encounter, the intake named); the doctor's later Send to
 * EU adopts it. Service role only. Runs only with EMR_PGLITE=1 (see _pglite.ts).
 */
import { randomUUID } from "node:crypto";
import type { Pg } from "./_pglite";
import { beforeAll, describe, expect, it } from "vitest";

import {
  bootLane,
  department,
  encounter,
  hospital,
  intake,
  laneOn,
  patient,
  probe,
  staff,
} from "./_pglite";

const BOOT_MS = 180_000;

describe.skipIf(!laneOn)("0313 — triage sends to EU resus", () => {
  let pg: Pg;
  let h: string;
  let h2: string;
  let dept: string;
  let nurse: string;
  let doctor: string;

  beforeAll(async () => {
    pg = (await bootLane()).pg;
    h = await hospital(pg, "EU resus");
    h2 = await hospital(pg, "Elsewhere");
    dept = await department(pg, h);
    nurse = (await staff(pg, { hospitalId: h, departmentId: dept, cadre: "NURSE" })).userId;
    doctor = (await staff(pg, { hospitalId: h, departmentId: dept })).userId;
  }, BOOT_MS);

  const call = async (payload: Record<string, unknown>) =>
    (
      await pg.query<{ r: Record<string, string | boolean | null> }>(
        `SELECT public.send_to_eu_resus($1::jsonb) AS r`,
        [JSON.stringify(payload)],
      )
    ).rows[0]!.r;
  const refusal = async (payload: Record<string, unknown>) => {
    try {
      await call(payload);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error("expected a refusal");
  };
  const row = async (sql: string, params: unknown[]) =>
    (await pg.query<Record<string, unknown>>(sql, params)).rows[0]!;

  /** A fresh EU (or another ward type) with its own spaces, each `label: bed_type`. */
  async function newWard(
    spaces: Record<string, string>,
    o: { hospitalId?: string; type?: string } = {},
  ): Promise<{ ward: string; beds: Record<string, string> }> {
    const hid = o.hospitalId ?? h;
    const s = randomUUID().slice(0, 8);
    const ward = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.hospital_wards (hospital_id, department_id, name, slug, bed_count, ward_type)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          hid,
          hid === h ? dept : await department(pg, hid),
          `Unit ${s}`,
          `unit-${s}`,
          Object.keys(spaces).length,
          o.type ?? "emergency_observation",
        ],
      )
    ).rows[0]!.id;
    const beds: Record<string, string> = {};
    for (const [label, type] of Object.entries(spaces))
      beds[label] = (
        await pg.query<{ id: string }>(
          `INSERT INTO public.hospital_beds (hospital_id, ward_id, label, bed_type)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [hid, ward, label, type],
        )
      ).rows[0]!.id;
    return { ward, beds };
  }

  /** A patient at triage: an arrived intake, triaged at `level` (none when null). */
  async function triaged(level: number | null, hospitalId = h) {
    const p = await patient(pg);
    const i = await intake(pg, { hospitalId, patientUserId: p });
    if (level != null)
      await pg.query(
        `INSERT INTO public.triage_records (intake_id, patient_user_id, hospital_id, ruleset, vitals_snapshot,
                                            computed_level, computed_breakdown, assigned_level, triaged_by_user_id)
         VALUES ($1, $2, $3, 'adult_news2', '{}'::jsonb, $4, '{}'::jsonb, $4, $5)`,
        [i, p, hospitalId, level, nurse],
      );
    return { p, i };
  }

  it("a Level 2 patient goes to a free resus space: a triage stay, no encounter, an Arriving space", async () => {
    const { ward, beds } = await newWard({ R1: "resus" });
    const { p, i } = await triaged(2);
    const r = await call({ hospital_id: h, intake_id: i, bed_id: beds["R1"], actor: nurse });
    expect(r).toMatchObject({ bed: "R1", intake_id: i, hospital_id: h });
    expect(
      await row(
        `SELECT started_by_kind, encounter_id, intake_id, ward_id, status, decided_by, responsible_user_id,
                arrived_at FROM public.eu_stays WHERE id = $1`,
        [r.stay_id],
      ),
    ).toEqual({
      started_by_kind: "triage_nurse",
      encounter_id: null,
      intake_id: i,
      ward_id: ward,
      status: "in_space",
      decided_by: nurse,
      responsible_user_id: nurse,
      arrived_at: null,
    });
    expect(
      await row(
        `SELECT bed_id, eu_stay_id, encounter_id, arrived_at, ended_at FROM public.bed_assignments WHERE id = $1`,
        [r.assignment_id],
      ),
    ).toEqual({
      bed_id: beds["R1"],
      eu_stay_id: r.stay_id,
      encounter_id: null,
      arrived_at: null,
      ended_at: null,
    });
    expect(
      (await pg.query(`SELECT 1 FROM public.eu_stays WHERE patient_user_id = $1`, [p])).rows.length,
    ).toBe(1);
  });

  it("Level 1 goes too; Level 3 and an untriaged visit are refused, nothing written", async () => {
    const { beds } = await newWard({ R1: "resus", R2: "resus", R3: "resus" });
    const one = await triaged(1);
    await expect(
      call({ hospital_id: h, intake_id: one.i, bed_id: beds["R1"], actor: nurse }),
    ).resolves.toMatchObject({ bed: "R1" });
    for (const level of [3, null]) {
      const { p, i } = await triaged(level);
      expect(
        await refusal({ hospital_id: h, intake_id: i, bed_id: beds["R2"], actor: nurse }),
      ).toBe("EU409 Only a Level 1 or 2 patient goes straight to EU resus.");
      expect(
        (await pg.query(`SELECT 1 FROM public.eu_stays WHERE patient_user_id = $1`, [p])).rows,
      ).toEqual([]);
    }
  });

  it("the latest triage decides: re-triaged from 2 to 3 is refused", async () => {
    const { beds } = await newWard({ R1: "resus" });
    const { p, i } = await triaged(2);
    await pg.query(
      `INSERT INTO public.triage_records (intake_id, patient_user_id, hospital_id, ruleset, vitals_snapshot,
                                          computed_level, computed_breakdown, assigned_level, triaged_at)
       VALUES ($1, $2, $3, 'adult_news2', '{}'::jsonb, 3, '{}'::jsonb, 3, now() + interval '1 minute')`,
      [i, p, h],
    );
    expect(
      await refusal({ hospital_id: h, intake_id: i, bed_id: beds["R1"], actor: nurse }),
    ).toMatch(/^EU409 Only a Level 1 or 2/);
  });

  it("a trolley, a non-EU resus bed and another hospital's space are not a resus space", async () => {
    const eu = await newWard({ T1: "standard", C1: "chair" });
    const ward = await newWard({ X1: "resus" }, { type: "general" });
    const other = await newWard({ R1: "resus" }, { hospitalId: h2 });
    for (const bed of [eu.beds["T1"], eu.beds["C1"], ward.beds["X1"], other.beds["R1"]]) {
      const { i } = await triaged(2);
      expect(await refusal({ hospital_id: h, intake_id: i, bed_id: bed, actor: nurse })).toBe(
        "EU409 Choose a resus space.",
      );
    }
  });

  it("an occupied, cleaning or closed resus space is refused in words", async () => {
    const { beds } = await newWard({ R1: "resus", R2: "resus", R3: "resus" });
    const first = await triaged(2);
    await call({ hospital_id: h, intake_id: first.i, bed_id: beds["R1"], actor: nurse });
    const { i } = await triaged(2);
    expect(await refusal({ hospital_id: h, intake_id: i, bed_id: beds["R1"], actor: nurse })).toBe(
      "AD409 Bed R1 was just taken. Choose another.",
    );
    await pg.query(
      `INSERT INTO public.bed_state_events (hospital_id, bed_id, state, set_by)
       SELECT hospital_id, id, 'cleaning', $2 FROM public.hospital_beds WHERE id = $1`,
      [beds["R2"], nurse],
    );
    expect(await refusal({ hospital_id: h, intake_id: i, bed_id: beds["R2"], actor: nurse })).toBe(
      "AD409 Bed R2 is being cleaned just now. Choose another.",
    );
    await pg.query(
      `UPDATE public.hospital_beds SET closed_at = now(), closed_reason = 'Broken' WHERE id = $1`,
      [beds["R3"]],
    );
    expect(await refusal({ hospital_id: h, intake_id: i, bed_id: beds["R3"], actor: nurse })).toBe(
      "EU409 Choose a resus space.",
    );
  });

  it("a visit at another hospital, or one not at triage, is not this hospital's", async () => {
    const { beds } = await newWard({ R1: "resus" });
    const away = await triaged(2, h2);
    expect(
      await refusal({ hospital_id: h, intake_id: away.i, bed_id: beds["R1"], actor: nurse }),
    ).toBe("EU404 That visit is not at this hospital.");
    const done = await triaged(2);
    await pg.query(`UPDATE public.patient_intakes SET status = 'completed' WHERE id = $1`, [
      done.i,
    ]);
    expect(
      await refusal({ hospital_id: h, intake_id: done.i, bed_id: beds["R1"], actor: nurse }),
    ).toBe("EU404 That visit is not at this hospital.");
  });

  it("a patient already in the EU, or in a bed, is refused", async () => {
    const { beds } = await newWard({ R1: "resus", R2: "resus" });
    const { i } = await triaged(2);
    await call({ hospital_id: h, intake_id: i, bed_id: beds["R1"], actor: nurse });
    expect(await refusal({ hospital_id: h, intake_id: i, bed_id: beds["R2"], actor: nurse })).toBe(
      "EU409 This patient is already in the EU.",
    );
  });

  it("the doctor's Send to EU later adopts the triage stay, keeping the space", async () => {
    const { ward, beds } = await newWard({ R1: "resus" });
    const { p, i } = await triaged(2);
    const r = await call({ hospital_id: h, intake_id: i, bed_id: beds["R1"], actor: nurse });
    const e = await encounter(pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: doctor,
      visitId: i,
    });
    const a = (
      await pg.query<{ r: Record<string, unknown> }>(
        `SELECT public.observe_in_eu($1::jsonb) AS r`,
        [JSON.stringify({ encounter_id: e, actor: doctor, ward_id: ward, bed_id: beds["R1"] })],
      )
    ).rows[0]!.r;
    expect(a).toMatchObject({ stay_id: r.stay_id, adopted: true, bed: "R1", intake_id: i });
    expect(
      await row(
        `SELECT encounter_id, responsible_user_id, started_by_kind, decided_by FROM public.eu_stays WHERE id = $1`,
        [r.stay_id],
      ),
    ).toEqual({
      encounter_id: e,
      responsible_user_id: doctor,
      started_by_kind: "triage_nurse",
      decided_by: nurse,
    });
  });

  /* R65: a triage stay (no encounter yet) belongs to its intake. Only an encounter of that visit (encounters.visit_id,
     or its triage's intake) adopts or ends it; another visit of the same patient leaves the resus space held. */
  it("only the triage's own visit adopts or ends a triage stay; another visit leaves it held", async () => {
    const { ward, beds } = await newWard({ R1: "resus" });
    const { p, i } = await triaged(2);
    const r = await call({ hospital_id: h, intake_id: i, bed_id: beds["R1"], actor: nurse });
    const held = async () =>
      row(
        `SELECT s.status, s.encounter_id, a.ended_at
           FROM public.eu_stays s JOIN public.bed_assignments a ON a.eu_stay_id = s.id
          WHERE s.id = $1 AND a.id = $2`,
        [r.stay_id, r.assignment_id],
      );
    const fn = async (name: string, payload: Record<string, unknown>) => {
      try {
        return (
          await pg.query<{ r: Record<string, unknown> }>(`SELECT public.${name}($1::jsonb) AS r`, [
            JSON.stringify(payload),
          ])
        ).rows[0]!.r;
      } catch (e) {
        return (e as Error).message;
      }
    };
    const end = (e: string) => ({
      encounter_id: e,
      actor: doctor,
      end_kind: "home",
      disposition: "home",
    });

    // Visit B: a clinic visit of the same patient, same hospital (yesterday's ticket, one live per day); and an
    // encounter with no visit at all.
    const b = await intake(pg, {
      hospitalId: h,
      patientUserId: p,
      arrivedAt: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const clinic = await encounter(pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: doctor,
      visitId: b,
    });
    const loose = await encounter(pg, { hospitalId: h, patientUserId: p, clinicianUserId: doctor });
    for (const e of [clinic, loose]) {
      expect(await fn("end_eu_stay", end(e))).toEqual({ ended: false });
      expect(await held()).toEqual({ status: "in_space", encounter_id: null, ended_at: null });
      expect(
        await fn("observe_in_eu", {
          encounter_id: e,
          actor: doctor,
          ward_id: ward,
          bed_id: beds["R1"],
        }),
      ).toBe("EU409 This patient is already in the EU.");
      expect(await held()).toEqual({ status: "in_space", encounter_id: null, ended_at: null });
    }

    // Visit A, linked through its triage record: its close (with an outcome) ends the stay and frees the space.
    const own = await encounter(pg, { hospitalId: h, patientUserId: p, clinicianUserId: doctor });
    await pg.query(
      `UPDATE public.encounters SET triage_record_id = (SELECT id FROM public.triage_records WHERE intake_id = $2)
        WHERE id = $1`,
      [own, i],
    );
    expect(await fn("end_eu_stay", end(own))).toEqual({ ended: true, stay_id: r.stay_id });
    const after = await held();
    expect(after).toMatchObject({ status: "ended", encounter_id: own });
    expect(after.ended_at).not.toBeNull();
  });

  /* R65 follow-up: the doctor's queue start links the visit only by stamping the intake (patient_intakes.encounter_id),
     with no visit_id or triage record on the encounter. That encounter adopts and ends its triage stay. */
  it("the encounter the intake names (the queue start) adopts and ends its triage stay; another does not", async () => {
    const { ward, beds } = await newWard({ R1: "resus" });
    const { p, i } = await triaged(2);
    const r = await call({ hospital_id: h, intake_id: i, bed_id: beds["R1"], actor: nurse });
    const fn = async (name: string, payload: Record<string, unknown>) => {
      try {
        return (
          await pg.query<{ r: Record<string, unknown> }>(`SELECT public.${name}($1::jsonb) AS r`, [
            JSON.stringify(payload),
          ])
        ).rows[0]!.r;
      } catch (e) {
        return (e as Error).message;
      }
    };
    const queued = await encounter(pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: doctor,
    });
    await pg.query(`UPDATE public.patient_intakes SET encounter_id = $2 WHERE id = $1`, [
      i,
      queued,
    ]);
    const other = await encounter(pg, { hospitalId: h, patientUserId: p, clinicianUserId: doctor });
    const end = (e: string) => ({
      encounter_id: e,
      actor: doctor,
      end_kind: "home",
      disposition: "home",
    });

    expect(await fn("end_eu_stay", end(other))).toEqual({ ended: false });
    expect(
      await fn("observe_in_eu", {
        encounter_id: other,
        actor: doctor,
        ward_id: ward,
        bed_id: beds["R1"],
      }),
    ).toBe("EU409 This patient is already in the EU.");

    expect(
      await fn("observe_in_eu", {
        encounter_id: queued,
        actor: doctor,
        ward_id: ward,
        bed_id: beds["R1"],
      }),
    ).toMatchObject({ stay_id: r.stay_id, adopted: true, bed: "R1" });
    expect(await fn("end_eu_stay", end(queued))).toEqual({ ended: true, stay_id: r.stay_id });
    expect(
      await row(
        `SELECT s.status, s.encounter_id, a.ended_at IS NOT NULL AS freed
           FROM public.eu_stays s JOIN public.bed_assignments a ON a.eu_stay_id = s.id WHERE s.id = $1`,
        [r.stay_id],
      ),
    ).toEqual({ status: "ended", encounter_id: queued, freed: true });
  });

  it("an unadopted triage stay ends with the queue-start encounter's close", async () => {
    const { beds } = await newWard({ R1: "resus" });
    const { p, i } = await triaged(1);
    const r = await call({ hospital_id: h, intake_id: i, bed_id: beds["R1"], actor: nurse });
    const queued = await encounter(pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: doctor,
    });
    await pg.query(`UPDATE public.patient_intakes SET encounter_id = $2 WHERE id = $1`, [
      i,
      queued,
    ]);
    expect(
      (
        await pg.query<{ r: unknown }>(`SELECT public.end_eu_stay($1::jsonb) AS r`, [
          JSON.stringify({
            encounter_id: queued,
            actor: doctor,
            end_kind: "died",
            disposition: "deceased",
          }),
        ])
      ).rows[0]!.r,
    ).toEqual({ ended: true, stay_id: r.stay_id });
  });

  it("adoption through the triage record (no visit_id) keeps the space", async () => {
    const { ward, beds } = await newWard({ R1: "resus" });
    const { p, i } = await triaged(2);
    const r = await call({ hospital_id: h, intake_id: i, bed_id: beds["R1"], actor: nurse });
    const e = await encounter(pg, { hospitalId: h, patientUserId: p, clinicianUserId: doctor });
    await pg.query(
      `UPDATE public.encounters SET triage_record_id = (SELECT id FROM public.triage_records WHERE intake_id = $2)
        WHERE id = $1`,
      [e, i],
    );
    const a = (
      await pg.query<{ r: Record<string, unknown> }>(
        `SELECT public.observe_in_eu($1::jsonb) AS r`,
        [JSON.stringify({ encounter_id: e, actor: doctor, ward_id: ward, bed_id: beds["R1"] })],
      )
    ).rows[0]!.r;
    expect(a).toMatchObject({ stay_id: r.stay_id, adopted: true, bed: "R1", intake_id: i });
    expect(
      (await row(`SELECT encounter_id FROM public.eu_stays WHERE id = $1`, [r.stay_id]))
        .encounter_id,
    ).toBe(e);
  });

  /* R65 review: admit_from_encounter boards a triage stay only from that visit (0312 adopted any). */
  it("an unrelated visit's admission is refused and the triage stay stays unadopted; its own visit boards", async () => {
    const { beds } = await newWard({ R1: "resus" });
    const ward = await newWard({ W1: "standard" }, { type: "general" });
    const { p, i } = await triaged(2);
    const r = await call({ hospital_id: h, intake_id: i, bed_id: beds["R1"], actor: nurse });
    const admit = async (e: string) => {
      try {
        return (
          await pg.query<{ r: Record<string, unknown> }>(
            `SELECT public.admit_from_encounter($1::jsonb) AS r`,
            [
              JSON.stringify({
                encounter_id: e,
                actor: doctor,
                ward_id: ward.ward,
                bed_wait_reason: "no_free_bed",
              }),
            ],
          )
        ).rows[0]!.r;
      } catch (err) {
        return (err as Error).message;
      }
    };
    const other = await encounter(pg, { hospitalId: h, patientUserId: p, clinicianUserId: doctor });
    expect(await admit(other)).toBe(
      "AD409 This patient is in the emergency unit on another visit. Admit them from that visit.",
    );
    expect(
      await row(
        `SELECT s.encounter_id, s.admission_id, s.status,
                (SELECT count(*)::int FROM public.admissions a WHERE a.patient_user_id = s.patient_user_id) AS adms
           FROM public.eu_stays s WHERE s.id = $1`,
        [r.stay_id],
      ),
    ).toEqual({ encounter_id: null, admission_id: null, status: "in_space", adms: 0 });

    // The queue start's encounter (the intake names it) is this visit's: the stay boards for its admission.
    const own = await encounter(pg, { hospitalId: h, patientUserId: p, clinicianUserId: doctor });
    await pg.query(`UPDATE public.patient_intakes SET encounter_id = $2 WHERE id = $1`, [i, own]);
    const a = await admit(own);
    expect(a).toMatchObject({ admission_id: expect.any(String) });
    expect(
      await row(`SELECT encounter_id, admission_id, status FROM public.eu_stays WHERE id = $1`, [
        r.stay_id,
      ]),
    ).toEqual({
      encounter_id: own,
      admission_id: (a as Record<string, unknown>).admission_id,
      status: "in_space",
    });
  });

  it("only the service role runs it", async () => {
    const direct = await probe(
      pg,
      { userId: nurse, role: "authenticated", aal: "aal2" },
      `SELECT public.send_to_eu_resus('{}'::jsonb)`,
    );
    expect(direct.ok).toBe(false);
    expect(!direct.ok && direct.error).toMatch(/permission denied/);
    const grants = await pg.query<{ grantee: string }>(
      `SELECT grantee FROM information_schema.routine_privileges
        WHERE routine_schema = 'public' AND routine_name = 'send_to_eu_resus' AND privilege_type = 'EXECUTE'`,
    );
    expect(grants.rows.map((g) => g.grantee).filter((g) => g !== "postgres")).toEqual([
      "service_role",
    ]);
  });

  it("send_to_eu_resus is an audit verb", async () => {
    await expect(
      pg.query(
        `INSERT INTO public.sa_audit_log (actor_id, action, target_kind, target_id, reason)
         VALUES ($1, 'send_to_eu_resus', 'patient_intake', $2, 'Level 2 to EU resus')`,
        [nurse, randomUUID()],
      ),
    ).resolves.toBeTruthy();
  });
});
