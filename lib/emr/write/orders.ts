import "server-only";

import type { ActionResult, WriteCtx } from "./context";
import type { EmrSurface } from "@/lib/emr/actor";
import type { EmrTx } from "@/lib/emr/db";
import type { OrderRecords, OrderStatus } from "@/lib/emr/orders";
import type { FactConcept } from "@/lib/facts/types";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { z } from "zod";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { staffAffiliations } from "@/db/schema/clinician-profiles";
import {
  conditions,
  diagnosticReports,
  encounterOrderEvents,
  resultAcknowledgements,
  specimenEvents,
  specimens,
  testCatalogue,
} from "@/db/schema/emr";
import { encounterOrders } from "@/db/schema/encounter";
import { encounters } from "@/db/schema/scheduling";
import { requireEmrActor } from "@/lib/emr/actor";
import { isOpen } from "@/lib/emr/encounter";
import { emrV1LiveFor } from "@/lib/emr/feature";
import { deriveOrderStatus, orderStatusText } from "@/lib/emr/orders";
import { CLERKING_CADRE_CODES } from "@/lib/encounter/access";
import { encrypt } from "@/lib/encryption";
import { sensitivityFor } from "@/lib/facts/project/shared";
import { actionError, EmrWriteError, stampActivity, withPatientWrite } from "./context";

/**
 * Orders (PROMPT §5.8, §8; HARMONISATION §2 R3). An events-lifecycle order row is immutable once
 * written; what happens to it afterwards is order events, specimens and report versions, and its
 * status is derived by lib/emr/orders.ts. Also home to what the orders/results/intents write paths
 * share: the cadre sets, the order and encounter lookups, the client-key replay and the action
 * runner.
 */

/* ─── Who may do what (D-EMR-16, gate-a-proposal §D) ─────────────── */
// Nurse and lab codes mirror NURSE_CADRE_CODES (lib/nurse/scope.ts) and LAB_TECH_CADRE_CODES
// (lib/lab-tech/scope.ts); those modules import the database client, which the PGlite lane cannot.
export const ORDERING_CADRES: readonly string[] = CLERKING_CADRE_CODES;
export const NURSE_CADRES: readonly string[] = ["NURSE", "MIDWIFE", "SPECIALIST_NURSE"];
export const LAB_CADRES: readonly string[] = ["LAB_TECH", "LAB_TECHNOLOGIST"];
export const COLLECTING_CADRES: readonly string[] = [
  ...ORDERING_CADRES,
  ...NURSE_CADRES,
  ...LAB_CADRES,
];

export function requireCadre(ctx: WriteCtx, allowed: readonly string[], act: string): void {
  if (!allowed.includes(ctx.actor.cadreCode))
    throw new EmrWriteError("forbidden", `Your cadre may not ${act}.`);
}

/* ─── Shared lookups ─────────────────────────────────────────────── */

export type OrderRow = typeof encounterOrders.$inferSelect;
export type TestRow = typeof testCatalogue.$inferSelect;

/** Client-key replay: the row this key already wrote for this patient, if any. */
export async function replayed(
  tx: EmrTx,
  table: PgTable & { id: AnyPgColumn; clientKey: AnyPgColumn; patientUserId: AnyPgColumn },
  clientKey: string,
  patientUserId: string,
): Promise<string | null> {
  const rows = (await tx
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.clientKey, clientKey), eq(table.patientUserId, patientUserId)))
    .limit(1)) as { id: string }[];
  return rows[0]?.id ?? null;
}

export async function openEncounter(
  ctx: WriteCtx,
  patientUserId: string,
  encounterId: string,
): Promise<{ id: string; departmentId: string | null }> {
  const [e] = await ctx.tx
    .select({ id: encounters.id, state: encounters.state, departmentId: encounters.departmentId })
    .from(encounters)
    .where(
      and(
        eq(encounters.id, encounterId),
        eq(encounters.patientUserId, patientUserId),
        eq(encounters.hospitalId, ctx.actor.hospitalId),
      ),
    );
  if (!e) throw new EmrWriteError("not_found", "Encounter not found for this patient here.");
  if (!isOpen(e)) throw new EmrWriteError("conflict", "The encounter is closed.");
  return e;
}

