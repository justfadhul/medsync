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

describe.skipIf(!laneOn)("0313 — a resus bay and a care unit point at the drawn EU (D7)", () => {
  let pg: Pg;
  let h: string;
  let h2: string;
  let dept: string;

  beforeAll(async () => {
    pg = (await bootLane()).pg;
    h = await hospital(pg, "EU links");
    h2 = await hospital(pg, "Elsewhere links");
    dept = await department(pg, h);
  }, BOOT_MS);

  async function ward(hid: string, type: string, beds: Record<string, string>) {
    const s = randomUUID().slice(0, 8);
    const w = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.hospital_wards (hospital_id, department_id, name, slug, bed_count, ward_type)
         VALUES ($1, $2, $3, $4, $6, $5) RETURNING id`,
        [
          hid,
          hid === h ? dept : await department(pg, hid),
          `W ${s}`,
          `w-${s}`,
          type,
          Object.keys(beds).length,
        ],
      )
    ).rows[0]!.id;
    const ids: Record<string, string> = {};
    for (const [label, bt] of Object.entries(beds))
      ids[label] = (
        await pg.query<{ id: string }>(
          `INSERT INTO public.hospital_beds (hospital_id, ward_id, label, bed_type) VALUES ($1,$2,$3,$4) RETURNING id`,
          [hid, w, label, bt],
        )
      ).rows[0]!.id;
    return { w, ids };
  }
  const bay = async (hid: string) =>
    (
      await pg.query<{ id: string }>(
        `INSERT INTO public.resus_bay_profiles (hospital_id, bay_label) VALUES ($1, $2) RETURNING id`,
        [hid, `Bay ${randomUUID().slice(0, 6)}`],
      )
    ).rows[0]!.id;
  const unit = async (hid: string) =>
    (
      await pg.query<{ id: string }>(
        `INSERT INTO public.hospital_care_units (hospital_id, name, unit_type) VALUES ($1, $2, 'ward') RETURNING id`,
        [hid, `Unit ${randomUUID().slice(0, 6)}`],
      )
    ).rows[0]!.id;
  const fails = async (sql: string, params: unknown[]) => {
    try {
      await pg.query(sql, params);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error("expected a refusal");
  };
  const linkBay = (b: string, bed: string | null) =>
    pg.query(`UPDATE public.resus_bay_profiles SET bed_id = $2 WHERE id = $1`, [b, bed]);

  it("a bay links to a resus space of an EU of its hospital, and clears", async () => {
    const eu = await ward(h, "emergency_observation", { R1: "resus" });
    const b = await bay(h);
    await linkBay(b, eu.ids.R1!);
    const r = await pg.query<{ bed_id: string | null }>(
      `SELECT bed_id FROM public.resus_bay_profiles WHERE id = $1`,
      [b],
    );
    expect(r.rows[0]!.bed_id).toBe(eu.ids.R1);
    await linkBay(b, null);
  });

  it("a bay refuses another hospital's space, a non-resus space and a non-EU ward's bed", async () => {
    const other = await ward(h2, "emergency_observation", { R1: "resus" });
    const trolley = await ward(h, "emergency_observation", { T1: "couch" });
    const gen = await ward(h, "general", { R1: "resus" });
    const b = await bay(h);
    for (const bed of [other.ids.R1!, trolley.ids.T1!, gen.ids.R1!])
      expect(
        await fails(`UPDATE public.resus_bay_profiles SET bed_id = $2 WHERE id = $1`, [b, bed]),
      ).toContain("Choose a resus space of an emergency unit.");
  });

  it("one space serves one bay", async () => {
    const eu = await ward(h, "emergency_observation", { R1: "resus" });
    const a = await bay(h);
    const b = await bay(h);
    await linkBay(a, eu.ids.R1!);
    await expect(linkBay(b, eu.ids.R1!)).rejects.toThrow();
  });

  const bayLink = async (b: string) =>
    (
      await pg.query<{ bed_id: string | null }>(
        `SELECT bed_id FROM public.resus_bay_profiles WHERE id = $1`,
        [b],
      )
    ).rows[0]!.bed_id;

  it("R66: archiving the space, re-typing it (a republish) or moving it clears the bay's link", async () => {
    const eu = await ward(h, "emergency_observation", { A: "resus", T: "resus", M: "resus" });
    const other = await ward(h, "emergency_observation", { X: "standard" });
    const [a, t, m] = [await bay(h), await bay(h), await bay(h)];
    await linkBay(a, eu.ids.A!);
    await linkBay(t, eu.ids.T!);
    await linkBay(m, eu.ids.M!);
    await pg.query(`UPDATE public.hospital_beds SET archived_at = now() WHERE id = $1`, [eu.ids.A]);
    await pg.query(`UPDATE public.hospital_beds SET bed_type = 'couch' WHERE id = $1`, [eu.ids.T]);
    await pg.query(`UPDATE public.hospital_wards SET bed_count = 2 WHERE id = $1`, [other.w]);
    await pg.query(`UPDATE public.hospital_beds SET ward_id = $2 WHERE id = $1`, [
      eu.ids.M,
      other.w,
    ]);
    expect([await bayLink(a), await bayLink(t), await bayLink(m)]).toEqual([null, null, null]);
  });

  it("R66: a ward re-typed away from an emergency unit, or archived, clears its bays and units", async () => {
    const e1 = await ward(h, "emergency_observation", { R: "resus" });
    const e2 = await ward(h, "emergency_observation", { R: "resus" });
    const [b1, b2] = [await bay(h), await bay(h)];
    await linkBay(b1, e1.ids.R!);
    await linkBay(b2, e2.ids.R!);
    const g = await ward(h, "general", { B: "standard" });
    const u = await unit(h);
    await pg.query(`UPDATE public.hospital_care_units SET ward_id = $2 WHERE id = $1`, [u, g.w]);
    await pg.query(`UPDATE public.hospital_wards SET ward_type = 'general' WHERE id = $1`, [e1.w]);
    await pg.query(`UPDATE public.hospital_wards SET archived_at = now() WHERE id = $1`, [e2.w]);
    await pg.query(`UPDATE public.hospital_wards SET archived_at = now() WHERE id = $1`, [g.w]);
    expect([await bayLink(b1), await bayLink(b2)]).toEqual([null, null]);
    const r = await pg.query<{ ward_id: string | null }>(
      `SELECT ward_id FROM public.hospital_care_units WHERE id = $1`,
      [u],
    );
    expect(r.rows[0]!.ward_id).toBeNull();
  });

  it("R66: an archived space or ward is refused at link time", async () => {
    const eu = await ward(h, "emergency_observation", { R1: "resus" });
    const g = await ward(h, "general", { B1: "standard" });
    await pg.query(`UPDATE public.hospital_beds SET archived_at = now() WHERE id = $1`, [
      eu.ids.R1,
    ]);
    await pg.query(`UPDATE public.hospital_wards SET archived_at = now() WHERE id = $1`, [g.w]);
    expect(
      await fails(`UPDATE public.resus_bay_profiles SET bed_id = $2 WHERE id = $1`, [
        await bay(h),
        eu.ids.R1,
      ]),
    ).toContain("Choose a resus space of an emergency unit.");
    expect(
      await fails(`UPDATE public.hospital_care_units SET ward_id = $2 WHERE id = $1`, [
        await unit(h),
        g.w,
      ]),
    ).toContain("Choose a ward of this hospital.");
  });

  it("a care unit links to a ward of its hospital only", async () => {
    const mine = await ward(h, "general", { B1: "standard" });
    const theirs = await ward(h2, "general", { B1: "standard" });
    const u = await unit(h);
    await pg.query(`UPDATE public.hospital_care_units SET ward_id = $2 WHERE id = $1`, [u, mine.w]);
    expect(
      await fails(`UPDATE public.hospital_care_units SET ward_id = $2 WHERE id = $1`, [
        u,
        theirs.w,
      ]),
    ).toContain("Choose a ward of this hospital.");
    await pg.query(`DELETE FROM public.hospital_wards WHERE id = $1`, [mine.w]);
    const r = await pg.query<{ ward_id: string | null }>(
      `SELECT ward_id FROM public.hospital_care_units WHERE id = $1`,
      [u],
    );
    expect(r.rows[0]!.ward_id).toBeNull();
  });

  it("re-runs: the section's SQL applies twice without error, and the verbs are audit verbs", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/0313_eu_links.sql", "utf8");
    const at = sql.indexOf("-- ─── 5.");
    expect(at).toBeGreaterThan(0);
    await pg.exec(sql.slice(at));
    for (const v of ["link_resus_bay", "link_care_unit"])
      await pg.query(
        `INSERT INTO public.sa_audit_log (actor_id, action, target_kind, target_id, reason)
         VALUES ($1, $2, 'hospital', $3, 'Linked in a test')`,
        [(await staff(pg, { hospitalId: h, departmentId: dept })).userId, v, h],
      );
  });
});

describe.skipIf(!laneOn)("0313 — an EU with open stays is not archived or re-typed (R71)", () => {
  let pg: Pg;
  let h: string;
  let dept: string;
  let doctor: string;

  beforeAll(async () => {
    pg = (await bootLane()).pg;
    h = await hospital(pg, "EU open stays");
    dept = await department(pg, h);
    doctor = (await staff(pg, { hospitalId: h, departmentId: dept })).userId;
  }, BOOT_MS);

  const fails = async (sql: string, params: unknown[]) => {
    try {
      await pg.query(sql, params);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error("expected a refusal");
  };
  const WORDS =
    "EU409 Patients are in this emergency unit or waiting for a space in it. End or move their stays first.";

  /** An EU with one resus space linked to a bay, and a patient waiting there without a space. */
  async function waitingIn() {
    const s = randomUUID().slice(0, 8);
    const w = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.hospital_wards (hospital_id, department_id, name, slug, bed_count, ward_type)
         VALUES ($1, $2, $3, $4, 1, 'emergency_observation') RETURNING id`,
        [h, dept, `EU ${s}`, `eu-${s}`],
      )
    ).rows[0]!.id;
    const bed = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.hospital_beds (hospital_id, ward_id, label, bed_type) VALUES ($1, $2, 'R1', 'resus')
         RETURNING id`,
        [h, w],
      )
    ).rows[0]!.id;
    const bay = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.resus_bay_profiles (hospital_id, bay_label, bed_id) VALUES ($1, $2, $3) RETURNING id`,
        [h, `Bay ${s}`, bed],
      )
    ).rows[0]!.id;
    const e = await encounter(pg, {
      hospitalId: h,
      patientUserId: await patient(pg),
      clinicianUserId: doctor,
    });
    await pg.query(`SELECT public.observe_in_eu($1::jsonb)`, [
      JSON.stringify({
        encounter_id: e,
        actor: doctor,
        ward_id: w,
        space_wait_reason: "no_free_bed",
      }),
    ]);
    return { w, bay, e };
  }
  const bayLink = async (b: string) =>
    (
      await pg.query<{ bed_id: string | null }>(
        `SELECT bed_id FROM public.resus_bay_profiles WHERE id = $1`,
        [b],
      )
    ).rows[0]!.bed_id;

  it("archive and re-type are refused while a space-less stay is open; nothing is cleared", async () => {
    const { w, bay } = await waitingIn();
    const linked = await bayLink(bay);
    expect(linked).not.toBeNull();
    expect(
      await fails(`UPDATE public.hospital_wards SET archived_at = now() WHERE id = $1`, [w]),
    ).toBe(WORDS);
    expect(
      await fails(`UPDATE public.hospital_wards SET ward_type = 'general' WHERE id = $1`, [w]),
    ).toBe(WORDS);
    const r = await pg.query<{ archived_at: string | null; ward_type: string }>(
      `SELECT archived_at, ward_type FROM public.hospital_wards WHERE id = $1`,
      [w],
    );
    expect(r.rows[0]).toEqual({ archived_at: null, ward_type: "emergency_observation" });
    expect(await bayLink(bay)).toBe(linked);
    // An edit that keeps it an open EU still saves.
    await pg.query(
      `UPDATE public.hospital_wards SET name = name || ' A', ward_type = ward_type WHERE id = $1`,
      [w],
    );
  });

  it("once the stay ends the ward archives, and its bay link clears", async () => {
    const { w, bay, e } = await waitingIn();
    await pg.query(`SELECT public.end_eu_stay($1::jsonb)`, [
      JSON.stringify({ encounter_id: e, actor: doctor, end_kind: "home", disposition: "home" }),
    ]);
    await pg.query(`UPDATE public.hospital_wards SET archived_at = now() WHERE id = $1`, [w]);
    expect(await bayLink(bay)).toBeNull();
  });

  it("re-runs: section 6 applies twice and still refuses", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/0313_eu_links.sql", "utf8");
    const at = sql.indexOf("-- ─── 6.");
    expect(at).toBeGreaterThan(0);
    await pg.exec(sql.slice(at));
    await pg.exec(sql.slice(at));
    const { w } = await waitingIn();
    expect(
      await fails(`UPDATE public.hospital_wards SET archived_at = now() WHERE id = $1`, [w]),
    ).toBe(WORDS);
  });
});
