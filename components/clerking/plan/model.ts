import type { DxData } from "../use-catalogue";
import type { DeskPayload } from "@/components/emr/desk/model";
import type { Board } from "@/lib/clerking/impression/board";
import type { ChecklistItem, PlanStatus } from "@/lib/clerking/plan/checklist";
import type { PlanDraft } from "@/lib/clerking/plan/draft";
import type { News2Now, ObsRequirement } from "@/lib/clerking/plan/observations";
import type { PlanPayload } from "@/lib/clerking/plan/payload";
import type { ProblemCard } from "@/lib/clerking/plan/problems";
import type { PlanRecord } from "@/lib/clerking/plan/record";
import type { ChartOpening } from "@/lib/emr/charts/rules";
import type { NoteContent } from "@/lib/emr/note-rules";
import type { News2Result } from "@/lib/triage/types";

import { checklist, planFingerprint, planStatus } from "@/lib/clerking/plan/checklist";
import { composePlanLines } from "@/lib/clerking/plan/compose";
import { basketOf } from "@/lib/clerking/plan/draft";
import { requiredObservation } from "@/lib/clerking/plan/observations";
import { problemCards } from "@/lib/clerking/plan/problems";
import { chartsToOpen } from "@/lib/emr/charts/rules";
import { drugById } from "@/lib/prescribing/formulary";

/**
 * Step 10's pure view model (ADR 0184): the draft, the problem cards from the Impression board,
 * the record read back, the checklist and status, the note lines, and the charts the basket would
 * open. No React, no I/O.
 */

export interface PlanView {
  draft: PlanDraft;
  cards: ProblemCard[];
  record: PlanRecord;
  payload: PlanPayload;
  news2: News2Now | null;
  obsRequired: ObsRequirement | null;
  checklist: ChecklistItem[];
  status: PlanStatus;
  fingerprint: string;
  lines: string[];
  /** Charts that open when the basket is placed and are not open yet. */
  willOpen: ChartOpening[];
}

export function planDraftOf(c: NoteContent): PlanDraft {
  return (c.plan as PlanDraft | undefined) ?? {};
}

export function withPlan(c: NoteContent, d: PlanDraft, catalogueVersion: string): NoteContent {
  return {
    ...c,
    schema: 2,
    catalogueVersion,
    plan: d as unknown as NoteContent["plan"],
  };
}

export const news2Now = (n: News2Result | null): News2Now | null =>
  n ? { total: n.total, singleThree: n.hasSingleParameterThree, provisional: n.provisional } : null;

export function derivePlan(i: {
  p: DeskPayload;
  content: NoteContent;
  board: Board;
  dx: DxData | null;
  news2: News2Result | null;
}): PlanView | null {
  const payload = i.p.plan;
  if (!payload) return null;
  const draft = planDraftOf(i.content);
  const cards = problemCards(i.board, {
    names: i.dx?.tests ?? {},
    uuids: i.dx?.testIds ?? {},
    specimens: i.dx?.specimens,
    today: payload.labToday,
  });
  const record = payload.record;
  const news2 = news2Now(i.news2);
  const obsRequired = requiredObservation(news2);
  const items = checklist({
    plan: draft,
    cards,
    record,
    obsRequired,
    notNeededOption: !!payload.requests,
  });
  const basket = basketOf(draft);
  const open = new Set(record.charts.map((c) => c.kind));
  const willOpen = chartsToOpen({
    observationFrequency: draft.observations?.frequency ?? null,
    problems: cards.map((c) => ({ profileId: c.profileId, label: c.display })),
    items: [
      ...basket.orders.map((o) => ({
        type: "order" as const,
        id: o.clientKey,
        testKey: o.testKey,
        frequency: o.frequency,
        label: o.display,
      })),
      ...basket.prescriptions.map((r) => ({
        type: "prescription" as const,
        id: r.clientKey,
        drugId: r.drugId,
        classId: drugById(r.drugId)?.class ?? "",
        kind: r.kind,
        label: r.display,
      })),
    ],
    news2AtClerking: null,
  }).filter((o) => !open.has(o.kind));
  return {
    draft,
    cards,
    record,
    payload,
    news2,
    obsRequired,
    checklist: items,
    status: planStatus(draft, items, record),
    fingerprint: planFingerprint(draft, record),
    lines: composePlanLines({
      plan: draft,
      cards,
      record,
      obsRequired,
      news2Total: news2?.total ?? null,
    }),
    willOpen,
  };
}
