import "server-only";

import type { StoreBatch, StoreMovement } from "./ledger";
import type { LocationKind, WardModel } from "./locations";
import type { EmrDb, EmrTx } from "@/lib/emr/db";
import type { SQL, SQLWrapper } from "drizzle-orm";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { patientProfiles } from "@/db/schema/patient-profiles";
import { pharmacyDispensingPoints } from "@/db/schema/pharmacy";
import {
  pharmacyBatchCorrections,
  pharmacyBatches,
  pharmacyHospitalSettings,
  pharmacyProducts,
  pharmacyStockMovements,
  pharmacySupplies,
  pharmacySupplyReversals,
} from "@/db/schema/pharmacy-dispensing";
import {
  pharmacyCounterparties,
  pharmacyLocationPacks,
  pharmacyLocations,
  pharmacyRecallEvents,
  pharmacyRecalls,
  pharmacyRecallWardNotices,
  pharmacyWriteOffs,
} from "@/db/schema/pharmacy-stores";
import { asClinicalReader } from "@/lib/emr/db";
import { decrypt } from "@/lib/encryption";
import { pharmacyRecallLiveFor } from "@/lib/pharmacy/feature";
import { localDate } from "@/lib/pharmacy/stock/ledger";
import { expiredToQuarantine, expiring } from "./expiry";
import { loanBalances } from "./issue";
import {
  accountedFor,
  exactList,
  holdWindows,
  mayHaveList,
  patientStatuses,
  recallMatches,
} from "./recall";

/**
 * Expiry, quarantine and recall, read (Pharmacy Phase 2, 5.6, 5.7). Pharmacy tables are read as the clinician
 * (`asClinicalReader`, RLS: `pharmacy.view` at the hospital). The administration record and the resus timeline,
 * for recall list 4 only, are read as the owner scoped to the hospital (Section 12: two identifiers per patient,
 * to pharmacy staff only; the page logs the reveal through `identitiesFor`). Every figure is a sum of the ledger.
 */

type Db = EmrDb | EmrTx;
const rowsOf = <T>(r: unknown): T[] =>
  Array.isArray(r) ? (r as T[]) : ((r as { rows?: T[] }).rows ?? []);

/**
 * SL-14 for Phase 1's reads: a predicate that keeps a batch only while no open recall blocks it. While
 * `pharmacyRecall` is off no recall can be started, so the predicate is `true` and Phase 1 reads are unchanged.
 */
export const notRecalled = (hospitalId: string, batchId: SQLWrapper | SQL): SQL =>
  pharmacyRecallLiveFor(hospitalId)
    ? sql`NOT private.pharmacy_batch_recalled(${batchId})`
    : sql`true`;

/** SL-14 for Phase 1's hand-over: which of these batches an open recall blocks (empty while recall is off). */
export async function recalledAmong(tx: Db, hospitalId: string, batchIds: readonly string[]) {
  if (!batchIds.length || !pharmacyRecallLiveFor(hospitalId)) return new Set<string>();
  const r = rowsOf<{ id: string }>(
    await tx.execute(sql`SELECT b.id FROM public.pharmacy_batches b
      WHERE b.id IN (${sql.join(
        batchIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
        AND private.pharmacy_batch_recalled(b.id)`),
  );
  return new Set(r.map((x) => x.id));
}

/** Whether a batch is under an open recall (RC-1, the database's own rule). */
export async function batchRecalled(tx: Db, batchId: string): Promise<boolean> {
  const r = rowsOf<{ ok: boolean }>(
    await tx.execute(sql`SELECT private.pharmacy_batch_recalled(${batchId}::uuid) AS ok`),
  );
  return r[0]?.ok === true;
}

/* ─── The hospital's ledger, all locations ───────────────────────────── */

export interface LedgerLocation {
  id: string;
  kind: LocationKind;
  model: WardModel | null;
  name: string;
  wardId: string | null;
  live: boolean;
}
export interface LedgerProduct {
  id: string;
  name: string;
  medicineId: string;
  issueUnit: string;
  packSize: string | null;
}
export interface Ledger {
  locations: Map<string, LedgerLocation>;
  products: Map<string, LedgerProduct>;
  batches: (StoreBatch & { firstBatchNumber: string })[];
  movements: StoreMovement[];
  productOf: Map<string, string>;
}

/**
 * Every location, product, batch and movement of the hospital (Law 2: balances are sums of this).
 * ponytail: one full read per page; narrow by product or window when a hospital's ledger grows large.
 */
