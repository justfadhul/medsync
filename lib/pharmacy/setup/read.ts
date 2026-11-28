import "server-only";

import type {
  FridgeRow,
  GoLiveView,
  MessagesView,
  PlaceRow,
  PlacesView,
  RulesView,
  SupplierRow,
  TemplateRow,
} from "./types";
import type { Exec } from "@/lib/pharmacy/audit/read";
import type { PharmacyActor } from "@/lib/pharmacy/write";
import { sql } from "drizzle-orm";

import { RULE_REGISTRY } from "@/content/pharmacy-rules";
import { CHECKLIST, SMS_TEMPLATES } from "@/content/pharmacy-setup";
import { decrypt } from "@/lib/encryption";
import { rowsOf } from "@/lib/pharmacy/audit/read";
import { maskPhone } from "@/lib/pharmacy/derive/setup/messages";
import { kampalaNow } from "@/lib/pharmacy/derive/setup/places";
import { permissionsFor } from "@/lib/pharmacy/medicines/read";
import { ruleNumbers, ruleText } from "@/lib/pharmacy/rules/registry";
import { rulesOf } from "@/lib/pharmacy/sms/store";

/**
 * Set-up › Going live, Places, Rules and Messages: one loader per tab, each a few queries, returning the plain views in
 * ./types.ts. Before 0274 is applied each returns null (the tab says the update is waiting).
 */
const ready = async (db: Exec) =>
  rowsOf<{ ok: boolean }>(
    await db.execute(sql`SELECT to_regclass('public.pharmacy_golive_state') IS NOT NULL AS ok`),
  )[0]?.ok === true;
const q = async <T>(db: Exec, query: ReturnType<typeof sql>) => rowsOf<T>(await db.execute(query));
const who = sql`coalesce(u.full_name, u.email)`;
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
const signedRules = (db: Exec, h: string) =>
  q<{ rule_group: string; key: string; text: string; params: { n?: number } | null }>(
    db,
    sql`SELECT rule_group, key, text, params FROM public.pharmacy_rules WHERE hospital_id = ${h}::uuid`,
  );
const decryptOr = (v: string | null) => {
  try {
    return v ? decrypt(v) : null;
  } catch {
    return null;
  }
};

