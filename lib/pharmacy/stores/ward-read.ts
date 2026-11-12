import "server-only";

import type { StoreBatch } from "./ledger";
import type { EmrDb, EmrTx } from "@/lib/emr/db";
import type { CartSignal, Compared, UseRow } from "@/lib/pharmacy/distribution/engine";
import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";

import { expiryText } from "@/content/pharmacy-stock";
import { controlledMedicineIds } from "@/lib/pharmacy/controlled-read";
import { cartSignals, wardUseCheck } from "@/lib/pharmacy/distribution/engine";
import { gapReasonsOf, sealsOf } from "@/lib/pharmacy/distribution/store";
import { pharmacyCatalogueLiveFor } from "@/lib/pharmacy/feature";
import { localDate } from "@/lib/pharmacy/stock/ledger";
import { drugById } from "@/lib/prescribing/formulary";
import { wardRow } from "./ward-stock";

/**
 * Ward stock and cart reads (Pharmacy Phase 2, 5.4, 5.5). Every figure is a projection over the ledger
 * (Law 2). The administration record and the resus timeline are read here only as counts and times:
 * never a dose, never a patient (Section 12). Callers check the reader's right first (Appendix A);
 * these read through the server connection, as Phase 1's stock page does.
 */

type Reader = EmrDb | EmrTx;
const rowsOf = <T>(r: unknown): T[] =>
  Array.isArray(r) ? (r as T[]) : ((r as { rows: T[] }).rows ?? []);
const q = async <T>(d: Reader, query: SQL) => rowsOf<T>(await d.execute(query));
const date = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string));
const ids = (list: readonly string[]) =>
  sql.join(
    list.map((i) => sql`${i}::uuid`),
    sql`, `,
  );

/** SL-18: a per-product ward count's lines carry this note: allocated, not counted. */
export const ALLOCATED_NOTE = "Allocated first expiry first from one figure per product (SL-18)";

export interface Place {
  id: string;
  kind: "ward" | "cart";
  name: string;
  wardId: string | null;
  crashCartId: string | null;
  departmentId: string | null;
  supplyModel: "stocked" | "issue_only" | null;
  anyNurseConfirms: boolean;
  live: boolean;
}

const placeCols = sql`l.id, l.kind, l.name, l.ward_id, l.crash_cart_id, coalesce(l.department_id, cc.department_id) AS department_id,
  l.ward_supply_model, l.any_nurse_confirms,
  (l.ward_supply_model = 'issue_only' OR (l.live_at IS NOT NULL AND l.switched_off_at IS NULL)) AS live`;
interface PlaceRow {
  id: string;
  kind: "ward" | "cart";
  name: string;
  ward_id: string | null;
  crash_cart_id: string | null;
  department_id: string | null;
  ward_supply_model: "stocked" | "issue_only" | null;
  any_nurse_confirms: boolean;
  live: boolean;
}
const place = (r: PlaceRow): Place => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  wardId: r.ward_id,
  crashCartId: r.crash_cart_id,
  departmentId: r.department_id,
  supplyModel: r.ward_supply_model,
  anyNurseConfirms: r.any_nurse_confirms,
  live: r.live === true,
});

export async function listPlaces(d: Reader, hospitalId: string, kind: "ward" | "cart") {
  return (
    await q<PlaceRow>(
      d,
      sql`SELECT ${placeCols} FROM public.pharmacy_locations l
            LEFT JOIN public.crash_carts cc ON cc.id = l.crash_cart_id
           WHERE l.hospital_id = ${hospitalId}::uuid AND l.kind = ${kind} AND l.archived_at IS NULL
           ORDER BY l.name`,
    )
  ).map(place);
}

export async function placeById(d: Reader, hospitalId: string, id: string) {
  const [r] = await q<PlaceRow>(
    d,
    sql`SELECT ${placeCols} FROM public.pharmacy_locations l
          LEFT JOIN public.crash_carts cc ON cc.id = l.crash_cart_id
         WHERE l.hospital_id = ${hospitalId}::uuid AND l.id = ${id}::uuid AND l.kind IN ('ward','cart')
           AND l.archived_at IS NULL`,
  );
  return r ? place(r) : null;
}

/** Appendix A, S21: the wards a person reads through their hub assignment, and only those. */
export async function wardsOf(d: Reader, hospitalId: string, userId: string) {
  return (
    await q<PlaceRow>(
      d,
      sql`SELECT ${placeCols} FROM public.pharmacy_locations l
            LEFT JOIN public.crash_carts cc ON cc.id = l.crash_cart_id
           WHERE l.hospital_id = ${hospitalId}::uuid AND l.kind = 'ward' AND l.archived_at IS NULL
             AND private.pharmacy_location_right(${userId}::uuid, l.id, 'ward_read')
           ORDER BY l.name`,
    )
  ).map(place);
}

