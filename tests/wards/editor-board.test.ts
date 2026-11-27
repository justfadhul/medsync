import { readFileSync } from "node:fs";
import type { WardLayout } from "@/lib/wards/layout-schema";
import { describe, expect, it } from "vitest";

import {
  addDivider,
  copyServicesToCompanions,
  duplicate,
  extent,
  itemsOf,
  moveTo,
  nudge,
  place,
  remove,
  resizeRoom,
  rotate,
  rotateTo,
  rotationFromDrag,
  setDividerEnd,
  setDividerLength,
  setFloor,
  toggleService,
} from "@/lib/wards/editor";
import {
  bedState,
  emptyLayout,
  freeByNeed,
  layoutFromRegister,
  mayWorkBeds,
  stateCounts,
} from "@/lib/wards/geometry";
import { parseLayout } from "@/lib/wards/layout-schema";
import { presetsFor } from "@/lib/wards/presets";

/* The editor's edits (pure) and the board's state engine (ADR 0194). */

const floor = { w: 42, h: 32 };

describe("editing", () => {
  it("places a bed with the next number and no services, kept on the floor", () => {
    const r = place(emptyLayout(floor), "bed:icu", { x: 41, y: 31 }, { x: 41, y: 31 });
    expect(r.doc.beds[0]).toMatchObject({
      key: "b1",
      label: "B1",
      type: "icu",
      x: 39,
      y: 28,
      services: [],
      status: "in",
    });
    expect(r.ref).toEqual({ kind: "bed", key: "b1" });
  });

  it("a single room comes with its bed; a bay comes empty", () => {
    const room = place(emptyLayout(floor), "room:isolation", { x: 2, y: 2 }, { x: 2, y: 2 });
    expect(room.doc.rooms[0]).toMatchObject({
      kind: "isolation",
      name: "Isolation room 1".replace(" room", ""),
      features: { ensuite: true, sink: true, anteroom: true },
    });
    expect(room.doc.beds).toHaveLength(1);
    const bay = place(emptyLayout(floor), "room:bay", { x: 2, y: 2 }, { x: 2, y: 2 });
    expect(bay.doc.rooms[0]!.name).toBe("Bay A");
    expect(bay.doc.beds).toHaveLength(0);
  });

  it("moves, nudges and rotates, never off the floor; a room rotation swaps its size", () => {
    let d = place(emptyLayout(floor), "bed:standard", { x: 5, y: 5 }, { x: 5, y: 5 }).doc;
    const ref = { kind: "bed" as const, key: "b1" };
    d = moveTo(d, ref, 100, 100);
    expect(d.beds[0]).toMatchObject({ x: 40, y: 28 });
    d = nudge(d, ref, 1, 1);
    expect(d.beds[0]).toMatchObject({ x: 40, y: 28 });
    d = rotate(d, ref);
    // About its middle (41, 30): 4 × 2 at (39, 29), then back onto the floor.
    expect(d.beds[0]).toMatchObject({ rot: 90, x: 38, y: 29 });
    let r = place(emptyLayout(floor), "room:bay", { x: 0, y: 0 }, { x: 0, y: 0 }).doc;
    r = rotate(r, { kind: "room", key: "r1" });
    expect(r.rooms[0]).toMatchObject({ w: 10, h: 12 });
  });

  it("rotating turns a bed about its middle, kept on the floor; the same turn changes nothing", () => {
    let d = place(emptyLayout(floor), "bed:standard", { x: 10, y: 10 }, { x: 10, y: 10 }).doc;
    const ref = { kind: "bed" as const, key: "b1" };
    const at = d.beds[0]!;
    // A 2 × 4 bed at (at.x, at.y) turned a quarter becomes 4 × 2 about the same middle.
    d = rotateTo(d, ref, 90);
    expect(d.beds[0]).toMatchObject({ rot: 90, x: at.x - 1, y: at.y + 1 });
    d = rotateTo(d, ref, 180);
    expect(d.beds[0]).toMatchObject({ rot: 180, x: at.x, y: at.y });
    expect(rotateTo(d, ref, 180)).toBe(d);
    // In a corner it stays on the floor.
    let c = place(emptyLayout(floor), "bed:standard", { x: 0, y: 0 }, { x: 0, y: 0 }).doc;
    c = rotateTo(c, ref, 270);
    expect(c.beds[0]!.x).toBeGreaterThanOrEqual(0);
    expect(c.beds[0]!.y).toBeGreaterThanOrEqual(0);
    // Rooms, doors and dividers aren't turned this way.
    expect(rotateTo(d, { kind: "room", key: "r1" }, 90)).toBe(d);
  });

  it("a drag of the rotate handle turns by the quarters the pointer sweeps, with no jump on grab", () => {
    const deg = (a: number) => (a * Math.PI) / 180;
    expect(rotationFromDrag(0, deg(90), deg(90))).toBe(0);
    expect(rotationFromDrag(0, deg(90), deg(130))).toBe(0);
    expect(rotationFromDrag(0, deg(90), deg(180))).toBe(90);
    expect(rotationFromDrag(0, deg(90), deg(-90))).toBe(180);
    expect(rotationFromDrag(0, deg(90), deg(0))).toBe(270);
    // Across the ±180° seam, and from any start.
    expect(rotationFromDrag(270, deg(170), deg(-170))).toBe(270);
    expect(rotationFromDrag(270, deg(170), deg(-100))).toBe(0);
    expect(rotationFromDrag(90, deg(0), deg(-90))).toBe(0);
  });

  it("duplicates one cell down and right; a bed gets the next number and no register id", () => {
    const d: WardLayout = {
      ...emptyLayout(floor),
      beds: [
        {
          key: "b1",
          bedId: "00000000-0000-4000-8000-000000000001",
          label: "B1",
          type: "standard",
          x: 2,
          y: 2,
          rot: 0,
          services: ["o2"],
          status: "in",
        },
      ],
    };
    const r = duplicate(d, { kind: "bed", key: "b1" });
    expect(r.doc.beds[1]).toEqual({
      key: "b2",
      label: "B2",
      type: "standard",
      x: 3,
      y: 3,
      rot: 0,
      services: ["o2"],
      status: "in",
    });
    expect(remove(r.doc, r.ref!).beds).toHaveLength(1);
  });

  it("dividers: drawn with a length, stretched by an end, never to nothing", () => {
    const e = emptyLayout(floor);
    expect(addDivider(e, "wall", { x: 3, y: 3 }, { x: 3, y: 3 })).toBeNull();
    let d = addDivider(e, "curtain", { x: 3, y: 3 }, { x: 9, y: 3 })!.doc;
    d = setDividerEnd(d, "d1", 2, { x: 12, y: 7 });
    expect(d.dividers[0]).toMatchObject({ x1: 3, y1: 3, x2: 12, y2: 3 });
    expect(setDividerEnd(d, "d1", 2, { x: 3, y: 3 }).dividers[0]!.x2).toBe(12);
    d = setDividerLength(d, "d1", 4);
    expect(d.dividers[0]).toMatchObject({ x2: 7 });
  });

  it("resizes a room from its corner: at least 1.5 m, never past the floor", () => {
    const d = place(emptyLayout(floor), "room:private", { x: 30, y: 20 }, { x: 30, y: 20 }).doc;
    expect(resizeRoom(d, "r1", 1, 1).rooms[0]).toMatchObject({ w: 3, h: 3 });
    expect(resizeRoom(d, "r1", 50, 50).rooms[0]).toMatchObject({ w: 12, h: 12 });
  });

  it("services: toggled in catalogue order, and copied to the other beds of the same room or open ward", () => {
    const d = presetsFor(floor)[1]!.build();
    const b1 = d.beds[0]!;
    let next = toggleService(toggleService(d, b1.key, "suction"), b1.key, "o2");
    expect(next.beds[0]!.services).toEqual(["o2", "suction"]);
    next = copyServicesToCompanions(next, b1.key);
    expect(next.beds.slice(0, 4).map((b) => b.services.join())).toEqual([
      "o2,suction",
      "o2,suction",
      "o2,suction",
      "o2,suction",
    ]);
    expect(next.beds[4]!.services).toEqual([]);
  });

  it("the floor grows and shrinks, never below what is on it", () => {
    const d = presetsFor(floor)[0]!.build();
    // The outer walls sit one cell in, so the floor can shrink to them, and no further.
    expect(extent(d)).toEqual({ w: 41, h: 31 });
    expect(setFloor(d, 30, 20).floor).toEqual({ w: 41, h: 31 });
    expect(setFloor(setFloor(d, 30, 20), 10, 10).floor).toEqual({ w: 41, h: 31 });
    expect(setFloor(d, 60, 40).floor).toEqual({ w: 60, h: 40 });
    expect(setFloor(emptyLayout(floor), 2, 2).floor).toEqual({ w: 8, h: 8 });
  });

  it("start from the register keeps a big register on a valid floor", () => {
    const beds = Array.from({ length: 200 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      label: `Bed ${i + 1}`,
      bedType: null,
      closedReason: null,
      services: [],
    }));
    const d = layoutFromRegister(beds);
    const parsed = parseLayout(d);
    expect(parsed.ok ? "ok" : parsed.error).toBe("ok");
    expect(d.beds).toHaveLength(200);
  });
});