export async function loadLedger(tx: Db, hospitalId: string): Promise<Ledger> {
  const place = (t: typeof pharmacyBatches | typeof pharmacyStockMovements) =>
    sql<string>`coalesce(${t.locationId}, ${t.dispensingPointId})`;
  const [locations, products, batches, movements] = await Promise.all([
    tx
      .select({
        id: pharmacyLocations.id,
        kind: pharmacyLocations.kind,
        model: pharmacyLocations.wardSupplyModel,
        name: pharmacyLocations.name,
        wardId: pharmacyLocations.wardId,
        live: sql<boolean>`CASE WHEN ${pharmacyLocations.kind} = 'dispensing_point'
          THEN ${pharmacyDispensingPoints.liveAt} IS NOT NULL AND ${pharmacyDispensingPoints.switchedOffAt} IS NULL
          ELSE ${pharmacyLocations.liveAt} IS NOT NULL AND ${pharmacyLocations.switchedOffAt} IS NULL END`,
      })
      .from(pharmacyLocations)
      .where(
        and(eq(pharmacyLocations.hospitalId, hospitalId), isNull(pharmacyLocations.archivedAt)),
      ),
    tx
      .select({
        id: pharmacyProducts.id,
        name: pharmacyProducts.name,
        medicineId: pharmacyProducts.medicineId,
        issueUnit: pharmacyProducts.issueUnit,
        packSize: pharmacyProducts.packSize,
      })
      .from(pharmacyProducts)
      .where(eq(pharmacyProducts.hospitalId, hospitalId)),
    tx
      .select({
        id: pharmacyBatches.id,
        pointId: place(pharmacyBatches),
        productId: pharmacyBatches.productId,
        medicineId: pharmacyProducts.medicineId,
        batchNumber: pharmacyBatches.batchNumber,
        expiry: pharmacyBatches.expiry,
        expiryMonthOnly: pharmacyBatches.expiryMonthOnly,
        firstBatchNumber: pharmacyBatches.firstBatchNumber,
      })
      .from(pharmacyBatches)
      .innerJoin(pharmacyProducts, eq(pharmacyProducts.id, pharmacyBatches.productId))
      .where(eq(pharmacyBatches.hospitalId, hospitalId)),
    tx
      .select({
        id: pharmacyStockMovements.id,
        batchId: pharmacyStockMovements.batchId,
        pointId: place(pharmacyStockMovements),
        kind: pharmacyStockMovements.kind,
        quantity: pharmacyStockMovements.quantity,
        effectiveAt: pharmacyStockMovements.effectiveAt,
        recordedAt: pharmacyStockMovements.recordedAt,
        downtime: pharmacyStockMovements.downtime,
        pairId: pharmacyStockMovements.pairId,
        allocated: pharmacyStockMovements.allocated,
        counterpartyId: pharmacyStockMovements.counterpartyId,
        loanMovementId: pharmacyStockMovements.loanMovementId,
        reasonCode: pharmacyStockMovements.reasonCode,
        sourceKind: pharmacyStockMovements.sourceKind,
        sourceId: pharmacyStockMovements.sourceId,
        unitCost: pharmacyStockMovements.unitCost,
      })
      .from(pharmacyStockMovements)
      .where(eq(pharmacyStockMovements.hospitalId, hospitalId)),
  ]);
  return {
    locations: new Map(locations.map((l) => [l.id, l as LedgerLocation])),
    products: new Map(products.map((p) => [p.id, p])),
    batches: batches.map((b) => ({ ...b, expiry: String(b.expiry) })),
    movements: movements.map((m) => ({
      ...m,
      effectiveAt: new Date(m.effectiveAt),
      recordedAt: new Date(m.recordedAt),
      unitCost: m.unitCost === null ? null : Number(m.unitCost),
    })),
    productOf: new Map(batches.map((b) => [b.id, b.productId])),
  };
}

export const balancesOf = (movements: readonly StoreMovement[]) => {
  const m = new Map<string, number>();
  for (const x of movements) m.set(x.batchId, (m.get(x.batchId) ?? 0) + x.quantity);
  return m;
};

/* ─── The Expiry and recall page (5.6) ───────────────────────────────── */

