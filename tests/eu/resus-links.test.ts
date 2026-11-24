import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { bayLabel } from "@/lib/resus/bay-label";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const hub = strip(read("supabase/functions/ha-services-hub/ops-wards.ts"));

describe("ops-wards: link_resus_bay and link_care_unit", () => {
  it("are admin-only ops with the brief's schemas", () => {
    expect(hub).toContain('op: z.literal("link_resus_bay")');
    expect(hub).toContain("bay_profile_id: uuid");
    expect(hub).toContain('op: z.literal("link_care_unit")');
    expect(hub).toContain("care_unit_id: uuid");
    expect(hub).toContain("link_resus_bay: linkResusBay");
    expect(hub).toContain("link_care_unit: linkCareUnit");
    expect(hub.match(/WARD_STAFF_OPS = new Set\(\[[^\]]*\]/s)![0]).not.toMatch(/link_/);
  });
  it("refuse in words, scope by hospital, audit, and apply inside apply()", () => {
    const h = hub.slice(hub.indexOf("const linkResusBay"));
    expect(h).toContain("Choose a resus space of an emergency unit.");
    expect(h).toContain("ctx.hospitalId");
    expect(h).toContain('action: "link_resus_bay"');
    expect(h).toContain('action: "link_care_unit"');
    expect(h).toContain("Choose a ward of this hospital.");
  });
});

describe("bayLabel", () => {
  const b = { bayLabel: "Bay 1", deviceModel: "ZOLL X", ward: null, space: null };
  it("is as today without a link", () => {
    expect(bayLabel(b)).toBe("Bay 1 · ZOLL X");
    expect(bayLabel({ ...b, deviceModel: null })).toBe("Bay 1");
  });
  it("names the ward and space when linked", () => {
    expect(bayLabel({ ...b, ward: "EU", space: "R2" })).toBe("EU R2 · ZOLL X");
    expect(bayLabel({ ...b, deviceModel: null, ward: "EU", space: "R2" })).toBe("EU R2");
  });
});