describe("the Items list (ADR 0195 §6)", () => {
  it("lists every item, and a name shared within a kind is counted so each row's label is its own", () => {
    const d: WardLayout = {
      ...emptyLayout(floor),
      beds: [
        {
          key: "b1",
          label: "B1",
          type: "standard",
          x: 2,
          y: 2,
          rot: 0,
          services: [],
          status: "in",
        },
        {
          key: "b2",
          label: "B1",
          type: "standard",
          x: 6,
          y: 2,
          rot: 0,
          services: [],
          status: "in",
        },
        {
          key: "b3",
          label: "B3",
          type: "standard",
          x: 10,
          y: 2,
          rot: 0,
          services: [],
          status: "in",
        },
      ],
      dividers: [
        { key: "l1", kind: "window", x1: 2, y1: 0, x2: 8, y2: 0 },
        { key: "l2", kind: "window", x1: 20, y1: 0, x2: 24, y2: 0 },
        { key: "l3", kind: "wall", x1: 0, y1: 10, x2: 12, y2: 10 },
      ],
      doors: [
        { key: "o1", x: 1, y: 30, orient: "h" },
        { key: "o2", x: 30, y: 30, orient: "h" },
      ],
    };
    const names = itemsOf(d).map((r) => `${r.ref.kind}:${r.name}`);
    expect(names).toEqual([
      "bed:B1 (1 of 2)",
      "bed:B1 (2 of 2)",
      "bed:B3",
      "divider:Window (1 of 2)",
      "divider:Window (2 of 2)",
      "divider:Wall",
      "door:Door (1 of 2)",
      "door:Door (2 of 2)",
    ]);
    expect(new Set(names).size).toBe(names.length);
    for (const t of presetsFor(floor)) {
      const all = itemsOf(t.build()).map((r) => `${r.ref.kind}:${r.name}`);
      expect(new Set(all).size, t.id).toBe(all.length);
    }
  });
});

