// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The staff notices list (ADR 0533): subjects shown, Dismiss sends the notice's id. Synthetic rows. */

const dismissNotice = vi.fn(async () => ({ ok: true, id: "x", serverTime: "" }));
vi.mock("@/lib/notices/actions", () => ({ dismissNotice }));
const { StaffNotices } = await import("@/components/medsync/staff-notices");

const ID = "11111111-1111-4111-8111-111111111111";
const notice = {
  id: ID,
  kind: "ward_incoming",
  subject: "Incoming patient · Ward 4",
  body: "A patient is being admitted to your ward. See the bed board.",
  at: "2026-11-24T08:00:00.000Z",
  read: false,
};

describe("StaffNotices", () => {
  let el: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    el = document.createElement("div");
    document.body.appendChild(el);
  });
  afterEach(() => {
    el.remove();
    dismissNotice.mockClear();
  });

  it("notices render subject and dismiss", async () => {
    const root = createRoot(el);
    await act(async () => root.render(h(StaffNotices, { notices: [notice] })));
    expect(el.textContent).toContain("Incoming patient · Ward 4");
    expect(el.textContent).toContain("See the bed board.");
    const button = [...el.querySelectorAll("button")].find((b) => b.textContent === "Dismiss")!;
    await act(async () => button.click());
    expect(dismissNotice).toHaveBeenCalledWith({ id: ID });
    await act(async () => root.unmount());
  });

  it("renders nothing when empty", async () => {
    const root = createRoot(el);
    await act(async () => root.render(h(StaffNotices, { notices: [] })));
    expect(el.innerHTML).toBe("");
    await act(async () => root.unmount());
  });
});
