import { randomUUID } from "node:crypto";
import type { HandoverFacts, HandoverPlan, LineFacts, PaymentStatus } from "./handover";
import type { SecondIdentifier } from "./identity";
import type { SupplyRef } from "./reversal";
import type { EmrDb } from "@/lib/emr/db";
import type { PharmacyAccess, PharmacyPermission } from "@/lib/pharmacy/access";
import type { LineEventKind, PharmacyLineEvent } from "@/lib/pharmacy/lines";
import type { Group, GroupLine } from "@/lib/pharmacy/review/load";
import type { PharmacyCtx, PharmacyNeed } from "@/lib/pharmacy/write";
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { REVIEW } from "@/content/pharmacy-review";
import { RX_CHECKS } from "@/content/pharmacy-rework-daily";
import {
  BATCH_CHOICE_REASONS,
  CORRECTION_REASONS,
  COUNSELLING_POINTS,
  IDENTITY_ROUTES,
  REVERSAL_REASONS,
  SUPPLY,
} from "@/content/pharmacy-supply";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { patientProfiles } from "@/db/schema/patient-profiles";
import {
  pharmacyBatches,
  pharmacyHandovers,
  pharmacyIdentityAttempts,
  pharmacyLegalAnswers,
  pharmacyLineEvents,
  pharmacyLookBacks,
  pharmacyPrintEvents,
  pharmacyProducts,
  pharmacySignedSets,
  pharmacyStockMovements,
  pharmacySupplies,
  pharmacySupplyCorrections,
  pharmacySupplyReversals,
} from "@/db/schema/pharmacy-dispensing";
import { prescriptions } from "@/db/schema/prescribing";
import { EmrWriteError } from "@/lib/emr/write/context";
import { blindIndex, decrypt } from "@/lib/encryption";
import { pharmacyCatalogueLiveFor } from "@/lib/pharmacy/feature";
import { withdrawListEntry, writeListEntries } from "@/lib/pharmacy/patient-list";
import { payFirstOn, priceFacts } from "@/lib/pharmacy/prices/store";
import { foldWith, loadGroupOfLine, loadHospitalContext } from "@/lib/pharmacy/review/load";
import { nudge } from "@/lib/pharmacy/review/store";
import { openChecksOnHandover } from "@/lib/pharmacy/rx-checks-store";
import { localDate } from "@/lib/pharmacy/stock/ledger";
import { recalledAmong } from "@/lib/pharmacy/stores/recall-read";
import { lockLine } from "@/lib/pharmacy/write";
import { DEFAULT_TIME_ZONE, startOfLocalDay } from "@/supabase/functions/_shared/slots";
import { handoverWrites } from "./handover";
import { attemptsLeft, compareSecondIdentifier, typedCheckClosed } from "./identity";
import { correctionAllowed, correctionWrites, reversalAllowed, reversalWrites } from "./reversal";

/**
 * Hand-over and supply, written (Pharmacy Phase 1, 5.6, 5.7.1, SU-1..SU-14, Law 3, Law 6, Law 11;
 * Section 8's Supply group; ADR 0265). Each write is `(ctx, input) => {id}` for `runPharmacyWrite`,
 * inside its one transaction. The engines decide (`handover.ts`, `identity.ts`, `reversal.ts`,
 * `lines.ts`); this file reads the facts under the locks and inserts exactly the rows they return.
 *
 * Locks (ADR 0265, gate-a-proposal §3.4): `lockLine` on every line of the prescription, in id order,
 * BEFORE its record is read; then every batch of the plan's products at the point `FOR UPDATE`, in id
 * order, before the balances are read. The 0124 guard locks the batch row again on each movement; the
 * 0126 trigger checks Law 3 at commit.
 *
 * Nothing here writes to `prescriptions` (Law 2). No stored date of birth or phone number leaves
 * `checkSecondIdentifier`: it answers match or mismatch and the attempts left, and logs the outcome only.
 */

export const DISPENSE_LIVE: PharmacyNeed = { permission: "pharmacy.dispense", point: "live" };
export const REVERSE_NEED: PharmacyNeed = {
  permission: ["pharmacy.manage", "pharmacy.review"],
  point: "live_or_was_live",
};
export const MANAGE_NEED: PharmacyNeed = {
  permission: "pharmacy.manage",
  point: "live_or_was_live",
};

/* ─── Inputs ──────────────────────────────────────────────────────────── */

const key = z.uuid();
const qty = z.number().int().positive().max(100_000);
const keys = <T extends Record<string, string>>(o: T) =>
  z.enum(Object.keys(o) as [keyof T & string, ...(keyof T & string)[]]);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((s) => (s ? s : null));

