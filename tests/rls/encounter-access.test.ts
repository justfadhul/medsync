import type { TestUser } from "./_helpers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  cleanup,
  createTestHospital,
  createTestUser,
  RLS_TESTS_ENABLED,
  serviceSql,
} from "./_helpers";

/**
 * RLS: the encounter / EMR engine access boundary (kickoff §2 — "never any
 * clinician sees any patient"). Proves the legitimate-access basis on the most
 * sensitive table, `clinical_documentation`, plus the `has_clinical_relationship`
 * predicate that the RLS policies use.
 *
 * ⚠️ Requires migration 0040 (the encounter engine, currently GATED) to be
 * APPLIED to the test database — otherwise `clinical_documentation` does not
 * exist and these fail. Run with MEDSYNC_ALLOW_RLS_DB_WRITES=1 against a test
 * Supabase project that has 0040 applied (this is part of the GATE E pre-apply
 * verification). Skips otherwise.
 */
describe.skipIf(!RLS_TESTS_ENABLED)("RLS: encounter clinical_documentation access basis", () => {
  let attending: TestUser; // the clinician on the in-progress encounter (active_encounter)
  let unrelated: TestUser; // a clinician with NO relationship to the patient
  let patient: TestUser; // the patient (sees their own record)
  let hospital: { id: string; slug: string };
  let encounterId: string;

  beforeAll(async () => {
    attending = await createTestUser("enc", "attending");
    unrelated = await createTestUser("enc", "unrelated");
    patient = await createTestUser("enc", "patient");
    hospital = await createTestHospital("enc");

    // An in-progress encounter: attending ↔ patient (the active_encounter basis).
    const [enc] = await serviceSql<{ id: string }[]>`
      INSERT INTO public.encounters (hospital_id, patient_user_id, clinician_user_id, state)
      VALUES (${hospital.id}, ${patient.id}, ${attending.id}, 'in_progress')
      RETURNING id
    `;
    encounterId = enc!.id;

    // One clerkship documentation version on that encounter.
    await serviceSql`
      INSERT INTO public.clinical_documentation
        (encounter_id, patient_user_id, version, section_data, status, authored_by_user_id)
      VALUES (${encounterId}, ${patient.id}, 1,
              ${serviceSql.json({ history: { presentingComplaint: "test" } })}, 'final', ${attending.id})
    `;
  }, 60_000);

  afterAll(async () => {
    await serviceSql`DELETE FROM public.encounters WHERE id = ${encounterId}`.catch(() => {});
    await cleanup();
  }, 120_000);

  test("has_clinical_relationship: TRUE for the attending (active_encounter)", async () => {
    const { data, error } = await attending.client.rpc("has_clinical_relationship", {
      p_patient: patient.id,
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  test("has_clinical_relationship: FALSE for an unrelated clinician", async () => {
    const { data, error } = await unrelated.client.rpc("has_clinical_relationship", {
      p_patient: patient.id,
    });
    expect(error).toBeNull();
    expect(data).toBe(false);
  });

  test("the attending clinician CAN read the patient's documentation", async () => {
    const { data, error } = await attending.client
      .from("clinical_documentation")
      .select("id,patient_user_id")
      .eq("encounter_id", encounterId);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBeGreaterThan(0);
  });

  test("an unrelated clinician CANNOT read the patient's documentation", async () => {
    const { data } = await unrelated.client
      .from("clinical_documentation")
      .select("id")
      .eq("encounter_id", encounterId);
    expect(data ?? []).toHaveLength(0);
  });

  test("the patient CAN read their own documentation (transparency)", async () => {
    const { data, error } = await patient.client
      .from("clinical_documentation")
      .select("id")
      .eq("encounter_id", encounterId);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBeGreaterThan(0);
  });

  test("no client can UPDATE documentation (append-only; service-role writes only)", async () => {
    const { data, error } = await attending.client
      .from("clinical_documentation")
      .update({ status: "draft" })
      .eq("encounter_id", encounterId)
      .select("id");
    // With no UPDATE policy, PostgREST refuses silently: an error, or zero rows changed.
    expect(error !== null || (data ?? []).length === 0).toBe(true);
    const [row] = await serviceSql<{ status: string }[]>`
      SELECT status FROM public.clinical_documentation WHERE encounter_id = ${encounterId} LIMIT 1`;
    expect(row?.status).not.toBe("draft");
  });
});
