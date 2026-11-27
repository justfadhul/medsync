import type { LayoutBed, WardLayout } from "@/lib/wards/layout-schema";
import { describe, expect, it } from "vitest";

import { layoutChecks } from "@/lib/wards/checks";
import { bedRect, emptyLayout, shellWalls } from "@/lib/wards/geometry";

/* EU layout checks: warnings only, EU wards only (draft wording). */

const bed = (key: string, label: string, over: Partial<LayoutBed> = {}): LayoutBed => ({
  key,
  label,
  type: "standard",
  x: 2 + Number(key.slice(1)) * 4,
  y: 2,
  rot: 0,
  services: ["o2", "call"],
  status: "in",
  ...over,
});

function ward(beds: LayoutBed[], trolleyAt = { x: 26, y: 14 }): WardLayout {
  const d = emptyLayout({ w: 42, h: 32 });
  return {
    ...d,
    dividers: shellWalls(d),
    fixtures: [
      { key: "f1", kind: "station", label: "Nurses’ station", x: 18, y: 14, rot: 0 },
      { key: "f2", kind: "resus_trolley", label: "Resus trolley", ...trolleyAt, rot: 0 },
    ],
    beds,
  };
}

const R = (k: string, over: Partial<LayoutBed> = {}) =>
  bed(k, `R${k.slice(1)}`, {
    type: "resus",
    services: ["o2", "suction", "monitor", "call"],
    ...over,
  });

describe("EU layout checks", () => {
  it("EU: resus services, trolley reach and isolation, in that order, never blocking", () => {
    const c = layoutChecks(
      ward([R("b1"), R("b2", { services: ["o2", "call"] })]),
      "emergency_observation",
    );
    const codes = c.map((x) => x.code);
    expect(codes).not.toContain("monitor");
    expect(
      codes.slice(codes.indexOf("resus_trolley") + 1, codes.indexOf("resus_trolley") + 4),
    ).toEqual(["resus_services", "resus_trolley_reach", "eu_isolation"]);
    expect(c.find((x) => x.code === "resus_services")).toMatchObject({
      ok: false,
      text: "Resus spaces without oxygen, suction or a monitor: R2",
      blocking: false,
    });
    expect(c.find((x) => x.code === "eu_isolation")).toMatchObject({
      ok: false,
      text: "No isolation room on the plan",
      blocking: false,
    });
  });

  it("a resus space 10 cells from the trolley is in reach; 11 is not", () => {
    const r = R("b1");
    const rc = bedRect(r);
    const cx = rc.x + rc.w / 2;
    const cy = rc.y + rc.h / 2;
    // a trolley is 2x2, so its centre is x + 1
    const at = (dx: number) => ward([r], { x: cx + dx - 1, y: cy - 1 });
    const reach = (d: WardLayout) =>
      layoutChecks(d, "emergency_observation").find((x) => x.code === "resus_trolley_reach")!;
    expect(reach(at(10)).ok).toBe(true);
    expect(reach(at(11))).toMatchObject({
      ok: false,
      text: "Resus spaces more than 5 m from a resus trolley: R1",
      blocking: false,
    });
  });

  it("children apart only for an all-ages EU with cots", () => {
    const d = ward([bed("b1", "C1", { type: "cot" })]);
    expect(layoutChecks(d, "emergency_observation", "adult").map((x) => x.code)).not.toContain(
      "children_apart",
    );
    expect(
      layoutChecks(d, "emergency_observation", "all").find((x) => x.code === "children_apart"),
    ).toMatchObject({ ok: false, text: "Cots in the open floor beside adults: C1" });
  });

  it("a general or HDU ward gets exactly the checks it got before", () => {
    const d = ward([bed("b1", "B1")]);
    expect(layoutChecks(d, "general").map((x) => x.code)).toEqual([
      "nurse_call",
      "oxygen",
      "station",
      "resus_trolley",
      "bed_overlap",
      "overlap",
      "piped_at_wall",
      "duplicate_numbers",
    ]);
    expect(layoutChecks(d, "hdu").map((x) => x.code)).toContain("monitor");
  });
});
