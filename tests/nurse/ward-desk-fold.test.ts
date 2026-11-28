import { describe, expect, it } from "vitest";

import { attendance, incidentCounts, standing } from "@/lib/ward-desk/fold";

describe("running the ward: standing state of append-only rows (ADR 0545)", () => {
  it("keeps rows no later row names", () => {
    expect(
      standing([
        { id: "a", replacesId: null },
        { id: "b", replacesId: "a" },
      ]).map((r) => r.id),
    ).toEqual(["b"]);
  });
  it("takes each person's latest attendance word", () => {
    const m = attendance([
      { userId: "n1", kind: "asked", recordedAt: new Date(1) },
      { userId: "n1", kind: "going", recordedAt: new Date(2) },
      { userId: "n2", kind: "asked", recordedAt: new Date(1) },
    ]);
    expect(Object.fromEntries(m)).toEqual({ n1: "going", n2: "asked" });
  });
  it("counts reported incidents, not ones withdrawn", () => {
    const c = incidentCounts([
      { id: "f1", replacesId: null, kind: "fall", state: "reported" },
      { id: "f2", replacesId: null, kind: "fall", state: "reported" },
      { id: "x", replacesId: "f2", kind: "fall", state: "entered_in_error" },
      { id: "p1", replacesId: null, kind: "pressure_injury", state: "reported" },
    ]);
    expect(c).toEqual({ fall: 1, pressure_injury: 1 });
  });
});
