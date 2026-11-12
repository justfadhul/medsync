import "server-only";

import { randomUUID } from "node:crypto";
import type { EmrDb, EmrTx } from "@/lib/emr/db";
import type { HandoverRow, PaymentStatus, SupplyRow } from "@/lib/pharmacy/supply/handover";
import type { SecondIdentifier } from "@/lib/pharmacy/supply/identity";
import type { PharmacyCtx, PharmacyNeed } from "@/lib/pharmacy/write";
import type { Authorisation, RepeatStatus } from "@/lib/prescribing/repeats";
import { and, desc, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import { z } from "zod";

import { NETWORK_UI } from "@/content/pharmacy-network";
import { IDENTITY_ROUTES } from "@/content/pharmacy-supply";
import {
  pharmacyAmsReviews,
  pharmacyReactionEvents,
  pharmacyReactionMedicines,
  pharmacyReactionReports,
} from "@/db/schema/pharmacy-clinical";
import {
  pharmacyBatches,
  pharmacyHandovers,
  pharmacyIdentityAttempts,
  pharmacyProducts,
  pharmacyStockMovements,
  pharmacySupplies,
  pharmacySupplyCorrections,
  pharmacySupplyReversals,
  prescriptionCancellations,
} from "@/db/schema/pharmacy-dispensing";
import {
  patientCollectors,
  pharmacyRefillEvents,
  pharmacyRefillRequestLines,
  pharmacyRefillRequests,
  pharmacyRepeatInstanceEvents,
  pharmacyRepeatInstances,
  prescriptionRenewalEvents,
  prescriptionRenewalRequests,
  prescriptionRepeatAuthorisations,
  prescriptionRepeatEvents,
} from "@/db/schema/pharmacy-network";
import { pharmacyLocations } from "@/db/schema/pharmacy-stores";
import { prescriptions } from "@/db/schema/prescribing";
import { EmrWriteError } from "@/lib/emr/write/context";
import { networkPack } from "@/lib/pharmacy/network-packs";
import {
  checkHoldLonger,
  handOverRefusals,
  planSetAside,
  preparedState,
  releaseLegs,
} from "@/lib/pharmacy/prepared";
import { phase3Block, planLine, refillLineState } from "@/lib/pharmacy/refills";
import { loadHospitalContext } from "@/lib/pharmacy/review/load";
import { localDate } from "@/lib/pharmacy/stock/ledger";
import { recalledAmong } from "@/lib/pharmacy/stores/recall-read";
import { balancesAt, batchRef, loadLocation, movePair } from "@/lib/pharmacy/stores/write";
import { signedCodes } from "@/lib/pharmacy/supply/store";
import { lockLine } from "@/lib/pharmacy/write";
import { repeatStatus } from "@/lib/prescribing/repeats";

/**
 * Refills at the hospital (Pharmacy Phase 4, Step 5; 5.5, Section 8: `requestRefill`, `setAsideRefill`,
 * `releasePrepared`, `holdPreparedLonger`, `handOverPrepared`, `askClinicToRenew`, `saveCollector`). Every write is
 * one transaction under the line locks (ADR 0265). Nothing here writes a prescription (Law 3); an instance closes
 * only by a hand-over, a release or a person (RF-5).
 *
 * The hand-over of a prepared refill writes Phase 1's rows (a hand-over, one supply per batch, one `supplied`
 * movement each), out of the `prepared` place (SA-1), and the instance's `supplied` event, which is what RP-4 counts.
 * It does not move the Phase 1 line machine: the first supply closed it, and each repeat lives on its instance.
 */

const fail = (code: ConstructorParameters<typeof EmrWriteError>[0], m: string) =>
  new EmrWriteError(code, m);
const W = NETWORK_UI.refills;

/** The writer: a pharmacy actor's transaction, or the patient's own (`asClinicalWriter` as the patient). */
export interface RefillWriter {
  tx: EmrTx;
  hospitalId: string;
  userId: string;
  cadre: string | null;
  now: Date;
}
export const writerOf = (ctx: PharmacyCtx): RefillWriter => ({
  tx: ctx.tx,
  hospitalId: ctx.actor.hospitalId,
  userId: ctx.actor.userId,
  cadre: ctx.actor.cadreName,
  now: ctx.now,
});
export const DISPENSE_POINT: PharmacyNeed = { permission: "pharmacy.dispense", point: "live" };
export const ASK_CLINIC: PharmacyNeed = {
  permission: ["pharmacy.dispense", "pharmacy.review"],
  point: "none",
};

/* ─── RP-6 from the record ───────────────────────────────────────────── */

export interface LineRepeat {
  status: RepeatStatus;
  authorisationId: string | null;
  /** Supplies so far against the repeats (RP-4). */
  used: number;
  /** The open instance, if one is (RI-1). */
  openInstanceId: string | null;
  lastSupplyOn: string | null;
  patientUserId: string;
  drugId: string;
  drugName: string;
}

/** RP-6 for each line, read now: the authorisation, its stop, the line's own state, the instances and supplies. */
export async function lineRepeats(
  tx: EmrTx | EmrDb,
  hospitalId: string,
  ids: readonly string[],
  today: string,
): Promise<Map<string, LineRepeat>> {
  if (!ids.length) return new Map();
  const list = [...ids];
  const [lines, auths, stops, cancels, renewed, instances, supplies, pack] = await Promise.all([
    tx
      .select({
        id: prescriptions.id,
        state: prescriptions.state,
        patientUserId: prescriptions.patientUserId,
        drugId: prescriptions.drugId,
        drugName: prescriptions.drugName,
      })
      .from(prescriptions)
      .where(and(eq(prescriptions.hospitalId, hospitalId), inArray(prescriptions.id, list))),
    tx
      .select()
      .from(prescriptionRepeatAuthorisations)
      .where(inArray(prescriptionRepeatAuthorisations.prescriptionId, list)),
    tx
      .select({ id: prescriptionRepeatEvents.authorisationId })
      .from(prescriptionRepeatEvents)
      .innerJoin(
        prescriptionRepeatAuthorisations,
        eq(prescriptionRepeatAuthorisations.id, prescriptionRepeatEvents.authorisationId),
      )
      .where(inArray(prescriptionRepeatAuthorisations.prescriptionId, list)),
    tx
      .select({
        id: prescriptionCancellations.prescriptionId,
        by: prescriptionCancellations.replacedByPrescriptionId,
      })
      .from(prescriptionCancellations)
      .where(inArray(prescriptionCancellations.prescriptionId, list)),
    tx
      .select({ id: prescriptionRenewalRequests.prescriptionId })
      .from(prescriptionRenewalEvents)
      .innerJoin(
        prescriptionRenewalRequests,
        eq(prescriptionRenewalRequests.id, prescriptionRenewalEvents.renewalId),
      )
      .where(
        and(
          inArray(prescriptionRenewalRequests.prescriptionId, list),
          eq(prescriptionRenewalEvents.kind, "renewed"),
        ),
      ),
    tx
      .select({
        id: pharmacyRepeatInstances.id,
        line: pharmacyRepeatInstances.prescriptionId,
        kind: pharmacyRepeatInstanceEvents.kind,
      })
      .from(pharmacyRepeatInstances)
      .leftJoin(
        pharmacyRepeatInstanceEvents,
        and(
          eq(pharmacyRepeatInstanceEvents.instanceId, pharmacyRepeatInstances.id),
          inArray(pharmacyRepeatInstanceEvents.kind, [
            "supplied",
            "released",
            "closed",
            "reopened",
          ]),
        ),
      )
      .where(inArray(pharmacyRepeatInstances.prescriptionId, list))
      .orderBy(desc(pharmacyRepeatInstanceEvents.at), desc(pharmacyRepeatInstanceEvents.id)),
    // A reversed or corrected supply does not count (Phase 1 B-20).
    tx
      .select({ line: pharmacySupplies.prescriptionId, at: pharmacySupplies.suppliedAt })
      .from(pharmacySupplies)
      .leftJoin(pharmacySupplyReversals, eq(pharmacySupplyReversals.supplyId, pharmacySupplies.id))
      .leftJoin(
        pharmacySupplyCorrections,
        eq(pharmacySupplyCorrections.supplyId, pharmacySupplies.id),
      )
      .where(
        and(
          inArray(pharmacySupplies.prescriptionId, list),
          isNull(pharmacySupplyReversals.id),
          isNull(pharmacySupplyCorrections.id),
        ),
      )
      .orderBy(desc(pharmacySupplies.suppliedAt)),
    networkPack(tx, hospitalId, "repeat_rules"),
  ]);
  const blocks = await blocksOf(tx, hospitalId, lines);
  // Each instance's latest closing event decides it (0230 `repeat_instance_open`).
  const latest = new Map<string, { line: string; kind: string | null }>();
  for (const i of instances)
    if (!latest.has(i.id)) latest.set(i.id, { line: i.line, kind: i.kind });
  const out = new Map<string, LineRepeat>();
  for (const l of lines) {
    const a = auths.find((x) => x.prescriptionId === l.id);
    const mine = [...latest].filter(([, v]) => v.line === l.id);
    const used = mine.filter(([, v]) => v.kind === "supplied").length;
    const open = mine.find(([, v]) => v.kind === null || v.kind === "reopened")?.[0] ?? null;
    const c = cancels.find((x) => x.id === l.id);
    const last = supplies.find((s) => s.line === l.id);
    const authorisation: Authorisation | null = a
      ? {
          furtherSupplies: a.furtherSupplies,
          minIntervalDays: a.minIntervalDays,
          notAfter: a.notAfter,
          reviewBy: a.reviewBy,
          lineVersionId: a.prescriptionId,
        }
      : null;
    const status = repeatStatus(
      {
        authorisation,
        line: {
          versionId: l.id,
          cancelled: l.state === "cancelled" && !c?.by,
          replaced: !!c?.by,
          renewed: renewed.some((r) => r.id === l.id),
        },
        stopped: !!a && stops.some((s) => s.id === a.id),
        instances: mine.map(([, v]) => ({ handedOver: v.kind === "supplied", reversed: false })),
        lastSupplyOn: last ? localDate(last.at) : null,
        blocked: blocks.get(l.id) ?? null,
        neverRepeat: !!pack?.content.neverRepeat.includes(l.drugId),
        toleranceDays: pack?.content.toleranceDays ?? 0,
      },
      today,
    );
    out.set(l.id, {
      status,
      authorisationId: a?.id ?? null,
      used,
      openInstanceId: open,
      lastSupplyOn: last ? localDate(last.at) : null,
      patientUserId: l.patientUserId,
      drugId: l.drugId,
      drugName: l.drugName,
    });
  }
  return out;
}

/**
 * RF-4 with Phase 3's records: a reaction report naming this medicine for the patient with no causality recorded yet,
 * or the line's latest stewardship review asking for a change or a stop. Either sends the line to the clinic.
 */
async function blocksOf(
  tx: EmrTx | EmrDb,
  hospitalId: string,
  lines: readonly { id: string; patientUserId: string; drugId: string }[],
) {
  if (!lines.length) return new Map<string, ReturnType<typeof phase3Block>>();
  const [reactions, reviews] = await Promise.all([
    tx
      .select({
        patient: pharmacyReactionReports.patientUserId,
        medicine: pharmacyReactionMedicines.medicineId,
      })
      .from(pharmacyReactionReports)
      .innerJoin(
        pharmacyReactionMedicines,
        eq(pharmacyReactionMedicines.reportId, pharmacyReactionReports.id),
      )
      .where(
        and(
          eq(pharmacyReactionReports.hospitalId, hospitalId),
          inArray(pharmacyReactionReports.patientUserId, [
            ...new Set(lines.map((l) => l.patientUserId)),
          ]),
          notExists(
            tx
              .select({ x: sql`1` })
              .from(pharmacyReactionEvents)
              .where(
                and(
                  eq(pharmacyReactionEvents.reportId, pharmacyReactionReports.id),
                  eq(pharmacyReactionEvents.kind, "causality"),
                ),
              ),
          ),
        ),
      ),
    tx
      .select({ line: pharmacyAmsReviews.prescriptionId, answer: pharmacyAmsReviews.answer })
      .from(pharmacyAmsReviews)
      .where(
        inArray(
          pharmacyAmsReviews.prescriptionId,
          lines.map((l) => l.id),
        ),
      )
      .orderBy(desc(pharmacyAmsReviews.reviewedAt)),
  ]);
  return new Map(
    lines.map((l) => {
      const review = reviews.find((r) => r.line === l.id);
      return [
        l.id,
        phase3Block({
          unconfirmedReaction: reactions.some(
            (r) => r.patient === l.patientUserId && r.medicine === l.drugId,
          ),
          openStewardshipReview: review?.answer === "change" || review?.answer === "stop",
        }),
      ];
    }),
  );
}

/* ─── requestRefill (RF-1, RF-2, RI-1) ───────────────────────────────── */

const key = z.uuid();
export const RequestRefillInput = z.object({
  clientKey: key,
  patientUserId: key,
  lineIds: z.array(key).min(1).max(20),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((s) => s || null),
  collector: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("self") }),
    z.object({ kind: z.literal("named"), collectorId: key }),
  ]),
  pointId: key,
});

