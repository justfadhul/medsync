/**
 * "Start from a layout": four templates, built for the ward's own floor (ADR 0191). They are shapes
 * to start from, not facts: beds carry no services (ADR 0193) except the high-dependency template,
 * whose name says it records full services. Applying one replaces the plan; undo brings it back.
 */
import type {
  LayoutBed,
  LayoutDivider,
  LayoutFixture,
  LayoutRoom,
  ServiceCode,
  WardLayout,
} from "@/supabase/functions/_shared/ward-layout";

import {
  emptyLayout,
  fixtureSize,
  nextKey,
  shellWalls,
} from "@/supabase/functions/_shared/ward-layout";

export type PresetId = "eu" | "open" | "bays" | "hdu" | "empty";

export interface Preset {
  id: PresetId;
  name: string;
  sub: string;
  build: () => WardLayout;
}

/** What the high-dependency template records at every bed. */
export const HDU_SERVICES: ServiceCode[] = [
  "o2",
  "suction",
  "air",
  "monitor",
  "call",
  "power",
  "pump",
  "iv_pole",
  "pressure_mattress",
];

/** What each resus space in the Emergency unit template records (no pressure mattress). */
export const EU_RESUS_SERVICES: ServiceCode[] = [
  "o2",
  "suction",
  "air",
  "monitor",
  "call",
  "power",
  "pump",
  "iv_pole",
];

type Floor = { w: number; h: number };

function shell(floor: Floor): WardLayout {
  const d = emptyLayout(floor);
  return { ...d, dividers: shellWalls(d) };
}

function addBed(d: WardLayout, b: Omit<LayoutBed, "key" | "status">): WardLayout {
  return { ...d, beds: [...d.beds, { ...b, key: nextKey(d, "b"), status: "in" }] };
}
function addLine(d: WardLayout, l: Omit<LayoutDivider, "key">): WardLayout {
  return { ...d, dividers: [...d.dividers, { ...l, key: nextKey(d, "d") }] };
}
function addFixture(
  d: WardLayout,
  f: Omit<LayoutFixture, "key" | "label" | "rot"> & { label?: string },
): WardLayout {
  const x = Math.max(0, Math.min(d.floor.w - fixtureSize(f.kind).w, f.x));
  const y = Math.max(0, Math.min(d.floor.h - fixtureSize(f.kind).h, f.y));
  return {
    ...d,
    fixtures: [
      ...d.fixtures,
      { key: nextKey(d, "f"), label: f.label ?? fixtureSize(f.kind).label, ...f, x, y, rot: 0 },
    ],
  };
}
function addDoor(d: WardLayout, x: number, y: number, orient: "h" | "v"): WardLayout {
  return { ...d, doors: [...d.doors, { key: nextKey(d, "o"), x, y, orient }] };
}

/** The ward's shared fixtures along the middle: station, trolley, store, sluice, hand-wash at each end. */
function middle(d: WardLayout): WardLayout {
  const { w, h } = d.floor;
  const cy = Math.floor(h / 2);
  let n = addFixture(d, {
    kind: "station",
    x: Math.floor(w / 2) - 3,
    y: cy - 1,
    label: "Nurses’ station",
  });
  n = addFixture(n, { kind: "resus_trolley", x: Math.floor(w / 2) + 5, y: cy - 1 });
  n = addFixture(n, { kind: "store", x: 3, y: cy - 1 });
  n = addFixture(n, { kind: "sluice", x: w - 7, y: cy - 1 });
  n = addFixture(n, { kind: "sink", x: 2, y: cy - 3 });
  n = addFixture(n, { kind: "sink", x: w - 3, y: cy - 3 });
  return n;
}

