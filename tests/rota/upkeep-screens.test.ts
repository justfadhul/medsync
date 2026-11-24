// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DUTY_ROTA_COPY } from "@/content/duty-rota";

/** Upkeep screens (ADR 0538): synthetic data, no database. */

const { RotaWeek } = await import("@/components/rota/rota-week");
const { MyDuties } = await import("@/components/rota/my-duties");
const { DelegateDialog } = await import("@/components/rota/delegate-dialog");

const ok = vi.fn(async () => ({ ok: true as const, id: "x", serverTime: "" }));
const fill = vi.fn(async () => ({
  ok: true as const,
  id: "x",
  serverTime: "",
  data: { written: 0, skipped: [] },
}));
const actions = {
  createPost: ok,
  archivePost: ok,
  assignDuty: ok,
  endDuty: ok,
  saveTemplate: ok,
  endTemplate: ok,
  fillWeek: fill,
  publishWeek: ok,
  unlockWeek: ok,
  askSwap: ok,
  decideSwap: ok,
  addDelegate: ok,
  revokeDelegate: ok,
};
const DEPT = "11111111-1111-4111-8111-111111111111";
const POST = "22222222-2222-4222-8222-222222222222";
const ME = "44444444-4444-4444-8444-444444444444";
const OTHER = "66666666-6666-4666-8666-666666666666";

const duty = (id: string, userId: string, name: string) => ({
  id,
  postId: POST,
  userId,
  startsAt: new Date("2026-11-24T08:00:00+03:00"),
  endsAt: new Date("2026-11-24T17:00:00+03:00"),
  kind: "rostered" as const,
  coversAssignmentId: null,
  endedAt: null,
  name,
  state: "planned" as const,
});
const week = (published: boolean) => ({
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
      capacity: 2,
      archived: false,
    },
  ],
  assignments: [
    duty("33333333-3333-4333-8333-333333333333", ME, "Dr Me"),
    duty("77777777-7777-4777-8777-777777777777", OTHER, "Dr Other"),
  ],
  gaps: [],
  published,
  templates: [],
  swapsToDecide: [],
  delegates: [],
  eligible: [
    { userId: ME, name: "Dr Me", cadre: "MEDICAL_OFFICER", departmentName: null },
    { userId: OTHER, name: "Dr Other", cadre: "MEDICAL_OFFICER", departmentName: null },
  ],
  needsCover: [],
});

describe("upkeep screens", () => {
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
  const grid = async (published: boolean, viewerId: string | null, canPublish = true) => {
    const root = createRoot(el);
    await act(async () =>
      root.render(
        h(RotaWeek, {
          week: week(published),
          departmentId: DEPT,
          departmentName: "Internal Medicine",
          weekStart: "2026-11-23",
          wards: [],
          cadres: [{ code: "MEDICAL_OFFICER", name: "Medical Officer" }],
          canEdit: true,
          canPublish,
          canDelegate: canPublish,
          viewerId,
          actions,
        }),
      ),
    );
    return root;
  };
  const buttons = (text: string) =>
    [...document.querySelectorAll("button")].filter((b) => b.textContent === text);

  it("a published week hides Add and shows Ask for cover to the holder", async () => {
    const root = await grid(true, ME);
    expect(buttons("Add")).toHaveLength(0);
    // Only the holder's own duty, not the colleague's.
    expect(buttons(DUTY_ROTA_COPY.upkeep.askCover)).toHaveLength(1);
    expect(el.textContent).toContain(DUTY_ROTA_COPY.upkeep.published);
    await act(async () => root.unmount());
  });

  it("a draft week shows Add and no Ask for cover", async () => {
    const root = await grid(false, ME);
    expect(buttons("Add").length).toBeGreaterThan(0);
    expect(buttons(DUTY_ROTA_COPY.upkeep.askCover)).toHaveLength(0);
    expect(el.textContent).toContain(DUTY_ROTA_COPY.upkeep.draft);
    await act(async () => root.unmount());
  });

  it("unlock needs a reason", async () => {
    const root = await grid(true, null);
    await act(async () => buttons(DUTY_ROTA_COPY.upkeep.unlock)[0]!.click());
    const save = () => buttons(DUTY_ROTA_COPY.upkeep.unlockSave)[0] as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    expect(document.body.textContent).toContain(DUTY_ROTA_COPY.upkeep.unlockWhy);
    const input = document.querySelector("input[type=text], input:not([type])") as HTMLInputElement;
    const type = async (v: string) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      await act(async () => {
        set.call(input, v);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await type("a");
    expect(save().disabled).toBe(true);
    await type("ab");
    expect(save().disabled).toBe(false);
    await act(async () => root.unmount());
  });

  it("delegate until uses chips, not a date input", async () => {
    const root = createRoot(el);
    await act(async () =>
      root.render(
        h(DelegateDialog, {
          eligible: week(false).eligible,
          add: ok,
          onClose: () => {},
        }),
      ),
    );
    expect(document.querySelector("input[type=date]")).toBeNull();
    for (const w of [
      DUTY_ROTA_COPY.delegate.week1,
      DUTY_ROTA_COPY.delegate.weeks4,
      DUTY_ROTA_COPY.delegate.noEnd,
    ])
      expect(buttons(w)).toHaveLength(1);
    expect(document.body.textContent).toContain(DUTY_ROTA_COPY.delegate.canPublish);
    await act(async () => root.unmount());
  });

  it("a delegate without the publish right sees no Publish or Unlock", async () => {
    const root = await grid(false, null, false);
    expect(buttons(DUTY_ROTA_COPY.upkeep.publish)).toHaveLength(0);
    await act(async () => root.unmount());
    const again = await grid(false, null, true);
    expect(buttons(DUTY_ROTA_COPY.upkeep.publish)).toHaveLength(1);
    await act(async () => again.unmount());
  });

  it("my duties: Ask for cover on a live duty, Accept and Decline only on what is asked", async () => {
    const duty = {
      id: "d1",
      postName: "Medical on call",
      startsAt: new Date("2026-11-25T08:00:00+03:00"),
      endsAt: new Date("2026-11-25T17:00:00+03:00"),
      state: "planned" as const,
      colleagues: [],
      theirDuties: [],
    };
    const past = { ...duty, id: "d2", state: "past" as const };
    const asked = {
      id: "r1",
      kind: "cover" as const,
      postName: "Medical on call",
      askedByName: "Dr Me",
      startsAt: duty.startsAt,
      endsAt: duty.endsAt,
    };
    const root = createRoot(el);
    const show = (asks: (typeof asked)[]) =>
      act(async () =>
        root.render(h(MyDuties, { duties: [duty, past], asked: asks, ask: ok, answer: ok })),
      );
    await show([]);
    expect(buttons(DUTY_ROTA_COPY.upkeep.askCover)).toHaveLength(1);
    expect(buttons(DUTY_ROTA_COPY.asked.accept)).toHaveLength(0);
    await show([asked]);
    expect(buttons(DUTY_ROTA_COPY.asked.accept)).toHaveLength(1);
    expect(buttons(DUTY_ROTA_COPY.asked.decline)).toHaveLength(1);
    await act(async () => root.unmount());
  });
});
