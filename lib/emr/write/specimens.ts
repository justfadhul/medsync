import "server-only";

import type { WriteCtx } from "./context";
import type { WriteResult } from "./orders";
import { eq } from "drizzle-orm";

import { specimenEvents, specimens } from "@/db/schema/emr";
import { needsFastingChip } from "@/lib/emr/orders";
import { EmrWriteError, stampActivity } from "./context";
import {
  COLLECTING_CADRES,
  LAB_CADRES,
  loadOrder,
  loadTest,
  orderStatus,
  replayed,
  requireCadre,
  statusConflict,
} from "./orders";
import { withdrawPreliminary } from "./results";

/**
 * Specimens (PROMPT §5.8): collection at the bedside (two identifiers, the fasting chip, the
 * container, who collected it), receipt by the laboratory, and rejection, which returns the order
 * to "to collect" with the reason visible. Specimens and their events are insert-only.
 */

/** The values the specimens CHECKs accept (0071). The test menu also names `sputum`, which the
 *  table does not yet take: those collections are refused with a clear message, not a DB error. */
export const SPECIMEN_TYPES = [
  "venous_plasma",
  "venous_serum",
  "venous_whole_blood",
  "capillary_whole_blood",
  "arterial_blood",
  "urine_spot",
  "urine_first_morning",
  "urine_24h",
  "interstitial_fluid",
  "unknown",
] as const;
export const CONTAINERS = [
  "fluoride_oxalate",
  "serum_plain",
  "lithium_heparin",
  "edta",
  "capillary_direct",
  "unknown",
] as const;
export const REJECTION_REASONS = [
  "haemolysed",
  "clotted",
  "insufficient",
  "unlabelled_or_mislabelled",
  "wrong_container",
  "delayed",
] as const;

export interface CollectSpecimenInput {
  patientUserId: string;
  orderId: string;
  /** Two identifiers confirmed at the bedside; the table refuses anything else. */
  identifiersConfirmed: true;
  fastingState?: "fasting" | "non_fasting" | "unknown";
  fastingHours?: number;
  collectedAt?: Date;
  specimenType?: string;
  container?: string;
  labelNo?: string;
  clientKey: string;
}

export async function collectSpecimen(
  ctx: WriteCtx,
  input: CollectSpecimenInput,
): Promise<WriteResult> {
  requireCadre(ctx, COLLECTING_CADRES, "collect specimens");
  if (input.identifiersConfirmed !== true)
    throw new EmrWriteError("invalid", "Confirm two identifiers before collecting.");
  const replay = await replayed(ctx.tx, specimens, input.clientKey, input.patientUserId);
  if (replay) return { id: replay };
  const order = await loadOrder(ctx, input.patientUserId, input.orderId);
  if (order.kind !== "lab")
    throw new EmrWriteError("invalid", "Only laboratory orders take a specimen.");
  const status = await orderStatus(ctx.tx, order);
  // "To collect" is active, including after a rejection.
  if (status.state !== "active") throw statusConflict(status, order, "collect a specimen");
  const test = await loadTest(ctx.tx, order.testId);
  if (needsFastingChip(order, test) && !input.fastingState)
    throw new EmrWriteError(
      "invalid",
      "Record the fasting state: fasting, not fasting or not sure.",
    );
  const specimenType = input.specimenType ?? test?.specimenType;
  const container = input.container ?? test?.container;
  if (!specimenType || !container)
    throw new EmrWriteError("invalid", "Record the specimen type and the container.");
  if (!(SPECIMEN_TYPES as readonly string[]).includes(specimenType))
    throw new EmrWriteError(
      "config",
      `A ${specimenType} specimen cannot be recorded yet (the specimen list needs extending).`,
    );
  if (!(CONTAINERS as readonly string[]).includes(container))
    throw new EmrWriteError("invalid", `Unknown container ${container}.`);
  const collectedAt = input.collectedAt ?? ctx.now;
  if (collectedAt.getTime() > ctx.now.getTime())
    throw new EmrWriteError("invalid", "The collection time cannot be in the future.");

  const [s] = await ctx.tx
    .insert(specimens)
    .values({
      orderId: order.id,
      hospitalId: ctx.actor.hospitalId,
      patientUserId: input.patientUserId,
      specimenType,
      container,
      collectedAt,
      collectedByUserId: ctx.actor.userId,
      collectorCadre: ctx.actor.cadreCode,
      fastingState: input.fastingState ?? null,
      fastingHours: input.fastingHours === undefined ? null : String(input.fastingHours),
      identifiersConfirmed: true,
      labelNo: input.labelNo ?? null,
      recordedAt: ctx.now,
      clientKey: input.clientKey,
    })
    .returning({ id: specimens.id });
  await stampActivity(ctx, order.encounterId);
  return { id: s!.id };
}

