"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { encounterEvents, encounterOrders, encounterResults } from "@/db/schema/encounter";
import { encounters } from "@/db/schema/scheduling";
import { labResultsLive } from "@/lib/encounter/feature";
import { requireLabTechScope } from "@/lib/lab-tech/scope";
import {
  deriveCriticalFlag,
  LabRejectSchema,
  LabReleaseSchema,
  LabResultEntrySchema,
} from "@/lib/lab/result-entry";
import { logger } from "@/lib/logger";
import { emrEnter, emrReject, emrRelease } from "./_lib/emr";

/**
 * Lab result entry / release / reject — privileged server actions.
 *
 * Mirrors the clerkship write precedent (requireXScope + the service-level
 * Drizzle db + an append-only encounterEvents audit row). Gated dark behind
 * labResultsLive() (LAB_RESULTS_LIVE=1 + migration 0050 applied). HARD invariant:
 * a result is ENTERED (qualityStatus 'entered', releasedAt null — NOT visible to
 * the clinician) until a DELIBERATE release sets qualityStatus 'released' +
 * releasedAt/By. No fabrication — every field is entered by the technologist;
 * the critical flag is computed (inert until CRITICAL_VALUES_CSO_SIGNED).
 */
export type LabActionResult = { ok: true; resultId?: string } | { ok: false; error: string };
/** Where EMR v1 is on, EMR-shaped calls return the EMR contract (id, serverTime, warnings). */
type EmrLabResult = NonNullable<Awaited<ReturnType<typeof emrEnter>>>;

async function viaEmr(r: EmrLabResult | null): Promise<EmrLabResult | null> {
  if (r?.ok) revalidatePath("/lab");
  return r;
}

/** Postgres unique-violation (SQLSTATE 23505) — the 0051 one-per-order backstop. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && e.code === "23505";
}

async function orderInHospital(orderId: string, hospitalId: string) {
  const [row] = await db
    .select({
      id: encounterOrders.id,
      encounterId: encounterOrders.encounterId,
      text: encounterOrders.text,
      loincCode: encounterOrders.loincCode,
      orderedBy: encounterOrders.authoredByUserId,
      hospitalId: encounters.hospitalId,
    })
    .from(encounterOrders)
    .innerJoin(encounters, eq(encounters.id, encounterOrders.encounterId))
    .where(eq(encounterOrders.id, orderId))
    .limit(1);
  if (!row || row.hospitalId !== hospitalId) return null;
  return row;
}

async function resultInHospital(resultId: string, hospitalId: string) {
  const [row] = await db
    .select({
      id: encounterResults.id,
      orderId: encounterResults.orderId,
      qualityStatus: encounterResults.qualityStatus,
      criticalFlag: encounterResults.criticalFlag,
      encounterId: encounterOrders.encounterId,
      text: encounterOrders.text,
      orderedBy: encounterOrders.authoredByUserId,
      hospitalId: encounters.hospitalId,
    })
    .from(encounterResults)
    .innerJoin(encounterOrders, eq(encounterOrders.id, encounterResults.orderId))
    .innerJoin(encounters, eq(encounters.id, encounterOrders.encounterId))
    .where(eq(encounterResults.id, resultId))
    .limit(1);
  if (!row || row.hospitalId !== hospitalId) return null;
  return row;
}

/** Enter (append) a result for an order — recorded as 'entered', NOT released. */
export async function enterLabResultAction(raw: unknown): Promise<LabActionResult | EmrLabResult> {
  const emr = await viaEmr(await emrEnter(raw));
  if (emr) return emr;
  if (!labResultsLive()) return { ok: false, error: "Lab results module is not active." };
  const scope = await requireLabTechScope();
  const parsed = LabResultEntrySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid result entry." };
  const input = parsed.data;

  const order = await orderInHospital(input.orderId, scope.hospitalId);
  if (!order) return { ok: false, error: "Order not found in your hospital." };

  const loinc = input.loincCode ?? order.loincCode ?? null;
  const criticalFlag = deriveCriticalFlag(input.value, loinc); // inert until CSO-signed

  try {
    // One result row per order: a released result is frozen (amendment is a
    // follow-up); an entered/rejected row is editable (re-entry / correction).
    const existing = await db
      .select({ id: encounterResults.id, qualityStatus: encounterResults.qualityStatus })
      .from(encounterResults)
      .where(eq(encounterResults.orderId, input.orderId));
    if (existing.some((r) => r.qualityStatus === "released")) {
      return { ok: false, error: "This order already has a released result." };
    }
    const editable = existing.find(
      (r) => r.qualityStatus === "entered" || r.qualityStatus === "rejected",
    );

    const fields = {
      value: input.value,
      unit: input.unit ?? null,
      loincCode: loinc,
      abnormalFlag: criticalFlag,
      specimenType: input.specimenType ?? null,
      specimenId: input.specimenId ?? null,
      specimenCollectedAt: input.specimenCollectedAtIso
        ? new Date(input.specimenCollectedAtIso)
        : null,
      referenceRangeText: input.referenceRangeText ?? null,
      criticalFlag,
      qualityStatus: "entered" as const,
      enteredByUserId: scope.userId,
      rejectionReason: null,
    };

    let resultId: string | undefined;
    if (editable) {
      await db.update(encounterResults).set(fields).where(eq(encounterResults.id, editable.id));
      resultId = editable.id;
    } else {
      try {
        const [row] = await db
          .insert(encounterResults)
          .values({ orderId: input.orderId, ...fields })
          .returning({ id: encounterResults.id });
        resultId = row?.id;
      } catch (e) {
        // Lost the select-then-insert race (0051's unique index fired): another
        // entry beat us in. Re-read the now-existing editable row and update it,
        // turning the race into a correction rather than an error.
        if (!isUniqueViolation(e)) throw e;
        const [other] = await db
          .select({ id: encounterResults.id, qualityStatus: encounterResults.qualityStatus })
          .from(encounterResults)
          .where(eq(encounterResults.orderId, input.orderId))
          .limit(1);
        if (!other || other.qualityStatus === "released") {
          return { ok: false, error: "This order already has a released result." };
        }
        await db.update(encounterResults).set(fields).where(eq(encounterResults.id, other.id));
        resultId = other.id;
      }
    }

    await db.insert(encounterEvents).values({
      encounterId: order.encounterId,
      kind: "result",
      refId: resultId ?? null,
      label: `Result ${editable ? "re-" : ""}entered (unreleased): ${order.text}`,
      actorUserId: scope.userId,
    });

    revalidatePath("/lab");
    return { ok: true, resultId };
  } catch (e) {
    logger.error("lab.enter_result.failed", { reason: String(e) });
    return { ok: false, error: "Could not save the result." };
  }
}

