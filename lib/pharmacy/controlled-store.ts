import type { Verifier } from "@/lib/auth/attest";
import type { EmrDb } from "@/lib/emr/db";
import type { HandoverOutcome } from "@/lib/pharmacy/supply/store";
import type { PharmacyCtx, PharmacyNeed } from "@/lib/pharmacy/write";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import {
  pharmacyAttestations,
  pharmacyBatchCorrections,
  pharmacyBatches,
  pharmacyControlledDifferences,
  pharmacyControlledEntries,
  pharmacyCountLines,
  pharmacyCounts,
  pharmacyPrintEvents,
  pharmacyProducts,
  pharmacyStockMovements,
  pharmacySupplies,
  pharmacySupplyCorrections,
  pharmacySupplyReversals,
} from "@/db/schema/pharmacy-dispensing";
import { ATTEST_COPY, attestSecondPerson } from "@/lib/auth/attest";
import { EmrWriteError } from "@/lib/emr/write/context";
import { attestationStands, commitCount, READY_COPY } from "@/lib/pharmacy/controlled";
import { countableBatches, witnessCandidates } from "@/lib/pharmacy/controlled-read";
import { loadGroupOfLine, loadHospitalContext } from "@/lib/pharmacy/review/load";
import { localDate } from "@/lib/pharmacy/stock/ledger";
import * as stock from "@/lib/pharmacy/stock/store";
import * as supply from "@/lib/pharmacy/supply/store";

/**
 * Controlled drugs, written (Pharmacy Phase 1, 5.9; CD-2, CD-3, CD-5, CD-7, DT-8, LB-7; D-PH1-42;
 * Section 8's Controlled rows). Each write is `(ctx, input) => {id}` for `runPharmacyWrite`, inside
 * its one transaction. The engine (`controlled.ts`) decides; 0127's witness guard re-checks every
 * entry against its attestation (passed, a witness, not the actor, same actor and hospital, under 30
 * minutes) and refuses at the database what slipped past here.
 *
 * Law 9, CD-7: nothing here marks the statutory paper as done. The two attestations record what the
 * supplier said, with their name; the register slip is a copy for the register, never the register.
 */

export const CONTROLLED_NEED: PharmacyNeed = { permission: "pharmacy.controlled", point: "setup" };
export const CONTROLLED_LIVE: PharmacyNeed = { permission: "pharmacy.controlled", point: "live" };
export const CLOSE_NEED: PharmacyNeed = { permission: "pharmacy.manage", point: "setup" };

/* ─── Inputs ──────────────────────────────────────────────────────────── */

const key = z.uuid();
const witnessAttestationId = z.uuid();
const WITNESS = z.object({ witnessAttestationId });

export const ATTEST_ACTIONS = [
  "controlled_supply",
  "controlled_count",
  "controlled_receipt",
  "controlled_adjustment",
  "controlled_transfer",
  "controlled_batch_correction",
  "controlled_reversal",
  "controlled_correction",
  "back_entry_confirmed",
] as const;

export const AttestInput = z.object({
  clientKey: key,
  witnessUserId: z.uuid({ message: "Choose the witness." }),
  // Never logged, stored or returned (D-PH1-42).
  password: z.string().min(1, "The witness types their password.").max(200),
  code: z
    .string()
    .transform((s) => s.replace(/\s/g, ""))
    .pipe(z.string().regex(/^\d{6}$/, "The witness types the 6-digit code.")),
  action: z.enum(ATTEST_ACTIONS),
});

export const ControlledCountInput = z.object({
  clientKey: key,
  medicineId: z.string().regex(/^[a-z0-9_]{2,80}$/),
  scope: z.enum(["controlled_supply", "controlled_shift"]),
  witnessAttestationId,
  lines: z
    .array(z.object({ batchId: z.uuid(), counted: z.number().int().min(0).max(1_000_000) }))
    .min(1)
    .max(100),
});

export const ControlledSupplyInput = z.intersection(
  supply.HandoverInput,
  z.object({
    witnessAttestationId,
    paperPrescriptionAttested: z.boolean(),
    registerAttested: z.boolean(),
    /** CD-2, B-50: the balance the witness agreed for each controlled medicine, as shown to them. */
    agreedBalances: z
      .array(
        z.object({
          medicineId: z.string().regex(/^[a-z0-9_]{2,80}$/),
          balance: z.number().int().min(0),
        }),
      )
      .max(20),
  }),
);

