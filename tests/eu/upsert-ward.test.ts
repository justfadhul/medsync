import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Source-level, like tests/functions/encounter-lifecycle: Deno functions do not run under Vitest. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const src = stripComments(
  readFileSync(
    resolve(process.cwd(), "supabase/functions/ha-services-hub/ops-structure.ts"),
    "utf8",
  ),
);
const start = src.indexOf("const upsertWard: OpHandler");
const upsert = src.slice(start, src.indexOf("async function loadWard(", start));
const schema = src.slice(
  src.indexOf('z.literal("upsert_ward")'),
  src.indexOf('z.literal("set_ward_closure")'),
);

describe("upsert_ward — the attached-to ward and the ward-type guard", () => {
  it("accepts parent_ward_id", () => {
    expect(schema).toContain("parent_ward_id: uuid.nullable().optional()");
  });
  it("refuses a parent on a ward that is not an emergency unit", () => {
    expect(upsert).toContain('"Only an emergency unit is attached to a ward."');
  });
  it("refuses a parent that is not an ordinary, live ward of this hospital", () => {
    expect(upsert).toContain('"Attach it to an ordinary ward of this hospital."');
    expect(upsert).toMatch(/\.eq\("hospital_id", ctx\.hospitalId\)/);
    expect(upsert).toContain("archived_at");
    expect(upsert).toContain("parent.id === i.id");
  });
  it("refuses changing the emergency-unit type while patients are in the beds", () => {
    expect(upsert).toContain(
      '"Move the patients out before changing whether this ward is an emergency unit."',
    );
    expect(upsert).toContain("occupiedBedCount(ctx, { wardIds: [i.id] })");
    expect(upsert).toContain('const EU = "emergency_observation"');
    expect(upsert).toContain("(w.ward_type === EU) !== (wardType === EU)");
  });
  it("refuses making a ward with units attached into a unit itself (R20)", () => {
    expect(upsert).toContain('"Detach its emergency units before making it one."');
    expect(upsert).toContain('.eq("parent_ward_id", i.id)');
  });
  it("clears the parent in the same write when the type moves away from emergency unit", () => {
    expect(upsert).toContain("parent_ward_id: null");
  });
});
