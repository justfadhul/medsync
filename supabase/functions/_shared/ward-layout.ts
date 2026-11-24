/**
 * Ward builder — ONE pure module, shared by ha-services-hub (Deno), the app (Node) and the Vitest
 * suite (ADRs 0191–0196). Self-contained on purpose, like services-hub.ts: no imports, so both runtimes
 * can load it. The app reaches it through lib/wards/*.
 *
 *   Part 1 — catalogues: bed types, services, rooms, dividers, fixtures, sizes (prototype values,
 *            marked proposed: docs/wards/ward-builder/PROMPT-WARD-BUILDER.md, Appendix)
 *   Part 2 — the layout document: types, limits, cross-field issues, the Zod schema builder
 *   Part 3 — geometry: footprints, snapping, rooms, walls, the row of beds, numbering
 *   Part 4 — checks: proposed warnings, two blocking (ADR 0196)
 *   Part 5 — reconcile: the published layout → the bed register (ADR 0192)
 *   Part 6 — the live board: bed state, free beds by need, who may act (ADR 0194)
 */

/* ─── Part 1 — catalogues ───────────────────────────────────────────── */

/** One grid cell is 0.5 m (ADR 0191). */
export const CELL_MM = 500;
/** The prototype's default floor, 21 × 16 m. Proposed: the floor is set per ward. */
export const FLOOR_DEFAULT = { w: 42, h: 32 } as const;
/** 4 m to 60 m a side. */
export const FLOOR_MIN = 8;
export const FLOOR_MAX = 120;
export const MAX_BEDS = 200;
export const MAX_ITEMS = 1000;

export const BED_TYPES = [
  { code: "standard", label: "Standard bed", short: "Standard", w: 2, h: 4 },
  { code: "icu", label: "ICU bed", short: "ICU bed", w: 3, h: 4 },
  { code: "cot", label: "Cot", short: "Cot", w: 2, h: 3 },
  { code: "couch", label: "Couch or trolley", short: "Couch or trolley", w: 2, h: 4 },
  { code: "chair", label: "Chair", short: "Chair", w: 2, h: 2 },
  { code: "resus", label: "Resus space", short: "Resus", w: 3, h: 4 },
] as const;
export type BedType = (typeof BED_TYPES)[number]["code"];
export const BED_TYPE_CODES = BED_TYPES.map((b) => b.code) as readonly BedType[];

/** ADRs 0539–0540: the emergency unit's ward type, and the spaces only an EU offers. */
export const EU_WARD_TYPE = "emergency_observation";
export const EU_BED_TYPES: readonly BedType[] = ["chair", "resus"];
/** The types a ward offers: chair and resus only on an EU; `keep` still shows a bed's own type. */
export const bedTypesFor = (wardType: string | null | undefined, keep?: BedType) =>
  BED_TYPES.filter(
    (b) => wardType === EU_WARD_TYPE || b.code === keep || !EU_BED_TYPES.includes(b.code),
  );

export const SERVICE_GROUPS = ["Piped services", "Monitoring and call", "At the bedside"] as const;
export type ServiceGroup = (typeof SERVICE_GROUPS)[number];

/** ADR 0193. The plan draws O₂, S and M; the rest show in the inspector and on the board. */
export const SERVICES = [
  { code: "o2", label: "Wall oxygen", glyph: "O₂", group: "Piped services" },
  { code: "suction", label: "Wall suction", glyph: "S", group: "Piped services" },
  { code: "air", label: "Medical air", glyph: "Air", group: "Piped services" },
  { code: "monitor", label: "Cardiac monitor", glyph: "M", group: "Monitoring and call" },
  { code: "call", label: "Nurse call", glyph: "C", group: "Monitoring and call" },
  { code: "power", label: "Power sockets", glyph: "Pw", group: "Monitoring and call" },
  { code: "pump", label: "Infusion pump", glyph: "P", group: "At the bedside" },
  { code: "iv_pole", label: "IV pole", glyph: "IV", group: "At the bedside" },
  { code: "locker", label: "Locker", glyph: "L", group: "At the bedside" },
  { code: "overbed_table", label: "Overbed table", glyph: "T", group: "At the bedside" },
  {
    code: "pressure_mattress",
    label: "Pressure-relief mattress",
    glyph: "PR",
    group: "At the bedside",
  },
  { code: "curtain_track", label: "Privacy curtain track", glyph: "Cu", group: "At the bedside" },
] as const;
export type ServiceCode = (typeof SERVICES)[number]["code"];
export const SERVICE_CODES = SERVICES.map((s) => s.code) as readonly ServiceCode[];
export const PLAN_GLYPH_CODES: readonly ServiceCode[] = ["o2", "suction", "monitor"];
export const PIPED_CODES: readonly ServiceCode[] = ["o2", "suction", "air"];
export const serviceByCode = (code: string) => SERVICES.find((s) => s.code === code) ?? null;

export const ROOM_KINDS = [
  { code: "private", label: "Private room" },
  { code: "isolation", label: "Isolation room" },
  { code: "side", label: "Side room" },
  { code: "bay", label: "Bay" },
] as const;
export type RoomKind = (typeof ROOM_KINDS)[number]["code"];
/** A single room: private, isolation or side (a bay is curtained, open to the ward). */
export const SINGLE_ROOM_KINDS: readonly RoomKind[] = ["private", "isolation", "side"];

export const ROOM_FEATURES = [
  { code: "ensuite", label: "Toilet / shower" },
  { code: "sink", label: "Hand-wash" },
  { code: "anteroom", label: "Anteroom" },
  { code: "negativePressure", label: "Negative pressure" },
] as const;
export type RoomFeature = (typeof ROOM_FEATURES)[number]["code"];

export const DIVIDER_KINDS = [
  { code: "wall", label: "Wall" },
  { code: "curtain", label: "Curtain" },
  { code: "glass", label: "Glass partition" },
  { code: "window", label: "Window" },
] as const;
export type DividerKind = (typeof DIVIDER_KINDS)[number]["code"];

