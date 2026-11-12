import "server-only";

import { randomUUID } from "node:crypto";
import type { DemoPatient, DemoState, PointKey, WardKey } from "./state";
import type { PackContent, PackKind } from "@/lib/pharmacy/stores/packs";
import type { Who } from "@/lib/pharmacy/stores/ward-store";
import type { PharmacyActor, PharmacyCtx } from "@/lib/pharmacy/write";
import type { z } from "zod";
import { sql } from "drizzle-orm";

import * as dist from "@/lib/pharmacy/distribution/store";
import { pharmacyCatalogueLiveFor } from "@/lib/pharmacy/feature";
import { localDate } from "@/lib/pharmacy/stock/ledger";
import * as stock from "@/lib/pharmacy/stock/store";
import * as carts from "@/lib/pharmacy/stores/cart-store";
import * as expiry from "@/lib/pharmacy/stores/expiry-store";
import * as issues from "@/lib/pharmacy/stores/issue-store";
import { addDays, localMonth } from "@/lib/pharmacy/stores/ledger";
import * as places from "@/lib/pharmacy/stores/location-store";
import * as month from "@/lib/pharmacy/stores/month-end-store";
import * as packs from "@/lib/pharmacy/stores/packs";
import { finishTrace, loadTraceBase } from "@/lib/pharmacy/stores/recall-read";
import * as recall from "@/lib/pharmacy/stores/recall-store";
import * as ws from "@/lib/pharmacy/stores/ward-store";
import { storeNeed, withLocationRight } from "@/lib/pharmacy/stores/write";
import {
  at,
  bump,
  chiefActor,
  DAY,
  DEMO_DOSE,
  demoStaff,
  one,
  pharmacyActor,
  q,
  witness,
  write,
} from "./state";

/**
 * Sections 9–11: ward stock and emergency carts, expiry and a recall, month end. Places are found by their hub row
 * first (a hospital ward, a crash cart, the quarantine), so another section's place is reused. Pharmacy writes go
 * through `runPharmacyWrite` as the chief pharmacist or a point's staff; the ward's own writes (requisition, receipt,
 * count, return) through the hub right, as the nurse actions run them.
 */

const HOUR = 3_600_000;
const POINT_ORDER: PointKey[] = [
  "opd",
  "emergency",
  "inpatient",
  "paediatrics",
  "maternity",
  "art",
  "ncd",
  "private",
];
const techAt = (s: DemoState, p: PointKey) =>
  pharmacyActor(
    s,
    s.people.techs[POINT_ORDER.indexOf(p)] ?? s.people.storekeeper,
    "PHARMACY_TECH",
    p,
  );
const pharmacistAt = (s: DemoState, p: PointKey) =>
  pharmacyActor(s, s.people.pharmacists[POINT_ORDER.indexOf(p)] ?? s.people.chief, "PHARMACIST", p);
/** `hours` before the demo's now (today's times; `at` is for earlier days). */
const ago = (s: DemoState, hours: number) => new Date(s.now.getTime() - hours * HOUR);
const MANAGE = storeNeed("pharmacy.manage");
const STOCK = storeNeed("pharmacy.stock");
const STORE = storeNeed("pharmacy.store");

/* ─── Shared helpers ─────────────────────────────────────────────────── */

/** A pharmacy-side ward or cart write: the store function takes the actor's `Who`. */
const asWho =
  <I, R>(fn: (who: Who, input: I) => Promise<R>) =>
  (ctx: PharmacyCtx, input: I) =>
    fn(ws.whoOf(ctx), input);

/** A ward's own write (count, receipt, requisition, return) by a person with the hub right there. */
async function onWard<I extends { locationId: string }, R>(
  s: DemoState,
  userId: string,
  right: "ward_act" | "ward_confirm",
  schema: z.ZodType<I>,
  fn: (who: Who, input: I) => Promise<R>,
  raw: Record<string, unknown>,
  now = s.now,
): Promise<R> {
  const input = schema.parse(raw);
  return withLocationRight(
    { userId, hospitalId: s.h },
    input.locationId,
    right,
    (tx, _l, t) => fn({ tx, hospitalId: s.h, userId, now: t }, input),
    { database: s.db, now },
  );
}

/** A passed second factor (password and code in the app) of `attester` for `actor`, as the signing screens leave one. */
async function signer(s: DemoState, actor: string, attester: string, action: string) {
  return (
    await one<{ id: string }>(
      s,
      sql`INSERT INTO pharmacy_attestations (hospital_id, actor_user_id, attester_user_id, purpose, action, outcome)
        VALUES (${s.h}, ${actor}, ${attester}, 'signer', ${action}, 'passed') RETURNING id`,
    )
  ).id;
}

/** Switches a place on (a go-live row, requested by the chief pharmacist and approved by the admin), unless it is live. */
async function goLive(s: DemoState, locationId: string, when: Date) {
  const [l] = await q<{ live: boolean }>(
    s,
    sql`SELECT (live_at IS NOT NULL AND switched_off_at IS NULL) AS live FROM pharmacy_locations WHERE id = ${locationId}`,
  );
  if (l?.live) return;
  await s.db
    .execute(sql`INSERT INTO pharmacy_location_golive (hospital_id, location_id, action, conditions, requested_by,
      approved_by, at)
    VALUES (${s.h}, ${locationId}, 'on', '[]'::jsonb, ${s.people.chief}, ${s.people.admin}, ${when.toISOString()}::timestamptz)`);
}

/** The hospital's quarantine: the first one there (the stores section's), else one made here; live either way. */
async function quarantine(s: DemoState) {
  const [found] = await q<{ id: string }>(
    s,
    sql`SELECT id FROM pharmacy_locations WHERE hospital_id = ${s.h} AND kind = 'quarantine' AND archived_at IS NULL
      ORDER BY created_at LIMIT 1`,
  );
  const id =
    found?.id ??
    (
      await write(
        s,
        chiefActor(s, null),
        places.CreateLocationInput,
        MANAGE,
        places.createLocation,
        {
          kind: "quarantine",
          name: "Quarantine",
          departmentId: null,
        },
        at(s, 33, 9),
      )
    ).id;
  await goLive(s, id, at(s, 32, 10));
  return id;
}

/**
 * A signed stores pack, through the signing page's path (draft, then the chief pharmacist and the demo CSO with their
 * second factors). Kept when one is in force, unless `merge` returns new content from it.
 */