export interface ExpiryPage {
  lookaheadDays: number | null;
  expiring: {
    locationId: string;
    rows: {
      batchId: string;
      expiresOn: string;
      daysLeft: number;
      quantity: number;
      actions: string[];
    }[];
  }[];
  expired: { batchId: string; locationId: string; quantity: number }[];
  quarantine: {
    batchId: string;
    quantity: number;
    reason: string | null;
    since: Date | null;
  }[];
  writeOffs: {
    id: string;
    registerNumber: string;
    reason: string;
    writtenOffAt: Date;
    disposalReference: string | null;
    disposalOn: string | null;
    batchId: string | null;
    quantity: number;
  }[];
  suppliers: { id: string; name: string }[];
  ledger: Ledger;
  balances: Map<string, number>;
}

export async function getExpiryPage(
  who: { userId: string; hospitalId: string },
  now: Date,
  database?: EmrDb,
): Promise<ExpiryPage> {
  return asClinicalReader(
    who,
    async (tx) => {
      const ledger = await loadLedger(tx, who.hospitalId);
      const [[settings], writeOffs, suppliers] = await Promise.all([
        tx
          .select({ days: pharmacyHospitalSettings.expiryLookaheadDays })
          .from(pharmacyHospitalSettings)
          .where(eq(pharmacyHospitalSettings.hospitalId, who.hospitalId)),
        tx
          .select()
          .from(pharmacyWriteOffs)
          .where(eq(pharmacyWriteOffs.hospitalId, who.hospitalId))
          .orderBy(desc(pharmacyWriteOffs.writtenOffAt)),
        tx
          .select({ id: pharmacyCounterparties.id, name: pharmacyCounterparties.name })
          .from(pharmacyCounterparties)
          .where(
            and(
              eq(pharmacyCounterparties.hospitalId, who.hospitalId),
              eq(pharmacyCounterparties.kind, "supplier"),
              eq(pharmacyCounterparties.takesReturns, true),
              isNull(pharmacyCounterparties.retiredAt),
            ),
          ),
      ]);
      const balances = balancesOf(ledger.movements);
      const kinds = new Map([...ledger.locations].map(([id, l]) => [id, l.kind]));
      const today = localDate(now);
      const e = expiring({
        batches: ledger.batches,
        balances,
        locationKind: kinds,
        localDate: today,
        lookaheadDays: settings?.days ?? null,
        // ponytail: offered when any supplier on the list takes returns; per-batch supplier needs the delivery link.
        supplierTakesReturns: () => suppliers.length > 0,
      });
      const inQ = ledger.movements.filter(
        (m) => kinds.get(m.pointId) === "quarantine" && m.kind === "quarantined_in",
      );
      const quarantine = ledger.batches
        .filter((b) => kinds.get(b.pointId) === "quarantine" && (balances.get(b.id) ?? 0) > 0)
        .map((b) => {
          const last = inQ
            .filter((m) => m.batchId === b.id)
            .sort((x, y) => +y.effectiveAt - +x.effectiveAt)[0];
          const rx = ledger.movements.find((m) => m.batchId === b.id && m.kind === "received");
          return {
            batchId: b.id,
            quantity: balances.get(b.id) ?? 0,
            reason: last?.reasonCode ?? (rx ? "rejected" : null),
            since: last?.effectiveAt ?? rx?.effectiveAt ?? null,
          };
        });
      const woMoves = new Map(
        ledger.movements.filter((m) => m.kind === "written_off").map((m) => [m.sourceId, m]),
      );
      return {
        lookaheadDays: settings?.days ?? null,
        expiring:
          "missing" in e
            ? []
            : [...e.byLocation].map(([locationId, rows]) => ({ locationId, rows })),
        expired: expiredToQuarantine({
          batches: ledger.batches,
          balances,
          locationKind: kinds,
          localDate: today,
        }),
        quarantine,
        writeOffs: writeOffs.map((w) => ({
          id: w.id,
          registerNumber: w.registerNumber,
          reason: w.reason,
          writtenOffAt: w.writtenOffAt,
          disposalReference: w.disposalReference,
          disposalOn: w.disposalOn ? String(w.disposalOn) : null,
          batchId: woMoves.get(w.id)?.batchId ?? null,
          quantity: -(woMoves.get(w.id)?.quantity ?? 0),
        })),
        suppliers,
        ledger,
        balances,
      };
    },
    database,
  );
}

/* ─── Recalls (5.7) ──────────────────────────────────────────────────── */

export type RecallRow = typeof pharmacyRecalls.$inferSelect;

