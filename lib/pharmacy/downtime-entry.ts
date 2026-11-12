import "server-only";

import { randomUUID } from "node:crypto";
import type { EmrDb } from "@/lib/emr/db";
import type { SheetIdentity } from "@/lib/pharmacy/downtime";
import type { PharmacyCtx, PharmacyNeed } from "@/lib/pharmacy/write";
import { and, asc, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { z } from "zod";

import { NOT_SUPPLIED_REASONS } from "@/content/pharmacy-review";
import { db as appDb } from "@/db";
import { downtimeFormNumbers, downtimePeriods } from "@/db/schema/lab-safety";
import { patientProfiles } from "@/db/schema/patient-profiles";
import {
  paperPrescriptionLines,
  paperPrescriptions,
  pharmacyBatches,
  pharmacyControlledEntries,
  pharmacyHandovers,
  pharmacyLineEvents,
  pharmacyLookBacks,
  pharmacyProducts,
  pharmacyStockMovements,
  pharmacySupplies,
  pharmacySupplyCorrections,
  pharmacySupplyReversals,
} from "@/db/schema/pharmacy-dispensing";
import { prescriptions } from "@/db/schema/prescribing";
import { EmrWriteError } from "@/lib/emr/write/context";
import { priceSnapshot } from "@/lib/pharmacy/catalogue";
import { isControlledMedicine } from "@/lib/pharmacy/controlled-read";
import {
  controlledBackEntry,
  downtimeTag,
  lookBackReasons,
  paperPrescriptionValid,
  pharmacySheetLabel,
  rowRefusal,
} from "@/lib/pharmacy/downtime";
import { cadreNames, dispensable } from "@/lib/pharmacy/read";
import { loadGroupOfLine, loadHospitalContext } from "@/lib/pharmacy/review/load";
import { reviewBasis } from "@/lib/pharmacy/review/review";
import { localDate } from "@/lib/pharmacy/stock/ledger";
import { BATCH_RECALLED_FLAG } from "@/lib/pharmacy/stores/packs";
import { recalledAmong } from "@/lib/pharmacy/stores/recall-read";
import { lockLine } from "@/lib/pharmacy/write";

/**
 * Entering a downtime sheet after the system is back (Pharmacy Phase 1, 5.12, DT-2 to DT-10, Law 10,
 * Law 13, ADR 0271). One row per call, in one transaction (`runPharmacyWrite`, point need "downtime").
 *
 * - DT-4 refuses only what makes the record impossible (`rowRefusal`); everything a live hand-over
 *   would have refused is recorded and flagged for look-back with each reason (DT-10, `lookBackReasons`),
 *   evaluated at the sheet's time.
 * - DT-3 A supply row writes the hand-over's rows as `recordHandover` does (hand-over, one supply, one
 *   `supplied` movement, the line's event), but with `supplied_at` and the movement's `effective_at`
 *   from the sheet, `entered_at` from the server, `identity_route = 'downtime_sheet'` with the sheet's
 *   identity as written (DT-6), the sheet and row, and `downtime = true` on the movement (0124 lets it
 *   below zero, DT-7). The pure `handoverWrites` is not reused: its SU-2 check refuses what DT-10 must
 *   record. Locks as ADR 0265: every line of the prescription, then the batch.
 * - DT-5 A paper prescription is `paper_prescriptions` + lines; the supply points at the paper line.
 *   Nothing is written to `prescriptions` (Law 2).
 * - DT-8 A controlled row writes a `back_entered_supply` entry with the witness's name as written and
 *   the register tick; it is confirmed from the Controlled drugs page (`controlled-store.ts`, Step 7).
 * - DT-9 A "not supplied" row is the line's owed / buying-outside event at the sheet's time, keyed
 *   `dtns:{hospital}:{sheet}:{row}` (so a row is entered once, and the fold reads it as a downtime
 *   move); on a paper prescription it is stored on the paper line.
 */

export const ENTRY_NEED: PharmacyNeed = { permission: "pharmacy.dispense", point: "downtime" };

/** DT-9: the not-supplied row's line-event key; `review/load.ts` reads the prefix as entered after downtime. */
export const NOT_SUPPLIED_KEY_PREFIX = "dtns:";
const notSuppliedKey = (hospitalId: string, sheet: number, row: number) =>
  `${NOT_SUPPLIED_KEY_PREFIX}${hospitalId}:${sheet}:${row}`;

/** Staff copy for back-entry, not in Appendix B. Rework H2: it was marked signed by mistake; draft until signed. */
export const ENTRY_COPY = {
  status: "draft",
  signedBy: null,
  signedOn: null,
  notPrinted: (n: number) => `${pharmacySheetLabel(n)} was not printed at this point.`,
  rowEntered: (row: number, n: number) =>
    `Row ${row} of ${pharmacySheetLabel(n)} is already entered.`,
  notThisPatient: "That prescription is not this patient's.",
  notHere: "That prescription is not at your hospital.",
  batch: "Choose a batch of this product at this dispensing point.",
  product: "Choose a product set up at this hospital.",
  paperLine: "Choose a line of the paper prescription.",
  paperNotSupplied:
    "A line already transcribed cannot take a not-supplied row. Transcribe the paper.",
  paper: "Check the paper prescription: prescriber's name and cadre, the date and each line.",
  controlled:
    "A controlled drug needs the witness's name as written on the sheet, and the tick that the register entry was made.",
} as const;

const invalid = (m: string) => new EmrWriteError("invalid", m);
const conflict = (m: string) => new EmrWriteError("conflict", m);
const dbOf = (ctx: PharmacyCtx) => ctx.tx as unknown as EmrDb;

/* ─── Input ─────────────────────────────────────────────────────────── */

const text = (min: number, max: number) => z.string().min(min).max(max);
const reasonCodes = Object.keys(NOT_SUPPLIED_REASONS) as [
  keyof typeof NOT_SUPPLIED_REASONS,
  ...(keyof typeof NOT_SUPPLIED_REASONS)[],
];

/** The cadres that supply at a window (the dispensing map's codes). */
export const SUPPLIER_CADRES = ["PHARMACIST", "PHARMACY_TECH"] as const;

export const RowInput = z.object({
  clientKey: z.uuid(),
  sheet: z.number().int().positive(),
  section: z.enum(["supply", "not_supplied"]),
  row: z.number().int().min(1).max(99),
  patientUserId: z.uuid(),
  /** Law 13: the time written on the sheet. */
  suppliedAt: z.coerce.date(),
  prescription: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("medsync"), lineId: z.uuid() }),
    z.object({
      kind: z.literal("paper"),
      prescriberName: text(2, 120),
      prescriberCadre: text(2, 80),
      writtenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      lines: z
        .array(
          z.object({
            medicineAsWritten: text(2, 200),
            directionsAsWritten: text(1, 500),
            quantityAsWritten: z.string().max(80).nullable(),
          }),
        )
        .min(1)
        .max(20),
      /** Which transcribed line this row is about (1-based). */
      lineNo: z.number().int().min(1).max(20),
    }),
    z.object({ kind: z.literal("paper_line"), paperLineId: z.uuid() }),
  ]),
  supply: z
    .object({
      productId: z.uuid(),
      batchId: z.uuid(),
      /** DT-4 refuses anything but a whole number above zero, in words. */
      quantity: z.number().max(100_000),
      /** "Supplied by" on the sheet, as a cadre code; shown by the cadre's own name (Law 4). */
      suppliedByCadre: z.enum(SUPPLIER_CADRES),
      identity: z.enum(["checked", "not_checked", "not_recorded"]),
      pharmacistInitials: z.string().trim().max(10).nullable(),
      controlled: z
        .object({ witnessNameAsWritten: z.string().max(120), registerAttested: z.boolean() })
        .nullable(),
    })
    .nullable(),
  notSupplied: z
    .object({ outcome: z.enum(["owed", "buying_outside"]), reasonCode: z.enum(reasonCodes) })
    .nullable(),
});
export type RowInputT = z.infer<typeof RowInput>;

