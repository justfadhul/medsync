/**
 * 0073 on the PGlite lane: the chart/workspace broadcasts (PHI-free, the right tables and rows
 * only, silent on a draft autosave), who may hear chart:<patient> (a basis, nothing else), and the
 * reader's last grants (encounter_medications, hospitals, column-limited patient_profiles), ending
 * with the fact loader through the reader. Runs only with EMR_PGLITE=1.
 */
import type { Lane, PgQueryable } from "./_pglite";
import type { EmrTx } from "@/lib/emr/db";
import { beforeAll, describe, expect, it } from "vitest";

import { asClinicalReader, asClinicalWriter } from "@/lib/emr/db";
import { loadFactSnapshot } from "@/lib/facts/loader";
import {
  actAs,
  bootLane,
  clinician,
  department,
  encounter,
  hospital,
  laneOn,
  patient,
  probe,
  reception,
  seedRecord,
  seedRegistries,
  staff,
} from "./_pglite";

const BOOT_MS = 180_000;
const TABLES = [
  "allergies",
  "allergy_status_assertions",
  "clinical_notes",
  "clinical_observations",
  "conditions",
  "diagnostic_reports",
  "encounter_orders",
  "result_acknowledgements",
  "specimens",
];

type Msg = { topic: string; payload: Record<string, unknown>; event: string; private: boolean };