export async function listRecalls(
  who: { userId: string; hospitalId: string },
  database?: EmrDb,
): Promise<RecallRow[]> {
  return asClinicalReader(
    who,
    (tx) =>
      tx
        .select()
        .from(pharmacyRecalls)
        .where(eq(pharmacyRecalls.hospitalId, who.hospitalId))
        .orderBy(desc(pharmacyRecalls.startedAt)),
    database,
  );
}

export type ContactRoute = "phone" | "guardian" | "none";

export interface RecallTrace {
  recall: RecallRow;
  productName: string;
  medicineId: string;
  batches: { id: string; batchNumber: string; locationId: string }[];
  received: {
    movementId: string;
    locationId: string;
    at: Date;
    quantity: number;
    from: string | null;
  }[];
  exact: {
    patientId: string;
    quantity: number;
    supplies: { at: Date; quantity: number; locationId: string; batchId: string }[];
    contact: ContactRoute;
    status: string;
  }[];
  issued: { locationId: string; at: Date; quantity: number; allocated: boolean }[];
  mayHave: {
    patientId: string;
    source: "ward" | "cart";
    locationId: string;
    firstAt: Date;
    allocated: boolean;
    contact: ContactRoute;
    status: string;
  }[];
  shelves: { locationId: string; batchId: string; quantity: number; kind: LocationKind }[];
  lent: { counterparty: string; quantity: number }[];
  accounted: ReturnType<typeof accountedFor>;
  wardsNotified: Map<string, Date>;
  locations: Map<string, LedgerLocation>;
  movements: StoreMovement[];
}

const safe = (c: string | null | undefined) => {
  if (!c) return "";
  try {
    return decrypt(c).trim();
  } catch {
    return "";
  }
};

/** How a patient can be reached (5.7): the number itself never leaves this function. */
export async function contactRoutes(database: Db, patientIds: readonly string[]) {
  if (!patientIds.length) return new Map<string, ContactRoute>();
  const rows = await database
    .select({
      id: patientProfiles.id,
      phone: patientProfiles.phoneEncrypted,
      nok: patientProfiles.nokPhoneEncrypted,
      rel: patientProfiles.nokRelationship,
    })
    .from(patientProfiles)
    .where(inArray(patientProfiles.id, [...patientIds]));
  return new Map(
    rows.map((r) => [
      r.id,
      safe(r.phone)
        ? "phone"
        : (r.rel === "guardian" || r.rel === "parent") && safe(r.nok)
          ? "guardian"
          : ("none" as ContactRoute),
    ]),
  );
}

/** The pharmacy half of a trace: read with the caller's role (the clinician on a page, the owner in a write). */
export async function loadTraceBase(tx: Db, hospitalId: string, recallId: string) {
  const [recall] = await tx
    .select()
    .from(pharmacyRecalls)
    .where(and(eq(pharmacyRecalls.id, recallId), eq(pharmacyRecalls.hospitalId, hospitalId)));
  if (!recall) return null;
  const ledger = await loadLedger(tx, hospitalId);
  const corrections = await tx
    .select({
      batchId: pharmacyBatchCorrections.batchId,
      old: pharmacyBatchCorrections.oldBatchNumber,
    })
    .from(pharmacyBatchCorrections)
    .where(eq(pharmacyBatchCorrections.hospitalId, hospitalId));
  const batches = ledger.batches.filter((b) =>
    recallMatches(recall, {
      productId: b.productId,
      batchNumber: b.batchNumber,
      firstBatchNumber: b.firstBatchNumber,
      earlierNumbers: corrections.filter((c) => c.batchId === b.id).map((c) => c.old),
    }),
  );
  const ids = new Set(batches.map((b) => b.id));
  const movements = ledger.movements.filter((m) => ids.has(m.batchId));
  const [supplies, events, notices, cps, packs] = await Promise.all([
    ids.size
      ? tx
          .select({
            patientId: pharmacySupplies.patientUserId,
            batchId: pharmacySupplies.batchId,
            locationId: pharmacySupplies.dispensingPointId,
            at: pharmacySupplies.suppliedAt,
            quantity: pharmacySupplies.quantity,
            reversed: pharmacySupplyReversals.id,
          })
          .from(pharmacySupplies)
          .leftJoin(
            pharmacySupplyReversals,
            eq(pharmacySupplyReversals.supplyId, pharmacySupplies.id),
          )
          .where(
            and(
              eq(pharmacySupplies.hospitalId, hospitalId),
              inArray(pharmacySupplies.batchId, [...ids]),
            ),
          )
      : [],
    tx.select().from(pharmacyRecallEvents).where(eq(pharmacyRecallEvents.recallId, recall.id)),
    tx
      .select()
      .from(pharmacyRecallWardNotices)
      .where(eq(pharmacyRecallWardNotices.recallId, recall.id)),
    tx
      .select({ id: pharmacyCounterparties.id, name: pharmacyCounterparties.name })
      .from(pharmacyCounterparties)
      .where(eq(pharmacyCounterparties.hospitalId, hospitalId)),
    tx
      .select({
        locationId: pharmacyLocationPacks.locationId,
        content: pharmacyLocationPacks.content,
      })
      .from(pharmacyLocationPacks)
      .where(
        and(
          eq(pharmacyLocationPacks.hospitalId, hospitalId),
          eq(pharmacyLocationPacks.kind, "cart_list"),
          eq(pharmacyLocationPacks.status, "signed"),
        ),
      ),
  ]);
  return { recall, ledger, batches, movements, supplies, events, notices, cps, packs };
}
export type TraceBase = NonNullable<Awaited<ReturnType<typeof loadTraceBase>>>;