export const FIXTURE_KINDS = [
  { code: "station", label: "Nurses’ station", w: 6, h: 3 },
  { code: "sink", label: "Hand-wash", w: 1, h: 1 },
  { code: "toilet", label: "Toilet / shower", w: 3, h: 3 },
  { code: "store", label: "Store", w: 4, h: 3 },
  { code: "sluice", label: "Sluice", w: 3, h: 3 },
  { code: "resus_trolley", label: "Resus trolley", w: 2, h: 2 },
] as const;
export type FixtureKind = (typeof FIXTURE_KINDS)[number]["code"];

export const SIDES = ["top", "right", "bottom", "left"] as const;
export type Side = (typeof SIDES)[number];
export const ROTATIONS = [0, 90, 180, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];

/** Proposed reasons offered as chips; any reason may be typed. */
export const OUT_REASONS = ["Broken", "Awaiting repair", "Closed for cleaning"] as const;

/** Where a room of each kind starts, in cells. */
export const ROOM_DEFAULT_SIZE: Record<RoomKind, { w: number; h: number }> = {
  private: { w: 7, h: 9 },
  isolation: { w: 7, h: 9 },
  side: { w: 7, h: 9 },
  bay: { w: 12, h: 10 },
};
/** A door opening is 1 m. */
export const DOOR_CELLS = 2;

/* ─── Part 2 — the layout document ──────────────────────────────────── */

export interface RoomFeatures {
  ensuite?: boolean;
  sink?: boolean;
  anteroom?: boolean;
  negativePressure?: boolean;
}

export interface LayoutRoom {
  key: string;
  kind: RoomKind;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  door: Side;
  features: RoomFeatures;
}