export interface RowResult {
  id: string;
  suppliedAt: string;
  enteredAt: string;
}

/* ─── enterDowntimeRow ──────────────────────────────────────────────── */

export async function enterDowntimeRow(ctx: PharmacyCtx, input: RowInputT): Promise<RowResult> {
  const hospitalId = ctx.actor.hospitalId;
  const point = ctx.point!;
  const at = input.suppliedAt;
  const isSupply = input.section === "supply";
  if (isSupply !== (input.supply !== null) || isSupply === (input.notSupplied !== null))
    throw invalid("A row is either a supply or not supplied.");

  // SU-10: a repeat of this key returns the row already entered.
  const [done] = await ctx.tx
    .select({
      id: pharmacyHandovers.id,
      s: pharmacyHandovers.suppliedAt,
      e: pharmacyHandovers.enteredAt,
    })
    .from(pharmacyHandovers)
    .where(
      and(
        eq(pharmacyHandovers.clientKey, input.clientKey),
        eq(pharmacyHandovers.hospitalId, hospitalId),
      ),
    );
  if (done)
    return { id: done.id, suppliedAt: done.s.toISOString(), enteredAt: done.e.toISOString() };

  // The sheet, locked against Sheet complete and against another row being entered on it.
  const [sheet] = await ctx.tx
    .select({ state: downtimeFormNumbers.state })
    .from(downtimeFormNumbers)
    .where(
      and(
        eq(downtimeFormNumbers.hospitalId, hospitalId),
        eq(downtimeFormNumbers.workspace, "pharmacy"),
        eq(downtimeFormNumbers.dispensingPointId, point.id),
        eq(downtimeFormNumbers.number, input.sheet),
      ),
    )
    .for("update");
  if (!sheet) throw invalid(ENTRY_COPY.notPrinted(input.sheet));

  const nsKey = notSuppliedKey(hospitalId, input.sheet, input.row);
  const [entered, periods, registered] = await Promise.all([
    isSupply
      ? ctx.tx
          .select({ id: pharmacyHandovers.id })
          .from(pharmacyHandovers)
          .where(
            and(
              eq(pharmacyHandovers.hospitalId, hospitalId),
              eq(pharmacyHandovers.sheetNumber, input.sheet),
              eq(pharmacyHandovers.sheetRow, input.row),
            ),
          )
      : input.prescription.kind === "paper"
        ? // 0134: a "not supplied" paper row is held to its sheet and row, as a supply row is.
          ctx.tx
            .select({ id: paperPrescriptions.id })
            .from(paperPrescriptions)
            .where(
              and(
                eq(paperPrescriptions.hospitalId, hospitalId),
                eq(paperPrescriptions.sheetNumber, input.sheet),
                eq(paperPrescriptions.sheetRow, input.row),
              ),
            )
        : ctx.tx
            .select({ id: pharmacyLineEvents.id })
            .from(pharmacyLineEvents)
            .where(eq(pharmacyLineEvents.clientKey, nsKey)),
    ctx.tx
      .select({ startsAt: downtimePeriods.startsAt, endsAt: downtimePeriods.endsAt })
      .from(downtimePeriods)
      .where(eq(downtimePeriods.hospitalId, hospitalId)),
    ctx.tx
      .select({ id: patientProfiles.id })
      .from(patientProfiles)
      .where(eq(patientProfiles.id, input.patientUserId)),
  ]);
  const refusal = rowRefusal({
    sheetState: sheet.state as Parameters<typeof rowRefusal>[0]["sheetState"],
    suppliedAt: at,
    now: ctx.now,
    periods,
    patientRegistered: registered.length > 0,
    rowAlreadyEntered: entered.length > 0,
    quantity: input.supply?.quantity ?? null,
  });
  if (refusal)
    throw conflict(
      refusal.refusal === "row_entered"
        ? ENTRY_COPY.rowEntered(input.row, input.sheet)
        : refusal.words,
    );

  // What the row is about: a MedSync line (locked, ADR 0265), a paper prescription, or a paper line.
  const rx = input.prescription;
  let medsync: Awaited<ReturnType<typeof lockedLine>> | null = null;
  if (rx.kind === "medsync") {
    medsync = await lockedLine(ctx, rx.lineId);
    if (medsync.group.patientUserId !== input.patientUserId)
      throw invalid(ENTRY_COPY.notThisPatient);
  }
  let paperLine: { id: string; medicineId: string | null } | null = null;
  if (rx.kind === "paper_line") {
    if (!isSupply) throw invalid(ENTRY_COPY.paperNotSupplied);
    const [l] = await ctx.tx
      .select({ id: paperPrescriptionLines.id, medicineId: paperPrescriptionLines.medicineId })
      .from(paperPrescriptionLines)
      .innerJoin(
        paperPrescriptions,
        eq(paperPrescriptions.id, paperPrescriptionLines.paperPrescriptionId),
      )
      .where(
        and(
          eq(paperPrescriptionLines.id, rx.paperLineId),
          eq(paperPrescriptions.hospitalId, hospitalId),
          eq(paperPrescriptions.patientUserId, input.patientUserId),
        ),
      );
    if (!l) throw invalid(ENTRY_COPY.paperLine);
    paperLine = l;
  }
  if (rx.kind === "paper") {
    const valid = paperPrescriptionValid(
      {
        prescriberName: rx.prescriberName,
        prescriberCadre: rx.prescriberCadre,
        writtenOn: rx.writtenOn,
        lines: rx.lines.map((l) => ({ ...l, medicineId: null })),
      },
      localDate(ctx.now),
    );
    if (!valid.ok || rx.lineNo > rx.lines.length) throw invalid(ENTRY_COPY.paper);
  }

  if (!isSupply) return notSuppliedRow(ctx, input, medsync, nsKey);

  /* ─── A supply row ─── */
  const s = input.supply!;
  const quantity = s.quantity;
  const [product] = await ctx.tx
    .select({
      id: pharmacyProducts.id,
      medicineId: pharmacyProducts.medicineId,
      strength: pharmacyProducts.strength,
      issueUnit: pharmacyProducts.issueUnit,
      priceUgx: pharmacyProducts.priceUgx,
    })
    .from(pharmacyProducts)
    .where(and(eq(pharmacyProducts.id, s.productId), eq(pharmacyProducts.hospitalId, hospitalId)));
  if (!product) throw invalid(ENTRY_COPY.product);
  const [batch] = await ctx.tx
    .select({
      id: pharmacyBatches.id,
      expiry: pharmacyBatches.expiry,
      expiryMonthOnly: pharmacyBatches.expiryMonthOnly,
    })
    .from(pharmacyBatches)
    .where(
      and(
        eq(pharmacyBatches.id, s.batchId),
        eq(pharmacyBatches.hospitalId, hospitalId),
        eq(pharmacyBatches.dispensingPointId, point.id),
        eq(pharmacyBatches.productId, product.id),
      ),
    )
    .for("update");
  if (!batch) throw invalid(ENTRY_COPY.batch);

  const controlled = medsync
    ? medsync.line.row.controlled
    : await isControlledMedicine(ctx.tx, hospitalId, product.medicineId);
  const cd = controlled
    ? controlledBackEntry({
        witnessNameAsWritten: s.controlled?.witnessNameAsWritten ?? "",
        registerAttested: s.controlled?.registerAttested === true,
      })
    : null;
  if (cd && !cd.ok) throw invalid(ENTRY_COPY.controlled);

  // Paper: the prescription and its lines, as typed (DT-5). Never a `prescriptions` row.
  if (rx.kind === "paper") paperLine = await insertPaper(ctx, input, rx, product.medicineId, null);

  // DT-10, at the sheet's time.
  const line = medsync?.line;
  const supplyLineId = line?.row.id ?? paperLine!.id;
  const already = await ctx.tx
    .select({ id: pharmacySupplies.id })
    .from(pharmacySupplies)
    .leftJoin(pharmacySupplyReversals, eq(pharmacySupplyReversals.supplyId, pharmacySupplies.id))
    .leftJoin(
      pharmacySupplyCorrections,
      eq(pharmacySupplyCorrections.supplyId, pharmacySupplies.id),
    )
    .where(
      and(
        eq(pharmacySupplies.hospitalId, hospitalId),
        line
          ? eq(pharmacySupplies.prescriptionId, supplyLineId)
          : eq(pharmacySupplies.paperPrescriptionLineId, supplyLineId),
        isNull(pharmacySupplyReversals.id),
        isNull(pharmacySupplyCorrections.id),
      ),
    )
    .limit(1);
  const cosign = line?.input.cosign;
  const reasons = lookBackReasons({
    identityOnSheet: s.identity as SheetIdentity,
    pharmacistFirst: medsync?.group.lane.lane === "pharmacist_first",
    pharmacistInitials: s.pharmacistInitials,
    cosignAwaitingAtTime:
      cosign === "awaiting" ||
      cosign === "withheld" ||
      (cosign === "signed" && !!line?.input.cosignedAt && line.input.cosignedAt > at),
    cancelledAtTime:
      !!line &&
      (line.row.state === "cancelled" || line.row.state === "completed") &&
      (line.input.stateChangedAt ?? at) <= at,
    versionChangedBefore: !!line?.replacedBy && (line.cancellationAt ?? at) <= at,
    batch: { expiry: String(batch.expiry), expiryMonthOnly: batch.expiryMonthOnly },
    suppliedAt: at,
    productOfMedicine: line
      ? product.medicineId === line.row.drugId
      : !paperLine!.medicineId || paperLine!.medicineId === product.medicineId,
    alreadySupplied:
      already.length > 0 || (line?.status?.kind === "closed" && line.status.outcome === "supplied"),
  });

  const handoverId = randomUUID();
  const supplyId = randomUUID();
  const movementId = randomUUID();
  const actor = {
    actorUserId: ctx.actor.userId,
    actorCadre: (await cadreNames(dbOf(ctx))).get(s.suppliedByCadre) ?? null,
  };
  await ctx.tx.insert(pharmacyHandovers).values({
    id: handoverId,
    hospitalId,
    dispensingPointId: point.id,
    patientUserId: input.patientUserId,
    collector: "patient",
    identityRoute: "downtime_sheet",
    sheetIdentity: s.identity,
    labelMode: "none",
    paymentStatus: "not_recorded",
    ...actor,
    clientKey: input.clientKey,
    enteredAfterDowntime: true,
    sheetNumber: input.sheet,
    sheetRow: input.row,
    suppliedAt: at,
    enteredAt: ctx.now,
  });
  const basis = medsync
    ? reviewBasis(medsync.group.lane.lane, supplyLineId, line!.reviewEvents)
    : null;
  await ctx.tx.insert(pharmacySupplies).values({
    id: supplyId,
    handoverId,
    hospitalId,
    dispensingPointId: point.id,
    supplyingHospitalId: hospitalId,
    patientUserId: input.patientUserId,
    prescriptionId: line ? supplyLineId : null,
    paperPrescriptionLineId: line ? null : supplyLineId,
    productId: product.id,
    batchId: batch.id,
    quantity,
    issueUnit: product.issueUnit,
    priceUgx: priceSnapshot(product),
    prescribedStrength: line?.row.concentration ?? null,
    suppliedStrength: product.strength,
    reviewEventId: basis && basis.kind !== "checked_at_supply" ? basis.eventId : null,
    suppliedAt: at,
    enteredAfterDowntime: true,
  });
  await ctx.tx.insert(pharmacyStockMovements).values({
    id: movementId,
    hospitalId,
    dispensingPointId: point.id,
    batchId: batch.id,
    kind: "supplied",
    quantity: -quantity,
    effectiveAt: at,
    actorUserId: ctx.actor.userId,
    sourceKind: "supply",
    sourceId: supplyId,
    downtime: true,
    // Rework S3: a controlled back-entry leaves on the paper witness's name, and the in-charge sees it.
    paperWitnessName: cd?.ok ? cd.entry.witnessNameAsWritten : null,
  });
  if (medsync)
    await ctx.tx.insert(pharmacyLineEvents).values({
      hospitalId,
      prescriptionId: supplyLineId,
      patientUserId: input.patientUserId,
      dispensingPointId: point.id,
      kind: "supplied",
      lane: medsync.group.lane.lane,
      laneReasons: medsync.group.lane.reasons,
      ruleVersion: medsync.group.lane.ruleVersion,
      quantitySupplied: quantity,
      handoverId,
      ...actor,
      occurredAt: ctx.now,
      effectiveAt: at,
    });
  // SL-14 (Phase 2): a recalled batch is still recorded, flagged, and its patient is on the recall's list 2.
  const flags: string[] = reasons.map((r) => r.reason);
  if ((await recalledAmong(ctx.tx, hospitalId, [batch.id])).size) flags.push(BATCH_RECALLED_FLAG);
  if (flags.length)
    await ctx.tx.insert(pharmacyLookBacks).values({
      hospitalId,
      supplyId,
      kind: "flagged",
      reasons: flags,
      actorUserId: ctx.actor.userId,
      at: ctx.now,
    });
  if (cd?.ok)
    await ctx.tx.insert(pharmacyControlledEntries).values({
      hospitalId,
      dispensingPointId: point.id,
      medicineId: product.medicineId,
      kind: cd.entry.kind,
      handoverId,
      movementId,
      witnessNameAsWritten: cd.entry.witnessNameAsWritten,
      registerAttested: true,
      actorUserId: ctx.actor.userId,
      actorCadre: ctx.actor.cadreName,
      recordedAt: ctx.now,
    });
  return { id: handoverId, suppliedAt: at.toISOString(), enteredAt: ctx.now.toISOString() };
}