export async function rightsAt(d: Reader, userId: string, locationId: string) {
  const [r] = await q<{ act: boolean; confirm: boolean; read: boolean; cart: boolean }>(
    d,
    sql`SELECT private.pharmacy_location_right(${userId}::uuid, ${locationId}::uuid, 'ward_act') AS act,
               private.pharmacy_location_right(${userId}::uuid, ${locationId}::uuid, 'ward_confirm') AS confirm,
               private.pharmacy_location_right(${userId}::uuid, ${locationId}::uuid, 'ward_read') AS read,
               private.pharmacy_location_right(${userId}::uuid, ${locationId}::uuid, 'cart_confirm') AS cart`,
  );
  return { act: !!r?.act, confirm: !!r?.confirm, read: !!r?.read, cart: !!r?.cart };
}

/** Hub wards and crash carts that have no location yet (for "Add a ward" and "Add a cart"). */
export async function unplacedWards(d: Reader, hospitalId: string) {
  return q<{ id: string; name: string }>(
    d,
    sql`SELECT w.id, w.name FROM public.hospital_wards w
         WHERE w.hospital_id = ${hospitalId}::uuid AND w.state = 'active'
           AND NOT EXISTS (SELECT 1 FROM public.pharmacy_locations l WHERE l.ward_id = w.id)
         ORDER BY w.name`,
  );
}
export async function unplacedCarts(d: Reader, hospitalId: string) {
  return q<{ id: string; name: string }>(
    d,
    sql`SELECT c.id, c.label AS name FROM public.crash_carts c
         WHERE c.hospital_id = ${hospitalId}::uuid
           AND NOT EXISTS (SELECT 1 FROM public.pharmacy_locations l WHERE l.crash_cart_id = c.id)
         ORDER BY c.label`,
  );
}

/** The store and dispensing points a ward or cart may ask from or return to. */
export async function issuers(d: Reader, hospitalId: string) {
  return q<{ id: string; name: string; kind: string }>(
    d,
    sql`SELECT l.id, l.name, l.kind FROM public.pharmacy_locations l
         WHERE l.hospital_id = ${hospitalId}::uuid AND l.kind IN ('store','dispensing_point')
           AND l.archived_at IS NULL ORDER BY l.kind DESC, l.name`,
  );
}

export interface PackRow {
  id: string;
  version: number;
  content: Record<string, unknown>;
  status: "draft" | "signed";
  firstSigner: string | null;
  signedAt: Date | null;
}

/** The signed pack and the draft being written, for a location (Appendix D). */
export async function packsOf(d: Reader, locationId: string, kind: "ward_levels" | "cart_list") {
  const rows = await q<{
    id: string;
    version: number;
    content: Record<string, unknown>;
    status: "draft" | "signed";
    first_signer: string | null;
    signed_at: string | null;
  }>(
    d,
    sql`SELECT id, version, content, status, first_signer, signed_at FROM public.pharmacy_location_packs
         WHERE location_id = ${locationId}::uuid AND kind = ${kind} AND status IN ('draft','signed')
         ORDER BY version DESC`,
  );
  const of = (s: "draft" | "signed") => {
    const r = rows.find((x) => x.status === s);
    return r
      ? {
          id: r.id,
          version: Number(r.version),
          content: r.content,
          status: s,
          firstSigner: r.first_signer,
          signedAt: date(r.signed_at),
        }
      : null;
  };
  return { signed: of("signed"), draft: of("draft") };
}

/** The `{productId: n}` map a pack holds (`levels` or `items`), whole numbers only. */
export function packQuantities(
  content: Record<string, unknown> | undefined,
  key: "levels" | "items",
) {
  const raw = (content?.[key] ?? {}) as Record<string, unknown>;
  return new Map(
    Object.entries(raw).flatMap(([k, v]) =>
      typeof v === "number" && Number.isInteger(v) && v >= 0 ? [[k, v] as const] : [],
    ),
  );
}
export const cartListOf = (content: Record<string, unknown> | undefined) => ({
  items: packQuantities(content, "items"),
  checkIntervalDays:
    typeof content?.checkIntervalDays === "number" ? content.checkIntervalDays : null,
  names: Array.isArray(content?.names)
    ? (content.names as unknown[]).filter((n): n is string => typeof n === "string")
    : [],
});