export const CloseDifferenceInput = z.object({
  differenceId: z.uuid(),
  note: z.string().trim().min(3, "Write a note.").max(1000),
});

export const PrintRegisterInput = z.object({ clientKey: key, entryId: z.uuid().nullable() });

export const ConfirmBackEntryInput = z.object({
  clientKey: key,
  entryId: z.uuid(),
  witnessAttestationId,
});

export const ReceiveControlledInput = z.intersection(stock.ReceiveInput, WITNESS);
export const AdjustControlledInput = z.intersection(stock.AdjustInput, WITNESS);
export const TransferControlledInput = z.intersection(stock.TransferInput, WITNESS);
export const CorrectBatchControlledInput = z.intersection(stock.CorrectInput, WITNESS);
export const ReverseControlledInput = z.intersection(supply.ReverseInput, WITNESS);
export const CorrectRecordControlledInput = z.intersection(supply.CorrectInput, WITNESS);

/* ─── Shared ──────────────────────────────────────────────────────────── */

const conflict = (m: string) => new EmrWriteError("conflict", m);
const dbOf = (ctx: PharmacyCtx) => ctx.tx as unknown as EmrDb;
const PERMISSION = "Only a holder of the controlled drugs permission can do this.";

/** CD-5: the action's own permission is the need; `pharmacy.controlled` is checked here as well. */
function mustHoldControlled(ctx: PharmacyCtx) {
  if (!ctx.actor.access.permissions.has("pharmacy.controlled"))
    throw new EmrWriteError("forbidden", PERMISSION);
}

/** CD-2: a passed witness attestation for this actor, here, under 30 minutes old (0127 mirrors it). */
async function standing(ctx: PharmacyCtx, attestationId: string): Promise<string> {
  const [a] = await ctx.tx
    .select()
    .from(pharmacyAttestations)
    .where(eq(pharmacyAttestations.id, attestationId));
  const stands = attestationStands({
    attestation: a ?? null,
    actorUserId: ctx.actor.userId,
    hospitalId: ctx.actor.hospitalId,
    now: ctx.now,
  });
  if (!stands) throw conflict(READY_COPY.witness);
  return attestationId;
}

type EntryKind =
  | "supply"
  | "receipt"
  | "count"
  | "adjustment"
  | "transfer"
  | "reversal"
  | "correction"
  | "batch_correction"
  | "back_entry_confirmed";

async function entry(
  ctx: PharmacyCtx,
  e: {
    kind: EntryKind;
    medicineId: string;
    witness: string;
    pointId?: string;
    movementId?: string | null;
    countId?: string | null;
    handoverId?: string | null;
    confirmsEntryId?: string | null;
    paper?: boolean;
    register?: boolean;
    agreed?: number | null;
  },
): Promise<string> {
  if (e.movementId) {
    const [done] = await ctx.tx
      .select({ id: pharmacyControlledEntries.id })
      .from(pharmacyControlledEntries)
      .where(eq(pharmacyControlledEntries.movementId, e.movementId));
    if (done) return done.id;
  }
  const [row] = await ctx.tx
    .insert(pharmacyControlledEntries)
    .values({
      hospitalId: ctx.actor.hospitalId,
      dispensingPointId: e.pointId ?? ctx.point!.id,
      medicineId: e.medicineId,
      kind: e.kind,
      handoverId: e.handoverId ?? null,
      movementId: e.movementId ?? null,
      countId: e.countId ?? null,
      confirmsEntryId: e.confirmsEntryId ?? null,
      witnessAttestationId: e.witness,
      paperPrescriptionAttested: e.paper ?? false,
      registerAttested: e.register ?? false,
      witnessAgreedBalance: e.agreed ?? null,
      actorUserId: ctx.actor.userId,
      actorCadre: ctx.actor.cadreName,
      recordedAt: ctx.now,
    })
    .returning({ id: pharmacyControlledEntries.id });
  return row!.id;
}