/**
 * RF-2: each line goes where RP-6 sends it. Allowed opens (or joins) the line's one instance (RI-1, so an app and a
 * window request at once give one instance, S22b); too early is listed for the clinic with the date it becomes
 * possible (Law 4: never prepared early); anything else becomes a renewal request. A line whose own first supply is
 * still open is refused: it is not a refill.
 */
export async function requestRefill(
  w: RefillWriter,
  input: z.infer<typeof RequestRefillInput>,
  channel: "app" | "window" | "phone",
): Promise<{ id: string }> {
  const [done] = await w.tx
    .select({ id: pharmacyRefillRequests.id })
    .from(pharmacyRefillRequests)
    .where(eq(pharmacyRefillRequests.clientKey, input.clientKey));
  if (done) return done;
  const ids = [...new Set(input.lineIds)].sort();
  for (const id of ids) await lockLine(w.tx, id);
  const today = localDate(w.now);
  const repeats = await lineRepeats(w.tx, w.hospitalId, ids, today);
  if (ids.some((id) => repeats.get(id)?.patientUserId !== input.patientUserId))
    throw fail("not_found", W.notYours);
  const plans = ids.map((id) => ({
    id,
    r: repeats.get(id)!,
    plan: planLine(repeats.get(id)!.status),
  }));
  if (plans.some((p) => p.plan.to === "not_a_refill")) throw fail("conflict", W.firstSupplyOpen);
  if (input.collector.kind === "named") {
    const [c] = await w.tx
      .select({ id: patientCollectors.id })
      .from(patientCollectors)
      .where(
        and(
          eq(patientCollectors.id, input.collector.collectorId),
          eq(patientCollectors.patientUserId, input.patientUserId),
          isNull(patientCollectors.removedAt),
        ),
      );
    if (!c) throw fail("invalid", W.collectorGone);
  }
  const [req] = await w.tx
    .insert(pharmacyRefillRequests)
    .values({
      hospitalId: w.hospitalId,
      patientUserId: input.patientUserId,
      channel,
      recordedBy: channel === "app" ? null : w.userId,
      collector: input.collector.kind,
      collectorId: input.collector.kind === "named" ? input.collector.collectorId : null,
      placeKind: "point",
      dispensingPointId: input.pointId,
      note: input.note,
      requestedAt: w.now,
      clientKey: input.clientKey,
    })
    .returning({ id: pharmacyRefillRequests.id });
  const requestId = req!.id;
  const event = (
    lineId: string,
    kind: "to_prepare" | "needs_clinic",
    reasonCode: string | null = null,
    reasonNote: string | null = null,
  ) =>
    w.tx.insert(pharmacyRefillEvents).values({
      requestId,
      hospitalId: w.hospitalId,
      lineId,
      kind,
      reasonCode,
      reasonNote,
      actorUserId: w.userId,
      actorCadre: w.cadre,
      at: w.now,
    });
  for (const { id, r, plan } of plans) {
    const s = r.status;
    if (plan.to === "to_prepare" && plan.instance) {
      const instanceId =
        r.openInstanceId ??
        (
          await w.tx
            .insert(pharmacyRepeatInstances)
            .values({
              hospitalId: w.hospitalId,
              patientUserId: input.patientUserId,
              authorisationId: r.authorisationId!,
              prescriptionId: id,
              ordinal: r.used + 1,
              createdBy: w.userId,
              createdAt: w.now,
            })
            .returning({ id: pharmacyRepeatInstances.id })
        )[0]!.id;
      const [line] = await w.tx
        .insert(pharmacyRefillRequestLines)
        .values({
          requestId,
          hospitalId: w.hospitalId,
          prescriptionId: id,
          statusAtRequest: "allowed",
          instanceId,
        })
        .returning({ id: pharmacyRefillRequestLines.id });
      await event(line!.id, "to_prepare");
    } else if (plan.to === "to_prepare") {
      const [line] = await w.tx
        .insert(pharmacyRefillRequestLines)
        .values({
          requestId,
          hospitalId: w.hospitalId,
          prescriptionId: id,
          statusAtRequest: "too_early",
        })
        .returning({ id: pharmacyRefillRequestLines.id });
      await event(line!.id, "needs_clinic", "too_early", plan.from);
    } else if (plan.to === "needs_clinic") {
      const renewalId = await askRenewal(w, {
        patientUserId: input.patientUserId,
        prescriptionId: id,
        reason: plan.reason,
        blocked: plan.blocked,
        note: input.note,
        askedBy: channel === "app" ? "patient" : "pharmacy",
      });
      const [line] = await w.tx
        .insert(pharmacyRefillRequestLines)
        .values({
          requestId,
          hospitalId: w.hospitalId,
          prescriptionId: id,
          statusAtRequest: s.kind as
            | "none_left"
            | "expired"
            | "stopped"
            | "blocked"
            | "not_allowed",
          renewalId,
        })
        .returning({ id: pharmacyRefillRequestLines.id });
      await event(line!.id, "needs_clinic", plan.reason);
    }
  }
  return { id: requestId };
}

