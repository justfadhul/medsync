// @vitest-environment jsdom
import type { PlanView } from "@/components/clerking/plan/model";
import type { PlanDraft } from "@/lib/clerking/plan/draft";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
const { Where } = await import("@/components/clerking/plan/plan-step");

const EU = "00000000-0000-4000-8000-0000000000e1";
const view = (euWards?: { id: string; name: string; counts: string | null }[]) =>
  ({
    draft: { disposition: { kind: "observe_eu" } },
    payload: { wards: [], ...(euWards ? { euWards } : {}) },
    news2: null,
    obsRequired: null,
  }) as unknown as PlanView;

describe("Observe in EU chips in the Plan", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });
  const show = (v: PlanView, onPlan: (fn: (d: PlanDraft) => PlanDraft) => void = () => {}) =>
    act(async () => root.render(h(Where, { v, editable: true, onPlan })));
  const group = () => document.querySelector('[role="group"][aria-label="Emergency unit"]');

  it("renders a chip per unit, and a click sets the disposition", async () => {
    const onPlan = vi.fn();
    await show(view([{ id: EU, name: "OPD EU", counts: "3 free · 2 occupied" }]), onPlan);
    const chip = [...group()!.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("OPD EU"),
    )!;
    expect(chip.textContent).toContain("3 free");
    await act(async () => chip.click());
    const next = onPlan.mock.calls[0]![0]({ disposition: { kind: "observe_eu" } });
    expect(next.disposition).toEqual({ kind: "observe_eu", ward: "OPD EU", wardId: EU });
  });

  it("flag off (no euWards): nothing renders", async () => {
    await show(view());
    expect(group()).toBeNull();
    expect(document.body.textContent).not.toContain("No emergency unit is set up");
  });

  it("an empty list says so", async () => {
    await show(view([]));
    expect(group()).toBeNull();
    expect(document.body.textContent).toContain("No emergency unit is set up");
  });
});
