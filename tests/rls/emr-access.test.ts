import type { TestUser } from "./_helpers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { cleanup, createTestUser, RLS_TESTS_ENABLED, serviceSql } from "./_helpers";

/**
 * RLS: the hosted twin of the EMR access matrix (tests/emr-db/rls-probes.test.ts runs the full
 * 2,400 probes on PGlite; runbook §3). A representative subset against the real dev project:
 *
 * - Client path (supabase-js, anon key + a signed-in user, as the app's browser would): the new
 *   clinical tables are never readable or writable from a client — not by the treating clinician,
 *   the patient (no CFC observation of their own either), reception, or another hospital.
 * - Reader path (medsync_clinical_reader, identity by set_config as lib/emr/db.ts sets it): that
 *   role is not reachable from supabase-js, so it is probed over DATABASE_URL — a basis at this
 *   hospital reads; no basis, reception and the wrong hospital read nothing; allergies cross
 *   hospitals (STOP 1). `private.patient_access_basis` is probed directly the same way.
 *
 * SKIPS unless MEDSYNC_ALLOW_RLS_DB_WRITES=1 and the four env vars point at a TEST project with
 * 0071–0074 applied. EMR rows are append-only with RESTRICT keys, so this suite's fixture
 * hospitals persist (upserted by slug) and its users stay behind, as in resus-v2-tables.
 */
