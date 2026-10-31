import type { DeliveryLine, LineRefusal } from "./receiving";
import type { EmrTx } from "@/lib/emr/db";
import type { Registration } from "@/lib/pharmacy/shared-catalogue/receive";
import type { PharmacyCtx } from "@/lib/pharmacy/write";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { CATALOGUE } from "@/content/pharmacy-catalogue";
import { STOCK_UP_POLISH } from "@/content/pharmacy-stock-up-polish";
import { STORE } from "@/content/pharmacy-stores-store";
import {
  pharmacyBatches,
  pharmacyHospitalSettings,
  pharmacyPrintEvents,
  pharmacyProducts,
} from "@/db/schema/pharmacy-dispensing";
import {
  pharmacyDeliveries,
  pharmacyDeliveryLines,
  pharmacyOrderLines,
  pharmacyOrders,
} from "@/db/schema/pharmacy-stores";
import { rowsOf } from "@/lib/exchange/store";
import { catalogueMedicineClass } from "@/lib/pharmacy/controlled-read";
import { controlledListLive } from "@/lib/pharmacy/controlled-substances";
import { pharmacyCatalogueLiveFor } from "@/lib/pharmacy/feature";
import {
  packsToUnits,
  registrationState,
  rescanTarget,
} from "@/lib/pharmacy/shared-catalogue/receive";
import { resolveScan } from "@/lib/pharmacy/shared-catalogue/scan";
import { catalogueKey, linkProducts } from "@/lib/pharmacy/shared-catalogue/store";
import { localDate } from "@/lib/pharmacy/stock/ledger";
import { drugById } from "@/lib/prescribing/formulary";
import {
  controlledSet,
  counterpartyOf,
  expiryField,
  productAt,
  quarantineFor,
  storeWitness,
} from "./location-store";
import { deliveryMovements, deliveryNext, lineRefusals } from "./receiving";
import { batchAtLocation, fail, loadLocation, move, requireLive } from "./write";

/**
 * Deliveries, written (Pharmacy Phase 2, 5.2, RG-1 to RG-6; Section 8 startDelivery, saveDeliveryLine,
 * recordShortDatedDecision, receiveDelivery, abandonDelivery, printDiscrepancyReport, printGrn). The engine
 * (receiving.ts) decides every line's results and refusals; this file only reads, locks and writes. Only a
 * `received` delivery moves stock: one transaction writes a `received` movement per batch at the counted
 * quantity, accepted at the receiving place, rejected-and-kept straight into quarantine, and nothing for what
 * went back with the deliverer (RG-3). Law 4: whole issue units, never converted.
 */

const key = z.uuid();
const qty = z.number().int().min(0).max(1_000_000);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((s) => (s ? s : null));