async function ensurePack<K extends PackKind>(
  s: DemoState,
  kind: K,
  content: PackContent<K>,
  merge?: (current: PackContent<K>) => PackContent<K> | null,
) {
  const current = await packs.signedPack(s.db, s.h, kind);
  const next = current ? (merge ? merge(current.content) : null) : content;
  if (!next) return;
  const chief = chiefActor(s, null);
  const draft = await write(
    s,
    chief,
    packs.SavePackInput,
    packs.PACK_NEED,
    packs.saveSignedPack,
    { kind, content: next },
    at(s, 33, 11),
  );
  await write(
    s,
    chief,
    packs.SignPackInput,
    packs.PACK_NEED,
    packs.signPack,
    {
      packId: draft.id,
      firstAttestationId: await signer(s, s.people.chief, s.people.chief, "sign_pack"),
      second: { attestationId: await signer(s, s.people.chief, s.people.cso, "sign_pack") },
    },
    at(s, 33, 11),
  );
  bump(s, "store_packs");
}

type Lists = PackContent<"stores_reason_lists">["lists"];
const REASON_LISTS: Lists = {
  quarantine: [
    { code: "expired", words: "Expired" },
    { code: "damaged", words: "Damaged" },
    { code: "cold_chain_break", words: "Cold chain broken" },
  ],
  write_off: [
    { code: "expired", words: "Expired" },
    { code: "damaged", words: "Damaged beyond use" },
  ],
  month_end_differences: [
    { code: "breakage", words: "Broken, found at the count" },
    { code: "not_reached", words: "Could not be reached" },
  ],
};

/** The reason codes this group uses, added to the signed reason lists in force without dropping any of theirs. */
async function reasonLists(s: DemoState) {
  await ensurePack(s, "stores_reason_lists", { lists: REASON_LISTS }, (cur) => {
    const lists: Lists = { ...cur.lists };
    let added = false;
    for (const [k, items] of Object.entries(REASON_LISTS) as [
      keyof Lists,
      NonNullable<Lists[keyof Lists]>,
    ][]) {
      const have = lists[k] ?? [];
      const missing = items.filter((i) => !have.some((h) => h.code === i.code));
      if (missing.length) {
        lists[k] = [...have, ...missing];
        added = true;
      }
    }
    return added ? { lists } : null;
  });
}

/** Each batch's balance at a place, with its product (the sum of its ledger). */
async function heldAt(s: DemoState, locationId: string) {
  return q<{ batch: string; product: string; medicine: string; number: string; n: number }>(
    s,
    sql`SELECT b.id AS batch, b.product_id AS product, p.medicine_id AS medicine, b.batch_number AS number,
        coalesce(sum(m.quantity), 0)::int AS n
      FROM pharmacy_batches b JOIN pharmacy_products p ON p.id = b.product_id
      LEFT JOIN pharmacy_stock_movements m ON m.batch_id = b.id
      WHERE coalesce(b.location_id, b.dispensing_point_id) = ${locationId}
      GROUP BY b.id, b.product_id, p.medicine_id, b.batch_number, b.expiry ORDER BY b.expiry`,
  );
}

/** What a point can still issue of a product: unexpired, unrecalled stock. */
async function issuable(s: DemoState, pointId: string, productId: string) {
  const [r] = await q<{ n: number }>(
    s,
    sql`SELECT coalesce(sum(m.quantity), 0)::int AS n FROM pharmacy_stock_movements m
      JOIN pharmacy_batches b ON b.id = m.batch_id
      WHERE coalesce(b.location_id, b.dispensing_point_id) = ${pointId} AND b.product_id = ${productId}
        AND b.expiry >= ${localDate(new Date())}::date AND NOT private.pharmacy_batch_recalled(b.id)`,
  );
  return Number(r?.n ?? 0);
}

const controlledIds = (s: DemoState) =>
  new Set(s.medicines.filter((m) => m.controlled).map((m) => m.id));
const unitOf = (s: DemoState, medicineId: string) =>
  s.medicines.find((m) => m.id === medicineId)?.unit ?? "tablet";
const LEVEL: Record<string, number> = {
  tablet: 200,
  capsule: 200,
  sachet: 60,
  bottle: 10,
  inhaler: 4,
  vial: 30,
  ampoule: 30,
  bag: 40,
  tube: 10,
  pen: 5,
};
const marRoute = (route: string) => {
  const r = route.trim().toLowerCase();
  return ["oral", "iv", "im", "sc", "topical", "inhaled", "pr"].includes(r) ? r : "other";
};
const routeFor = (unit: string) =>
  ["vial", "ampoule", "bag"].includes(unit) ? "IV" : unit === "inhaler" ? "Inhaled" : "Oral";

/* ─── Section 9: wards and carts ─────────────────────────────────────── */

/** Each ward's issuing point and the medicines on its levels (kept to those stocked there, never controlled). */
const WARDS: Record<WardKey, { from: PointKey; meds: string[] }> = {
  medM: {
    from: "inpatient",
    meds: [
      "ceftriaxone",
      "metronidazole",
      "paracetamol",
      "omeprazole",
      "furosemide",
      "heparin_unfractionated",
      "sodium_chloride_0_9",
      "insulin_soluble",
    ],
  },
  medF: {
    from: "inpatient",
    meds: [
      "ceftriaxone",
      "amoxicillin_clavulanic_acid",
      "paracetamol",
      "omeprazole",
      "enalapril",
      "enoxaparin",
      "sodium_chloride_0_9",
      "metoclopramide",
    ],
  },
  surgical: {
    from: "inpatient",
    meds: [
      "ceftriaxone",
      "metronidazole",
      "paracetamol",
      "diclofenac",
      "gentamicin",
      "ringers_lactate",
      "ondansetron",
      "enoxaparin",
    ],
  },
  paediatric: {
    from: "paediatrics",
    meds: [
      "amoxicillin",
      "artesunate",
      "paracetamol",
      "oral_rehydration_salts",
      "zinc_sulfate",
      "gentamicin",
      "ceftriaxone",
      "glucose_50",
    ],
  },
  maternity: {
    from: "maternity",
    meds: [
      "oxytocin",
      "magnesium_sulfate",
      "ferrous_sulfate",
      "paracetamol",
      "ceftriaxone",
      "ringers_lactate",
      "tranexamic_acid",
      "metronidazole",
    ],
  },
  icu: {
    from: "inpatient",
    meds: [
      "meropenem",
      "vancomycin",
      "adrenaline",
      "heparin_unfractionated",
      "sodium_chloride_0_9",
      "potassium_chloride",
      "dexamethasone",
      "omeprazole",
    ],
  },
};

