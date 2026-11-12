import "server-only";

import type { DispensingServes } from "@/db/schema/pharmacy";
import type { EmrDb, EmrTx } from "@/lib/emr/db";
import type {
  Availability,
  AvailabilityMapping,
  AvailabilityOrigin,
  LivePoint,
  PointStockFacts,
  StockLine,
} from "@/lib/prescribing/pharmacy";
import { sql } from "drizzle-orm";

import { notRecalled } from "@/lib/pharmacy/stores/recall-read";
import { getAvailability, mappingInForce, toStockLine } from "@/lib/prescribing/pharmacy";

/**
 * The stock answer's read (Pharmacy Phase 1, Step 9; AV-1..AV-9, Section 11). ONE statement: the
 * hospital's live points in hub order, and per point per medicine the products at the point, the batches
 * with expiry and their balance (the sum of their movements), the last receipt, the last count, the
 * reorder level, the count freshness, the open stock-out, and the signed availability mapping.
 *
 * Runs as the owner (the prescriber cannot read stock tables under RLS). Balances go into getAvailability
 * and stop there: what leaves this module is its answer, which carries no quantity (AV-6).
 */

type Db = EmrDb | EmrTx;

interface Raw {
  points: { id: string; name: string; serves: DispensingServes; fresh: number | null }[];
  products: { point: string; id: string; med: string }[];
  batches: {
    id: string;
    point: string;
    product: string;
    med: string;
    number: string;
    expiry: string;
    month_only: boolean;
    balance: number | string;
    received: string | null;
  }[];
  facts: {
    point: string;
    med: string;
    counted: string | null;
    level: number | null;
    out_since: string | null;
  }[];
  mapping: unknown;
}

const rowsOf = <T>(r: unknown): T[] =>
  Array.isArray(r) ? (r as T[]) : ((r as { rows: T[] }).rows ?? []);
const at = (s: string | null) => (s ? new Date(s) : null);

/** The single round trip. Exported for the lane test, which counts statements. */
export async function readStock(
  database: Db,
  hospitalId: string,
  medicineIds: readonly string[],
): Promise<Raw> {
  const meds = sql.join(
    medicineIds.map((m) => sql`${m}`),
    sql`, `,
  );
  const res = await database.execute(sql`
    WITH pts AS (
      SELECT p.department_id AS id, d.name, p.serves, p.count_freshness_days AS fresh
        FROM public.pharmacy_dispensing_points p
        JOIN public.hospital_departments d ON d.id = p.department_id
       WHERE p.hospital_id = ${hospitalId} AND p.live_at IS NOT NULL AND p.switched_off_at IS NULL
         AND d.archived_at IS NULL
    ), meds AS (
      SELECT unnest(ARRAY[${meds}]::text[]) AS med
    ), prods AS (
      SELECT pp.dispensing_point_id AS point, pr.id, pr.medicine_id AS med
        FROM public.pharmacy_product_points pp
        JOIN public.pharmacy_products pr ON pr.id = pp.product_id
       WHERE pp.dispensing_point_id IN (SELECT id FROM pts) AND pp.active AND pr.active
         AND pr.medicine_id IN (SELECT med FROM meds)
    ), bats AS (
      SELECT b.id, b.dispensing_point_id AS point, b.product_id AS product, pr.medicine_id AS med,
             b.batch_number AS number, b.expiry::text AS expiry, b.expiry_month_only AS month_only,
             coalesce(sum(m.quantity), 0) AS balance,
             max(m.effective_at) FILTER (WHERE m.kind = 'received') AS received
        FROM public.pharmacy_batches b
        JOIN public.pharmacy_products pr ON pr.id = b.product_id
        LEFT JOIN public.pharmacy_stock_movements m ON m.batch_id = b.id
       WHERE b.dispensing_point_id IN (SELECT id FROM pts) AND pr.medicine_id IN (SELECT med FROM meds)
         AND ${notRecalled(hospitalId, sql`b.id`)}
       GROUP BY b.id, pr.medicine_id
    ), facts AS (
      SELECT pt.id AS point, md.med,
             (SELECT max(c.counted_at) FROM public.pharmacy_counts c
               WHERE c.dispensing_point_id = pt.id AND (c.scope = 'full' OR c.medicine_id = md.med)) AS counted,
             (SELECT r.level FROM public.pharmacy_reorder_levels r
               WHERE r.dispensing_point_id = pt.id AND r.medicine_id = md.med
               ORDER BY r.set_at DESC LIMIT 1) AS level,
             (SELECT min(s.started_at) FROM public.pharmacy_stockouts s
               WHERE s.dispensing_point_id = pt.id AND s.medicine_id = md.med AND s.ended_at IS NULL) AS out_since
        FROM pts pt CROSS JOIN meds md
    )
    SELECT json_build_object(
      'points', (SELECT coalesce(json_agg(pts ORDER BY pts.name, pts.id), '[]'::json) FROM pts),
      'products', (SELECT coalesce(json_agg(prods), '[]'::json) FROM prods),
      'batches', (SELECT coalesce(json_agg(bats), '[]'::json) FROM bats),
      'facts', (SELECT coalesce(json_agg(facts), '[]'::json) FROM facts),
      'mapping', (SELECT s.content FROM public.pharmacy_signed_sets s
                   WHERE s.hospital_id = ${hospitalId} AND s.kind = 'availability_mapping' AND s.status = 'signed'
                   ORDER BY s.version DESC LIMIT 1)
    ) AS r`);
  const r = rowsOf<{ r: Raw | string }>(res)[0]?.r;
  return typeof r === "string" ? (JSON.parse(r) as Raw) : r!;
}