/**
 * The seven sections of one recall's trace (5.7, RC-1 to RC-5). `owner` reads the administration record and the
 * resus timeline for list 4 (hospital-scoped) after the pharmacy half; on the PGlite lane both share a connection.
 */
export async function getRecallTrace(
  who: { userId: string; hospitalId: string },
  recallId: string,
  owner: EmrDb,
  database?: EmrDb,
): Promise<RecallTrace | null> {
  const base = await asClinicalReader(
    who,
    (tx) => loadTraceBase(tx, who.hospitalId, recallId),
    database,
  );
  return base ? finishTrace(base, owner, who.hospitalId) : null;
}

export async function finishTrace(
  base: TraceBase,
  owner: Db,
  hospitalId: string,
): Promise<RecallTrace> {
  const { recall, ledger, batches, movements, supplies, events, notices, cps, packs } = base;
  const product = ledger.products.get(recall.productId);
  const medicineId = product?.medicineId ?? "";
  const kinds = new Map([...ledger.locations].map(([id, l]) => [id, l.kind]));

  // RC-2: exact, from recorded supplies net of their reversals.
  const exact = exactList(
    supplies.flatMap((s) => {
      // A partner supply has no batch here (RT-5); a recall traces only the hospital's own batches.
      if (!s.batchId) return [];
      const row = {
        patientId: s.patientId,
        batchId: s.batchId,
        locationId: s.locationId,
        at: s.at,
      };
      return s.reversed
        ? [
            { ...row, quantity: s.quantity },
            { ...row, quantity: -s.quantity },
          ]
        : [{ ...row, quantity: s.quantity }];
    }),
  );
  const exactIds = new Set(exact.map((p) => p.patientId));

  // RC-3: list 4 from the wards and carts that held the batch.
  const windows = holdWindows({
    movements,
    locationKind: kinds,
    recallStartedAt: recall.startedAt,
  });
  const administrations: { patientId: string; locationId: string; at: Date }[] = [];
  const wardIds = windows.filter((w) => w.source === "ward").map((w) => w.locationId);
  if (wardIds.length && medicineId) {
    const r = rowsOf<{ patient: string; at: string; location: string }>(
      await owner.execute(sql`
        SELECT mar.patient_user_id AS patient, mar.administered_at AS at, l.id AS location
          FROM public.medication_administration_records mar
          JOIN public.prescriptions p ON p.id = mar.emr_prescription_id
          JOIN public.admissions a ON a.inpatient_encounter_id = mar.encounter_id
          JOIN public.pharmacy_locations l ON l.ward_id = a.ward_id
         WHERE mar.hospital_id = ${hospitalId}::uuid AND mar.state = 'administered'
           AND NOT EXISTS (SELECT 1 FROM public.medication_administration_records r WHERE r.reverses_id = mar.id)
           AND p.drug_id = ${medicineId}
           AND l.id IN (${sql.join(
             wardIds.map((w) => sql`${w}::uuid`),
             sql`, `,
           )})`),
    );
    administrations.push(
      ...r.map((x) => ({ patientId: x.patient, locationId: x.location, at: new Date(x.at) })),
    );
  }
  const cartNames = new Map<string, string[]>();
  for (const p of packs) {
    const names = (p.content as { names?: unknown }).names;
    if (Array.isArray(names))
      cartNames.set(
        p.locationId,
        names.filter((n): n is string => typeof n === "string").map((n) => n.trim().toLowerCase()),
      );
  }
  const cartIds = windows
    .filter((w) => w.source === "cart" && cartNames.get(w.locationId)?.length)
    .map((w) => w.locationId);
  if (cartIds.length && medicineId) {
    const r = rowsOf<{ patient: string | null; at: string; cart: string | null }>(
      await owner.execute(sql`
        SELECT ep.patient_user_id AS patient, e.recorded_at AS at,
               lower(trim(e.payload -> 'prescribing' ->> 'cart')) AS cart
          FROM public.resus_timeline_events e
          JOIN public.resus_episodes ep ON ep.id = e.episode_id
         WHERE ep.hospital_id = ${hospitalId}::uuid AND e.kind = 'drug'
           AND e.payload -> 'prescribing' ->> 'drugId' = ${medicineId}
           AND NOT EXISTS (SELECT 1 FROM public.resus_timeline_events s WHERE s.supersedes_event_id = e.id)`),
    );
    for (const x of r) {
      if (!x.patient || !x.cart) continue;
      const loc = cartIds.find((c) => cartNames.get(c)!.includes(x.cart!));
      if (loc) administrations.push({ patientId: x.patient, locationId: loc, at: new Date(x.at) });
    }
  }
  const mayHave = mayHaveList({ windows, administrations, exactPatientIds: exactIds });

  const contact = await contactRoutes(owner, [...exactIds, ...mayHave.map((m) => m.patientId)]);
  const statuses = patientStatuses(
    [
      ...exact.map((p) => ({ patientId: p.patientId, list: "exact" as const })),
      ...mayHave.map((p) => ({ patientId: p.patientId, list: "may_have" as const })),
    ],
    events.map((e) => ({ patientId: e.patientUserId, list: e.list, outcome: e.outcome, at: e.at })),
  );
  const statusOf = (id: string, list: "exact" | "may_have") =>
    statuses.find((s) => s.patientId === id && s.list === list)?.status ?? "not_yet_contacted";

  const balances = balancesOf(movements);
  const cpName = new Map(cps.map((c) => [c.id, c.name]));
  const lent = loanBalances(movements, ledger.productOf).outstanding.filter(
    (o) => o.direction === "lent",
  );
  return {
    recall,
    productName: product?.name ?? "",
    medicineId,
    batches: batches.map((b) => ({ id: b.id, batchNumber: b.batchNumber, locationId: b.pointId })),
    received: movements
      .filter((m) => m.kind === "received" || m.kind === "borrowed")
      .map((m) => ({
        movementId: m.id,
        locationId: m.pointId,
        at: m.effectiveAt,
        quantity: m.quantity,
        from: m.counterpartyId ? (cpName.get(m.counterpartyId) ?? null) : null,
      })),
    exact: exact.map((p) => ({
      patientId: p.patientId,
      quantity: p.quantity,
      supplies: p.supplies.filter((s) => s.quantity > 0),
      contact: contact.get(p.patientId) ?? "none",
      status: statusOf(p.patientId, "exact"),
    })),
    issued: movements
      .filter(
        (m) =>
          m.kind === "received_from_issue" && ["ward", "cart"].includes(kinds.get(m.pointId) ?? ""),
      )
      .map((m) => ({
        locationId: m.pointId,
        at: m.effectiveAt,
        quantity: m.quantity,
        allocated: windows.some((w) => w.locationId === m.pointId && w.allocated),
      })),
    mayHave: mayHave.map((m) => ({
      ...m,
      contact: contact.get(m.patientId) ?? "none",
      status: statusOf(m.patientId, "may_have"),
    })),
    shelves: batches
      .filter((b) => (balances.get(b.id) ?? 0) > 0)
      .map((b) => ({
        locationId: b.pointId,
        batchId: b.id,
        quantity: balances.get(b.id) ?? 0,
        kind: kinds.get(b.pointId) ?? "store",
      })),
    lent: lent.map((l) => ({
      counterparty: cpName.get(l.counterpartyId) ?? "",
      quantity: l.quantity,
    })),
    accounted: accountedFor(movements),
    wardsNotified: new Map(notices.map((n) => [n.locationId, n.postedAt])),
    locations: ledger.locations,
    movements,
  };
}
