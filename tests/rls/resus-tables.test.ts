import type { TestUser } from "./_helpers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  anonClient,
  cleanup,
  createTestHospital,
  createTestUser,
  grantRole,
  RLS_TESTS_ENABLED,
  serviceSql,
} from "./_helpers";

/**
 * RLS: the four resus tables (migration 0038) — Resus Desk v2 Law 1 / P13.
 *
 * Actors: same-hospital clinical staff (read), another hospital's clinical
 * staff (deny), a reception (non-clinical) cadre at the same hospital (deny),
 * anonymous (deny), the patient (own episode), the recorder of an entry, and a
 * superadmin (deny since 0287: break-glass only). Every client-side INSERT / UPDATE / DELETE is denied — writes go
 * through the service role inside audited server actions only.
 *
 * Live-DB suite: SKIPS unless MEDSYNC_ALLOW_RLS_DB_WRITES=1 and the Supabase
 * env is present (point it at a TEST project, never production).
 */

const TABLES = [
  "resus_episodes",
  "resus_timeline_events",
  "resus_role_assignments",
  "resus_mobilisation_alerts",
] as const;

describe.skipIf(!RLS_TESTS_ENABLED)("RLS: resus tables", () => {
  let clinician: TestUser; // clinical staff at hospital A
  let otherClinician: TestUser; // clinical staff at hospital B
  let receptionist: TestUser; // non-clinical cadre at hospital A
  let patient: TestUser; // the episode's patient
  let recorder: TestUser; // wrote one timeline entry, no affiliation
  let superadmin: TestUser;
  let hospitalA: { id: string };
  let hospitalB: { id: string };
  let episodeId: string;
  let otherEpisodeId: string;
  const ids: Record<(typeof TABLES)[number], string> = {} as never;

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
    clinician = await createTestUser("resus", "clinician");
    otherClinician = await createTestUser("resus", "other");
    receptionist = await createTestUser("resus", "reception");
    patient = await createTestUser("resus", "patient");
    recorder = await createTestUser("resus", "recorder");
    superadmin = await createTestUser("resus", "superadmin");
    // Hospital A holds append-only timeline rows, which can never be deleted —
    // so it is a PERSISTENT fixture (not "Test "-named, which cleanup() would
    // try, and fail, to cascade-delete). Hospital B holds no timeline.
    const [fixture] = await serviceSql<{ id: string }[]>`
      INSERT INTO public.hospitals (name, slug, level)
      VALUES ('RLS Resus Fixture', 'rls-resus-fixture', 'national_referral')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id`;
    hospitalA = { id: fixture!.id };
    hospitalB = await createTestHospital("resus-b");
    await affiliate(clinician, hospitalA.id, true);
    await affiliate(otherClinician, hospitalB.id, true);
    await affiliate(receptionist, hospitalA.id, false);
    await grantRole(superadmin.id, "superadmin", null);

    const [ep] = await serviceSql<{ id: string }[]>`
      INSERT INTO public.resus_episodes (hospital_id, patient_user_id, trigger_kind, state)
      VALUES (${hospitalA.id}, ${patient.id}, 'in_resus_deterioration', 'active') RETURNING id`;
    episodeId = ep!.id;
    ids.resus_episodes = episodeId;
    const [other] = await serviceSql<{ id: string }[]>`
      INSERT INTO public.resus_episodes (hospital_id, trigger_kind, state)
      VALUES (${hospitalB.id}, 'in_resus_deterioration', 'active') RETURNING id`;
    otherEpisodeId = other!.id;

    const [tl] = await serviceSql<{ id: string }[]>`
      INSERT INTO public.resus_timeline_events (episode_id, kind, step, recorded_by_user_id, payload)
      VALUES (${episodeId}, 'note', 'pre', ${recorder.id}, '{}'::jsonb) RETURNING id`;
    ids.resus_timeline_events = tl!.id;
    const [ra] = await serviceSql<{ id: string }[]>`
      INSERT INTO public.resus_role_assignments (episode_id, user_id, role)
      VALUES (${episodeId}, ${clinician.id}, 'leader') RETURNING id`;
    ids.resus_role_assignments = ra!.id;
    const [ma] = await serviceSql<{ id: string }[]>`
      INSERT INTO public.resus_mobilisation_alerts (episode_id, recipient_user_id)
      VALUES (${episodeId}, ${clinician.id}) RETURNING id`;
    ids.resus_mobilisation_alerts = ma!.id;
  }, 90_000);

  afterAll(async () => {
    // Timeline rows are append-only by design, so this suite's episode and its
    // recorder user stay behind in the TEST project (user deletion would have to
    // null recorded_by_user_id, which the trigger forbids). Everything else goes.
    await cleanup();
  }, 60_000);

  const episodeKey = (t: (typeof TABLES)[number]) => (t === "resus_episodes" ? "id" : "episode_id");

  for (const table of TABLES) {
    test(`${table}: same-hospital clinical staff can read`, async () => {
      const { data, error } = await clinician.client
        .from(table)
        .select("id")
        .eq(episodeKey(table), episodeId);
      expect(error).toBeNull();
      expect(data?.length ?? 0).toBeGreaterThan(0);
    });

    test(`${table}: another hospital's clinical staff cannot read`, async () => {
      const { data } = await otherClinician.client
        .from(table)
        .select("id")
        .eq(episodeKey(table), episodeId);
      expect(data ?? []).toHaveLength(0);
    });

    test(`${table}: reception (non-clinical cadre) cannot read`, async () => {
      const { data } = await receptionist.client
        .from(table)
        .select("id")
        .eq(episodeKey(table), episodeId);
      // The recipient own-row arm does not apply (not a recipient/holder).
      expect(data ?? []).toHaveLength(0);
    });

    test(`${table}: anonymous cannot read`, async () => {
      const { data } = await anonClient().from(table).select("id").eq(episodeKey(table), episodeId);
      expect(data ?? []).toHaveLength(0);
    });

    // Review C-3 (0287): the superadmin reads a patient's record through break-glass only.
    test(`${table}: superadmin cannot read`, async () => {
      const { data } = await superadmin.client
        .from(table)
        .select("id")
        .eq(episodeKey(table), episodeId);
      expect(data ?? []).toHaveLength(0);
    });

    test(`${table}: client INSERT is denied`, async () => {
      const row: Record<string, unknown> =
        table === "resus_episodes"
          ? { hospital_id: hospitalA.id, trigger_kind: "in_resus_deterioration" }
          : table === "resus_timeline_events"
            ? { episode_id: episodeId, kind: "note", payload: {} }
            : table === "resus_role_assignments"
              ? { episode_id: episodeId, user_id: clinician.id, role: "scribe" }
              : { episode_id: episodeId, recipient_user_id: clinician.id };
      const { error } = await clinician.client.from(table).insert(row);
      expect(error).not.toBeNull();
    });

    test(`${table}: client UPDATE changes nothing`, async () => {
      const patch: Record<string, unknown> =
        table === "resus_episodes"
          ? { outcome: "tampered" }
          : table === "resus_timeline_events"
            ? { payload: { tampered: true } }
            : table === "resus_role_assignments"
              ? { role: "runner" }
              : { responding: true };
      await clinician.client.from(table).update(patch).eq("id", ids[table]);
      const col = Object.keys(patch)[0]!;
      const [row] = await serviceSql.unsafe(`SELECT ${col} FROM public.${table} WHERE id = $1`, [
        ids[table],
      ]);
      expect(JSON.stringify(row?.[col])).not.toContain("tampered");
      if (table === "resus_role_assignments") expect(row?.[col]).toBe("leader");
      if (table === "resus_mobilisation_alerts") expect(row?.[col]).toBe(false);
    });

    test(`${table}: client DELETE removes nothing`, async () => {
      await clinician.client.from(table).delete().eq("id", ids[table]);
      const rows = await serviceSql.unsafe(`SELECT id FROM public.${table} WHERE id = $1`, [
        ids[table],
      ]);
      expect(rows).toHaveLength(1);
    });
  }

  test("resus_episodes: the patient can read their own episode", async () => {
    const { data } = await patient.client.from("resus_episodes").select("id").eq("id", episodeId);
    expect(data ?? []).toHaveLength(1);
  });

  test("resus_episodes: the patient cannot read someone else's episode", async () => {
    const { data } = await patient.client
      .from("resus_episodes")
      .select("id")
      .eq("id", otherEpisodeId);
    expect(data ?? []).toHaveLength(0);
  });

  test("resus_timeline_events: the recorder can read their own entry", async () => {
    const { data } = await recorder.client
      .from("resus_timeline_events")
      .select("id")
      .eq("id", ids.resus_timeline_events);
    expect(data ?? []).toHaveLength(1);
  });

  test("resus_timeline_events: even the service role cannot UPDATE (append-only trigger)", async () => {
    await expect(
      serviceSql`UPDATE public.resus_timeline_events SET payload = '{}'::jsonb WHERE id = ${ids.resus_timeline_events}`,
    ).rejects.toThrow(/append-only/);
  });

  test("resus_timeline_events: even the service role cannot DELETE (append-only trigger)", async () => {
    await expect(
      serviceSql`DELETE FROM public.resus_timeline_events WHERE id = ${ids.resus_timeline_events}`,
    ).rejects.toThrow(/append-only/);
  });
});