/** The batches of a medicine's products at this point, locked, with their balances. */
async function batchesOf(ctx: PharmacyCtx, medicineId: string) {
  const rows = await ctx.tx
    .select({
      id: pharmacyBatches.id,
      batchNumber: pharmacyBatches.batchNumber,
      expiry: pharmacyBatches.expiry,
      expiryMonthOnly: pharmacyBatches.expiryMonthOnly,
    })
    .from(pharmacyBatches)
    .innerJoin(pharmacyProducts, eq(pharmacyProducts.id, pharmacyBatches.productId))
    .where(
      and(
        eq(pharmacyBatches.hospitalId, ctx.actor.hospitalId),
        eq(pharmacyBatches.dispensingPointId, ctx.point!.id),
        eq(pharmacyProducts.medicineId, medicineId),
      ),
    )
    .orderBy(pharmacyBatches.id)
    .for("update", { of: pharmacyBatches });
  const sums = rows.length
    ? await ctx.tx
        .select({
          batchId: pharmacyStockMovements.batchId,
          n: sql<number>`coalesce(sum(${pharmacyStockMovements.quantity}), 0)::int`,
        })
        .from(pharmacyStockMovements)
        .where(
          inArray(
            pharmacyStockMovements.batchId,
            rows.map((r) => r.id),
          ),
        )
        .groupBy(pharmacyStockMovements.batchId)
    : [];
  const balances = new Map(sums.map((s) => [s.batchId, Number(s.n)]));
  return { rows, balances };
}

/* ─── The witness (D-PH1-42, PA2-6, H5) ───────────────────────────────── */

/**
 * The witness chooses their own name and types their own password and code. The attempt is recorded
 * whatever its outcome (a failed row commits: nothing throws for a wrong password). The answer is the
 * attestation and the witness's cadre; never the password or code.
 * ponytail: the Supabase check runs inside the write's transaction (one round trip of sign-in, factor,
 * challenge, verify); split it out if transaction time ever matters.
 */
export async function attestWitness(
  ctx: PharmacyCtx,
  input: z.infer<typeof AttestInput>,
  verify?: Verifier,
): Promise<{ id: string; ok: boolean; words: string | null; cadre: string | null; at: string }> {
  if (input.witnessUserId !== ctx.actor.userId) {
    const allowed = await witnessCandidates(dbOf(ctx), ctx.actor.hospitalId, ctx.actor.userId);
    if (!allowed.some((w) => w.userId === input.witnessUserId))
      throw new EmrWriteError("forbidden", ATTEST_COPY.unknown);
  }
  const r = await attestSecondPerson(
    {
      hospitalId: ctx.actor.hospitalId,
      actorUserId: ctx.actor.userId,
      witnessUserId: input.witnessUserId,
      password: input.password,
      code: input.code,
      purpose: "witness",
      action: input.action,
    },
    { tx: ctx.tx, now: ctx.now, ...(verify ? { verify } : {}) },
  );
  const cadre = r.ok
    ? ((await witnessCandidates(dbOf(ctx), ctx.actor.hospitalId, ctx.actor.userId)).find(
        (w) => w.userId === input.witnessUserId,
      )?.cadre ?? null)
    : null;
  return {
    id: r.attestationId,
    ok: r.ok,
    words: r.ok ? null : r.words,
    cadre,
    at: ctx.now.toISOString(),
  };
}

/* ─── recordControlledCount (CD-3) ─────────────────────────────────────── */

export interface ControlledCountLine {
  batchId: string;
  batchNumber: string;
  counted: number;
  recorded: number;
}

async function countLinesOf(ctx: PharmacyCtx, countId: string): Promise<ControlledCountLine[]> {
  return ctx.tx
    .select({
      batchId: pharmacyCountLines.batchId,
      batchNumber: pharmacyBatches.batchNumber,
      counted: pharmacyCountLines.countedQuantity,
      recorded: pharmacyCountLines.recordedBalance,
    })
    .from(pharmacyCountLines)
    .innerJoin(pharmacyBatches, eq(pharmacyBatches.id, pharmacyCountLines.batchId))
    .where(eq(pharmacyCountLines.countId, countId));
}

