/**
 * The nursing care plan as it stands (ADR 0546 Phase 2): the open problems of a visit, each item ticked or not by
 * its latest tick or untick, and the latest shift evaluation. Pure over the append-only rows of migration 0314.
 */
export interface ProblemRow {
  id: string;
  problem: string;
  label: string | null;
  relatedTo: string | null;
  asShownBy: string | null;
  goal: string;
  goalBy: string | null;
  careItems: string[];
  state: string;
  replacesId: string | null;
  recordedAt: Date;
  recordedByUserId: string;
}

export interface EventRow {
  problemId: string;
  kind: string;
  itemIndex: number | null;
  evaluation: string | null;
  note: string | null;
  recordedAt: Date;
  recordedByUserId: string;
}

export interface PlanItem {
  index: number;
  text: string;
  done: { at: string; by: string } | null;
}

export interface PlanProblem {
  id: string;
  problem: string;
  label: string | null;
  relatedTo: string | null;
  asShownBy: string | null;
  goal: string;
  goalBy: string | null;
  items: PlanItem[];
  evaluation: { value: string; note: string | null; at: string; by: string } | null;
  since: string;
}

export function foldPlan(problems: ProblemRow[], events: EventRow[]): PlanProblem[] {
  const ended = new Set(problems.filter((p) => p.replacesId).map((p) => p.replacesId));
  const byTime = [...events].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  return problems
    .filter((p) => p.state === "active" && !ended.has(p.id))
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())
    .map((p) => {
      const mine = byTime.filter((e) => e.problemId === p.id);
      const items = p.careItems.map((text, index): PlanItem => {
        const last = mine.filter((e) => e.itemIndex === index && e.kind !== "evaluation").at(-1);
        return {
          index,
          text,
          done:
            last?.kind === "tick"
              ? { at: last.recordedAt.toISOString(), by: last.recordedByUserId }
              : null,
        };
      });
      const ev = mine.filter((e) => e.kind === "evaluation").at(-1);
      return {
        id: p.id,
        problem: p.problem,
        label: p.label,
        relatedTo: p.relatedTo,
        asShownBy: p.asShownBy,
        goal: p.goal,
        goalBy: p.goalBy,
        items,
        evaluation: ev
          ? {
              value: ev.evaluation ?? "",
              note: ev.note,
              at: ev.recordedAt.toISOString(),
              by: ev.recordedByUserId,
            }
          : null,
        since: p.recordedAt.toISOString(),
      };
    });
}
