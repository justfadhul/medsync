import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WardItem } from "@/app/hospital-admin/departments/wards/_lib/model";
import { describe, expect, it } from "vitest";

import {
  initialsOf,
  passes,
  summarise,
  takenPct,
  tally,
} from "@/app/hospital-admin/departments/wards/_lib/model";
import { emptyLayout } from "@/supabase/functions/_shared/ward-layout";

/*
 * Wards and beds in the admin workspace (phase 2 of ADR 0520): the list's counts come from the bed board's states
 * and the register, never estimated; a ward without a published plan has no live states.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const ward = (over: Partial<WardItem>): WardItem => ({
  id: "w",
  name: "Medical ward A",
  departmentId: "d",
  wardType: "general",
  sex: "female",
  ageGroup: "adult",
  placeId: null,
  parentWardId: null,
  bedCount: 0,
  closed: null,
  archived: false,
  beds: [],
  inCharge: [],
  layout: { published: false, draft: false },
  plan: null,
  ...over,
});

const plan = (states: string) => ({
  doc: emptyLayout({ w: 20, h: 12 }),
  states: Object.fromEntries(
    [...states].map((c, i) => [
      `b${i}`,
      (
        { o: "occupied", a: "arriving", f: "free", c: "cleaning", r: "reserved", x: "out" } as const
      )[c as "o"],
    ]),
  ),
});

describe("the wards list's counts", () => {
  const a = ward({
    id: "a",
    bedCount: 6,
    layout: { published: true, draft: false },
    plan: plan("oofacx"),
    beds: [{ id: "x", label: "A6", closedReason: "Broken frame", archived: false }],
  });
  const b = ward({ id: "b", bedCount: 10 });
  const c = ward({
    id: "c",
    bedCount: 8,
    closed: { reason: "Roof repairs", since: "2026-11-01T00:00:00Z", expectedReopenOn: null },
  });
  const d = ward({ id: "d", bedCount: 4, archived: true });

  it("tallies a ward's board, and nothing without one", () => {
    expect(tally(a.plan)).toEqual({
      occupied: 2,
      arriving: 1,
      free: 1,
      cleaning: 1,
      reserved: 0,
      out: 1,
    });
    expect(tally(null)).toEqual({
      occupied: 0,
      arriving: 0,
      free: 0,
      cleaning: 0,
      reserved: 0,
      out: 0,
    });
    expect(takenPct(tally(a.plan))).toBe(50);
    expect(takenPct(tally(null))).toBe(0);
  });

  it("counts open wards only; the register frames the beds, the board gives the states", () => {
    expect(summarise([a, b, c, d])).toEqual({
      bedsOpen: 16,
      wardsOpen: 2,
      free: 1,
      taken: 3,
      cleaning: 1,
      boardBeds: 6,
      out: 1,
      noPlan: 2,
    });
  });

  it("filters: open, closed, no floor plan, archived", () => {
    const all = [a, b, c, d];
    expect(all.filter((w) => passes(w, "all")).map((w) => w.id)).toEqual(["a", "b", "c"]);
    expect(all.filter((w) => passes(w, "open")).map((w) => w.id)).toEqual(["a", "b"]);
    expect(all.filter((w) => passes(w, "closed")).map((w) => w.id)).toEqual(["c"]);
    expect(all.filter((w) => passes(w, "noPlan")).map((w) => w.id)).toEqual(["b", "c"]);
    expect(all.filter((w) => passes(w, "archived")).map((w) => w.id)).toEqual(["d"]);
  });

  it("with the ward builder off, no ward counts as missing a floor plan", () => {
    expect(summarise([ward({ layout: null, bedCount: 5 })]).noPlan).toBe(0);
    expect(passes(ward({ layout: null }), "noPlan")).toBe(false);
  });

  it("a ward's tile reads its first and last initials", () => {
    expect(initialsOf("Medical ward A")).toBe("MA");
    expect(initialsOf("HDU")).toBe("H");
  });
});

describe("the wards pages in the admin frame", () => {
  it("the list reads boards with no patient, and only for wards with a published layout", () => {
    const page = read("app/hospital-admin/departments/wards/page.tsx");
    expect(page).toMatch(/layouts\[w\.id\]\?\.published/);
    expect(page).toMatch(/patients: "none"/);
  });

  it("the list's writes are the old panel's hub ops and no others", () => {
    const src = read("app/hospital-admin/departments/wards/_lib/actions.ts");
    const m = src.match(/const OPS = new Set\(\[([\s\S]*?)\]\)/);
    const ops = [...(m?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort();
    expect(ops).toEqual([
      "archive",
      "assign_ward_in_charge",
      "end_ward_in_charge",
      "generate_beds",
      "link_resus_bay",
      "set_bed",
      "set_ward_closure",
      "start_layout_from_register",
      "unarchive",
      "upsert_ward",
    ]);
    expect(src).toMatch(/hospital_id: scope\.hospitalId/);
  });

  it("the builder and the board fill the frame; the hub's tabs are gone from every wards page", () => {
    expect(read("app/hospital-admin/departments/wards/[wardId]/layout/layout-client.tsx")).toMatch(
      /fit="frame"/,
    );
    expect(read("app/hospital-admin/departments/wards/[wardId]/board/board-client.tsx")).toMatch(
      /fit="frame"/,
    );
    expect(read("app/hospital-admin/departments/_components/hub-frame.tsx")).toMatch(
      /if \(seg\[0\] === "wards"\) return/,
    );
  });

  it("dialogs are the desk's centred DeskDialog, never a sheet", () => {
    for (const f of ["ward-dialogs.tsx", "ward-panel.tsx", "wards-view.tsx"]) {
      const src = read(`app/hospital-admin/departments/wards/_components/${f}`);
      expect(src, f).not.toMatch(/<Sheet\b|<SheetContent/);
    }
    expect(read("app/hospital-admin/departments/wards/_components/ward-dialogs.tsx")).toMatch(
      /<DeskDialog/,
    );
  });
});