async function askRenewal(
  w: RefillWriter,
  r: {
    patientUserId: string;
    prescriptionId: string;
    reason: (typeof prescriptionRenewalRequests.$inferInsert)["reason"];
    blocked: (typeof prescriptionRenewalRequests.$inferInsert)["blockedReason"] | null;
    note: string | null;
    askedBy: "patient" | "pharmacy";
  },
): Promise<string> {
  const [row] = await w.tx
    .insert(prescriptionRenewalRequests)
    .values({
      hospitalId: w.hospitalId,
      patientUserId: r.patientUserId,
      prescriptionId: r.prescriptionId,
      reason: r.reason,
      blockedReason: r.blocked ?? null,
      note: r.note,
      askedBy: r.askedBy,
      askedByUserId: w.userId,
      askedAt: w.now,
    })
    .returning({ id: prescriptionRenewalRequests.id });
  return row!.id;
}

/* ─── askClinicToRenew (5.5) ─────────────────────────────────────────── */

export const AskClinicInput = z.object({
  clientKey: key,
  lineId: key,
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((s) => s || null),
});

/** 5.5 Ask the clinic: a renewal request with the pharmacist's note; one open request per line is enough. */
export async function askClinicToRenew(w: RefillWriter, input: z.infer<typeof AskClinicInput>) {
  await lockLine(w.tx, input.lineId);
  const r = (await lineRepeats(w.tx, w.hospitalId, [input.lineId], localDate(w.now))).get(
    input.lineId,
  );
  if (!r) throw fail("not_found", W.notHere);
  const [open] = await w.tx
    .select({ id: prescriptionRenewalRequests.id })
    .from(prescriptionRenewalRequests)
    .where(
      and(
        eq(prescriptionRenewalRequests.prescriptionId, input.lineId),
        notExists(
          w.tx
            .select({ x: sql`1` })
            .from(prescriptionRenewalEvents)
            .where(eq(prescriptionRenewalEvents.renewalId, prescriptionRenewalRequests.id)),
        ),
      ),
    );
  if (open) return { id: open.id };
  const id = await askRenewal(w, {
    patientUserId: r.patientUserId,
    prescriptionId: input.lineId,
    reason: r.status.kind === "too_early" ? "too_early" : "asked_by_pharmacy",
    blocked: null,
    note: input.note,
    askedBy: "pharmacy",
  });
  return { id };
}

