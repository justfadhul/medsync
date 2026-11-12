import type { Rule } from "./content";
import type { Before, Facts, HomeDecision } from "./reconciliation";
import type { EmrDb, EmrTx } from "@/lib/emr/db";
import { and, desc, eq, gte, inArray, lt, notExists, sql } from "drizzle-orm";

import { admissions } from "@/db/schema/admissions";
import { allergies, medicationStatements } from "@/db/schema/emr";
import { medicationAdministrationRecords } from "@/db/schema/nurse-workspace";
import {
  pharmacyReconciliationDecisions,
  pharmacyReconciliationEvents,
  pharmacyReconciliations,
} from "@/db/schema/pharmacy-clinical";
import { pharmacyQueries, pharmacyQueryEvents } from "@/db/schema/pharmacy-dispensing";
import { prescriptions } from "@/db/schema/prescribing";
import { decrypt } from "@/lib/encryption";
import { drugById } from "@/lib/prescribing/formulary";
import { entriesInForce, liveDose } from "./read";
import { changedSince } from "./reconciliation";

/** Pharmacy Phase 3, Step 9 reads. Patients are named by the caller through the identity read, never here. */

type Db = EmrDb | EmrTx;
const safe = (c: string | null) => {
  try {
    return c ? decrypt(c) : "";
  } catch {
    return "";
  }
};
export const medicineName = (id: string | null, text: string | null) =>
  (id ? drugById(id)?.generic : null) ?? text ?? id ?? "Not known";

/** The signed rules, or none: nothing is checked unsigned (Law 3). */
export async function rulesFor(db: Db, hospitalId: string) {
  const [e] = await entriesInForce(db, hospitalId, "reconciliation_rules");
  const p = e?.payload as { on?: Rule[]; explainReasons?: string[] } | undefined;
  return { signed: !!e, on: p?.on ?? [], explainReasons: p?.explainReasons ?? [] };
}

/** The patient's arrived admission at this hospital, newest first (MR-1 opens one per admission). */
export async function admissionFor(db: Db, hospitalId: string, patientUserId: string) {
  const [a] = await db
    .select()
    .from(admissions)
    .where(
      and(
        eq(admissions.hospitalId, hospitalId),
        eq(admissions.patientUserId, patientUserId),
        eq(admissions.status, "arrived"),
      ),
    )
    .orderBy(desc(admissions.decidedAt))
    .limit(1);
  return a ?? null;
}