/** The specimen with its order, checked to be this patient's here. */
async function specimenWithOrder(ctx: WriteCtx, patientUserId: string, specimenId: string) {
  const [s] = await ctx.tx.select().from(specimens).where(eq(specimens.id, specimenId));
  if (!s || s.patientUserId !== patientUserId || s.hospitalId !== ctx.actor.hospitalId)
    throw new EmrWriteError("not_found", "Specimen not found for this patient here.");
  const order = await loadOrder(ctx, patientUserId, s.orderId);
  return { specimen: s, order, status: await orderStatus(ctx.tx, order) };
}

export interface SpecimenActInput {
  patientUserId: string;
  specimenId: string;
  clientKey: string;
}

export async function receiveSpecimen(
  ctx: WriteCtx,
  input: SpecimenActInput,
): Promise<WriteResult> {
  requireCadre(ctx, LAB_CADRES, "receive specimens");
  const replay = await replayed(ctx.tx, specimenEvents, input.clientKey, input.patientUserId);
  if (replay) return { id: replay };
  const { specimen, order, status } = await specimenWithOrder(
    ctx,
    input.patientUserId,
    input.specimenId,
  );
  if (status.state !== "collected" || status.specimenId !== specimen.id)
    throw statusConflict(status, order, "receive this specimen");
  const [e] = await ctx.tx
    .insert(specimenEvents)
    .values({
      specimenId: specimen.id,
      hospitalId: ctx.actor.hospitalId,
      patientUserId: input.patientUserId,
      kind: "received",
      actorUserId: ctx.actor.userId,
      actorCadre: ctx.actor.cadreCode,
      recordedAt: ctx.now,
      clientKey: input.clientKey,
    })
    .returning({ id: specimenEvents.id });
  await stampActivity(ctx, order.encounterId);
  return { id: e!.id };
}

export async function rejectSpecimen(
  ctx: WriteCtx,
  input: SpecimenActInput & { reasonCode: (typeof REJECTION_REASONS)[number] },
): Promise<WriteResult> {
  requireCadre(ctx, LAB_CADRES, "reject specimens");
  const replay = await replayed(ctx.tx, specimenEvents, input.clientKey, input.patientUserId);
  if (replay) return { id: replay };
  const { specimen, order, status } = await specimenWithOrder(
    ctx,
    input.patientUserId,
    input.specimenId,
  );
  // Before release: awaiting receipt, received, or entered as a preliminary result on it.
  const onThis =
    ((status.state === "collected" || status.state === "in_progress") &&
      status.specimenId === specimen.id) ||
    (status.state === "resulted" && status.review === "not_released");
  if (!onThis) throw statusConflict(status, order, "reject this specimen");
  const [e] = await ctx.tx
    .insert(specimenEvents)
    .values({
      specimenId: specimen.id,
      hospitalId: ctx.actor.hospitalId,
      patientUserId: input.patientUserId,
      kind: "rejected",
      reasonCode: input.reasonCode,
      actorUserId: ctx.actor.userId,
      actorCadre: ctx.actor.cadreCode,
      recordedAt: ctx.now,
      clientKey: input.clientKey,
    })
    .returning({ id: specimenEvents.id });
  await withdrawPreliminary(ctx, input.patientUserId, order, specimen.id, input.reasonCode);
  await stampActivity(ctx, order.encounterId);
  return { id: e!.id };
}