/* ─── saveCollector (D-PH4-26) ───────────────────────────────────────── */

export const CollectorInput = z.object({
  name: z.string().trim().min(2).max(120),
  relationship: z.string().trim().min(2).max(80),
});

export async function saveCollector(
  w: RefillWriter,
  patientUserId: string,
  input: z.infer<typeof CollectorInput>,
) {
  const [row] = await w.tx
    .insert(patientCollectors)
    .values({
      patientUserId,
      name: input.name,
      relationship: input.relationship,
      savedBy: w.userId,
      savedAt: w.now,
    })
    .returning({ id: patientCollectors.id });
  return { id: row!.id };
}

/* ─── The refill line, locked ────────────────────────────────────────── */

async function refillLine(ctx: PharmacyCtx, lineId: string) {
  const [l] = await ctx.tx
    .select({
      id: pharmacyRefillRequestLines.id,
      requestId: pharmacyRefillRequestLines.requestId,
      prescriptionId: pharmacyRefillRequestLines.prescriptionId,
      instanceId: pharmacyRefillRequestLines.instanceId,
      patientUserId: pharmacyRefillRequests.patientUserId,
      pointId: pharmacyRefillRequests.dispensingPointId,
      collector: pharmacyRefillRequests.collector,
      collectorId: pharmacyRefillRequests.collectorId,
    })
    .from(pharmacyRefillRequestLines)
    .innerJoin(
      pharmacyRefillRequests,
      eq(pharmacyRefillRequests.id, pharmacyRefillRequestLines.requestId),
    )
    .where(
      and(
        eq(pharmacyRefillRequestLines.id, lineId),
        eq(pharmacyRefillRequestLines.hospitalId, ctx.actor.hospitalId),
      ),
    );
  if (!l) throw fail("not_found", W.notHere);
  await lockLine(ctx.tx, l.prescriptionId);
  const events = await ctx.tx
    .select({
      kind: pharmacyRefillEvents.kind,
      heldUntil: pharmacyRefillEvents.heldUntil,
      at: pharmacyRefillEvents.at,
    })
    .from(pharmacyRefillEvents)
    .where(eq(pharmacyRefillEvents.lineId, lineId))
    .orderBy(pharmacyRefillEvents.at, pharmacyRefillEvents.id);
  const prepared = events.find((e) => e.kind === "prepared");
  const held = events.filter((e) => e.heldUntil).at(-1);
  return {
    ...l,
    state: refillLineState(events),
    prepared: prepared
      ? {
          preparedOn: localDate(prepared.at),
          heldUntil: held!.heldUntil!,
          extensions: events.filter((e) => e.kind === "held_longer").length,
          released: events.some((e) => e.kind === "released"),
        }
      : null,
  };
}