/** An events-lifecycle order of this patient at the actor's hospital. */
export async function loadOrder(
  ctx: WriteCtx,
  patientUserId: string,
  orderId: string,
): Promise<OrderRow> {
  const [o] = await ctx.tx.select().from(encounterOrders).where(eq(encounterOrders.id, orderId));
  if (
    !o ||
    o.lifecycle !== "events" ||
    o.patientUserId !== patientUserId ||
    o.hospitalId !== ctx.actor.hospitalId
  )
    throw new EmrWriteError("not_found", "Order not found for this patient here.");
  return o;
}

export async function loadTest(tx: EmrTx, testId: string | null): Promise<TestRow | null> {
  if (!testId) return null;
  const [t] = await tx.select().from(testCatalogue).where(eq(testCatalogue.id, testId));
  return t ?? null;
}

/** Everything deriveOrderStatus reads, for a set of orders. */
export async function loadOrderRecords(tx: EmrTx, orderIds: string[]): Promise<OrderRecords> {
  if (orderIds.length === 0) return {};
  const events = await tx
    .select()
    .from(encounterOrderEvents)
    .where(inArray(encounterOrderEvents.orderId, orderIds));
  const specs = await tx
    .select({ id: specimens.id, orderId: specimens.orderId, recordedAt: specimens.recordedAt })
    .from(specimens)
    .where(inArray(specimens.orderId, orderIds));
  const specimenEventRows = specs.length
    ? await tx
        .select()
        .from(specimenEvents)
        .where(
          inArray(
            specimenEvents.specimenId,
            specs.map((s) => s.id),
          ),
        )
    : [];
  const reports = await tx
    .select({
      id: diagnosticReports.id,
      logicalId: diagnosticReports.logicalId,
      version: diagnosticReports.version,
      status: diagnosticReports.status,
      recordedAt: diagnosticReports.recordedAt,
      orderId: diagnosticReports.orderId,
    })
    .from(diagnosticReports)
    .where(inArray(diagnosticReports.orderId, orderIds));
  const acks = reports.length
    ? await tx
        .select()
        .from(resultAcknowledgements)
        .where(
          inArray(
            resultAcknowledgements.reportId,
            reports.map((r) => r.id),
          ),
        )
    : [];
  return { events, specimens: specs, specimenEvents: specimenEventRows, reports, acks };
}

export async function orderStatus(tx: EmrTx, order: OrderRow): Promise<OrderStatus> {
  return deriveOrderStatus(order, await loadOrderRecords(tx, [order.id])).status;
}

export function statusConflict(status: OrderStatus, order: OrderRow, act: string): EmrWriteError {
  return new EmrWriteError(
    "conflict",
    `Cannot ${act}: the order is ${orderStatusText(status, order.kind).toLowerCase()}.`,
  );
}

/** Staff with an active clinical affiliation at this hospital (a forward or call target). */
export async function isHospitalStaff(ctx: WriteCtx, userId: string): Promise<boolean> {
  const [a] = await ctx.tx
    .select({ id: staffAffiliations.id })
    .from(staffAffiliations)
    .where(
      and(
        eq(staffAffiliations.userId, userId),
        eq(staffAffiliations.hospitalId, ctx.actor.hospitalId),
        inArray(staffAffiliations.state, ["active", "approved"]),
      ),
    )
    .limit(1);
  return Boolean(a);
}

/* ─── placeOrders ────────────────────────────────────────────────── */

export type IntentSource = "clinician" | "triage_recommendation" | "resus_handover";

export interface OrderLine {
  /** Idempotency key for this line: a replay returns the order it already placed. */
  clientKey: string;
  testId: string;
  priority: "routine" | "urgent" | "immediate";
  reasonConditionIds?: string[];
  reasonText?: string;
  intentSource?: IntentSource;
  sourceIntentId?: string;
}

