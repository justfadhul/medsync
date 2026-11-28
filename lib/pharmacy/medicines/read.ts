import "server-only";

import type { Cond, Line, Place } from "@/lib/pharmacy/derive/medicines";
import type { PharmacyActor } from "@/lib/pharmacy/write";
import { sql } from "drizzle-orm";

import { emhsluGroup } from "@/content/pharmacy-supplies";
import nationalList from "@/data/pharmacy/national-list/controlled.v1.json";
import { appDb, rowsOf } from "@/lib/pharmacy/audit/read";
import { lastUnitCosts, ruleOn } from "@/lib/pharmacy/prices/store";
import { localDate } from "@/lib/pharmacy/stock/ledger";
import { supplyFormOf } from "@/lib/pharmacy/supplies/defaults";

/**
 * The medicine master's payload (MEDICINES-TAB.md §12, §14): every stocked line with its stock, levels, batches,
 * prices and brands, the places with their fridges, the payers, the rules and proposals, the viewer's saved views and
 * the open top-up requests and order asks. One round of queries; the grid derives everything else (§15). Before 0270
 * is applied the new columns are missing: the loader says so instead of failing.
 */

export interface Payer {
  id: string;
  name: string;
  kind: string;
}
export interface RuleRow {
  group: string;
  key: string;
  text: string;
  productId: string | null;
}
export interface Proposal {
  id: string;
  group: string;
  key: string;
  newText: string;
  reason: string;
  productId: string | null;
  inCharge: string | null;
  second: string | null;
}
export interface Ask {
  id: string;
  qty: number;
}
export interface MedicinesCan {
  /** VEN, class, flags, prices, brands, add and stop lines, bulk. */
  edit: boolean;
  /** Levels and packs (the store keeper). */
  levels: boolean;
  review: boolean;
  propose: boolean;
  signInCharge: boolean;
  signSecond: boolean;
  request: boolean;
}
export interface MedicinesPayload {
  ok: true;
  today: string;
  lines: Line[];
  places: Place[];
  storeId: string | null;
  payers: Payer[];
  cashPayerId: string | null;
  /** EMHSLU Section C is on for this hospital (§A). */
  sectionC: boolean;
  rulePct: number | null;
  rules: RuleRow[];
  proposals: Proposal[];
  views: { id: string; name: string; conds: Cond[] }[];
  /** Open requests to the store, by line then place. */
  requests: Record<string, Record<string, Ask>>;
  /** Open "add to the order" asks, by line. */
  orders: Record<string, Ask>;
  lastMove: { at: string; text: string; productId: string; placeId: string } | null;
  /** Starter brands per line, from the NDA register's products for its catalogue medicine (§4.5). */
  starters: Record<string, { name: string; maker: string | null }[]>;
  can: MedicinesCan;
}
export type MedicinesLoad = MedicinesPayload | { ok: false; reason: "migration" };

/** 42703 undefined column, 42P01 undefined table: 0270 is not applied here yet. */
export const missingMigration = (e: unknown): boolean => {
  const code =
    (e as { code?: string; cause?: { code?: string } })?.code ??
    (e as { cause?: { code?: string } })?.cause?.code;
  return code === "42703" || code === "42P01";
};

const NATIONAL = nationalList.items as { generic: string; form?: string }[];
export const onNationalList = (generic: string, form: string | null) =>
  NATIONAL.some(
    (i) =>
      i.generic === generic.toLowerCase() &&
      (!i.form || (form ?? "").toLowerCase().includes(i.form)),
  );

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Kampala",
  });
};

export function permissionsFor(actor: PharmacyActor, manages: boolean): MedicinesCan {
  const has = (p: string) => actor.access.permissions.has(p as never);
  const edit = manages || has("pharmacy.review");
  return {
    edit,
    levels: edit || has("pharmacy.store"),
    review: manages,
    propose: edit,
    signInCharge: manages,
    // ADR 0550: the head of pharmacy signs a rule change alone; nobody signs as a second signer.
    signSecond: false,
    request: manages || has("pharmacy.stock") || has("pharmacy.store"),
  };
}

