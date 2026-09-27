/**
 * Prescriptions from the encounter (PROMPT Phase 7, STOP 7): the 0074 prescription + its
 * medication statement in one transaction, idempotent replay, the prescribing engine's checks re-run
 * on the server with a recorded reason, A2 from the encounter, and who may not prescribe. Runs only
 * with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane } from "./_pglite";
import type { EmrActor } from "@/lib/emr/actor";
import type { WriteCtx } from "@/lib/emr/write/context";
import type { PrescribeInput } from "@/lib/emr/write/prescriptions";
import type { EmergencyDrug } from "@/lib/prescribing/reference/emergency-drug-catalog";
import { beforeAll, describe, expect, it } from "vitest";

import { withPatientWrite } from "@/lib/emr/write/context";
import { recordAllergy, recordObservations, recordPregnancy } from "@/lib/emr/write/facts";
import {
  encounterPrescriptions,
  loadPrescribePatient,
  prescribe,
  prescriptionsForCosign,
  withdrawReturnedPrescription,
} from "@/lib/emr/write/prescriptions";
import { decrypt, generateKey } from "@/lib/encryption";
import { PAEDIATRIC_AGE_THRESHOLD } from "@/lib/prescribing/engine";
import { EMERGENCY_DRUGS as CATALOG } from "@/lib/prescribing/reference/emergency-drug-catalog";
import {
  bootLane,
  clinician,
  department,
  encounter,
  hospital,
  intake,
  laneOn,
  patient,
  probe,
  reception,
} from "./_pglite";

const key = () => `k-${randomUUID()}`;
const REASON = "Benefit outweighs the documented reaction";
/** The catalog's own mg reference, fed back to its own range check: never a remembered number. */
const EMERGENCY_DRUGS: readonly EmergencyDrug[] = CATALOG;
const refMg = (d: EmergencyDrug) => d.unitDoseMg ?? d.doseRangeMg?.low;
/** An oral, mg-referenced, non-controlled entry with no look-alike guard: a clean prescription. */
const ORAL = EMERGENCY_DRUGS.find(
  (d) => d.adult?.route.includes("oral") && refMg(d) != null && !d.controlled && !d.lookAlikeGuard,
)!;
const CONTROLLED = EMERGENCY_DRUGS.find((d) => d.controlled && !d.recordOnly && d.adult)!;
const WEIGHT_BASED = EMERGENCY_DRUGS.find(
  (d) => d.adult && d.paediatric.weightBased && d.unitDoseMg != null,
)!;

