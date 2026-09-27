import "server-only";

import type { WriteCtx } from "./context";
import type { OrderLine, WriteResult } from "./orders";
import { and, eq } from "drizzle-orm";

import { encounterOrderEvents } from "@/db/schema/emr";
import { encounterEvents, encounterOrders } from "@/db/schema/encounter";
import { triageRecords } from "@/db/schema/triage";
import { EmrWriteError, stampActivity } from "./context";
import {
  loadOrder,
  loadTest,
  openEncounter,
  ORDERING_CADRES,
  orderStatus,
  placeOrders,
  requireCadre,
  statusConflict,
} from "./orders";

/**
 * Triage suggestions in Plan (HARMONISATION §2 R4). lib/triage/recommend.ts suggests; nothing is
 * ordered until a clinician accepts. Accept places a real order that remembers where it came from
 * (`source_intent_id = '<triageRecordId>:<recommendation code>'`); dismiss records the decision on
 * the encounter timeline and orders nothing.
 *
 * ponytail: the recommendation code is checked for shape and the triage record for ownership, not
 * re-derived from the stored breakdown (recommend() needs the full TriageResult, which triage does
 * not persist). Re-derive here if triage starts storing it.
 *
 * The resus handover (PROMPT §5.12, A5) stores its suggestions as they are made: consumeResusHandoff
 * writes each outstanding test as a PROPOSED order (intent_source 'resus_handover'). Accept appends
 * 'placed' to that same order, which makes it active; dismiss appends 'dismissed'. Both are
 * idempotent: a second accept or dismiss returns the first.
 */

/** A proposed order on the encounter (the resus handover's suggestions). */
export interface ProposedRef {
  patientUserId: string;
  encounterId: string;
  proposedOrderId: string;
}
const isProposed = (x: object): x is ProposedRef => "proposedOrderId" in x;

/** The dismissal's reason code: the event needs one (eoe_reason); the clinician types none. */
export const DISMISSED_REASON = "suggestion_dismissed";

async function decideProposal(
  ctx: WriteCtx,
  ref: ProposedRef,
  kind: "placed" | "dismissed",
): Promise<WriteResult & { orderIds: string[] }> {
  requireCadre(ctx, ORDERING_CADRES, kind === "placed" ? "place orders" : "dismiss suggestions");
  await openEncounter(ctx, ref.patientUserId, ref.encounterId);
  const order = await loadOrder(ctx, ref.patientUserId, ref.proposedOrderId);
  if (order.encounterId !== ref.encounterId || order.intentSource !== "resus_handover")
    throw new EmrWriteError("not_found", "Suggestion not found on this encounter.");
  // One decision at a time on this suggestion (two devices, one click each).
  await ctx.tx
    .select({ id: encounterOrders.id })
    .from(encounterOrders)
    .where(eq(encounterOrders.id, order.id))
    .for("update");
  const [prior] = await ctx.tx
    .select({ id: encounterOrderEvents.id })
    .from(encounterOrderEvents)
    .where(and(eq(encounterOrderEvents.orderId, order.id), eq(encounterOrderEvents.kind, kind)))
    .limit(1);
  const done = { id: order.id, orderIds: [order.id] };
  if (prior) return done;
  const status = await orderStatus(ctx.tx, order);
  if (status.state !== "proposed")
    throw statusConflict(status, order, kind === "placed" ? "accept" : "dismiss");
  await ctx.tx.insert(encounterOrderEvents).values({
    orderId: order.id,
    hospitalId: ctx.actor.hospitalId,
    patientUserId: ref.patientUserId,
    kind,
    actorUserId: ctx.actor.userId,
    actorCadre: ctx.actor.cadreCode,
    reasonCode: kind === "dismissed" ? DISMISSED_REASON : null,
    recordedAt: ctx.now,
  });
  await stampActivity(ctx, order.encounterId);
  const test = kind === "placed" ? await loadTest(ctx.tx, order.testId) : null;
  // D-EMR-12, as placeOrders: ionising imaging prompts for pregnancy status; it never blocks.
  return test?.ionising
    ? { ...done, warnings: [`${test.display} uses ionising radiation: check pregnancy status.`] }
    : done;
}

export interface SuggestionRef {
  patientUserId: string;
  encounterId: string;
  triageRecordId: string;
  recommendationKey: string;
}

export const sourceIntentId = (s: Pick<SuggestionRef, "triageRecordId" | "recommendationKey">) =>
  `${s.triageRecordId}:${s.recommendationKey}`;

async function requireTriageRecord(ctx: WriteCtx, s: SuggestionRef): Promise<void> {
  const [t] = await ctx.tx
    .select({ id: triageRecords.id })
    .from(triageRecords)
    .where(
      and(
        eq(triageRecords.id, s.triageRecordId),
        eq(triageRecords.patientUserId, s.patientUserId),
        eq(triageRecords.hospitalId, ctx.actor.hospitalId),
      ),
    );
  if (!t) throw new EmrWriteError("not_found", "Triage record not found for this patient here.");
}

export async function acceptSuggestedOrder(
  ctx: WriteCtx,
  input:
    | (SuggestionRef & { order: Omit<OrderLine, "intentSource" | "sourceIntentId"> })
    | ProposedRef,
): Promise<WriteResult & { orderIds: string[] }> {
  if (isProposed(input)) return decideProposal(ctx, input, "placed");
  await requireTriageRecord(ctx, input);
  return placeOrders(ctx, {
    patientUserId: input.patientUserId,
    encounterId: input.encounterId,
    orders: [
      {
        ...input.order,
        intentSource: "triage_recommendation",
        sourceIntentId: sourceIntentId(input),
      },
    ],
  });
}

/** Idempotent on the suggestion itself: dismissing it twice returns the first dismissal. */
export async function dismissSuggestedOrder(
  ctx: WriteCtx,
  input: SuggestionRef | ProposedRef,
): Promise<WriteResult> {
  if (isProposed(input)) return decideProposal(ctx, input, "dismissed");
  requireCadre(ctx, ORDERING_CADRES, "dismiss suggestions");
  await openEncounter(ctx, input.patientUserId, input.encounterId);
  await requireTriageRecord(ctx, input);
  const label = `Suggestion dismissed: ${sourceIntentId(input)}`;
  const where = and(
    eq(encounterEvents.encounterId, input.encounterId),
    eq(encounterEvents.kind, "order"),
    eq(encounterEvents.refId, input.triageRecordId),
    eq(encounterEvents.label, label),
  );
  const [existing] = await ctx.tx
    .select({ id: encounterEvents.id })
    .from(encounterEvents)
    .where(where)
    .limit(1);
  if (existing) return { id: existing.id };
  const [e] = await ctx.tx
    .insert(encounterEvents)
    .values({
      encounterId: input.encounterId,
      kind: "order",
      refId: input.triageRecordId,
      label,
      actorUserId: ctx.actor.userId,
      recordedAt: ctx.now,
    })
    .returning({ id: encounterEvents.id });
  await stampActivity(ctx, input.encounterId);
  return { id: e!.id };
}
