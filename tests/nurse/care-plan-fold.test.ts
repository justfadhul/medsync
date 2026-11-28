import type { EventRow, ProblemRow } from "@/lib/nursing-care/fold";
import { describe, expect, it } from "vitest";

import { foldPlan } from "@/lib/nursing-care/fold";

const t = (m: number) => new Date(Date.UTC(2026, 10, 30, 8, m));
const p = (id: string, o: Partial<ProblemRow> = {}): ProblemRow => ({
  id,
  problem: id,
  label: null,
  relatedTo: null,
  asShownBy: null,
  goal: "g",
  goalBy: null,
  careItems: ["a", "b"],
  state: "active",
  replacesId: null,
  recordedAt: t(0),
  recordedByUserId: "n1",
  ...o,
});
const e = (o: Partial<EventRow>): EventRow => ({
  problemId: "p1",
  kind: "tick",
  itemIndex: 0,
  evaluation: null,
  note: null,
  recordedAt: t(1),
  recordedByUserId: "n1",
  ...o,
});

describe("the nursing care plan as it stands (ADR 0546)", () => {
  it("keeps open problems only: a resolving row ends the one it names", () => {
    const plan = foldPlan(
      [p("p1"), p("p2"), p("r", { state: "resolved", replacesId: "p2", recordedAt: t(5) })],
      [],
    );
    expect(plan.map((x) => x.id)).toEqual(["p1"]);
  });

  it("takes an item's latest tick or untick, and the latest evaluation", () => {
    const [plan] = foldPlan(
      [p("p1")],
      [
        e({ kind: "tick", itemIndex: 0, recordedAt: t(1) }),
        e({ kind: "untick", itemIndex: 0, recordedAt: t(2) }),
        e({ kind: "tick", itemIndex: 1, recordedAt: t(3) }),
        e({ kind: "evaluation", itemIndex: null, evaluation: "progressing", recordedAt: t(4) }),
        e({ kind: "evaluation", itemIndex: null, evaluation: "met", recordedAt: t(6) }),
      ],
    );
    expect(plan!.items.map((i) => !!i.done)).toEqual([false, true]);
    expect(plan!.evaluation?.value).toBe("met");
  });
});