/** ADR 0265: every line of the prescription locked in id order, then its record read under the locks. */
async function lockedLine(ctx: PharmacyCtx, lineId: string) {
  const h = await loadHospitalContext(dbOf(ctx), ctx.actor.hospitalId);
  const first = await loadGroupOfLine(dbOf(ctx), h, lineId);
  if (!first) throw new EmrWriteError("not_found", ENTRY_COPY.notHere);
  for (const id of [...new Set(first.group.lines.map((l) => l.row.id))].sort())
    await lockLine(ctx.tx, id);
  const again = await loadGroupOfLine(dbOf(ctx), h, lineId);
  if (!again) throw new EmrWriteError("not_found", ENTRY_COPY.notHere);
  return again;
}

type PaperRx = Extract<RowInputT["prescription"], { kind: "paper" }>;

/** DT-5: the paper prescription and every line as typed; returns the line this row is about. */
async function insertPaper(
  ctx: PharmacyCtx,
  input: RowInputT,
  rx: PaperRx,
  medicineId: string | null,
  notSupplied: { outcome: string; reasonCode: string } | null,
) {
  const [paper] = await ctx.tx
    .insert(paperPrescriptions)
    .values({
      hospitalId: ctx.actor.hospitalId,
      dispensingPointId: ctx.point!.id,
      patientUserId: input.patientUserId,
      prescriberName: rx.prescriberName,
      prescriberCadre: rx.prescriberCadre,
      writtenOn: rx.writtenOn,
      sheetNumber: input.sheet,
      // 0134: only a "not supplied" paper row takes the sheet's row (a supply row's is on its hand-over).
      sheetRow: notSupplied ? input.row : null,
      transcribedBy: ctx.actor.userId,
      transcribedAt: ctx.now,
    })
    .returning({ id: paperPrescriptions.id });
  const lines = await ctx.tx
    .insert(paperPrescriptionLines)
    .values(
      rx.lines.map((l, i) => {
        const mine = i + 1 === rx.lineNo;
        return {
          paperPrescriptionId: paper!.id,
          hospitalId: ctx.actor.hospitalId,
          lineNo: i + 1,
          medicineId: mine ? medicineId : null,
          medicineAsWritten: l.medicineAsWritten,
          directionsAsWritten: l.directionsAsWritten,
          quantityAsWritten: l.quantityAsWritten,
          notSuppliedReason: mine ? (notSupplied?.reasonCode ?? null) : null,
          notSuppliedOutcome: mine ? (notSupplied?.outcome ?? null) : null,
        };
      }),
    )
    .returning({ id: paperPrescriptionLines.id, lineNo: paperPrescriptionLines.lineNo });
  return { id: lines.find((l) => l.lineNo === rx.lineNo)!.id, medicineId };
}