/** Axis-aligned, on grid lines. */
export interface LayoutDivider {
  key: string;
  kind: DividerKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A 1 m opening from (x, y) along a wall across (`h`) or down (`v`). */
export interface LayoutDoor {
  key: string;
  x: number;
  y: number;
  orient: "h" | "v";
}

export interface LayoutFixture {
  key: string;
  kind: FixtureKind;
  label: string;
  x: number;
  y: number;
  rot: Rotation;
}

export interface LayoutBed {
  key: string;
  /** The register id, once published (ADR 0192). */
  bedId?: string;
  label: string;
  type: BedType;
  x: number;
  y: number;
  rot: Rotation;
  services: ServiceCode[];
  status: "in" | "out";
  outReason?: string;
}

export interface WardLayout {
  v: 1;
  floor: { w: number; h: number };
  rooms: LayoutRoom[];
  dividers: LayoutDivider[];
  doors: LayoutDoor[];
  fixtures: LayoutFixture[];
  beds: LayoutBed[];
}

export type LayoutItem =
  | ({ kind_: "bed" } & LayoutBed)
  | ({ kind_: "room" } & LayoutRoom)
  | ({ kind_: "divider" } & LayoutDivider)
  | ({ kind_: "door" } & LayoutDoor)
  | ({ kind_: "fixture" } & LayoutFixture);

export const KEY_RE = /^[a-z][a-z0-9-]{0,31}$/;
export const LABEL_MAX = { bed: 20, room: 60, fixture: 40, reason: 200 } as const;

export function emptyLayout(floor: { w: number; h: number } = FLOOR_DEFAULT): WardLayout {
  return { v: 1, floor: { ...floor }, rooms: [], dividers: [], doors: [], fixtures: [], beds: [] };
}

export const itemCount = (d: WardLayout) =>
  d.rooms.length + d.dividers.length + d.doors.length + d.fixtures.length + d.beds.length;

export interface LayoutIssue {
  path: (string | number)[];
  message: string;
}

/**
 * The cross-field rules a schema can't say field by field: limits, every coordinate inside the floor,
 * unique keys and register ids, straight dividers, a reason for a bed out of service. Run by the Zod
 * schema's refinement, so the client and the Edge Function refuse the same documents.
 */
export function layoutIssues(d: WardLayout): LayoutIssue[] {
  const out: LayoutIssue[] = [];
  const { w: W, h: H } = d.floor;
  if (d.beds.length > MAX_BEDS)
    out.push({ path: ["beds"], message: `A layout holds at most ${MAX_BEDS} beds.` });
  if (itemCount(d) > MAX_ITEMS)
    out.push({ path: [], message: `A layout holds at most ${MAX_ITEMS} items.` });
  const keys = new Set<string>();
  const seeKey = (key: string, path: (string | number)[]) => {
    if (keys.has(key)) out.push({ path, message: `Two items share the key ${key}.` });
    keys.add(key);
  };
  const inside = (r: Rect, path: (string | number)[], what: string) => {
    if (r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H)
      out.push({ path, message: `${what} is outside the floor.` });
  };
  d.rooms.forEach((r, i) => {
    seeKey(r.key, ["rooms", i, "key"]);
    if (r.w < 3 || r.h < 3)
      out.push({ path: ["rooms", i], message: `${r.name} is smaller than 1.5 m.` });
    inside({ x: r.x, y: r.y, w: r.w, h: r.h }, ["rooms", i], r.name);
  });
  d.dividers.forEach((l, i) => {
    seeKey(l.key, ["dividers", i, "key"]);
    const straight = l.x1 === l.x2 || l.y1 === l.y2;
    if (!straight)
      out.push({ path: ["dividers", i], message: "A divider runs straight across or down." });
    if (l.x1 === l.x2 && l.y1 === l.y2)
      out.push({ path: ["dividers", i], message: "A divider needs a length." });
    for (const [x, y] of [
      [l.x1, l.y1],
      [l.x2, l.y2],
    ] as const)
      if (x < 0 || y < 0 || x > W || y > H)
        out.push({ path: ["dividers", i], message: "A divider ends outside the floor." });
  });
  d.doors.forEach((o, i) => {
    seeKey(o.key, ["doors", i, "key"]);
    const endX = o.orient === "h" ? o.x + DOOR_CELLS : o.x;
    const endY = o.orient === "v" ? o.y + DOOR_CELLS : o.y;
    if (o.x < 0 || o.y < 0 || endX > W || endY > H)
      out.push({ path: ["doors", i], message: "A door is outside the floor." });
  });
  d.fixtures.forEach((f, i) => {
    seeKey(f.key, ["fixtures", i, "key"]);
    inside(fixtureRect(f), ["fixtures", i], f.label);
  });
  const ids = new Set<string>();
  d.beds.forEach((b, i) => {
    seeKey(b.key, ["beds", i, "key"]);
    inside(bedRect(b), ["beds", i], `Bed ${b.label}`);
    if (b.bedId) {
      if (ids.has(b.bedId))
        out.push({ path: ["beds", i, "bedId"], message: `Bed ${b.label} repeats a register id.` });
      ids.add(b.bedId);
    }
    if (new Set(b.services).size !== b.services.length)
      out.push({ path: ["beds", i, "services"], message: `Bed ${b.label} lists a service twice.` });
    if (b.status === "out" && !b.outReason?.trim())
      out.push({
        path: ["beds", i, "outReason"],
        message: `Say why bed ${b.label} is out of service.`,
      });
  });
  return out;
}

// The Zod instance differs by runtime (npm:zod in Deno, zod in Node), so the schema is built from the
// caller's `z`. lib/wards/layout-schema.ts types the result as z.ZodType<WardLayout>.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyZod = any;

/** The layout document's schema (ADR 0191), for either runtime's Zod. */
export function buildLayoutSchema(z: AnyZod) {
  const key = z.string().regex(KEY_RE);
  const coord = z.number().int().min(0).max(FLOOR_MAX);
  const size = z.number().int().min(1).max(FLOOR_MAX);
  const rot = z.union(ROTATIONS.map((r) => z.literal(r)));
  const text = (max: number) => z.string().trim().min(1).max(max);
  const room = z.strictObject({
    key,
    kind: z.enum(ROOM_KINDS.map((k) => k.code)),
    name: text(LABEL_MAX.room),
    x: coord,
    y: coord,
    w: size,
    h: size,
    door: z.enum(SIDES),
    features: z.strictObject({
      ensuite: z.boolean().optional(),
      sink: z.boolean().optional(),
      anteroom: z.boolean().optional(),
      negativePressure: z.boolean().optional(),
    }),
  });
  const divider = z.strictObject({
    key,
    kind: z.enum(DIVIDER_KINDS.map((k) => k.code)),
    x1: coord,
    y1: coord,
    x2: coord,
    y2: coord,
  });
  const door = z.strictObject({ key, x: coord, y: coord, orient: z.enum(["h", "v"]) });
  const fixture = z.strictObject({
    key,
    kind: z.enum(FIXTURE_KINDS.map((k) => k.code)),
    label: text(LABEL_MAX.fixture),
    x: coord,
    y: coord,
    rot,
  });
  const bed = z.strictObject({
    key,
    bedId: z.string().uuid().optional(),
    label: text(LABEL_MAX.bed),
    type: z.enum(BED_TYPE_CODES),
    x: coord,
    y: coord,
    rot,
    services: z.array(z.enum(SERVICE_CODES)).max(SERVICE_CODES.length),
    status: z.enum(["in", "out"]),
    outReason: z.string().trim().max(LABEL_MAX.reason).optional(),
  });
  return z
    .strictObject({
      v: z.literal(1),
      floor: z.strictObject({
        w: z.number().int().min(FLOOR_MIN).max(FLOOR_MAX),
        h: z.number().int().min(FLOOR_MIN).max(FLOOR_MAX),
      }),
      rooms: z.array(room).max(MAX_ITEMS),
      dividers: z.array(divider).max(MAX_ITEMS),
      doors: z.array(door).max(MAX_ITEMS),
      fixtures: z.array(fixture).max(MAX_ITEMS),
      beds: z.array(bed).max(MAX_BEDS),
    })
    .superRefine((d: WardLayout, ctx: AnyZod) => {
      for (const i of layoutIssues(d))
        ctx.addIssue({ code: "custom", message: i.message, path: i.path });
    });
}

/* ─── Part 3 — geometry ─────────────────────────────────────────────── */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const bedSize = (type: BedType) => BED_TYPES.find((b) => b.code === type) ?? BED_TYPES[0];
export const fixtureSize = (kind: FixtureKind) =>
  FIXTURE_KINDS.find((f) => f.code === kind) ?? FIXTURE_KINDS[0];

/** A footprint turned by 90° or 270° swaps its width and depth. */
export function turned(w: number, h: number, rot: number): { w: number; h: number } {
  return rot % 180 === 0 ? { w, h } : { w: h, h: w };
}

export function bedRect(b: Pick<LayoutBed, "x" | "y" | "rot" | "type">): Rect {
  const s = bedSize(b.type);
  return { x: b.x, y: b.y, ...turned(s.w, s.h, b.rot) };
}

export function fixtureRect(f: Pick<LayoutFixture, "x" | "y" | "rot" | "kind">): Rect {
  const s = fixtureSize(f.kind);
  return { x: f.x, y: f.y, ...turned(s.w, s.h, f.rot) };
}

export const roomRect = (r: LayoutRoom): Rect => ({ x: r.x, y: r.y, w: r.w, h: r.h });

/** Keep a footprint on the floor: the top-left moves, the size doesn't. */
export function clampRect(r: Rect, floor: { w: number; h: number }): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(floor.w - r.w, r.x)),
    y: Math.max(0, Math.min(floor.h - r.h, r.y)),
  };
}

/** A pointer in fractional cells → the cell it is in (items) or the nearest grid line (dividers, doors). */
export const cellOf = (f: number) => Math.floor(f);
export const lineOf = (f: number) => Math.round(f);

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** A divider drawn from `a` towards `p` snaps straight across or down, whichever is longer. */
export function snapDivider(
  a: { x: number; y: number },
  p: { x: number; y: number },
): { x2: number; y2: number } {
  const across = Math.abs(p.x - a.x) >= Math.abs(p.y - a.y);
  return across ? { x2: p.x, y2: a.y } : { x2: a.x, y2: p.y };
}

export const dividerLength = (l: LayoutDivider) => Math.abs(l.x2 - l.x1) + Math.abs(l.y2 - l.y1);
export const isAcross = (l: Pick<LayoutDivider, "y1" | "y2">) => l.y1 === l.y2;

/** A bed is in a room when its centre is strictly inside the room. */
export function centreInside(r: Rect, room: Rect): boolean {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return cx > room.x && cx < room.x + room.w && cy > room.y && cy < room.y + room.h;
}