export interface PlaceOrdersInput {
  patientUserId: string;
  encounterId: string;
  orders: OrderLine[];
}

export interface WriteResult {
  id: string;
  warnings?: string[];
}

/**
 * `propose`: write each line as a suggestion (a 'proposed' order event, PROMPT §5.12) instead of an
 * order. Proposing needs no ordering cadre: nothing is ordered until a clinician accepts it
 * (lib/emr/write/intents.ts).
 */
export async function placeOrders(
  ctx: WriteCtx,
  input: PlaceOrdersInput,
  opts: { propose?: boolean } = {},
): Promise<WriteResult & { orderIds: string[] }> {
  if (!opts.propose) requireCadre(ctx, ORDERING_CADRES, "place orders");
  if (input.orders.length === 0) throw new EmrWriteError("invalid", "Nothing to order.");
  const encounter = await openEncounter(ctx, input.patientUserId, input.encounterId);
  const { actor, tx, now } = ctx;
  const orderIds: string[] = [];
  const warnings: string[] = [];

  for (const line of input.orders) {
    const replay = await replayed(tx, encounterOrders, line.clientKey, input.patientUserId);
    if (replay) {
      orderIds.push(replay);
      continue;
    }
    const reasonIds = [...new Set(line.reasonConditionIds ?? [])];
    const reasonText = line.reasonText?.trim();
    if (reasonIds.length === 0 && !reasonText)
      throw new EmrWriteError("invalid", "A reason is required: a diagnosis or a short text.");

    const [test] = await tx
      .select()
      .from(testCatalogue)
      .where(
        and(
          eq(testCatalogue.id, line.testId),
          eq(testCatalogue.active, true),
          or(isNull(testCatalogue.hospitalId), eq(testCatalogue.hospitalId, actor.hospitalId)),
        ),
      );
    if (!test) throw new EmrWriteError("not_found", "That test is not on this hospital's menu.");

    // Sensitivity at insert (C9): a restricted component (HIV, TB…) or a restricted reason
    // diagnosis restricts the order itself.
    let restricted = test.components.some(
      (c) => sensitivityFor(c as FactConcept, null) === "restricted",
    );
    if (reasonIds.length) {
      const reasons = await tx
        .select({ id: conditions.id, sensitivity: conditions.sensitivity })
        .from(conditions)
        .where(
          and(inArray(conditions.id, reasonIds), eq(conditions.patientUserId, input.patientUserId)),
        );
      if (reasons.length !== reasonIds.length)
        throw new EmrWriteError("invalid", "A reason diagnosis is not on this patient's record.");
      restricted ||= reasons.some((r) => r.sensitivity === "restricted");
    }

    const [order] = await tx
      .insert(encounterOrders)
      .values({
        encounterId: encounter.id,
        patientUserId: input.patientUserId,
        kind: test.kind,
        text: test.display,
        authoredByUserId: actor.userId,
        lifecycle: "events",
        hospitalId: actor.hospitalId,
        testId: test.id,
        priority: line.priority,
        reasonConditionIds: reasonIds,
        reasonTextCiphertext: reasonText ? encrypt(reasonText) : null,
        fastingRequired: test.fastingRequired,
        requesterCadre: actor.cadreCode,
        performer: test.inHouse ? "in_house" : "external",
        intentSource: line.intentSource ?? "clinician",
        sourceIntentId: line.sourceIntentId ?? null,
        sensitivity: restricted ? "restricted" : "standard",
        clientKey: line.clientKey,
        effectiveAt: now,
      })
      .returning({ id: encounterOrders.id });
    await tx.insert(encounterOrderEvents).values({
      orderId: order!.id,
      hospitalId: actor.hospitalId,
      patientUserId: input.patientUserId,
      kind: opts.propose ? "proposed" : "placed",
      actorUserId: actor.userId,
      actorCadre: actor.cadreCode,
      recordedAt: now,
    });
    // D-EMR-12: ionising imaging prompts for pregnancy status; it never blocks.
    if (test.ionising && !opts.propose)
      warnings.push(`${test.display} uses ionising radiation: check pregnancy status.`);
    orderIds.push(order!.id);
  }

  await stampActivity(ctx, encounter.id);
  return { id: orderIds[0]!, orderIds, warnings };
}