/** Everything the engine needs for one reconciliation. */
export async function factsFor(db: Db, hospitalId: string, id: string, now: Date) {
  const [rec] = await db
    .select()
    .from(pharmacyReconciliations)
    .where(
      and(eq(pharmacyReconciliations.id, id), eq(pharmacyReconciliations.hospitalId, hospitalId)),
    );
  if (!rec) return null;
  const [adm] = await db.select().from(admissions).where(eq(admissions.id, rec.admissionId));
  const from = adm?.arrivedAt ?? adm?.decidedAt ?? rec.openedAt;
  const p = rec.patientUserId;
  const [statements, ward, home, decisions, events, allergyRows, queries] = await Promise.all([
    db
      .select()
      .from(medicationStatements)
      .where(
        and(
          eq(medicationStatements.hospitalId, hospitalId),
          eq(medicationStatements.patientUserId, p),
          sql`${medicationStatements.status} <> 'entered_in_error'`,
          notExists(
            db
              .select({ x: sql`1` })
              .from(sql`public.medication_statements AS newer`)
              .where(sql`newer.supersedes_id = ${medicationStatements.id}`),
          ),
        ),
      ),
    db
      .select({ id: prescriptions.id, drugId: prescriptions.drugId, state: prescriptions.state })
      .from(prescriptions)
      .where(
        and(
          eq(prescriptions.hospitalId, hospitalId),
          eq(prescriptions.patientUserId, p),
          gte(prescriptions.createdAt, from),
          lt(prescriptions.createdAt, rec.openedAt),
        ),
      ),
    db
      .select({
        id: prescriptions.id,
        drugId: prescriptions.drugId,
        dose: prescriptions.dose,
        frequency: prescriptions.frequency,
        route: prescriptions.route,
      })
      .from(prescriptions)
      .where(
        and(
          eq(prescriptions.hospitalId, hospitalId),
          eq(prescriptions.patientUserId, p),
          gte(prescriptions.createdAt, rec.openedAt),
          eq(prescriptions.state, "active"),
        ),
      ),
    db
      .select()
      .from(pharmacyReconciliationDecisions)
      .where(eq(pharmacyReconciliationDecisions.reconciliationId, id)),
    db
      .select()
      .from(pharmacyReconciliationEvents)
      .where(eq(pharmacyReconciliationEvents.reconciliationId, id))
      .orderBy(pharmacyReconciliationEvents.at),
    db
      .select({
        logicalId: allergies.logicalId,
        version: allergies.version,
        code: allergies.substanceCode,
        status: allergies.status,
        verification: allergies.verification,
      })
      .from(allergies)
      .where(eq(allergies.patientUserId, p)),
    db
      .select({ id: pharmacyQueries.id })
      .from(pharmacyQueries)
      .where(
        and(
          eq(pharmacyQueries.hospitalId, hospitalId),
          eq(pharmacyQueries.patientUserId, p),
          notExists(
            db
              .select({ x: sql`1` })
              .from(pharmacyQueryEvents)
              .where(
                and(
                  eq(pharmacyQueryEvents.queryId, pharmacyQueries.id),
                  inArray(pharmacyQueryEvents.kind, ["answered", "withdrawn"]),
                ),
              ),
          ),
        ),
      ),
  ]);
  const doses = ward.length
    ? await db
        .select({
          id: medicationAdministrationRecords.emrPrescriptionId,
          at: medicationAdministrationRecords.administeredAt,
        })
        .from(medicationAdministrationRecords)
        .where(
          and(
            inArray(
              medicationAdministrationRecords.emrPrescriptionId,
              ward.map((w) => w.id),
            ),
            liveDose(),
          ),
        )
    : [];
  // Current allergy versions only, refuted and voided ones out (AR-4).
  const newest = new Map<string, (typeof allergyRows)[number]>();
  for (const a of allergyRows) {
    const cur = newest.get(a.logicalId);
    if (!cur || a.version > cur.version) newest.set(a.logicalId, a);
  }
  const before: Before[] = statements.map((s) => ({
    medicineId: s.drugCode,
    statementId: s.id,
    text: s.drugCode ? medicineName(s.drugCode, null) : safe(s.drugTextCiphertext),
    admission: (s.reconciliation as Before["admission"]) ?? null,
    informant: s.informant,
  }));
  const lastDose = (rxIds: string[]) => {
    const t = doses.filter((d) => d.id && rxIds.includes(d.id)).map((d) => +new Date(d.at));
    return t.length ? new Date(Math.max(...t)) : null;
  };
  const byDrug = [...new Set(ward.map((w) => w.drugId))];
  const confirmed = events.filter((e) => e.kind === "confirmed").at(-1) ?? null;
  const closed = events.find((e) => e.kind === "closed") ?? null;
  const facts: Facts = {
    before,
    ward: byDrug.map((drug) => {
      const lines = ward.filter((w) => w.drugId === drug);
      return {
        medicineId: drug,
        // Cancelled only when every line of it was (R5).
        state: lines.every((l) => l.state === "cancelled") ? "cancelled" : "active",
        lastDose: lastDose(lines.map((l) => l.id)),
      };
    }),
    home: home.map((h) => ({
      medicineId: h.drugId,
      prescriptionId: h.id,
      directions: [h.dose, h.frequency, h.route].filter(Boolean).join(" "),
    })),
    decisions: decisions.map((d) => ({
      rowKey: d.rowKey,
      decision: d.decision as HomeDecision,
      reason: d.reason,
      at: new Date(d.decidedAt),
    })),
    allergyMedicineIds: [...newest.values()]
      .filter((a) => a.code && a.status !== "entered_in_error" && a.verification !== "refuted")
      .map((a) => a.code!),
    openQueries: queries.length,
    explained: events
      .filter((e) => e.kind === "explained" && e.discrepancy)
      .map((e) => ({ discrepancy: e.discrepancy!, at: new Date(e.at) })),
    confirmedAt: confirmed ? new Date(confirmed.at) : null,
    now,
  };
  const state = closed
    ? ("closed" as const)
    : confirmed
      ? changedSince(facts).length
        ? ("reopened" as const)
        : ("confirmed" as const)
      : ("open" as const);
  return { rec, admission: adm ?? null, facts, events, state };
}

/** 5.7 the Reconciliation page: newest first, with its state. */
export async function listReconciliations(db: Db, hospitalId: string, now: Date) {
  const recs = await db
    .select({ id: pharmacyReconciliations.id })
    .from(pharmacyReconciliations)
    .where(eq(pharmacyReconciliations.hospitalId, hospitalId))
    .orderBy(desc(pharmacyReconciliations.openedAt))
    .limit(100);
  // ponytail: one facts read per row (N+1, ≤ 100); batch when a hospital keeps many open at once.
  const out = await Promise.all(recs.map((r) => factsFor(db, hospitalId, r.id, now)));
  return out.filter((x) => x !== null);
}

/** The open reconciliation for an admission, if any (MR-1). */
export async function reconciliationForAdmission(db: Db, admissionId: string) {
  const [r] = await db
    .select({ id: pharmacyReconciliations.id })
    .from(pharmacyReconciliations)
    .where(eq(pharmacyReconciliations.admissionId, admissionId));
  return r?.id ?? null;
}