/** DT-9: the line's outcome at the sheet's time, or the paper line's. */
async function notSuppliedRow(
  ctx: PharmacyCtx,
  input: RowInputT,
  medsync: Awaited<ReturnType<typeof lockedLine>> | null,
  key: string,
): Promise<RowResult> {
  const ns = input.notSupplied!;
  const out = { suppliedAt: input.suppliedAt.toISOString(), enteredAt: ctx.now.toISOString() };
  if (input.prescription.kind === "paper") {
    const line = await insertPaper(ctx, input, input.prescription, null, ns);
    return { id: line.id, ...out };
  }
  const { group, line } = medsync!;
  const [row] = await ctx.tx
    .insert(pharmacyLineEvents)
    .values({
      hospitalId: ctx.actor.hospitalId,
      prescriptionId: line.row.id,
      patientUserId: input.patientUserId,
      dispensingPointId: ctx.point!.id,
      kind: ns.outcome,
      lane: group.lane.lane,
      laneReasons: group.lane.reasons,
      ruleVersion: group.lane.ruleVersion,
      reasonCode: ns.reasonCode,
      quantitySupplied: 0,
      actorUserId: ctx.actor.userId,
      actorCadre: ctx.actor.cadreName,
      occurredAt: ctx.now,
      effectiveAt: input.suppliedAt,
      clientKey: key,
    })
    .returning({ id: pharmacyLineEvents.id });
  return { id: row!.id, ...out };
}