async function preparedPlace(ctx: PharmacyCtx, pointId: string) {
  const [p] = await ctx.tx
    .select({ id: pharmacyLocations.id })
    .from(pharmacyLocations)
    .where(
      and(
        eq(pharmacyLocations.hospitalId, ctx.actor.hospitalId),
        eq(pharmacyLocations.kind, "prepared"),
        eq(pharmacyLocations.departmentId, pointId),
      ),
    );
  if (p) return p.id;
  const point = await loadLocation(ctx.tx, ctx.actor.hospitalId, pointId);
  const [row] = await ctx.tx
    .insert(pharmacyLocations)
    .values({
      hospitalId: ctx.actor.hospitalId,
      kind: "prepared",
      departmentId: pointId,
      name: `${NETWORK_UI.preparedPlace}, ${point.name}`.slice(0, 120),
      liveAt: ctx.now,
      createdBy: ctx.actor.userId,
    })
    .returning({ id: pharmacyLocations.id });
  return row!.id;
}

/** The units this refill line holds now, per prepared batch: its set-aside legs less its releases. A collected line
 * holds nothing, and nothing reads this after its hand-over. */
async function heldOf(ctx: PharmacyCtx, lineId: string, preparedId: string) {
  const rows = await ctx.tx
    .select({
      batchId: pharmacyStockMovements.batchId,
      n: sql<number>`sum(${pharmacyStockMovements.quantity})::int`,
    })
    .from(pharmacyStockMovements)
    .where(
      and(
        eq(pharmacyStockMovements.locationId, preparedId),
        eq(pharmacyStockMovements.sourceId, lineId),
      ),
    )
    .groupBy(pharmacyStockMovements.batchId);
  return new Map(rows.filter((r) => Number(r.n) > 0).map((r) => [r.batchId, Number(r.n)]));
}

/* ─── setAsideRefill (SA-1, D-PH4-06) ────────────────────────────────── */

export const SetAsideInput = z.object({
  clientKey: key,
  lineId: key,
  productId: key,
  quantity: z.number().int().positive().max(100_000),
});