describe.skipIf(!laneOn)("prescriptions from the encounter (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let dept: string;
  let mo: EmrActor;
  let intern: EmrActor;
  let nurse: EmrActor;
  let lab: EmrActor;
  let desk: EmrActor;
  let stranger: EmrActor;
  let unset: EmrActor; // a medical officer at a hospital with no co-sign policy rows

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await lane.pg.query<T>(sql, params)).rows;

  const actor = (
    s: { userId: string; affiliationId: string },
    cadreCode: string,
    o: Partial<EmrActor> = {},
  ): EmrActor => ({
    userId: s.userId,
    affiliationId: s.affiliationId,
    fullName: null,
    hospitalId: h,
    departmentId: dept,
    cadreCode,
    isClinical: true,
    surface: "doctor",
    ...o,
  });

  async function policy(hospitalId: string, cadre: string, kind: string, requirement: string) {
    await q(
      `INSERT INTO public.clinical_cosign_policies (hospital_id, cadre_code, action_kind, requirement)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (hospital_id, COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    cadre_code, action_kind) DO UPDATE SET requirement = EXCLUDED.requirement`,
      [hospitalId, cadre, kind, requirement],
    );
  }

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    lane = await bootLane();
    h = await hospital(lane.pg);
    dept = await department(lane.pg, h);
    mo = actor(await clinician(lane.pg, { hospitalId: h, departmentId: dept }), "MEDICAL_OFFICER");
    intern = actor(
      await clinician(lane.pg, { hospitalId: h, departmentId: dept, cadre: "INTERN_DOCTOR" }),
      "INTERN_DOCTOR",
    );
    nurse = actor(
      await clinician(lane.pg, { hospitalId: h, departmentId: dept, cadre: "NURSE" }),
      "NURSE",
      { surface: "nurse" },
    );
    lab = actor(
      await clinician(lane.pg, { hospitalId: h, departmentId: dept, cadre: "LAB_TECH" }),
      "LAB_TECH",
      { surface: "lab" },
    );
    desk = actor(await reception(lane.pg, { hospitalId: h, departmentId: dept }), "RECEPTION", {
      isClinical: false,
    });
    // The 0030 seed shape: MO routine allowed, controlled co-signed; intern routine co-signed,
    // controlled blocked.
    await policy(h, "MEDICAL_OFFICER", "prescription_routine", "allowed");
    await policy(h, "MEDICAL_OFFICER", "prescription_controlled", "cosign_required");
    await policy(h, "INTERN_DOCTOR", "prescription_routine", "cosign_required");
    await policy(h, "INTERN_DOCTOR", "prescription_controlled", "blocked");
    const other = await hospital(lane.pg, "Other");
    const otherDept = await department(lane.pg, other);
    stranger = {
      ...actor(
        await clinician(lane.pg, { hospitalId: other, departmentId: otherDept }),
        "MEDICAL_OFFICER",
      ),
      hospitalId: other,
      departmentId: otherDept,
    };
    await policy(other, "MEDICAL_OFFICER", "prescription_routine", "allowed");
    const bare = await hospital(lane.pg, "No policy");
    // 0075 seeds every new hospital; remove them to keep a hospital with no policy at all.
    await q(`DELETE FROM public.clinical_cosign_policies WHERE hospital_id = $1`, [bare]);
    const bareDept = await department(lane.pg, bare);
    unset = {
      ...actor(
        await clinician(lane.pg, { hospitalId: bare, departmentId: bareDept }),
        "MEDICAL_OFFICER",
      ),
      hospitalId: bare,
      departmentId: bareDept,
    };
  }, 180_000);

  async function visit(hospitalId = h, clinicianUserId = mo.userId, departmentId = dept) {
    const p = await patient(lane.pg);
    await intake(lane.pg, { hospitalId, patientUserId: p });
    const enc = await encounter(lane.pg, {
      hospitalId,
      patientUserId: p,
      clinicianUserId,
      departmentId,
    });
    return { p, enc };
  }
  const as = <T>(a: EmrActor, p: string, fn: (ctx: WriteCtx) => Promise<T>) =>
    withPatientWrite(a, p, fn, { database: lane.db });
  const rx = (p: string, enc: string, o: Partial<PrescribeInput> = {}): PrescribeInput => ({
    patientUserId: p,
    encounterId: enc,
    clientKey: key(),
    drugId: ORAL.id,
    doseMg: refMg(ORAL),
    route: "oral",
    concentration: "Tablets",
    frequency: "Once daily",
    duration: "5 days",
    quantity: "As written",
    instructions: "Take with food",
    ...o,
  });

  it("writes the prescription and its prescribed_here statement together", async () => {
    const { p, enc } = await visit();
    const r = await as(mo, p, (ctx) => prescribe(ctx, rx(p, enc)));
    const [row] = await q<Record<string, unknown>>(`SELECT * FROM prescriptions WHERE id = $1`, [
      r.id,
    ]);
    expect(row).toMatchObject({
      encounter_id: enc,
      prescriber_user_id: mo.userId,
      prescriber_cadre: "MEDICAL_OFFICER",
      drug_id: ORAL.id,
      dose: `${refMg(ORAL)} mg`,
      route: "oral",
      frequency: "Once daily",
      duration: "5 days",
      is_emergency: false,
      sensitivity: "standard",
      confirmed_flags: [],
      confirm_reason_ciphertext: null,
      medication_statement_id: r.statementId,
    });
    expect(decrypt(row!.instructions_ciphertext as string)).toBe("Take with food");
    const [st] = await q(`SELECT * FROM medication_statements WHERE id = $1`, [r.statementId]);
    expect(st).toMatchObject({
      encounter_id: enc,
      drug_code: ORAL.drugKey,
      medication_source: "prescribed_here",
      medication_status: "active",
      route: "oral",
    });
    // Audited as the prescriber (0039's trigger).
    const audit = await q<{ actor_id: string }>(
      `SELECT actor_id FROM audit_log WHERE table_name = 'prescriptions' AND record_id = $1::text`,
      [r.id],
    );
    expect(audit.map((a) => a.actor_id)).toEqual([mo.userId]);
  });

  it("is one transaction: a failed prescription insert leaves no statement", async () => {
    const { p, enc } = await visit();
    await lane.pg.exec(`
      CREATE FUNCTION public._lane_refuse() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN RAISE EXCEPTION 'lane: refused'; END $$;
      CREATE TRIGGER _lane_refuse BEFORE INSERT ON public.prescriptions
        FOR EACH ROW EXECUTE FUNCTION public._lane_refuse();`);
    const input = rx(p, enc);
    try {
      await expect(as(mo, p, (ctx) => prescribe(ctx, input))).rejects.toThrow(
        /insert into "prescriptions"/,
      );
    } finally {
      await lane.pg.exec(`DROP TRIGGER _lane_refuse ON public.prescriptions;
        DROP FUNCTION public._lane_refuse();`);
    }
    expect(await q(`SELECT 1 FROM medication_statements WHERE patient_user_id = $1`, [p])).toEqual(
      [],
    );
  });

  it("replays a client key: one prescription, one statement", async () => {
    const { p, enc } = await visit();
    const input = rx(p, enc);
    const a = await as(mo, p, (ctx) => prescribe(ctx, input));
    const b = await as(mo, p, (ctx) => prescribe(ctx, input));
    expect(b).toMatchObject({ id: a.id, statementId: a.statementId });
    expect(await q(`SELECT 1 FROM prescriptions WHERE patient_user_id = $1`, [p])).toHaveLength(1);
    expect(
      await q(`SELECT 1 FROM medication_statements WHERE patient_user_id = $1`, [p]),
    ).toHaveLength(1);
  });

  it("A2 from the encounter: a resus AMPLE allergy blocks the same drug here until a reason is given", async () => {
    const { p, enc } = await visit();
    // The AMPLE capture as the resus desk writes it through (actions-survey ampleToRecord): a nurse,
    // no encounter, the substance as typed, provenance on the timeline note.
    const [ep] = await q<{ id: string }>(
      `INSERT INTO public.resus_episodes (hospital_id, department_id, patient_user_id, trigger_kind, state, opened_by_user_id)
       VALUES ($1, $2, $3, 'triage_red', 'active', $4) RETURNING id`,
      [h, dept, p, nurse.userId],
    );
    const [note] = await q<{ id: string }>(
      `INSERT INTO public.resus_timeline_events (episode_id, kind, recorded_by_user_id, payload)
       VALUES ($1, 'note', $2, $3) RETURNING id`,
      [ep!.id, nurse.userId, JSON.stringify({ allergyCapture: { substances: [ORAL.name] } })],
    );
    await as(nurse, p, (ctx) =>
      recordAllergy(ctx, {
        patientUserId: p,
        encounterId: null,
        clientKey: `ample:${note!.id}:0`,
        substance: { text: ORAL.name },
        informant: "patient",
        legacyRef: { table: "resus_timeline_events", id: note!.id, index: "0" },
      }),
    );

    const input = rx(p, enc);
    await expect(as(mo, p, (ctx) => prescribe(ctx, input))).rejects.toThrow(
      /Documented allergy.*Record your reason/,
    );
    expect(await q(`SELECT 1 FROM prescriptions WHERE patient_user_id = $1`, [p])).toEqual([]);

    const r = await as(mo, p, (ctx) => prescribe(ctx, { ...input, confirmReason: REASON }));
    const [row] = await q<{ confirmed_flags: string[]; confirm_reason_ciphertext: string }>(
      `SELECT confirmed_flags, confirm_reason_ciphertext FROM prescriptions WHERE id = $1`,
      [r.id],
    );
    expect(row!.confirmed_flags).toContain("allergy");
    expect(decrypt(row!.confirm_reason_ciphertext)).toBe(REASON);
  });

  it("0074 RLS: the reader sees it with a basis; a stranger and a patient's restricted row do not", async () => {
    const { p, enc } = await visit();
    const r = await as(mo, p, (ctx) => prescribe(ctx, rx(p, enc)));
    const sql = `SELECT id FROM public.prescriptions WHERE id = $1`;
    const rows = async (a: Parameters<typeof probe>[1]) => {
      const res = await probe(lane.pg, a, sql, [r.id]);
      return res.ok ? res.rows.length : res.error;
    };
    expect(await rows({ userId: mo.userId, role: "medsync_clinical_reader", hospitalId: h })).toBe(
      1,
    );
    expect(
      await rows({
        userId: stranger.userId,
        role: "medsync_clinical_reader",
        hospitalId: stranger.hospitalId,
      }),
    ).toBe(0);
    expect(await rows({ userId: p, role: "authenticated" })).toBe(1);
    await q(`UPDATE prescriptions SET sensitivity = 'restricted' WHERE id = $1`, [r.id]);
    expect(await rows({ userId: p, role: "authenticated" })).toBe(0);
  });

  it("the database refuses a confirmed check without its reason", async () => {
    const { p, enc } = await visit();
    await expect(
      q(
        `INSERT INTO prescriptions (hospital_id, encounter_id, patient_user_id, prescriber_user_id, drug_id, drug_name,
           dose, route, is_emergency, confirmed_flags)
         VALUES ($1, $2, $3, $4, 'x', 'x', 'x', 'oral', false, '["allergy"]')`,
        [h, enc, p, mo.userId],
      ),
    ).rejects.toThrow(/prescriptions_confirm_reason/);
  });

  it("the engine's age, weight and pregnancy come from the record; a hard block stays hard", async () => {
    const { p, enc } = await visit();
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - Math.floor(PAEDIATRIC_AGE_THRESHOLD / 2));
    await q(
      `INSERT INTO public.patient_profiles (id, first_name_encrypted, surname_encrypted, sex, date_of_birth, id_type,
         phone_encrypted, district_id)
       VALUES ($1, 'iv:tag:ct', 'iv:tag:ct', 'female', $2, 'none', 'iv:tag:ct',
               (SELECT id FROM public.districts LIMIT 1))`,
      [p, dob.toISOString().slice(0, 10)],
    );
    // No weight: the engine's weight_missing block is not overrideable, reason or not.
    await expect(
      as(mo, p, (ctx) =>
        prescribe(
          ctx,
          rx(p, enc, {
            drugId: WEIGHT_BASED.id,
            doseMg: WEIGHT_BASED.unitDoseMg,
            route: WEIGHT_BASED.adult!.route[0]!,
            confirmReason: REASON,
          }),
        ),
      ),
    ).rejects.toThrow(/weight is required/);

    await as(nurse, p, (ctx) =>
      recordObservations(ctx, {
        patientUserId: p,
        encounterId: enc,
        clientKey: key(),
        observations: [
          { conceptId: "obs.weight", value: { type: "quantity", value: 20, unit: "kg" } },
        ],
      }),
    );
    await as(mo, p, (ctx) =>
      recordPregnancy(ctx, { patientUserId: p, clientKey: key(), pregnancyState: "pregnant" }),
    );
    const patientIn = await as(mo, p, (ctx) => loadPrescribePatient(ctx.tx, p, new Date()));
    expect(patientIn).toMatchObject({
      ageYears: Math.floor(PAEDIATRIC_AGE_THRESHOLD / 2),
      weightKg: 20,
      conditions: ["pregnancy"],
      // No allergy and no NKDA assertion: unknown, never "no allergy".
      allergyStatus: "not_recorded",
    });
  });

  it("another hospital's pregnancy stays at that hospital; its allergies still reach the check", async () => {
    const { p } = await visit();
    await visit(stranger.hospitalId, stranger.userId, stranger.departmentId!).then(({ enc }) =>
      q(`UPDATE encounters SET patient_user_id = $1 WHERE id = $2`, [p, enc]),
    );
    await as(stranger, p, (ctx) =>
      recordPregnancy(ctx, { patientUserId: p, clientKey: key(), pregnancyState: "pregnant" }),
    );
    await as(stranger, p, (ctx) =>
      recordAllergy(ctx, {
        patientUserId: p,
        encounterId: null,
        clientKey: key(),
        substance: { text: "Penicillin" },
        informant: "patient",
      }),
    );
    const here = await as(mo, p, (ctx) => loadPrescribePatient(ctx.tx, p, new Date()));
    expect(here.conditions).toEqual([]);
    expect(here.allergies.join(" ")).toMatch(/Penicillin/i);
    const there = await as(stranger, p, (ctx) => loadPrescribePatient(ctx.tx, p, new Date()));
    expect(there.conditions).toEqual(["pregnancy"]);
  });

  it("co-sign policy: an intern's routine prescription waits for a senior; controlled is blocked", async () => {
    const { p, enc } = await visit();
    const r = await as(intern, p, (ctx) => prescribe(ctx, rx(p, enc)));
    expect(r.warnings).toEqual(["Awaiting senior co-sign."]);
    const [req] = await q<{ action_kind: string; action_payload: unknown }>(
      `SELECT action_kind, action_payload FROM clinical_cosign_requests WHERE patient_user_id = $1`,
      [p],
    );
    expect(req).toEqual({
      action_kind: "prescription_routine",
      action_payload: { prescriptionId: r.id, encounterId: enc },
    });
    await expect(
      as(intern, p, (ctx) =>
        prescribe(
          ctx,
          rx(p, enc, {
            drugId: CONTROLLED.id,
            doseMg: CONTROLLED.unitDoseMg,
            dose: "As written",
            route: CONTROLLED.adult!.route[0]!,
            confirmReason: REASON,
          }),
        ),
      ),
    ).rejects.toThrow(/above your scope/);
  });

  it("a returned co-sign is not valid: marked on the desk, withheld from the printout; the queue sees the drug", async () => {
    const { p, enc } = await visit();
    const r = await as(intern, p, (ctx) => prescribe(ctx, rx(p, enc)));
    const read = (forPrint?: boolean) =>
      as(mo, p, (ctx) =>
        encounterPrescriptions(ctx.tx, {
          hospitalId: h,
          patientUserId: p,
          encounterId: enc,
          forPrint,
        }),
      );
    expect(await read()).toMatchObject([{ id: r.id, awaitingCosign: true, cosignWithheld: false }]);
    expect(await read(true)).toHaveLength(1);
    // The request's payload is PHI-free: the senior's queue resolves the drug here, same hospital only.
    const shown = await as(mo, p, (ctx) => prescriptionsForCosign(ctx.tx, h, [r.id]));
    expect(shown.get(r.id)).toMatchObject({
      drugName: ORAL.name,
      dose: `${refMg(ORAL)} mg`,
      route: "oral",
      frequency: "Once daily",
      duration: "5 days",
    });
    const elsewhere = await as(mo, p, (ctx) =>
      prescriptionsForCosign(ctx.tx, stranger.hospitalId, [r.id]),
    );
    expect(elsewhere.size).toBe(0);

    await q(
      `UPDATE clinical_cosign_requests SET state = 'returned', reviewed_by_user_id = $2,
         reviewed_at = now(), review_note = 'Not indicated here'
       WHERE patient_user_id = $1`,
      [p, mo.userId],
    );
    expect(await read()).toMatchObject([{ id: r.id, awaitingCosign: false, cosignWithheld: true }]);
    expect(await read(true)).toEqual([]);

    // The return withdraws it: the prescription is cancelled and its statement stopped (a new
    // version), so the chart no longer lists the drug as current. Replaying changes nothing.
    const [req] = await q<{ id: string }>(
      `SELECT id FROM clinical_cosign_requests WHERE patient_user_id = $1`,
      [p],
    );
    const withdraw = () =>
      as(mo, p, (ctx) =>
        withdrawReturnedPrescription(ctx, {
          patientUserId: p,
          prescriptionId: r.id,
          cosignRequestId: req!.id,
        }),
      );
    await withdraw();
    await withdraw();
    const [rxRow] = await q<{ state: string }>(`SELECT state FROM prescriptions WHERE id = $1`, [
      r.id,
    ]);
    expect(rxRow!.state).toBe("cancelled");
    const versions = await q<{
      version: number;
      medication_status: string;
      reason_code: string | null;
    }>(
      `SELECT version, medication_status, reason_code FROM medication_statements
        WHERE logical_id = (SELECT logical_id FROM medication_statements WHERE id = $1)
        ORDER BY version`,
      [r.statementId],
    );
    expect(versions).toEqual([
      { version: 1, medication_status: "active", reason_code: null },
      { version: 2, medication_status: "stopped", reason_code: "cosign_returned" },
    ]);
  });

  it("refuses those who may not prescribe, and fails closed with no policy", async () => {
    const { p, enc } = await visit();
    for (const who of [nurse, lab]) {
      await expect(as(who, p, (ctx) => prescribe(ctx, rx(p, enc)))).rejects.toThrow(
        /may not prescribe/,
      );
    }
    await expect(as(desk, p, (ctx) => prescribe(ctx, rx(p, enc)))).rejects.toThrow(
      /Not a clinical role/,
    );
    await expect(as(stranger, p, (ctx) => prescribe(ctx, rx(p, enc)))).rejects.toThrow(
      /No legitimate clinical access/,
    );
    const bare = await visit(unset.hospitalId, unset.userId, unset.departmentId!);
    await expect(as(unset, bare.p, (ctx) => prescribe(ctx, rx(bare.p, bare.enc)))).rejects.toThrow(
      /above your scope/,
    );
    expect(await q(`SELECT 1 FROM prescriptions WHERE patient_user_id = $1`, [p])).toEqual([]);
  });

  it("a closed encounter takes no prescription", async () => {
    const p = await patient(lane.pg);
    await intake(lane.pg, { hospitalId: h, patientUserId: p });
    await encounter(lane.pg, { hospitalId: h, patientUserId: p, clinicianUserId: mo.userId });
    const closed = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: mo.userId,
      state: "completed",
    });
    await expect(as(mo, p, (ctx) => prescribe(ctx, rx(p, closed)))).rejects.toThrow(/closed/);
  });
});
