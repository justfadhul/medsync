import "server-only";

import type { EmrDb } from "@/lib/emr/db";
import type { TodayItem } from "@/lib/pharmacy/derive/today-types";
import type { MarRecord, Regimen, Supply } from "@/lib/pharmacy/wards/derive";
import { cache } from "react";
import { sql } from "drizzle-orm";

import { fill, PRW } from "@/content/pharmacy-rework-patients";
import { identitiesFor } from "@/lib/emr/read/results";
import { courseDays, DAY, regStats } from "@/lib/pharmacy/wards/derive";
import { q } from "@/lib/pharmacy/wards/sql";

/** Inpatients (rework PRD §6.3): the wards, the active regimens with their MAR, picks and stock. Three queries. */
const appDb = async () => (await import("@/db")).db as unknown as EmrDb;

export interface WardPlace {
  id: string;
  name: string;
  patients: string[];
}

type RxRow = {
  id: string;
  patient_id: string;
  drug_id: string;
  drug_name: string;
  dose: string;
  route: string;
  frequency: string | null;
  prn: boolean;
  start: string | null;
  created_at: string;
  duration: string | null;
  mar:
    | { at: string; for: string | null; state: MarRecord["state"]; reason: string | null }[]
    | null;
};

const regimenOf = (r: RxRow): Regimen => {
  const s = r.start ? Date.parse(r.start) : NaN;
  return {
    id: r.id,
    patientId: r.patient_id,
    medicineId: r.drug_id,
    drug: r.drug_name,
    dose: r.dose,
    route: r.route,
    frequency: r.frequency,
    prn: r.prn,
    start: Number.isFinite(s) ? s : Date.parse(r.created_at),
    days: courseDays(r.duration),
  };
};

/** Wards (pharmacy places of kind ward) and who has arrived on each. */
async function wardsOf(db: EmrDb, hospitalId: string) {
  const rows = await q<{ id: string; name: string; patient: string | null }>(
    db,
    sql`SELECT l.id, l.name, a.patient_user_id AS patient
          FROM public.pharmacy_locations l
          LEFT JOIN public.admissions a ON a.ward_id = l.ward_id AND a.hospital_id = l.hospital_id AND a.status = 'arrived'
         WHERE l.hospital_id = ${hospitalId}::uuid AND l.kind = 'ward' AND l.archived_at IS NULL
         ORDER BY l.name`,
  );
  const m = new Map<string, WardPlace>();
  for (const r of rows) {
    const w = m.get(r.id) ?? { id: r.id, name: r.name, patients: [] };
    if (r.patient && !w.patients.includes(r.patient)) w.patients.push(r.patient);
    m.set(r.id, w);
  }
  return [...m.values()];
}

/** Active drug prescriptions of these admitted patients (their admission's encounters) with every MAR entry. */
async function regimensOf(db: EmrDb, hospitalId: string, patients: string[]) {
  if (!patients.length) return { regs: [] as Regimen[], recs: [] as MarRecord[] };
  const rows = await q<RxRow>(
    db,
    sql`SELECT p.id, p.patient_user_id AS patient_id, p.drug_id, p.drug_name, p.dose, p.route, p.frequency, p.prn,
               p.start, p.created_at, p.duration,
               (SELECT json_agg(json_build_object('at', m.administered_at, 'for', m.scheduled_for, 'state', m.state,
                                                  'reason', m.withheld_reason))
                  FROM public.medication_administration_records m WHERE m.emr_prescription_id = p.id
                   AND m.state <> 'reversed' AND NOT EXISTS (SELECT 1 FROM public.medication_administration_records r WHERE r.reverses_id = m.id)) AS mar
          FROM public.prescriptions p
          JOIN public.admissions a ON a.patient_user_id = p.patient_user_id AND a.status = 'arrived'
                                  AND a.hospital_id = p.hospital_id
                                  AND p.encounter_id IN (a.source_encounter_id, a.inpatient_encounter_id)
         WHERE p.hospital_id = ${hospitalId}::uuid AND p.state = 'active' AND p.kind = 'drug'
           AND p.patient_user_id IN (${sql.join(
             patients.map((p) => sql`${p}::uuid`),
             sql`, `,
           )})
         ORDER BY p.created_at`,
  );
  const recs: MarRecord[] = rows.flatMap((r) =>
    (r.mar ?? []).map((m) => ({
      rxId: r.id,
      scheduledFor: m.for ? Date.parse(m.for) : null,
      at: Date.parse(m.at),
      state: m.state,
      reason: m.reason,
    })),
  );
  return { regs: rows.map(regimenOf), recs };
}