export function roomOfRect(r: Rect, rooms: readonly LayoutRoom[]): LayoutRoom | null {
  return rooms.find((room) => centreInside(r, roomRect(room))) ?? null;
}

export const roomOfBed = (b: LayoutBed, rooms: readonly LayoutRoom[]) =>
  roomOfRect(bedRect(b), rooms);

export const headSideOf = (rot: number): Side =>
  rot === 90 ? "right" : rot === 180 ? "bottom" : rot === 270 ? "left" : "top";

/** A straight wall run: `across` = horizontal at y = c, from a to b; else vertical at x = c. */
export interface Segment {
  across: boolean;
  c: number;
  a: number;
  b: number;
}

export function segmentOf(l: Pick<LayoutDivider, "x1" | "y1" | "x2" | "y2">): Segment {
  const across = l.y1 === l.y2;
  return across
    ? { across, c: l.y1, a: Math.min(l.x1, l.x2), b: Math.max(l.x1, l.x2) }
    : { across, c: l.x1, a: Math.min(l.y1, l.y2), b: Math.max(l.y1, l.y2) };
}

/** The four walls of a single room (a bay is curtained: no walls). */
export function roomWalls(r: LayoutRoom): Segment[] {
  if (r.kind === "bay") return [];
  return [
    { across: true, c: r.y, a: r.x, b: r.x + r.w },
    { across: true, c: r.y + r.h, a: r.x, b: r.x + r.w },
    { across: false, c: r.x, a: r.y, b: r.y + r.h },
    { across: false, c: r.x + r.w, a: r.y, b: r.y + r.h },
  ];
}

/** Walls (dividers of kind wall) and room walls: where a bed head with piped services belongs. */
export function wallSegments(d: WardLayout): Segment[] {
  return [
    ...d.dividers.filter((l) => l.kind === "wall").map(segmentOf),
    ...d.rooms.flatMap(roomWalls),
  ];
}

/** Hard lines a bed must not straddle: walls, glass, windows and room walls. Curtains are soft. */
export function hardSegments(d: WardLayout): Segment[] {
  return [
    ...d.dividers.filter((l) => l.kind !== "curtain").map(segmentOf),
    ...d.rooms.flatMap(roomWalls),
  ];
}

/** True when the segment passes through the rectangle's interior (touching an edge is fine). */
export function crosses(r: Rect, s: Segment): boolean {
  return s.across
    ? s.c > r.y && s.c < r.y + r.h && s.b > r.x && s.a < r.x + r.w
    : s.c > r.x && s.c < r.x + r.w && s.b > r.y && s.a < r.y + r.h;
}

/** The head edge of a bed as a segment: where its services come from. */
export function headEdge(b: LayoutBed): Segment {
  const r = bedRect(b);
  switch (headSideOf(b.rot)) {
    case "top":
      return { across: true, c: r.y, a: r.x, b: r.x + r.w };
    case "bottom":
      return { across: true, c: r.y + r.h, a: r.x, b: r.x + r.w };
    case "left":
      return { across: false, c: r.x, a: r.y, b: r.y + r.h };
    case "right":
      return { across: false, c: r.x + r.w, a: r.y, b: r.y + r.h };
  }
}

/** Head within one cell of a wall or room wall, overlapping it along the bed's width. */
export function headAtWall(b: LayoutBed, walls: readonly Segment[]): boolean {
  const e = headEdge(b);
  return walls.some(
    (w) => w.across === e.across && Math.abs(w.c - e.c) <= 1 && w.a < e.b && w.b > e.a,
  );
}