describe.skipIf(!RLS_TESTS_ENABLED)("RLS: EMR record access (hosted twin)", () => {
  let treating: TestUser; // active encounter with the patient at H1
  let noBasis: TestUser; // clinician at H1, no relationship
  let otherHosp: TestUser; // clinician with a real basis for the patient — at H2
  let reception: TestUser; // non-clinical at H1
  let pt: TestUser; // the record's patient: encounters at H1 and H2, not present anywhere today
  let present: TestUser; // a second patient, present at H1 today (an open intake)
  let H1: string;
  let H2: string;
  const ids: Record<"note" | "allergy" | "condition" | "observation", string> = {
    note: "",
    allergy: "",
    condition: "",
    observation: "",
  };

  async function fixtureHospital(slug: string): Promise<string> {
    const [h] = await serviceSql<{ id: string }[]>`
      INSERT INTO public.hospitals (name, slug, level)
      VALUES (${`RLS EMR Fixture ${slug}`}, ${slug}, 'national_referral')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
    return h!.id;
  }

  async function affiliate(user: TestUser, hospitalId: string, cadreCode: string): Promise<void> {
    const [found] = await serviceSql<{ id: string }[]>`
      SELECT id FROM public.hospital_departments WHERE hospital_id = ${hospitalId} AND slug = 'emr-rls' LIMIT 1`;
    const [dept] = found
      ? [found]
      : await serviceSql<{ id: string }[]>`
          INSERT INTO public.hospital_departments (hospital_id, name, slug)
          VALUES (${hospitalId}, 'EMR RLS', 'emr-rls') RETURNING id`;
    const [c] = await serviceSql<{ cadre_id: string; role_id: string }[]>`
      SELECT c.id AS cadre_id,
             coalesce((SELECT r.id FROM public.roles r WHERE r.cadre_id = c.id LIMIT 1),
                      (SELECT r.id FROM public.roles r LIMIT 1)) AS role_id
        FROM public.cadres c WHERE c.code = ${cadreCode}`;
    await serviceSql`
      INSERT INTO public.staff_affiliations
        (user_id, hospital_id, department_id, cadre_id, role_id, employment_type, state, approved_at)
      VALUES (${user.id}, ${hospitalId}, ${dept!.id}, ${c!.cadre_id}, ${c!.role_id}, 'full_time', 'active', now())`;
    await serviceSql`
      INSERT INTO public.user_roles (user_id, role, hospital_id)
      VALUES (${user.id}, ${cadreCode === "RECEPTION" ? "reception" : "clinician"}, ${hospitalId})`;
  }

  beforeAll(async () => {
    // One at a time: the free-tier auth admin API rate-limits bursts.
    treating = await createTestUser("emr", "treating");
    noBasis = await createTestUser("emr", "nobasis");
    otherHosp = await createTestUser("emr", "otherhosp");
    reception = await createTestUser("emr", "reception");
    pt = await createTestUser("emr", "patient");
    present = await createTestUser("emr", "present");
    H1 = await fixtureHospital("rls-emr-fixture");
    H2 = await fixtureHospital("rls-emr-fixture-b");
    await affiliate(treating, H1, "MEDICAL_OFFICER");
    await affiliate(noBasis, H1, "MEDICAL_OFFICER");
    await affiliate(otherHosp, H2, "MEDICAL_OFFICER");
    await affiliate(reception, H1, "RECEPTION");

    const [enc] = await serviceSql<{ id: string }[]>`
      INSERT INTO public.encounters (hospital_id, patient_user_id, clinician_user_id, state)
      VALUES (${H1}, ${pt.id}, ${treating.id}, 'in_progress') RETURNING id`;
    await serviceSql`
      INSERT INTO public.encounters (hospital_id, patient_user_id, clinician_user_id, state)
      VALUES (${H2}, ${pt.id}, ${otherHosp.id}, 'in_progress')`;
    await serviceSql`
      INSERT INTO public.patient_intakes (hospital_id, entry_type_code, patient_user_id, status, arrived_at)
      VALUES (${H1}, 'walk_in', ${present.id}, 'arrived', now())`;

    const e = enc!.id;
    const [note] = await serviceSql<{ id: string }[]>`
      INSERT INTO public.clinical_notes (hospital_id, patient_user_id, encounter_id, note_type, template_id,
        template_version, author_user_id, author_cadre, content_ciphertext, effective_at)
      VALUES (${H1}, ${pt.id}, ${e}, 'clerking', 'rls', '1', ${treating.id}, 'MEDICAL_OFFICER', 'iv:tag:ct', now())
      RETURNING id`;
    const [allergy] = await serviceSql<{ id: string }[]>`
      WITH n AS (SELECT gen_random_uuid() AS id)
      INSERT INTO public.allergies (id, logical_id, hospital_id, patient_user_id, encounter_id, recorded_by_user_id,
        effective_at, source, trust, substance_kind, substance_code, informant)
      SELECT n.id, n.id, ${H1}, ${pt.id}, ${e}, ${treating.id}, now(), 'clinician', 3, 'drug_ingredient',
             'penicillin', 'patient' FROM n RETURNING id`;
    const [condition] = await serviceSql<{ id: string }[]>`
      WITH n AS (SELECT gen_random_uuid() AS id)
      INSERT INTO public.conditions (id, logical_id, hospital_id, patient_user_id, encounter_id, recorded_by_user_id,
        effective_at, source, trust, category, text_ciphertext, clinical_status, verification, asserted_by)
      SELECT n.id, n.id, ${H1}, ${pt.id}, ${e}, ${treating.id}, now(), 'clinician', 3, 'problem_list_item',
             'iv:tag:ct', 'active', 'confirmed', 'clinician' FROM n RETURNING id`;
    const [concept] = await serviceSql<{ id: string }[]>`
      SELECT id FROM public.clinical_concepts WHERE value_type = 'presence' AND active LIMIT 1`;
    const [observation] = await serviceSql<{ id: string }[]>`
      WITH n AS (SELECT gen_random_uuid() AS id)
      INSERT INTO public.clinical_observations (id, hospital_id, patient_user_id, encounter_id, recorded_by_user_id,
        observation_kind, state, concept_id, logical_id, version, category, value_type, presence, source, trust,
        status, sensitivity, effective_at)
      SELECT n.id, ${H1}, ${pt.id}, ${e}, ${treating.id}, 'fact', 'fact', ${concept!.id}, n.id, 1, 'sign',
             'presence', 'present', 'clinician', 3, 'final', 'standard', now() FROM n RETURNING id`;
    Object.assign(ids, {
      note: note!.id,
      allergy: allergy!.id,
      condition: condition!.id,
      observation: observation!.id,
    });
  }, 120_000);

  afterAll(async () => {
    await cleanup();
  }, 120_000);

  /** Rows of `table` with id `id` visible to `user` through medsync_clinical_reader at `hospitalId`. */
  async function readerSees(user: TestUser, hospitalId: string, table: string, id: string) {
    return serviceSql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${user.id}, true), set_config('app.hospital_id', ${hospitalId}, true)`;
      await tx`SET LOCAL ROLE medsync_clinical_reader`;
      const [r] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ${tx(`public.${table}`)} WHERE id = ${id}`;
      return r!.n;
    });
  }

  const basis = async (user: TestUser, hospitalId: string, patient: TestUser = pt) =>
    (
      await serviceSql<{ b: string | null }[]>`
        SELECT private.patient_access_basis(${user.id}, ${patient.id}, ${hospitalId}) AS b`
    )[0]!.b;

  test("the one access rule: a basis only for the treating clinician at their hospital", async () => {
    expect(await basis(treating, H1)).toBe("active_encounter");
    expect(await basis(otherHosp, H2)).toBe("active_encounter");
    expect(await basis(otherHosp, H1)).toBeNull();
    expect(await basis(noBasis, H1)).toBeNull();
    expect(await basis(reception, H1)).toBeNull();
    // A patient present at H1 today: every clinical member of staff there has a basis (open_intake),
    // reception never does.
    expect(await basis(noBasis, H1, present)).toBe("open_intake");
    expect(await basis(reception, H1, present)).toBeNull();
    expect(await basis(pt, H1)).toBeNull();
  });

  test("reader path: the treating clinician reads the record at H1", async () => {
    for (const [table, id] of [
      ["clinical_notes", ids.note],
      ["allergies", ids.allergy],
      ["conditions", ids.condition],
    ] as const)
      expect(await readerSees(treating, H1, table, id)).toBe(1);
  });

  test("reader path: no basis, reception and a spoofed hospital read nothing", async () => {
    for (const [user, h] of [
      [noBasis, H1],
      [reception, H1],
      [otherHosp, H1],
    ] as const) {
      expect(await readerSees(user, h, "clinical_notes", ids.note)).toBe(0);
      expect(await readerSees(user, h, "conditions", ids.condition)).toBe(0);
    }
  });

  test("reader path: the other hospital's clinician reads allergies (STOP 1), not notes", async () => {
    expect(await readerSees(otherHosp, H2, "allergies", ids.allergy)).toBe(1);
    expect(await readerSees(otherHosp, H2, "clinical_notes", ids.note)).toBe(0);
  });

  const clientTables = [
    ["clinical_notes", "note"],
    ["allergies", "allergy"],
    ["conditions", "condition"],
  ] as const;

  test("client path: no signed-in user reads a new clinical table, not even the treating clinician", async () => {
    for (const user of [treating, otherHosp, reception, pt])
      for (const [table, key] of clientTables) {
        const { data } = await user.client.from(table).select("id").eq("id", ids[key]);
        expect(data ?? [], `${table} via ${user.email}`).toHaveLength(0);
      }
  });

  test("client path: the patient reads no CFC observation of their own", async () => {
    const { data } = await pt.client
      .from("clinical_observations")
      .select("id")
      .eq("id", ids.observation);
    expect(data ?? []).toHaveLength(0);
  });

  test("client path: no client writes the record", async () => {
    const { error: ins } = await treating.client.from("allergies").insert({
      logical_id: ids.allergy,
      hospital_id: H1,
      patient_user_id: pt.id,
      effective_at: new Date().toISOString(),
      source: "clinician",
      trust: 3,
      substance_kind: "drug_ingredient",
      substance_code: "penicillin",
      informant: "patient",
      recorded_by_user_id: treating.id,
    });
    expect(ins).not.toBeNull();
    // An UPDATE is refused or matches nothing (PostgREST cannot see the row); either way it holds.
    await treating.client
      .from("clinical_notes")
      .update({ template_id: "tampered" })
      .eq("id", ids.note);
    const [n] = await serviceSql<{ n: number; t: string }[]>`
      SELECT (SELECT count(*)::int FROM public.allergies WHERE logical_id = ${ids.allergy}) AS n,
             (SELECT template_id FROM public.clinical_notes WHERE id = ${ids.note}) AS t`;
    expect(n).toMatchObject({ n: 1, t: "rls" });
  });
});