/* ─── Going live ─────────────────────────────────────────────────────── */
export async function loadGoLive(
  db: Exec,
  actor: PharmacyActor,
  manages: boolean,
  now = new Date(),
): Promise<GoLiveView | null> {
  if (!(await ready(db))) return null;
  const h = actor.hospitalId;
  const [state, items, auto, practice, sigs, events, ms] = await Promise.all([
    q<{
      target_date: string | null;
      phase: GoLiveView["phase"];
      live_at: string | null;
      retired_at: string | null;
    }>(
      db,
      sql`SELECT target_date::text, phase, live_at, retired_at FROM public.pharmacy_golive_state WHERE hospital_id = ${h}::uuid`,
    ),
    q<{
      key: string;
      status: "todo" | "done";
      answer: string | null;
      answer_choice: string | null;
      decided_by: string | null;
      who: string | null;
      done_at: string | null;
      owner_role: string | null;
      due_on: string | null;
    }>(
      db,
      sql`SELECT i.key, i.status, i.answer, i.answer_choice, i.decided_by, ${who} AS who, i.done_at, i.owner_role,
             i.due_on::text FROM public.pharmacy_golive_items i LEFT JOIN public.users u ON u.id = i.done_by
           WHERE i.hospital_id = ${h}::uuid`,
    ),
    q<{ key: string; done: number; total: number }>(
      db,
      sql`SELECT * FROM private.pharmacy_golive_auto(${h}::uuid)`,
    ),
    q<{ open: boolean; me: boolean }>(
      db,
      sql`SELECT EXISTS (SELECT 1 FROM public.pharmacy_practice_sessions WHERE hospital_id = ${h}::uuid AND ended_at IS NULL) AS open,
             EXISTS (SELECT 1 FROM public.pharmacy_practice_trained WHERE hospital_id = ${h}::uuid
                       AND user_id = ${actor.userId}::uuid) AS me`,
    ),
    q<{ role: "in_charge" | "ms"; who: string; at: string; by: string }>(
      db,
      sql`SELECT s.role, ${who} AS who, s.signed_at AS at, s.signed_by AS by FROM public.pharmacy_golive_signatures s
           LEFT JOIN public.users u ON u.id = s.signed_by WHERE s.hospital_id = ${h}::uuid`,
    ),
    q<{
      at: string;
      who: string | null;
      kind: string;
      item_key: string | null;
      detail: string | null;
    }>(
      db,
      sql`SELECT e.at, ${who} AS who, e.kind, e.item_key, e.detail FROM public.pharmacy_golive_events e
           LEFT JOIN public.users u ON u.id = e.by_user WHERE e.hospital_id = ${h}::uuid ORDER BY e.at DESC LIMIT 8`,
    ),
    q<{ ok: boolean }>(
      db,
      sql`SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = ${actor.userId}::uuid
            AND hospital_id = ${h}::uuid AND role = 'hospital_admin') AS ok`,
    ),
  ]);
  const s = state[0];
  const isMs = ms[0]?.ok === true;
  const signedBy = new Set(sigs.map((x) => x.by));
  const live = !!s?.live_at;
  return {
    today: kampalaNow(now.getTime()).date,
    phase: s?.phase ?? "setup",
    target: s?.target_date ?? null,
    liveAt: iso(s?.live_at),
    retiredAt: iso(s?.retired_at),
    practice: { open: practice[0]?.open === true, trainedMe: practice[0]?.me === true },
    items: CHECKLIST.map((c) => {
      const r = items.find((i) => i.key === c.key);
      const a = auto.find((x) => x.key === c.key);
      return {
        key: c.key,
        status: r?.status ?? "todo",
        answer: r?.answer ?? null,
        choice: r?.answer_choice ?? null,
        decidedBy: r?.decided_by ?? null,
        doneByName: r?.who ?? null,
        doneAt: iso(r?.done_at),
        owner: r?.owner_role ?? c.owner,
        dueOn: r?.due_on ?? null,
        prog: c.kind === "auto" && a ? [Number(a.done), Number(a.total)] : null,
      };
    }),
    signatures: sigs.map((x) => ({ role: x.role, byName: x.who, at: iso(x.at)! })),
    events: events.map((e) => ({
      at: iso(e.at)!,
      who: e.who,
      kind: e.kind,
      item: (e.item_key as GoLiveView["items"][number]["key"]) ?? null,
      detail: e.detail,
    })),
    can: {
      manage: manages,
      answer: manages || isMs,
      signInCharge: manages && !live && !sigs.some((x) => x.role === "in_charge"),
      signMs: isMs && !live && !sigs.some((x) => x.role === "ms") && !signedBy.has(actor.userId),
    },
  };
}