/** The carts; A and B carry the emergency section's resus-desk names (controlled.ts), so its uses show at each check. */
const CARTS: {
  label: string;
  names: string[];
  unit: "ed" | "icu" | "maternity";
  from: PointKey;
  items: [string, number][];
}[] = [
  {
    label: "Demo resus cart A (emergency)",
    names: ["Demo resus cart A (emergency)", "ED resus trolley"],
    unit: "ed",
    from: "emergency",
    items: [
      ["adrenaline", 10],
      ["hydrocortisone", 4],
      ["tranexamic_acid", 4],
      ["ceftriaxone", 4],
      ["ondansetron", 4],
      ["magnesium_sulfate", 4],
      ["glucose_50", 4],
      ["naloxone", 4],
      ["sodium_chloride_0_9", 6],
      ["salbutamol", 2],
    ],
  },
  {
    label: "Demo resus cart B (intensive care)",
    names: ["Demo resus cart B (intensive care)", "ICU crash cart"],
    unit: "icu",
    from: "emergency",
    items: [
      ["adrenaline", 10],
      ["glucose_50", 4],
      ["naloxone", 2],
      ["hydrocortisone", 4],
      ["dexamethasone", 4],
      ["sodium_chloride_0_9", 6],
    ],
  },
  {
    label: "Demo maternity emergency cart",
    names: ["Demo maternity emergency cart"],
    unit: "maternity",
    from: "maternity",
    items: [
      ["oxytocin", 10],
      ["magnesium_sulfate", 8],
      ["tranexamic_acid", 4],
      ["ringers_lactate", 4],
    ],
  },
];

/** The hub ward for a ward department, found or added (one per department, named as it). */
async function hubWard(s: DemoState, key: WardKey) {
  const dept = s.wards[key];
  const [w] = await q<{ id: string }>(
    s,
    sql`SELECT id FROM hospital_wards WHERE hospital_id = ${s.h} AND department_id = ${dept} ORDER BY created_at LIMIT 1`,
  );
  if (w) return w.id;
  const d = await one<{ name: string }>(
    s,
    sql`SELECT name FROM hospital_departments WHERE id = ${dept}`,
  );
  return (
    await one<{ id: string }>(
      s,
      sql`INSERT INTO hospital_wards (hospital_id, department_id, name, slug)
        VALUES (${s.h}, ${dept}, ${d.name}, ${`demo-ward-${randomUUID().slice(0, 8)}`}) RETURNING id`,
    )
  ).id;
}

/** The ward's nurse in charge: the one assigned, else `nurse`, assigned a month ago. */
async function inCharge(s: DemoState, wardId: string, nurse: string) {
  const [cur] = await q<{ nurse: string }>(
    s,
    sql`SELECT nurse_user_id AS nurse FROM ward_in_charge_assignments WHERE ward_id = ${wardId} AND ends_at IS NULL LIMIT 1`,
  );
  if (cur) return cur.nurse;
  await s.db
    .execute(sql`INSERT INTO ward_in_charge_assignments (hospital_id, ward_id, nurse_user_id, starts_at, set_by_user_id)
    VALUES (${s.h}, ${wardId}, ${nurse}, now() - interval '30 days', ${s.people.admin})`);
  return nurse;
}

/** The unit's head (the cart's clinical lead): the one named, else `person`, from a month ago. */
async function unitHead(s: DemoState, dept: string, person: string) {
  const [cur] = await q<{ id: string }>(
    s,
    sql`SELECT user_id AS id FROM department_heads WHERE department_id = ${dept} AND ends_at IS NULL AND NOT acting LIMIT 1`,
  );
  if (cur) return cur.id;
  await s.db
    .execute(sql`INSERT INTO department_heads (hospital_id, department_id, user_id, acting, starts_at, set_by_user_id)
    VALUES (${s.h}, ${dept}, ${person}, false, now() - interval '30 days', ${s.people.admin})`);
  return person;
}

/** The patient's arrival on the ward (admitted from the emergency department); its visit, or null if admitted elsewhere. */
async function admitted(s: DemoState, p: DemoPatient, wardId: string, nurse: string) {
  const [a] = await q<{ ward: string; enc: string | null; status: string }>(
    s,
    sql`SELECT ward_id AS ward, inpatient_encounter_id AS enc, status FROM admissions
      WHERE patient_user_id = ${p.id} AND status IN ('awaiting_bed', 'bed_allocated', 'arrived') LIMIT 1`,
  );
  if (a) return a.status === "arrived" && a.ward === wardId ? a.enc : null;
  const e = await one<{ started: string }>(
    s,
    sql`SELECT started_at AS started FROM encounters WHERE id = ${p.enc}`,
  );
  const arrived = new Date(e.started);
  const doctor = s.people.doctors[1] ?? s.people.doctors[0]!;
  const src = await one<{ id: string }>(
    s,
    sql`INSERT INTO encounters (hospital_id, patient_user_id, clinician_user_id, department_id, state, started_at, ended_at,
        encounter_type, disposition)
      VALUES (${s.h}, ${p.id}, ${doctor}, ${s.clinics.ed}, 'completed', ${new Date(arrived.getTime() - 3 * HOUR).toISOString()}::timestamptz,
        ${arrived.toISOString()}::timestamptz, 'emergency', 'admitted') RETURNING id`,
  );
  // As the admission tests do: a bed allocated, then the arrival as its own move (0091's guard).
  const adm = await one<{ id: string }>(
    s,
    sql`INSERT INTO admissions (hospital_id, patient_user_id, source_encounter_id, ward_id, status, decided_by, decided_at)
      VALUES (${s.h}, ${p.id}, ${src.id}, ${wardId}, 'bed_allocated', ${doctor},
        ${new Date(arrived.getTime() - HOUR).toISOString()}::timestamptz) RETURNING id`,
  );
  await s.db
    .execute(sql`UPDATE admissions SET status = 'arrived', inpatient_encounter_id = ${p.enc},
      arrived_at = ${arrived.toISOString()}::timestamptz, arrived_by = ${nurse} WHERE id = ${adm.id}`);
  bump(s, "admissions");
  return p.enc;
}

type WardRx = {
  patient: DemoPatient;
  enc: string;
  rx: string;
  medicineId: string;
  name: string;
  route: string;
};

/**
 * The ward's patients' lines for the administration record: their own prescriptions where the dispensing section
 * wrote them, else one line each from the ward's list, written as the prescribing desk leaves one.
 */