/** Nightingale: beds down both long walls, heads to the wall, curtains between, numbered clockwise. */
export function openWard(floor: Floor): WardLayout {
  let d = shell(floor);
  const { w, h } = floor;
  const perRow = Math.max(1, Math.min(9, Math.floor((w - 6) / 4)));
  for (let i = 0; i < perRow; i++)
    d = addBed(d, {
      label: `B${i + 1}`,
      type: "standard",
      x: 3 + i * 4,
      y: 2,
      rot: 0,
      services: [],
    });
  for (let i = perRow - 1; i >= 0; i--)
    d = addBed(d, {
      label: `B${2 * perRow - i}`,
      type: "standard",
      x: 3 + i * 4,
      y: h - 6,
      rot: 180,
      services: [],
    });
  for (let i = 0; i < perRow - 1; i++) {
    const x = 3 + i * 4 + 3;
    d = addLine(d, { kind: "curtain", x1: x, y1: 1, x2: x, y2: 7 });
    d = addLine(d, { kind: "curtain", x1: x, y1: h - 7, x2: x, y2: h - 1 });
  }
  if (w >= 30) {
    d = addLine(d, {
      kind: "window",
      x1: Math.round(w * 0.15),
      y1: 1,
      x2: Math.round(w * 0.3),
      y2: 1,
    });
    d = addLine(d, {
      kind: "window",
      x1: Math.round(w * 0.55),
      y1: 1,
      x2: Math.round(w * 0.7),
      y2: 1,
    });
  }
  d = middle(d);
  return addDoor(d, w - 1, Math.floor(h / 2) - 1, "v");
}

/** Two four-bed bays across the top and a row of single rooms along the bottom (the last isolation). */
export function baysAndRooms(floor: Floor): WardLayout {
  let d = shell(floor);
  const { w, h } = floor;
  const bays = w >= 30 ? 2 : 1;
  for (let k = 0; k < bays; k++) {
    const bx = 2 + k * 13;
    const bay = {
      key: nextKey(d, "r"),
      kind: "bay" as const,
      name: `Bay ${"AB"[k]}`,
      x: bx,
      y: 1,
      w: 12,
      h: 11,
      door: "bottom" as const,
      features: {},
    };
    d = { ...d, rooms: [...d.rooms, bay] };
    const n = k * 4;
    d = addBed(d, { label: `B${n + 1}`, type: "standard", x: bx + 1, y: 2, rot: 0, services: [] });
    d = addBed(d, { label: `B${n + 2}`, type: "standard", x: bx + 6, y: 2, rot: 0, services: [] });
    d = addBed(d, {
      label: `B${n + 3}`,
      type: "standard",
      x: bx + 1,
      y: 7,
      rot: 180,
      services: [],
    });
    d = addBed(d, {
      label: `B${n + 4}`,
      type: "standard",
      x: bx + 6,
      y: 7,
      rot: 180,
      services: [],
    });
    d = addLine(d, { kind: "curtain", x1: bx + 4, y1: 2, x2: bx + 4, y2: 6 });
    d = addLine(d, { kind: "curtain", x1: bx + 4, y1: 7, x2: bx + 4, y2: 11 });
    // The wall behind the bay's second row, with a 2 m way in.
    d = addLine(d, { kind: "wall", x1: k === 0 ? 1 : bx - 1, y1: 12, x2: bx + 8, y2: 12 });
  }
  const rooms = Math.max(1, Math.min(4, Math.floor((w - 4) / 7)));
  const ry = h - 10;
  for (let i = 0; i < rooms; i++) {
    const x = 2 + i * 7;
    const iso = i === rooms - 1 && rooms > 1;
    d = {
      ...d,
      rooms: [
        ...d.rooms,
        {
          key: nextKey(d, "r"),
          kind: iso ? "isolation" : "private",
          name: iso ? `Isolation ${i + 1}` : `Private ${i + 1}`,
          x,
          y: ry,
          w: 7,
          h: 9,
          door: "top",
          features: { ensuite: true, sink: true, ...(iso ? { anteroom: true } : {}) },
        },
      ],
    };
    d = addBed(d, {
      label: `P${i + 1}`,
      type: "standard",
      x: x + 2,
      y: ry + 4,
      rot: 180,
      services: [],
    });
  }
  const cy = Math.floor(h / 2);
  d = addFixture(d, { kind: "station", x: Math.floor(w / 2) - 3, y: cy, label: "Nurses’ station" });
  d = addFixture(d, { kind: "resus_trolley", x: Math.floor(w / 2) + 4, y: cy });
  if (w >= 34) {
    d = addFixture(d, { kind: "store", x: w - 9, y: 3 });
    d = addFixture(d, { kind: "sluice", x: w - 9, y: 8 });
    d = addFixture(d, { kind: "toilet", x: w - 4, y: 3, label: "Toilets" });
  }
  return addDoor(d, w - 1, cy, "v");
}