/** Deliberately release an entered result → visible to the clinician as final. */
export async function releaseLabResultAction(
  raw: unknown,
): Promise<LabActionResult | EmrLabResult> {
  const emr = await viaEmr(await emrRelease(raw));
  if (emr) return emr;
  if (!labResultsLive()) return { ok: false, error: "Lab results module is not active." };
  const scope = await requireLabTechScope();
  const parsed = LabReleaseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid release." };

  const result = await resultInHospital(parsed.data.resultId, scope.hospitalId);
  if (!result) return { ok: false, error: "Result not found in your hospital." };
  if (result.qualityStatus !== "entered")
    return { ok: false, error: "Only an entered result can be released." };

  try {
    await db
      .update(encounterResults)
      .set({ qualityStatus: "released", releasedAt: new Date(), releasedByUserId: scope.userId })
      .where(eq(encounterResults.id, result.id));

    await db
      .update(encounterOrders)
      .set({ status: "resulted" })
      .where(eq(encounterOrders.id, result.orderId));

    await db.insert(encounterEvents).values({
      encounterId: result.encounterId,
      kind: "result",
      refId: result.id,
      label: `Result released: ${result.text}`,
      actorUserId: scope.userId,
    });

    // Critical-value alert to the ordering clinician — INERT until the critical
    // list is CSO-signed (criticalFlag is null until then). The sa_notifications
    // fan-out (needs a new notification kind) is the documented follow-up.
    if (result.criticalFlag) {
      logger.warn("lab.critical_value.released", {
        resultId: result.id,
        flag: result.criticalFlag,
        orderingClinician: result.orderedBy,
        todo: "wire sa_notifications critical-value fan-out (needs a notification-kind migration)",
      });
    }

    revalidatePath("/lab");
    return { ok: true, resultId: result.id };
  } catch (e) {
    logger.error("lab.release_result.failed", { reason: String(e) });
    return { ok: false, error: "Could not release the result." };
  }
}

/** Reject an entered result (e.g. haemolysed specimen) with a reason. */
export async function rejectLabResultAction(raw: unknown): Promise<LabActionResult | EmrLabResult> {
  const emr = await viaEmr(await emrReject(raw));
  if (emr) return emr;
  if (!labResultsLive()) return { ok: false, error: "Lab results module is not active." };
  const scope = await requireLabTechScope();
  const parsed = LabRejectSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "A rejection reason is required." };

  const result = await resultInHospital(parsed.data.resultId, scope.hospitalId);
  if (!result) return { ok: false, error: "Result not found in your hospital." };
  if (result.qualityStatus === "released")
    return { ok: false, error: "A released result cannot be rejected." };

  try {
    await db
      .update(encounterResults)
      .set({ qualityStatus: "rejected", rejectionReason: parsed.data.reason })
      .where(eq(encounterResults.id, result.id));

    await db.insert(encounterEvents).values({
      encounterId: result.encounterId,
      kind: "result",
      refId: result.id,
      label: `Result rejected: ${result.text} — ${parsed.data.reason}`,
      actorUserId: scope.userId,
    });

    revalidatePath("/lab");
    return { ok: true, resultId: result.id };
  } catch (e) {
    logger.error("lab.reject_result.failed", { reason: String(e) });
    return { ok: false, error: "Could not reject the result." };
  }
}