async function wardLines(
  s: DemoState,
  key: WardKey,
  wardId: string,
  nurse: string,
  meds: string[],
) {
  const out: WardRx[] = [];
  const blocked = controlledIds(s);
  for (const p of s.patients.filter((x) => x.ward === key)) {
    const enc = await admitted(s, p, wardId, nurse);
    if (!enc) continue;
    const own = (
      await q<{ id: string; drug: string; name: string; route: string }>(
        s,
        sql`SELECT id, drug_id AS drug, drug_name AS name, route FROM prescriptions
          WHERE encounter_id = ${p.enc} AND NOT is_emergency AND state <> 'cancelled' AND drug_id IS NOT NULL
          ORDER BY created_at LIMIT 3`,
      )
    ).filter((r) => !blocked.has(r.drug));
    if (own.length) {
      out.push(
        ...own.map((r) => ({
          patient: p,
          enc,
          rx: r.id,
          medicineId: r.drug,
          name: r.name,
          route: r.route,
        })),
      );
      continue;
    }
    const m = s.medicines.find((x) => x.id === meds[p.n % meds.length]);
    if (!m) continue;
    const t = at(s, 5, 10);
    const rx = await one<{ id: string }>(
      s,
      sql`INSERT INTO prescriptions (hospital_id, encounter_id, patient_user_id, prescriber_user_id, prescriber_cadre,
          drug_id, drug_name, dose, route, frequency, is_emergency, state, placement_id, placement_line, created_at,
          updated_at, check_answers, controlled, edits)
        VALUES (${s.h}, ${p.enc}, ${p.id}, ${s.people.doctors[0]!}, 'MEDICAL_OFFICER', ${m.id}, ${m.name}, ${DEMO_DOSE},
          ${routeFor(m.unit)}, ${DEMO_DOSE}, false, 'active', ${randomUUID()}, 1, ${t.toISOString()}::timestamptz,
          ${t.toISOString()}::timestamptz, '[]'::jsonb, false, '[]'::jsonb) RETURNING id`,
    );
    bump(s, "ward_prescriptions");
    out.push({
      patient: p,
      enc,
      rx: rx.id,
      medicineId: m.id,
      name: m.name,
      route: routeFor(m.unit),
    });
  }
  return out;
}

/** Doses charted on the ward (the administration record), as the nurse's chart leaves them. */
async function chart(s: DemoState, lines: WardRx[], nurse: string, times: Date[]) {
  for (const l of lines)
    for (const t of times) {
      await s.db
        .execute(sql`INSERT INTO medication_administration_records (hospital_id, patient_user_id, encounter_id,
          administered_by_user_id, drug_name, dose, route, state, emr_prescription_id, administered_at)
        VALUES (${s.h}, ${l.patient.id}, ${l.enc}, ${nurse}, ${l.name}, ${DEMO_DOSE}, ${marRoute(l.route)}, 'administered',
          ${l.rx}, ${t.toISOString()}::timestamptz)`);
      bump(s, "doses_charted");
    }
}

/** The batches an issue left at a place, with their quantities. */
async function issuedTo(s: DemoState, issueId: string, locationId: string) {
  return q<{ batchId: string; quantity: number }>(
    s,
    sql`SELECT batch_id AS "batchId", sum(quantity)::int AS quantity FROM pharmacy_stock_movements
      WHERE source_id = ${issueId} AND kind = 'received_from_issue' AND location_id = ${locationId} GROUP BY batch_id`,
  );
}

type Ward = { location: string; nurse: string; from: string };

/** A ward's requisition raised by its nurse in charge; issued (if `issued`) by the chief pharmacist from what the point can spare. */
async function requisition(
  s: DemoState,
  w: Ward,
  lines: { productId: string; quantity: number }[],
  raised: Date,
  issued: Date | null,
) {
  const r = await onWard(
    s,
    w.nurse,
    "ward_act",
    ws.WardRequisitionInput,
    ws.raiseWardRequisition,
    {
      clientKey: randomUUID(),
      locationId: w.location,
      issuingLocationId: w.from,
      lines,
    },
    raised,
  );
  bump(s, "ward_requisitions");
  if (!issued) return null;
  const rows = await q<{ id: string; product: string; asked: number }>(
    s,
    sql`SELECT id, product_id AS product, quantity_asked AS asked FROM pharmacy_requisition_lines WHERE requisition_id = ${r.id}`,
  );
  const answers = [];
  for (const l of rows) {
    const n = Math.min(Number(l.asked), Math.floor((await issuable(s, w.from, l.product)) / 3));
    answers.push({
      lineId: l.id,
      quantity: n,
      notIssuedReason: n > 0 ? null : "Demo: not enough at the pharmacy",
    });
  }
  if (!answers.some((a) => a.quantity > 0)) return null;
  // Catalogue slice Step 10: with the check on, each issued line is picked first (ticked by hand here).
  if (pharmacyCatalogueLiveFor(s.h))
    for (const a of answers.filter((a) => a.quantity > 0))
      await write(
        s,
        chiefActor(s, null),
        dist.RecordPickInput,
        STORE,
        dist.recordPick,
        {
          requisitionId: r.id,
          lineId: a.lineId,
          raw: null,
        },
        issued,
      );
  const done = await write(
    s,
    chiefActor(s, null),
    issues.IssueRequisitionInput,
    STORE,
    issues.issueRequisition,
    {
      requisitionId: r.id,
      lines: answers,
    },
    issued,
  );
  bump(s, "ward_issues");
  return done.id;
}

/** The nurse in charge confirms what arrived (their own second factor); `short` units fewer on the first batch. */
async function confirm(s: DemoState, w: Ward, issueId: string, when: Date, short = 0) {
  const rows = await issuedTo(s, issueId, w.location);
  await onWard(
    s,
    w.nurse,
    "ward_confirm",
    ws.ConfirmReceiptInput,
    ws.confirmWardIssue,
    {
      issueId,
      locationId: w.location,
      attestationId: await signer(s, w.nurse, w.nurse, "pharmacy_receipt"),
      lines: rows.map((r, i) => ({
        batchId: r.batchId,
        arrived: Math.max(0, r.quantity - (i === 0 ? short : 0)),
      })),
      reasonCode: short ? "short" : null,
    },
    when,
  );
  bump(s, "ward_receipts");
}

/** Signs a draft ward levels or cart list: the chief pharmacist first, the ward's or unit's lead second. */
async function signPlacePack(s: DemoState, packId: string, second: string, when: Date) {
  await write(
    s,
    chiefActor(s, null),
    ws.SignPackInput,
    MANAGE,
    asWho(ws.signLocationPack),
    {
      packId,
      firstAttestationId: await signer(s, s.people.chief, s.people.chief, "pharmacy_pack_first"),
      secondAttestationId: await signer(s, s.people.chief, second, "pharmacy_pack_second"),
      exception: false,
    },
    when,
  );
  bump(s, "place_packs_signed");
}

/**
 * Section 9, Store › Wards and Store › Carts: the six wards as stocked places (live a month), signed ward levels on
 * five and a draft on intensive care, a requisition issued and confirmed nine days ago (one ward short on arrival), a
 * blind ward count two days ago (use written from it; one surplus with its reason; maternity never counted, so it
 * asks for a count first), doses charted around it, and today's work: requisitions waiting, an issue not yet
 * confirmed, a near-expiry return. Three emergency carts with signed lists (one draft revision), a first check that
 * stocked them, a second that passed or found two gaps, and the maternity cart past its weekly check.
 */