describe.skipIf(!laneOn)("0073 realtime and reader grants", () => {
  let lane: Lane;
  let h: string;
  let other: string;
  let dept: string;
  let doc: { userId: string; affiliationId: string };
  let p: string;
  let enc: string;
  let fresh: Msg[];

  const since = async (id: number): Promise<Msg[]> =>
    (
      await lane.pg.query<Msg>(
        `SELECT topic, payload, event, private FROM realtime.messages WHERE id > $1 ORDER BY id`,
        [id],
      )
    ).rows;
  const lastId = async () =>
    Number(
      (await lane.pg.query<{ m: number | null }>(`SELECT max(id) AS m FROM realtime.messages`))
        .rows[0]?.m ?? 0,
    );

  beforeAll(async () => {
    lane = await bootLane();
    // Supabase grants the client role this table; the harness bootstrap only grants the schema.
    await lane.pg.exec(`GRANT SELECT ON realtime.messages TO authenticated`);
    h = await hospital(lane.pg);
    other = await hospital(lane.pg, "Elsewhere");
    dept = await department(lane.pg, h);
    doc = await clinician(lane.pg, { hospitalId: h, departmentId: dept });
    p = await patient(lane.pg);
    enc = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: doc.userId,
      departmentId: dept,
    });
    await seedRegistries(lane.pg, h);
    const before = await lastId();
    await seedRecord(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      encounterId: enc,
      authorId: doc.userId,
      authorAffiliationId: doc.affiliationId,
    });
    fresh = await since(before);
  }, BOOT_MS);

  it("every EMR record table broadcasts to chart:<patient> and workspace:<hospital>", () => {
    const kinds = (topic: string) =>
      [
        ...new Set(fresh.filter((m) => m.topic === topic).map((m) => String(m.payload.kind))),
      ].sort();
    expect(kinds(`chart:${p}`)).toEqual(TABLES);
    // The workspace topic also carries 0069's encounter/triage changes; every EMR table is there.
    expect(kinds(`workspace:${h}`)).toEqual(expect.arrayContaining(TABLES));
    expect(fresh.filter((m) => m.topic.startsWith("chart:")).every((m) => m.private)).toBe(true);
  });

  it("the payload is { kind, at } only: no id, value or patient leaves the database", () => {
    const chart = fresh.filter((m) => m.topic.startsWith("chart:"));
    expect(chart.length).toBeGreaterThanOrEqual(TABLES.length);
    for (const m of chart) {
      expect(Object.keys(m.payload).sort()).toEqual(["at", "kind"]);
      expect(JSON.stringify(m.payload)).not.toContain(p);
      expect(m.event).toBe("change");
    }
  });

  it("legacy rows stay silent: one broadcast for the events order, none for the legacy one", () => {
    const orders = fresh.filter(
      (m) => m.topic === `chart:${p}` && m.payload.kind === "encounter_orders",
    );
    expect(orders).toHaveLength(1);
  });

  it("a draft autosave is silent; a new note and signing are heard", async () => {
    const before = await lastId();
    const note = (
      await lane.pg.query<{ id: string }>(
        `INSERT INTO public.clinical_notes (hospital_id, patient_user_id, encounter_id, note_type, template_id,
           template_version, author_user_id, author_cadre, content_ciphertext, effective_at)
         VALUES ($1, $2, $3, 'progress', 'lane', '1', $4, 'MEDICAL_OFFICER', 'iv:tag:ct', now()) RETURNING id`,
        [h, p, enc, doc.userId],
      )
    ).rows[0]!.id;
    expect((await since(before)).filter((m) => m.topic === `chart:${p}`)).toHaveLength(1);

    const saved = await lastId();
    await lane.pg.query(
      `UPDATE public.clinical_notes SET content_ciphertext = 'iv:tag:ct2', revision = revision + 1 WHERE id = $1`,
      [note],
    );
    expect(await since(saved)).toHaveLength(0);

    await lane.pg.query(
      `UPDATE public.clinical_notes SET state = 'signed', signed_at = now(), content_hmac = 'h', hmac_key_id = 'v1'
       WHERE id = $1`,
      [note],
    );
    const signed = await since(saved);
    expect(signed.map((m) => m.topic).sort()).toEqual([`chart:${p}`, `workspace:${h}`]);
  });

  /* ─── who may hear chart:<patient> ─── */
  async function hears(userId: string, topic: string): Promise<number> {
    return actAs(lane.pg, { userId, role: "authenticated" }, async (tx: PgQueryable) => {
      await tx.query(`SELECT set_config('realtime.topic', $1, true)`, [topic]);
      const r = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM realtime.messages WHERE topic = $1`,
        [topic],
      );
      return r.rows[0]!.n;
    });
  }

  it("a clinician with a basis for the patient hears the chart", async () => {
    expect(await hears(doc.userId, `chart:${p}`)).toBeGreaterThan(0);
  });

  it("reception, another hospital's clinician and a clinician with no basis hear nothing", async () => {
    const desk = await reception(lane.pg, { hospitalId: h, departmentId: dept });
    const away = await clinician(lane.pg, {
      hospitalId: other,
      departmentId: await department(lane.pg, other),
    });
    // Same hospital and department, but no encounter, intake, assignment or recent visit with p.
    const colleague = await staff(lane.pg, {
      hospitalId: h,
      departmentId: await department(lane.pg, h, "Surgery"),
    });
    for (const u of [desk.userId, away.userId, colleague.userId])
      expect(await hears(u, `chart:${p}`), u).toBe(0);
  });

  it("a suspended affiliation hears nothing, and a malformed topic is refused without an error", async () => {
    const s = await staff(lane.pg, { hospitalId: h, departmentId: dept, state: "suspended" });
    await encounter(lane.pg, { hospitalId: h, patientUserId: p, clinicianUserId: s.userId });
    expect(await hears(s.userId, `chart:${p}`)).toBe(0);
    expect(await hears(doc.userId, "chart:not-a-uuid")).toBe(0);
    expect(await hears(doc.userId, `chart:${p}' OR true --`)).toBe(0);
  });

  it("the client role can ask only about itself: the access rule itself stays owner-only", async () => {
    const direct = await probe(
      lane.pg,
      { userId: doc.userId, role: "authenticated" },
      `SELECT private.patient_access_basis($1, $2, $3)`,
      [doc.userId, p, h],
    );
    expect(direct.ok).toBe(false);
    const own = await probe(
      lane.pg,
      { userId: doc.userId, role: "authenticated" },
      `SELECT private.may_hear_chart($1) AS ok`,
      [`chart:${p}`],
    );
    expect(own).toMatchObject({ ok: true, rows: [{ ok: true }] });
    const anon = await probe(
      lane.pg,
      { userId: null, role: "anon" },
      `SELECT private.may_hear_chart($1)`,
      [`chart:${p}`],
    );
    expect(anon.ok).toBe(false);
  });

  /* ─── the reader's grants ─── */
  const reader = (userId: string, hospitalId: string) => ({
    userId,
    role: "medsync_clinical_reader" as const,
    hospitalId,
  });

  it("patient_profiles: the loader's columns with a basis; never a name; nothing without a basis", async () => {
    await lane.pg.query(
      `INSERT INTO public.patient_profiles (id, first_name_encrypted, surname_encrypted, sex, date_of_birth, id_type,
         phone_encrypted, district_id)
       VALUES ($1, 'iv:tag:ct', 'iv:tag:ct', 'female', '1988-07-01', 'none', 'iv:tag:ct',
               (SELECT id FROM public.districts LIMIT 1))`,
      [p],
    );
    const cols = `SELECT id, sex, date_of_birth, primary_facility_id, created_at FROM public.patient_profiles WHERE id = $1`;
    expect(await probe(lane.pg, reader(doc.userId, h), cols, [p])).toMatchObject({
      ok: true,
      rows: [{ id: p, sex: "female" }],
    });
    for (const c of ["first_name_encrypted", "surname_encrypted", "phone_encrypted", "*"]) {
      const r = await probe(
        lane.pg,
        reader(doc.userId, h),
        `SELECT ${c} FROM public.patient_profiles`,
      );
      expect(r.ok, c).toBe(false);
    }
    const away = await clinician(lane.pg, {
      hospitalId: other,
      departmentId: await department(lane.pg, other),
    });
    expect(await probe(lane.pg, reader(away.userId, other), cols, [p])).toMatchObject({
      ok: true,
      rows: [],
    });
  });

  it("encounter_medications and hospitals: this hospital's, with a basis", async () => {
    await lane.pg.query(
      `INSERT INTO public.encounter_medications (encounter_id, patient_user_id, name) VALUES ($1, $2, 'metformin')`,
      [enc, p],
    );
    const meds = `SELECT name FROM public.encounter_medications WHERE patient_user_id = $1`;
    expect(await probe(lane.pg, reader(doc.userId, h), meds, [p])).toMatchObject({
      ok: true,
      rows: [{ name: "metformin" }],
    });
    // The same clinician acting for another hospital sees neither the medicine nor this hospital.
    expect(await probe(lane.pg, reader(doc.userId, other), meds, [p])).toMatchObject({ rows: [] });
    const hosp = `SELECT id FROM public.hospitals`;
    expect(await probe(lane.pg, reader(doc.userId, h), hosp)).toMatchObject({ rows: [{ id: h }] });
    const denied = await probe(
      lane.pg,
      reader(doc.userId, h),
      `SELECT id FROM public.hospitals WHERE id = $1`,
      [other],
    );
    expect(denied).toMatchObject({ ok: true, rows: [] });
  });

  it("the fact loader through the reader: demographics, legacy medicines and facility level match the owner", async () => {
    const manifest = [
      "demo.date_of_birth",
      "demo.sex_at_birth",
      "ctx.facility_level",
      "medication",
    ];
    const asOf = new Date(Date.now() + 60_000);
    const writer = await asClinicalWriter(
      { userId: doc.userId, hospitalId: h },
      (tx) => loadFactSnapshot(tx as EmrTx, p, { manifest, asOf, purpose: "interactive" }),
      lane.db,
    );
    const read = await asClinicalReader(
      { userId: doc.userId, hospitalId: h },
      (tx) => loadFactSnapshot(tx as EmrTx, p, { manifest, asOf, purpose: "interactive" }),
      lane.db,
    );
    const concepts = writer.facts.map((f) => f.concept);
    expect(concepts).toEqual(expect.arrayContaining(["demo.date_of_birth", "ctx.facility_level"]));
    expect(concepts.filter((c) => c === "medication").length).toBeGreaterThanOrEqual(2);
    expect(read.hash).toBe(writer.hash);
  });
});