export const HandoverInput = z.object({
  clientKey: key,
  lines: z
    .array(
      z.object({
        lineId: key,
        productId: key,
        rows: z
          .array(z.object({ batchId: key, quantity: qty }))
          .min(1)
          .max(10),
        batchChoiceReason: keys(BATCH_CHOICE_REASONS).optional(),
        rest: z
          .object({
            outcome: z.enum(["owed", "buying_outside"]),
            quantityNotSupplied: qty.nullable().optional(),
            reasonCode: z.string().trim().max(60).optional(),
          })
          .optional(),
        strengthConfirmed: z.boolean().optional(),
        daysCovered: qty.optional(),
      }),
    )
    .min(1)
    .max(50),
  collector: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("patient") }),
    z.object({
      kind: z.literal("representative"),
      name: z.string().trim().min(2, SUPPLY.handover.name).max(120),
      relationship: z.string().trim().min(2, SUPPLY.handover.relationship).max(80),
    }),
    z.object({ kind: z.literal("ward_staff"), userId: key }),
  ]),
  identity: z.discriminatedUnion("route", [
    z.object({ route: z.literal("two_identifiers"), nameAttested: z.boolean() }),
    z.object({
      route: z.literal("identified_another_way"),
      nameAttested: z.boolean(),
      how: z.string().trim().min(2).max(60),
      note: z.string().trim().max(500).optional(),
    }),
    z.object({ route: z.literal("ward_staff") }),
  ]),
  labelsWrittenAttested: z.boolean().optional(),
  /** Kit F4: "I checked who they are, and explained how to take each medicine" (required under PRESCRIBE_V2). */
  explainedAttested: z.boolean().optional(),
  counselling: z.array(z.string().min(2).max(60)).max(20).default([]),
  language: z.string().trim().min(2).max(40).optional(),
  payment: z.object({
    status: z.enum(["paid", "exempt", "insured", "emergency", "not_recorded"]),
    detail: optText(200),
  }),
});

export const IdentifierInput = z.object({
  /** The hand-over's client key: the attempts are logged against it. */
  clientKey: key,
  lineId: key,
  kind: z.enum(["date_of_birth", "phone"]),
  typed: z.string().trim().min(1).max(40),
});

export const ReopenInput = z.object({ clientKey: key, lineId: key });

export const PrintInput = z
  .object({
    clientKey: key,
    handoverId: key,
    outcome: z.enum(["printed", "cancelled", "switched_to_hand"]).default("printed"),
    attested: z.boolean().optional(),
  })
  .refine((v) => v.outcome !== "switched_to_hand" || v.attested === true, {
    message: SUPPLY.handover.byHand,
    path: ["attested"],
  });

const otherNeedsNote = <T extends { reasonCode: string; note: string | null }>(v: T) =>
  v.reasonCode !== "other" || (v.note?.length ?? 0) >= 3;
const noteMessage = { message: "Say what happened.", path: ["note"] };

export const ReverseInput = z
  .object({
    clientKey: key,
    handoverId: key,
    lineId: key,
    reasonCode: keys(REVERSAL_REASONS),
    packFit: z.boolean(),
    note: optText(1000),
  })
  .refine(otherNeedsNote, noteMessage);

export const CorrectInput = z
  .object({
    clientKey: key,
    handoverId: key,
    lineId: key,
    reasonCode: keys(CORRECTION_REASONS),
    note: optText(1000),
  })
  .refine(otherNeedsNote, noteMessage);

/* ─── Shared ──────────────────────────────────────────────────────────── */

const conflict = (m: string) => new EmrWriteError("conflict", m);
const dbOf = (ctx: PharmacyCtx) => ctx.tx as unknown as EmrDb;
const uniq = <T>(xs: readonly T[]) => [...new Set(xs)];
const NOT_HERE = "That prescription is not at your hospital.";
const OUT_OF_SCOPE = "This prescription is not in the queue. Bring it into the queue first.";

/** The actor's permissions with `pharmacy.manage` added where the hub grants it (PA2-3). */
function accessOf(ctx: PharmacyCtx): PharmacyAccess {
  const p = new Set<PharmacyPermission>(ctx.actor.access.permissions);
  if (ctx.manages) p.add("pharmacy.manage");
  return { permissions: p };
}

/**
 * A signed list of a kind, or the drafted one outside production (Law 8: unsigned content never acts
 * in production; there the list is null and the rule that needs it refuses).
 */
export async function signedCodes(
  database: EmrDb,
  hospitalId: string,
  kind: "identity_routes" | "counselling_points",
  draft: Readonly<Record<string, string>>,
): Promise<{ items: { code: string; words: string }[]; signed: boolean } | null> {
  const [row] = await database
    .select({ content: pharmacySignedSets.content })
    .from(pharmacySignedSets)
    .where(
      and(
        eq(pharmacySignedSets.hospitalId, hospitalId),
        eq(pharmacySignedSets.kind, kind),
        eq(pharmacySignedSets.status, "signed"),
      ),
    )
    .limit(1);
  const items = (row?.content as { items?: unknown } | undefined)?.items;
  if (Array.isArray(items))
    return {
      signed: true,
      items: items.flatMap((i: unknown) => {
        const o = i as { code?: unknown; words?: unknown };
        return typeof o?.code === "string" && typeof o.words === "string"
          ? [{ code: o.code, words: o.words }]
          : [];
      }),
    };
  if (process.env.VERCEL_ENV === "production") return null;
  return {
    signed: false,
    items: Object.entries(draft).map(([code, words]) => ({ code, words })),
  };
}