export const CompleteSheetInput = z.object({ number: z.number().int().positive() });

/* ─── Reads (owner, scoped to the hospital and point) ───────────────── */

const defaultDb = () => appDb as unknown as EmrDb;

/** Law 13: the tag for each back-entered hand-over, by hand-over id ("Entered after downtime · …"). */
export async function downtimeTagsFor(
  hospitalId: string,
  handoverIds: readonly string[],
  database: EmrDb = defaultDb(),
): Promise<Record<string, string>> {
  if (!handoverIds.length) return {};
  const rows = await database
    .select({
      id: pharmacyHandovers.id,
      suppliedAt: pharmacyHandovers.suppliedAt,
      enteredAt: pharmacyHandovers.enteredAt,
      sheet: pharmacyHandovers.sheetNumber,
    })
    .from(pharmacyHandovers)
    .where(
      and(
        eq(pharmacyHandovers.hospitalId, hospitalId),
        eq(pharmacyHandovers.enteredAfterDowntime, true),
        inArray(pharmacyHandovers.id, [...handoverIds]),
      ),
    );
  return Object.fromEntries(
    rows.map((r) => [
      r.id,
      downtimeTag({ suppliedAt: r.suppliedAt, enteredAt: r.enteredAt, sheet: r.sheet! }),
    ]),
  );
}

