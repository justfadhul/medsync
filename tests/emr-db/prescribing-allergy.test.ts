/**
 * Every prescribe path reads the allergy record (HARMONISATION §5.5, A2 core) and the server re-runs
 * the allergy check on an emergency administration (Phase 0 safety finding). PGlite lane: the real
 * 0071 tables and the real 0071 backfill SQL. Runs only with EMR_PGLITE=1.
 */
import type { Lane } from "./_pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { loadAllergyInput } from "@/lib/emr/read/allergies";
import { encrypt, generateKey } from "@/lib/encryption";
import { recordedAllergiesFromTimeline } from "@/lib/prescribing/administration";
import { allergyRecheck, mergeAllergyLists } from "@/lib/prescribing/allergy-merge";
import { EMERGENCY_DRUGS } from "@/lib/prescribing/reference/emergency-drug-catalog";
import {
  bootLane,
  clinician,
  department,
  hospital,
  laneOn,
  patient,
  readMigration,
} from "./_pglite";

const drug = (key: string) => EMERGENCY_DRUGS.find((d) => d.drugKey === key)!;
const REASON = "Benefit outweighs the documented reaction";

/** 0071's own backfill (patient_allergies and resus AMPLE captures), re-run as shipped. */
function backfillSql(): string {
  const sql = readMigration("0071_emr_record_spine.sql");
  const from = sql.indexOf("-- (a) patient_allergies");
  const end = "DROP TABLE _emr_resus_caps;";
  return sql.slice(from, sql.indexOf(end, from) + end.length);
}

describe.skipIf(!laneOn)("prescribing reads the allergy record (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let other: string;
  let nurse: string;

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    lane = await bootLane();
    h = await hospital(lane.pg);
    other = await hospital(lane.pg, "Other hospital");
    const dept = await department(lane.pg, h);
    nurse = (await clinician(lane.pg, { hospitalId: h, departmentId: dept, cadre: "NURSE" }))
      .userId;
  }, 180_000);

  async function allergyRow(o: {
    patientUserId: string;
    hospitalId: string;
    code?: string;
    text?: string;
  }): Promise<void> {
    await lane.pg.query(
      `WITH n AS (SELECT gen_random_uuid() AS id)
       INSERT INTO public.allergies (id, logical_id, hospital_id, patient_user_id, effective_at, recorded_by_user_id,
         source, trust, substance_kind, substance_code, substance_text_ciphertext, informant)
       SELECT n.id, n.id, $1, $2, now(), $3, 'clinician', 3, $4, $5, $6, 'patient' FROM n`,
      [
        o.hospitalId,
        o.patientUserId,
        nurse,
        o.code ? "drug_ingredient" : null,
        o.code ?? null,
        o.text ? encrypt(o.text) : null,
      ],
    );
  }

  async function episode(p: string, state = "active"): Promise<string> {
    const r = await lane.pg.query<{ id: string }>(
      `INSERT INTO public.resus_episodes (hospital_id, patient_user_id, trigger_kind, state, opened_by_user_id)
       VALUES ($1, $2, 'triage_red', $3, $4) RETURNING id`,
      [h, p, state, nurse],
    );
    return r.rows[0]!.id;
  }

  async function capture(episodeId: string, substances: string[], nkda = false): Promise<void> {
    await lane.pg.query(
      `INSERT INTO public.resus_timeline_events (episode_id, kind, recorded_by_user_id, payload)
       VALUES ($1, 'note', $2, $3::jsonb)`,
      [episodeId, nurse, JSON.stringify({ allergyCapture: { substances, nkda } })],
    );
  }

  it("an allergy recorded in the allergies table reaches the resus check, from any hospital", async () => {
    const p = await patient(lane.pg);
    await allergyRow({ patientUserId: p, hospitalId: other, code: "amiodarone" });
    await allergyRow({ patientUserId: p, hospitalId: h, text: "Atropine" });

    const input = await loadAllergyInput(lane.db, p);
    expect(input.allergies).toEqual(expect.arrayContaining(["amiodarone", "Atropine"]));
    expect(input.entries.find((e) => e.value === "amiodarone")).toMatchObject({
      coded: true,
      hospitalId: other,
    });
    expect(input.status.kind).toBe("listed");

    expect(allergyRecheck(drug("amiodarone"), input.allergies, undefined).refusal).toMatch(
      /Documented allergy/,
    );
    expect(allergyRecheck(drug("atropine"), input.allergies, "  ").refusal).not.toBeNull();
    expect(allergyRecheck(drug("lidocaine"), input.allergies, undefined)).toEqual({
      matched: false,
      refusal: null,
    });
  });

  it("the server refuses an allergy-matching administration without an override reason", async () => {
    const p = await patient(lane.pg);
    await allergyRow({ patientUserId: p, hospitalId: h, code: "adrenaline" });
    const allergies = mergeAllergyLists(
      recordedAllergiesFromTimeline([]),
      (await loadAllergyInput(lane.db, p)).allergies,
    );
    expect(allergyRecheck(drug("adrenaline"), allergies, undefined).refusal).not.toBeNull();
    expect(allergyRecheck(drug("adrenaline"), allergies, REASON)).toEqual({
      matched: true,
      refusal: null,
    });
  });

  it("A2: a backfilled resus capture from an EARLIER episode is seen by a later episode's check", async () => {
    const p = await patient(lane.pg);
    await capture(await episode(p, "concluded"), ["Lidocaine"]);
    await lane.pg.exec(backfillSql());
    const later = await episode(p);

    // The later episode has no capture of its own: only the record can carry the allergy.
    const { rows } = await lane.pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.resus_timeline_events WHERE episode_id = $1`,
      [later],
    );
    expect(rows[0]!.n).toBe(0);
    const input = await loadAllergyInput(lane.db, p, recordedAllergiesFromTimeline([]));
    expect(input.allergies).toEqual(["Lidocaine"]);
    expect(input.entries[0]!.label).toMatch(/name only/);
    expect(allergyRecheck(drug("lidocaine"), input.allergies, undefined).refusal).not.toBeNull();
  });

  it("backfilled patient_allergies text and a backfilled NKDA read through", async () => {
    const p = await patient(lane.pg);
    await lane.pg.query(
      `INSERT INTO public.patient_allergies (hospital_id, patient_user_id, substance, recorded_by_user_id)
       VALUES ($1, $2, 'Magnesium', $3)`,
      [h, p, nurse],
    );
    const q = await patient(lane.pg);
    await capture(await episode(q, "concluded"), [], true);
    await lane.pg.exec(backfillSql());

    expect((await loadAllergyInput(lane.db, p)).allergies).toEqual(["Magnesium"]);
    const nkda = await loadAllergyInput(lane.db, q);
    expect(nkda.allergies).toEqual([]);
    expect(nkda.status.kind).toBe("no_known_drug_allergies");
  });
});
