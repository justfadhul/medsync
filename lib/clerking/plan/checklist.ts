/**
 * "Before you sign" (ADR 0184 §5): the checklist computed from the Plan draft and the record, the
 * status pill, and the fingerprint that "Mark plan done" stamps. Any later change to what the
 * fingerprint covers reopens the plan. Pure.
 */
import type { PlanDraft } from "./draft";
import type { ObsRequirement } from "./observations";
import type { ProblemCard } from "./problems";
import type { PlanRecord } from "./record";

import { words } from "@/lib/clerking/impression/board";
import { hashString } from "@/lib/clerking/summary/review";
import { basketOf } from "./draft";
import { lessOftenThanRequired } from "./observations";
import { standing } from "./record";

export type ChecklistId =
  | "disposition"
  | "observations"
  | "senior_review"
  | "leading"
  | "must_not_miss"
  | "medicines"
  | "basket"
  | "follow_up";

export interface ChecklistItem {
  id: ChecklistId;
  label: string;
  done: boolean;
  /** What is missing, in words. */
  detail: string | null;
}

export const REASON_WORDS = 3;

/** Has the problem a test (placed or in the basket), a care item ticked, or a treatment? */
export function problemAddressed(
  card: ProblemCard,
  plan: PlanDraft,
  record: PlanRecord,
): { test: boolean; care: boolean; treatment: boolean } {
  const basket = basketOf(plan);
  const id = card.versionId;
  const linked = new Set(plan.problems?.[card.logicalId]?.linked ?? []);
  const test =
    record.orders.some((o) => o.reasonConditionIds.includes(id) || linked.has(o.id)) ||
    basket.orders.some((o) => o.reasonConditionIds.includes(id));
  const treatment =
    record.prescriptions.some((r) => standing(r) && r.conditionId === id) ||
    basket.prescriptions.some((r) => r.conditionId === id);
  const care = Object.values(plan.problems?.[card.logicalId]?.care ?? {}).some(Boolean);
  return { test, care, treatment };
}

export interface ChecklistInput {
  plan: PlanDraft;
  cards: readonly ProblemCard[];
  record: PlanRecord;
  obsRequired: ObsRequirement | null;
  /** CARE_REQUESTS: senior review offers "Not needed" with a reason. */
  notNeededOption?: boolean;
}

export function checklist(i: ChecklistInput): ChecklistItem[] {
  const { plan, cards, record } = i;
  const items: ChecklistItem[] = [];
  const d = plan.disposition;
  const dispDone =
    !!d && (d.kind === "admit" ? !!d.ward : d.kind === "refer" ? !!d.referTo?.trim() : true);
  items.push({
    id: "disposition",
    label: "Disposition",
    done: dispDone,
    detail: !d
      ? "Choose admit, observe, refer or discharge."
      : d.kind === "admit" && !d.ward
        ? "Choose the ward."
        : d.kind === "refer" && !d.referTo?.trim()
          ? "Say where to."
          : null,
  });
  const obs = plan.observations;
  const lessOften = lessOftenThanRequired(obs?.frequency, i.obsRequired);
  const obsDone = !!obs && (!lessOften || words(obs.reason ?? "") >= REASON_WORDS);
  items.push({
    id: "observations",
    label: "Observations for NEWS2",
    done: obsDone,
    detail: !obs
      ? "Choose how often."
      : lessOften && !obsDone
        ? "Less often than NEWS2 calls for: say why."
        : null,
  });
  const seniorDone = !!plan.seniorReview || words(plan.seniorReviewNotNeeded ?? "") >= REASON_WORDS;
  items.push({
    id: "senior_review",
    label: "Senior review",
    done: seniorDone,
    detail: seniorDone ? null : i.notNeededOption ? "Choose when, or say why not." : "Choose when.",
  });
  const leading = cards.find((c) => c.slot === "leading");
  if (leading) {
    const a = problemAddressed(leading, plan, record);
    items.push({
      id: "leading",
      label: "The leading problem has a test, a care item or a treatment",
      done: a.test || a.care || a.treatment,
      detail: a.test || a.care || a.treatment ? null : leading.display,
    });
  }
  const mnmOpen = cards.filter((c) => {
    if (!c.mustNotMiss) return false;
    const a = problemAddressed(c, plan, record);
    const reason = plan.problems?.[c.logicalId]?.mnmReason ?? "";
    return !(a.test || a.treatment || words(reason) >= REASON_WORDS);
  });
  if (cards.some((c) => c.mustNotMiss))
    items.push({
      id: "must_not_miss",
      label: "Every must-not-miss problem has a test, a treatment or a reason",
      done: mnmOpen.length === 0,
      detail: mnmOpen.length ? mnmOpen.map((c) => c.display).join(", ") : null,
    });
  const pending = record.medicines.filter((m) => m.answer === "pending");
  if (record.medicines.length)
    items.push({
      id: "medicines",
      label: "Every admission medicine has a decision",
      done: pending.length === 0,
      detail: pending.length ? pending.map((m) => m.display).join(", ") : null,
    });
  const basket = basketOf(plan);
  const inBasket = basket.orders.length + basket.prescriptions.length + basket.requests.length;
  items.push({
    id: "basket",
    label: "The basket is empty",
    done: inBasket === 0,
    detail: inBasket ? `${inBasket} not placed` : null,
  });
  if (d?.kind === "discharge")
    items.push({
      id: "follow_up",
      label: "Follow-up",
      done: !!plan.followUp?.when,
      detail: plan.followUp?.when ? null : "Choose when.",
    });
  return items;
}

/** What "plan done" covers: the draft's decisions and the record's placed items and answers. */
export function planFingerprint(plan: PlanDraft, record: PlanRecord): string {
  const { done: _d, text: _t, ...rest } = plan;
  const placed = {
    orders: record.orders.map((o) => o.id).sort(),
    rx: record.prescriptions
      .filter(standing)
      .map((r) => r.id)
      .sort(),
    meds: record.medicines.map((m) => `${m.id}:${m.answer}`).sort(),
  };
  return hashString(JSON.stringify([rest, placed]));
}

export type PlanStatus =
  | { kind: "todo"; count: number }
  | { kind: "ready" }
  | { kind: "done"; by: string; at: string };

export function planStatus(
  plan: PlanDraft,
  items: readonly ChecklistItem[],
  record: PlanRecord,
): PlanStatus {
  const open = items.filter((i) => !i.done).length;
  if (open) return { kind: "todo", count: open };
  if (plan.done && plan.done.hash === planFingerprint(plan, record))
    return { kind: "done", by: plan.done.by, at: plan.done.at };
  return { kind: "ready" };
}

export function statusWord(s: PlanStatus): string {
  if (s.kind === "todo") return `${s.count} to do before signing`;
  if (s.kind === "ready") return "Ready to mark done";
  return "Plan done";
}