/** 5.5 Set aside: the quantity moves to the point's `prepared` place, first expiry first; nothing is handed over. */
export async function setAsideRefill(ctx: PharmacyCtx, input: z.infer<typeof SetAsideInput>) {
  const l = await refillLine(ctx, input.lineId);
  if (l.state !== "to_prepare") throw fail("conflict", W.notToPrepare);
  if (l.pointId !== ctx.point!.id) throw fail("conflict", W.otherPoint);
  const pack = await networkPack(ctx.tx, ctx.actor.hospitalId, "hold_rules");
  const today = localDate(ctx.now);
  const r = (await lineRepeats(ctx.tx, ctx.actor.hospitalId, [l.prescriptionId], today)).get(
    l.prescriptionId,
  )!;
  if (r.status.kind !== "allowed") throw fail("conflict", W.notAllowedNow);
  const [product] = await ctx.tx
    .select({ medicineId: pharmacyProducts.medicineId })
    .from(pharmacyProducts)
    .where(
      and(
        eq(pharmacyProducts.id, input.productId),
        eq(pharmacyProducts.hospitalId, ctx.actor.hospitalId),
      ),
    );
  if (!product || product.medicineId !== r.drugId) throw fail("invalid", W.wrongProduct);
  const pointId = ctx.point!.id;
  const batches = await ctx.tx
    .select({
      id: pharmacyBatches.id,
      productId: pharmacyBatches.productId,
      batchNumber: pharmacyBatches.batchNumber,
      expiry: pharmacyBatches.expiry,
      expiryMonthOnly: pharmacyBatches.expiryMonthOnly,
    })
    .from(pharmacyBatches)
    .where(
      and(
        eq(pharmacyBatches.dispensingPointId, pointId),
        eq(pharmacyBatches.productId, input.productId),
      ),
    )
    .orderBy(pharmacyBatches.id)
    .for("update");
  const preparedId = await preparedPlace(ctx, pointId);
  const plan = planSetAside({
    pack: pack?.content ?? null,
    today,
    quantity: input.quantity,
    pointId,
    preparedId,
    batches: batches.map((b) => ({ ...b, pointId, medicineId: product.medicineId })),
    balances: await balancesAt(ctx.tx, pointId),
    blocked: await recalledAmong(
      ctx.tx,
      ctx.actor.hospitalId,
      batches.map((b) => b.id),
    ),
  });
  if (!plan.ok)
    throw fail(plan.reason === "unsigned" ? "config" : "conflict", W.setAside[plan.reason]);
  const point = await loadLocation(ctx.tx, ctx.actor.hospitalId, pointId);
  const prepared = await loadLocation(ctx.tx, ctx.actor.hospitalId, preparedId);
  for (const leg of plan.legs.filter((x) => x.kind === "set_aside_out"))
    await movePair(ctx.tx, {
      pair: "set_aside",
      hospitalId: ctx.actor.hospitalId,
      from: point,
      to: prepared,
      batch: await batchRef(ctx.tx, ctx.actor.hospitalId, leg.batchId, pointId),
      quantity: -leg.quantity,
      sourceId: l.id,
      actorUserId: ctx.actor.userId,
      effectiveAt: ctx.now,
    });
  const common = {
    hospitalId: ctx.actor.hospitalId,
    actorUserId: ctx.actor.userId,
    actorCadre: ctx.actor.cadreName,
    at: ctx.now,
  };
  await ctx.tx.insert(pharmacyRefillEvents).values({
    ...common,
    requestId: l.requestId,
    lineId: l.id,
    kind: "prepared",
    heldUntil: plan.heldUntil,
  });
  // D-PH4-21: whoever prepares the instance accepts it afresh; Phase 1's lanes still decide who may supply.
  await ctx.tx.insert(pharmacyRepeatInstanceEvents).values([
    { ...common, instanceId: l.instanceId!, kind: "accepted" },
    { ...common, instanceId: l.instanceId!, kind: "prepared" },
  ]);
  return { id: l.id, heldUntil: plan.heldUntil };
}

/* ─── releasePrepared and holdPreparedLonger (SA-3, Law 8) ───────────── */

export const ReleaseInput = z.object({
  clientKey: key,
  lineId: key,
  reasonCode: z.string().trim().min(2).max(60),
  note: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((s) => s || null),
});

/** Release to the shelf: every held unit goes back, by a person with a reason; the instance ends unsupplied. */
export async function releasePrepared(ctx: PharmacyCtx, input: z.infer<typeof ReleaseInput>) {
  const l = await refillLine(ctx, input.lineId);
  if (!l.prepared || l.prepared.released || l.state === "collected")
    throw fail("conflict", W.notHeld);
  const pointId = l.pointId!;
  const preparedId = await preparedPlace(ctx, pointId);
  const held = await heldOf(ctx, l.id, preparedId);
  const point = await loadLocation(ctx.tx, ctx.actor.hospitalId, pointId);
  const prepared = await loadLocation(ctx.tx, ctx.actor.hospitalId, preparedId);
  const legs = releaseLegs(
    [...held].map(([batchId, quantity]) => ({
      batchId,
      locationId: preparedId,
      kind: "set_aside_in" as const,
      quantity,
    })),
    pointId,
    preparedId,
  );
  for (const leg of legs.filter((x) => x.kind === "released_out"))
    await movePair(ctx.tx, {
      pair: "release",
      hospitalId: ctx.actor.hospitalId,
      from: prepared,
      to: point,
      batch: await batchRef(ctx.tx, ctx.actor.hospitalId, leg.batchId, preparedId),
      quantity: -leg.quantity,
      sourceId: l.id,
      actorUserId: ctx.actor.userId,
      effectiveAt: ctx.now,
      reasonCode: input.reasonCode,
      reasonNote: input.note,
    });
  const common = {
    hospitalId: ctx.actor.hospitalId,
    actorUserId: ctx.actor.userId,
    actorCadre: ctx.actor.cadreName,
    at: ctx.now,
    reasonCode: input.reasonCode,
    reasonNote: input.note,
  };
  await ctx.tx
    .insert(pharmacyRefillEvents)
    .values({ ...common, requestId: l.requestId, lineId: l.id, kind: "released" });
  await ctx.tx
    .insert(pharmacyRepeatInstanceEvents)
    .values({ ...common, instanceId: l.instanceId!, kind: "released" });
  return { id: l.id };
}