/** Beds with their heads to the top wall, glass between them, every service at every bed. */
export function highDependency(floor: Floor): WardLayout {
  let d = shell(floor);
  const { w, h } = floor;
  const n = Math.max(1, Math.min(6, Math.floor((w - 6) / 6)));
  for (let i = 0; i < n; i++) {
    const x = 3 + i * 6;
    d = addBed(d, {
      label: `H${i + 1}`,
      type: "icu",
      x,
      y: 2,
      rot: 0,
      services: [...HDU_SERVICES],
    });
    if (i < n - 1) d = addLine(d, { kind: "glass", x1: x + 5, y1: 1, x2: x + 5, y2: 8 });
  }
  d = middle(d);
  return addDoor(d, 1, Math.floor(h / 2) + 3, "v");
}

/**
 * Emergency unit: two resus spaces with a trolley between, four trolleys, four chairs and an isolation
 * room (two trolleys and two chairs on a narrow floor). Only the resus spaces record services (ADR 0193).
 */
export function emergencyUnit(floor: Floor): WardLayout {
  let d = shell(floor);
  const { w, h } = floor;
  const n = w < 30 ? 2 : 4;
  const room = (r: Omit<LayoutRoom, "key">) => {
    d = { ...d, rooms: [...d.rooms, { ...r, key: nextKey(d, "r") }] };
  };
  room({ kind: "bay", name: "Resus", x: 2, y: 1, w: 10, h: 9, door: "bottom", features: {} });
  for (const [i, x] of [3, 7].entries())
    d = addBed(d, {
      label: `R${i + 1}`,
      type: "resus",
      x,
      y: 2,
      rot: 0,
      services: [...EU_RESUS_SERVICES],
    });
  d = addFixture(d, { kind: "resus_trolley", x: 5, y: 7 });
  room({
    kind: "bay",
    name: "Trolleys",
    x: 13,
    y: 1,
    w: n * 3 + 2,
    h: 7,
    door: "bottom",
    features: {},
  });
  for (let i = 0; i < n; i++)
    d = addBed(d, { label: `T${i + 1}`, type: "couch", x: 14 + i * 3, y: 2, rot: 0, services: [] });
  for (let i = 0; i < n; i++)
    d = addBed(d, { label: `C${i + 1}`, type: "chair", x: 3 + i * 3, y: 14, rot: 0, services: [] });
  room({
    kind: "isolation",
    name: "Isolation",
    x: w - 9,
    y: h - 10,
    w: 7,
    h: 9,
    door: "top",
    features: { sink: true },
  });
  d = addBed(d, { label: "I1", type: "couch", x: w - 7, y: h - 6, rot: 180, services: [] });
  const cy = Math.floor(h / 2);
  d = addFixture(d, { kind: "station", x: Math.floor(w / 2) - 3, y: cy, label: "Nurses’ station" });
  d = addFixture(d, { kind: "sink", x: Math.floor(w / 2) + 4, y: cy });
  return addDoor(d, w - 1, cy, "v");
}

export function presetsFor(floor: Floor, opts: { eu?: boolean } = {}): Preset[] {
  const open = openWard(floor);
  const bays = baysAndRooms(floor);
  const hdu = highDependency(floor);
  const rooms = bays.rooms.filter((r) => r.kind !== "bay").length;
  const bayCount = bays.rooms.length - rooms;
  const eu: Preset[] = opts.eu
    ? [
        {
          id: "eu",
          name: "Emergency unit",
          sub: "Resus spaces with services, trolleys, chairs and an isolation room",
          build: () => emergencyUnit(floor),
        },
      ]
    : [];
  return [
    ...eu,
    {
      id: "open",
      name: `Open ward, ${open.beds.length} beds`,
      sub: "Two rows, curtains between beds",
      build: () => openWard(floor),
    },
    {
      id: "bays",
      name: "Bays and private rooms",
      sub: `${bayCount} four-bed ${bayCount === 1 ? "bay" : "bays"}, ${rooms} single ${rooms === 1 ? "room" : "rooms"}`,
      build: () => baysAndRooms(floor),
    },
    {
      id: "hdu",
      name: `High dependency, ${hdu.beds.length} beds`,
      sub: "Glass partitions; records oxygen, suction, air and a monitor at every bed",
      build: () => highDependency(floor),
    },
    { id: "empty", name: "Empty floor", sub: "Outer walls only", build: () => shell(floor) },
  ];
}