async function signedSet(d: Reader, hospitalId: string, kind: string) {
  const [r] = await q<{ content: Record<string, unknown> }>(
    d,
    sql`SELECT content FROM public.pharmacy_signed_sets
         WHERE hospital_id = ${hospitalId}::uuid AND kind = ${kind} AND status = 'signed'
         ORDER BY version DESC LIMIT 1`,
  );
  return r?.content ?? null;
}

/** IS-4: the signed confirmation window (ward_rules), in hours; null while unsigned. */
export async function confirmationWindowHours(d: Reader, hospitalId: string) {
  const c = await signedSet(d, hospitalId, "ward_rules");
  return typeof c?.confirmationWindowHours === "number" ? c.confirmationWindowHours : null;
}

/** SL-18, Appendix D: per-product ward counts wait for the signed allocation rule (ward_rules). */
export async function allocationRuleSigned(d: Reader, hospitalId: string) {
  const c = await signedSet(d, hospitalId, "ward_rules");
  return !!c && (!!c.allocationRule || !!c.allocation);
}

/**
 * EC-4, Appendix D: the signed cart look-ahead; unsigned, the hospital's expiry look-ahead (Phase 1).
 */
export async function cartLookaheadDays(d: Reader, hospitalId: string) {
  const c = await signedSet(d, hospitalId, "cart_lookahead");
  const signed = c?.days ?? c?.lookaheadDays;
  if (typeof signed === "number") return signed;
  const [s] = await q<{ n: number | null }>(
    d,
    sql`SELECT expiry_lookahead_days AS n FROM public.pharmacy_hospital_settings WHERE hospital_id = ${hospitalId}::uuid`,
  );
  return s?.n ?? null;
}

/**
 * Law 6, WS-1: Phase 1's count freshness, reused. It is set per dispensing point; a ward takes the
 * strictest one the pharmacy in charge has set. Unset everywhere: no top-up is computed.
 */
// ponytail: strictest point setting; a per-ward setting needs a column (a new migration) if sites differ.
export async function countFreshnessDays(d: Reader, hospitalId: string) {
  const [r] = await q<{ n: number | null }>(
    d,
    sql`SELECT min(count_freshness_days)::int AS n FROM public.pharmacy_dispensing_points
         WHERE hospital_id = ${hospitalId}::uuid`,
  );
  return r?.n ?? null;
}

/**
 * WS-2, Section 12: the number of administrations charted for each medicine on this ward since its
 * last count, from the administration record (the dose given on an admission to this ward, linked to
 * its prescription). Counts only: no dose, no patient.
 */
export async function dosesChartedSince(
  d: Reader,
  input: { hospitalId: string; wardId: string; since: ReadonlyMap<string, Date | null> },
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const medicines = [...input.since.keys()];
  if (!medicines.length) return out;
  const rows = await q<{ medicine: string; at: string }>(
    d,
    sql`SELECT p.drug_id AS medicine, m.administered_at AS at
          FROM public.medication_administration_records m
          JOIN public.prescriptions p ON p.id = m.emr_prescription_id
          JOIN public.admissions a ON a.inpatient_encounter_id = m.encounter_id
         WHERE m.hospital_id = ${input.hospitalId}::uuid AND a.ward_id = ${input.wardId}::uuid
           AND m.state = 'administered'
           AND NOT EXISTS (SELECT 1 FROM public.medication_administration_records r WHERE r.reverses_id = m.id)
           AND p.drug_id IN (${sql.join(
             medicines.map((m) => sql`${m}`),
             sql`, `,
           )})`,
  );
  for (const m of medicines) out.set(m, 0);
  for (const r of rows) {
    const since = input.since.get(r.medicine);
    if (!since || new Date(r.at) > since) out.set(r.medicine, (out.get(r.medicine) ?? 0) + 1);
  }
  return out;
}

export interface CartUse {
  at: Date;
  episodeRef: string;
  medicineAsRecorded: string;
}

/**
 * EC-2, D-PH2-21, Section 12: emergency administrations recorded on the resus desk against this cart
 * (its signed names, matched without case) since the last check. Time, episode reference and the
 * medicine as recorded; never a dose or a patient. A corrected event counts once (its correction).
 */