/* ─── cancelOrder ────────────────────────────────────────────────── */

export interface CancelOrderInput {
  patientUserId: string;
  orderId: string;
  reasonCode?: string;
  reasonText?: string;
  clientKey: string;
}

const CANCELLABLE: readonly OrderStatus["state"][] = [
  "proposed",
  "active",
  "on_hold",
  "collected",
  "in_progress",
];

export async function cancelOrder(ctx: WriteCtx, input: CancelOrderInput): Promise<WriteResult> {
  requireCadre(ctx, ORDERING_CADRES, "cancel orders");
  const replay = await replayed(ctx.tx, encounterOrderEvents, input.clientKey, input.patientUserId);
  if (replay) return { id: replay };
  const reasonText = input.reasonText?.trim();
  if (!input.reasonCode && !reasonText)
    throw new EmrWriteError("invalid", "A reason is required to cancel an order.");
  const order = await loadOrder(ctx, input.patientUserId, input.orderId);
  const status = await orderStatus(ctx.tx, order);
  // A result is never hidden by a cancel (lib/emr/orders.ts): once resulted, it stays.
  if (!CANCELLABLE.includes(status.state)) throw statusConflict(status, order, "cancel");
  const [e] = await ctx.tx
    .insert(encounterOrderEvents)
    .values({
      orderId: order.id,
      hospitalId: ctx.actor.hospitalId,
      patientUserId: input.patientUserId,
      kind: "cancelled",
      actorUserId: ctx.actor.userId,
      actorCadre: ctx.actor.cadreCode,
      reasonCode: input.reasonCode ?? null,
      reasonCiphertext: reasonText ? encrypt(reasonText) : null,
      recordedAt: ctx.now,
      clientKey: input.clientKey,
    })
    .returning({ id: encounterOrderEvents.id });
  await stampActivity(ctx, order.encounterId);
  return { id: e!.id };
}

/* ─── The action runner (PROMPT §8) ──────────────────────────────── */

/** Postgres 23505, bare or wrapped in Drizzle's DrizzleQueryError (`cause`). */
const isUniqueViolation = (e: unknown): boolean =>
  typeof e === "object" &&
  e !== null &&
  (("code" in e && e.code === "23505") || ("cause" in e && isUniqueViolation(e.cause)));

/**
 * Zod → requireEmrActor → EMR_V1 for the hospital → one transaction with the access check →
 * the write function. A unique-key race on a client key (two submits in flight) is retried once:
 * the retry sees the committed row and replays it.
 */
export async function runEmrWrite<
  I extends { patientUserId: string; surface: EmrSurface },
  R extends WriteResult,
>(
  schema: z.ZodType<I>,
  raw: unknown,
  write: (ctx: WriteCtx, input: I) => Promise<R>,
): Promise<ActionResult<R>> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      code: "invalid",
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  const input = parsed.data;
  const actor = await requireEmrActor(input.surface);
  if (!emrV1LiveFor(actor.hospitalId))
    return { ok: false, code: "config", error: "The record is not switched on at this hospital." };
  const attempt = () => withPatientWrite(actor, input.patientUserId, (ctx) => write(ctx, input));
  try {
    let result: R;
    try {
      result = await attempt();
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      result = await attempt();
    }
    return {
      ok: true,
      id: result.id,
      serverTime: new Date().toISOString(),
      data: result,
      ...(result.warnings?.length ? { warnings: result.warnings } : {}),
    };
  } catch (e) {
    return actionError(e);
  }
}
