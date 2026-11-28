import "server-only";

import type { WriteCtx } from "./context";
import type { WriteResult } from "./orders";
import { and, eq } from "drizzle-orm";

import { nursingCareEvents, nursingCareProblems } from "@/db/schema/nursing-care";
import { EmrWriteError, stampActivity } from "./context";
import { NURSE_CADRES, openEncounter, replayed, requireCadre } from "./orders";

/**
 * The nursing care plan (ADR 0545 Phase 2, migration 0314). Append-only: a problem is added once with its items;
 * resolving or withdrawing it is a new row naming it; ticks, unticks and evaluations are new events.
 */
export const EVALUATIONS = ["met", "progressing", "not_met"] as const;
export type Evaluation = (typeof EVALUATIONS)[number];
const MAX_TEXT = 300;

const clean = (s: string | null | undefined, what: string, required = false): string | null => {
  const v = (s ?? "").trim();
  if (!v) {
    if (required) throw new EmrWriteError("invalid", `Write the ${what}.`);
    return null;
  }
  if (v.length > MAX_TEXT)
    throw new EmrWriteError("invalid", `Keep the ${what} under ${MAX_TEXT} characters.`);
  return v;
};

export interface AddProblemInput {
  patientUserId: string;
  encounterId: string;
  clientKey: string;
  problem: string;
  label?: string | null;
  relatedTo?: string | null;
  asShownBy?: string | null;
  goal: string;
  goalBy?: string | null;
  careItems: string[];
  libraryKey?: string | null;
}

export async function addCareProblem(ctx: WriteCtx, input: AddProblemInput): Promise<WriteResult> {
  requireCadre(ctx, NURSE_CADRES, "write a nursing care plan");
  const replay = await replayed(ctx.tx, nursingCareProblems, input.clientKey, input.patientUserId);
  if (replay) return { id: replay };
  const encounter = await openEncounter(ctx, input.patientUserId, input.encounterId);
  const items = input.careItems.map((x) => clean(x, "care item")).filter((x): x is string => !!x);
  if (!items.length)
    throw new EmrWriteError("invalid", "Add at least one thing the nurse will do.");
  if (items.length > 20) throw new EmrWriteError("invalid", "Keep it to 20 care items or fewer.");
  const [row] = await ctx.tx
    .insert(nursingCareProblems)
    .values({
      hospitalId: ctx.actor.hospitalId,
      patientUserId: input.patientUserId,
      encounterId: encounter.id,
      problem: clean(input.problem, "problem", true)!,
      label: clean(input.label, "nursing diagnosis"),
      relatedTo: clean(input.relatedTo, "cause"),
      asShownBy: clean(input.asShownBy, "signs"),
      goal: clean(input.goal, "goal", true)!,
      goalBy: clean(input.goalBy, "goal time"),
      careItems: items,
      libraryKey: input.libraryKey ?? null,
      recordedAt: ctx.now,
      recordedByUserId: ctx.actor.userId,
      clientKey: input.clientKey,
    })
    .returning({ id: nursingCareProblems.id });
  await stampActivity(ctx, encounter.id);
  return { id: row!.id };
}

async function liveProblem(ctx: WriteCtx, patientUserId: string, problemId: string) {
  const [p] = await ctx.tx
    .select()
    .from(nursingCareProblems)
    .where(
      and(
        eq(nursingCareProblems.id, problemId),
        eq(nursingCareProblems.patientUserId, patientUserId),
        eq(nursingCareProblems.hospitalId, ctx.actor.hospitalId),
      ),
    );
  if (!p || p.state !== "active")
    throw new EmrWriteError("not_found", "That problem is not on this care plan.");
  const [ended] = await ctx.tx
    .select({ id: nursingCareProblems.id })
    .from(nursingCareProblems)
    .where(eq(nursingCareProblems.replacesId, problemId));
  if (ended) throw new EmrWriteError("conflict", "That problem is already resolved or withdrawn.");
  return p;
}

export async function endCareProblem(
  ctx: WriteCtx,
  input: {
    patientUserId: string;
    problemId: string;
    clientKey: string;
    how: "resolved" | "entered_in_error";
    reason?: string | null;
  },
): Promise<WriteResult> {
  requireCadre(ctx, NURSE_CADRES, "change a nursing care plan");
  const replay = await replayed(ctx.tx, nursingCareProblems, input.clientKey, input.patientUserId);
  if (replay) return { id: replay };
  const p = await liveProblem(ctx, input.patientUserId, input.problemId);
  const reason = clean(input.reason, "reason", input.how === "entered_in_error");
  const [row] = await ctx.tx
    .insert(nursingCareProblems)
    .values({
      hospitalId: p.hospitalId,
      patientUserId: p.patientUserId,
      encounterId: p.encounterId,
      problem: p.problem,
      label: p.label,
      relatedTo: p.relatedTo,
      asShownBy: p.asShownBy,
      goal: p.goal,
      goalBy: p.goalBy,
      careItems: p.careItems,
      libraryKey: p.libraryKey,
      state: input.how,
      replacesId: p.id,
      reason,
      recordedAt: ctx.now,
      recordedByUserId: ctx.actor.userId,
      clientKey: input.clientKey,
    })
    .returning({ id: nursingCareProblems.id });
  await stampActivity(ctx, p.encounterId);
  return { id: row!.id };
}

export async function recordCareEvent(
  ctx: WriteCtx,
  input: {
    patientUserId: string;
    problemId: string;
    clientKey: string;
    kind: "tick" | "untick" | "evaluation";
    itemIndex?: number | null;
    evaluation?: Evaluation | null;
    note?: string | null;
  },
): Promise<WriteResult> {
  requireCadre(ctx, NURSE_CADRES, "tick nursing care");
  const replay = await replayed(ctx.tx, nursingCareEvents, input.clientKey, input.patientUserId);
  if (replay) return { id: replay };
  const p = await liveProblem(ctx, input.patientUserId, input.problemId);
  const isEval = input.kind === "evaluation";
  if (isEval && !input.evaluation)
    throw new EmrWriteError("invalid", "Choose met, progressing or not met.");
  if (
    !isEval &&
    (input.itemIndex == null || input.itemIndex < 0 || input.itemIndex >= p.careItems.length)
  )
    throw new EmrWriteError("invalid", "That care item is not on this problem.");
  const [row] = await ctx.tx
    .insert(nursingCareEvents)
    .values({
      hospitalId: p.hospitalId,
      patientUserId: p.patientUserId,
      problemId: p.id,
      kind: input.kind,
      itemIndex: isEval ? null : input.itemIndex!,
      evaluation: isEval ? input.evaluation! : null,
      note: clean(input.note, "note"),
      recordedAt: ctx.now,
      recordedByUserId: ctx.actor.userId,
      clientKey: input.clientKey,
    })
    .returning({ id: nursingCareEvents.id });
  await stampActivity(ctx, p.encounterId);
  return { id: row!.id };
}
