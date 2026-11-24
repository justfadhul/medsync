import { describe, expect, it } from "vitest";

import { layoutChecks } from "@/lib/wards/checks";
import { parseLayout } from "@/lib/wards/layout-schema";
import { presetsFor } from "@/lib/wards/presets";

/* The four templates, on the default floor and on small and large ones. */
const FLOORS = [
  { w: 42, h: 32 },
  { w: 24, h: 20 },
  { w: 60, h: 40 },
  { w: 120, h: 120 },
];

describe.each(FLOORS)("templates on a $w × $h floor", (floor) => {
  it.each(presetsFor(floor).map((p) => [p.id, p] as const))(
    "%s: valid, inside the floor, nothing blocks",
    (_id, p) => {
      const doc = p.build();
      const parsed = parseLayout(doc);
      expect(parsed.ok ? "ok" : parsed.error).toBe("ok");
      expect(doc.floor).toEqual(floor);
      const blocking = layoutChecks(doc, null).filter((c) => c.blocking && !c.ok);
      expect(blocking.map((c) => c.text)).toEqual([]);
    },
  );
});

describe.each(FLOORS)("EU template on a $w × $h floor", (floor) => {
  it("is valid and nothing blocks", () => {
    const doc = presetsFor(floor, { eu: true })[0]!.build();
    const parsed = parseLayout(doc);
    expect(parsed.ok ? "ok" : parsed.error).toBe("ok");
    expect(layoutChecks(doc, "emergency_observation").filter((c) => c.blocking && !c.ok)).toEqual(
      [],
    );
  });
});

it("the EU template is offered only when asked, first", () => {
  expect(presetsFor({ w: 42, h: 32 }).map((p) => p.id)).toEqual(["open", "bays", "hdu", "empty"]);
  expect(presetsFor({ w: 42, h: 32 }, { eu: true })[0]!.id).toBe("eu");
});
it.each([
  { w: 42, h: 32 },
  { w: 60, h: 40 },
])("the EU template passes its own EU checks on $w × $h", (floor) => {
  const doc = presetsFor(floor, { eu: true })[0]!.build();
  const c = layoutChecks(doc, "emergency_observation");
  for (const code of ["resus_services", "resus_trolley_reach", "eu_isolation"])
    expect(c.find((x) => x.code === code)?.ok).toBe(true);
});

describe("what the templates record", () => {
  const [open, bays, hdu, empty] = presetsFor({ w: 42, h: 32 }).map((p) => p.build());
  it("the open ward: 18 beds, heads to the wall, no services, a station and a trolley, nothing overlapping", () => {
    expect(open!.beds).toHaveLength(18);
    expect(open!.beds.every((b) => b.services.length === 0)).toBe(true);
    const checks = Object.fromEntries(layoutChecks(open!, "general").map((c) => [c.code, c]));
    expect(checks.station!.ok).toBe(true);
    expect(checks.resus_trolley!.ok).toBe(true);
    expect(checks.overlap!.text).toBe("Nothing else overlaps");
  });
  it("bays and rooms: two bays, four single rooms (the last isolation, with hand-wash)", () => {
    expect(bays!.rooms.map((r) => r.kind)).toEqual([
      "bay",
      "bay",
      "private",
      "private",
      "private",
      "isolation",
    ]);
    const iso = Object.fromEntries(layoutChecks(bays!, null).map((c) => [c.code, c]));
    expect(iso.isolation_handwash!.ok).toBe(true);
    expect(iso.overlap!.ok).toBe(true);
  });
  it("high dependency: ICU beds whose piped services sit at the wall, with monitors", () => {
    expect(hdu!.beds.every((b) => b.type === "icu" && b.services.includes("monitor"))).toBe(true);
    const c = Object.fromEntries(layoutChecks(hdu!, "hdu").map((x) => [x.code, x]));
    expect(c.piped_at_wall!.ok).toBe(true);
    expect(c.monitor!.ok).toBe(true);
    expect(c.overlap!.ok).toBe(true);
  });
  it("the empty floor is four walls", () => {
    expect(empty!.dividers).toHaveLength(4);
    expect(empty!.beds).toEqual([]);
  });
});

describe("every template puts a bed's head at a wall", () => {
  it.each(presetsFor({ w: 42, h: 32 }).map((p) => [p.id, p] as const))(
    "%s: with oxygen at every bed, the piped-services check passes",
    (_id, p) => {
      const doc = p.build();
      const piped = { ...doc, beds: doc.beds.map((b) => ({ ...b, services: ["o2" as const] })) };
      const c = layoutChecks(piped, null).find((x) => x.code === "piped_at_wall")!;
      expect(c.text).toBe("Beds with piped services have their heads at a wall");
    },
  );
});