/**
 * CD-3: the supplier's typed figures, batch by batch, written as a witnessed count event first; the
 * balances MedSync held are returned only with them, after the transaction commits. A figure cannot be
 * retyped: a repeat of the key returns this count, and counting again is a second count. Each batch that
 * differs gets a `pharmacy_controlled_differences` row (both figures, the supplier, the witness) and a
 * witnessed `count_correction` to the counted figure, so the supply proceeds from the count.
 */
export async function recordControlledCount(
  ctx: PharmacyCtx,
  input: z.infer<typeof ControlledCountInput>,
): Promise<{ id: string; lines: ControlledCountLine[]; differences: number }> {
  const [done] = await ctx.tx
    .select({ id: pharmacyCounts.id, hospitalId: pharmacyCounts.hospitalId })
    .from(pharmacyCounts)
    .where(eq(pharmacyCounts.id, input.clientKey));
  if (done) {
    if (done.hospitalId !== ctx.actor.hospitalId) throw conflict("That request key is in use.");
    const lines = await countLinesOf(ctx, done.id);
    return {
      id: done.id,
      lines,
      differences: lines.filter((l) => l.counted !== l.recorded).length,
    };
  }
  const witness = await standing(ctx, input.witnessAttestationId);
  const point = ctx.point!;
  const { rows, balances } = await batchesOf(ctx, input.medicineId);
  const required = countableBatches(rows, balances, localDate(ctx.now));
  const typed = new Map(input.lines.map((l) => [l.batchId, l.counted]));
  if (typed.size !== input.lines.length)
    throw new EmrWriteError("invalid", "Each batch is counted once.");
  for (const id of typed.keys())
    if (!rows.some((b) => b.id === id))
      throw new EmrWriteError(
        "not_found",
        "That batch is not this medicine at this dispensing point.",
      );
  const committed = commitCount({
    typedPerBatch: typed,
    balancesPerBatch: new Map(required.map((b) => [b.id, balances.get(b.id) ?? 0])),
  });
  if (!committed.ok)
    throw new EmrWriteError(
      "invalid",
      committed.reason === "missing_batch"
        ? `Type a figure for every batch in the cupboard: ${required
            .filter((b) => !typed.has(b.id))
            .map((b) => b.batchNumber)
            .join(", ")}.`
        : "Each count is a whole number, 0 or more.",
    );

  const [count] = await ctx.tx
    .insert(pharmacyCounts)
    .values({
      id: input.clientKey,
      hospitalId: ctx.actor.hospitalId,
      dispensingPointId: point.id,
      scope: input.scope,
      medicineId: input.medicineId,
      countedBy: ctx.actor.userId,
      witnessAttestationId: witness,
      countedAt: ctx.now,
    })
    .returning({ id: pharmacyCounts.id });
  await ctx.tx.insert(pharmacyCountLines).values(
    committed.count.map((l) => ({
      countId: count!.id,
      batchId: l.batchId,
      countedQuantity: l.counted,
      recordedBalance: balances.get(l.batchId) ?? 0,
    })),
  );
  for (const c of committed.corrections) {
    const d = committed.differences.find((x) => x.batchId === c.batchId)!;
    const [m] = await ctx.tx
      .insert(pharmacyStockMovements)
      .values({
        hospitalId: ctx.actor.hospitalId,
        dispensingPointId: point.id,
        batchId: c.batchId,
        kind: "count_correction",
        quantity: c.quantity,
        effectiveAt: ctx.now,
        actorUserId: ctx.actor.userId,
        reasonCode: "controlled_count",
        sourceKind: "count",
        sourceId: count!.id,
        witnessAttestationId: witness,
      })
      .returning({ id: pharmacyStockMovements.id });
    await ctx.tx.insert(pharmacyControlledDifferences).values({
      hospitalId: ctx.actor.hospitalId,
      dispensingPointId: point.id,
      countId: count!.id,
      batchId: c.batchId,
      countedQuantity: d.countedQuantity,
      recordedBalance: d.recordedBalance,
      supplierUserId: ctx.actor.userId,
      witnessAttestationId: witness,
      correctionMovementId: m!.id,
      recordedAt: ctx.now,
    });
  }
  await entry(ctx, {
    kind: "count",
    medicineId: input.medicineId,
    witness,
    countId: count!.id,
  });
  return {
    id: count!.id,
    lines: committed.count.map((l) => ({
      batchId: l.batchId,
      batchNumber: rows.find((b) => b.id === l.batchId)!.batchNumber,
      counted: l.counted,
      recorded: balances.get(l.batchId) ?? 0,
    })),
    differences: committed.differences.length,
  };
}

