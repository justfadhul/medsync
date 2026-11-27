/**
 * Synthetic ward-builder fixtures (no database, no patient data): a ward, its register and its layout,
 * for the unit tests and the styleguide screenshots. Ids are fixed so snapshots are stable. MRNs are
 * made up in the MRN-YYYY-NNNNN shape; "Patient Three-3" style names are synthetic.
 */
import type { EuListData } from "@/components/wards/board/eu-list";
import type { EuStayInput } from "@/lib/eu/board";
import type { BoardData } from "@/lib/wards/board";
import type { LayoutEditorData } from "@/lib/wards/data";
import type { RegisterBed } from "@/lib/wards/reconcile";
import type { BedState, WardLayout } from "@/supabase/functions/_shared/ward-layout";

import { euTracking } from "@/lib/eu/board";
import { presetsFor } from "@/lib/wards/presets";
import { arrivingTooLong } from "@/lib/wards/waiting";
import { roomOfBed } from "@/supabase/functions/_shared/ward-layout";

export const FX = {
  hospital: "00000000-0000-4000-8000-0000000000a1",
  ward: "00000000-0000-4000-8000-0000000000b1",
  ward2: "00000000-0000-4000-8000-0000000000b2",
  ward3: "00000000-0000-4000-8000-0000000000b3",
  dept: "00000000-0000-4000-8000-0000000000c1",
};

export const bedUuid = (i: number) =>
  `00000000-0000-4000-8000-${String(1000 + i).padStart(12, "0")}`;

export const FLOOR = { w: 42, h: 32 };

/** A published open ward: the template, every bed with a register id and some services recorded. */
export function openWardDoc(): WardLayout {
  const d = presetsFor(FLOOR)[0]!.build();
  return {
    ...d,
    beds: d.beds.map((b, i) => ({
      ...b,
      bedId: bedUuid(i + 1),
      services: [
        ...(i % 3 !== 2 ? (["o2"] as const) : []),
        ...(i % 3 === 0 ? (["suction"] as const) : []),
        "call" as const,
        "locker" as const,
        ...(i === 4 ? (["monitor"] as const) : []),
      ],
      ...(b.label === "B17" ? { status: "out" as const, outReason: "Awaiting repair" } : {}),
    })),
  };
}

export function baysDoc(): WardLayout {
  const d = presetsFor(FLOOR)[1]!.build();
  return {
    ...d,
    beds: d.beds.map((b, i) => ({
      ...b,
      bedId: bedUuid(i + 1),
      services: [
        "o2",
        "call",
        ...(roomOfBed(b, d.rooms)?.kind === "isolation" ? (["suction", "monitor"] as const) : []),
      ],
    })),
  };
}

export function registerFor(doc: WardLayout): RegisterBed[] {
  return doc.beds.map((b) => ({
    id: b.bedId!,
    label: b.label,
    bedType: b.type,
    closedAt: b.status === "out" ? "2026-09-20T08:00:00.000Z" : null,
    closedReason: b.status === "out" ? (b.outReason ?? null) : null,
    archivedAt: null,
    layoutX: b.x,
    layoutY: b.y,
    rotation: b.rot,
    roomKey: roomOfBed(b, doc.rooms)?.key ?? null,
    services: [...b.services],
  }));
}

const TABS = [
  { id: FX.ward, name: "Medical Ward 1", sex: "male", bedCount: 18, laidOut: true },
  { id: FX.ward2, name: "Medical Ward 2", sex: "female", bedCount: 12, laidOut: true },
  { id: FX.ward3, name: "Medical HDU", sex: "mixed", bedCount: 6, laidOut: false },
];

export function editorData(
  doc: WardLayout | null,
  over: Partial<LayoutEditorData> = {},
): LayoutEditorData {
  return {
    ward: {
      id: FX.ward,
      name: "Medical Ward 1",
      departmentId: FX.dept,
      wardType: "general",
      sex: "male",
      ageGroup: "adult",
      placeId: null,
      bedCount: 20,
      ...over.ward,
    },
    tabs: TABS,
    departments: [{ id: FX.dept, name: "Internal Medicine" }],
    doc,
    draft: doc
      ? {
          id: "00000000-0000-4000-8000-0000000000d1",
          version: 2,
          revision: 7,
          savedAt: "2026-09-29T07:58:00.000Z",
        }
      : null,
    published: doc ? { version: 1, publishedAt: "2026-09-28T16:20:00.000Z" } : null,
    register: doc ? registerFor(doc) : [],
    occupiedBedIds: [],
    ...over,
  };
}

/** The board fixture's "now", for the needs-attention derivation (ADR 0199 §6). */
export const BOARD_NOW = Date.parse("2026-09-29T08:00:00.000Z");

/** Arriving beds (ADR 0199): one held 40 min, one held 5 h 30 min (past the 4 h threshold). */
const ARRIVING: Record<number, { since: string; n: number }> = {
  6: { since: "2026-09-29T07:20:00.000Z", n: 21 },
  14: { since: "2026-09-29T02:30:00.000Z", n: 22 },
};

/**
 * A board with every state: occupied, arriving, free, cleaning, reserved and out (B17), and two
 * admitted patients waiting for a bed.
 */
