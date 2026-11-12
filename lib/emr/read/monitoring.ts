import "server-only";

import type { MarRowIn, VitalKey, VitalReading } from "@/lib/emr/charts/build";
import type { MonitoringPayload } from "@/lib/emr/charts/payload";
import type { EmrTx } from "@/lib/emr/db";
import type { ClinicalFact, ObservationFact } from "@/lib/facts/types";
import type { Acvpu } from "@/lib/triage/types";
import { and, eq, inArray } from "drizzle-orm";

import { fluidBalanceEntries, monitoringCharts } from "@/db/schema/monitoring";
import { medicationAdministrationRecords } from "@/db/schema/nurse-workspace";
import { prescriptions } from "@/db/schema/prescribing";
import { encounters } from "@/db/schema/scheduling";
import { buildMonitoringPayload, liveDoses } from "@/lib/emr/charts/build";
import { loadFactSnapshot } from "@/lib/facts/loader";

/**
 * The visit's monitoring charts (ADR 0189, MONITORING-CHARTS.md §5), read under the clinical
 * reader (RLS decides what exists) and shaped by lib/emr/charts/build.ts:
 *
 *  - monitoring_charts for the encounter, and its fluid_balance_entries;
 *  - the visit's prescriptions from the plan (not resus emergency doses) and their MAR rows, joined
 *    by medication_administration_records.emr_prescription_id (under RLS: 0089 gives the clinical reader its policy);
 *  - vital signs through the fact loader (observation sets, legacy rows and the triage snapshot in
 *    one shape): the rows of this encounter, rows with no encounter taken during it, and its triage
 *    record. The triage record, and anything recorded before the plan opened a chart, is the
 *    clerking origin; later entries are nursing;
 *  - the latest weight in the vitals, whenever it was taken (ADR 0188).
 *
 * Returns null when the encounter is not this patient's at this hospital (or RLS hides it).
 */

const VITAL_CONCEPT: Readonly<Record<string, VitalKey>> = {
  "obs.resp_rate": "rr",
  "obs.spo2": "spo2",
  "obs.bp_systolic": "sbp",
  "obs.heart_rate": "pulse",
  "obs.temperature": "temp",
  "obs.avpu": "acvpu",
  "obs.glucose": "glucose",
};
const AVPU_TO_ACVPU: Readonly<Record<string, Acvpu>> = {
  alert: "A",
  new_confusion: "C",
  voice: "V",
  pain: "P",
  unresponsive: "U",
};
const ACVPU = new Set<string>(["A", "C", "V", "P", "U"]);
/** A value from a laboratory specimen is a result, not a bedside glucose. */
const LAB_SPECIMENS = new Set([
  "venous_plasma",
  "venous_serum",
  "venous_whole_blood",
  "arterial_blood",
]);
/** Enough for a week of hourly sets per concept. */
const PER_CONCEPT_CAP = 200;

const factAt = (f: ClinicalFact) =>
  new Date("at" in f.effective ? f.effective.at : f.effective.start);
const str = (v: unknown) => (typeof v === "string" ? v : null);

function toReading(f: ObservationFact, key: VitalKey): VitalReading | null {
  const q = (f.context.qualifiers ?? {}) as Record<string, unknown>;
  const at = factAt(f);
  const triage = f.provenance.table === "triage_records";
  const setKey =
    f.context.readingSetId ??
    (triage ? `triage:${f.provenance.rowId}` : `${f.provenance.table}:${at.toISOString()}`);
  const acvpuQ = str(q.acvpu);
  const acvpu =
    key === "acvpu" && f.value.type === "coded"
      ? (AVPU_TO_ACVPU[f.value.code] ?? null)
      : acvpuQ && ACVPU.has(acvpuQ)
        ? (acvpuQ as Acvpu)
        : null;
  let value: number | null = null;
  if (key !== "acvpu") {
    if (f.value.type !== "quantity") return null;
    value = f.value.canonical.value;
  } else if (!acvpu) return null;
  if (key === "glucose" && (f.source === "lab" || LAB_SPECIMENS.has(f.context.specimen ?? "")))
    return null;
  const oxygen = str(q.oxygenSupport);
  return {
    id: f.id,
    key,
    value,
    acvpu,
    at,
    setKey,
    fromTriage: triage,
    site: key === "temp" ? str(q.site) : null,
    oxygen: oxygen === "supplemental_oxygen" ? "oxygen" : oxygen === "room_air" ? "air" : null,
    spo2Scale: str(q.spo2Scale) === "scale2" ? "scale2" : "scale1",
  };
}

/** "58 kg · 23:10 · triage": where the weight came from, in a word. */
function weightSource(f: ObservationFact): string {
  const q = (f.context.qualifiers ?? {}) as Record<string, unknown>;
  if (f.provenance.table === "triage_records") return "triage";
  if (f.context.measurement === "reported" || q.measurement === "reported") return "stated";
  if (f.source === "poc_staff") return "nursing";
  if (f.source === "clinician") return "clerking";
  return "vitals";
}