/** ADR 0265: every line of the prescription locked in id order, then its record read under the locks. */
async function lockedGroup(ctx: PharmacyCtx, lineId: string, more: readonly string[] = []) {
  const h = await loadHospitalContext(dbOf(ctx), ctx.actor.hospitalId);
  const first = await loadGroupOfLine(dbOf(ctx), h, lineId);
  if (!first) throw new EmrWriteError("not_found", NOT_HERE);
  for (const id of uniq([...first.group.lines.map((l) => l.row.id), ...more]).sort())
    await lockLine(ctx.tx, id);
  const again = await loadGroupOfLine(dbOf(ctx), h, lineId);
  if (!again) throw new EmrWriteError("not_found", NOT_HERE);
  return { h, ...again };
}

/** The version the prescriber's changes lead to (H4), within the group. */
function currentVersion(group: Group, lineId: string): string {
  let cur = lineId;
  for (let i = 0; i < 50; i++) {
    const next = group.lines.find((l) => l.row.id === cur)?.replacedBy;
    if (!next) break;
    cur = next;
  }
  return cur;
}

/** LO-9: the quantity the staged decision of this version settled, where one was saved. */
function decidedOf(line: GroupLine): number | null {
  const d = [...line.events].reverse().find((e) => e.kind === "decision_saved")?.decision as
    | { quantity?: unknown; notSupplied?: unknown }
    | undefined;
  if (typeof d?.quantity !== "number") return null;
  return d.quantity + (typeof d.notSupplied === "number" ? d.notSupplied : 0);
}

const cosignOf = (line: GroupLine): LineFacts["cosign"] => line.input.cosign;

export interface HandoverOutcome {
  lineId: string;
  kind: LineEventKind;
  quantitySupplied: number | null;
  quantityNotSupplied: number | null;
}

async function outcomesOf(ctx: PharmacyCtx, handoverId: string): Promise<HandoverOutcome[]> {
  return ctx.tx
    .select({
      lineId: pharmacyLineEvents.prescriptionId,
      kind: sql<LineEventKind>`${pharmacyLineEvents.kind}`,
      quantitySupplied: pharmacyLineEvents.quantitySupplied,
      quantityNotSupplied: pharmacyLineEvents.quantityNotSupplied,
    })
    .from(pharmacyLineEvents)
    .where(
      and(
        eq(pharmacyLineEvents.handoverId, handoverId),
        eq(pharmacyLineEvents.hospitalId, ctx.actor.hospitalId),
      ),
    );
}

/* ─── recordHandover (SU-1, SU-2, SU-10, SU-12) ───────────────────────── */

/** SU-10: the hand-over this client key already recorded, with its outcomes; null when there is none. */
export async function recordHandoverIfDone(
  ctx: PharmacyCtx,
  clientKey: string,
): Promise<{ id: string; lines: HandoverOutcome[] } | null> {
  const [done] = await ctx.tx
    .select({ id: pharmacyHandovers.id })
    .from(pharmacyHandovers)
    .where(
      and(
        eq(pharmacyHandovers.clientKey, clientKey),
        eq(pharmacyHandovers.hospitalId, ctx.actor.hospitalId),
      ),
    );
  return done ? { id: done.id, lines: await outcomesOf(ctx, done.id) } : null;
}