export async function wardsSection(s: DemoState): Promise<void> {
  // Ward top-ups need Phase 1's count freshness (the strictest point setting is read for wards).
  await write(
    s,
    chiefActor(s, "inpatient"),
    stock.FreshnessInput,
    stock.MANAGE_AT_POINT,
    stock.setCountFreshness,
    { days: 45 },
  );
  await ensurePack(s, "ward_rules", {
    confirmationWindowHours: 48,
    allocationRule: "first_expiry",
  });
  const extra = {
    maternity: await demoStaff(
      s,
      "Demo nurse in charge, maternity",
      s.wards.maternity,
      "NURSE",
      "nurse",
    ),
    icu: await demoStaff(s, "Demo nurse in charge, intensive care", s.wards.icu, "NURSE", "nurse"),
    ed: await demoStaff(s, "Demo emergency unit lead", s.clinics.ed, "NURSE", "nurse"),
  };
  bump(s, "staff", 3);
  const nurseFor: Record<WardKey, string> = {
    medM: s.people.nurses[0] ?? extra.icu,
    medF: s.people.nurses[1] ?? extra.icu,
    surgical: s.people.nurses[2] ?? extra.icu,
    paediatric: s.people.nurses[3] ?? extra.icu,
    maternity: extra.maternity,
    icu: extra.icu,
  };
  const blocked = controlledIds(s);
  const chief = chiefActor(s, null);
  const product = (m: string, p: PointKey) => s.stock.get(m)?.get(p)?.productId;

  for (const key of Object.keys(WARDS) as WardKey[]) {
    const spec = WARDS[key];
    const from = s.points[spec.from].id;
    const wardId = await hubWard(s, key);
    const nurse = await inCharge(s, wardId, nurseFor[key]);
    const name = (
      await one<{ name: string }>(s, sql`SELECT name FROM hospital_wards WHERE id = ${wardId}`)
    ).name;
    const [placed] = await q<{ id: string }>(
      s,
      sql`SELECT id FROM pharmacy_locations WHERE ward_id = ${wardId}`,
    );
    const location =
      placed?.id ??
      (
        await write(
          s,
          chief,
          places.CreateLocationInput,
          MANAGE,
          places.createLocation,
          {
            kind: "ward",
            name,
            wardId,
            wardSupplyModel: "stocked",
            anyNurseConfirms: key !== "icu",
          },
          at(s, 31, 9),
        )
      ).id;
    await goLive(s, location, at(s, 30, 9));
    bump(s, "ward_places");
    const w = { location, nurse, from };

    // The lines charted on this ward come first, so their medicines are on its levels.
    const meds = spec.meds.filter((m) => !blocked.has(m) && product(m, spec.from));
    const lines = await wardLines(s, key, wardId, nurse, meds);
    const onLevels = [...new Set([...meds, ...lines.map((l) => l.medicineId)])]
      .filter((m) => !blocked.has(m) && product(m, spec.from))
      .slice(0, 10);
    if (!onLevels.length) continue;
    const levels = onLevels.map((m) => ({
      productId: product(m, spec.from)!,
      level: LEVEL[unitOf(s, m)] ?? 50,
    }));
    const draft = await write(
      s,
      chief,
      ws.WardLevelsInput,
      MANAGE,
      asWho(ws.setWardLevels),
      { locationId: location, levels },
      at(s, 30, 10),
    );
    bump(s, "ward_levels");
    if (key === "icu") continue; // intensive care's levels wait for the nurse in charge's signature
    await signPlacePack(s, draft.id, nurse, at(s, 30, 11));

    // Nine days ago: the levels asked for, issued from what the point could spare, confirmed (medical women's short).
    const first = await requisition(
      s,
      w,
      levels.map((l) => ({ productId: l.productId, quantity: l.level })),
      at(s, 9, 8),
      at(s, 9, 11),
    );
    if (first) await confirm(s, w, first, at(s, 9, 15), key === "medF" ? 2 : 0);

    await chart(s, lines, nurse, [at(s, 5, 8), at(s, 4, 8), at(s, 3, 8)]);
    if (key !== "maternity") {
      const held = (await heldAt(s, location)).filter((b) => b.n > 0);
      const surplus = key === "surgical" ? held[0]?.batch : undefined;
      if (held.length) {
        const count = await onWard(
          s,
          nurse,
          "ward_act",
          ws.WardCountInput,
          ws.recordWardCount,
          {
            step: "count",
            clientKey: randomUUID(),
            locationId: location,
            lines: held.map((b, i) => ({
              productId: b.product,
              batchId: b.batch,
              counted:
                b.batch === surplus
                  ? b.n + 3
                  : i % 4 === 3
                    ? b.n
                    : b.n - Math.ceil(b.n * (0.2 + (i % 3) * 0.1)),
            })),
          },
          at(s, 2, 17),
        );
        bump(s, "ward_counts");
        if (surplus)
          await onWard(
            s,
            nurse,
            "ward_act",
            ws.WardCountInput,
            ws.recordWardCount,
            {
              step: "reasons",
              countId: count.id,
              locationId: location,
              reasons: [
                {
                  batchId: surplus,
                  reasonCode: "receipt_unrecorded",
                  note: "Demo: a box from the night issue was not entered.",
                },
              ],
            },
            new Date(at(s, 2, 17).getTime() + 20 * 60_000),
          );
      }
    }
    await chart(s, lines, nurse, [at(s, 1, 8), at(s, 1, 20), ago(s, 2)]);

    // Today.
    const topUp = levels
      .slice(0, 4)
      .map((l) => ({ productId: l.productId, quantity: Math.ceil(l.level / 2) }));
    if (key === "medM" || key === "surgical") await requisition(s, w, topUp, ago(s, 3), null);
    if (key === "medF") await requisition(s, w, topUp, at(s, 1, 9), ago(s, 4)); // issued, not yet confirmed
    if (key === "paediatric") {
      const [near] = (await heldAt(s, location)).filter((b) => b.n >= 4);
      if (near) {
        await onWard(
          s,
          nurse,
          "ward_act",
          ws.WardReturnInput,
          ws.returnWardStock,
          {
            clientKey: randomUUID(),
            locationId: location,
            toLocationId: from,
            batchId: near.batch,
            quantity: 2,
            reasonCode: "near_expiry",
            note: "Demo: returned for use first at the pharmacy.",
            fit: true,
          },
          ago(s, 5),
        );
        bump(s, "ward_returns");
      }
    }
  }

  // Emergency carts: places, signed lists, checks.
  for (const [i, c] of CARTS.entries()) {
    const dept = c.unit === "ed" ? s.clinics.ed : s.wards[c.unit];
    const [cc] = await q<{ id: string }>(
      s,
      sql`SELECT id FROM crash_carts WHERE hospital_id = ${s.h} AND label = ${c.label} LIMIT 1`,
    );
    const crashCartId =
      cc?.id ??
      (
        await one<{ id: string }>(
          s,
          sql`INSERT INTO crash_carts (hospital_id, department_id, label) VALUES (${s.h}, ${dept}, ${c.label}) RETURNING id`,
        )
      ).id;
    // The confirmer: the emergency department's head, or the ward's nurse in charge.
    const lead =
      c.unit === "ed"
        ? await unitHead(s, dept, extra.ed)
        : await inCharge(s, await hubWard(s, c.unit), extra[c.unit]);
    const [placed] = await q<{ id: string }>(
      s,
      sql`SELECT id FROM pharmacy_locations WHERE crash_cart_id = ${crashCartId}`,
    );
    const location =
      placed?.id ??
      (
        await write(
          s,
          chief,
          places.CreateLocationInput,
          MANAGE,
          places.createLocation,
          { kind: "cart", name: c.label, crashCartId },
          at(s, 31, 10),
        )
      ).id;
    await goLive(s, location, at(s, 30, 9));
    bump(s, "cart_places");
    const items = c.items
      .filter(([m]) => !blocked.has(m) && product(m, c.from))
      .map(([m, n]) => ({ productId: product(m, c.from)!, quantity: n }));
    if (!items.length) continue;
    const list = await write(
      s,
      chief,
      ws.CartListInput,
      MANAGE,
      asWho(ws.setCartList),
      {
        locationId: location,
        items,
        checkIntervalDays: 7,
        names: c.names,
      },
      at(s, 30, 12),
    );
    await signPlacePack(s, list.id, lead, at(s, 30, 13));
    bump(s, "cart_lists");

    const checker = pharmacistAt(s, c.from);
    const check = async (when: Date, gaps: Record<string, number>) => {
      const held = (await heldAt(s, location)).filter((b) => b.n > 0);
      const shown = await write(
        s,
        checker,
        carts.CartCheckInput,
        STOCK,
        asWho(carts.recordCartCheck),
        {
          step: "count",
          clientKey: randomUUID(),
          locationId: location,
          lines: held.map((b) => ({
            batchId: b.batch,
            counted: Math.max(0, b.n - (gaps[b.medicine] ?? 0)),
          })),
        },
        when,
      );
      const uses = "uses" in shown ? (shown.uses as unknown[]).length : 0;
      await write(
        s,
        checker,
        carts.CartCheckInput,
        STOCK,
        asWho(carts.recordCartCheck),
        {
          step: "complete",
          countId: shown.id,
          locationId: location,
          fromLocationId: s.points[c.from].id,
          sealNumber: `DEMO-SEAL-${i + 1}-${localDate(when).slice(5)}`,
          confirmAttestationId: await signer(s, checker.userId, lead, "pharmacy_cart_confirm"),
          explanations: held
            .filter((b) => gaps[b.medicine])
            .map((b) => {
              const e =
                b.medicine === "adrenaline"
                  ? "cannot_explain"
                  : uses
                    ? "recorded_uses_accepted"
                    : "used_not_recorded";
              return {
                batchId: b.batch,
                explanation: e,
                reasonCode: null,
                note:
                  e === "cannot_explain"
                    ? "Demo: one ampoule not found; the unit lead was told."
                    : null,
                toCartLocationId: null,
              };
            }),
          swaps: [],
        },
        new Date(when.getTime() + 15 * 60_000),
      );
      bump(s, "cart_checks");
    };
    // The first check found the cart empty and stocked it to the list; the maternity cart is past its weekly check.
    await check(at(s, i === 2 ? 9 : 8, 9), {});
    if (i === 2) continue;
    await check(at(s, 1, 9), i === 0 ? { adrenaline: 1, hydrocortisone: 1 } : {});
    // A revision of the intensive care cart's list waits for signing.
    if (i === 1)
      await write(
        s,
        chief,
        ws.CartListInput,
        MANAGE,
        asWho(ws.setCartList),
        {
          locationId: location,
          items: items.map((x) => ({ ...x, quantity: x.quantity + 2 })),
          checkIntervalDays: 7,
          names: c.names,
        },
        ago(s, 6),
      );
  }
}