export const HoldLongerInput = z.object({
  clientKey: key,
  lineId: key,
  until: z.iso.date(),
  reasonCode: z.string().trim().min(2).max(60),
});

export async function holdPreparedLonger(ctx: PharmacyCtx, input: z.infer<typeof HoldLongerInput>) {
  const l = await refillLine(ctx, input.lineId);
  if (!l.prepared || l.state === "collected") throw fail("conflict", W.notHeld);
  const pack = await networkPack(ctx.tx, ctx.actor.hospitalId, "hold_rules");
  const refusal = checkHoldLonger(l.prepared, input.until, pack?.content ?? null);
  if (refusal) throw fail(refusal === "unsigned" ? "config" : "conflict", W.holdLonger[refusal]);
  await ctx.tx.insert(pharmacyRefillEvents).values({
    requestId: l.requestId,
    hospitalId: ctx.actor.hospitalId,
    lineId: l.id,
    kind: "held_longer",
    heldUntil: input.until,
    reasonCode: input.reasonCode,
    actorUserId: ctx.actor.userId,
    actorCadre: ctx.actor.cadreName,
    at: ctx.now,
  });
  return { id: l.id };
}

/* ─── handOverPrepared (SA-4, RP-4, Law 9) ───────────────────────────── */

export const HandOverInput = z.object({
  clientKey: key,
  lineIds: z.array(key).min(1).max(20),
  identity: z.discriminatedUnion("route", [
    z.object({ route: z.literal("two_identifiers"), nameAttested: z.literal(true) }),
    z.object({
      route: z.literal("identified_another_way"),
      nameAttested: z.literal(true),
      how: z.string().trim().min(2).max(60),
      note: z.string().trim().max(500).optional(),
    }),
  ]),
  payment: z.object({
    status: z.enum(["paid", "insured", "emergency", "not_recorded"]),
    detail: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((s) => s || null),
  }),
});

/**
 * 5.5 Hand over, from the prepared place: the second identifier matched on the server for this hand-over's key
 * (Phase 1 `checkSecondIdentifier`), or another way on the signed list; the request's collector; each line re-checked
 * now (SA-4: released, ended, no longer allowed, a batch expired or recalled), and every line or none.
 */
