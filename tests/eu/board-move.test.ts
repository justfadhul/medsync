import type { BoardBed, BoardData } from "@/lib/wards/board";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { moveTargets } from "@/lib/wards/eu-move";
import { emptyLayout } from "@/lib/wards/geometry";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/link", () => ({
  default: (p: { href: string; children: unknown }) =>
    h("a", { href: p.href }, p.children as never),
}));

const { BedBoard } = await import("@/components/wards/board/bed-board");

const bed = (key: string, over: Partial<BoardBed>): BoardBed => ({
  key,
  bedId: `id-${key}`,
  label: key.toUpperCase(),
  type: "standard",
  state: "free",
  since: null,
  reason: null,
  services: [],
  roomKind: null,
  roomName: null,
  patient: null,
  assignmentId: null,
  admissionId: null,
  euStayId: null,
  admittedBy: null,
  ...over,
});

const data = (beds: BoardBed[]): BoardData => ({
  ward: { id: "w1", name: "EU", wardType: "emergency_observation", bedCount: beds.length },
  tabs: [],
  doc: emptyLayout({ w: 42, h: 32 }),
  published: { version: 1, publishedAt: "2026-11-24T10:00:00Z" },
  beds,
  candidates: [],
  waiting: [],
  needsAttention: [],
});

const actions = {
  setState: async () => ({ ok: true as const }),
  assign: async () => ({ ok: true as const }),
  release: async () => ({ ok: true as const }),
  allocate: async () => ({ ok: true as const }),
  confirmArrival: async () => ({ ok: true as const }),
  releaseAdmission: async () => ({ ok: true as const }),
  moveEu: async () => ({ ok: true as const }),
};
const links = { crumbs: [], board: (id: string) => `/b/${id}`, layout: null };

const render = (beds: BoardBed[], selected: string, extra: Partial<typeof actions> = {}) =>
  renderToStaticMarkup(
    h(BedBoard, {
      data: data(beds),
      hospitalId: "h1",
      mayAct: true,
      actions: { ...actions, ...extra },
      links,
      initialSelected: selected,
      live: false,
    }),
  );

describe("the board for an EU space", () => {
  it("an Arriving EU space shows Arrived and Move, never Release", () => {
    const html = render(
      [bed("b1", { state: "arriving", assignmentId: "a1", euStayId: "s1" }), bed("b2", {})],
      "b1",
    );
    expect(html).toContain(">Arrived<");
    expect(html).toContain("Move");
    expect(html).not.toContain("Release");
    expect(html).not.toContain("Cancel the allocation");
  });

  it("an Occupied EU space shows Move instead of Release", () => {
    const html = render(
      [bed("b1", { state: "occupied", assignmentId: "a1", euStayId: "s1" }), bed("b2", {})],
      "b1",
    );
    expect(html).toContain("Move");
    expect(html).not.toContain("Release");
  });

  it("an ordinary Occupied bed still shows Release and no Move", () => {
    const html = render([bed("b1", { state: "occupied", assignmentId: "a1" })], "b1");
    expect(html).toContain("Release, bed free");
    expect(html).not.toContain(">Move");
  });

  it("no Move without a moveEu action", () => {
    const html = render(
      [bed("b1", { state: "occupied", assignmentId: "a1", euStayId: "s1" })],
      "b1",
      { moveEu: undefined },
    );
    expect(html).not.toContain(">Move");
  });
});

describe("moveTargets", () => {
  it("lists only the Free beds, not the one the patient is in", () => {
    const beds = [
      bed("b1", { state: "occupied", euStayId: "s1" }),
      bed("b2", { state: "free" }),
      bed("b3", { state: "cleaning" }),
      bed("b4", { state: "reserved" }),
      bed("b5", { state: "arriving", euStayId: "s2" }),
      bed("b6", { state: "out" }),
      bed("b7", { state: "free" }),
    ];
    expect(moveTargets(beds).map((b) => b.key)).toEqual(["b2", "b7"]);
  });
});