export async function recordHandover(
  ctx: PharmacyCtx,
  input: z.infer<typeof HandoverInput>,
  /** CD-2: set only by `recordControlledSupply`, once its own checks have passed in this transaction. */
  controlled: { witnessAttestationId: string } | null = null,
  /** ML-1: `pharmacyPatientList` for the hospital, decided by the action (the store reads no environment);
   *  kit F4: `explainRequired` where PRESCRIBE_V2 is on. */
  list: { patientList: boolean; explainRequired?: boolean } = { patientList: false },
): Promise<{ id: string; lines: HandoverOutcome[] }> {
  const hospitalId = ctx.actor.hospitalId;
  const point = ctx.point!;
  // SU-10: a repeat of this key returns the hand-over already recorded.
  const done = await recordHandoverIfDone(ctx, input.clientKey);
  if (done) return done;

  const lineIds = input.lines.map((l) => l.lineId);
  const { h, group } = await lockedGroup(ctx, lineIds[0]!, lineIds);
  if (group.scope === "out") throw conflict(OUT_OF_SCOPE);
  if (group.scope === "review_only") throw conflict(REVIEW.review.ward);
  const lineOf = new Map(group.lines.map((l) => [l.row.id, l]));
  if (lineIds.some((id) => !lineOf.has(id)))
    throw new EmrWriteError("invalid", "Each line must be of this prescription.");
  // Rework test 8: every check flag on a line being given is answered first.
  const open = await openChecksOnHandover(ctx.tx, hospitalId, group.lines, lineIds);
  if (open.length)
    throw conflict(
      RX_CHECKS.refused.open.replace("{titles}", [...new Set(open.map((f) => f.title))].join(", ")),
    );
  // A controlled line is refused by the re-check unless the controlled supply cleared it (CD-1, CD-2).
  if (input.payment.status === "exempt") throw conflict(REVIEW.review.exemptUnsigned);

  // The batches of every product in the plan, at this point, locked in id order; then their balances.
  const productIds = uniq(input.lines.map((l) => l.productId));
  const [products, batches] = await Promise.all([
    ctx.tx
      .select({
        id: pharmacyProducts.id,
        medicineId: pharmacyProducts.medicineId,
        strength: pharmacyProducts.strength,
        issueUnit: pharmacyProducts.issueUnit,
        priceUgx: pharmacyProducts.priceUgx,
      })
      .from(pharmacyProducts)
      .where(
        and(eq(pharmacyProducts.hospitalId, hospitalId), inArray(pharmacyProducts.id, productIds)),
      ),
    ctx.tx
      .select({
        id: pharmacyBatches.id,
        pointId: sql<string>`${pharmacyBatches.dispensingPointId}`,
        productId: pharmacyBatches.productId,
        batchNumber: pharmacyBatches.batchNumber,
        expiry: pharmacyBatches.expiry,
        expiryMonthOnly: pharmacyBatches.expiryMonthOnly,
      })
      .from(pharmacyBatches)
      .where(
        and(
          eq(pharmacyBatches.hospitalId, hospitalId),
          eq(pharmacyBatches.dispensingPointId, point.id),
          inArray(pharmacyBatches.productId, productIds),
        ),
      )
      .orderBy(pharmacyBatches.id)
      .for("update"),
  ]);
  const batchIds = batches.map((b) => b.id);
  const sums = batchIds.length
    ? await ctx.tx
        .select({
          batchId: pharmacyStockMovements.batchId,
          n: sql<number>`coalesce(sum(${pharmacyStockMovements.quantity}), 0)::int`,
        })
        .from(pharmacyStockMovements)
        .where(inArray(pharmacyStockMovements.batchId, batchIds))
        .groupBy(pharmacyStockMovements.batchId)
    : [];

  const plannedIds = uniq(lineIds);
  const [legal, routes, matched, staff, supplied, counselling] = await Promise.all([
    ctx.tx
      .select({ id: pharmacyLegalAnswers.id })
      .from(pharmacyLegalAnswers)
      .where(
        and(
          eq(pharmacyLegalAnswers.question, 1),
          or(
            eq(pharmacyLegalAnswers.hospitalId, hospitalId),
            isNull(pharmacyLegalAnswers.hospitalId),
          ),
        ),
      )
      .limit(1),
    signedCodes(dbOf(ctx), hospitalId, "identity_routes", IDENTITY_ROUTES),
    ctx.tx
      .select({ identifier: pharmacyIdentityAttempts.identifier })
      .from(pharmacyIdentityAttempts)
      .where(
        and(
          eq(pharmacyIdentityAttempts.hospitalId, hospitalId),
          eq(pharmacyIdentityAttempts.handoverKey, input.clientKey),
          eq(pharmacyIdentityAttempts.patientUserId, group.patientUserId),
          eq(pharmacyIdentityAttempts.outcome, "match"),
        ),
      )
      .limit(1),
    input.collector.kind === "ward_staff"
      ? ctx.tx
          .select({ userId: staffAffiliations.userId })
          .from(staffAffiliations)
          .where(
            and(
              eq(staffAffiliations.userId, input.collector.userId),
              eq(staffAffiliations.hospitalId, hospitalId),
              inArray(staffAffiliations.state, ["active", "approved"]),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
    // B-20: where and when each line was last supplied (a reversed or corrected supply does not count).
    ctx.tx
      .select({
        prescriptionId: pharmacySupplies.prescriptionId,
        pointId: pharmacySupplies.dispensingPointId,
        at: pharmacySupplies.suppliedAt,
      })
      .from(pharmacySupplies)
      .leftJoin(pharmacySupplyReversals, eq(pharmacySupplyReversals.supplyId, pharmacySupplies.id))
      .leftJoin(
        pharmacySupplyCorrections,
        eq(pharmacySupplyCorrections.supplyId, pharmacySupplies.id),
      )
      .where(
        and(
          eq(pharmacySupplies.hospitalId, hospitalId),
          inArray(pharmacySupplies.prescriptionId, plannedIds),
          isNull(pharmacySupplyReversals.id),
          isNull(pharmacySupplyCorrections.id),
        ),
      )
      .orderBy(desc(pharmacySupplies.suppliedAt)),
    signedCodes(dbOf(ctx), hospitalId, "counselling_points", COUNSELLING_POINTS),
  ]);

  const lines = new Map<string, LineFacts>();
  for (const id of plannedIds) {
    const l = lineOf.get(id)!;
    const last = supplied.find((s) => s.prescriptionId === id);
    lines.set(id, {
      medicineId: l.row.drugId,
      medicineName: l.row.drugName,
      prescribedStrength: l.row.concentration,
      currentVersionId: currentVersion(group, id),
      changedAt: l.cancellationAt,
      cosign: cosignOf(l),
      state: l.row.state as LineFacts["state"],
      controlled: l.row.controlled,
      lane: group.lane.lane,
      status: l.status ?? { kind: "stage", stage: "to_review" },
      decided: decidedOf(l),
      reviewEvents: l.reviewEvents,
      lastSupply: last
        ? { pointName: h.points.find((p) => p.id === last.pointId)?.name ?? "", at: last.at }
        : null,
    });
  }
  // Catalogue slice Step 8 (ADR 0460): the price in force as the snapshot, per-point pay-first, Law 13.
  const priced = pharmacyCatalogueLiveFor(hospitalId)
    ? {
        prices: await priceFacts(ctx.tx, hospitalId, point.id, productIds, localDate(ctx.now)),
        payFirst: await payFirstOn(ctx.tx, hospitalId, point.id, localDate(ctx.now)),
      }
    : null;
  const facts: HandoverFacts = {
    today: localDate(ctx.now),
    pointLive: point.liveAt !== null && point.switchedOffAt === null,
    paymentRequired: priced?.payFirst ?? h.settings.paymentStatusRequired,
    admitted: priced !== null && group.origin === "ward",
    inpatientSupplyOn: h.settings.individualInpatientSupply,
    collectorIsHospitalStaff: staff.length > 0,
    supplyWithoutReview: {
      settingOn: h.settings.supplyWithoutPharmacist,
      legalQ1OnRecord: legal.length > 0,
    },
    strengthChangeSigned: false, // W4: no signed strength mapping between catalogue ids exists.
    identityRoutes: routes ? routes.items.map((r) => r.code) : null,
    secondIdentifierMatched: (matched[0]?.identifier as SecondIdentifier | undefined) ?? null,
    lines,
    products: new Map(products.map((p) => [p.id, { ...p, ...priced?.prices.get(p.id) }])),
    batches: batches.map((b) => ({
      ...b,
      medicineId: products.find((p) => p.id === b.productId)?.medicineId ?? "",
    })),
    balances: new Map(sums.map((s) => [s.batchId, Number(s.n)])),
    blocked: await recalledAmong(ctx.tx, hospitalId, batchIds),
    controlledCleared: controlled !== null,
    explainRequired: list.explainRequired === true,
  };
  const allowedPoints = new Set(counselling?.items.map((c) => c.code) ?? []);
  const plan: HandoverPlan = {
    clientKey: input.clientKey,
    hospitalId,
    pointId: point.id,
    patientUserId: group.patientUserId,
    actor: { userId: ctx.actor.userId, cadre: ctx.actor.cadreName, access: accessOf(ctx) },
    lines: input.lines.map((l) => ({
      lineId: l.lineId,
      productId: l.productId,
      rows: l.rows,
      batchChoiceReason: l.batchChoiceReason ?? null,
      rest: l.rest
        ? {
            outcome: l.rest.outcome,
            quantityNotSupplied: l.rest.quantityNotSupplied ?? null,
            reasonCode: l.rest.reasonCode ?? "",
          }
        : null,
      strengthChange: null,
      strengthConfirmed: l.strengthConfirmed === true,
      daysCovered: l.daysCovered ?? null,
    })),
    collector: input.collector,
    identity: input.identity,
    labelMode: point.labelMode,
    labelsWrittenAttested: input.labelsWrittenAttested === true,
    explainedAttested: input.explainedAttested === true,
    counselling: input.counselling.filter((c) => allowedPoints.has(c)),
    language: input.language ?? null,
    payment: { status: input.payment.status as PaymentStatus, detail: input.payment.detail },
    suppliedAt: ctx.now,
    witnessAttestationId: controlled?.witnessAttestationId ?? null,
  };

  const result = handoverWrites(plan, facts, randomUUID);
  if (!result.ok) throw conflict(uniq(result.refusals.map((r) => r.words)).join(" "));
  const w = result.writes;
  await ctx.tx.insert(pharmacyHandovers).values({ ...w.handover, enteredAt: ctx.now });
  await ctx.tx.insert(pharmacySupplies).values(w.supplies);
  await ctx.tx.insert(pharmacyStockMovements).values(w.movements);
  await ctx.tx.insert(pharmacyLineEvents).values(
    w.lineEvents.map((e) => ({
      ...e,
      laneReasons: group.lane.reasons,
      ruleVersion: group.lane.ruleVersion,
      occurredAt: ctx.now,
      effectiveAt: ctx.now,
    })),
  );
  if (w.lookBacks.length)
    await ctx.tx.insert(pharmacyLookBacks).values(w.lookBacks.map((l) => ({ ...l, at: ctx.now })));
  // ML-1, SU-1: the patient's list entries commit with the supply, or neither does.
  if (list.patientList)
    await writeListEntries(ctx.tx, {
      patientUserId: group.patientUserId,
      lineIds: uniq(w.supplies.map((s) => s.prescriptionId)),
      now: ctx.now,
    });
  return {
    id: w.handover.id,
    lines: w.lineEvents.map((e) => ({
      lineId: e.prescriptionId,
      kind: e.kind,
      quantitySupplied: e.quantitySupplied,
      quantityNotSupplied: e.quantityNotSupplied,
    })),
  };
}

/* ─── checkSecondIdentifier and reopenTypedCheck (SU-4, H5, Law 6) ─────── */

async function patientOfLine(ctx: PharmacyCtx, lineId: string): Promise<string> {
  const [rx] = await ctx.tx
    .select({ patientUserId: prescriptions.patientUserId })
    .from(prescriptions)
    .where(and(eq(prescriptions.id, lineId), eq(prescriptions.hospitalId, ctx.actor.hospitalId)));
  if (!rx) throw new EmrWriteError("not_found", NOT_HERE);
  return rx.patientUserId;
}

async function attemptsToday(ctx: PharmacyCtx, patientUserId: string) {
  return ctx.tx
    .select({
      outcome: pharmacyIdentityAttempts.outcome,
      attemptedAt: pharmacyIdentityAttempts.attemptedAt,
    })
    .from(pharmacyIdentityAttempts)
    .where(
      and(
        eq(pharmacyIdentityAttempts.hospitalId, ctx.actor.hospitalId),
        eq(pharmacyIdentityAttempts.patientUserId, patientUserId),
        gte(pharmacyIdentityAttempts.attemptedAt, startOfLocalDay(ctx.now, DEFAULT_TIME_ZONE)),
      ),
    );
}

const safeDecrypt = (c: string | null | undefined) => {
  if (!c) return null;
  try {
    return decrypt(c);
  } catch {
    return null;
  }
};

/**
 * SU-4: the typed date of birth or phone, compared on the server as the owner. The answer carries only
 * the outcome and the attempts left today; the attempt row stores the outcome only (never a value).
 * H5: the fifth wrong try for this patient today closes the typed check (a `closed` row).
 */
export async function checkSecondIdentifier(
  ctx: PharmacyCtx,
  input: z.infer<typeof IdentifierInput>,
): Promise<{ id: string; result: "match" | "mismatch" | "closed"; attemptsLeft: number }> {
  const patientUserId = await patientOfLine(ctx, input.lineId);
  const today = localDate(ctx.now);
  const before = await attemptsToday(ctx, patientUserId);
  if (typedCheckClosed(before, today))
    return { id: input.clientKey, result: "closed", attemptsLeft: 0 };
  const [stored] = await ctx.tx
    .select({
      dob: patientProfiles.dateOfBirth,
      phoneHmac: patientProfiles.phoneHmac,
      phoneEncrypted: patientProfiles.phoneEncrypted,
    })
    .from(patientProfiles)
    .where(eq(patientProfiles.id, patientUserId));
  const result = compareSecondIdentifier({
    kind: input.kind,
    typed: input.typed,
    storedDob: stored?.dob ? String(stored.dob) : null,
    phoneHmac: stored?.phoneHmac ?? null,
    blindIndex,
    decryptPhone: () => safeDecrypt(stored?.phoneEncrypted),
  });
  const base = {
    hospitalId: ctx.actor.hospitalId,
    patientUserId,
    handoverKey: input.clientKey,
    identifier: input.kind,
    actorUserId: ctx.actor.userId,
    attemptedAt: ctx.now,
  };
  const [row] = await ctx.tx
    .insert(pharmacyIdentityAttempts)
    .values({ ...base, outcome: result })
    .returning({ id: pharmacyIdentityAttempts.id });
  const left = attemptsLeft([...before, { outcome: result, attemptedAt: ctx.now }], today);
  if (result === "mismatch" && left === 0)
    await ctx.tx.insert(pharmacyIdentityAttempts).values({ ...base, outcome: "closed" });
  return { id: row!.id, result, attemptsLeft: left };
}

/** H5: the pharmacy in charge reopens a typed check closed today. */
export async function reopenTypedCheck(ctx: PharmacyCtx, input: z.infer<typeof ReopenInput>) {
  const patientUserId = await patientOfLine(ctx, input.lineId);
  if (!typedCheckClosed(await attemptsToday(ctx, patientUserId), localDate(ctx.now)))
    throw conflict(SUPPLY.refused.notClosed);
  const [row] = await ctx.tx
    .insert(pharmacyIdentityAttempts)
    .values({
      hospitalId: ctx.actor.hospitalId,
      patientUserId,
      handoverKey: input.clientKey,
      // ponytail: 0126 needs an identifier on every row; a reopening covers both, recorded as date_of_birth.
      identifier: "date_of_birth",
      outcome: "reopened",
      actorUserId: ctx.actor.userId,
      attemptedAt: ctx.now,
    })
    .returning({ id: pharmacyIdentityAttempts.id });
  return { id: row!.id };
}

/* ─── Labels (LB-4, SU-13) ────────────────────────────────────────────── */

async function handoverHere(ctx: PharmacyCtx, handoverId: string) {
  const [row] = await ctx.tx
    .select({
      id: pharmacyHandovers.id,
      pointId: pharmacyHandovers.dispensingPointId,
      suppliedAt: pharmacyHandovers.suppliedAt,
      enteredAt: pharmacyHandovers.enteredAt,
      enteredAfterDowntime: pharmacyHandovers.enteredAfterDowntime,
    })
    .from(pharmacyHandovers)
    .where(
      and(
        eq(pharmacyHandovers.id, handoverId),
        eq(pharmacyHandovers.hospitalId, ctx.actor.hospitalId),
      ),
    );
  if (!row) throw new EmrWriteError("not_found", SUPPLY.refused.notHere);
  return row;
}

async function logPrint(
  ctx: PharmacyCtx,
  input: z.infer<typeof PrintInput>,
  kind: "label" | "label_reprint",
) {
  const [done] = await ctx.tx
    .select({ id: pharmacyPrintEvents.id })
    .from(pharmacyPrintEvents)
    .where(eq(pharmacyPrintEvents.id, input.clientKey));
  if (done) return { id: done.id };
  const h = await handoverHere(ctx, input.handoverId);
  const [{ n } = { n: 0 }] = await ctx.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(pharmacySupplies)
    .where(eq(pharmacySupplies.handoverId, h.id));
  const [row] = await ctx.tx
    .insert(pharmacyPrintEvents)
    .values({
      id: input.clientKey,
      hospitalId: ctx.actor.hospitalId,
      dispensingPointId: h.pointId,
      kind,
      refId: h.id,
      copies: Math.max(1, Number(n)),
      outcome: input.outcome,
      actorUserId: ctx.actor.userId,
      printedAt: ctx.now,
    })
    .returning({ id: pharmacyPrintEvents.id });
  return { id: row!.id };
}

/** LB-4: the first print of a hand-over's labels (or a cancelled print, or the switch to by hand). */
export const printLabels = (ctx: PharmacyCtx, input: z.infer<typeof PrintInput>) =>
  logPrint(ctx, input, "label");
/** LB-4: a reprint from Supplied today, logged with the actor. */
export const reprintLabels = (ctx: PharmacyCtx, input: z.infer<typeof PrintInput>) =>
  logPrint(ctx, input, "label_reprint");

/* ─── reverseSupply and correctSupplyRecord (SU-11, SU-14, 5.7.1) ──────── */

async function suppliesOf(ctx: PharmacyCtx, handoverId: string, lineId: string) {
  const rows = await ctx.tx
    .select({
      id: pharmacySupplies.id,
      handoverId: pharmacySupplies.handoverId,
      hospitalId: pharmacySupplies.hospitalId,
      dispensingPointId: pharmacySupplies.dispensingPointId,
      patientUserId: pharmacySupplies.patientUserId,
      prescriptionId: pharmacySupplies.prescriptionId,
      batchId: pharmacySupplies.batchId,
      quantity: pharmacySupplies.quantity,
      reversal: pharmacySupplyReversals.id,
      correction: pharmacySupplyCorrections.id,
    })
    .from(pharmacySupplies)
    .leftJoin(pharmacySupplyReversals, eq(pharmacySupplyReversals.supplyId, pharmacySupplies.id))
    .leftJoin(
      pharmacySupplyCorrections,
      eq(pharmacySupplyCorrections.supplyId, pharmacySupplies.id),
    )
    .where(
      and(
        eq(pharmacySupplies.handoverId, handoverId),
        eq(pharmacySupplies.prescriptionId, lineId),
        eq(pharmacySupplies.hospitalId, ctx.actor.hospitalId),
      ),
    );
  if (!rows.length) throw new EmrWriteError("not_found", SUPPLY.refused.notHere);
  return rows;
}

/** The line must go back to where it stood before this hand-over: it was the line's last one. */
async function lockedForReturn(
  ctx: PharmacyCtx,
  handoverId: string,
  lineId: string,
  reasonCode: string,
) {
  const { group, line } = await lockedGroup(ctx, lineId);
  const probe: PharmacyLineEvent = {
    id: "probe",
    kind: "returned",
    occurredAt: ctx.now,
    effectiveAt: ctx.now,
    lane: null,
    quantitySupplied: null,
    quantityNotSupplied: null,
    reasonCode,
    handoverId,
    actorCadre: null,
  };
  const after = foldWith(group, line, { events: [probe] });
  if (!line.status || JSON.stringify(after) === JSON.stringify(line.status))
    throw conflict(SUPPLY.refused.later);
  return { group, line };
}

// A partner supply (no batch, RT-5) moves no hospital stock, so it is never reversed or corrected here.
const refs = (rows: Awaited<ReturnType<typeof suppliesOf>>): SupplyRef[] =>
  rows
    .flatMap((r) => (r.batchId === null ? [] : [{ ...r, batchId: r.batchId }]))
    .map((r) => ({
      id: r.id,
      handoverId: r.handoverId,
      hospitalId: r.hospitalId,
      dispensingPointId: r.dispensingPointId,
      patientUserId: r.patientUserId,
      prescriptionId: r.prescriptionId,
      batchId: r.batchId,
      quantity: r.quantity,
    }));

const REFUSE = {
  not_today: SUPPLY.refused.notToday,
  not_permitted: SUPPLY.refused.permission,
  controlled_permission: SUPPLY.refused.controlledReverse,
  witness_needed: SUPPLY.refused.controlledReverse,
} as const;

/**
 * SU-11: a supply handed back the same day. The quantity returns to its batch; a pack that is not fit is
 * written off in the same step. The supply stays in the record; the line returns to where it stood.
 * Controlled: needs `pharmacy.controlled` and a witness (CD-5), through `controlled-store.ts`.
 */
export async function reverseSupply(
  ctx: PharmacyCtx,
  input: z.infer<typeof ReverseInput>,
  /** CD-5: a standing witness attestation, checked by `lib/pharmacy/controlled-store.ts`. */
  witness: string | null = null,
) {
  const rows = await suppliesOf(ctx, input.handoverId, input.lineId);
  const reversed = rows.find((r) => r.reversal);
  if (reversed) return { id: reversed.reversal! };
  if (rows.some((r) => r.correction)) throw conflict(SUPPLY.refused.done);
  const h = await handoverHere(ctx, input.handoverId);
  const { group, line } = await lockedForReturn(ctx, h.id, input.lineId, input.reasonCode);
  const allowed = reversalAllowed({
    suppliedLocalDay: localDate(h.suppliedAt),
    enteredAfterDowntime: h.enteredAfterDowntime,
    enteredLocalDay: localDate(h.enteredAt),
    today: localDate(ctx.now),
    actorHolds: accessOf(ctx),
    controlled: line.row.controlled,
    witness,
  });
  if (!allowed.ok) throw conflict(REFUSE[allowed.reason]);
  const w = reversalWrites({
    supplies: refs(rows),
    packFit: input.packFit,
    reasonCode: input.reasonCode,
    actor: { userId: ctx.actor.userId, cadre: ctx.actor.cadreName },
    witness,
    now: ctx.now,
    newId: randomUUID,
  });
  if (!w.ok) throw new EmrWriteError("invalid", SUPPLY.refused.notHere);
  await ctx.tx
    .insert(pharmacyStockMovements)
    .values(w.movements.map((m) => ({ ...m, reasonNote: input.note })));
  await ctx.tx.insert(pharmacySupplyReversals).values(w.reversals);
  await ctx.tx.insert(pharmacyLineEvents).values(
    w.lineEvents.map((e) => ({
      ...e,
      reasonNote: input.note,
      laneReasons: group.lane.reasons,
      ruleVersion: group.lane.ruleVersion,
      occurredAt: ctx.now,
      effectiveAt: ctx.now,
    })),
  );
  // ML-6: the patient's list entry is withdrawn in the same transaction.
  await withdrawListEntry(ctx.tx, {
    patientUserId: group.patientUserId,
    lineId: input.lineId,
    now: ctx.now,
  });
  await nudge(ctx, line.row.prescriberUserId, "supply_reversed", w.reversals[0]!.id);
  return { id: w.reversals[0]!.id };
}

/** SU-14: "recorded in error", on any day, by the pharmacy in charge. It moves no stock. */
export async function correctSupplyRecord(
  ctx: PharmacyCtx,
  input: z.infer<typeof CorrectInput>,
  witness: string | null = null,
) {
  const rows = await suppliesOf(ctx, input.handoverId, input.lineId);
  const corrected = rows.find((r) => r.correction);
  if (corrected) return { id: corrected.correction! };
  if (rows.some((r) => r.reversal)) throw conflict(SUPPLY.refused.done);
  const h = await handoverHere(ctx, input.handoverId);
  const { group, line } = await lockedForReturn(ctx, h.id, input.lineId, input.reasonCode);
  const allowed = correctionAllowed({
    actorHolds: accessOf(ctx),
    controlled: line.row.controlled,
    witness,
  });
  if (!allowed.ok) throw conflict(REFUSE[allowed.reason]);
  const w = correctionWrites({
    supplies: refs(rows),
    reasonCode: input.reasonCode,
    note: input.note,
    actor: { userId: ctx.actor.userId, cadre: ctx.actor.cadreName },
    now: ctx.now,
    newId: randomUUID,
  });
  if (!w.ok) throw new EmrWriteError("invalid", SUPPLY.refused.notHere);
  await ctx.tx.insert(pharmacySupplyCorrections).values(w.corrections);
  await ctx.tx.insert(pharmacyLineEvents).values(
    w.lineEvents.map((e) => ({
      ...e,
      reasonNote: input.note,
      laneReasons: group.lane.reasons,
      ruleVersion: group.lane.ruleVersion,
      occurredAt: ctx.now,
      effectiveAt: ctx.now,
    })),
  );
  await withdrawListEntry(ctx.tx, {
    patientUserId: group.patientUserId,
    lineId: input.lineId,
    now: ctx.now,
  });
  await nudge(ctx, line.row.prescriberUserId, "supply_corrected", w.corrections[0]!.id);
  return { id: w.corrections[0]!.id };
}