/* ─── Section 10: expiry and a recall ────────────────────────────────── */

const expiredNumber = (point: PointKey, medicineId: string) =>
  `DEMO-EXP-${medicineId.slice(0, 4).toUpperCase()}-${POINT_ORDER.indexOf(point) + 1}`;

/** A small batch received five weeks ago that has since expired (the demo's expired stock). */
async function expiredBatch(s: DemoState, point: PointKey, medicineId: string, quantity: number) {
  const productId = s.stock.get(medicineId)?.get(point)?.productId;
  if (!productId) return null;
  const r = await write(
    s,
    techAt(s, point),
    stock.ReceiveInput,
    stock.STOCK_NEED,
    (ctx, i) => stock.receiveStock(ctx, i),
    {
      productId,
      batchNumber: expiredNumber(point, medicineId),
      expiry: localDate(new Date(s.now.getTime() - (4 + POINT_ORDER.indexOf(point)) * DAY)),
      quantity,
      from: "supplier",
      deliveryRef: "Demo delivery, five weeks ago",
    },
    at(s, 38, 10),
  );
  bump(s, "expired_batches");
  return "batchId" in r ? (r.batchId as string) : null;
}

/**
 * Section 10, Store › Expiry and recall: the short-dated batches the stock section left, expired stock at three
 * points (one still on the shelf, two moved to quarantine, one of them written off with its witness and later its
 * disposal reference), damaged vials in quarantine, and one open recall of a batch that reached a ward: started
 * from a demo notice (the wards and carts told at once), every balance quarantined, and the first patients contacted.
 */
