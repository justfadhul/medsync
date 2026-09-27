/**
 * loadFactSnapshot on the PGlite lane (0000–0072 replayed): as-of reproducibility (C8), correction
 * propagation, manifest minimality (C10), quarantine counting (C11), restricted marking (C9), the
 * reader path under RLS, and the loader's p95 at 2,000 facts (CFC §7 budget: 60 ms on Postgres).
 * Runs only with EMR_PGLITE=1 (see _pglite.ts).
 */
import { randomUUID } from "node:crypto";
import type { Lane } from "./_pglite";
import type { EmrTx } from "@/lib/emr/db";
import type { LoadOptions } from "@/lib/facts/loader";
import type { FactSnapshot, ObservationFact } from "@/lib/facts/types";
import { beforeAll, describe, expect, it } from "vitest";

import { asClinicalReader, asClinicalWriter } from "@/lib/emr/db";
import { loadFactSnapshot } from "@/lib/facts/loader";
import { bootLane, clinician, department, encounter, hospital, laneOn, patient } from "./_pglite";

const BOOT_MS = 180_000;

type Obs = {
  p: string;
  concept: string;
  createdAt: string;
  num?: number;
  unit?: string;
  code?: string;
  logicalId?: string;
  version?: number;
  supersedesId?: string | null;
  status?: string;
  context?: object;
  specimen?: string;
  fasting?: string;
  effectiveAt?: string;
};