/** "YYYY-MM-DD HH:MM" (or with a T) in Kampala time (UTC+3, no daylight saving), as typed on the delivery. */
export function parseArrival(s: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:00+03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const StartDeliveryInput = z.object({
  clientKey: key,
  supplierId: z.uuid({ message: "Choose the supplier." }),
  noteNumber: z.string().trim().min(1, "Type the delivery note number.").max(80),
  orderId: z.uuid().nullish(),
  arrivedAt: z.string().transform((s, c) => {
    const d = parseArrival(s);
    if (!d) c.addIssue({ code: "custom", message: "Give when it arrived as YYYY-MM-DD HH:MM." });
    return d ?? new Date(0);
  }),
  locationId: z.uuid({ message: "Choose where it is received." }),
  witnessName: optional(120),
  delivererName: optional(120),
  vehicleRegistration: optional(20),
});

/** 5.2 Start a delivery: at a store, or a dispensing point that receives directly; live (Law 7). */
export async function startDelivery(ctx: PharmacyCtx, input: z.infer<typeof StartDeliveryInput>) {
  const h = ctx.actor.hospitalId;
  const [again] = await ctx.tx
    .select({ id: pharmacyDeliveries.id, h: pharmacyDeliveries.hospitalId })
    .from(pharmacyDeliveries)
    .where(eq(pharmacyDeliveries.id, input.clientKey));
  if (again) {
    if (again.h !== h) throw fail("conflict", "That request key is already in use.");
    return { id: again.id };
  }
  if (input.arrivedAt.getTime() > ctx.now.getTime() + 5 * 60_000)
    throw fail("invalid", "It cannot have arrived in the future.");
  const l = await loadLocation(ctx.tx, h, input.locationId);
  if (l.kind !== "store" && l.kind !== "dispensing_point")
    throw fail("invalid", "A delivery is received at a store or a dispensing point.");
  requireLive(l);
  await counterpartyOf(ctx.tx, h, input.supplierId, "supplier");
  if (input.orderId) {
    const [o] = await ctx.tx
      .select({ state: pharmacyOrders.state })
      .from(pharmacyOrders)
      .where(and(eq(pharmacyOrders.id, input.orderId), eq(pharmacyOrders.hospitalId, h)));
    if (!o || o.state !== "open")
      throw fail("not_found", "That order is not open at this hospital.");
  }
  try {
    const [row] = await ctx.tx
      .insert(pharmacyDeliveries)
      .values({
        id: input.clientKey,
        hospitalId: h,
        locationId: l.id,
        supplierId: input.supplierId,
        noteNumber: input.noteNumber,
        orderId: input.orderId ?? null,
        arrivedAt: input.arrivedAt,
        countedBy: ctx.actor.userId,
        witnessName: input.witnessName,
        delivererName: input.delivererName,
        vehicleRegistration: input.vehicleRegistration,
        createdAt: ctx.now,
      })
      .returning({ id: pharmacyDeliveries.id });
    return { id: row!.id };
  } catch (e) {
    if (/pd_note/.test(String(e) + String((e as { cause?: unknown }).cause ?? "")))
      throw fail("conflict", "That delivery note from this supplier is already recorded.");
    throw e;
  }
}

/** The delivery, locked, still being counted. */
async function counting(tx: EmrTx, hospitalId: string, deliveryId: string) {
  const [d] = await tx
    .select()
    .from(pharmacyDeliveries)
    .where(
      and(eq(pharmacyDeliveries.id, deliveryId), eq(pharmacyDeliveries.hospitalId, hospitalId)),
    )
    .for("update");
  if (!d) throw fail("not_found", "That delivery is not at this hospital.");
  if (d.state !== "counting")
    throw fail("conflict", "This delivery is finished. It does not change.");
  return d;
}

export const DeliveryLineInput = z
  .object({
    deliveryId: z.uuid(),
    lineNo: z.number().int().min(1).max(999),
    remove: z.boolean().optional(),
    productId: z.uuid({ message: "Choose the product delivered." }),
    noteProductId: z.uuid().nullish(),
    orderLineId: z.uuid().nullish(),
    noteQuantity: qty.nullish(),
    accepted: qty,
    rejectedKept: qty,
    rejectedReturned: qty,
    rejectReason: z.enum(["damaged", "wrong_product", "expired", "short_dated", "other"]).nullish(),
    batchNumber: optional(60),
    expiry: expiryField.nullish().or(z.literal("").transform(() => null)),
    unitCost: z
      .string()
      .trim()
      .regex(/^\d{1,12}(\.\d{1,2})?$/, "Give the unit cost in Uganda shillings, for example 1500.")
      .nullish()
      .or(z.literal("").transform(() => null)),
    shortDatedDecision: z.enum(["accept", "accept_tell", "reject"]).nullish(),
    note: optional(300),
    // Catalogue slice Step 7 (0256).
    packs: qty.nullish(),
    identitySource: z.enum(["scan", "catalogue", "typed"]).nullish(),
    registrationReason: z
      .enum(["donation", "no_registered_alternative", "renewal_pending", "other"])
      .nullish(),
    registrationNote: optional(300),
  })
  .refine((v) => v.rejectedKept + v.rejectedReturned === 0 || !!v.rejectReason, {
    message: "Say why it was rejected.",
    path: ["rejectReason"],
  })
  .refine((v) => v.accepted + v.rejectedKept === 0 || (!!v.batchNumber && !!v.expiry), {
    message: "Give the batch and the expiry of what enters stock.",
    path: ["batchNumber"],
  });

/** 5.2 Lines: one line saved (or removed) while the delivery is counted. Nothing moves until it is received. */
export async function saveDeliveryLine(ctx: PharmacyCtx, input: z.infer<typeof DeliveryLineInput>) {
  const d = await counting(ctx.tx, ctx.actor.hospitalId, input.deliveryId);
  const where = and(
    eq(pharmacyDeliveryLines.deliveryId, d.id),
    eq(pharmacyDeliveryLines.lineNo, input.lineNo),
  );
  if (input.remove) {
    await ctx.tx.delete(pharmacyDeliveryLines).where(where);
    return { id: d.id };
  }
  const product = await productAt(ctx.tx, ctx.actor.hospitalId, input.productId);
  if (input.noteProductId) await productAt(ctx.tx, ctx.actor.hospitalId, input.noteProductId);
  const facts = await catalogueFacts(ctx.tx, product.id, ctx.actor.hospitalId);
  const R = CATALOGUE.receive;
  if (input.packs != null) {
    const units = packsToUnits(input.packs, facts.contents);
    if (units === null) throw fail("invalid", R.notWhole(product.issueUnit));
    if (units !== input.accepted) throw fail("invalid", R.mismatch);
  }
  const entering = input.accepted + input.rejectedKept > 0;
  if (facts.registration && entering && !input.registrationReason)
    throw fail("invalid", R.registration.needed(input.lineNo, facts.registration));
  if (input.registrationReason === "other" && (input.registrationNote ?? "").length < 3)
    throw fail("invalid", R.registration.noteNeeded);
  if (input.orderLineId) {
    const [ol] = await ctx.tx
      .select({ id: pharmacyOrderLines.id })
      .from(pharmacyOrderLines)
      .where(
        and(
          eq(pharmacyOrderLines.id, input.orderLineId),
          eq(pharmacyOrderLines.orderId, d.orderId ?? ""),
        ),
      );
    if (!d.orderId || !ol)
      throw fail("not_found", "That line is not on the order this delivery fills.");
  }
  const values = {
    productId: input.productId,
    noteProductId:
      input.noteProductId && input.noteProductId !== input.productId ? input.noteProductId : null,
    orderLineId: input.orderLineId ?? null,
    noteQuantity: input.noteQuantity ?? null,
    acceptedQuantity: input.accepted,
    rejectedKeptQuantity: input.rejectedKept,
    rejectedReturnedQuantity: input.rejectedReturned,
    rejectReason:
      input.rejectedKept + input.rejectedReturned > 0 ? (input.rejectReason ?? null) : null,
    batchNumber: input.batchNumber,
    expiry: input.expiry?.expiry ?? null,
    expiryMonthOnly: input.expiry?.monthOnly ?? false,
    unitCost: input.unitCost ?? null,
    shortDatedDecision: input.shortDatedDecision ?? null,
    note: input.note,
    packs: input.packs ?? null,
    packContents: input.packs != null ? facts.contents : null,
    identitySource: input.identitySource ?? null,
    registrationReason: facts.registration ? (input.registrationReason ?? null) : null,
    registrationNote: facts.registration ? input.registrationNote : null,
    updatedAt: ctx.now,
  };
  const [row] = await ctx.tx
    .insert(pharmacyDeliveryLines)
    .values({ deliveryId: d.id, lineNo: input.lineNo, ...values })
    .onConflictDoUpdate({
      target: [pharmacyDeliveryLines.deliveryId, pharmacyDeliveryLines.lineNo],
      set: values,
    })
    .returning({ id: pharmacyDeliveryLines.id });
  return { id: row!.id };
}

export interface CatalogueFacts {
  /** The pack's whole contents in issue units, or null (count in issue units, Law 4). */
  contents: number | null;
  registration: Registration;
}

/** What the catalogue says of the hospital's products at receipt (one, or all): pack contents and registration. */
export async function productCatalogueFacts(
  tx: EmrTx,
  hospitalId: string,
  productId?: string,
): Promise<Map<string, CatalogueFacts>> {
  if (!pharmacyCatalogueLiveFor(hospitalId)) return new Map();
  const rows = rowsOf<{
    id: string;
    contents: number | null;
    nda_state: string | null;
    answer: string | null;
    registration_number: string | null;
  }>(
    await tx.execute(sql`
      SELECT p.id, k.contents, c.nda_state, r.payload->'registration'->>'answer' AS answer, p.registration_number
        FROM public.pharmacy_products p
        LEFT JOIN public.cat_packs k ON k.id = p.catalogue_pack_id
        LEFT JOIN public.cat_products c ON c.id = k.product_id
        LEFT JOIN public.cat_proposals r ON r.id = p.local_proposal_id
       WHERE p.hospital_id = ${hospitalId} ${productId ? sql`AND p.id = ${productId}` : sql``}`),
  );
  return new Map(
    rows.map((f) => [
      f.id,
      {
        contents: f.contents,
        registration: registrationState({
          ndaState: f.nda_state,
          answer: f.answer,
          registrationNumber: f.registration_number,
        }),
      },
    ]),
  );
}

const NO_FACTS: CatalogueFacts = { contents: null, registration: null };
export const catalogueFacts = async (tx: EmrTx, productId: string, hospitalId: string) =>
  (await productCatalogueFacts(tx, hospitalId, productId)).get(productId) ?? NO_FACTS;

/** The hospital's active products linked to a catalogue pack (Law 5: the caller uses it only when there is one). */
export async function productsForPack(tx: EmrTx, hospitalId: string, packId: string) {
  return rowsOf<{ id: string }>(
    await tx.execute(sql`SELECT id FROM public.pharmacy_products
      WHERE hospital_id = ${hospitalId} AND active AND catalogue_pack_id = ${packId}`),
  ).map((r) => r.id);
}

export const DeliveryScanInput = z.object({
  deliveryId: z.uuid(),
  raw: z.string().trim().min(1).max(300),
});

export type DeliveryScanResult =
  | { id: string; kind: "added" | "rescan"; lineNo: number; counted: number; note: string }
  | { id: string; kind: "unknown"; gtin: string | null; note: string }
  | {
      id: string;
      kind: "refused" | "no_product" | "several" | "conflict" | "text" | "no_contents";
      note: string;
    };

/**
 * 4.1 The scan field (catalogue slice Step 7, D-CAT-09). The code resolves through the hospital's own product, its
 * local link, then the shared link (`resolveScan`); a pack resolves to the one product linked to it here, never a
 * guess. The same product and batch again adds one pack to its line and says so; otherwise a new line opens with
 * the batch and expiry a 2D code gives and one pack counted. Nothing moves until the delivery is received.
 */
export async function scanIntoDelivery(
  ctx: PharmacyCtx,
  input: z.infer<typeof DeliveryScanInput>,
): Promise<DeliveryScanResult> {
  const h = ctx.actor.hospitalId;
  const d = await counting(ctx.tx, h, input.deliveryId);
  const R = CATALOGUE.receive;
  const r = await resolveScan(ctx.tx, h, input.raw);
  const id = d.id;
  if (r.kind === "refused") return { id, kind: "refused", note: CATALOGUE.checkDigit };
  if (r.kind === "text") return { id, kind: "text", note: R.text };
  if (r.kind === "conflict") return { id, kind: "conflict", note: R.conflict };
  if (r.kind === "unknown")
    return { id, kind: "unknown", gtin: r.scan.gtin, note: CATALOGUE.newBarcodeTitle };
  let productId: string;
  let said: string | null = null;
  if (r.kind === "product") productId = r.productId;
  else {
    // Owner item 11: a known pack with no product here gets one, as a pick does.
    const p = await productForPick(ctx, { packId: r.packId });
    if (!("id" in p)) return { id, ...p };
    ({ id: productId, said } = p);
  }
  const product = await productAt(ctx.tx, h, productId);
  const { contents } = await catalogueFacts(ctx.tx, productId, h);
  const lines = await ctx.tx
    .select()
    .from(pharmacyDeliveryLines)
    .where(eq(pharmacyDeliveryLines.deliveryId, d.id));
  const scan = r.scan;
  const target = rescanTarget(lines, productId, scan?.batch ?? null);
  const serial = scan?.serial ? [scan.serial] : [];
  if (target !== null) {
    const line = lines.find((l) => l.lineNo === target)!;
    if (contents === null || (line.packs === null && line.acceptedQuantity > 0))
      return { id, kind: "no_contents", note: R.noContents(target) };
    const packs = (line.packs ?? 0) + 1;
    await ctx.tx
      .update(pharmacyDeliveryLines)
      .set({
        packs,
        packContents: contents,
        acceptedQuantity: packs * contents,
        serials: [...(line.serials ?? []), ...serial],
        updatedAt: ctx.now,
      })
      .where(eq(pharmacyDeliveryLines.id, line.id));
    return { id, kind: "rescan", lineNo: target, counted: packs, note: CATALOGUE.rescan(packs) };
  }
  const lineNo = Math.max(0, ...lines.map((l) => l.lineNo)) + 1;
  await ctx.tx.insert(pharmacyDeliveryLines).values({
    deliveryId: d.id,
    lineNo,
    productId: product.id,
    acceptedQuantity: contents ?? 0,
    packs: contents === null ? null : 1,
    packContents: contents,
    batchNumber: scan?.batch ?? null,
    expiry: scan?.expiry ?? null,
    expiryMonthOnly: scan?.expiryMonthOnly ?? false,
    serials: serial.length ? serial : null,
    identitySource: "scan",
    updatedAt: ctx.now,
  });
  return {
    id,
    kind: "added",
    lineNo,
    counted: contents === null ? 0 : 1,
    note: [R.added(lineNo), said, contents === null ? R.noContents(lineNo) : null]
      .filter(Boolean)
      .join(" "),
  };
}

export const DeliveryPickInput = z
  .object({
    deliveryId: z.uuid(),
    productId: z.uuid().nullish(),
    packId: z.uuid().nullish(),
    /** A catalogue medicine picked "Unbranded · loose": no pack, counted in issue units. */
    medicineId: z.uuid().nullish(),
  })
  .refine(
    (v) => [v.productId, v.packId, v.medicineId].filter(Boolean).length === 1,
    "Pick one product, one pack or one medicine.",
  );

type Refusal = { kind: "refused" | "no_product" | "several"; note: string };

/**
 * Owner item 11 (MedSync prepares, people confirm): the hospital's product for a picked catalogue pack, or a medicine
 * picked loose. One linked product is reused; several are left for a person to choose. None: the product is made
 * from the catalogue's own facts, in this transaction (or, if the hospital has exactly one product of that medicine
 * not yet linked to the catalogue, that product is linked instead), only where its controlled class is known (D-CAT-18): a health
 * supply (never controlled) under its catalogue key, or a medicine linked to exactly one prescribing-list medicine
 * (whose signed class it takes), or (ADR 0470) a medicine off the prescribing list as a local medicine under its
 * catalogue key, its class from the signed substance list. Anything else is refused in words, nothing written.
 */
async function productForPick(
  ctx: PharmacyCtx,
  pick: { packId: string } | { medicineId: string },
): Promise<{ id: string; said: string | null } | Refusal> {
  const h = ctx.actor.hospitalId;
  const R = CATALOGUE.receive;
  const P = STOCK_UP_POLISH.make;
  const linked =
    "packId" in pick
      ? await productsForPack(ctx.tx, h, pick.packId)
      : rowsOf<{ id: string }>(
          await ctx.tx.execute(sql`SELECT id FROM public.pharmacy_products
            WHERE hospital_id = ${h} AND active AND catalogue_medicine_id = ${pick.medicineId}
              AND catalogue_pack_id IS NULL`),
        ).map((r) => r.id);
  if (linked.length > 1)
    return { kind: "several", note: "packId" in pick ? R.severalProducts : P.severalLoose };
  if (linked.length === 1) return { id: linked[0]!, said: null };

  const [pack] =
    "packId" in pick
      ? rowsOf<{
          medicine_id: string;
          brand: string | null;
          maker: string | null;
          description: string;
        }>(
          await ctx.tx.execute(sql`
            SELECT p.medicine_id, p.brand_name AS brand, f.name AS maker, k.description
              FROM public.cat_packs k JOIN public.cat_products p ON p.id = k.product_id
              LEFT JOIN public.cat_manufacturers f ON f.id = p.manufacturer_id
             WHERE k.id = ${pick.packId} AND k.status = 'active' AND p.status = 'active'`),
        )
      : [null];
  const medicineId = "packId" in pick ? pack?.medicine_id : pick.medicineId;
  const [m] = medicineId
    ? rowsOf<{
        display_name: string;
        kind: "medicine" | "health_supply" | "other";
        strength_text: string | null;
        issue_unit_kind: string | null;
        formulary: string[];
      }>(
        await ctx.tx.execute(sql`
          SELECT m.display_name, m.kind, m.strength_text, m.issue_unit_kind,
                 ARRAY(SELECT l.formulary_id FROM public.cat_medicine_links l
                        WHERE l.medicine_id = m.id AND l.link_kind = 'formulary' ORDER BY 1) AS formulary
            FROM public.cat_medicines m WHERE m.id = ${medicineId} AND m.status = 'active'`),
      )
    : [];
  if (!m) return { kind: "no_product", note: R.noProduct };
  const supply = m.kind === "health_supply";
  // ADR 0470 (superseding D-CAT-18 for catalogue medicines): a medicine off the prescribing list is a local medicine
  // whose controlled class comes from the signed substance list, by its ingredients. While that list is unsigned in
  // production (CS-5), refused as before; a medicine with no ingredient listed is refused, never guessed.
  const local = !supply && m.formulary.length === 0;
  let controlled: string | null = null;
  if (local) {
    if (!controlledListLive()) return { kind: "refused", note: CATALOGUE.supply.medicines };
    const c = await catalogueMedicineClass(ctx.tx, medicineId!);
    if (c === "unknown") return { kind: "refused", note: STOCK_UP_POLISH.controlled.noIngredients };
    controlled = c;
  }
  const formularyId = m.formulary[0];
  if (!supply && !local && (m.formulary.length > 1 || !drugById(formularyId!)))
    return { kind: "refused", note: P.unclear };
  const key = supply || local ? catalogueKey(medicineId!) : formularyId!;
  const cataloguePackId = "packId" in pick ? pick.packId : null;

  // A product of the same medicine here that is not linked to the catalogue yet is linked, not doubled.
  const unlinked = rowsOf<{ id: string; name: string }>(
    await ctx.tx.execute(sql`SELECT id, name FROM public.pharmacy_products
      WHERE hospital_id = ${h} AND active AND medicine_id = ${key} AND catalogue_medicine_id IS NULL`),
  );
  if (unlinked.length > 1) return { kind: "several", note: P.severalUnlinked };
  if (unlinked.length === 1) {
    await linkProducts(ctx.tx, ctx.actor, [
      { productId: unlinked[0]!.id, catalogueMedicineId: medicineId!, cataloguePackId },
    ]);
    return { id: unlinked[0]!.id, said: P.linked(unlinked[0]!.name) };
  }

  if (!m.issue_unit_kind) return { kind: "refused", note: P.noIssueUnit };
  const name = pack?.brand ?? m.display_name;
  const [row] = await ctx.tx
    .insert(pharmacyProducts)
    .values({
      hospitalId: h,
      medicineId: key,
      itemKind: supply ? "health_supply" : local ? "local_medicine" : "formulary",
      name,
      manufacturer: pack?.maker ?? null,
      strength: m.strength_text,
      packSize: pack?.description ?? null,
      issueUnit: m.issue_unit_kind,
      catalogueMedicineId: medicineId!,
      cataloguePackId,
      addedAtWindow: false,
      createdBy: ctx.actor.userId,
    })
    .returning({ id: pharmacyProducts.id });
  return {
    id: row!.id,
    said: controlled
      ? `${P.made(name)} ${STOCK_UP_POLISH.controlled.made(controlled)}`
      : P.made(name),
  };
}

/**
 * 4.1 Ctrl K: a product, a catalogue pack or a medicine picked loose opens a line with nothing counted yet; the line
 * is then counted in its own dialog. `identity_source` is `catalogue`. A pick with no product here gets one made
 * from the catalogue (owner item 11, `productForPick`).
 */
export async function pickIntoDelivery(
  ctx: PharmacyCtx,
  input: z.infer<typeof DeliveryPickInput>,
): Promise<DeliveryScanResult> {
  const h = ctx.actor.hospitalId;
  const d = await counting(ctx.tx, h, input.deliveryId);
  const R = CATALOGUE.receive;
  let productId = input.productId ?? null;
  let said: string | null = null;
  if (!productId) {
    const p = await productForPick(
      ctx,
      input.packId ? { packId: input.packId } : { medicineId: input.medicineId! },
    );
    if (!("id" in p)) return { id: d.id, ...p };
    ({ id: productId, said } = p);
  }
  await productAt(ctx.tx, h, productId);
  const [last] = await ctx.tx
    .select({ n: sql<number>`coalesce(max(${pharmacyDeliveryLines.lineNo}), 0)::int` })
    .from(pharmacyDeliveryLines)
    .where(eq(pharmacyDeliveryLines.deliveryId, d.id));
  const lineNo = (last?.n ?? 0) + 1;
  await ctx.tx.insert(pharmacyDeliveryLines).values({
    deliveryId: d.id,
    lineNo,
    productId,
    acceptedQuantity: 0,
    identitySource: "catalogue",
    updatedAt: ctx.now,
  });
  const note = said ? `${R.added(lineNo)} ${said}` : R.added(lineNo);
  return { id: d.id, kind: "added", lineNo, counted: 0, note };
}

/** Set-up › Medicines: each catalogue pick becomes one of the hospital's products (`productForPick`), no typing. */
export const CataloguePicksInput = z.object({
  picks: z
    .array(z.union([z.object({ packId: z.uuid() }), z.object({ medicineId: z.uuid() })]))
    .min(1)
    .max(50),
});

export async function addFromCatalogue(
  ctx: PharmacyCtx,
  input: z.infer<typeof CataloguePicksInput>,
): Promise<{ id: string; notes: (string | null)[] }> {
  const notes: (string | null)[] = [];
  for (const pick of input.picks) {
    const r = await productForPick(ctx, pick);
    notes.push("id" in r ? r.said : r.note);
  }
  return { id: ctx.actor.hospitalId, notes };
}

/** 4.3 for a delivery: the order's lines not counted yet whose product has a catalogue pack (never a guess). */
export async function orderCandidates(tx: EmrTx, hospitalId: string, deliveryId: string) {
  return rowsOf<{ product_id: string; medicine_id: string; pack_id: string }>(
    await tx.execute(sql`
      SELECT DISTINCT p.id AS product_id, p.catalogue_medicine_id AS medicine_id, p.catalogue_pack_id AS pack_id
        FROM public.pharmacy_deliveries d
        JOIN public.pharmacy_order_lines o ON o.order_id = d.order_id
        JOIN public.pharmacy_products p ON p.id = o.product_id AND p.catalogue_pack_id IS NOT NULL
       WHERE d.id = ${deliveryId} AND d.hospital_id = ${hospitalId}
         AND NOT EXISTS (SELECT 1 FROM public.pharmacy_delivery_lines l WHERE l.delivery_id = d.id AND l.product_id = p.id)`),
  );
}

/** Law 9, D-CAT-08: lines received with a registration reason, newest first, for the in-charge. */
export async function registrationList(tx: EmrTx, hospitalId: string) {
  return rowsOf<{
    delivery_id: string;
    note_number: string;
    line_no: number;
    product: string;
    reason: string;
    note: string | null;
    received_at: string | null;
  }>(
    await tx.execute(sql`
      SELECT d.id AS delivery_id, d.note_number, l.line_no, p.name AS product, l.registration_reason AS reason,
             l.registration_note AS note, d.finished_at AS received_at
        FROM public.pharmacy_delivery_lines l
        JOIN public.pharmacy_deliveries d ON d.id = l.delivery_id
        JOIN public.pharmacy_products p ON p.id = l.product_id
       WHERE d.hospital_id = ${hospitalId} AND d.state = 'received' AND l.registration_reason IS NOT NULL
       ORDER BY d.finished_at DESC, l.line_no LIMIT 200`),
  );
}

export const ShortDatedInput = z.object({
  deliveryId: z.uuid(),
  lineNo: z.number().int().min(1).max(999),
  decision: z.enum(["accept", "accept_tell", "reject"]),
});

/** RG-4: the decision a short-dated line needs (accept · accept and tell the supplier · reject). */
export async function recordShortDatedDecision(
  ctx: PharmacyCtx,
  input: z.infer<typeof ShortDatedInput>,
) {
  const d = await counting(ctx.tx, ctx.actor.hospitalId, input.deliveryId);
  const [row] = await ctx.tx
    .update(pharmacyDeliveryLines)
    .set({ shortDatedDecision: input.decision, updatedAt: ctx.now })
    .where(
      and(
        eq(pharmacyDeliveryLines.deliveryId, d.id),
        eq(pharmacyDeliveryLines.lineNo, input.lineNo),
      ),
    )
    .returning({ id: pharmacyDeliveryLines.id });
  if (!row) throw fail("not_found", "That line is not on this delivery.");
  return { id: row.id };
}

/** A stored line, as the engine reads it. */
export const asLine = (l: typeof pharmacyDeliveryLines.$inferSelect): DeliveryLine => ({
  lineNo: l.lineNo,
  productId: l.productId,
  noteProductId: l.noteProductId,
  orderLineId: l.orderLineId,
  noteQuantity: l.noteQuantity,
  acceptedQuantity: l.acceptedQuantity,
  rejectedKeptQuantity: l.rejectedKeptQuantity,
  rejectedReturnedQuantity: l.rejectedReturnedQuantity,
  rejectReason: l.rejectReason,
  batchNumber: l.batchNumber,
  expiry: l.expiry,
  expiryMonthOnly: l.expiryMonthOnly,
  unitCost: l.unitCost === null ? null : Number(l.unitCost),
  shortDatedDecision: l.shortDatedDecision,
});

/** Phase 1's expiry look-ahead (D-PH1-23), applied at receipt; null when the hospital has not set it. */
export async function expiryLookahead(tx: EmrTx, hospitalId: string): Promise<number | null> {
  const [s] = await tx
    .select({ days: pharmacyHospitalSettings.expiryLookaheadDays })
    .from(pharmacyHospitalSettings)
    .where(eq(pharmacyHospitalSettings.hospitalId, hospitalId));
  return s?.days ?? null;
}

/** A line refusal in words (RG-3, RG-4, SL-3). */
export function refusalWords(
  r: LineRefusal,
  line: DeliveryLine,
  ctx: { lookaheadDays: number | null; heldExpiry?: string | null },
): string {
  const n = `Line ${line.lineNo}`;
  switch (r) {
    case "expired_cannot_enter_stock":
      return `${n} expired on arrival. It cannot enter stock: count it as rejected.`;
    case "short_dated_decision_needed":
      return `${n} expires in under ${ctx.lookaheadDays} days. Record a decision for it.`;
    case "rejected_short_dated_accepted":
      return `${n} was rejected as short-dated, so none of it can be accepted.`;
    case "batch_and_expiry_needed":
      return `${n}: give the batch and the expiry.`;
    case "batch_expiry_conflict":
      return `${n}: batch ${line.batchNumber} is already here with expiry ${ctx.heldExpiry ?? "another date"}, not ${line.expiry}. Check the pack.`;
    case "reject_reason_needed":
      return `${n}: say why it was rejected.`;
    case "expiry_lookahead_not_set":
      return STORE.delivery.noLookahead;
  }
}

export const ReceiveDeliveryInput = z.object({
  deliveryId: z.uuid(),
  /** CD-5, 5.2: each controlled line names its witness. */
  witnesses: z
    .array(z.object({ lineNo: z.number().int().min(1), attestationId: z.uuid() }))
    .max(200)
    .default([]),
});

/**
 * 5.2 "Add {n} lines to stock" (RG-1, RG-3, RG-4, SL-3): one transaction. Every line passes the engine's
 * refusals first, or nothing is written; then a `received` movement per batch at the counted quantity, linked
 * to its delivery line, with its unit cost (SL-17); rejected-and-kept at quarantine with its reason; then the
 * delivery closes. A controlled line needs `pharmacy.controlled` and its witness.
 */
export async function receiveDelivery(
  ctx: PharmacyCtx,
  input: z.infer<typeof ReceiveDeliveryInput>,
) {
  const h = ctx.actor.hospitalId;
  const d = await counting(ctx.tx, h, input.deliveryId);
  const location = await loadLocation(ctx.tx, h, d.locationId);
  requireLive(location);
  const stored = await ctx.tx
    .select()
    .from(pharmacyDeliveryLines)
    .where(eq(pharmacyDeliveryLines.deliveryId, d.id))
    .orderBy(pharmacyDeliveryLines.lineNo);
  const lines = stored.map(asLine);
  if (!lines.length) throw fail("invalid", "Add the delivery's lines first.");
  const today = localDate(ctx.now);
  const lookaheadDays = await expiryLookahead(ctx.tx, h);
  const existing = await ctx.tx
    .select({
      productId: pharmacyBatches.productId,
      batchNumber: pharmacyBatches.batchNumber,
      expiry: pharmacyBatches.expiry,
    })
    .from(pharmacyBatches)
    .where(
      sql`coalesce(${pharmacyBatches.locationId}, ${pharmacyBatches.dispensingPointId}) = ${location.id}::uuid`,
    );
  for (const line of lines) {
    const refused = lineRefusals(line, { today, lookaheadDays, existing });
    if (refused.length) {
      const held = existing.find(
        (b) =>
          b.productId === line.productId &&
          b.batchNumber.toLowerCase() === line.batchNumber?.toLowerCase(),
      );
      throw fail(
        "conflict",
        refusalWords(refused[0]!, line, { lookaheadDays, heldExpiry: held?.expiry ?? null }),
      );
    }
  }
  const needsQuarantine = lines.some((l) => l.rejectedKeptQuantity > 0);
  const quarantine = needsQuarantine ? await quarantineFor(ctx.tx, h, location) : null;
  if (needsQuarantine) {
    if (!quarantine) throw fail("config", STORE.delivery.noQuarantine);
    requireLive(quarantine);
  }

  const controlled = await controlledSet(ctx.tx, h);
  const witnessOf = new Map(input.witnesses.map((w) => [w.lineNo, w.attestationId]));
  const witness = new Map<number, string | null>();
  for (const line of lines) {
    const p = await productAt(ctx.tx, h, line.productId);
    if (line.acceptedQuantity + line.rejectedKeptQuantity === 0) continue;
    // Law 9: a scanned line skips the line dialog, so the reason is checked again here.
    const { registration } = await catalogueFacts(ctx.tx, p.id, h);
    if (registration && !stored.find((s) => s.lineNo === line.lineNo)?.registrationReason)
      throw fail("conflict", CATALOGUE.receive.registration.needed(line.lineNo, registration));
    witness.set(
      line.lineNo,
      await storeWitness(ctx, controlled(p.medicineId), witnessOf.get(line.lineNo)),
    );
  }

  const lineId = new Map(stored.map((s) => [s.lineNo, s.id]));
  const planned = deliveryMovements({
    state: "received",
    locationId: location.id,
    quarantineLocationId: quarantine?.id ?? location.id,
    lines,
  });
  for (const p of planned) {
    const at = quarantine && p.locationId === quarantine.id ? quarantine : location;
    const batchId = await batchAtLocation(ctx.tx, {
      hospitalId: h,
      location: at,
      productId: p.productId,
      batchNumber: p.batchNumber,
      expiry: p.expiry,
      monthOnly: p.expiryMonthOnly,
      actorUserId: ctx.actor.userId,
    });
    await move(ctx.tx, {
      hospitalId: h,
      location: at,
      batchId,
      kind: "received",
      quantity: p.quantity,
      sourceKind: "delivery",
      sourceId: lineId.get(p.lineNo) ?? d.id,
      unitCost: p.unitCost === null ? null : p.unitCost.toFixed(2),
      reasonCode: p.reasonCode,
      counterpartyId: d.supplierId,
      actorUserId: ctx.actor.userId,
      effectiveAt: ctx.now,
      witnessAttestationId: witness.get(p.lineNo) ?? null,
    });
  }
  await ctx.tx
    .update(pharmacyDeliveries)
    .set({ state: "received", finishedBy: ctx.actor.userId, finishedAt: ctx.now })
    .where(eq(pharmacyDeliveries.id, d.id));
  return { id: d.id, movements: planned.length };
}

export const AbandonInput = z.object({
  deliveryId: z.uuid(),
  reason: z.string().trim().min(3, "Say why it is abandoned.").max(300),
});

/** RG-1: a delivery abandoned with its reason moves nothing and never changes again. */
export async function abandonDelivery(ctx: PharmacyCtx, input: z.infer<typeof AbandonInput>) {
  const d = await counting(ctx.tx, ctx.actor.hospitalId, input.deliveryId);
  const next = deliveryNext(d.state, { type: "abandon", reason: input.reason });
  if (!next.ok) throw fail("invalid", "Say why it is abandoned.");
  await ctx.tx
    .update(pharmacyDeliveries)
    .set({
      state: "abandoned",
      abandonReason: input.reason,
      finishedBy: ctx.actor.userId,
      finishedAt: ctx.now,
    })
    .where(eq(pharmacyDeliveries.id, d.id));
  return { id: d.id };
}

export const PrintDeliveryInput = z.object({ clientKey: key, deliveryId: z.uuid() });

/** RG-5: the discrepancy report and the goods received note print from the closed delivery, logged. */
async function logDeliveryPrint(
  ctx: PharmacyCtx,
  input: z.infer<typeof PrintDeliveryInput>,
  kind: "discrepancy_report" | "goods_received_note",
) {
  const [d] = await ctx.tx
    .select({ state: pharmacyDeliveries.state, locationId: pharmacyDeliveries.locationId })
    .from(pharmacyDeliveries)
    .where(
      and(
        eq(pharmacyDeliveries.id, input.deliveryId),
        eq(pharmacyDeliveries.hospitalId, ctx.actor.hospitalId),
      ),
    );
  if (!d) throw fail("not_found", "That delivery is not at this hospital.");
  if (d.state !== "received") throw fail("conflict", "It prints once the delivery is received.");
  const l = await loadLocation(ctx.tx, ctx.actor.hospitalId, d.locationId);
  const [again] = await ctx.tx
    .select({ id: pharmacyPrintEvents.id })
    .from(pharmacyPrintEvents)
    .where(eq(pharmacyPrintEvents.id, input.clientKey));
  if (again) return { id: again.id };
  const [row] = await ctx.tx
    .insert(pharmacyPrintEvents)
    .values({
      id: input.clientKey,
      hospitalId: ctx.actor.hospitalId,
      dispensingPointId: l.kind === "dispensing_point" ? l.id : null,
      kind,
      refId: input.deliveryId,
      actorUserId: ctx.actor.userId,
      printedAt: ctx.now,
    })
    .returning({ id: pharmacyPrintEvents.id });
  return { id: row!.id };
}

export const printDiscrepancyReport = (
  ctx: PharmacyCtx,
  input: z.infer<typeof PrintDeliveryInput>,
) => logDeliveryPrint(ctx, input, "discrepancy_report");
export const printGrn = (ctx: PharmacyCtx, input: z.infer<typeof PrintDeliveryInput>) =>
  logDeliveryPrint(ctx, input, "goods_received_note");