export async function cartUsesSince(
  d: Reader,
  input: { hospitalId: string; names: readonly string[]; since: Date | null },
): Promise<CartUse[]> {
  const names = input.names.map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (!names.length) return [];
  const since = input.since?.toISOString() ?? null;
  const rows = await q<{ at: string; episode: string; medicine: string | null }>(
    d,
    sql`SELECT e.recorded_at AS at, e.episode_id AS episode, e.payload->'prescribing'->>'drugName' AS medicine
          FROM public.resus_timeline_events e
          JOIN public.resus_episodes ep ON ep.id = e.episode_id
         WHERE ep.hospital_id = ${input.hospitalId}::uuid AND e.kind = 'drug'
           AND lower(trim(e.payload->'prescribing'->>'cart')) IN (${sql.join(
             names.map((n) => sql`${n}`),
             sql`, `,
           )})
           AND (${since}::timestamptz IS NULL OR e.recorded_at > ${since}::timestamptz)
           AND NOT EXISTS (SELECT 1 FROM public.resus_timeline_events c WHERE c.supersedes_event_id = e.id)
         ORDER BY e.recorded_at`,
  );
  return rows.map((r) => ({
    at: new Date(r.at),
    episodeRef: String(r.episode).slice(0, 8),
    medicineAsRecorded: r.medicine ?? "",
  }));
}

/** H2-16: cart names typed on the resus desk that match no cart's signed names, with their counts. */
export async function unmatchedCartNames(d: Reader, hospitalId: string, known: readonly string[]) {
  const rows = await q<{ name: string; n: number }>(
    d,
    sql`SELECT trim(e.payload->'prescribing'->>'cart') AS name, count(*)::int AS n
          FROM public.resus_timeline_events e
          JOIN public.resus_episodes ep ON ep.id = e.episode_id
         WHERE ep.hospital_id = ${hospitalId}::uuid AND e.kind = 'drug'
           AND coalesce(trim(e.payload->'prescribing'->>'cart'), '') <> ''
         GROUP BY 1 ORDER BY 1`,
  );
  const k = new Set(known.map((n) => n.trim().toLowerCase()));
  return rows
    .filter((r) => !k.has(r.name.toLowerCase()))
    .map((r) => ({ name: r.name, n: Number(r.n) }));
}

/** 5.7, RC-5: recall notices posted to these places, staff-facing: product and batch, never a patient. */
export async function recallNotices(d: Reader, hospitalId: string, locationIds: readonly string[]) {
  if (!locationIds.length) return [];
  return (
    await q<{
      id: string;
      location_id: string;
      product: string;
      batch_number: string | null;
      posted_at: string;
    }>(
      d,
      sql`SELECT n.id, n.location_id, p.name AS product, r.batch_number, n.posted_at
            FROM public.pharmacy_recall_ward_notices n
            JOIN public.pharmacy_recalls r ON r.id = n.recall_id
            JOIN public.pharmacy_products p ON p.id = r.product_id
           WHERE n.hospital_id = ${hospitalId}::uuid AND n.location_id IN (${ids(locationIds)})
             AND r.closed_at IS NULL
           ORDER BY n.posted_at DESC`,
    )
  ).map((r) => ({
    id: r.id,
    locationId: r.location_id,
    product: r.product,
    batchNumber: r.batch_number,
    postedAt: new Date(r.posted_at),
  }));
}

/* ─── The ledger at one place ─────────────────────────────────────────── */

export interface PlaceProduct {
  id: string;
  name: string;
  medicineId: string;
  issueUnit: string;
  controlled: boolean;
  batches: (StoreBatch & { expiryText: string })[];
}

interface MovementRow {
  batch_id: string;
  kind: string;
  quantity: number;
  effective_at: string;
}

