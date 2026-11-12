import type { TestUser } from "./_helpers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { anonClient, cleanup, createTestUser, RLS_TESTS_ENABLED, serviceSql } from "./_helpers";

/**
 * RLS: the six Resus Desk v2 tables (migration 0068). Same actors as
 * resus-tables.test.ts. Reads: active clinical staff of the hospital (the
 * superadmin lost its read in 0287); reception, other hospitals and anonymous
 * read nothing. Writes: never from a client — service role inside audited server actions only. Also
 * proves the immutability triggers (arrest records, after-death tasks,
 * submitted debriefs).
 *
 * Live-DB suite: SKIPS unless MEDSYNC_ALLOW_RLS_DB_WRITES=1 against a TEST
 * project with 0068 applied. The same probes run offline against an embedded
 * Postgres in the local harness (see docs/resus-v2/STOP-REPORTS.md, STOP 2).
 */

const TABLES = [
  "hospital_care_units",
  "resus_bay_profiles",
  "hospital_resus_settings",
  "resus_arrest_records",
  "resus_debriefs",
  "resus_after_death_tasks",
] as const;

describe.skipIf(!RLS_TESTS_ENABLED)("RLS: resus desk v2 tables", () => {
  let clinician: TestUser;
  let otherClinician: TestUser;
  let receptionist: TestUser;
  let hospitalA: string;
  let hospitalB: string;
  let episodeId: string;
  let arrestRecordId: string;
  let debriefId: string;

  async function affiliate(user: TestUser, hospitalId: string, clinical: boolean) {
    const [found] = await serviceSql<{ id: string }[]>`
      SELECT id FROM public.hospital_departments
      WHERE hospital_id = ${hospitalId} AND slug = 'resus-rls' LIMIT 1`;
    const [dept] = found
      ? [found]
      : await serviceSql<{ id: string }[]>`
          INSERT INTO public.hospital_departments (hospital_id, name, slug)
          VALUES (${hospitalId}, 'Resus RLS', 'resus-rls') RETURNING id`;
    const [cadre] = await serviceSql<{ id: string }[]>`
      SELECT id FROM public.cadres WHERE is_clinical = ${clinical} LIMIT 1`;
    const [role] = await serviceSql<{ id: string }[]>`SELECT id FROM public.roles LIMIT 1`;
    await serviceSql`
      INSERT INTO public.staff_affiliations
        (user_id, hospital_id, department_id, cadre_id, role_id, employment_type, state, approved_at)
      VALUES (${user.id}, ${hospitalId}, ${dept!.id}, ${cadre!.id}, ${role!.id}, 'full_time', 'active', now())`;
  }

  beforeAll(async () => {
    clinician = await createTestUser("resusv2", "clinician");
    otherClinician = await createTestUser("resusv2", "other");
    receptionist = await createTestUser("resusv2", "reception");
    // Persistent fixture hospitals: the immutable rows below can never be deleted.
    const [a] = await serviceSql<{ id: string }[]>`
      INSERT INTO public.hospitals (name, slug, level)
      VALUES ('RLS Resus Fixture', 'rls-resus-fixture', 'national_referral')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
    const [b] = await serviceSql<{ id: string }[]>`
      INSERT INTO public.hospitals (name, slug, level)
      VALUES ('RLS Resus Fixture B', 'rls-resus-fixture-b', 'national_referral')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
    hospitalA = a!.id;
    hospitalB = b!.id;
    await affiliate(clinician, hospitalA, true);
    await affiliate(otherClinician, hospitalB, true);
    await affiliate(receptionist, hospitalA, false);

    const [ep] = await serviceSql<{ id: string }[]>`
      INSERT INTO public.resus_episodes (hospital_id, trigger_kind, state)
      VALUES (${hospitalA}, 'in_resus_deterioration', 'active') RETURNING id`;
    episodeId = ep!.id;
    await serviceSql`
      INSERT INTO public.hospital_care_units (hospital_id, name, unit_type)
      VALUES (${hospitalA}, 'RLS unit', 'hdu') ON CONFLICT (hospital_id, name) DO NOTHING`;
    await serviceSql`
      INSERT INTO public.resus_bay_profiles (hospital_id, bay_label)
      VALUES (${hospitalA}, 'RLS bay') ON CONFLICT (hospital_id, bay_label) DO NOTHING`;
    await serviceSql`
      INSERT INTO public.hospital_resus_settings (hospital_id)
      VALUES (${hospitalA}) ON CONFLICT (hospital_id) DO NOTHING`;
    const [rec] = await serviceSql<{ id: string }[]>`
      INSERT INTO public.resus_arrest_records (episode_id, arrest_seq, record)
      VALUES (${episodeId}, 1, '{}'::jsonb) RETURNING id`;
    arrestRecordId = rec!.id;
    const [d] = await serviceSql<{ id: string }[]>`
      INSERT INTO public.resus_debriefs (episode_id) VALUES (${episodeId}) RETURNING id`;
    debriefId = d!.id;
    await serviceSql`
      INSERT INTO public.resus_after_death_tasks (episode_id, task_id, state)
      VALUES (${episodeId}, 'CO-ADT-01', 'done')`;
  }, 90_000);

  afterAll(async () => {
    await cleanup();
  }, 60_000);

  const scoped = (t: (typeof TABLES)[number]) =>
    t === "resus_arrest_records" || t === "resus_debriefs" || t === "resus_after_death_tasks"
      ? (["episode_id", episodeId] as const)
      : (["hospital_id", hospitalA] as const);

  for (const table of TABLES) {
    test(`${table}: same-hospital clinical staff can read`, async () => {
      const [col, val] = scoped(table);
      const { data, error } = await clinician.client.from(table).select("*").eq(col, val);
      expect(error).toBeNull();
      expect(data?.length ?? 0).toBeGreaterThan(0);
    });
    for (const [label, who] of [
      ["another hospital's clinician", () => otherClinician.client],
      ["reception", () => receptionist.client],
      ["anonymous", () => anonClient()],
    ] as const) {
      test(`${table}: ${label} reads nothing`, async () => {
        const [col, val] = scoped(table);
        const { data } = await who().from(table).select("*").eq(col, val);
        expect(data ?? []).toHaveLength(0);
      });
    }
    test(`${table}: client DELETE removes nothing`, async () => {
      const [col, val] = scoped(table);
      await clinician.client.from(table).delete().eq(col, val);
      const rows = await serviceSql.unsafe(`SELECT 1 FROM public.${table} WHERE ${col} = $1`, [
        val,
      ]);
      expect(rows.length).toBeGreaterThan(0);
    });
  }

  test("hospital_care_units: client INSERT is denied", async () => {
    const { error } = await clinician.client
      .from("hospital_care_units")
      .insert({ hospital_id: hospitalA, name: "Sneaky", unit_type: "icu" });
    expect(error).not.toBeNull();
  });

  test("resus_arrest_records: even the service role cannot UPDATE", async () => {
    await expect(
      serviceSql`UPDATE public.resus_arrest_records SET record = '{"x":1}'::jsonb WHERE id = ${arrestRecordId}`,
    ).rejects.toThrow(/append-only/);
  });

  test("resus_debriefs: immutable once submitted", async () => {
    await serviceSql`UPDATE public.resus_debriefs SET status = 'submitted', submitted_at = now() WHERE id = ${debriefId}`;
    await expect(
      serviceSql`UPDATE public.resus_debriefs SET went_well = 'edited' WHERE id = ${debriefId}`,
    ).rejects.toThrow(/immutable once submitted/);
  });

  test("resus_after_death_tasks: rows are append-only", async () => {
    await expect(
      serviceSql`UPDATE public.resus_after_death_tasks SET state = 'pending' WHERE episode_id = ${episodeId}`,
    ).rejects.toThrow(/append-only/);
  });
});