export async function expirySection(s: DemoState): Promise<void> {
  await reasonLists(s);
  const qId = await quarantine(s);
  const chief = chiefActor(s, null);

  const plan: [PointKey, string, number, "shelf" | "quarantine" | "write_off"][] = [
    ["emergency", "ondansetron", 20, "shelf"],
    ["maternity", "folic_acid", 60, "write_off"],
    ["paediatrics", "zinc_sulfate", 40, "quarantine"],
  ];
  for (const [point, medicineId, quantity, fate] of plan) {
    const batchId = await expiredBatch(s, point, medicineId, quantity);
    if (!batchId || fate === "shelf") continue;
    await write(
      s,
      pharmacistAt(s, point),
      expiry.QuarantineInput,
      expiry.STOCK_NEED,
      expiry.moveToQuarantine,
      {
        locationId: s.points[point].id,
        batchId,
        quantity,
        reasonCode: "expired",
        note: "Demo: found expired at the weekly shelf check.",
      },
      at(s, 3, 10),
    );
    bump(s, "quarantined");
    if (fate !== "write_off") continue;
    const [inQ] = await q<{ id: string }>(
      s,
      sql`SELECT id FROM pharmacy_batches WHERE location_id = ${qId}
        AND product_id = ${s.stock.get(medicineId)!.get(point)!.productId} AND batch_number = ${expiredNumber(point, medicineId)}`,
    );
    if (!inQ) continue;
    const wo = await write(
      s,
      chief,
      expiry.WriteOffInput,
      expiry.MANAGE_NEED,
      expiry.writeOff,
      {
        batchId: inQ.id,
        quantity,
        reasonCode: "expired",
        registerNumber: "Demo 088/001",
        note: "Demo: expired stock written off for disposal.",
        witnessAttestationId: await witness(
          s,
          s.people.chief,
          s.people.pharmacists[2] ?? s.people.storekeeper,
          "write_off",
        ),
      },
      at(s, 2, 11),
    );
    await write(
      s,
      chief,
      expiry.DisposalInput,
      expiry.MANAGE_NEED,
      expiry.recordDisposalReference,
      {
        writeOffId: wo.id,
        reference: "Demo disposal reference 001",
        disposalOn: localDate(at(s, 1, 10)),
      },
      at(s, 1, 10),
    );
    bump(s, "write_offs");
  }

  // Damaged vials at the inpatient pharmacy, waiting in quarantine.
  const inpatient = await heldAt(s, s.points.inpatient.id);
  const cracked = ["vancomycin", "meropenem", "artesunate"]
    .map((m) => inpatient.find((x) => x.medicine === m && x.n >= 5))
    .find((b) => !!b);
  if (cracked) {
    await write(
      s,
      pharmacistAt(s, "inpatient"),
      expiry.QuarantineInput,
      expiry.STOCK_NEED,
      expiry.moveToQuarantine,
      {
        locationId: s.points.inpatient.id,
        batchId: cracked.batch,
        quantity: 2,
        reasonCode: "damaged",
        note: "Demo: two vials cracked in the delivery box.",
      },
      at(s, 4, 15),
    );
    bump(s, "quarantined");
  }

  // The recall: a batch that reached a ward, preferring one supplied to patients and charted on the ward.
  const blocked = controlledIds(s);
  const [pick] = (
    await q<{
      product: string;
      number: string;
      medicine: string;
      supplies: number;
      charted: number;
    }>(
      s,
      sql`SELECT b.product_id AS product, b.batch_number AS number, p.medicine_id AS medicine,
          (SELECT count(*)::int FROM pharmacy_supplies sp JOIN pharmacy_batches sb ON sb.id = sp.batch_id
            WHERE sb.product_id = b.product_id AND lower(sb.batch_number) = lower(b.batch_number)) AS supplies,
          (SELECT count(*)::int FROM medication_administration_records mar
            JOIN prescriptions rx ON rx.id = mar.emr_prescription_id
            JOIN admissions a ON a.inpatient_encounter_id = mar.encounter_id
            WHERE a.ward_id = l.ward_id AND rx.drug_id = p.medicine_id AND mar.state = 'administered'
              AND NOT EXISTS (SELECT 1 FROM medication_administration_records r WHERE r.reverses_id = mar.id)) AS charted
        FROM pharmacy_stock_movements m
        JOIN pharmacy_locations l ON l.id = m.location_id AND l.kind = 'ward'
        JOIN pharmacy_batches b ON b.id = m.batch_id
        JOIN pharmacy_products p ON p.id = b.product_id
        WHERE m.hospital_id = ${s.h} AND m.kind = 'received_from_issue' AND NOT private.pharmacy_batch_recalled(b.id)
        GROUP BY b.product_id, b.batch_number, p.medicine_id, l.ward_id`,
    )
  )
    .filter((c) => !blocked.has(c.medicine))
    .sort(
      (a, b) =>
        Number(b.supplies > 0) - Number(a.supplies > 0) ||
        Number(b.charted > 0) - Number(a.charted > 0) ||
        b.supplies - a.supplies,
    );
  if (!pick) return;
  const started = ago(s, 3);
  const r = await write(
    s,
    chief,
    recall.StartRecallInput,
    recall.MANAGE_NEED,
    recall.startRecall,
    {
      productId: pick.product,
      batchNumber: pick.number,
      source: "nda",
      noticeRef: "Demo recall NDA-DEMO-2026-001",
      noticeDate: localDate(at(s, 1, 9)),
      statedClass: "B",
      level: "Demo: wards, pharmacies and patients",
      instructions:
        "Demo: stop supplying this batch, quarantine every unit and contact the patients who received it.",
    },
    started,
  );
  bump(s, "recalls");
  await write(
    s,
    chief,
    recall.QuarantineRecallInput,
    recall.MANAGE_NEED,
    recall.quarantineRecall,
    { recallId: r.id },
    new Date(started.getTime() + 30 * 60_000),
  );
  const base = await loadTraceBase(s.db, s.h, r.id);
  if (!base) return;
  const trace = await finishTrace(base, s.db, s.h);
  type Outcome = "reached_by_phone" | "could_not_reach" | "reached_at_visit";
  const contacts: [string, "exact" | "may_have", Outcome][] = [
    ...trace.exact
      .slice(0, 2)
      .map((p, i): [string, "exact", Outcome] => [
        p.patientId,
        "exact",
        i ? "could_not_reach" : "reached_by_phone",
      ]),
    ...trace.mayHave
      .slice(0, 1)
      .map((p): [string, "may_have", Outcome] => [p.patientId, "may_have", "reached_at_visit"]),
  ];
  for (const [patientUserId, list, outcome] of contacts) {
    await write(
      s,
      chief,
      recall.ContactInput,
      recall.CONTACT_NEED,
      recall.recordRecallContact,
      {
        recallId: r.id,
        patientUserId,
        list,
        outcome,
        note: outcome === "could_not_reach" ? "Demo: phone off; try again tomorrow." : null,
      },
      ago(s, 1),
    );
    bump(s, "recall_contacts");
  }
}

/* ─── Section 11: month end ──────────────────────────────────────────── */

/**
 * Closes last month at one place when nothing it held or moved changed after the month-end count: the blind count
 * (17:00 on the last day), one difference with its reason, then the close with a second approver. A place with later
 * movements on what it held stays open, since a count written now would not match the ledger at that hour.
 */