/** Picks per prescription, the ward's and the pharmacy places' balances per medicine, and the patient's notes. */
async function stockOf(db: EmrDb, hospitalId: string, rxIds: string[], pt: string | null) {
  const ids = rxIds.length
    ? sql.join(
        rxIds.map((i) => sql`${i}::uuid`),
        sql`, `,
      )
    : sql`NULL::uuid`;
  const [row] = await q<{
    picks: { rx: string; qty: number; at: string; recv: string | null; ward: string }[] | null;
    bal: { loc: string; kind: string; name: string; med: string; n: number }[] | null;
    notes: { id: string; body: string; at: string }[] | null;
    last: { ward: string; at: string; recv: string | null }[] | null;
  }>(
    db,
    sql`SELECT
          (SELECT json_agg(json_build_object('rx', pl.prescription_id, 'qty', pl.quantity, 'at', rp.picked_at,
                    'ward', rp.ward_location_id,
                    'recv', (SELECT min(c.confirmed_at) FROM public.pharmacy_issue_confirmations c WHERE c.issue_id = rp.issue_id)))
             FROM public.pharmacy_round_pick_lines pl JOIN public.pharmacy_round_picks rp ON rp.id = pl.round_id
            WHERE pl.prescription_id IN (${ids})) AS picks,
          (SELECT json_agg(b) FROM (
             SELECT l.id AS loc, l.kind, l.name, p.medicine_id AS med, sum(m.quantity)::int AS n
               FROM public.pharmacy_stock_movements m
               JOIN public.pharmacy_batches bt ON bt.id = m.batch_id
               JOIN public.pharmacy_products p ON p.id = bt.product_id
               JOIN public.pharmacy_locations l ON l.id = coalesce(m.location_id, m.dispensing_point_id)
              WHERE m.hospital_id = ${hospitalId}::uuid AND l.archived_at IS NULL
                AND (l.kind = 'ward' OR (l.kind IN ('store', 'dispensing_point') AND l.live_at IS NOT NULL AND l.switched_off_at IS NULL))
              GROUP BY l.id, l.kind, l.name, p.medicine_id HAVING sum(m.quantity) > 0) b) AS bal,
          (SELECT json_agg(json_build_object('id', n.id, 'body', n.body, 'at', n.written_at) ORDER BY n.written_at DESC)
             FROM public.pharmacy_ip_notes n
            WHERE n.hospital_id = ${hospitalId}::uuid AND n.patient_user_id = ${pt}::uuid) AS notes,
          (SELECT json_agg(x) FROM (SELECT DISTINCT ON (rp.ward_location_id) rp.ward_location_id AS ward, rp.picked_at AS at,
                    (SELECT min(c.confirmed_at) FROM public.pharmacy_issue_confirmations c WHERE c.issue_id = rp.issue_id) AS recv
               FROM public.pharmacy_round_picks rp WHERE rp.hospital_id = ${hospitalId}::uuid AND rp.kind = 'round'
              ORDER BY rp.ward_location_id, rp.picked_at DESC) x) AS last`,
  );
  const supplies = new Map<string, Supply[]>();
  for (const p of row?.picks ?? [])
    supplies.set(p.rx, [
      ...(supplies.get(p.rx) ?? []),
      { qty: p.qty, at: Date.parse(p.at), receivedAt: p.recv ? Date.parse(p.recv) : null },
    ]);
  return {
    supplies,
    balances: row?.bal ?? [],
    notes: (row?.notes ?? []).map((n) => ({ id: n.id, body: n.body, at: Date.parse(n.at) })),
    lastRound: new Map(
      (row?.last ?? []).map((l) => [
        l.ward,
        { at: Date.parse(l.at), recv: l.recv ? Date.parse(l.recv) : null },
      ]),
    ),
  };
}

export const inpatientsData = cache(
  async (
    viewer: { userId: string; hospitalId: string },
    wardParam: string | null,
    pt: string | null,
    database?: EmrDb,
  ) => {
    const db = database ?? (await appDb());
    const wards = await wardsOf(db, viewer.hospitalId);
    const ward =
      wards.find((w) => w.id === wardParam) ??
      wards.find((w) => w.patients.length) ??
      wards[0] ??
      null;
    const patients = ward?.patients ?? [];
    const { regs, recs } = await regimensOf(db, viewer.hospitalId, patients);
    const patient = pt && patients.includes(pt) ? pt : null;
    const stock = await stockOf(
      db,
      viewer.hospitalId,
      regs.map((r) => r.id),
      patient,
    );
    const ids = await identitiesFor(viewer, patients, "pharmacy_inpatients", database);
    return { wards, ward, patient, regs, recs, ids, ...stock };
  },
);
export type InpatientsData = Awaited<ReturnType<typeof inpatientsData>>;

/**
 * Today, kind `mar`: per ward, doses not given for lack of stock in the last 24 h, and doses due and not yet recorded.
 * No names (a count per ward).
 */
export async function marTodayItems(
  hospitalId: string,
  now = new Date(),
  database?: EmrDb,
): Promise<TodayItem[]> {
  const db = database ?? (await appDb());
  const wards = await wardsOf(db, hospitalId);
  const all = wards.flatMap((w) => w.patients);
  const { regs, recs } = await regimensOf(db, hospitalId, all);
  const t = now.getTime();
  const out: TodayItem[] = [];
  for (const w of wards) {
    const mine = regs.filter((r) => w.patients.includes(r.patientId));
    const stock = recs.filter(
      (x) =>
        x.state !== "administered" &&
        x.at > t - DAY &&
        x.reason &&
        /stock/i.test(x.reason) &&
        mine.some((r) => r.id === x.rxId),
    ).length;
    const late = mine.reduce((a, r) => a + regStats(r, recs, t).overdue, 0);
    const href = `/pharmacy/patients/inpatients?ward=${w.id}`;
    if (stock)
      out.push({
        kind: "mar",
        key: `mar:stock:${w.id}`,
        title: fill(PRW.today.marStock, { ward: w.name, n: stock }),
        meta: "",
        action: PRW.today.marOpen,
        href,
        late: true,
      });
    if (late)
      out.push({
        kind: "mar",
        key: `mar:late:${w.id}`,
        title: fill(PRW.today.marLate, { ward: w.name, n: late }),
        meta: "",
        action: PRW.today.marOpen,
        href,
      });
  }
  return out;
}
