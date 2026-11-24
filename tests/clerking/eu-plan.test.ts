import type { PlanView } from "@/components/clerking/plan/model";
import type { PlanDraft } from "@/lib/clerking/plan/draft";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
const { reviewTarget } = await import("@/components/clerking/plan/plan-step");

const ADMIT = "00000000-0000-4000-8000-0000000000a1";
const EU = "00000000-0000-4000-8000-0000000000e1";
const MED = "00000000-0000-4000-8000-0000000000b2";
const OWN = "00000000-0000-4000-8000-0000000000b1";
// The EU is listed under the medical department on purpose: it still must not pick the target.
const v = {
  payload: {
    requests: {
      departments: [
        { id: MED, name: "Medicine", wardIds: [ADMIT, EU], staff: [] },
        { id: OWN, name: "Emergency", wardIds: [], staff: [] },
      ],
      ownDepartmentId: OWN,
    },
  },
} as unknown as PlanView;
const plan = (disposition: PlanDraft["disposition"]): PlanDraft => ({ disposition });

describe("a review's target and the EU (R11)", () => {
  it("Admit: the admit ward's department", () => {
    expect(reviewTarget(v, plan({ kind: "admit", ward: "Medical", wardId: ADMIT }))?.id).toBe(MED);
  });
  it("Observe in EU: the EU ward is not a target; the viewer's own department is", () => {
    expect(reviewTarget(v, plan({ kind: "observe_eu", ward: "OPD EU", wardId: EU }))?.id).toBe(OWN);
  });
});