/* ─── recordControlledSupply (CD-2, S57–S65) ──────────────────────────── */

/**
 * CD-2: the whole hand-over, controlled and other lines, in this one transaction, through
 * `recordHandover`'s own engine (SU-1 to SU-4) once these hold: `pharmacy.controlled`; a standing
 * witness; both paper attestations; a count of each batch of each controlled medicine in the cupboard,
 * committed with this witness by this supplier; the witness's agreement with each balance. A
 * pharmacist's acceptance of every controlled line is the engine's re-check. Each controlled supply
 * row then gets a `supply` entry with the attestations, the count and the agreed balance.
 */
export async function recordControlledSupply(
  ctx: PharmacyCtx,
  input: z.infer<typeof ControlledSupplyInput>,
  /** ML-1: as `recordHandover`'s, decided by the action. */
  list: { patientList: boolean; explainRequired?: boolean } = { patientList: false },
): Promise<{ id: string; lines: HandoverOutcome[]; entryIds: string[] }> {
  mustHoldControlled(ctx);
  const replay = await supply.recordHandoverIfDone(ctx, input.clientKey);
  if (replay) return { ...replay, entryIds: await supplyEntriesOf(ctx, replay.id) };

  const witness = await standing(ctx, input.witnessAttestationId);
  if (!input.paperPrescriptionAttested) throw conflict(READY_COPY.paperPrescription);
  if (!input.registerAttested) throw conflict(READY_COPY.paperRegister);

  const h = await loadHospitalContext(dbOf(ctx), ctx.actor.hospitalId);
  const found = await loadGroupOfLine(dbOf(ctx), h, input.lines[0]!.lineId);
  if (!found) throw new EmrWriteError("not_found", "That prescription is not at your hospital.");
  const lineOf = new Map(found.group.lines.map((l) => [l.row.id, l]));
  const controlledLines = input.lines.filter((l) => lineOf.get(l.lineId)?.row.controlled);
  if (!controlledLines.length)
    throw conflict("This hand-over has no controlled line. Use the hand-over.");
  const medicines = [...new Set(controlledLines.map((l) => lineOf.get(l.lineId)!.row.drugId))];

  // The count: every batch in the cupboard of each controlled medicine, committed with this witness.
  const countOf = new Map<string, string>();
  for (const medicineId of medicines) {
    const { rows, balances } = await batchesOf(ctx, medicineId);
    const counts = await ctx.tx
      .select({ id: pharmacyCounts.id, batchId: pharmacyCountLines.batchId })
      .from(pharmacyCounts)
      .innerJoin(pharmacyCountLines, eq(pharmacyCountLines.countId, pharmacyCounts.id))
      .where(
        and(
          eq(pharmacyCounts.hospitalId, ctx.actor.hospitalId),
          eq(pharmacyCounts.dispensingPointId, ctx.point!.id),
          eq(pharmacyCounts.medicineId, medicineId),
          eq(pharmacyCounts.scope, "controlled_supply"),
          eq(pharmacyCounts.countedBy, ctx.actor.userId),
          eq(pharmacyCounts.witnessAttestationId, witness),
        ),
      )
      .orderBy(desc(pharmacyCounts.countedAt));
    const counted = new Set(counts.map((c) => c.batchId));
    const required = countableBatches(rows, balances, localDate(ctx.now));
    if (!required.length || required.some((b) => !counted.has(b.id)))
      throw conflict(READY_COPY.count);
    countOf.set(medicineId, counts[0]!.id);
  }
  const agreed = new Map(input.agreedBalances.map((a) => [a.medicineId, a.balance]));
  if (medicines.some((m) => !agreed.has(m))) throw conflict(READY_COPY.witnessAgreement);

  const {
    witnessAttestationId: _w,
    paperPrescriptionAttested: _p,
    registerAttested: _r,
    agreedBalances: _a,
    ...handover
  } = input;
  const r = await supply.recordHandover(ctx, handover, { witnessAttestationId: witness }, list);

  // B-50: the balance the witness agreed is the balance after this supply, or nothing is written.
  for (const medicineId of medicines) {
    const { balances } = await batchesOf(ctx, medicineId);
    const now = [...balances.values()].reduce((a, b) => a + b, 0);
    if (now !== agreed.get(medicineId))
      throw conflict(
        `The balance after this supply is ${now}, not ${agreed.get(medicineId)}. Count again with the witness.`,
      );
  }
  const supplied = await ctx.tx
    .select({
      movementId: pharmacyStockMovements.id,
      lineId: pharmacySupplies.prescriptionId,
    })
    .from(pharmacySupplies)
    .innerJoin(
      pharmacyStockMovements,
      and(
        eq(pharmacyStockMovements.sourceId, pharmacySupplies.id),
        eq(pharmacyStockMovements.sourceKind, "supply"),
      ),
    )
    .where(eq(pharmacySupplies.handoverId, r.id));
  const entryIds: string[] = [];
  for (const s of supplied) {
    const line = s.lineId ? lineOf.get(s.lineId) : undefined;
    if (!line?.row.controlled) continue;
    entryIds.push(
      await entry(ctx, {
        kind: "supply",
        medicineId: line.row.drugId,
        witness,
        handoverId: r.id,
        movementId: s.movementId,
        countId: countOf.get(line.row.drugId)!,
        paper: true,
        register: true,
        agreed: agreed.get(line.row.drugId)!,
      }),
    );
  }
  return { id: r.id, lines: r.lines, entryIds };
}

