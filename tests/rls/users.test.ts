import type { TestUser } from "./_helpers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  anonClient,
  cleanup,
  closeSql,
  createTestUser,
  deleteUser,
  RLS_TESTS_ENABLED,
  serviceSql,
} from "./_helpers";

describe.skipIf(!RLS_TESTS_ENABLED)("RLS: public.users", () => {
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    // After Phase 0.9 the auth.users INSERT trigger auto-mirrors into
    // public.users with metadata.full_name as the source of truth.
    alice = await createTestUser("users", "alice");
    bob = await createTestUser("users", "bob");
    // Overwrite full_name so assertions below can rely on stable values.
    await serviceSql`UPDATE public.users SET full_name = 'Alice' WHERE id = ${alice.id}`;
    await serviceSql`UPDATE public.users SET full_name = 'Bob' WHERE id = ${bob.id}`;
  }, 60_000);

  afterAll(async () => {
    await deleteUser(alice.id).catch(() => {});
    await deleteUser(bob.id).catch(() => {});
  }, 30_000);

  test("anon cannot SELECT users", async () => {
    const { data, error } = await anonClient().from("users").select("*");
    // RLS denies — Supabase returns empty rows + no error for anon-blocked
    // tables. Either an error or zero rows is acceptable; never both rows.
    expect(error ?? data?.length).not.toBe(2);
    expect(data?.length ?? 0).toBe(0);
  });

  test("alice SELECTs only her own row", async () => {
    const { data, error } = await alice.client.from("users").select("id,email");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.id).toBe(alice.id);
  });

  test("alice can UPDATE her own row", async () => {
    const { error } = await alice.client
      .from("users")
      .update({ full_name: "Alice Updated" })
      .eq("id", alice.id);
    expect(error).toBeNull();

    const [row] = await serviceSql<{ full_name: string }[]>`
      SELECT full_name FROM public.users WHERE id = ${alice.id}
    `;
    expect(row?.full_name).toBe("Alice Updated");
  });

  test("alice CANNOT UPDATE bob's row", async () => {
    const { error } = await alice.client
      .from("users")
      .update({ full_name: "hacked" })
      .eq("id", bob.id);
    // RLS denial returns no error but updates zero rows. Verify bob unchanged.
    expect(error).toBeNull();
    const [row] = await serviceSql<{ full_name: string }[]>`
      SELECT full_name FROM public.users WHERE id = ${bob.id}
    `;
    expect(row?.full_name).toBe("Bob");
  });

  test("alice CANNOT change her own state or email (review C-4, 0284)", async () => {
    for (const patch of [{ state: "active" }, { email: "boss@example.org" }]) {
      const { error } = await alice.client.from("users").update(patch).eq("id", alice.id);
      expect(error).not.toBeNull();
    }
  });

  test("authenticated CANNOT INSERT into users", async () => {
    const { error } = await alice.client
      .from("users")
      .insert({ id: crypto.randomUUID(), email: "x@x.com", full_name: "x" });
    expect(error).not.toBeNull();
  });

  test("authenticated CANNOT DELETE users", async () => {
    // Refused by grant since 0284; either way the row must still be there.
    await alice.client.from("users").delete().eq("id", alice.id);
    const [row] = await serviceSql<{ id: string }[]>`
      SELECT id FROM public.users WHERE id = ${alice.id}
    `;
    expect(row?.id).toBe(alice.id);
  });
});

afterAll(async () => {
  await cleanup();
  await closeSql();
}, 60_000);