/**
 * AV-1: the answer for each medicine, and the mapping in force (D-PH1-22): the signed set, else the
 * proposal outside production only.
 */
export async function availabilityFor(i: {
  database: Db;
  hospitalId: string;
  origin: AvailabilityOrigin;
  medicineIds: readonly string[];
  now: Date;
}): Promise<{ answers: Map<string, Availability>; mapping: AvailabilityMapping | null }> {
  const ids = [...new Set(i.medicineIds)];
  const answers = new Map<string, Availability>();
  if (!ids.length) return { answers, mapping: null };
  const raw = await readStock(i.database, i.hospitalId, ids);
  const points: LivePoint[] = raw.points.map((p) => ({
    id: p.id,
    name: p.name,
    hospitalId: i.hospitalId,
    serves: p.serves,
  }));
  const fresh = new Map(raw.points.map((p) => [p.id, p.fresh]));
  for (const med of ids) {
    const stock: Record<string, PointStockFacts> = {};
    for (const p of points) {
      const batches = raw.batches.filter((b) => b.point === p.id && b.med === med);
      const fact = raw.facts.find((f) => f.point === p.id && f.med === med);
      const received = batches
        .map((b) => at(b.received))
        .filter((d): d is Date => d !== null)
        .sort((a, b) => b.getTime() - a.getTime());
      stock[p.id] = {
        products: raw.products
          .filter((x) => x.point === p.id && x.med === med)
          .map((x) => ({ id: x.id, medicineId: x.med })),
        batches: batches.map((b) => ({
          id: b.id,
          pointId: b.point,
          productId: b.product,
          medicineId: b.med,
          batchNumber: b.number,
          expiry: b.expiry,
          expiryMonthOnly: b.month_only,
        })),
        movements: [],
        balances: new Map(batches.map((b) => [b.id, Number(b.balance)])),
        lastReceiptAt: received[0] ?? null,
        openStockoutSince: at(fact?.out_since ?? null),
        lastCountAt: at(fact?.counted ?? null),
        reorderLevel: fact?.level ?? null,
        countFreshnessDays: fresh.get(p.id) ?? null,
      };
    }
    answers.set(
      med,
      getAvailability({
        medicineId: med,
        hospitalId: i.hospitalId,
        origin: i.origin,
        points,
        stock,
        now: i.now,
      }),
    );
  }
  return {
    answers,
    mapping: mappingInForce(raw.mapping, process.env.VERCEL_ENV === "production"),
  };
}

/**
 * Where the prescription is being written (AV-2): an emergency visit → emergency; an inpatient visit or
 * one an admission came from → wards; anything else (a clinic) → window.
 */
export async function encounterOrigin(
  database: Db,
  encounterId: string,
): Promise<AvailabilityOrigin> {
  const res = await database.execute(sql`
    SELECT e.encounter_type AS type,
           EXISTS (SELECT 1 FROM public.admissions a
                    WHERE a.source_encounter_id = e.id AND a.status <> 'cancelled') AS admitted
      FROM public.encounters e WHERE e.id = ${encounterId}`);
  const e = rowsOf<{ type: string; admitted: boolean }>(res)[0];
  if (e?.type === "emergency") return "emergency";
  if (e?.type === "inpatient" || e?.admitted) return "wards";
  return "window";
}

/** The prescriber's stock lines for one encounter's medicines: getAvailability's output, no quantity. */
export async function stockLinesFor(
  database: Db,
  i: {
    hospitalId: string;
    encounterId: string;
    medicineIds: readonly string[];
    now: Date;
    /** Prescribing kit F1: the place's collect point, when the page names it; else the encounter's. */
    origin?: AvailabilityOrigin;
  },
): Promise<Map<string, StockLine>> {
  const origin = i.origin ?? (await encounterOrigin(database, i.encounterId));
  const { answers, mapping } = await availabilityFor({ database, origin, ...i });
  return new Map([...answers].map(([m, a]) => [m, toStockLine(a, mapping)]));
}
