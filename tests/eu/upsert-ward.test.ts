import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { decideWardAttach, WARD_ATTACH_WORDS } from "@/supabase/functions/_shared/ward-layout";

const EU = "emergency_observation";
const ordinary = { id: "p", type: "general", archived: false };
const base = {
  type: EU as string | null,
  parentId: undefined as string | null | undefined,
  wardId: "w" as string | null,
  stored: { type: EU } as { type: string | null } | null,
  parent: null as { id: string; type: string | null; archived: boolean } | null,
  units: 0,
  occupied: 0,
};
const run = (o: Partial<typeof base>) => decideWardAttach({ ...base, ...o });
const refused = (o: Partial<typeof base>) => {
  const v = run(o);
  if (v.ok) throw new Error("expected a refusal");
  return v;
};

describe("decideWardAttach — the whole truth table", () => {
  it("a parent on a non-EU ward is refused (400)", () => {
    expect(
      refused({ type: "general", stored: { type: "general" }, parentId: "p", parent: ordinary }),
    ).toMatchObject({
      status: 400,
      message: WARD_ATTACH_WORDS.onlyEu,
    });
    expect(WARD_ATTACH_WORDS.onlyEu).toBe("Only an emergency unit is attached to a ward.");
  });
  it.each([
    ["missing or another hospital's", null],
    ["archived", { ...ordinary, archived: true }],
    ["itself", { ...ordinary, id: "w" }],
    ["an EU", { ...ordinary, type: EU }],
  ])("a parent that is %s is refused (400)", (_n, parent) => {
    expect(refused({ parentId: parent?.id ?? "x", parent })).toMatchObject({
      status: 400,
      message: WARD_ATTACH_WORDS.ordinaryParent,
    });
  });
  it("an ordinary live parent is written", () => {
    expect(run({ parentId: "p", parent: ordinary })).toEqual({ ok: true, parent: "p" });
  });
  it("EU with parent omitted keeps the stored one; explicit null clears", () => {
    expect(run({})).toEqual({ ok: true, parent: undefined });
    expect(run({ parentId: null })).toEqual({ ok: true, parent: null });
  });
  it("a non-EU always writes parent null, whatever was stored", () => {
    expect(run({ type: "general", stored: { type: EU } })).toEqual({ ok: true, parent: null });
    expect(run({ type: "general", stored: { type: "general" } })).toEqual({
      ok: true,
      parent: null,
    });
    expect(run({ type: null, stored: null, wardId: null })).toEqual({ ok: true, parent: null });
  });
  it("changing to or from EU with patients in the beds is refused (409)", () => {
    for (const [type, stored] of [
      ["general", EU],
      [EU, "general"],
    ] as const)
      expect(refused({ type, stored: { type: stored }, occupied: 2 })).toMatchObject({
        status: 409,
        message: WARD_ATTACH_WORDS.movePatients,
      });
  });
  it("patients do not block an edit that keeps the type", () => {
    expect(run({ occupied: 3 }).ok).toBe(true);
    expect(run({ type: "general", stored: { type: "general" }, occupied: 3 }).ok).toBe(true);
  });
  it("R20: a ward with units attached cannot become an EU (409); units do not block other edits", () => {
    expect(refused({ type: EU, stored: { type: "general" }, units: 1 })).toMatchObject({
      status: 409,
      message: WARD_ATTACH_WORDS.detachFirst,
    });
    expect(run({ type: "general", stored: { type: "general" }, units: 1 }).ok).toBe(true);
  });
  it("a new EU (no stored ward) may take a parent; a new ward has no flip to guard", () => {
    expect(
      run({ wardId: null, stored: null, parentId: "p", parent: ordinary, occupied: 9 }),
    ).toEqual({
      ok: true,
      parent: "p",
    });
  });
});

describe("upsert_ward — the Edge Function wiring", () => {
  const src = readFileSync(
    resolve(process.cwd(), "supabase/functions/ha-services-hub/ops-structure.ts"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const upsert = src.slice(
    src.indexOf("const upsertWard: OpHandler"),
    src.indexOf("async function loadWard("),
  );
  it("takes parent_ward_id and decides through decideWardAttach", () => {
    expect(src).toContain("parent_ward_id: uuid.nullable().optional()");
    expect(upsert).toContain("decideWardAttach(");
  });
  it("counts only unarchived units and fails closed on the count's error", () => {
    expect(upsert).toMatch(/\.is\("archived_at", null\)/);
    expect(upsert).toMatch(/units\?\.error/);
  });
  it("maps the database guard's hints to words, never the raw error", () => {
    expect(src).toContain("ward_parent_not_ordinary");
    expect(src).toContain("ward_has_units");
    expect(upsert).toContain("wardWrite(");
  });
});