export async function loadMedicinesMaster(
  actor: PharmacyActor,
  manages: boolean,
  database = appDb(),
): Promise<MedicinesLoad> {
  try {
    return await load(actor, manages, database);
  } catch (e) {
    if (missingMigration(e)) return { ok: false, reason: "migration" };
    throw e;
  }
}

async function load(actor: PharmacyActor, manages: boolean, db: ReturnType<typeof appDb>) {
  const h = actor.hospitalId;
  const today = localDate(new Date());
  const q = <T>(s: ReturnType<typeof sql>) => db.execute(s).then((r) => rowsOf<T>(r));
  const [
    placeRows,
    lineRows,
    priceRows,
    brandRows,
    levelRows,
    stockRows,
    useRows,
    payerRows,
    ruleRows,
    proposalRows,
    viewRows,
    requestRows,
    orderRows,
    moveRows,
    starterRows,
    costs,
    rule,
  ] = await Promise.all([
    q<Record<string, unknown>>(sql`
      SELECT l.id, l.name, l.kind, f.code, f.name AS fridge, f.sensor_key_hash IS NOT NULL AS sensor,
             r.temp_c::float8 AS temp, r.read_at::text AS read_at
        FROM public.pharmacy_locations l
        LEFT JOIN LATERAL (SELECT * FROM public.pharmacy_fridges x WHERE x.location_id = l.id AND x.archived_at IS NULL
                            ORDER BY x.code LIMIT 1) f ON true
        LEFT JOIN LATERAL (SELECT temp_c, read_at FROM public.pharmacy_fridge_readings y WHERE y.fridge_id = f.id
                            ORDER BY y.read_at DESC LIMIT 1) r ON true
       WHERE l.hospital_id = ${h} AND l.archived_at IS NULL AND l.switched_off_at IS NULL
         AND l.kind IN ('store','dispensing_point','ward')
       ORDER BY CASE l.kind WHEN 'store' THEN 0 WHEN 'dispensing_point' THEN 1 ELSE 2 END, l.created_at, l.name`),
    q<Record<string, unknown>>(sql`
      SELECT p.id, p.name, p.issue_unit, coalesce(p.strength, si.specification) AS strength, p.controlled_class, p.hand_added, p.local_reason,
             coalesce(p.generic, cm.generic, si.name, p.name) AS generic, coalesce(p.form, cm.form_label) AS form,
             coalesce(p.route, cm.route_label) AS route, coalesce(p.therapeutic_class, cm.therapeutic_class, si.category) AS cls,
             coalesce(p.pharm_group, cm.pharm_group) AS grp, coalesce(p.sale_category, cm.sale_category) AS sale,
             p.ven, p.high_risk, p.cold_chain, p.freeze_sensitive, p.cytotoxic, p.packs, p.loose, p.gtin,
             p.item_type, p.level_of_care, p.sterile, p.test_kit, p.no_expiry, p.free_issue,
             coalesce(cm.national_controlled, false) AS national,
             (${today}::date - coalesce(p.reviewed_at, p.created_at)::date) AS reviewed_days,
             (${today}::date - p.created_at::date) AS age_days
        FROM public.pharmacy_products p
        LEFT JOIN public.cat_medicines cm ON cm.id = p.catalogue_medicine_id
        LEFT JOIN public.cat_supply_items si ON si.id = p.supply_item_id
       WHERE p.hospital_id = ${h} AND p.active
       ORDER BY 8, 4
       LIMIT 5000`),
    q<{ product_id: string; payer_id: string; price: number | null; free: boolean }>(sql`
      SELECT DISTINCT ON (product_id, payer_id) product_id, payer_id, price_ugx AS price, free
        FROM public.pharmacy_product_prices
       WHERE hospital_id = ${h} AND from_date <= ${today}::date
       ORDER BY product_id, payer_id, from_date DESC, created_at DESC`),
    q<{
      id: string;
      product_id: string;
      brand: string;
      maker: string | null;
      price: number | null;
    }>(sql`
      SELECT id, product_id, brand, maker, price_ugx AS price FROM public.pharmacy_line_brands
       WHERE hospital_id = ${h} AND removed_at IS NULL ORDER BY added_at`),
    q<{ product_id: string; place_id: string; level: number | null }>(sql`
      SELECT DISTINCT ON (p.id, coalesce(r.location_id, r.dispensing_point_id))
             p.id AS product_id, coalesce(r.location_id, r.dispensing_point_id) AS place_id, r.level
        FROM public.pharmacy_reorder_levels r
        JOIN public.pharmacy_products p ON p.hospital_id = r.hospital_id AND p.active
         AND (r.product_id = p.id OR (r.product_id IS NULL AND r.medicine_id = p.medicine_id))
       WHERE r.hospital_id = ${h}
       ORDER BY p.id, coalesce(r.location_id, r.dispensing_point_id), r.set_at DESC`),
    // ponytail: sums the whole ledger per batch and place; a balance table if this grows slow.
    q<{
      product_id: string;
      place_id: string;
      batch_id: string;
      batch: string;
      expiry: string;
      days: number;
      qty: number;
    }>(sql`
      SELECT b.product_id, coalesce(m.location_id, m.dispensing_point_id) AS place_id, b.id AS batch_id,
             b.batch_number AS batch, b.expiry::text AS expiry, (b.expiry - ${today}::date) AS days,
             sum(m.quantity)::int AS qty
        FROM public.pharmacy_stock_movements m JOIN public.pharmacy_batches b ON b.id = m.batch_id
       WHERE m.hospital_id = ${h}
       GROUP BY 1, 2, 3, 4, 5, 6 HAVING sum(m.quantity) <> 0`),
    q<{ product_id: string; used: number; last: string | null }>(sql`
      SELECT b.product_id,
             coalesce(sum(-m.quantity) FILTER (WHERE m.kind IN ('supplied','ward_used','cart_used')
               AND m.effective_at >= now() - interval '90 days'), 0)::float8 AS used,
             (${today}::date - max(m.effective_at)
               FILTER (WHERE m.kind IN ('supplied','issued','ward_used','cart_used'))::date) AS last
        FROM public.pharmacy_stock_movements m JOIN public.pharmacy_batches b ON b.id = m.batch_id
       WHERE m.hospital_id = ${h}
       GROUP BY 1`),
    q<Payer & { code: string }>(sql`
      SELECT id, code, name, kind FROM public.pharmacy_payers WHERE hospital_id = ${h} AND active
       ORDER BY kind <> 'cash', created_at`),
    q<{ rule_group: string; key: string; text: string; product_id: string | null }>(sql`
      SELECT rule_group, key, text, product_id FROM public.pharmacy_rules WHERE hospital_id = ${h}`),
    q<Record<string, string | null>>(sql`
      SELECT p.id, p.rule_group, p.key, p.new_text, p.reason, p.product_id,
             (SELECT coalesce(u.full_name, u.email) FROM public.pharmacy_rule_signatures s
                LEFT JOIN public.users u ON u.id = s.signed_by WHERE s.proposal_id = p.id AND s.role = 'in_charge') AS ic,
             (SELECT coalesce(u.full_name, u.email) FROM public.pharmacy_rule_signatures s
                LEFT JOIN public.users u ON u.id = s.signed_by WHERE s.proposal_id = p.id AND s.role = 'second') AS sec
        FROM public.pharmacy_rule_proposals p
       WHERE p.hospital_id = ${h} AND p.status = 'pending' ORDER BY p.proposed_at`),
    q<{ id: string; name: string; conditions: Cond[] | string }>(sql`
      SELECT id, name, conditions FROM public.pharmacy_saved_views
       WHERE hospital_id = ${h} AND user_id = ${actor.userId} AND deleted_at IS NULL ORDER BY created_at`),
    q<{ id: string; product_id: string; place_id: string; qty: number }>(sql`
      SELECT r.id, l.product_id, r.requesting_location_id AS place_id, l.quantity_asked AS qty
        FROM public.pharmacy_requisitions r JOIN public.pharmacy_requisition_lines l ON l.requisition_id = r.id
       WHERE r.hospital_id = ${h} AND r.state = 'raised'`),
    q<{ id: string; product_id: string; qty: number }>(sql`
      SELECT id, product_id, quantity AS qty FROM public.pharmacy_order_asks
       WHERE hospital_id = ${h} AND withdrawn_at IS NULL AND order_id IS NULL`),
    q<{
      at: string;
      product_id: string;
      place_id: string;
      name: string;
      place: string;
      qty: number;
      unit: string;
    }>(sql`
      SELECT m.recorded_at::text AS at, b.product_id, coalesce(m.location_id, m.dispensing_point_id) AS place_id,
             coalesce(p.generic, p.name) AS name, l.name AS place, m.quantity AS qty, p.issue_unit AS unit
        FROM public.pharmacy_stock_movements m JOIN public.pharmacy_batches b ON b.id = m.batch_id
        JOIN public.pharmacy_products p ON p.id = b.product_id
        LEFT JOIN public.pharmacy_locations l ON l.id = coalesce(m.location_id, m.dispensing_point_id)
       WHERE m.hospital_id = ${h} ORDER BY m.recorded_at DESC LIMIT 1`),
    q<{ product_id: string; name: string; maker: string | null }>(sql`
      SELECT DISTINCT p.id AS product_id, cp.brand_name AS name, f.name AS maker
        FROM public.pharmacy_products p
        JOIN public.cat_products cp ON cp.medicine_id = p.catalogue_medicine_id AND cp.status = 'active'
        LEFT JOIN public.cat_manufacturers f ON f.id = cp.manufacturer_id
       WHERE p.hospital_id = ${h} AND p.active AND cp.brand_name IS NOT NULL`),
    lastUnitCosts(db, h),
    ruleOn(db, h, today),
  ]);

  const places: Place[] = placeRows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    short: String(r.name).split(" · ")[0]!,
    isStore: r.kind === "store",
    fridge: r.code
      ? {
          code: String(r.code),
          name: String(r.fridge),
          temp: num(r.temp),
          sensor: r.sensor === true,
          at: r.read_at ? hhmm(String(r.read_at)) : null,
        }
      : null,
  }));
  const placeIds = new Set(places.map((p) => p.id));
  const cash = payerRows.find((p) => p.code === "cash")?.id ?? null;

  const by = <T extends { product_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.product_id, [...(m.get(r.product_id) ?? []), r]);
    return m;
  };
  const prices = by(priceRows);
  const brands = by(brandRows);
  const levels = by(levelRows);
  const stock = by(stockRows);
  const use = new Map(useRows.map((u) => [u.product_id, u]));

  const lines = lineRows.map((r) => {
    const id = String(r.id);
    const p = prices.get(id) ?? [];
    const lv: Record<string, number> = {};
    for (const x of levels.get(id) ?? [])
      if (x.level !== null && x.level > 0 && placeIds.has(x.place_id)) lv[x.place_id] = x.level;
    const st: Record<string, number> = {};
    const batches = new Map<string, { no: string; days: number; qty: number }>();
    for (const x of stock.get(id) ?? []) {
      st[x.place_id] = (st[x.place_id] ?? 0) + x.qty;
      const b = batches.get(x.batch) ?? { no: x.batch, days: x.days, qty: 0 };
      b.qty += x.qty;
      batches.set(x.batch, b);
    }
    const u = use.get(id);
    const generic = String(r.generic);
    const itemType = String(r.item_type) as Line["itemType"];
    const supply = itemType !== "medicine";
    const level = (r.level_of_care as string | null) ?? null;
    const form =
      (r.form as string | null) ?? (supply ? supplyFormOf(generic, r.cls as string | null) : null);
    return {
      id,
      name: String(r.name),
      generic,
      strength: (r.strength as string | null) ?? null,
      form,
      route: (r.route as string | null) ?? null,
      unit: String(r.issue_unit),
      cls: (r.cls as string | null) ?? null,
      group: supply && level ? emhsluGroup(level) : ((r.grp as string | null) ?? null),
      sale: supply ? "supply" : ((r.sale as Line["sale"]) ?? null),
      itemType,
      noExpiry: r.no_expiry === true,
      ven: (r.ven as Line["ven"]) ?? null,
      flags: {
        controlled: r.controlled_class !== null,
        high: r.high_risk === true,
        cold: r.cold_chain === true,
        freeze: r.freeze_sensitive === true,
        cyto: r.cytotoxic === true,
        sterile: r.sterile === true,
        kit: r.test_kit === true,
      },
      packs: ((r.packs as number[] | null) ?? []).map(Number),
      gtin: (r.gtin as string | null) ?? null,
      loose: r.loose === true,
      free: r.free_issue === true || (!!cash && p.some((x) => x.payer_id === cash && x.free)),
      prices: Object.fromEntries(
        p.filter((x) => !x.free && x.price !== null).map((x) => [x.payer_id, Number(x.price)]),
      ),
      brands: (brands.get(id) ?? []).map((b) => ({
        id: b.id,
        name: b.brand,
        maker: b.maker,
        price: num(b.price),
      })),
      local: r.hand_added === true,
      localReason: (r.local_reason as string | null) ?? null,
      nationalControlled: r.national === true || onNationalList(generic, form),
      cost: costs.get(id) ?? null,
      usePerDay: u ? Number(u.used) / 90 : 0,
      lastMovedDays:
        u?.last !== null && u?.last !== undefined ? Number(u.last) : Number(r.age_days),
      reviewedDays: num(r.reviewed_days),
      batches: [...batches.values()].filter((b) => b.qty > 0),
      batchRows: (stock.get(id) ?? [])
        .filter((x) => x.qty > 0 && r.no_expiry !== true)
        .map((x) => ({
          id: x.batch_id,
          no: x.batch,
          placeId: x.place_id,
          expiry: x.expiry,
          qty: x.qty,
        })),
      levels: lv,
      stock: st,
    };
  });

  const requests: MedicinesPayload["requests"] = {};
  for (const r of requestRows)
    (requests[r.product_id] ??= {})[r.place_id] = { id: r.id, qty: Number(r.qty) };
  const m = moveRows[0];
  const sign = (n: number) =>
    n > 0 ? `+${n.toLocaleString("en-US")}` : `−${Math.abs(n).toLocaleString("en-US")}`;

  return {
    ok: true as const,
    today,
    lines,
    places,
    storeId: places.find((p) => p.isStore)?.id ?? null,
    payers: payerRows.map(({ id, name, kind }) => ({ id, name, kind })),
    cashPayerId: cash,
    sectionC:
      (
        await q<{ section_c: boolean }>(
          sql`SELECT section_c FROM public.pharmacy_hospital_settings WHERE hospital_id = ${h}`,
        )
      )[0]?.section_c ?? false,
    rulePct: rule ? Math.round((rule.multiplier - 1) * 100) : null,
    rules: ruleRows.map((r) => ({
      group: r.rule_group,
      key: r.key,
      text: r.text,
      productId: r.product_id,
    })),
    proposals: proposalRows.map((p) => ({
      id: p.id!,
      group: p.rule_group!,
      key: p.key!,
      newText: p.new_text!,
      reason: p.reason!,
      productId: p.product_id ?? null,
      inCharge: p.ic ?? null,
      second: p.sec ?? null,
    })),
    views: viewRows.map((v) => ({
      id: v.id,
      name: v.name,
      conds: typeof v.conditions === "string" ? JSON.parse(v.conditions) : v.conditions,
    })),
    requests,
    orders: Object.fromEntries(
      orderRows.map((o) => [o.product_id, { id: o.id, qty: Number(o.qty) }]),
    ),
    lastMove: m
      ? {
          at: new Date(m.at).toLocaleTimeString("en-GB", { timeZone: "Africa/Kampala" }),
          text: `${m.name} at ${m.place ?? ""} ${sign(Number(m.qty))} ${m.unit}${Math.abs(Number(m.qty)) === 1 ? "" : "s"}`,
          productId: m.product_id,
          placeId: m.place_id,
        }
      : null,
    starters: Object.fromEntries(
      [...by(starterRows)].map(([k, v]) => [k, v.map((x) => ({ name: x.name, maker: x.maker }))]),
    ),
    can: permissionsFor(actor, manages),
  };
}

/** One line's history, newest first (§4.6): read when the row opens. */
export async function loadLineHistory(hospitalId: string, productId: string, database = appDb()) {
  return rowsOf<{ id: string; line: string; at: string }>(
    await database.execute(sql`
      SELECT id, line, created_at::text AS at FROM public.pharmacy_line_history
       WHERE hospital_id = ${hospitalId} AND product_id = ${productId}
       ORDER BY created_at DESC LIMIT 200`),
  );
}