/* ─── Places ─────────────────────────────────────────────────────────── */
export async function loadPlaces(
  db: Exec,
  actor: PharmacyActor,
  manages: boolean,
  now = new Date(),
): Promise<PlacesView | null> {
  if (!(await ready(db))) return null;
  const h = actor.hospitalId;
  const k = kampalaNow(now.getTime());
  const has = (p: string) => actor.access.permissions.has(p as never);
  const [
    places,
    stock,
    handovers,
    misses,
    duty,
    fridges,
    readings,
    excursions,
    suppliers,
    units,
    wards,
    signed,
    billing,
  ] = await Promise.all([
    q<{
      id: string;
      name: string;
      kind: PlaceRow["kind"];
      hours: PlaceRow["hours"];
      supplied_from: string | null;
      supplier_ids: string[];
      device_label: string | null;
      seen: string | null;
      slots: string[];
      closed_at: string | null;
      closed_who: string | null;
      closed_note: string | null;
    }>(
      db,
      sql`SELECT l.id, l.name, l.kind, l.hours, l.supplied_from, l.supplier_ids, l.device_label, d.last_seen_at AS seen,
               l.handover_slots AS slots, l.closed_at, ${who} AS closed_who, l.closed_note
             FROM public.pharmacy_locations l LEFT JOIN public.pharmacy_devices d ON d.location_id = l.id
             LEFT JOIN public.users u ON u.id = l.closed_by
            WHERE l.hospital_id = ${h}::uuid AND l.kind IN ('store','dispensing_point','ward','clinic','theatre')
              AND l.switched_off_at IS NULL
            ORDER BY CASE l.kind WHEN 'store' THEN 0 WHEN 'dispensing_point' THEN 1 WHEN 'ward' THEN 2 ELSE 3 END, l.name`,
    ),
    // Per place and product: the balance, the newest top-up level, cold chain and value at cost.
    q<{
      place: string;
      name: string;
      bal: number;
      level: number | null;
      cold: boolean;
      value: number | null;
    }>(
      db,
      sql`WITH batch AS (
              SELECT coalesce(b.location_id, b.dispensing_point_id) AS place, b.product_id, sum(m.quantity)::int AS bal,
                     max(m.unit_cost) FILTER (WHERE m.kind = 'received') AS cost
                FROM public.pharmacy_batches b JOIN public.pharmacy_stock_movements m ON m.batch_id = b.id
               WHERE b.hospital_id = ${h}::uuid GROUP BY b.id),
            bal AS (
              SELECT place, product_id, sum(bal)::int AS bal, sum(bal * cost) AS value
                FROM batch WHERE bal > 0 GROUP BY 1, 2),
            lv AS (
              SELECT DISTINCT ON (r.location_id, r.product_id) r.location_id AS place, r.product_id, r.level
                FROM public.pharmacy_reorder_levels r WHERE r.hospital_id = ${h}::uuid AND r.product_id IS NOT NULL
               ORDER BY r.location_id, r.product_id, r.set_at DESC)
            SELECT coalesce(bal.place, lv.place) AS place, p.name, coalesce(bal.bal, 0) AS bal, lv.level,
                   coalesce(p.cold_chain, false) AS cold, bal.value
              FROM bal FULL JOIN lv ON lv.place = bal.place AND lv.product_id = bal.product_id
              JOIN public.pharmacy_products p ON p.id = coalesce(bal.product_id, lv.product_id)
             WHERE coalesce(bal.bal, 0) > 0 OR lv.level IS NOT NULL`,
    ),
    q<{
      place: string;
      slot_at: string | null;
      created_at: string;
      accepted_at: string | null;
      fr: string;
      tu: string;
      diff: number;
    }>(
      db,
      sql`SELECT x.location_id AS place, x.slot_at, x.created_at, x.accepted_at, coalesce(f.full_name, f.email) AS fr,
               coalesce(t.full_name, t.email) AS tu,
               (SELECT count(*)::int FROM public.pharmacy_shift_handover_lines n WHERE n.handover_id = x.id AND n.counted <> n.expected) AS diff
             FROM public.pharmacy_shift_handovers x JOIN public.users f ON f.id = x.from_user_id
             JOIN public.users t ON t.id = x.to_user_id
            WHERE x.hospital_id = ${h}::uuid AND x.created_at > now() - interval '14 days' ORDER BY x.created_at DESC`,
    ),
    q<{ place: string; slot_at: string }>(
      db,
      sql`SELECT location_id AS place, slot_at FROM public.pharmacy_shift_handover_misses
             WHERE hospital_id = ${h}::uuid AND slot_at > now() - interval '14 days'`,
    ),
    q<{ place: string; user_id: string; name: string; shift: "day" | "night" | "call" }>(
      db,
      sql`SELECT r.location_id AS place, r.user_id, ${who} AS name, r.shift FROM public.pharmacy_duty_roster r
             JOIN public.users u ON u.id = r.user_id
            WHERE r.hospital_id = ${h}::uuid AND r.ended_at IS NULL AND r.location_id IS NOT NULL
              AND ${k.date}::date BETWEEN r.date_from AND r.date_to`,
    ),
    q<{ id: string; code: string; name: string; place: string | null; sensor_id: string | null }>(
      db,
      sql`SELECT id, code, name, location_id AS place, sensor_id FROM public.pharmacy_fridges
             WHERE hospital_id = ${h}::uuid AND archived_at IS NULL ORDER BY code`,
    ),
    q<{ fridge_id: string; read_at: string; temp: number; source: string }>(
      db,
      sql`SELECT fridge_id, read_at, temp_c::float AS temp, source FROM public.pharmacy_fridge_readings
             WHERE hospital_id = ${h}::uuid AND read_at > now() - interval '2 days' ORDER BY read_at`,
    ),
    q<{
      fridge_id: string;
      started_at: string;
      ended_at: string | null;
      peak: number;
      note: string | null;
      who: string | null;
    }>(
      db,
      sql`SELECT e.fridge_id, e.started_at, e.ended_at, e.peak_c::float AS peak, e.action_note AS note, ${who} AS who
             FROM public.pharmacy_fridge_excursions e LEFT JOIN public.users u ON u.id = e.checked_by
            WHERE e.hospital_id = ${h}::uuid AND (e.ended_at IS NULL OR e.started_at > now() - interval '7 days')
            ORDER BY e.started_at DESC`,
    ),
    q<{
      id: string;
      name: string;
      what: string | null;
      cycle_months: number;
      next_cycle_on: string | null;
      lead_days: number;
      budget_ugx: number;
      used_ugx: number;
      budget_period: string | null;
      contact: string | null;
      phone_encrypted: string | null;
    }>(
      db,
      sql`SELECT id, name, what, cycle_months, next_cycle_on::text, lead_days, budget_ugx::float AS budget_ugx,
               used_ugx::float AS used_ugx, budget_period, contact, phone_encrypted
             FROM public.pharmacy_suppliers WHERE hospital_id = ${h}::uuid ORDER BY name`,
    ),
    q<{ id: string; name: string }>(
      db,
      sql`SELECT d.id, d.name FROM public.hospital_departments d WHERE d.hospital_id = ${h}::uuid AND d.archived_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM public.pharmacy_locations l WHERE l.department_id = d.id) ORDER BY d.name`,
    ),
    q<{ id: string; name: string }>(
      db,
      sql`SELECT w.id, w.name FROM public.hospital_wards w WHERE w.hospital_id = ${h}::uuid
             AND NOT EXISTS (SELECT 1 FROM public.pharmacy_locations l WHERE l.ward_id = w.id) ORDER BY w.name`,
    ),
    signedRules(db, h),
    // The latest charge mode and pay-first row in force per point (0257); a point's place id is its department id.
    q<{ id: string; free: boolean; pay_first: boolean | null; hospital_pay_first: boolean }>(
      db,
      sql`SELECT p.department_id AS id,
               coalesce((SELECT c.mode = 'free' FROM public.pharmacy_point_charge_modes c WHERE c.dispensing_point_id = p.department_id
                           AND c.from_date <= ${k.date}::date ORDER BY c.from_date DESC, c.created_at DESC LIMIT 1), false) AS free,
               (SELECT f.required FROM public.pharmacy_point_pay_first f WHERE f.dispensing_point_id = p.department_id
                  AND f.from_date <= ${k.date}::date ORDER BY f.from_date DESC, f.created_at DESC LIMIT 1) AS pay_first,
               coalesce((SELECT s.payment_status_required FROM public.pharmacy_hospital_settings s
                          WHERE s.hospital_id = ${h}::uuid), false) AS hospital_pay_first
             FROM public.pharmacy_dispensing_points p WHERE p.hospital_id = ${h}::uuid`,
    ),
  ]);
  const n = ruleNumbers(signed);
  const missedMin = n("ho", "missed");
  const slotOf = (at: string) => {
    const m = kampalaNow(Date.parse(at));
    return {
      date: m.date,
      slot: `${String(Math.floor(m.min / 60)).padStart(2, "0")}:${String(m.min % 60).padStart(2, "0")}`,
    };
  };
  const hm = (at: string) => slotOf(at).slot;
  const placeRows: PlaceRow[] = places.map((l) => {
    const lines = stock.filter((s) => s.place === l.id);
    const held = lines.filter((s) => s.bal > 0);
    const out = lines.filter((s) => s.level !== null && s.bal === 0);
    const low = lines.filter((s) => s.level !== null && s.bal > 0 && s.bal <= s.level);
    const hs = handovers.filter((x) => x.place === l.id);
    const today = hs
      .filter((x) => x.slot_at && slotOf(x.slot_at).date === k.date)
      .map((x) => ({
        slot: hm(x.slot_at!),
        from: x.fr,
        to: x.tu,
        at: hm(x.created_at),
        differences: Number(x.diff),
      }));
    const hist = [
      ...hs
        .filter((x) => x.slot_at)
        .map((x) => ({
          date: slotOf(x.slot_at!).date,
          slot: hm(x.slot_at!),
          from: x.fr,
          to: x.tu,
          at: hm(x.created_at),
          differences: Number(x.diff),
          missed: false,
          t: Date.parse(x.slot_at!),
        })),
      ...misses
        .filter((m) => m.place === l.id)
        .map((m) => ({
          date: slotOf(m.slot_at).date,
          slot: hm(m.slot_at),
          from: "",
          to: "",
          at: null,
          differences: 0,
          missed: true,
          t: Date.parse(m.slot_at),
        })),
    ]
      .sort((a, b) => b.t - a.t)
      .slice(0, 3)
      .map(({ t: _t, ...r }) => r);
    const b = billing.find((x) => x.id === l.id);
    return {
      id: l.id,
      name: l.name,
      kind: l.kind,
      kindLocked: l.kind !== "clinic" && l.kind !== "theatre",
      hours: l.hours,
      suppliedFrom: l.supplied_from,
      supplierIds: l.supplier_ids ?? [],
      device: l.device_label,
      lastSeenAt: iso(l.seen),
      slots: l.slots ?? [],
      closed: l.closed_at
        ? { at: iso(l.closed_at)!, byName: l.closed_who ?? "", note: l.closed_note }
        : null,
      stock: {
        lines: held.length,
        low: low.length,
        out: out.length,
        valueUgx: held.some((s) => s.value !== null)
          ? Math.round(held.reduce((a, s) => a + Number(s.value ?? 0), 0))
          : null,
      },
      short: [
        ...out.map((s) => ({ name: s.name, state: "out" as const })),
        ...low.map((s) => ({ name: s.name, state: "low" as const })),
      ],
      coldLines: held.filter((s) => s.cold).map((s) => s.name),
      handoversToday: today,
      history: hist,
      handoverOpen: hs.some((x) => x.accepted_at === null),
      onDuty: duty
        .filter((d) => d.place === l.id)
        .map((d) => ({ userId: d.user_id, name: d.name, shift: d.shift })),
      billing:
        l.kind === "dispensing_point" && b
          ? {
              free: b.free,
              payFirst: b.pay_first ?? b.hospital_pay_first,
              hospitalPayFirst: b.hospital_pay_first,
            }
          : null,
    };
  });
  const fridgeRows: FridgeRow[] = fridges.map((f) => {
    const rs = readings.filter((r) => r.fridge_id === f.id);
    const last = rs.at(-1);
    const todays = rs.filter((r) => kampalaNow(Date.parse(r.read_at)).date === k.date);
    const typed: Record<string, number> = {};
    for (const r of todays.filter((x) => x.source === "chart")) {
      const t = kampalaNow(Date.parse(r.read_at)).min;
      for (const c of ["08:00", "17:00"])
        if (Math.abs(t - +c.slice(0, 2) * 60) <= 90) typed[c] = r.temp;
    }
    const ex = excursions.filter((e) => e.fridge_id === f.id);
    return {
      id: f.id,
      code: f.code,
      name: f.name,
      placeId: f.place,
      sensorId: f.sensor_id,
      temp: last ? Number(last.temp) : null,
      readAt: iso(last?.read_at),
      todayMin: todays.length ? Math.min(...todays.map((r) => r.temp)) : null,
      todayMax: todays.length ? Math.max(...todays.map((r) => r.temp)) : null,
      excursions7d: ex.length,
      excursions: ex.map((e) => ({
        startedAt: iso(e.started_at)!,
        endedAt: iso(e.ended_at),
        peak: e.peak,
        note: e.note,
        byName: e.who,
      })),
      typed,
    };
  });
  const supplierRows: SupplierRow[] = suppliers.map((s) => {
    const phone = decryptOr(s.phone_encrypted);
    return {
      id: s.id,
      name: s.name,
      what: s.what,
      cycleMonths: s.cycle_months,
      nextCycleOn: s.next_cycle_on,
      leadDays: s.lead_days,
      budgetUgx: Number(s.budget_ugx),
      usedUgx: Number(s.used_ugx),
      period: s.budget_period,
      contact: s.contact,
      phoneMasked: phone ? maskPhone(phone) : null,
      tel: phone ? `tel:${phone.replace(/\s/g, "")}` : null,
    };
  });
  return {
    nowMs: now.getTime(),
    today: k.date,
    nowMin: k.min,
    rules: { missedMin, nearC: n("cold", "near_limit"), orderDueDays: n("ord", "order_due") },
    places: placeRows,
    fridges: fridgeRows,
    suppliers: supplierRows,
    hub: { units, wards },
    can: { manage: manages, readings: true, suppliers: manages || has("pharmacy.store") },
  };
}