/** The next free key with this prefix (b beds, r rooms, d dividers, o doors, f fixtures). */
export function nextKey(d: WardLayout, prefix: "b" | "r" | "d" | "o" | "f"): string {
  let max = 0;
  for (const it of [...d.beds, ...d.rooms, ...d.dividers, ...d.doors, ...d.fixtures]) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(it.key);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

/** Several keys at once, none clashing with each other. */
export function nextKeys(d: WardLayout, prefix: "b" | "r" | "d" | "o" | "f", n: number): string[] {
  const first = Number(nextKey(d, prefix).slice(1));
  return Array.from({ length: n }, (_, i) => `${prefix}${first + i}`);
}

/**
 * The next `n` bed numbers after the highest one, in the ward's own style ("Bed 7" or "B7"): the most
 * common prefix before a trailing number, else "B".
 */
export function nextBedLabels(labels: readonly string[], n: number): string[] {
  const counts = new Map<string, number>();
  let max = 0;
  for (const l of labels) {
    const m = /^(.*?)(\d+)$/.exec(l.trim());
    if (!m) continue;
    counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
    max = Math.max(max, Number(m[2]));
  }
  const prefix = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "B";
  const taken = new Set(labels.map((l) => l.trim().toLowerCase()));
  const out: string[] = [];
  for (let k = max + 1; out.length < n; k++) {
    const label = `${prefix}${k}`;
    if (!taken.has(label.toLowerCase())) out.push(label);
  }
  return out;
}

export interface RowOptions {
  /** Where the first bed goes (its top-left cell). */
  x: number;
  y: number;
  n: number;
  /** Cells between beds. */
  gap: number;
  /** Which wall the heads face. */
  face: Side;
  curtains: boolean;
  o2: boolean;
}

export const ROW_LIMITS = { n: { min: 2, max: 14 }, gap: { min: 0, max: 6 } } as const;
const FACE_ROT: Record<Side, Rotation> = { top: 0, right: 90, bottom: 180, left: 270 };

/**
 * A row of standard beds, numbered on from the highest bed number, with curtains between them when
 * asked. Beds that would leave the floor are not placed. Returns what to add; the caller adds it.
 */
export function rowOfBeds(
  d: WardLayout,
  o: RowOptions,
): { beds: LayoutBed[]; dividers: LayoutDivider[] } {
  const along = o.face === "top" || o.face === "bottom";
  const rot = FACE_ROT[o.face];
  const size = turned(2, 4, rot);
  const step = (along ? size.w : size.h) + o.gap;
  const places: { x: number; y: number }[] = [];
  for (let i = 0; i < o.n; i++) {
    const x = along ? o.x + i * step : o.x;
    const y = along ? o.y : o.y + i * step;
    if (x < 0 || y < 0 || x + size.w > d.floor.w || y + size.h > d.floor.h) break;
    places.push({ x, y });
  }
  const labels = nextBedLabels(
    d.beds.map((b) => b.label),
    places.length,
  );
  const bedKeys = nextKeys(d, "b", places.length);
  const beds: LayoutBed[] = places.map((p, i) => ({
    key: bedKeys[i]!,
    label: labels[i]!,
    type: "standard",
    x: p.x,
    y: p.y,
    rot,
    services: o.o2 ? ["o2"] : [],
    status: "in",
  }));
  const dividers: LayoutDivider[] = [];
  if (o.curtains && o.gap > 0 && places.length > 1) {
    const keys = nextKeys(d, "d", places.length - 1);
    const off = (along ? size.w : size.h) + Math.floor(o.gap / 2);
    places.slice(0, -1).forEach((p, i) => {
      dividers.push(
        along
          ? {
              key: keys[i]!,
              kind: "curtain",
              x1: p.x + off,
              y1: p.y,
              x2: p.x + off,
              y2: p.y + size.h,
            }
          : {
              key: keys[i]!,
              kind: "curtain",
              x1: p.x,
              y1: p.y + off,
              x2: p.x + size.w,
              y2: p.y + off,
            },
      );
    });
  }
  return { beds, dividers };
}

/**
 * "Renumber beds, left to right": beds in the open ward and in bays, row by row (a row is a 4 m
 * band), then left to right, in the ward's numbering style. Beds in single rooms keep their numbers.
 */
export function renumberBeds(d: WardLayout): WardLayout {
  const single = (b: LayoutBed) => {
    const r = roomOfBed(b, d.rooms);
    return r !== null && r.kind !== "bay";
  };
  const order = d.beds
    .filter((b) => !single(b))
    .sort((a, b) => Math.round(a.y / 8) - Math.round(b.y / 8) || a.x - b.x);
  const style = nextBedLabels(
    order.map((b) => b.label),
    1,
  )[0]!.replace(/\d+$/, "");
  const next = new Map(order.map((b, i) => [b.key, `${style}${i + 1}`]));
  return {
    ...d,
    beds: d.beds.map((b) => (next.has(b.key) ? { ...b, label: next.get(b.key)! } : b)),
  };
}

/** The outer walls, one cell in from the edge of the floor. */
export function shellWalls(d: WardLayout): LayoutDivider[] {
  const { w, h } = d.floor;
  const keys = nextKeys(d, "d", 4);
  return [
    { key: keys[0]!, kind: "wall", x1: 1, y1: 1, x2: w - 1, y2: 1 },
    { key: keys[1]!, kind: "wall", x1: w - 1, y1: 1, x2: w - 1, y2: h - 1 },
    { key: keys[2]!, kind: "wall", x1: 1, y1: h - 1, x2: w - 1, y2: h - 1 },
    { key: keys[3]!, kind: "wall", x1: 1, y1: 1, x2: 1, y2: h - 1 },
  ];
}

export interface RegisterBedLite {
  id: string;
  label: string;
  bedType: string | null;
  closedReason: string | null;
  services: readonly string[];
}

export const asBedType = (t: string | null | undefined): BedType =>
  (BED_TYPE_CODES as readonly string[]).includes(t ?? "") ? (t as BedType) : "standard";

const asServices = (codes: readonly string[]): ServiceCode[] =>
  SERVICE_CODES.filter((c) => codes.includes(c));

/**
 * "Start from the register": a first draft with every existing bed laid out in rows inside the outer
 * walls, heads to the wall, so nothing is lost. The admin moves them to where they really stand.
 */
export function layoutFromRegister(
  beds: readonly RegisterBedLite[],
  floor: { w: number; h: number } = FLOOR_DEFAULT,
): WardLayout {
  // Rows of standard beds 2 m apart, heads to the wall; a big register widens, then deepens, the floor.
  let w = floor.w;
  let perRow = Math.max(1, Math.floor((w - 4) / 4));
  let rows = Math.max(1, Math.ceil(beds.length / perRow));
  while (rows > 2 && 3 + rows * 6 > FLOOR_MAX && w < FLOOR_MAX) {
    w = Math.min(FLOOR_MAX, w + 4);
    perRow = Math.floor((w - 4) / 4);
    rows = Math.ceil(beds.length / perRow);
  }
  const h = Math.min(FLOOR_MAX, Math.max(floor.h, rows <= 2 ? floor.h : 3 + rows * 6));
  const d = emptyLayout({ w, h });
  d.dividers = shellWalls(d);
  d.beds = beds.map((b, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const bottom = rows === 2 && row === 1;
    return {
      key: `b${i + 1}`,
      bedId: b.id,
      label: b.label.trim().slice(0, LABEL_MAX.bed),
      type: asBedType(b.bedType),
      x: 3 + col * 4,
      y: bottom ? h - 6 : 2 + row * 6,
      rot: bottom ? 180 : 0,
      services: asServices(b.services),
      status: b.closedReason ? "out" : "in",
      ...(b.closedReason ? { outReason: b.closedReason.slice(0, LABEL_MAX.reason) } : {}),
    };
  });
  return d;
}

/**
 * A published document brought up to date with the register before it is edited again (ADR 0192 §6):
 * labels and closures changed in the register since, and beds archived by hand, which leave the plan.
 */
export function syncWithRegister(
  d: WardLayout,
  register: readonly {
    id: string;
    label: string;
    closedReason: string | null;
    archived: boolean;
  }[],
): WardLayout {
  const byId = new Map(register.map((r) => [r.id, r]));
  return {
    ...d,
    beds: d.beds
      .filter((b) => !b.bedId || (byId.has(b.bedId) && !byId.get(b.bedId)!.archived))
      .map((b) => {
        const r = b.bedId ? byId.get(b.bedId) : undefined;
        if (!r) return b;
        const next: LayoutBed = { ...b, label: r.label, status: r.closedReason ? "out" : "in" };
        if (r.closedReason) next.outReason = r.closedReason;
        else delete next.outReason;
        return next;
      }),
  };
}

/* ─── Part 4 — checks (ADR 0196) ────────────────────────────────────── */

export type CheckCode =
  | "nurse_call"
  | "oxygen"
  | "monitor"
  | "isolation_handwash"
  | "station"
  | "resus_trolley"
  | "bed_overlap"
  | "overlap"
  | "piped_at_wall"
  | "duplicate_numbers";

export interface LayoutCheck {
  code: CheckCode;
  ok: boolean;
  text: string;
  /** This check blocks publishing when it fails (integrity only). */
  blocking: boolean;
}

/** Ward types whose beds are expected to have a monitor (the monitor check). */
export const MONITORED_WARD_TYPES = ["hdu", "icu", "nicu"] as const;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export function nameList(names: readonly string[], max = 8): string {
  const shown = names.slice(0, max).join(", ");
  return names.length > max ? `${shown} and ${names.length - max} more` : shown;
}

/**
 * Every check on a layout, in the order the panel shows them. Proposed wording, not signed standards.
 * `wardType` is the ward's A.5 type (the monitor check runs on HDU, ICU and NICU wards).
 */
export function layoutChecks(d: WardLayout, wardType: string | null): LayoutCheck[] {
  const checks: LayoutCheck[] = [];
  const inService = d.beds.filter((b) => b.status === "in");
  const lacking = (code: ServiceCode) =>
    inService.filter((b) => !b.services.includes(code)).map((b) => b.label);

  const noCall = lacking("call");
  checks.push({
    code: "nurse_call",
    ok: noCall.length === 0,
    text: noCall.length
      ? `${plural(noCall.length, "bed")} without a nurse call: ${nameList(noCall)}`
      : "Every bed in service has a nurse call",
    blocking: false,
  });

  const noO2 = lacking("o2");
  checks.push({
    code: "oxygen",
    ok: noO2.length === 0,
    text: noO2.length
      ? `${plural(noO2.length, "bed")} without wall oxygen: ${nameList(noO2)}`
      : "Every bed in service has wall oxygen",
    blocking: false,
  });

  if ((MONITORED_WARD_TYPES as readonly string[]).includes(wardType ?? "")) {
    const noMon = lacking("monitor");
    const ward = wardType === "icu" ? "an ICU" : wardType === "nicu" ? "a NICU" : "an HDU";
    checks.push({
      code: "monitor",
      ok: noMon.length === 0,
      text: noMon.length
        ? `${plural(noMon.length, "bed")} without a monitor on ${ward} ward: ${nameList(noMon)}`
        : "Every bed in service has a monitor",
      blocking: false,
    });
  }

  const isolation = d.rooms.filter((r) => r.kind === "isolation");
  if (isolation.length) {
    const dry = isolation.filter(
      (r) =>
        !r.features.sink &&
        !d.fixtures.some((f) => f.kind === "sink" && centreInside(fixtureRect(f), roomRect(r))),
    );
    checks.push({
      code: "isolation_handwash",
      ok: dry.length === 0,
      text: dry.length
        ? `Isolation ${dry.length === 1 ? "room" : "rooms"} without hand-wash: ${nameList(dry.map((r) => r.name))}`
        : "Isolation rooms have hand-wash",
      blocking: false,
    });
  }

  const station = d.fixtures.some((f) => f.kind === "station");
  checks.push({
    code: "station",
    ok: station,
    text: station ? "Nurses’ station placed" : "No nurses’ station on the plan",
    blocking: false,
  });
  const trolley = d.fixtures.some((f) => f.kind === "resus_trolley");
  checks.push({
    code: "resus_trolley",
    ok: trolley,
    text: trolley ? "Resus trolley placed" : "No resus trolley on the plan",
    blocking: false,
  });

  const bedClashes: string[] = [];
  for (let i = 0; i < d.beds.length; i++)
    for (let j = i + 1; j < d.beds.length; j++)
      if (overlaps(bedRect(d.beds[i]!), bedRect(d.beds[j]!)))
        bedClashes.push(`${d.beds[i]!.label} and ${d.beds[j]!.label}`);
  checks.push({
    code: "bed_overlap",
    ok: bedClashes.length === 0,
    text: bedClashes.length
      ? `Beds on top of each other: ${nameList(bedClashes, 4)}`
      : "No bed sits on another",
    blocking: true,
  });

  const clashes: string[] = [];
  const solids = [
    ...d.beds.map((b) => ({ label: b.label, r: bedRect(b), bed: true })),
    ...d.fixtures.map((f) => ({ label: f.label, r: fixtureRect(f), bed: false })),
  ];
  for (let i = 0; i < solids.length; i++)
    for (let j = i + 1; j < solids.length; j++) {
      const a = solids[i]!;
      const b = solids[j]!;
      if ((!a.bed || !b.bed) && overlaps(a.r, b.r)) clashes.push(`${a.label} and ${b.label}`);
    }
  const hard = hardSegments(d);
  for (const b of d.beds)
    if (hard.some((s) => crosses(bedRect(b), s))) clashes.push(`${b.label} and a wall`);
  checks.push({
    code: "overlap",
    ok: clashes.length === 0,
    text: clashes.length ? `Overlapping: ${nameList(clashes, 4)}` : "Nothing else overlaps",
    blocking: false,
  });

  const walls = wallSegments(d);
  const offWall = inService
    .filter((b) => b.services.some((s) => PIPED_CODES.includes(s)) && !headAtWall(b, walls))
    .map((b) => b.label);
  checks.push({
    code: "piped_at_wall",
    ok: offWall.length === 0,
    text: offWall.length
      ? `Piped services set, but the bed head is not at a wall: ${nameList(offWall)}`
      : "Beds with piped services have their heads at a wall",
    blocking: false,
  });

  const seen = new Map<string, string>();
  const dup = new Set<string>();
  for (const b of d.beds) {
    const k = b.label.trim().toLowerCase();
    if (seen.has(k)) dup.add(seen.get(k)!);
    else seen.set(k, b.label.trim());
  }
  checks.push({
    code: "duplicate_numbers",
    ok: dup.size === 0,
    text: dup.size ? `Duplicate bed numbers: ${nameList([...dup])}` : "Bed numbers are unique",
    blocking: true,
  });
  return checks;
}

/** The failing checks that stop a publish. */
export const blockingFailures = (checks: readonly LayoutCheck[]) =>
  checks.filter((c) => c.blocking && !c.ok);
/** The warnings a publish records: every other failing check's text. */
export const warningTexts = (checks: readonly LayoutCheck[]) =>
  checks.filter((c) => !c.blocking && !c.ok).map((c) => c.text);

/* ─── Part 5 — reconcile (ADR 0192) ─────────────────────────────────── */

export interface RegisterBed {
  id: string;
  label: string;
  bedType: string | null;
  closedAt: string | null;
  closedReason: string | null;
  archivedAt: string | null;
  layoutX: number | null;
  layoutY: number | null;
  rotation: number | null;
  roomKey: string | null;
  services: readonly string[];
}

/** A register row the publish keeps (updates in place, or restores from the archive). */
export interface KeptBed {
  bedId: string;
  key: string;
  label: string;
  type: BedType;
  x: number;
  y: number;
  rot: Rotation;
  roomKey: string | null;
  closedReason: string | null;
  services: ServiceCode[];
  restore: boolean;
  /** What changes, in words, for the confirm step ("number", "place", "services" …). */
  changes: string[];
}

export interface NewBed {
  key: string;
  label: string;
  type: BedType;
  x: number;
  y: number;
  rot: Rotation;
  roomKey: string | null;
  closedReason: string | null;
  services: ServiceCode[];
}

export interface ReconcilePlan {
  keep: KeptBed[];
  create: NewBed[];
  archive: { bedId: string; label: string }[];
  /** The ward's bed count after publishing: every bed on the plan (closed beds count). */
  bedCount: number;
  /** Active register beds before. */
  bedCountBefore: number;
  /** The document to publish: register ids filled in for every kept bed. */
  document: WardLayout;
}

export type ReconcileOutcome = { ok: true; plan: ReconcilePlan } | { ok: false; refusal: string };

const joinLabels = (labels: readonly string[]) =>
  labels.length <= 1
    ? (labels[0] ?? "")
    : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;

/**
 * Plans what publishing `doc` does to the register (pure; the SQL function applies it). Matching:
 * register id; else the label of an unclaimed active bed; else the label of an archived bed (restored);
 * else a new bed. Active beds left over are archived, unless a patient is in them (refused).
 */
export function reconcile(input: {
  doc: WardLayout;
  register: readonly RegisterBed[];
  occupiedBedIds: Iterable<string>;
}): ReconcileOutcome {
  const { doc, register } = input;
  const occupied = new Set(input.occupiedBedIds);
  const byId = new Map(register.map((r) => [r.id, r]));
  const claimed = new Set<string>();
  const norm = (s: string) => s.trim();

  // Pass 1: beds that carry their register id.
  for (const b of doc.beds) {
    if (!b.bedId) continue;
    const r = byId.get(b.bedId);
    if (!r)
      return {
        ok: false,
        refusal: `Bed ${b.label} points at a bed that isn't in this ward's register.`,
      };
    if (claimed.has(r.id))
      return { ok: false, refusal: `Two beds on the plan are the same register bed (${b.label}).` };
    claimed.add(r.id);
  }
  // Pass 2: beds without an id match by label, active first, then archived.
  const match = new Map<string, RegisterBed>();
  for (const b of doc.beds) {
    if (b.bedId) continue;
    const want = norm(b.label);
    const hit =
      register.find((r) => !claimed.has(r.id) && !r.archivedAt && norm(r.label) === want) ??
      register.find((r) => !claimed.has(r.id) && r.archivedAt && norm(r.label) === want);
    if (hit) {
      claimed.add(hit.id);
      match.set(b.key, hit);
    }
  }

  const keep: KeptBed[] = [];
  const create: NewBed[] = [];
  const publishedBeds: LayoutBed[] = [];
  for (const b of doc.beds) {
    const r = b.bedId ? byId.get(b.bedId)! : match.get(b.key);
    const roomKey = roomOfBed(b, doc.rooms)?.key ?? null;
    const closedReason = b.status === "out" ? (b.outReason ?? "").trim() || null : null;
    const services = SERVICE_CODES.filter((c) => b.services.includes(c));
    const base = {
      label: norm(b.label),
      type: b.type,
      x: b.x,
      y: b.y,
      rot: b.rot,
      roomKey,
      closedReason,
      services,
    };
    if (!r) {
      create.push({ key: b.key, ...base });
      publishedBeds.push({ ...b, label: base.label });
      continue;
    }
    const changes: string[] = [];
    if (norm(r.label) !== base.label) changes.push("number");
    if (asBedType(r.bedType) !== base.type || r.bedType === null) changes.push("type");
    if (r.layoutX !== b.x || r.layoutY !== b.y || r.rotation !== b.rot || r.roomKey !== roomKey)
      changes.push("place");
    if ((r.closedReason ?? null) !== closedReason)
      changes.push(closedReason ? "out of service" : "back in service");
    const had = SERVICE_CODES.filter((c) => r.services.includes(c));
    if (had.join() !== services.join()) changes.push("services");
    keep.push({ bedId: r.id, key: b.key, ...base, restore: r.archivedAt !== null, changes });
    publishedBeds.push({ ...b, label: base.label, bedId: r.id });
  }

  const archive = register
    .filter((r) => !r.archivedAt && !claimed.has(r.id))
    .map((r) => ({ bedId: r.id, label: r.label }));
  const busyLeaving = archive.filter((a) => occupied.has(a.bedId)).map((a) => a.label);
  if (busyLeaving.length)
    return {
      ok: false,
      refusal: `${busyLeaving.length === 1 ? "Bed" : "Beds"} ${joinLabels(busyLeaving)} ${
        busyLeaving.length === 1 ? "has a patient in it" : "have patients in them"
      } and would leave the plan. Move or release the ${
        busyLeaving.length === 1 ? "patient" : "patients"
      } first, then publish.`,
    };
  const busyClosing = keep
    .filter((k) => k.closedReason && occupied.has(k.bedId))
    .map((k) => k.label);
  if (busyClosing.length)
    return {
      ok: false,
      refusal: `${busyClosing.length === 1 ? "Bed" : "Beds"} ${joinLabels(busyClosing)} ${
        busyClosing.length === 1 ? "has a patient in it" : "have patients in them"
      } and can't go out of service. Release the ${busyClosing.length === 1 ? "patient" : "patients"} first.`,
    };

  return {
    ok: true,
    plan: {
      keep,
      create,
      archive,
      bedCount: doc.beds.length,
      bedCountBefore: register.filter((r) => !r.archivedAt).length,
      document: { ...doc, beds: publishedBeds },
    },
  };
}

/** What a publish does, in counts, for the confirm step and the audit row. */
export function planSummary(p: ReconcilePlan) {
  return {
    added: p.create.length,
    restored: p.keep.filter((k) => k.restore).length,
    changed: p.keep.filter((k) => !k.restore && k.changes.length > 0).length,
    unchanged: p.keep.filter((k) => !k.restore && k.changes.length === 0).length,
    archived: p.archive.length,
    archivedLabels: p.archive.map((a) => a.label),
    bedCountBefore: p.bedCountBefore,
    bedCount: p.bedCount,
  };
}

/** The payload `public.ward_layout_publish(jsonb)` applies in one transaction (migration 0090). */
export function publishPayload(
  p: ReconcilePlan,
  meta: {
    hospitalId: string;
    wardId: string;
    draftId: string;
    draftRevision: number;
    actorId: string;
    warnings: readonly string[];
  },
) {
  const bed = (b: NewBed) => ({
    label: b.label,
    bed_type: b.type,
    x: b.x,
    y: b.y,
    rotation: b.rot,
    room_key: b.roomKey,
    closed_reason: b.closedReason,
    services: b.services,
  });
  return {
    hospital_id: meta.hospitalId,
    ward_id: meta.wardId,
    draft_id: meta.draftId,
    draft_revision: meta.draftRevision,
    actor: meta.actorId,
    warnings: [...meta.warnings],
    document: p.document,
    keep: p.keep.map((k) => ({ bed_id: k.bedId, restore: k.restore, ...bed(k) })),
    create: p.create.map((c) => ({ key: c.key, ...bed(c) })),
    archive: p.archive.map((a) => a.bedId),
    bed_count: p.bedCount,
  };
}

/* ─── Part 6 — the live board (ADR 0194) ────────────────────────────── */

export const BED_STATES = [
  { code: "occupied", label: "Occupied", short: "Occ" },
  // ADR 0199: allocated to an admitted patient who has not arrived yet; not available.
  { code: "arriving", label: "Arriving", short: "Arr" },
  { code: "free", label: "Free", short: "Free" },
  { code: "cleaning", label: "Cleaning", short: "Clean" },
  { code: "reserved", label: "Reserved", short: "Res" },
  { code: "out", label: "Out of service", short: "Out" },
] as const;
export type BedState = (typeof BED_STATES)[number]["code"];
/** The states staff set by hand; Occupied and Arriving come from an assignment, Out from the register. */
export const SETTABLE_STATES = ["free", "cleaning", "reserved"] as const;
export type SettableState = (typeof SETTABLE_STATES)[number];
export const bedStateMeta = (s: BedState) => BED_STATES.find((x) => x.code === s)!;

export interface BedStateInput {
  closed: boolean;
  /** The open assignment; `arriving` when it was made for an admission and nobody has arrived (ADR 0199). */
  open: { startedAt: string; arriving?: boolean } | null;
  /** When the last assignment on this bed ended, if one did. */
  lastEndedAt: string | null;
  events: readonly { state: SettableState; setAt: string; reason: string | null }[];
}

/**
 * Occupied (or Arriving) from an open assignment; Out from the register; else the latest state event since
 * the last assignment ended; else Free.
 */
export function bedState(i: BedStateInput): {
  state: BedState;
  since: string | null;
  reason: string | null;
} {
  if (i.open)
    return {
      state: i.open.arriving ? "arriving" : "occupied",
      since: i.open.startedAt,
      reason: null,
    };
  if (i.closed) return { state: "out", since: null, reason: null };
  const after = i.lastEndedAt === null ? null : Date.parse(i.lastEndedAt);
  const latest = [...i.events]
    .filter((e) => after === null || Date.parse(e.setAt) >= after)
    .sort((a, b) => Date.parse(b.setAt) - Date.parse(a.setAt))[0];
  return latest
    ? { state: latest.state, since: latest.setAt, reason: latest.reason }
    : { state: "free", since: i.lastEndedAt, reason: null };
}

export const NEEDS = [
  { code: "any", label: "Any free bed" },
  { code: "o2", label: "With wall oxygen" },
  { code: "suction", label: "With wall suction" },
  { code: "monitor", label: "With a monitor" },
  { code: "single", label: "In a single room" },
] as const;
export type Need = (typeof NEEDS)[number]["code"];

export interface BoardBedLite {
  id: string;
  label: string;
  state: BedState;
  services: readonly string[];
  roomKind: RoomKind | null;
}

/** "Free beds, by what the patient needs": one pass over the beds, their services and state. */
export function freeByNeed(beds: readonly BoardBedLite[]) {
  const free = beds.filter((b) => b.state === "free");
  const fits = (b: BoardBedLite, n: Need) =>
    n === "any" ||
    (n === "single"
      ? b.roomKind !== null && SINGLE_ROOM_KINDS.includes(b.roomKind)
      : b.services.includes(n));
  return NEEDS.map((n) => ({
    need: n.code,
    label: n.label,
    beds: free.filter((b) => fits(b, n.code)).map((b) => ({ id: b.id, label: b.label })),
  }));
}

/** Counts per state, in the legend's order. */
export function stateCounts(beds: readonly { state: BedState }[]): Record<BedState, number> {
  const out = { occupied: 0, arriving: 0, free: 0, cleaning: 0, reserved: 0, out: 0 } as Record<
    BedState,
    number
  >;
  for (const b of beds) out[b.state]++;
  return out;
}

/**
 * Who may set a bed's state, assign or release a patient (ADR 0194 §3): the hospital admin or a
 * superadmin; the ward's in-charge (or acting); a nurse with an open nursing assignment on the ward.
 */
export function mayWorkBeds(
  who: {
    admin: boolean;
    inChargeWardIds: readonly string[];
    assignedWardIds: readonly string[];
  },
  wardId: string,
): boolean {
  return who.admin || who.inChargeWardIds.includes(wardId) || who.assignedWardIds.includes(wardId);
}