export async function handOverPrepared(ctx: PharmacyCtx, input: z.infer<typeof HandOverInput>) {
  const [done] = await ctx.tx
    .select({ id: pharmacyHandovers.id })
    .from(pharmacyHandovers)
    .where(
      and(
        eq(pharmacyHandovers.clientKey, input.clientKey),
        eq(pharmacyHandovers.hospitalId, ctx.actor.hospitalId),
      ),
    );
  if (done) return done;
  const hospitalId = ctx.actor.hospitalId;
  const lines = [];
  for (const id of [...new Set(input.lineIds)].sort()) lines.push(await refillLine(ctx, id));
  const first = lines[0]!;
  if (lines.some((l) => l.requestId !== first.requestId)) throw fail("invalid", W.oneRequest);
  if (first.pointId !== ctx.point!.id) throw fail("conflict", W.otherPoint);
  const today = localDate(ctx.now);
  const repeats = await lineRepeats(
    ctx.tx,
    hospitalId,
    lines.map((l) => l.prescriptionId),
    today,
  );
  const preparedId = await preparedPlace(ctx, first.pointId);
  const h = await loadHospitalContext(ctx.tx as unknown as EmrDb, hospitalId);
  if (h.settings.paymentStatusRequired && input.payment.status === "not_recorded")
    throw fail("invalid", W.payment);

  // Law 9: who is collecting and how they were identified.
  let secondIdentifier: SecondIdentifier | null = null;
  if (input.identity.route === "two_identifiers") {
    const [m] = await ctx.tx
      .select({ identifier: pharmacyIdentityAttempts.identifier })
      .from(pharmacyIdentityAttempts)
      .where(
        and(
          eq(pharmacyIdentityAttempts.hospitalId, hospitalId),
          eq(pharmacyIdentityAttempts.handoverKey, input.clientKey),
          eq(pharmacyIdentityAttempts.patientUserId, first.patientUserId),
          eq(pharmacyIdentityAttempts.outcome, "match"),
        ),
      )
      .limit(1);
    if (!m) throw fail("conflict", W.identity);
    secondIdentifier = m.identifier as SecondIdentifier;
  } else {
    const how = input.identity.how;
    const routes = await signedCodes(
      ctx.tx as unknown as EmrDb,
      hospitalId,
      "identity_routes",
      IDENTITY_ROUTES,
    );
    if (!routes?.items.some((r) => r.code === how)) throw fail("conflict", W.identityRoute);
  }
  const [collector] = first.collectorId
    ? await ctx.tx
        .select({ name: patientCollectors.name, relationship: patientCollectors.relationship })
        .from(patientCollectors)
        .where(eq(patientCollectors.id, first.collectorId))
    : [];

  type Held = {
    line: (typeof lines)[number];
    batches: {
      id: string;
      productId: string;
      expiry: string;
      expiryMonthOnly: boolean;
      quantity: number;
    }[];
  };
  const held: Held[] = [];
  for (const l of lines) {
    const units = await heldOf(ctx, l.id, preparedId);
    const batches = units.size
      ? await ctx.tx
          .select({
            id: pharmacyBatches.id,
            productId: pharmacyBatches.productId,
            expiry: pharmacyBatches.expiry,
            expiryMonthOnly: pharmacyBatches.expiryMonthOnly,
          })
          .from(pharmacyBatches)
          .where(inArray(pharmacyBatches.id, [...units.keys()]))
          .orderBy(pharmacyBatches.id)
          .for("update")
      : [];
    const refusals = l.prepared
      ? handOverRefusals({
          prepared: l.prepared,
          today,
          repeat: repeats.get(l.prescriptionId)!.status.kind,
          batches,
          blocked: await recalledAmong(
            ctx.tx,
            hospitalId,
            batches.map((b) => b.id),
          ),
        })
      : (["released"] as const);
    if (l.state === "collected" || !units.size || refusals.length)
      throw fail(
        "conflict",
        `${repeats.get(l.prescriptionId)?.drugName ?? ""}: ${W.handOver[refusals[0] ?? "released"]}`,
      );
    held.push({ line: l, batches: batches.map((b) => ({ ...b, quantity: units.get(b.id)! })) });
  }

  const products = await ctx.tx
    .select({
      id: pharmacyProducts.id,
      issueUnit: pharmacyProducts.issueUnit,
      strength: pharmacyProducts.strength,
      priceUgx: pharmacyProducts.priceUgx,
    })
    .from(pharmacyProducts)
    .where(
      inArray(pharmacyProducts.id, [
        ...new Set(held.flatMap((x) => x.batches.map((b) => b.productId))),
      ]),
    );
  const handoverId = randomUUID();
  const another = input.identity.route === "identified_another_way" ? input.identity : null;
  const handover: Omit<
    HandoverRow,
    "labelMode" | "labelsWrittenAttested" | "explainedAttested" | "counselling" | "language"
  > = {
    id: handoverId,
    hospitalId,
    dispensingPointId: first.pointId!,
    patientUserId: first.patientUserId,
    collector: collector ? "representative" : "patient",
    collectorName: collector?.name ?? null,
    collectorRelationship: collector?.relationship ?? null,
    collectorUserId: null,
    identityRoute: input.identity.route,
    secondIdentifier,
    identifiedHow: another?.how ?? null,
    identifiedNote: another?.note?.trim() || null,
    paymentStatus: input.payment.status as PaymentStatus,
    paymentDetail: input.payment.detail,
    actorUserId: ctx.actor.userId,
    actorCadre: ctx.actor.cadreName,
    clientKey: input.clientKey,
    enteredAfterDowntime: false,
    suppliedAt: ctx.now,
  };
  await ctx.tx.insert(pharmacyHandovers).values({
    ...handover,
    labelMode: ctx.point!.labelMode,
    labelsWrittenAttested: false,
    counselling: [],
    language: null,
    enteredAt: ctx.now,
  });
  const common = {
    hospitalId,
    actorUserId: ctx.actor.userId,
    actorCadre: ctx.actor.cadreName,
    at: ctx.now,
  };
  for (const { line, batches } of held) {
    const supplyIds: string[] = [];
    for (const b of batches) {
      const p = products.find((x) => x.id === b.productId)!;
      const supplyId = randomUUID();
      supplyIds.push(supplyId);
      const supply: SupplyRow = {
        id: supplyId,
        handoverId,
        hospitalId,
        dispensingPointId: first.pointId!,
        supplyingHospitalId: hospitalId,
        patientUserId: first.patientUserId,
        prescriptionId: line.prescriptionId,
        productId: b.productId,
        batchId: b.id,
        quantity: b.quantity,
        issueUnit: p.issueUnit,
        daysCovered: null,
        priceUgx: p.priceUgx,
        prescribedStrength: null,
        suppliedStrength: p.strength,
        substitutionReason: null,
        pharmacistLine: null,
        pharmacistLineBy: null,
        reviewEventId: null,
        batchChoiceReason: null,
        suppliedAt: ctx.now,
        enteredAfterDowntime: false,
      };
      await ctx.tx.insert(pharmacySupplies).values(supply);
      // SA-1: out of the prepared place (0231's Law 3 pair check knows it is this point's).
      await ctx.tx.insert(pharmacyStockMovements).values({
        hospitalId,
        locationId: preparedId,
        batchId: b.id,
        kind: "supplied",
        quantity: -b.quantity,
        effectiveAt: ctx.now,
        actorUserId: ctx.actor.userId,
        sourceKind: "supply",
        sourceId: supplyId,
      });
    }
    await ctx.tx.insert(pharmacyRepeatInstanceEvents).values({
      ...common,
      instanceId: line.instanceId!,
      kind: "supplied",
      supplyId: supplyIds[0]!,
    });
    await ctx.tx
      .insert(pharmacyRefillEvents)
      .values({ ...common, requestId: line.requestId, lineId: line.id, kind: "collected" });
  }
  return { id: handoverId };
}

/** SA-3: whether a prepared line is past its date (for the Not collected tab). */
export const isNotCollected = (
  p: { preparedOn: string; heldUntil: string; extensions: number; released: boolean },
  today: string,
) => preparedState(p, today) === "not_collected";