describe("bed state (ADR 0194 §1)", () => {
  const t = (h: number) => `2026-09-29T${String(h).padStart(2, "0")}:00:00.000Z`;
  it("an open assignment is Occupied, whatever else is true", () => {
    expect(
      bedState({
        closed: false,
        open: { startedAt: t(6) },
        lastEndedAt: null,
        events: [{ state: "cleaning", setAt: t(7), reason: null }],
      }),
    ).toEqual({
      state: "occupied",
      since: t(6),
      reason: null,
    });
  });
  it("a closed bed is Out", () => {
    expect(bedState({ closed: true, open: null, lastEndedAt: null, events: [] }).state).toBe("out");
  });
  it("otherwise the latest event since the last assignment ended, else Free", () => {
    const events = [
      { state: "reserved" as const, setAt: t(5), reason: "Transfer" },
      { state: "cleaning" as const, setAt: t(9), reason: null },
    ];
    expect(bedState({ closed: false, open: null, lastEndedAt: null, events }).state).toBe(
      "cleaning",
    );
    expect(bedState({ closed: false, open: null, lastEndedAt: t(10), events }).state).toBe("free");
    expect(bedState({ closed: false, open: null, lastEndedAt: t(8), events })).toMatchObject({
      state: "cleaning",
      since: t(9),
    });
    // Timestamps in either spelling compare as times, not strings.
    expect(
      bedState({ closed: false, open: null, lastEndedAt: "2026-09-29T08:00:00+00:00", events })
        .state,
    ).toBe("cleaning");
    expect(bedState({ closed: false, open: null, lastEndedAt: null, events: [] })).toEqual({
      state: "free",
      since: null,
      reason: null,
    });
  });
});

