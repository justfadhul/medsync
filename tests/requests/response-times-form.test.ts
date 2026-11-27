// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResponseTimesForm } from "@/components/requests/response-times-form";
import { D4_DEFAULTS } from "@/lib/requests/escalation";

/** The response-times form (D4): starts at the approved values, signs only a saved draft, refuses bad minutes in words. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot> | null = null;
let el: HTMLElement;
function mount(props: Partial<Parameters<typeof ResponseTimesForm>[0]> = {}) {
  el = document.createElement("div");
  document.body.append(el);
  const onSave = vi.fn(async () => ({ ok: true as const }));
  const onSign = vi.fn(async () => ({ ok: true as const }));
  root = createRoot(el);
  act(() => root!.render(h(ResponseTimesForm, { draft: null, onSave, onSign, ...props })));
  return { onSave, onSign };
}
afterEach(() => {
  act(() => root?.unmount());
  el.remove();
});
const inputs = () => [...el.querySelectorAll("input[inputmode=numeric]")] as HTMLInputElement[];
const button = (t: string) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(t))!;

describe("response times form", () => {
  it("the form starts at the D4 values", () => {
    mount();
    expect(inputs().map((i) => i.value)).toEqual(Object.values(D4_DEFAULTS).map(String));
    expect(el.textContent).toContain("D4 defaults, approved by the owner (CSO) on 24 Nov 2026");
  });
  it("sign waits for a saved draft", async () => {
    const { onSign } = mount();
    const sign = button("Sign for the hospital") as HTMLButtonElement;
    expect(sign.disabled).toBe(true);
    expect(el.textContent).toContain("Save the draft first");
    await act(async () => button("Save draft").click());
    expect((button("Sign for the hospital") as HTMLButtonElement).disabled).toBe(false);
    await act(async () => button("Sign for the hospital").click());
    expect(onSign).toHaveBeenCalledOnce();
  });
  it("minutes outside 1–2880 are refused with words", async () => {
    const { onSave } = mount();
    const set = (i: HTMLInputElement, v: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(i, v);
        i.dispatchEvent(new Event("input", { bubbles: true }));
      });
    set(inputs()[0]!, "0");
    await act(async () => button("Save draft").click());
    expect(onSave).not.toHaveBeenCalled();
    expect(el.textContent).toContain("whole minutes, 1 to 2880");
  });
  it("editing after a save disables Sign again", async () => {
    mount();
    await act(async () => button("Save draft").click());
    expect((button("Sign for the hospital") as HTMLButtonElement).disabled).toBe(false);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        inputs()[1]!,
        "45",
      );
      inputs()[1]!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect((button("Sign for the hospital") as HTMLButtonElement).disabled).toBe(true);
  });
  it("sign hands the saved numbers, not the edited ones", async () => {
    const { onSign } = mount();
    await act(async () => button("Save draft").click());
    await act(async () => button("Sign for the hospital").click());
    expect(onSign).toHaveBeenCalledWith(expect.anything(), D4_DEFAULTS);
  });
});

describe("signRequestTimes refuses numbers that differ from the stored draft", () => {
  it("throws the content sentence", async () => {
    const { signRequestTimes } = await import("@/lib/requests/times");
    const row = { id: "v", status: "draft", adminSignedBy: null, ...D4_DEFAULTS };
    const chain = { from: () => chain, where: () => chain, for: async () => [row] };
    const tx = { select: () => chain } as never;
    await expect(
      signRequestTimes(
        tx,
        { userId: "u", hospitalId: "h", as: "admin" },
        { versionId: "v", exceptionNote: null, expect: { ...D4_DEFAULTS, reviewNowAcceptMin: 10 } },
        new Date(),
      ),
    ).rejects.toThrow(/changed since you saw them/);
  });
  it("signs an unchanged draft when expect carries the actions' extra fields", async () => {
    const { signRequestTimes } = await import("@/lib/requests/times");
    const row = { id: "v", status: "draft", adminSignedBy: null, ...D4_DEFAULTS };
    const chain = {
      from: () => chain,
      where: () => chain,
      for: async () => [row],
    };
    const set = vi.fn(() => ({ where: async () => undefined }));
    const tx = { select: () => chain, update: () => ({ set }) } as never;
    const shown = { versionId: "v", exceptionNote: null, ...D4_DEFAULTS };
    await expect(
      signRequestTimes(
        tx,
        { userId: "u", hospitalId: "h", as: "admin" },
        { versionId: "v", exceptionNote: null, expect: shown },
        new Date(),
      ),
    ).resolves.toBeUndefined();
    expect(set).toHaveBeenCalled();
  });
});
