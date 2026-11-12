import type { TestUser } from "./_helpers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createTestHospital,
  createTestUser,
  deleteHospital,
  deleteUser,
  grantRole,
  RLS_TESTS_ENABLED,
  serviceSql,
} from "./_helpers";

describe.skipIf(!RLS_TESTS_ENABLED)("RLS: public.user_roles", () => {
  let alice: TestUser;
  let bob: TestUser;
  let admin: TestUser;
  let superAdmin: TestUser;
  let hospitalA: { id: string; slug: string };
  let hospitalB: { id: string; slug: string };

  beforeAll(async () => {
    alice = await createTestUser("ur", "alice");
    bob = await createTestUser("ur", "bob");
    admin = await createTestUser("ur", "admin");
    superAdmin = await createTestUser("ur", "super");
    hospitalA = await createTestHospital("ur-a");
    hospitalB = await createTestHospital("ur-b");

    await grantRole(alice.id, "clinician", hospitalA.id);
    await grantRole(bob.id, "nurse", hospitalB.id);
    await grantRole(admin.id, "hospital_admin", hospitalA.id);
    await grantRole(superAdmin.id, "superadmin", null);
  }, 60_000);

  afterAll(async () => {
    await deleteHospital(hospitalA.id).catch(() => {});
    await deleteHospital(hospitalB.id).catch(() => {});
    for (const u of [alice, bob, admin, superAdmin]) {
      await deleteUser(u.id).catch(() => {});
    }
  }, 30_000);

  test("alice SELECTs only her own role", async () => {
    const { data, error } = await alice.client.from("user_roles").select("role,user_id");
    expect(error).toBeNull();
    expect(data?.every((r) => r.user_id === alice.id)).toBe(true);
  });

  test("alice CANNOT see bob's role", async () => {
    const { data } = await alice.client.from("user_roles").select("role").eq("user_id", bob.id);
    expect(data ?? []).toHaveLength(0);
  });

  test("hospital_admin SELECTs roles in their hospital", async () => {
    const { data, error } = await admin.client.from("user_roles").select("user_id,hospital_id");
    expect(error).toBeNull();
    // Admin sees: their own row + alice's clinician (same hospital) — bob's nurse (different hospital) hidden.
    const visibleUserIds = new Set(data?.map((r) => r.user_id) ?? []);
    expect(visibleUserIds.has(admin.id)).toBe(true);
    expect(visibleUserIds.has(alice.id)).toBe(true);
    expect(visibleUserIds.has(bob.id)).toBe(false);
  });

  test("superadmin SELECTs all roles", async () => {
    const { data, error } = await superAdmin.client.from("user_roles").select("user_id");
    expect(error).toBeNull();
    const visibleUserIds = new Set(data?.map((r) => r.user_id) ?? []);
    expect(visibleUserIds.has(alice.id)).toBe(true);
    expect(visibleUserIds.has(bob.id)).toBe(true);
  });

  test("non-admin CANNOT INSERT a role", async () => {
    const { error } = await alice.client.from("user_roles").insert({
      user_id: bob.id,
      role: "pharmacist",
      hospital_id: hospitalA.id,
    });
    expect(error).not.toBeNull();
  });

  // Review M-3 (0287): roles are granted only through the audited Edge Functions.
  test("hospital_admin CANNOT INSERT a role directly, even in their hospital", async () => {
    const { error } = await admin.client.from("user_roles").insert({
      user_id: bob.id,
      role: "pharmacist",
      hospital_id: hospitalA.id,
    });
    expect(error).not.toBeNull();
  });

  test("hospital_admin CANNOT INSERT a role in another hospital", async () => {
    const { error } = await admin.client.from("user_roles").insert({
      user_id: alice.id,
      role: "pharmacist",
      hospital_id: hospitalB.id,
    });
    expect(error).not.toBeNull();
  });

  test("authenticated CANNOT DELETE another user's role", async () => {
    await alice.client.from("user_roles").delete().eq("user_id", bob.id);
    const [row] = await serviceSql<{ user_id: string }[]>`
      SELECT user_id FROM public.user_roles WHERE user_id = ${bob.id}
    `;
    expect(row?.user_id).toBe(bob.id);
  });
});