/** DT-5: the medicine as written for supplies against a paper prescription, by supply id. */
export async function paperMedicinesFor(
  hospitalId: string,
  handoverIds: readonly string[],
  database: EmrDb = defaultDb(),
): Promise<Record<string, string>> {
  if (!handoverIds.length) return {};
  const rows = await database
    .select({ id: pharmacySupplies.id, medicine: paperPrescriptionLines.medicineAsWritten })
    .from(pharmacySupplies)
    .innerJoin(
      paperPrescriptionLines,
      eq(paperPrescriptionLines.id, pharmacySupplies.paperPrescriptionLineId),
    )
    .where(
      and(
        eq(pharmacySupplies.hospitalId, hospitalId),
        inArray(pharmacySupplies.handoverId, [...handoverIds]),
      ),
    );
  return Object.fromEntries(rows.map((r) => [r.id, r.medicine]));
}

export interface EnteredRow {
  section: "supply" | "not_supplied";
  row: number | null;
  patientUserId: string;
  medicine: string;
  detail: string;
  suppliedAt: string;
  enteredAt: string;
  paper: boolean;
}

/** The sheet at this point: its state, the rows already entered, and what the form picks from. */
export async function loadSheetEntry(
  hospitalId: string,
  pointId: string,
  sheet: number,
  database: EmrDb = defaultDb(),
) {
  const [s] = await database
    .select({ number: downtimeFormNumbers.number, state: downtimeFormNumbers.state })
    .from(downtimeFormNumbers)
    .where(
      and(
        eq(downtimeFormNumbers.hospitalId, hospitalId),
        eq(downtimeFormNumbers.workspace, "pharmacy"),
        eq(downtimeFormNumbers.dispensingPointId, pointId),
        eq(downtimeFormNumbers.number, sheet),
      ),
    );
  if (!s) return null;
  const [supplied, notSupplied, paperNot, products, batches] = await Promise.all([
    database
      .select({
        row: pharmacyHandovers.sheetRow,
        patientUserId: pharmacyHandovers.patientUserId,
        suppliedAt: pharmacyHandovers.suppliedAt,
        enteredAt: pharmacyHandovers.enteredAt,
        drug: prescriptions.drugName,
        paper: paperPrescriptionLines.medicineAsWritten,
        quantity: pharmacySupplies.quantity,
        unit: pharmacySupplies.issueUnit,
        batch: pharmacyBatches.batchNumber,
      })
      .from(pharmacyHandovers)
      .innerJoin(pharmacySupplies, eq(pharmacySupplies.handoverId, pharmacyHandovers.id))
      .innerJoin(pharmacyBatches, eq(pharmacyBatches.id, pharmacySupplies.batchId))
      .leftJoin(prescriptions, eq(prescriptions.id, pharmacySupplies.prescriptionId))
      .leftJoin(
        paperPrescriptionLines,
        eq(paperPrescriptionLines.id, pharmacySupplies.paperPrescriptionLineId),
      )
      .where(
        and(eq(pharmacyHandovers.hospitalId, hospitalId), eq(pharmacyHandovers.sheetNumber, sheet)),
      )
      .orderBy(asc(pharmacyHandovers.sheetRow)),
    database
      .select({
        key: pharmacyLineEvents.clientKey,
        patientUserId: pharmacyLineEvents.patientUserId,
        kind: pharmacyLineEvents.kind,
        reason: pharmacyLineEvents.reasonCode,
        suppliedAt: pharmacyLineEvents.effectiveAt,
        enteredAt: pharmacyLineEvents.occurredAt,
        drug: prescriptions.drugName,
      })
      .from(pharmacyLineEvents)
      .innerJoin(prescriptions, eq(prescriptions.id, pharmacyLineEvents.prescriptionId))
      .where(
        and(
          eq(pharmacyLineEvents.hospitalId, hospitalId),
          like(
            pharmacyLineEvents.clientKey,
            `${notSuppliedKey(hospitalId, sheet, 0).slice(0, -1)}%`,
          ),
        ),
      ),
    database
      .select({
        patientUserId: paperPrescriptions.patientUserId,
        medicine: paperPrescriptionLines.medicineAsWritten,
        outcome: paperPrescriptionLines.notSuppliedOutcome,
        reason: paperPrescriptionLines.notSuppliedReason,
        enteredAt: paperPrescriptions.transcribedAt,
      })
      .from(paperPrescriptionLines)
      .innerJoin(
        paperPrescriptions,
        eq(paperPrescriptions.id, paperPrescriptionLines.paperPrescriptionId),
      )
      .where(
        and(
          eq(paperPrescriptions.hospitalId, hospitalId),
          eq(paperPrescriptions.sheetNumber, sheet),
          sql`${paperPrescriptionLines.notSuppliedOutcome} IS NOT NULL`,
        ),
      ),
    database
      .select({
        id: pharmacyProducts.id,
        name: pharmacyProducts.name,
        strength: pharmacyProducts.strength,
        issueUnit: pharmacyProducts.issueUnit,
        medicineId: pharmacyProducts.medicineId,
      })
      .from(pharmacyProducts)
      .where(eq(pharmacyProducts.hospitalId, hospitalId))
      .orderBy(asc(pharmacyProducts.name)),
    database
      .select({
        id: pharmacyBatches.id,
        productId: pharmacyBatches.productId,
        number: pharmacyBatches.batchNumber,
        expiry: pharmacyBatches.expiry,
      })
      .from(pharmacyBatches)
      .where(
        and(
          eq(pharmacyBatches.hospitalId, hospitalId),
          eq(pharmacyBatches.dispensingPointId, pointId),
        ),
      )
      .orderBy(asc(pharmacyBatches.expiry)),
  ]);
  const why = (code: string | null) =>
    NOT_SUPPLIED_REASONS[code as keyof typeof NOT_SUPPLIED_REASONS] ?? code ?? "";
  const outcomeWord = (k: string | null) => (k === "owed" ? "Owed" : "Buying outside");
  const rows: EnteredRow[] = [
    ...supplied.map((r) => ({
      section: "supply" as const,
      row: r.row,
      patientUserId: r.patientUserId,
      medicine: r.drug ?? r.paper ?? "",
      detail: `${r.quantity} ${r.unit} · ${r.batch}`,
      suppliedAt: r.suppliedAt.toISOString(),
      enteredAt: r.enteredAt.toISOString(),
      paper: r.drug === null,
    })),
    ...notSupplied.map((r) => ({
      section: "not_supplied" as const,
      row: Number(r.key?.split(":").at(-1)),
      patientUserId: r.patientUserId,
      medicine: r.drug,
      detail: `${outcomeWord(r.kind)} · ${why(r.reason)}`,
      suppliedAt: r.suppliedAt.toISOString(),
      enteredAt: r.enteredAt.toISOString(),
      paper: false,
    })),
    ...paperNot.map((r) => ({
      section: "not_supplied" as const,
      row: null,
      patientUserId: r.patientUserId,
      medicine: r.medicine,
      detail: `${outcomeWord(r.outcome)} · ${why(r.reason)}`,
      suppliedAt: "",
      enteredAt: r.enteredAt.toISOString(),
      paper: true,
    })),
  ];
  return {
    number: s.number,
    state: s.state,
    rows,
    products,
    batches: batches.map((b) => ({ ...b, expiry: String(b.expiry) })),
  };
}

