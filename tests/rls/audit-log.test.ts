import type { TestUser } from "./_helpers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  anonClient,
  createTestUser,
  deleteUser,
  grantRole,
  RLS_TESTS_ENABLED,
  serviceSql,
} from "./_helpers";

describe.skipIf(!RLS_TESTS_ENABLED)("RLS: public.audit_log", () => {
  let regular: TestUser;
  let superAdmin: TestUser;

  beforeAll(async () => {
    regular = await createTestUser("audit", "user");
    superAdmin = await createTestUser("audit", "super");
    await grantRole(superAdmin.id, "superadmin", null);
    // Seed a single audit row directly (we have no INSERT path until 0.6).
    await serviceSql`
      INSERT INTO public.audit_log (action, schema_name, table_name, record_id)
      VALUES ('insert', 'public', 'rls_audit_test', 'seed')
    `;
  }, 60_000);

  afterAll(async () => {
    // audit_log is append-only post-0.6 — DELETE raises. Leak the seed rows.
    await deleteUser(regular.id).catch(() => {});
    await deleteUser(superAdmin.id).catch(() => {});
  }, 30_000);

  test("anon CANNOT SELECT audit_log", async () => {
    const { data } = await anonClient().from("audit_log").select("id");
    expect(data?.length ?? 0).toBe(0);
  });

  test("regular authenticated user CANNOT SELECT audit_log", async () => {
    const { data } = await regular.client.from("audit_log").select("id");
    expect(data?.length ?? 0).toBe(0);
  });

  // Review C-3 (0289): audit rows hold whole patient records; the superadmin reads them through break-glass only.
  test("superadmin CANNOT SELECT audit_log", async () => {
    const { data } = await superAdmin.client
      .from("audit_log")
      .select("table_name")
      .eq("table_name", "rls_audit_test");
    expect(data?.length ?? 0).toBe(0);
  });

  test("authenticated CANNOT INSERT into audit_log directly", async () => {
    const { error } = await regular.client
      .from("audit_log")
      .insert({ action: "insert", schema_name: "public", table_name: "fake", record_id: "x" });
    expect(error).not.toBeNull();
  });

  test("superadmin CANNOT INSERT into audit_log directly (no INSERT policy)", async () => {
    const { error } = await superAdmin.client
      .from("audit_log")
      .insert({ action: "insert", schema_name: "public", table_name: "fake2", record_id: "x" });
    expect(error).not.toBeNull();
  });
});