async function closeAt(
  s: DemoState,
  locationId: string,
  counter: PharmacyActor,
  monthStart: string,
  countAt: Date,
) {
  const moves = await q<{
    batch: string;
    product: string;
    medicine: string;
    n: number;
    at: string;
  }>(
    s,
    sql`SELECT m.batch_id AS batch, b.product_id AS product, p.medicine_id AS medicine, m.quantity AS n, m.effective_at AS at
      FROM pharmacy_stock_movements m JOIN pharmacy_batches b ON b.id = m.batch_id
      JOIN pharmacy_products p ON p.id = b.product_id
      WHERE coalesce(m.location_id, m.dispensing_point_id) = ${locationId}`,
  );
  const batches = new Map<
    string,
    { product: string; medicine: string; before: number; after: number; moved: boolean }
  >();
  for (const m of moves) {
    const b = batches.get(m.batch) ?? {
      product: m.product,
      medicine: m.medicine,
      before: 0,
      after: 0,
      moved: false,
    };
    const t = new Date(m.at);
    if (t < countAt) b.before += Number(m.n);
    else b.after += 1;
    if (localMonth(t) === monthStart) b.moved = true;
    batches.set(m.batch, b);
  }
  const relevant = [...batches].filter(([, b]) => b.before !== 0 || b.moved);
  if (!relevant.length || relevant.some(([, b]) => b.after > 0)) return false;
  const blocked = controlledIds(s);
  const diff = relevant.find(([, b]) => b.before >= 5 && !blocked.has(b.medicine));
  await write(
    s,
    counter,
    month.MonthEndCountInput,
    month.COUNT_NEED,
    month.recordMonthEndCount,
    {
      locationId,
      lines: relevant.map(([id, b]) => ({
        batchId: id,
        counted: id === diff?.[0] ? b.before - 1 : b.before,
      })),
      witnessAttestationId: relevant.some(([, b]) => blocked.has(b.medicine))
        ? await witness(s, counter.userId, s.people.chief, "month_end_count")
        : null,
    },
    countAt,
  );
  bump(s, "month_end_counts");
  if (diff)
    await write(
      s,
      counter,
      month.DifferenceReasonInput,
      month.REASON_NEED,
      month.recordDifferenceReason,
      {
        locationId,
        month: monthStart,
        productId: diff[1].product,
        kind: "difference",
        reasonCode: "breakage",
        unexplained: false,
        note: "Demo: one unit found broken at the count.",
      },
      new Date(countAt.getTime() + HOUR),
    );
  // Closed after every movement already recorded (a movement recorded after the close counts as late).
  await write(
    s,
    chiefActor(s, null),
    month.CloseMonthInput,
    month.CLOSE_NEED,
    month.closeMonth,
    {
      locationId,
      month: monthStart,
      approvalAttestationId: await witness(
        s,
        s.people.chief,
        s.people.pharmacists[0] ?? s.people.storekeeper,
        "month_close",
      ),
    },
    new Date(),
  );
  bump(s, "months_closed");
  return true;
}

/**
 * Section 11, Store › Month end: the signed month-end rules, HMIS column maps (demo column names), tracer list,
 * stock-out day rule and reason lists; damaged stock moved to quarantine before last month's end, then last month
 * counted and closed (snapshot and difference reason) at every place untouched since its count. The hospital view
 * of last month, HMIS 105 section 6 and the tracer audit read the whole ledger.
 */
export async function monthEndSection(s: DemoState): Promise<void> {
  await reasonLists(s);
  await ensurePack(s, "month_end_rules", {
    countWindow: { daysBefore: 3, daysAfter: 5 },
    outOfStockShare: 0.1,
    largeDifferenceUnits: 20,
    reportLocationKinds: ["store", "dispensing_point"],
  });
  const forms: PackContent<"hmis_column_maps">["forms"] = {
    hmis_105_s6: {
      columns: [
        "Demo: tracer medicine",
        "Demo: stock on hand at month end",
        "Demo: days out of stock",
      ],
    },
    hmis_088: {
      columns: [
        "Demo: date",
        "Demo: medicine and batch",
        "Demo: quantity",
        "Demo: reason",
        "Demo: register entry",
      ],
    },
  };
  await ensurePack(s, "hmis_column_maps", { forms }, (cur) => {
    const missing = Object.entries(forms).filter(([k]) => !cur.forms[k as keyof typeof forms]);
    return missing.length ? { forms: { ...cur.forms, ...Object.fromEntries(missing) } } : null;
  });
  const shelf = new Set(s.medicines.map((m) => m.id));
  await ensurePack(s, "tracer_list", {
    source: "Demo tracer list for this demo hospital",
    medicineIds: [
      "amoxicillin",
      "artemether_lumefantrine",
      "co_trimoxazole",
      "oral_rehydration_salts",
      "zinc_sulfate",
      "oxytocin",
      "magnesium_sulfate",
      "ferrous_sulfate",
      "ceftriaxone",
      "tld",
      "metformin",
      "amlodipine",
      "sodium_chloride_0_9",
      "paracetamol",
    ].filter((m) => shelf.has(m)),
  });
  await ensurePack(s, "stockout_day_rule", { rule: "end_of_day" });

  const lastDay = addDays(localMonth(s.now), -1);
  const monthStart = `${lastDay.slice(0, 7)}-01`;
  const countAt = new Date(`${lastDay}T17:00:00+03:00`);

  // Damaged stock moved to quarantine three days before the month's end, from batches not already there.
  const qId = await quarantine(s);
  const inQ = new Set((await heldAt(s, qId)).map((b) => `${b.product}|${b.number}`));
  const inpatient = await heldAt(s, s.points.inpatient.id);
  let moved = 0;
  for (const medicineId of [
    "sodium_chloride_0_9",
    "ringers_lactate",
    "paracetamol",
    "metronidazole",
  ]) {
    const b = inpatient.find(
      (x) => x.medicine === medicineId && x.n >= 10 && !inQ.has(`${x.product}|${x.number}`),
    );
    if (!b || moved === 2) continue;
    await write(
      s,
      pharmacistAt(s, "inpatient"),
      expiry.QuarantineInput,
      expiry.STOCK_NEED,
      expiry.moveToQuarantine,
      {
        locationId: s.points.inpatient.id,
        batchId: b.batch,
        quantity: 6,
        reasonCode: "damaged",
        note: "Demo: damaged in a store-room leak.",
      },
      new Date(countAt.getTime() - 3 * DAY),
    );
    bump(s, "quarantined");
    moved++;
  }

  const storekeeper = pharmacyActor(s, s.people.storekeeper, "PHARMACY_TECH", null);
  await closeAt(s, qId, storekeeper, monthStart, countAt);
  const others = await q<{ id: string }>(
    s,
    sql`SELECT id FROM pharmacy_locations WHERE hospital_id = ${s.h} AND kind IN ('store', 'dispensing_point')
      AND archived_at IS NULL AND live_at IS NOT NULL AND switched_off_at IS NULL ORDER BY kind, name`,
  );
  for (const l of others) {
    const point = POINT_ORDER.find((p) => s.points[p].id === l.id);
    await closeAt(s, l.id, point ? techAt(s, point) : storekeeper, monthStart, countAt);
  }
}