/** The products a place keeps (its pack, its placements, its batches) with their batches. */
export async function placeStock(
  d: Reader,
  hospitalId: string,
  locationId: string,
  packIds: readonly string[],
) {
  const products = await q<{ id: string; name: string; medicine_id: string; issue_unit: string }>(
    d,
    sql`SELECT p.id, p.name, p.medicine_id, p.issue_unit FROM public.pharmacy_products p
         WHERE p.hospital_id = ${hospitalId}::uuid AND (
           EXISTS (SELECT 1 FROM public.pharmacy_product_locations pl
                    WHERE pl.product_id = p.id AND pl.location_id = ${locationId}::uuid AND pl.active)
           OR EXISTS (SELECT 1 FROM public.pharmacy_batches b
                       WHERE b.product_id = p.id AND b.location_id = ${locationId}::uuid)
           ${packIds.length ? sql`OR p.id IN (${ids(packIds)})` : sql``})
         ORDER BY p.name`,
  );
  const batches = await q<{
    id: string;
    product_id: string;
    medicine_id: string;
    batch_number: string;
    expiry: string;
    expiry_month_only: boolean;
  }>(
    d,
    sql`SELECT b.id, b.product_id, p.medicine_id, b.batch_number, b.expiry::text AS expiry, b.expiry_month_only
          FROM public.pharmacy_batches b JOIN public.pharmacy_products p ON p.id = b.product_id
         WHERE b.location_id = ${locationId}::uuid`,
  );
  const movements = await q<MovementRow>(
    d,
    sql`SELECT batch_id, kind, quantity, effective_at FROM public.pharmacy_stock_movements
         WHERE location_id = ${locationId}::uuid`,
  );
  const signedControlled = await controlledMedicineIds(d, hospitalId);
  const balances = new Map<string, number>();
  for (const m of movements)
    balances.set(m.batch_id, (balances.get(m.batch_id) ?? 0) + Number(m.quantity));
  const list: PlaceProduct[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    medicineId: p.medicine_id,
    issueUnit: p.issue_unit,
    controlled: !!drugById(p.medicine_id)?.flags.controlled || signedControlled.has(p.medicine_id),
    batches: batches
      .filter((b) => b.product_id === p.id)
      .map((b) => {
        const sb: StoreBatch = {
          id: b.id,
          pointId: locationId,
          productId: b.product_id,
          medicineId: b.medicine_id,
          batchNumber: b.batch_number,
          expiry: String(b.expiry).slice(0, 10),
          expiryMonthOnly: b.expiry_month_only,
        };
        return { ...sb, expiryText: expiryText(sb) };
      }),
  }));
  return { products: list, balances, movements };
}

/** The last count of each product at a place: the figure, when, by whom, and whether it was allocated. */
export async function lastCounts(d: Reader, locationId: string) {
  const rows = await q<{
    product_id: string;
    count_id: string;
    counted_at: string;
    by_name: string | null;
    counted: number;
    allocated: boolean;
  }>(
    d,
    sql`SELECT b.product_id, c.id AS count_id, c.counted_at, u.full_name AS by_name,
               sum(l.counted_quantity)::int AS counted, bool_or(l.difference_note = ${ALLOCATED_NOTE}) AS allocated
          FROM public.pharmacy_count_lines l
          JOIN public.pharmacy_counts c ON c.id = l.count_id
          JOIN public.pharmacy_batches b ON b.id = l.batch_id
          LEFT JOIN public.users u ON u.id = c.counted_by
         WHERE c.location_id = ${locationId}::uuid
         GROUP BY b.product_id, c.id, c.counted_at, u.full_name
         ORDER BY c.counted_at DESC`,
  );
  const out = new Map<
    string,
    { countId: string; counted: number; at: Date; by: string; allocated: boolean }
  >();
  for (const r of rows)
    if (!out.has(r.product_id))
      out.set(r.product_id, {
        countId: r.count_id,
        counted: Number(r.counted),
        at: new Date(r.counted_at),
        by: r.by_name ?? "",
        allocated: !!r.allocated,
      });
  return out;
}

/** WS-3, Law 11: count lines that found more than the ledger held, and whether the reason is in. */
export async function surplusLines(d: Reader, locationId: string) {
  return (
    await q<{
      count_id: string;
      batch_id: string;
      product: string;
      batch_number: string;
      counted: number;
      recorded: number;
      reasoned: boolean;
      counted_at: string;
    }>(
      d,
      sql`SELECT l.count_id, l.batch_id, p.name AS product, b.batch_number, l.counted_quantity AS counted,
                 l.recorded_balance AS recorded, c.counted_at,
                 EXISTS (SELECT 1 FROM public.pharmacy_stock_movements m WHERE m.source_kind = 'count'
                          AND m.source_id = l.count_id AND m.batch_id = l.batch_id AND m.kind = 'adjusted') AS reasoned
            FROM public.pharmacy_count_lines l
            JOIN public.pharmacy_counts c ON c.id = l.count_id
            JOIN public.pharmacy_batches b ON b.id = l.batch_id
            JOIN public.pharmacy_products p ON p.id = b.product_id
           WHERE c.location_id = ${locationId}::uuid AND l.counted_quantity > l.recorded_balance
           ORDER BY c.counted_at DESC`,
    )
  ).map((r) => ({
    countId: r.count_id,
    batchId: r.batch_id,
    product: r.product,
    batchNumber: r.batch_number,
    counted: Number(r.counted),
    recorded: Number(r.recorded),
    reasoned: !!r.reasoned,
    at: new Date(r.counted_at),
  }));
}