export function boardData(
  doc: WardLayout = openWardDoc(),
  viewer: "names" | "mrn" = "names",
): BoardData {
  const FREE = [1, 4, 11, 13];
  const CLEANING = [3, 10, 17];
  const RESERVED = [8];
  const states: BedState[] = doc.beds.map((b, i) =>
    b.status === "out"
      ? "out"
      : FREE.includes(i)
        ? "free"
        : CLEANING.includes(i)
          ? "cleaning"
          : RESERVED.includes(i)
            ? "reserved"
            : ARRIVING[i]
              ? "arriving"
              : "occupied",
  );
  let n = 0;
  const beds: BoardData["beds"] = doc.beds.map((b, i) => {
    const state = states[i]!;
    const room = roomOfBed(b, doc.rooms);
    const occupied = state === "occupied";
    const arriving = state === "arriving" ? ARRIVING[i]! : null;
    if (occupied) n++;
    return {
      key: b.key,
      bedId: b.bedId!,
      label: b.label,
      state,
      since: arriving
        ? arriving.since
        : occupied
          ? "2026-09-29T06:10:00.000Z"
          : state === "cleaning"
            ? "2026-09-29T07:30:00.000Z"
            : null,
      reason: state === "reserved" ? "Transfer from HDU" : null,
      services: [...b.services],
      roomKind: room?.kind ?? null,
      roomName: room?.name ?? null,
      type: b.type,
      patient: arriving
        ? {
            name: viewer === "names" ? `Patient ${arriving.n}` : null,
            mrn: `MRN-2026-${String(1000 + arriving.n).padStart(5, "0")}`,
          }
        : occupied
          ? {
              name: viewer === "names" ? `Patient ${n}` : null,
              mrn: `MRN-2026-${String(10000 + n * 37).padStart(5, "0")}`,
            }
          : null,
      assignmentId:
        occupied || arriving
          ? `00000000-0000-4000-8000-${String(5000 + i).padStart(12, "0")}`
          : null,
      admissionId: arriving
        ? `00000000-0000-4000-8000-${String(7000 + i).padStart(12, "0")}`
        : null,
      euStayId: null,
      admittedBy: arriving ? "Dr Example Admitting" : null,
    };
  });
  return {
    ward: { id: FX.ward, name: "Medical Ward 1", wardType: "general", bedCount: doc.beds.length },
    tabs: TABS,
    doc,
    published: { version: 3, publishedAt: "2026-09-28T16:20:00.000Z" },
    beds,
    candidates: [
      {
        patientUserId: "00000000-0000-4000-8000-000000009001",
        name: viewer === "names" ? "Patient Twenty" : null,
        mrn: "MRN-2026-01020",
        arrivedAt: "2026-09-29T07:40:00.000Z",
      },
    ],
    waiting: [
      {
        admissionId: "00000000-0000-4000-8000-000000007101",
        patientUserId: "00000000-0000-4000-8000-000000009023",
        name: viewer === "names" ? "Patient Twenty-Three" : null,
        mrn: "MRN-2026-01023",
        admittedBy: "Dr Example Admitting",
        decidedAt: "2026-09-29T05:15:00.000Z",
        waitReason: "no_free_bed",
      },
      {
        admissionId: "00000000-0000-4000-8000-000000007102",
        patientUserId: "00000000-0000-4000-8000-000000009024",
        name: viewer === "names" ? "Patient Twenty-Four" : null,
        mrn: "MRN-2026-01024",
        admittedBy: null,
        decidedAt: "2026-09-29T07:05:00.000Z",
        waitReason: "floor",
      },
    ],
    needsAttention: arrivingTooLong(beds, BOARD_NOW),
  };
}

/** The EU list on synthetic stays: one over the limit, one waiting, one boarding. Names only when `names`. */
export function euListData(names = true): EuListData {
  const h = 3_600_000;
  const at = (ms: number) => new Date(BOARD_NOW - ms).toISOString();
  const base = {
    wardId: FX.ward,
    hospitalArrivedAt: null,
    arriving: false,
    obsFrequency: "hourly" as const,
    resultsReady: false,
    admission: null,
    resusEpisodeId: null,
    waitReason: null,
    responsibleName: "Dr Example Admitting",
  };
  const who = (n: number) => ({
    name: names ? `Patient ${n}` : null,
    mrn: names ? `MRN-2026-0${1000 + n}` : null,
  });
  const stays: EuStayInput[] = [
    {
      ...base,
      ...who(1),
      stayId: "e1",
      patientUserId: "p1",
      status: "in_space",
      decidedAt: at(26 * h),
      hospitalArrivedAt: at(27 * h),
      spaceStartedAt: at(25 * h),
      bedLabel: "R1",
      level: 2,
      lastObsAt: at(30 * 60_000),
      resultsReady: true,
    },
    {
      ...base,
      ...who(2),
      stayId: "e2",
      patientUserId: "p2",
      status: "awaiting_space",
      decidedAt: at(2 * h),
      spaceStartedAt: null,
      bedLabel: null,
      level: 3,
      lastObsAt: null,
      waitReason: "no_free_bed",
    },
    {
      ...base,
      ...who(3),
      stayId: "e3",
      patientUserId: "p3",
      status: "in_space",
      decidedAt: at(5 * h),
      spaceStartedAt: at(4 * h),
      bedLabel: "R3",
      level: 1,
      lastObsAt: at(2 * h),
      resusEpisodeId: "ep3",
      admission: { wardName: "Medical Ward 1", decidedAt: at(h), status: "awaiting_bed" },
    },
  ];
  const t = euTracking(stays, BOARD_NOW, 24);
  return { rows: t.rows, needsAttention: t.needsAttention, limitHours: 24, names };
}
