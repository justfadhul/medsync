import type { TestUser } from "./_helpers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { anonClient, cleanup, createTestUser, RLS_TESTS_ENABLED, serviceSql } from "./_helpers";

/**
 * RLS: the doctor workspace topic `workspace:<hospitalId>` (migration 0069).
 * Same actors as the resus suites: an active clinician of the hospital may
 * listen; another hospital's clinician, a receptionist (non-clinical cadre)
 * and anonymous may not. 0069 adds no table, so there is no client write to
 * deny beyond what the three source tables already deny.
 *
 * Live-DB suite: SKIPS unless MEDSYNC_ALLOW_RLS_DB_WRITES=1 against a TEST
 * project with 0069 applied.
 */

type Channelable = { channel: TestUser["client"]["channel"]; realtime: TestUser["client"]["realtime"] };

/** Subscribe to a private topic and report how the server answered. */
async function listen(client: Channelable, topic: string): Promise<string> {
  await client.realtime.setAuth().catch(() => undefined);
  const channel = client.channel(topic, { config: { private: true } });
  const status = await new Promise<string>((done) => {
    const timer = setTimeout(() => done("TIMED_OUT"), 10_000);
    channel.subscribe((s) => {
      if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "CLOSED") {
        clearTimeout(timer);
        done(s);
      }
    });
  });
  await channel.unsubscribe();
  return status;
}

describe.skipIf(!RLS_TESTS_ENABLED)("RLS: the workspace realtime topic", () => {
  let clinician: TestUser;
  let otherClinician: TestUser;
  let receptionist: TestUser;
  let hospitalA: string;
  let hospitalB: string;

  async function affiliate(user: TestUser, hospitalId: string, clinical: boolean) {
    const [found] = await serviceSql<{ id: string }[]>`
      SELECT id FROM public.hospital_departments
      WHERE hospital_id = ${hospitalId} AND slug = 'workspace-rls' LIMIT 1`;
    const [dept] = found
      ? [found]
      : await serviceSql<{ id: string }[]>`
          INSERT INTO public.hospital_departments (hospital_id, name, slug)
          VALUES (${hospitalId}, 'Workspace RLS', 'workspace-rls') RETURNING id`;
    const [cadre] = await serviceSql<{ id: string }[]>`
      SELECT id FROM public.cadres WHERE is_clinical = ${clinical} LIMIT 1`;
    const [role] = await serviceSql<{ id: string }[]>`SELECT id FROM public.roles LIMIT 1`;
    await serviceSql`
      INSERT INTO public.staff_affiliations
        (user_id, hospital_id, department_id, cadre_id, role_id, employment_type, state, approved_at)
      VALUES (${user.id}, ${hospitalId}, ${dept!.id}, ${cadre!.id}, ${role!.id}, 'full_time', 'active', now())`;
  }

  beforeAll(async () => {
    clinician = await createTestUser("workspace", "clinician");
    otherClinician = await createTestUser("workspace", "other");
    receptionist = await createTestUser("workspace", "reception");
    const [a] = await serviceSql<{ id: string }[]>`
      INSERT INTO public.hospitals (name, slug, level)
      VALUES ('RLS Workspace Fixture', 'rls-workspace-fixture', 'national_referral')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
    const [b] = await serviceSql<{ id: string }[]>`
      INSERT INTO public.hospitals (name, slug, level)
      VALUES ('RLS Workspace Fixture B', 'rls-workspace-fixture-b', 'national_referral')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
    hospitalA = a!.id;
    hospitalB = b!.id;
    await affiliate(clinician, hospitalA, true);
    await affiliate(otherClinician, hospitalB, true);
    await affiliate(receptionist, hospitalA, false);
  }, 90_000);

  afterAll(async () => {
    await cleanup();
  }, 60_000);

  test("same-hospital clinical staff may listen", async () => {
    expect(await listen(clinician.client, `workspace:${hospitalA}`)).toBe("SUBSCRIBED");
  });

  for (const [label, who] of [
    ["another hospital's clinician", () => otherClinician.client],
    ["reception", () => receptionist.client],
    ["anonymous", () => anonClient()],
  ] as const) {
    test(`${label} may not listen`, async () => {
      expect(await listen(who(), `workspace:${hospitalA}`)).not.toBe("SUBSCRIBED");
    });
  }

  test("a malformed topic is refused", async () => {
    expect(await listen(clinician.client, "workspace:not-a-hospital")).not.toBe("SUBSCRIBED");
  });
});