/**
 * The patient for a row (5.12): found by MedSync number, exactly; a number that is not registered gives
 * null ("Register this patient at reception first"; nobody is created here, S73). With them, their
 * prescriptions at this hospital (newest first) and the paper lines already transcribed for them here.
 */
export async function patientForEntry(
  hospitalId: string,
  patientCode: string,
  database: EmrDb = defaultDb(),
) {
  const [patient] = await database
    .select({ id: patientProfiles.id })
    .from(patientProfiles)
    .where(eq(patientProfiles.patientCode, patientCode.trim()))
    .limit(1);
  if (!patient) return null;
  const [lines, paper] = await Promise.all([
    database
      .select({
        id: prescriptions.id,
        drugName: prescriptions.drugName,
        concentration: prescriptions.concentration,
        dose: prescriptions.dose,
        frequency: prescriptions.frequency,
        createdAt: prescriptions.createdAt,
        state: prescriptions.state,
        controlled: prescriptions.controlled,
      })
      .from(prescriptions)
      .where(
        and(
          eq(prescriptions.hospitalId, hospitalId),
          eq(prescriptions.patientUserId, patient.id),
          dispensable(),
        ),
      )
      .orderBy(desc(prescriptions.createdAt))
      .limit(50),
    database
      .select({
        id: paperPrescriptionLines.id,
        medicine: paperPrescriptionLines.medicineAsWritten,
        directions: paperPrescriptionLines.directionsAsWritten,
        writtenOn: paperPrescriptions.writtenOn,
        prescriber: paperPrescriptions.prescriberName,
        sheet: paperPrescriptions.sheetNumber,
      })
      .from(paperPrescriptionLines)
      .innerJoin(
        paperPrescriptions,
        eq(paperPrescriptions.id, paperPrescriptionLines.paperPrescriptionId),
      )
      .where(
        and(
          eq(paperPrescriptions.hospitalId, hospitalId),
          eq(paperPrescriptions.patientUserId, patient.id),
        ),
      )
      .orderBy(desc(paperPrescriptions.transcribedAt))
      .limit(20),
  ]);
  return {
    patientUserId: patient.id,
    lines: lines.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
    paper: paper.map((p) => ({ ...p, writtenOn: String(p.writtenOn) })),
  };
}