async function supplyEntriesOf(ctx: PharmacyCtx, handoverId: string) {
  return (
    await ctx.tx
      .select({ id: pharmacyControlledEntries.id })
      .from(pharmacyControlledEntries)
      .where(
        and(
          eq(pharmacyControlledEntries.handoverId, handoverId),
          eq(pharmacyControlledEntries.kind, "supply"),
        ),
      )
  ).map((e) => e.id);
}

/* ─── The in-charge, the slip, the back-entry ─────────────────────────── */

/** CD-3: the pharmacy in charge closes an open difference with a note. Only the closing changes. */
export async function closeControlledDifference(
  ctx: PharmacyCtx,
  input: z.infer<typeof CloseDifferenceInput>,
) {
  const [d] = await ctx.tx
    .select({
      id: pharmacyControlledDifferences.id,
      closedAt: pharmacyControlledDifferences.closedAt,
    })
    .from(pharmacyControlledDifferences)
    .where(
      and(
        eq(pharmacyControlledDifferences.id, input.differenceId),
        eq(pharmacyControlledDifferences.hospitalId, ctx.actor.hospitalId),
      ),
    )
    .for("update");
  if (!d) throw new EmrWriteError("not_found", "That difference is not at your hospital.");
  if (d.closedAt) throw conflict("This difference is already closed.");
  await ctx.tx
    .update(pharmacyControlledDifferences)
    .set({ closedAt: ctx.now, closedBy: ctx.actor.userId, closeNote: input.note })
    .where(
      and(
        eq(pharmacyControlledDifferences.id, d.id),
        isNull(pharmacyControlledDifferences.closedAt),
      ),
    );
  return { id: d.id };
}

/** LB-7, LB-4: a print of the register slip (one entry, or the screen before recording), logged. */
export async function printRegisterEntry(
  ctx: PharmacyCtx,
  input: z.infer<typeof PrintRegisterInput>,
) {
  const [done] = await ctx.tx
    .select({ id: pharmacyPrintEvents.id })
    .from(pharmacyPrintEvents)
    .where(eq(pharmacyPrintEvents.id, input.clientKey));
  if (done) return { id: done.id };
  if (input.entryId) {
    const [e] = await ctx.tx
      .select({ id: pharmacyControlledEntries.id })
      .from(pharmacyControlledEntries)
      .where(
        and(
          eq(pharmacyControlledEntries.id, input.entryId),
          eq(pharmacyControlledEntries.hospitalId, ctx.actor.hospitalId),
        ),
      );
    if (!e) throw new EmrWriteError("not_found", "That entry is not at your hospital.");
  }
  const [row] = await ctx.tx
    .insert(pharmacyPrintEvents)
    .values({
      id: input.clientKey,
      hospitalId: ctx.actor.hospitalId,
      dispensingPointId: ctx.point!.id,
      kind: "register_entry",
      refId: input.entryId,
      actorUserId: ctx.actor.userId,
      printedAt: ctx.now,
    })
    .returning({ id: pharmacyPrintEvents.id });
  return { id: row!.id };
}