export interface PendingIssue {
  id: string;
  issuedAt: Date;
  fromName: string;
  lines: {
    batchId: string;
    productName: string;
    issueUnit: string;
    batchNumber: string;
    quantity: number;
    controlled: boolean;
  }[];
}

/** IS-3, 5.3: issues to this place not yet confirmed ("Issued {time}, not yet confirmed by {location}"). */
export async function pendingIssues(
  d: Reader,
  hospitalId: string,
  locationId: string,
): Promise<PendingIssue[]> {
  const rows = await q<{
    id: string;
    issued_at: string;
    from_name: string;
    batch_id: string;
    product: string;
    issue_unit: string;
    medicine_id: string;
    batch_number: string;
    quantity: number;
  }>(
    d,
    sql`SELECT i.id, i.issued_at, f.name AS from_name, m.batch_id, p.name AS product, p.issue_unit,
               p.medicine_id, b.batch_number, m.quantity
          FROM public.pharmacy_issues i
          JOIN public.pharmacy_locations f ON f.id = i.from_location_id
          JOIN public.pharmacy_stock_movements m
            ON m.source_id = i.id AND m.kind = 'received_from_issue'
           AND m.location_id = CASE WHEN i.voucher IS NULL THEN i.to_location_id
                 ELSE (SELECT t.id FROM public.pharmacy_locations t WHERE t.hospital_id = i.hospital_id AND t.kind = 'transit') END
          JOIN public.pharmacy_batches b ON b.id = m.batch_id
          JOIN public.pharmacy_products p ON p.id = b.product_id
         WHERE i.hospital_id = ${hospitalId}::uuid AND i.to_location_id = ${locationId}::uuid
           AND i.kind IN ('issue','restock')
           AND NOT EXISTS (SELECT 1 FROM public.pharmacy_issue_confirmations c WHERE c.issue_id = i.id)
         ORDER BY i.issued_at`,
  );
  const signedControlled = await controlledMedicineIds(d, hospitalId);
  const out = new Map<string, PendingIssue>();
  for (const r of rows) {
    const issue = out.get(r.id) ?? {
      id: r.id,
      issuedAt: new Date(r.issued_at),
      fromName: r.from_name,
      lines: [],
    };
    issue.lines.push({
      batchId: r.batch_id,
      productName: r.product,
      issueUnit: r.issue_unit,
      batchNumber: r.batch_number,
      quantity: Number(r.quantity),
      controlled:
        !!drugById(r.medicine_id)?.flags.controlled || signedControlled.has(r.medicine_id),
    });
    out.set(r.id, issue);
  }
  return [...out.values()];
}

/** Open requisitions this place raised, per product: quantity asked and state. */
async function openAsks(d: Reader, locationId: string) {
  const rows = await q<{ product_id: string; asked: number; state: string }>(
    d,
    sql`SELECT l.product_id, l.quantity_asked AS asked, r.state FROM public.pharmacy_requisition_lines l
          JOIN public.pharmacy_requisitions r ON r.id = l.requisition_id
         WHERE r.requesting_location_id = ${locationId}::uuid AND r.state IN ('raised','issued','part_issued')
         ORDER BY r.raised_at DESC`,
  );
  const out = new Map<string, { asked: number; state: string }>();
  for (const r of rows)
    if (!out.has(r.product_id)) out.set(r.product_id, { asked: Number(r.asked), state: r.state });
  return out;
}

const IN_KINDS = new Set(["received_from_issue"]);
const RETURN_KINDS = new Set(["returned_out", "quarantined_out"]);

/**
 * 5.4: the ward stock page. Each row: the signed level, the last count, issued and returned since it,
 * doses charted since it (context, never subtracted: WS-2), and the WS-1 top-up. No "on the ward now".
 */