/* ─── Rules ──────────────────────────────────────────────────────────── */
export async function loadRulesView(
  db: Exec,
  actor: PharmacyActor,
  manages: boolean,
): Promise<RulesView | null> {
  if (!(await ready(db))) return null;
  const h = actor.hospitalId;
  const [signed, rows, gsigs, props, hist] = await Promise.all([
    signedRules(db, h),
    q<{
      rule_group: string;
      key: string;
      text: string;
      name: string | null;
      applies_to: string | null;
      updated_at: string | null;
    }>(
      db,
      sql`SELECT rule_group, key, text, name, applies_to, updated_at FROM public.pharmacy_rules WHERE hospital_id = ${h}::uuid`,
    ),
    q<{ group_key: string; role: "in_charge" | "second"; who: string; at: string }>(
      db,
      sql`SELECT g.group_key, g.role, ${who} AS who, g.signed_at AS at FROM public.pharmacy_rule_group_signatures g
           LEFT JOIN public.users u ON u.id = g.signed_by WHERE g.hospital_id = ${h}::uuid`,
    ),
    q<{
      id: string;
      rule_group: string;
      key: string;
      name: string | null;
      kind: "change" | "new";
      old_text: string | null;
      new_text: string;
      reason: string;
      proposed_by: string;
      who: string;
      at: string;
      applies_to: string | null;
      roles: ("in_charge" | "second")[] | null;
      signers: string[] | null;
    }>(
      db,
      sql`SELECT p.id, p.rule_group, p.key, p.name, p.kind, p.old_text, p.new_text, p.reason, p.proposed_by, ${who} AS who,
             p.proposed_at AS at, p.applies_to,
             (SELECT array_agg(s.role) FROM public.pharmacy_rule_signatures s WHERE s.proposal_id = p.id) AS roles,
             (SELECT array_agg(s.signed_by::text) FROM public.pharmacy_rule_signatures s WHERE s.proposal_id = p.id) AS signers
           FROM public.pharmacy_rule_proposals p LEFT JOIN public.users u ON u.id = p.proposed_by
          WHERE p.hospital_id = ${h}::uuid AND p.status = 'pending' AND p.product_id IS NULL ORDER BY p.proposed_at`,
    ),
    q<{
      at: string;
      rule_group: string;
      key: string;
      name: string | null;
      old_text: string | null;
      new_text: string;
      status: string;
      kind: string;
      who: string | null;
      signers: string[] | null;
      reject_note: string | null;
      rejecter: string | null;
    }>(
      db,
      sql`SELECT coalesce(p.closed_at, p.proposed_at) AS at, p.rule_group, p.key, p.name, p.old_text, p.new_text, p.status,
             p.kind, ${who} AS who, p.reject_note,
             (SELECT coalesce(r.full_name, r.email) FROM public.users r WHERE r.id = p.rejected_by) AS rejecter,
             (SELECT array_agg(coalesce(x.full_name, x.email)) FROM public.pharmacy_rule_signatures s
                JOIN public.users x ON x.id = s.signed_by WHERE s.proposal_id = p.id) AS signers
           FROM public.pharmacy_rule_proposals p LEFT JOIN public.users u ON u.id = p.proposed_by
          WHERE p.hospital_id = ${h}::uuid AND p.status IN ('applied','rejected') AND p.product_id IS NULL
          ORDER BY at DESC LIMIT 40`,
    ),
  ]);
  const n = ruleNumbers(signed);
  const c = permissionsFor(actor, manages);
  const title = (g: string) => RULE_REGISTRY.find((x) => x.key === g)?.title ?? g;
  const groups = RULE_REGISTRY.map((g) => {
    const sig = gsigs.filter((s) => s.group_key === g.key);
    const added = rows.filter((r) => r.rule_group === g.key && r.key.startsWith("new_"));
    return {
      key: g.key,
      title: g.title,
      showsOn: g.showsOn,
      // ADR 0550: the head's signature alone signs the group (two-signature groups from before stay signed).
      signed: sig.some((s) => s.role === "in_charge"),
      signatures: sig.map((s) => ({ role: s.role, byName: s.who, at: iso(s.at)! })),
      rules: [
        ...g.rules.map((r) => {
          const row = rows.find((x) => x.rule_group === g.key && x.key === r.key);
          const v = r.param ? n(g.key, r.key) : null;
          return {
            key: r.key,
            name: r.name,
            text: r.param ? ruleText(r, v!) : (row?.text ?? r.text),
            appliesTo: row?.applies_to ?? r.appliesTo,
            param: r.param,
            n: v,
            source: row
              ? ("changed" as const)
              : sig.some((s) => s.role === "in_charge")
                ? ("signed" as const)
                : ("default" as const),
            changedAt: iso(row?.updated_at),
            isNew: false,
            pendingId: props.find((p) => p.rule_group === g.key && p.key === r.key)?.id ?? null,
          };
        }),
        ...added.map((r) => ({
          key: r.key,
          name: r.name ?? r.key,
          text: r.text,
          appliesTo: r.applies_to ?? "",
          param: null,
          n: null,
          source: "changed" as const,
          changedAt: iso(r.updated_at),
          isNew: true,
          pendingId: props.find((p) => p.rule_group === g.key && p.key === r.key)?.id ?? null,
        })),
      ],
    };
  });
  const nameOf = (g: string, k: string) =>
    RULE_REGISTRY.find((x) => x.key === g)?.rules.find((r) => r.key === k)?.name ?? k;
  return {
    me: actor.userId,
    groups,
    proposals: props.map((p) => ({
      id: p.id,
      group: p.rule_group,
      key: p.key,
      name: p.name ?? nameOf(p.rule_group, p.key),
      kind: p.kind,
      oldText: p.old_text,
      newText: p.new_text,
      reason: p.reason,
      proposedBy: p.proposed_by,
      proposedByName: p.who,
      proposedAt: iso(p.at)!,
      appliesTo:
        p.applies_to ??
        RULE_REGISTRY.find((x) => x.key === p.rule_group)?.rules.find((r) => r.key === p.key)
          ?.appliesTo ??
        "",
      roles: p.roles ?? [],
      signedBy: p.signers ?? [],
    })),
    history: [
      ...hist.map((x) => ({
        at: iso(x.at)!,
        group: title(x.rule_group),
        name: x.name ?? nameOf(x.rule_group, x.key),
        from: x.old_text,
        to: x.new_text,
        kind:
          x.status === "rejected"
            ? ("rejected" as const)
            : x.kind === "new"
              ? ("added" as const)
              : ("changed" as const),
        proposer: x.who,
        signers: x.signers ?? [],
        rejectNote: x.reject_note,
        rejectedBy: x.rejecter,
      })),
      ...gsigs
        .filter((s) => s.role === "in_charge")
        .map((s) => ({
          at: iso(s.at)!,
          group: title(s.group_key),
          name: title(s.group_key),
          from: null,
          to: null,
          kind: "group_signed" as const,
          proposer: null,
          signers: gsigs.filter((x) => x.group_key === s.group_key).map((x) => x.who),
          rejectNote: null,
          rejectedBy: null,
        })),
    ].sort((a, b) => b.at.localeCompare(a.at)),
    can: { propose: c.propose, signInCharge: c.signInCharge, signSecond: c.signSecond },
  };
}