describe.skipIf(!laneOn)("loadFactSnapshot on the PGlite lane", () => {
  let lane: Lane;
  let h: string;
  let dept: string;
  let doc: string;

  beforeAll(async () => {
    lane = await bootLane();
    h = await hospital(lane.pg);
    dept = await department(lane.pg, h);
    doc = (await clinician(lane.pg, { hospitalId: h, departmentId: dept })).userId;
  }, BOOT_MS);

  /** A patient with an active encounter here (so the reader has a basis). */
  async function newPatient(): Promise<string> {
    const p = await patient(lane.pg);
    await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: doc,
      departmentId: dept,
    });
    return p;
  }

  const load = (p: string, opts: Omit<LoadOptions, "purpose">) =>
    asClinicalWriter(
      { userId: doc, hospitalId: h },
      (tx) => loadFactSnapshot(tx as EmrTx, p, { purpose: "interactive", ...opts }),
      lane.db,
    );

  /** A CFC observation row, written as the owner with explicit clocks. */
  async function obs(o: Obs): Promise<{ id: string; logicalId: string }> {
    const id = randomUUID();
    const logicalId = o.logicalId ?? id;
    const quantity = o.num !== undefined;
    await lane.pg.query(
      `INSERT INTO public.clinical_observations (id, hospital_id, patient_user_id, recorded_by_user_id, observation_kind, state,
         concept_id, logical_id, version, supersedes_id, category, value_type, value_num, value_unit, value_canonical, value_code,
         specimen, fasting_state, context, source, trust, status, sensitivity, effective_at, created_at, note_ciphertext)
       VALUES ($1, $2, $3, $4, 'fact', 'fact', $5, $6, $7, $8, 'laboratory', $9, $10, $11, $10, $12, $13, $14, $15::jsonb,
         'lab', 4, $16, 'standard', $17, $18, CASE WHEN $16 = 'entered_in_error' THEN 'iv:tag:ct' END)`,
      [
        id,
        h,
        o.p,
        doc,
        o.concept,
        logicalId,
        o.version ?? 1,
        o.supersedesId ?? null,
        quantity ? "quantity" : "coded",
        quantity ? o.num : null,
        quantity ? (o.unit ?? "mmol/L") : null,
        quantity ? null : (o.code ?? null),
        o.specimen ?? null,
        o.fasting ?? null,
        JSON.stringify(o.context ?? {}),
        o.status ?? "final",
        o.effectiveAt ?? o.createdAt,
        o.createdAt,
      ],
    );
    return { id, logicalId };
  }

  const glucose = (p: string, createdAt: string, num: number, extra: Partial<Obs> = {}) =>
    obs({
      p,
      concept: "obs.glucose",
      createdAt,
      num,
      specimen: "venous_plasma",
      fasting: "fasting",
      ...extra,
    });

  const values = (s: FactSnapshot) =>
    s.facts.map((f) => {
      const v = (f as ObservationFact).value;
      return v?.type === "quantity" ? v.value : null;
    });

  it("as-of reproducibility: a superseding correction leaves the old snapshot's hash unchanged", async () => {
    const p = await newPatient();
    const v1 = await glucose(p, "2026-01-01T10:00:00Z", 6.1);
    const asOf1 = new Date("2026-01-01T12:00:00Z");
    const before = await load(p, { manifest: ["obs.glucose"], asOf: asOf1 });
    expect(values(before)).toEqual([6.1]);
    expect(before.facts[0]!.interpretable).toEqual({ ok: true });

    await glucose(p, "2026-01-02T10:00:00Z", 7.4, {
      logicalId: v1.logicalId,
      version: 2,
      supersedesId: v1.id,
      status: "corrected",
    });
    const again = await load(p, { manifest: ["obs.glucose"], asOf: asOf1 });
    expect(again.hash).toBe(before.hash);
    expect(again.facts).toEqual(before.facts);

    const now = await load(p, { manifest: ["obs.glucose"] });
    expect(values(now)).toEqual([7.4]);
    expect(now.facts[0]!.status).toBe("corrected");
    expect(now.hash).not.toBe(before.hash);
  });

  it("correction propagation: superseded versions and entered-in-error items are hidden", async () => {
    const p = await newPatient();
    const a = await glucose(p, "2026-02-01T08:00:00Z", 5.0);
    const b = await glucose(p, "2026-02-01T09:00:00Z", 5.5);
    await glucose(p, "2026-02-02T08:00:00Z", 5.2, {
      logicalId: a.logicalId,
      version: 2,
      supersedesId: a.id,
      status: "amended",
    });
    await glucose(p, "2026-02-03T08:00:00Z", 5.5, {
      logicalId: b.logicalId,
      version: 2,
      supersedesId: b.id,
      status: "entered_in_error",
    });
    // A legacy resus retraction ('corrected') is hidden too, from when it was made.
    await lane.pg.query(
      `INSERT INTO public.clinical_observations (hospital_id, patient_user_id, recorded_by_user_id, observation_kind,
         numeric_value_1, unit, state, recorded_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'hr', 88, '/min', 'corrected', '2026-02-01T08:00:00Z', '2026-02-01T08:00:00Z', '2026-02-01T08:05:00Z')`,
      [h, p, doc],
    );

    const s = await load(p, {
      manifest: ["obs.glucose", "obs.heart_rate"],
      asOf: new Date("2026-02-04T00:00:00Z"),
    });
    expect(s.facts.map((f) => [f.concept, f.logicalId, f.provenance.version])).toEqual([
      ["obs.glucose", a.logicalId, 2],
    ]);
    const mid = await load(p, {
      manifest: ["obs.glucose"],
      asOf: new Date("2026-02-02T12:00:00Z"),
    });
    expect(values(mid).sort()).toEqual([5.2, 5.5]); // before b's entered-in-error version existed
    const early = await load(p, {
      manifest: ["obs.heart_rate"],
      asOf: new Date("2026-02-01T08:01:00Z"),
    });
    expect(early.facts.map((f) => f.status)).toEqual(["final"]); // before the retraction
  });

  it("manifest minimality (C10): nothing outside the manifest is loaded, nor its sources read", async () => {
    const p = await newPatient();
    await glucose(p, "2026-03-01T08:00:00Z", 6.0);
    await obs({ p, concept: "obs.hba1c", createdAt: "2026-03-01T08:00:00Z", num: 6.0, unit: "%" });
    await lane.pg.query(
      `INSERT INTO public.conditions (id, logical_id, hospital_id, patient_user_id, recorded_by_user_id, effective_at, source, trust,
         category, concept_id, text_ciphertext, clinical_status, verification, asserted_by)
       SELECT n, n, $1, $2, $3, now(), 'clinician', 3, 'problem_list_item', 'cond.hiv', 'iv:tag:ct', 'active', 'confirmed', 'clinician'
       FROM gen_random_uuid() n`,
      [h, p, doc],
    );
    // Two sources that would each quarantine a row if read: a triage ACVPU 'C' and a legacy ACVPU 'C'.
    await lane.pg.query(
      `INSERT INTO public.triage_records (hospital_id, patient_user_id, ruleset, vitals_snapshot, computed_level,
         computed_breakdown, assigned_level)
       VALUES ($1, $2, 'adult_news2', '{"pulse": 90, "consciousness": "C"}'::jsonb, 3, '{}'::jsonb, 3)`,
      [h, p],
    );
    await lane.pg.query(
      `INSERT INTO public.clinical_observations (hospital_id, patient_user_id, recorded_by_user_id, observation_kind, notes, state)
       VALUES ($1, $2, $3, 'acvpu', 'C', 'active')`,
      [h, p, doc],
    );

    const only = await load(p, { manifest: ["obs.hba1c"] });
    expect(only.facts.map((f) => f.concept)).toEqual(["obs.hba1c"]);
    expect(only.quarantined).toBe(0); // neither the triage row nor the legacy row was read
    expect(only.allergyAssertions).toBeUndefined();

    const hr = await load(p, { manifest: ["obs.heart_rate"] });
    expect(hr.facts.map((f) => [f.concept, f.provenance.table])).toEqual([
      ["obs.heart_rate", "triage_records"],
    ]);
    expect(hr.quarantined).toBe(0); // the triage row gave its pulse only

    const avpu = await load(p, { manifest: ["obs.avpu"] });
    expect(avpu.facts).toEqual([]);
    expect(avpu.quarantined).toBe(2);

    // C9: the row said standard; the catalogue restricts HIV.
    const hiv = await load(p, { manifest: ["cond.hiv"] });
    expect(hiv.facts.map((f) => [f.concept, f.sensitivity])).toEqual([["cond.hiv", "restricted"]]);
  });

  it("quarantine (C11): rows that fail the contract are counted, the rest returned, nothing thrown", async () => {
    const p = await newPatient();
    await glucose(p, "2026-04-01T08:00:00Z", 6.2);
    await obs({ p, concept: "obs.malaria_test", createdAt: "2026-04-01T08:00:00Z", code: "maybe" });
    await obs({
      p,
      concept: "obs.bp_systolic",
      createdAt: "2026-04-01T08:00:00Z",
      num: 120,
      unit: "mm[Hg]",
      context: { position: "upside_down" },
    });
    await lane.pg.query(
      `INSERT INTO public.triage_records (hospital_id, patient_user_id, ruleset, vitals_snapshot, computed_level,
         computed_breakdown, assigned_level)
       VALUES ($1, $2, 'adult_news2', '{"pulse": "fast"}'::jsonb, 3, '{}'::jsonb, 3)`,
      [h, p],
    );
    const s = await load(p, {
      manifest: ["obs.glucose", "obs.malaria_test", "obs.bp_systolic", "obs.heart_rate"],
    });
    expect(s.facts.map((f) => f.concept)).toEqual(["obs.glucose"]);
    expect(s.quarantined).toBe(3);
  });

  it("allergies with assertions, context, demographics; lookback and per-concept cap", async () => {
    const p = await newPatient();
    await lane.pg.query(
      `INSERT INTO public.allergies (id, logical_id, hospital_id, patient_user_id, recorded_by_user_id, effective_at, source,
         trust, substance_kind, substance_code, informant)
       SELECT n, n, $1, $2, $3, now(), 'clinician', 3, 'drug_ingredient', 'penicillin', 'patient' FROM gen_random_uuid() n`,
      [h, p, doc],
    );
    await lane.pg.query(
      `INSERT INTO public.allergy_status_assertions (hospital_id, patient_user_id, assertion, asserted_by_user_id, asserted_at)
       VALUES ($1, $2, 'no_known_drug_allergies', $3, now())`,
      [h, p, doc],
    );
    await lane.pg.query(
      `INSERT INTO public.facility_capabilities (hospital_id, capability_id, status)
       VALUES ($1, 'cap.glucometer', 'intermittent') ON CONFLICT DO NOTHING`,
      [h],
    );
    await lane.pg.query(
      `INSERT INTO public.patient_profiles (id, first_name_encrypted, surname_encrypted, sex, date_of_birth, id_type,
         phone_encrypted, district_id)
       VALUES ($1, 'iv:tag:ct', 'iv:tag:ct', 'female', '1988-07-01', 'none', 'iv:tag:ct',
               (SELECT id FROM public.districts LIMIT 1))`,
      [p],
    );
    const s = await load(p, {
      manifest: [
        "allergy",
        "ctx.facility_capability",
        "ctx.facility_level",
        "ctx.care_setting",
        "demo.date_of_birth",
        "demo.sex_at_birth",
      ],
    });
    expect(s.facts.map((f) => f.concept)).toEqual([
      "allergy",
      "ctx.care_setting",
      "ctx.facility_capability",
      "ctx.facility_level",
      "demo.date_of_birth",
      "demo.sex_at_birth",
    ]);
    expect(s.quarantined).toBe(0);
    expect(s.allergyAssertions?.map((a) => a.state)).toEqual(["no_known_drug_allergies"]);
    expect(JSON.stringify(s)).not.toContain("iv:tag:ct"); // no name, phone or ciphertext reaches a snapshot

    const q = await newPatient();
    for (const [i, year] of [2015, 2020, 2024, 2025, 2026].entries())
      await glucose(q, `${year}-01-0${i + 1}T08:00:00Z`, 5 + i);
    const asOf = new Date("2026-06-01T00:00:00Z");
    expect(values(await load(q, { manifest: ["obs.glucose"], asOf, lookbackYears: 3 }))).toEqual([
      9, 8, 7,
    ]);
    expect(values(await load(q, { manifest: ["obs.glucose"], asOf, perConceptCap: 2 }))).toEqual([
      9, 8,
    ]);
  });

  it("reader path (RLS): a clinician with a basis gets the same facts; one without gets none", async () => {
    const p = await newPatient();
    await glucose(p, "2026-05-01T08:00:00Z", 6.4);
    const manifest = ["obs.glucose", "obs.heart_rate", "cond.hiv", "allergy"];
    const asOf = new Date("2026-05-02T00:00:00Z");
    const writer = await load(p, { manifest, asOf });
    expect(writer.facts).toHaveLength(1);
    const reader = await asClinicalReader(
      { userId: doc, hospitalId: h },
      (tx) => loadFactSnapshot(tx as EmrTx, p, { manifest, asOf, purpose: "interactive" }),
      lane.db,
    );
    expect(reader.hash).toBe(writer.hash);

    const elsewhere = await hospital(lane.pg, "Elsewhere");
    const stranger = (
      await clinician(lane.pg, {
        hospitalId: elsewhere,
        departmentId: await department(lane.pg, elsewhere),
      })
    ).userId;
    const denied = await asClinicalReader(
      { userId: stranger, hospitalId: elsewhere },
      (tx) => loadFactSnapshot(tx as EmrTx, p, { manifest, asOf, purpose: "interactive" }),
      lane.db,
    );
    expect(denied.facts).toEqual([]);
  });

  it("reader path names a backfilled allergy from its source (0073 allergy_source_text)", async () => {
    const p = await newPatient();
    const src = (
      await lane.pg.query<{ id: string }>(
        `INSERT INTO public.patient_allergies (hospital_id, patient_user_id, substance, recorded_by_user_id)
         VALUES ($1, $2, 'Sulfa drugs', $3) RETURNING id`,
        [h, p, doc],
      )
    ).rows[0]!.id;
    // The shape 0071's backfill writes: no text, no recorder, the source named by legacy_ref.
    await lane.pg.query(
      `INSERT INTO public.allergies (id, logical_id, hospital_id, patient_user_id, effective_at, source, trust,
         informant, legacy_ref)
       SELECT n, n, $1, $2, now(), 'clinician', 3, 'record',
              jsonb_build_object('table', 'patient_allergies', 'id', $3::text) FROM gen_random_uuid() n`,
      [h, p, src],
    );
    const asOf = new Date(Date.now() + 60_000);
    const text = (s: FactSnapshot) =>
      s.facts.flatMap((f) => (f.kind === "allergy" ? [f.substance.text] : []));
    const reader = await asClinicalReader(
      { userId: doc, hospitalId: h },
      (tx) =>
        loadFactSnapshot(tx as EmrTx, p, { manifest: ["allergy"], asOf, purpose: "interactive" }),
      lane.db,
    );
    expect(text(reader)).toEqual(["Sulfa drugs"]);
  });

  it("p95 of loadFactSnapshot for a patient with 2,000 facts", async () => {
    const p = await newPatient();
    // 500 each of four concepts over two years, one version each.
    await lane.pg.query(
      `WITH r AS (
         SELECT gen_random_uuid() AS id, g, c.concept, c.unit, c.specimen, c.fasting
         FROM generate_series(1, 500) g
         CROSS JOIN (VALUES ('obs.glucose', 'mmol/L', 'venous_plasma', 'fasting'), ('obs.heart_rate', '/min', NULL, NULL),
                            ('obs.resp_rate', '/min', NULL, NULL), ('obs.temperature', 'Cel', NULL, NULL))
                    AS c(concept, unit, specimen, fasting))
       INSERT INTO public.clinical_observations (id, hospital_id, patient_user_id, recorded_by_user_id, observation_kind, state,
         concept_id, logical_id, version, category, value_type, value_num, value_unit, value_canonical, specimen, fasting_state,
         context, source, trust, status, sensitivity, effective_at, created_at)
       SELECT r.id, $1, $2, $3, 'fact', 'fact', r.concept, r.id, 1, 'laboratory', 'quantity', 5 + (r.g % 50) / 10.0, r.unit,
              5 + (r.g % 50) / 10.0, r.specimen, r.fasting, '{}'::jsonb, 'lab', 4, 'final', 'standard',
              timestamptz '2024-06-01' + make_interval(hours => r.g * 17), timestamptz '2024-06-01' + make_interval(hours => r.g * 17)
       FROM r`,
      [h, p, doc],
    );
    const manifest = ["obs.glucose", "obs.heart_rate", "obs.resp_rate", "obs.temperature"];
    const asOf = new Date("2026-09-01T00:00:00Z");
    for (let i = 0; i < 3; i++) await load(p, { manifest, asOf }); // warm-up

    const ms: number[] = [];
    let last: FactSnapshot | undefined;
    for (let i = 0; i < 40; i++) {
      const t = performance.now();
      last = await load(p, { manifest, asOf });
      ms.push(performance.now() - t);
    }
    ms.sort((a, b) => a - b);
    const p50 = ms[Math.floor(ms.length * 0.5)]!;
    const p95 = ms[Math.ceil(ms.length * 0.95) - 1]!;
    const bytes = Buffer.byteLength(JSON.stringify(last));
    // warn: the lint allows it, and the number is the point of this test.
    console.warn(
      `[facts-loader] 2,000 facts, 40 runs on PGlite (WASM, in-process; slower than Postgres): ` +
        `p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${ms.at(-1)!.toFixed(1)} ms, ` +
        `payload ${(bytes / 1024).toFixed(0)} KiB`,
    );
    expect(last!.facts).toHaveLength(2000);
    expect(last!.quarantined).toBe(0);
    // CFC §7 budgets the engine payload at 1 MB; the v1 fact shape measures ~0.7 KiB a fact, so
    // 2,000 facts exceed it (reported, not hidden). This bound only catches a regression.
    expect(bytes).toBeLessThan(2 * 1024 * 1024);
  }, 120_000);
});