export async function getWardStockPage(
  d: Reader,
  hospitalId: string,
  locationId: string,
  now: Date,
) {
  const location = await placeById(d, hospitalId, locationId);
  if (!location || location.kind !== "ward") return null;
  const packs = await packsOf(d, locationId, "ward_levels");
  const levels = packQuantities(packs.signed?.content, "levels");
  const draftLevels = packQuantities(packs.draft?.content, "levels");
  const stock = await placeStock(d, hospitalId, locationId, [
    ...new Set([...levels.keys(), ...draftLevels.keys()]),
  ]);
  const [counts, freshnessDays, asks, receipts, notices, surplus, allocationSigned, from] =
    await Promise.all([
      lastCounts(d, locationId),
      countFreshnessDays(d, hospitalId),
      openAsks(d, locationId),
      pendingIssues(d, hospitalId, locationId),
      recallNotices(d, hospitalId, [locationId]),
      surplusLines(d, locationId),
      allocationRuleSigned(d, hospitalId),
      issuers(d, hospitalId),
    ]);
  const productOfBatch = new Map(
    stock.products.flatMap((p) => p.batches.map((b) => [b.id, p.id] as const)),
  );
  const since = new Map(stock.products.map((p) => [p.medicineId, counts.get(p.id)?.at ?? null]));
  const doses = location.wardId
    ? await dosesChartedSince(d, { hospitalId, wardId: location.wardId, since })
    : new Map<string, number>();
  const rows = stock.products.map((p) => {
    const last = counts.get(p.id) ?? null;
    let issuedSince = 0;
    let returnedSince = 0;
    for (const m of stock.movements) {
      if (productOfBatch.get(m.batch_id) !== p.id) continue;
      if (last && new Date(m.effective_at) <= last.at) continue;
      if (IN_KINDS.has(m.kind)) issuedSince += Number(m.quantity);
      if (RETURN_KINDS.has(m.kind)) returnedSince -= Number(m.quantity);
    }
    return {
      ...wardRow({
        productId: p.id,
        wardLevel: levels.get(p.id) ?? null,
        lastCount: last ? { counted: last.counted, at: last.at, by: last.by } : null,
        issuedSince,
        returnedSince,
        dosesCharted: doses.get(p.medicineId) ?? 0,
        now,
        freshnessDays,
      }),
      name: p.name,
      issueUnit: p.issueUnit,
      allocated: last?.allocated ?? false,
      ask: asks.get(p.id) ?? null,
    };
  });
  // 4.13 (ADR 0464): use at the last count against doses charted from ward stock. The administration record
  // names no stock source, so `charted` is null on real data and every row reads "Not charted from ward stock".
  let useCheck: (UseRow & { countId: string; compared: Compared })[] | null = null;
  if (pharmacyCatalogueLiveFor(hospitalId)) {
    const reasons = await gapReasonsOf(d, [...new Set([...counts.values()].map((c) => c.countId))]);
    useCheck = wardUseCheck(
      stock.products.flatMap((p) => {
        const last = counts.get(p.id);
        if (!last) return [];
        let used = 0;
        for (const m of stock.movements)
          if (
            m.kind === "ward_used" &&
            productOfBatch.get(m.batch_id) === p.id &&
            new Date(m.effective_at).getTime() === last.at.getTime()
          )
            used -= Number(m.quantity);
        return [
          {
            productId: p.id,
            name: p.name,
            used,
            charted: null,
            reason: reasons.get(`${last.countId}:${p.id}`) ?? null,
            countId: last.countId,
          },
        ];
      }),
      null,
    ).rows;
  }
  return {
    location,
    packs,
    rows,
    useCheck,
    products: stock.products,
    balances: stock.balances,
    receipts,
    notices,
    surplus,
    allocationSigned,
    freshnessDays,
    issuers: from,
    batchesMixed: rows.some((r) => r.allocated),
    today: localDate(now),
  };
}
export type WardStockPage = NonNullable<Awaited<ReturnType<typeof getWardStockPage>>>;

/** The last check of each cart, and whether it is overdue past the signed check interval (S26). */
export async function lastChecks(d: Reader, locationIds: readonly string[]) {
  if (!locationIds.length) return new Map<string, Date>();
  const rows = await q<{ location_id: string; at: string }>(
    d,
    sql`SELECT location_id, max(checked_at) AS at FROM public.pharmacy_cart_checks
         WHERE location_id IN (${ids(locationIds)}) GROUP BY location_id`,
  );
  return new Map(rows.map((r) => [r.location_id, new Date(r.at)]));
}