/* ─── Messages ───────────────────────────────────────────────────────── */
export async function loadMessages(
  db: Exec,
  actor: PharmacyActor,
  manages: boolean,
  now = new Date(),
): Promise<MessagesView | null> {
  if (!(await ready(db))) return null;
  const h = actor.hospitalId;
  const [prov, settings, patient, staff, counts, outbox, optouts, consent, signed] =
    await Promise.all([
      q<{
        name: string;
        sender_id: string;
        cost_ugx: number;
        facility_label: string | null;
        connected: boolean;
      }>(
        db,
        sql`SELECT name, sender_id, cost_ugx, facility_label, connected FROM public.pharmacy_sms_provider WHERE hospital_id = ${h}::uuid`,
      ),
      q<{ b: number | null }>(
        db,
        sql`SELECT monthly_budget_ugx::float AS b FROM public.pharmacy_sms_settings WHERE hospital_id = ${h}::uuid`,
      ),
      rulesOf(db as Parameters<typeof rulesOf>[0], h),
      q<{
        eve_on: boolean;
        eve_time: string;
        change_on: boolean;
        unpub_on: boolean;
        lic_on: boolean;
      }>(
        db,
        sql`SELECT eve_on, eve_time, change_on, unpub_on, lic_on FROM public.pharmacy_roster_reminders
           WHERE hospital_id = ${h}::uuid ORDER BY set_at DESC LIMIT 1`,
      ),
      q<{ rule: string; status: string; n: number; spent: number }>(
        db,
        sql`SELECT rule, status, count(*)::int AS n, coalesce(sum(parts * cost_ugx), 0)::float AS spent
            FROM public.pharmacy_sms_messages WHERE hospital_id = ${h}::uuid
             AND date_trunc('month', coalesce(sent_at, created_at) AT TIME ZONE 'Africa/Kampala')
               = date_trunc('month', now() AT TIME ZONE 'Africa/Kampala')
           GROUP BY rule, status`,
      ),
      q<{
        id: string;
        at: string;
        rule: string;
        phone: string;
        lang: "en" | "lg";
        note: string | null;
        failure: string | null;
        status: string;
      }>(
        db,
        sql`SELECT id, coalesce(sent_at, status_at) AS at, rule, phone_encrypted AS phone, lang, note, failure, status
            FROM public.pharmacy_sms_messages WHERE hospital_id = ${h}::uuid
             AND status IN ('queued','sent','delivered','failed') ORDER BY coalesce(sent_at, status_at) DESC LIMIT 50`,
      ),
      q<{
        hmac: string;
        phone: string | null;
        reason: string | null;
        source: "reply_stop" | "staff";
        at: string;
      }>(
        db,
        sql`SELECT phone_hmac AS hmac, phone_encrypted AS phone, reason, source, recorded_at AS at
            FROM public.pharmacy_sms_optouts WHERE hospital_id = ${h}::uuid ORDER BY recorded_at DESC`,
      ),
      // Consent is asked at registration (consent_records `sms_communication`). ponytail: counted across all patient
      // profiles; patients are not tied to one hospital, so a per-hospital count waits for a patient-hospital link.
      q<{ patients: number; consented: number }>(
        db,
        sql`SELECT count(*)::int AS patients,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.consent_records c WHERE c.user_id = pp.id
               AND c.consent_type = 'sms_communication' AND c.revoked_at IS NULL))::int AS consented
            FROM public.patient_profiles pp WHERE pp.phone_encrypted IS NOT NULL`,
      ),
      signedRules(db, h),
    ]);
  const n = ruleNumbers(signed);
  const p = prov[0];
  const st = staff[0];
  const sum = (s: string) => counts.filter((c) => c.status === s).reduce((a, c) => a + c.n, 0);
  const sentOf = (rule: string) =>
    counts
      .filter((c) => c.rule === rule && (c.status === "sent" || c.status === "delivered"))
      .reduce((a, c) => a + c.n, 0);
  const STAFF_ON = {
    staff_eve: st?.eve_on,
    staff_change: st?.change_on,
    staff_unpub: st?.unpub_on,
    staff_licence: st?.lic_on,
  };
  const templates: TemplateRow[] = SMS_TEMPLATES.map((t) => {
    const r = patient.find((x) => x.rule === t.key);
    return {
      key: t.key,
      on: r ? r.enabled : (STAFF_ON[t.key as keyof typeof STAFF_ON] ?? t.on),
      timing: r ? r.timing : t.key === "staff_eve" && st ? st.eve_time : t.timing,
      en: r?.en ?? t.en,
      lg: r?.lg ?? null,
      lgCheckedAt: iso(r?.lgCheckedAt),
      sentThisMonth: sentOf(t.key),
    };
  });
  const k = kampalaNow(now.getTime());
  return {
    nowMin: k.min,
    provider: p
      ? {
          name: p.name,
          senderId: p.sender_id,
          costUgx: p.cost_ugx,
          facility: p.facility_label,
          connected: p.connected,
        }
      : null,
    budgetUgx: settings[0]?.b ?? null,
    spentUgx: counts
      .filter((c) => c.status === "sent" || c.status === "delivered")
      .reduce((a, c) => a + c.spent, 0),
    rules: { capPct: n("msg", "monthly_cap"), perPatient: n("msg", "per_patient") },
    stats: {
      sent: sum("sent") + sum("delivered"),
      delivered: sum("delivered"),
      failed: sum("failed"),
      queued: sum("queued"),
      optedOut: optouts.length,
      consented: consent[0]?.consented ?? 0,
      patients: consent[0]?.patients ?? 0,
    },
    templates,
    outbox: outbox.map((m) => ({
      id: m.id,
      at: iso(m.at)!,
      rule: m.rule as MessagesView["outbox"][number]["rule"],
      phoneMasked: maskPhone(decryptOr(m.phone) ?? ""),
      lang: m.lang,
      note: m.note ?? m.failure,
      status: m.status as MessagesView["outbox"][number]["status"],
    })),
    optOuts: optouts.map((o) => ({
      hmac: o.hmac,
      phoneMasked: o.phone ? maskPhone(decryptOr(o.phone) ?? "") : "+256 7•• ••• •••",
      reason: o.reason,
      source: o.source,
      at: iso(o.at)!,
    })),
    can: { manage: manages },
  };
}
