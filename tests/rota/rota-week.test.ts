// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DUTY_ROTA_COPY } from "@/content/duty-rota";
import { rotaWeekStart, shiftOf } from "@/lib/rota/cover";

/** The rota week grid (ADR 0534): synthetic posts and staff, no database. */

const { RotaWeek } = await import("@/components/rota/rota-week");

const ok = vi.fn(async () => ({ ok: true as const, id: "x", serverTime: "" }));
const actions = {
  createPost: ok,
  archivePost: ok,
  assignDuty: ok,
  endDuty: ok,
  saveTemplate: ok,
  endTemplate: ok,
  fillWeek: vi.fn(async () => ({
    ok: true as const,
    id: "x",
    serverTime: "",
    data: { written: 0, skipped: [] },
  })),
  publishWeek: ok,
  unlockWeek: ok,
  decideSwap: ok,
  addDelegate: ok,
  revokeDelegate: ok,
};
const DEPT = "11111111-1111-4111-8111-111111111111";
const POST = "22222222-2222-4222-8222-222222222222";
const ASSIGN = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

const week = {
  posts: [
    {
      id: POST,
      departmentId: DEPT,
      wardId: null,
      name: "Medical on call",
      level: "senior" as const,
      eligibleCadres: ["MEDICAL_OFFICER"],
      takesConsults: true,
      escalatesToPostId: null,
      capacity: 1,
      archived: false,
    },
  ],
  // Tuesday 24 Nov, the day shift, its holder on leave.
  assignments: [
    {
      id: ASSIGN,
      postId: POST,
      userId: USER,
      startsAt: new Date("2026-11-24T08:00:00+03:00"),
      endsAt: new Date("2026-11-24T17:00:00+03:00"),
      kind: "rostered" as const,
      coversAssignmentId: null,
      endedAt: null,
      name: "Dr Okello",
      state: "needs_cover" as const,
    },
  ],
  gaps: [],
  published: false,
  templates: [],
  swapsToDecide: [],
  delegates: [],
  eligible: [{ userId: USER, name: "Dr Okello", cadre: "MEDICAL_OFFICER", departmentName: null }],
  // The same duty, and one on Tuesday 1 Dec: after the shown week, inside the next 72 h.
  needsCover: [
    {
      id: ASSIGN,
      postId: POST,
      userId: USER,
      startsAt: new Date("2026-11-24T08:00:00+03:00"),
      endsAt: new Date("2026-11-24T17:00:00+03:00"),
      kind: "rostered" as const,
      coversAssignmentId: null,
      endedAt: null,
      name: "Dr Okello",
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      postId: POST,
      userId: USER,
      startsAt: new Date("2026-12-01T08:00:00+03:00"),
      endsAt: new Date("2026-12-01T09:30:00+03:00"),
      kind: "rostered" as const,
      coversAssignmentId: null,
      endedAt: null,
      name: "Dr Okello",
    },
  ],
};

const props = (canEdit: boolean) => ({
  week,
  departmentId: DEPT,
  departmentName: "Internal Medicine",
  weekStart: "2026-11-23",
  wards: [],
  cadres: [{ code: "MEDICAL_OFFICER", name: "Medical Officer" }],
  canEdit,
  actions,
});

describe("RotaWeek", () => {
  let el: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    el = document.createElement("div");
    document.body.appendChild(el);
  });
  afterEach(() => {
    el.remove();
    document.body.innerHTML = "";
  });

  const render = async (canEdit: boolean) => {
    const root = createRoot(el);
    await act(async () => root.render(h(RotaWeek, props(canEdit))));
    return root;
  };
  const adds = () => [...el.querySelectorAll("button")].filter((b) => b.textContent === "Add");

  it("an empty cell offers Add with that day", async () => {
    const root = await render(true);
    const monday = adds().find((b) => b.dataset.day === "2026-11-23");
    expect(monday).toBeTruthy();
    await act(async () => monday!.click());
    expect(document.body.textContent).toContain("Mon 23 Nov");
    expect(document.body.textContent).toContain(DUTY_ROTA_COPY.assign.person);
    await act(async () => root.unmount());
  });

  it("needs cover shows as a neutral tag with its word", async () => {
    const root = await render(true);
    const tag = [...el.querySelectorAll('[data-slot="tag"]')].find(
      (t) => t.textContent === "Needs cover",
    );
    expect(tag).toBeTruthy();
    const classes = [tag!, ...tag!.querySelectorAll("*")].map((n) => n.className).join(" ");
    expect(classes).not.toMatch(/amber|red|green/);
    await act(async () => root.unmount());
  });

  it("view-only heads see no Add", async () => {
    const root = await render(false);
    expect(adds()).toHaveLength(0);
    await act(async () => root.unmount());
  });

  it("the grid says planned, not present", async () => {
    const root = await render(false);
    expect(el.textContent).toContain(DUTY_ROTA_COPY.plannedNotPresent);
    // "present" only in that line: no state word claims anyone is there.
    expect(el.textContent!.match(/present/gi)).toHaveLength(1);
    await act(async () => root.unmount());
  });

  it("needs cover after the week shows in the report, not the grid", async () => {
    const root = await render(true);
    const cells = [...el.querySelectorAll("td")].map((td) => td.textContent).join(" ");
    expect(cells).not.toContain("Tue 1 Dec");
    expect(el.textContent).toContain("Medical on call · Dr Okello");
    expect(el.textContent).toContain("Tue 1 Dec 08:00 – Tue 1 Dec 09:30");
    await act(async () => root.unmount());
  });

  it("a window that is no shift gets a neutral word", () => {
    const at = (s: string) => new Date(`${s}+03:00`);
    expect(shiftOf(at("2026-11-24T17:00:00"), at("2026-11-25T08:00:00"))).toBe("night");
    expect(shiftOf(at("2026-11-23T08:00:00"), at("2026-11-30T08:00:00"))).toBe("week");
    expect(shiftOf(at("2026-12-01T08:00:00"), at("2026-12-01T09:30:00"))).toBeNull();
    expect(shiftOf(at("2026-11-24T09:00:00"), at("2026-11-24T18:00:00"))).toBeNull();
  });

  it("the week is a Monday, else this week's Monday in Kampala", () => {
    const now = new Date("2026-11-26T22:30:00Z"); // Fri 27 Nov 01:30 in Kampala
    expect(rotaWeekStart("2026-11-16", now)).toBe("2026-11-16");
    expect(rotaWeekStart("2026-11-17", now)).toBe("2026-11-23");
    expect(rotaWeekStart("junk", now)).toBe("2026-11-23");
    expect(rotaWeekStart(undefined, new Date("2026-11-22T21:30:00Z"))).toBe("2026-11-23");
  });
});