/** DT-8: a back-entered controlled supply, confirmed against the register with a witness. */
export async function confirmBackEnteredControlledSupply(
  ctx: PharmacyCtx,
  input: z.infer<typeof ConfirmBackEntryInput>,
) {
  const [done] = await ctx.tx
    .select({ id: pharmacyControlledEntries.id })
    .from(pharmacyControlledEntries)
    .where(eq(pharmacyControlledEntries.confirmsEntryId, input.entryId));
  if (done) return { id: done.id };
  const witness = await standing(ctx, input.witnessAttestationId);
  const [e] = await ctx.tx
    .select({
      id: pharmacyControlledEntries.id,
      medicineId: pharmacyControlledEntries.medicineId,
      pointId: pharmacyControlledEntries.dispensingPointId,
    })
    .from(pharmacyControlledEntries)
    .where(
      and(
        eq(pharmacyControlledEntries.id, input.entryId),
        eq(pharmacyControlledEntries.hospitalId, ctx.actor.hospitalId),
        eq(pharmacyControlledEntries.kind, "back_entered_supply"),
      ),
    );
  if (!e) throw new EmrWriteError("not_found", "That entry is not waiting for confirmation here.");
  return {
    id: await entry(ctx, {
      kind: "back_entry_confirmed",
      medicineId: e.medicineId,
      pointId: e.pointId ?? undefined,
      witness,
      confirmsEntryId: e.id,
    }),
  };
}

/* ─── Witnessed stock actions and reversals (CD-5) ────────────────────── */

type WithWitness<T> = T & { witnessAttestationId: string };

/** CD-5: receive a controlled product, witnessed. */
export async function receiveControlled(
  ctx: PharmacyCtx,
  input: WithWitness<z.infer<typeof stock.ReceiveInput>>,
) {
  mustHoldControlled(ctx);
  const witness = await standing(ctx, input.witnessAttestationId);
  const r = await stock.receiveStock(ctx, input, witness);
  const medicineId = await medicineOfMovement(ctx, r.id);
  await entry(ctx, { kind: "receipt", medicineId, witness, movementId: r.id });
  return { id: r.id };
}

/** CD-5: adjust a controlled batch, witnessed. */
export async function adjustControlled(
  ctx: PharmacyCtx,
  input: WithWitness<z.infer<typeof stock.AdjustInput>>,
) {
  mustHoldControlled(ctx);
  const witness = await standing(ctx, input.witnessAttestationId);
  const r = await stock.adjustStock(ctx, input, witness);
  const medicineId = await medicineOfMovement(ctx, r.id);
  await entry(ctx, { kind: "adjustment", medicineId, witness, movementId: r.id });
  return { id: r.id };
}

/** CD-5: send a controlled batch to another point, witnessed; an entry at each end. */
export async function transferControlled(
  ctx: PharmacyCtx,
  input: WithWitness<z.infer<typeof stock.TransferInput>>,
) {
  mustHoldControlled(ctx);
  const witness = await standing(ctx, input.witnessAttestationId);
  const r = await stock.transferStock(ctx, input, witness);
  const medicineId = await medicineOfMovement(ctx, r.id);
  await entry(ctx, { kind: "transfer", medicineId, witness, movementId: r.id });
  const [arrived] = await ctx.tx
    .select({
      id: pharmacyStockMovements.id,
      pointId: sql<string>`${pharmacyStockMovements.dispensingPointId}`,
    })
    .from(pharmacyStockMovements)
    .where(
      and(
        eq(pharmacyStockMovements.sourceKind, "transfer"),
        eq(pharmacyStockMovements.sourceId, r.id),
        eq(pharmacyStockMovements.kind, "transfer_in"),
      ),
    );
  if (arrived)
    await entry(ctx, {
      kind: "transfer",
      medicineId,
      witness,
      movementId: arrived.id,
      pointId: arrived.pointId,
    });
  return { id: r.id };
}