export async function loadMonitoring(
  tx: EmrTx,
  i: { hospitalId: string; patientUserId: string; encounterId: string; now: Date },
): Promise<MonitoringPayload | null> {
  const [encounter] = await tx
    .select({
      startedAt: encounters.startedAt,
      endedAt: encounters.endedAt,
      triageRecordId: encounters.triageRecordId,
    })
    .from(encounters)
    .where(
      and(
        eq(encounters.id, i.encounterId),
        eq(encounters.patientUserId, i.patientUserId),
        eq(encounters.hospitalId, i.hospitalId),
      ),
    );
  if (!encounter) return null;

  const charts = await tx
    .select()
    .from(monitoringCharts)
    .where(
      and(
        eq(monitoringCharts.encounterId, i.encounterId),
        eq(monitoringCharts.patientUserId, i.patientUserId),
        eq(monitoringCharts.hospitalId, i.hospitalId),
      ),
    );
  if (charts.length === 0)
    return buildMonitoringPayload({
      charts: [],
      fluidEntries: [],
      prescriptions: [],
      mar: [],
      vitals: [],
      weight: null,
      now: i.now,
    });
  const kinds = new Set(charts.map((c) => c.kind));

  const fluidEntries = kinds.has("fluid_balance")
    ? await tx
        .select()
        .from(fluidBalanceEntries)
        .where(
          and(
            eq(fluidBalanceEntries.encounterId, i.encounterId),
            eq(fluidBalanceEntries.patientUserId, i.patientUserId),
          ),
        )
    : [];
  const rx = await tx
    .select()
    .from(prescriptions)
    .where(
      and(
        eq(prescriptions.encounterId, i.encounterId),
        eq(prescriptions.patientUserId, i.patientUserId),
        eq(prescriptions.hospitalId, i.hospitalId),
        eq(prescriptions.isEmergency, false),
      ),
    );
  const mar: MarRowIn[] =
    kinds.has("mar") && rx.length
      ? liveDoses(
          await tx
            .select({
              id: medicationAdministrationRecords.id,
              prescriptionId: medicationAdministrationRecords.emrPrescriptionId,
              state: medicationAdministrationRecords.state,
              withheldReason: medicationAdministrationRecords.withheldReason,
              scheduledFor: medicationAdministrationRecords.scheduledFor,
              administeredAt: medicationAdministrationRecords.administeredAt,
              isHighAlert: medicationAdministrationRecords.isHighAlert,
              cosignedByUserId: medicationAdministrationRecords.cosignedByUserId,
              reversesId: medicationAdministrationRecords.reversesId,
            })
            .from(medicationAdministrationRecords)
            .where(
              and(
                inArray(
                  medicationAdministrationRecords.emrPrescriptionId,
                  rx.map((r) => r.id),
                ),
                eq(medicationAdministrationRecords.patientUserId, i.patientUserId),
                eq(medicationAdministrationRecords.hospitalId, i.hospitalId),
              ),
            ),
        ).flatMap((m) => (m.prescriptionId ? [{ ...m, prescriptionId: m.prescriptionId }] : []))
      : [];

  // Vital signs and the weight, as facts (current versions; entered in error dropped).
  const snapshot = await loadFactSnapshot(tx, i.patientUserId, {
    manifest: [...Object.keys(VITAL_CONCEPT), "obs.weight"],
    asOf: i.now,
    purpose: "interactive",
    perConceptCap: PER_CONCEPT_CAP,
  });
  const from = encounter.startedAt.getTime();
  const to = (encounter.endedAt ?? i.now).getTime();
  const inVisit = (f: ObservationFact) => {
    if (f.provenance.encounterId) return f.provenance.encounterId === i.encounterId;
    if (f.provenance.table === "triage_records" && f.provenance.rowId === encounter.triageRecordId)
      return true;
    const t = factAt(f).getTime();
    return t >= from && t <= to;
  };
  const observations = snapshot.facts.filter((f): f is ObservationFact => f.kind === "observation");
  const vitals = observations.flatMap((f) => {
    const key = VITAL_CONCEPT[f.concept];
    if (!key || !inVisit(f)) return [];
    const r = toReading(f, key);
    return r ? [r] : [];
  });
  // Facts come newest first within a concept.
  const w = observations.find((f) => f.concept === "obs.weight");
  const weight =
    w && w.value.type === "quantity" && w.value.canonical.unit === "kg"
      ? { kg: w.value.canonical.value, at: factAt(w), source: weightSource(w) }
      : null;

  return buildMonitoringPayload({
    charts,
    fluidEntries,
    prescriptions: rx,
    mar,
    vitals,
    weight,
    now: i.now,
  });
}