/** 5.5: every cart, its signed list and last check; overdue past the signed interval; H2-16 names. */
export async function getCartsPage(d: Reader, hospitalId: string, now: Date) {
  const carts = await listPlaces(d, hospitalId, "cart");
  const checks = await lastChecks(
    d,
    carts.map((c) => c.id),
  );
  const rows = await Promise.all(
    carts.map(async (c) => {
      const packs = await packsOf(d, c.id, "cart_list");
      const list = packs.signed ? cartListOf(packs.signed.content) : null;
      const last = checks.get(c.id) ?? null;
      const overdue =
        !!list?.checkIntervalDays &&
        (!last || now.getTime() - last.getTime() > list.checkIntervalDays * 86_400_000);
      return { ...c, list, lastCheck: last, overdue, signal: null as CartSignal | null };
    }),
  );
  // 4.14 (ADR 0465): a broken seal, or a resus dose from the cart, since its last check puts it on the list.
  if (pharmacyCatalogueLiveFor(hospitalId)) {
    const seals = await sealsOf(
      d,
      rows.map((r) => r.id),
    );
    for (const r of rows) {
      const uses = await cartUsesSince(d, {
        hospitalId,
        names: r.list?.names ?? [],
        since: r.lastCheck,
      });
      r.signal = cartSignals({
        lastCheckAt: r.lastCheck,
        seals: seals
          .filter((s) => s.locationId === r.id)
          .map((s) => ({ kind: s.kind, at: s.reportedAt })),
        resusDoses: uses,
      });
    }
  }
  const unmatched = await unmatchedCartNames(
    d,
    hospitalId,
    rows.flatMap((r) => r.list?.names ?? []),
  );
  return { rows, unmatched };
}

/** 5.5: one cart, its signed list and draft, its stock, and the uses recorded since its last check. */
export async function getCartPage(d: Reader, hospitalId: string, locationId: string, now: Date) {
  const location = await placeById(d, hospitalId, locationId);
  if (!location || location.kind !== "cart") return null;
  const packs = await packsOf(d, locationId, "cart_list");
  const list = packs.signed ? cartListOf(packs.signed.content) : null;
  const draft = packs.draft ? cartListOf(packs.draft.content) : null;
  const stock = await placeStock(d, hospitalId, locationId, [
    ...new Set([...(list?.items.keys() ?? []), ...(draft?.items.keys() ?? [])]),
  ]);
  const last = (await lastChecks(d, [locationId])).get(locationId) ?? null;
  const [uses, from, carts, receipts] = await Promise.all([
    cartUsesSince(d, { hospitalId, names: list?.names ?? [], since: last }),
    issuers(d, hospitalId),
    listPlaces(d, hospitalId, "cart"),
    pendingIssues(d, hospitalId, locationId),
  ]);
  const overdue =
    !!list?.checkIntervalDays &&
    (!last || now.getTime() - last.getTime() > list.checkIntervalDays * 86_400_000);
  return {
    location,
    packs,
    list,
    draft,
    products: stock.products,
    lastCheck: last,
    overdue,
    uses,
    issuers: from,
    otherCarts: carts.filter((c) => c.id !== locationId),
    receipts,
    seals: pharmacyCatalogueLiveFor(hospitalId) ? await sealsOf(d, [locationId]) : null,
    today: localDate(now),
  };
}
export type CartPage = NonNullable<Awaited<ReturnType<typeof getCartPage>>>;

/** The people who may give a ward's or cart's second signature or confirmation, by their right here. */
export async function confirmersAt(
  d: Reader,
  hospitalId: string,
  locationId: string,
  right: "ward_act" | "cart_confirm",
) {
  return q<{ userId: string; label: string }>(
    d,
    sql`SELECT u.id AS "userId", u.full_name AS label FROM public.users u
         WHERE u.id IN (SELECT nurse_user_id FROM public.ward_in_charge_assignments
                         WHERE hospital_id = ${hospitalId}::uuid AND (ends_at IS NULL OR ends_at > now())
                        UNION SELECT user_id FROM public.department_heads
                         WHERE hospital_id = ${hospitalId}::uuid AND (ends_at IS NULL OR ends_at > now()))
           AND private.pharmacy_location_right(u.id, ${locationId}::uuid, ${right})
         ORDER BY u.full_name`,
  );
}

/** The hospital's active products, for the ward levels and cart list editors. */
export async function hospitalProducts(d: Reader, hospitalId: string) {
  return q<{ id: string; name: string; issueUnit: string }>(
    d,
    sql`SELECT id, name, issue_unit AS "issueUnit" FROM public.pharmacy_products
         WHERE hospital_id = ${hospitalId}::uuid AND active ORDER BY name`,
  );
}

/** `pharmacy.manage` for this person (a hub head assignment, read in SQL as the writes check it). */
export async function manages(d: Reader, userId: string, hospitalId: string) {
  const [r] = await q<{ ok: boolean }>(
    d,
    sql`SELECT private.pharmacy_can_user(${userId}::uuid, ${hospitalId}::uuid, 'pharmacy.manage') AS ok`,
  );
  return r?.ok === true;
}