/** CD-5: correct a controlled batch's number or expiry, witnessed (the in-charge's own action). */
export async function correctBatchControlled(
  ctx: PharmacyCtx,
  input: WithWitness<z.infer<typeof stock.CorrectInput>>,
) {
  mustHoldControlled(ctx);
  const [done] = await ctx.tx
    .select({ id: pharmacyBatchCorrections.id })
    .from(pharmacyBatchCorrections)
    .where(eq(pharmacyBatchCorrections.id, input.clientKey));
  if (done) return { id: done.id };
  const witness = await standing(ctx, input.witnessAttestationId);
  const r = await stock.correctBatchDetails(ctx, input, witness);
  const [b] = await ctx.tx
    .select({ medicineId: pharmacyProducts.medicineId })
    .from(pharmacyBatches)
    .innerJoin(pharmacyProducts, eq(pharmacyProducts.id, pharmacyBatches.productId))
    .where(eq(pharmacyBatches.id, input.batchId));
  await entry(ctx, { kind: "batch_correction", medicineId: b!.medicineId, witness });
  return { id: r.id };
}

/** CD-5, SU-11: reverse a controlled supply, witnessed; an entry for each returned movement. */
export async function reverseControlled(
  ctx: PharmacyCtx,
  input: WithWitness<z.infer<typeof supply.ReverseInput>>,
) {
  mustHoldControlled(ctx);
  const witness = await standing(ctx, input.witnessAttestationId);
  const r = await supply.reverseSupply(ctx, input, witness);
  const rows = await ctx.tx
    .select({
      movementId: pharmacySupplyReversals.returnedMovementId,
      medicineId: pharmacyProducts.medicineId,
    })
    .from(pharmacySupplyReversals)
    .innerJoin(pharmacySupplies, eq(pharmacySupplies.id, pharmacySupplyReversals.supplyId))
    .innerJoin(pharmacyProducts, eq(pharmacyProducts.id, pharmacySupplies.productId))
    .where(
      and(
        eq(pharmacySupplies.handoverId, input.handoverId),
        eq(pharmacySupplies.prescriptionId, input.lineId),
      ),
    );
  for (const m of rows)
    await entry(ctx, {
      kind: "reversal",
      medicineId: m.medicineId,
      witness,
      movementId: m.movementId,
      handoverId: input.handoverId,
    });
  return { id: r.id };
}

/** CD-5, SU-14: mark a controlled supply recorded in error, witnessed. It moves no stock. */
export async function correctRecordControlled(
  ctx: PharmacyCtx,
  input: WithWitness<z.infer<typeof supply.CorrectInput>>,
) {
  mustHoldControlled(ctx);
  const witness = await standing(ctx, input.witnessAttestationId);
  const r = await supply.correctSupplyRecord(ctx, input, witness);
  const [s] = await ctx.tx
    .select({ medicineId: pharmacyProducts.medicineId })
    .from(pharmacySupplyCorrections)
    .innerJoin(pharmacySupplies, eq(pharmacySupplies.id, pharmacySupplyCorrections.supplyId))
    .innerJoin(pharmacyProducts, eq(pharmacyProducts.id, pharmacySupplies.productId))
    .where(eq(pharmacySupplyCorrections.id, r.id));
  const [already] = await ctx.tx
    .select({ id: pharmacyControlledEntries.id })
    .from(pharmacyControlledEntries)
    .where(
      and(
        eq(pharmacyControlledEntries.handoverId, input.handoverId),
        eq(pharmacyControlledEntries.kind, "correction"),
      ),
    );
  if (s && !already)
    await entry(ctx, {
      kind: "correction",
      medicineId: s.medicineId,
      witness,
      handoverId: input.handoverId,
    });
  return { id: r.id };
}

async function medicineOfMovement(ctx: PharmacyCtx, movementId: string): Promise<string> {
  const [m] = await ctx.tx
    .select({ medicineId: pharmacyProducts.medicineId })
    .from(pharmacyStockMovements)
    .innerJoin(pharmacyBatches, eq(pharmacyBatches.id, pharmacyStockMovements.batchId))
    .innerJoin(pharmacyProducts, eq(pharmacyProducts.id, pharmacyBatches.productId))
    .where(eq(pharmacyStockMovements.id, movementId));
  return m?.medicineId ?? "";
}