describe("free beds by what the patient needs", () => {
  const beds = [
    { id: "1", label: "B1", state: "free" as const, services: ["o2", "suction"], roomKind: null },
    {
      id: "2",
      label: "B2",
      state: "free" as const,
      services: ["monitor"],
      roomKind: "bay" as const,
    },
    {
      id: "3",
      label: "P1",
      state: "free" as const,
      services: ["o2"],
      roomKind: "private" as const,
    },
    { id: "4", label: "B4", state: "occupied" as const, services: ["o2"], roomKind: null },
    { id: "5", label: "B5", state: "cleaning" as const, services: ["o2"], roomKind: null },
    {
      id: "6",
      label: "I1",
      state: "reserved" as const,
      services: ["o2"],
      roomKind: "isolation" as const,
    },
  ];
  it("one pass: any, oxygen, suction, monitor, single room; only Free beds", () => {
    expect(
      Object.fromEntries(freeByNeed(beds).map((n) => [n.need, n.beds.map((b) => b.label)])),
    ).toEqual({
      any: ["B1", "B2", "P1"],
      o2: ["B1", "P1"],
      suction: ["B1"],
      monitor: ["B2"],
      single: ["P1"],
    });
  });
  it("counts every state for the legend", () => {
    expect(stateCounts(beds)).toEqual({
      occupied: 1,
      arriving: 0,
      free: 3,
      cleaning: 1,
      reserved: 1,
      out: 0,
    });
  });
});

describe("who may act on a ward's beds (ADR 0194 §3)", () => {
  it("the admin anywhere; the in-charge and assigned nurses on their own ward only", () => {
    expect(mayWorkBeds({ admin: true, inChargeWardIds: [], assignedWardIds: [] }, "w1")).toBe(true);
    expect(mayWorkBeds({ admin: false, inChargeWardIds: ["w1"], assignedWardIds: [] }, "w1")).toBe(
      true,
    );
    expect(mayWorkBeds({ admin: false, inChargeWardIds: [], assignedWardIds: ["w1"] }, "w1")).toBe(
      true,
    );
    expect(
      mayWorkBeds({ admin: false, inChargeWardIds: ["w2"], assignedWardIds: ["w3"] }, "w1"),
    ).toBe(false);
    expect(mayWorkBeds({ admin: false, inChargeWardIds: [], assignedWardIds: [] }, "w1")).toBe(
      false,
    );
  });
});

describe("the board read: EU arrivals (one Arriving rule)", () => {
  it("board.ts reads the stay and decides Arriving with isArriving", () => {
    const src = readFileSync("lib/wards/board.ts", "utf8");
    expect(src).toContain("isArriving(a)");
    expect(src).toContain("euStayId: s.a?.euStayId ?? null");
    expect(src).toContain("type: b.type");
  });
});
