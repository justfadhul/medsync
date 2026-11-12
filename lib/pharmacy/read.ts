import "server-only";

import type { StoredAnswer } from "./checks";
import type { TimelineDrugEvent } from "./emergency-doses";
import type { ViewLineInput } from "./prescription-view";
import type { QueueEncounter, QueueFilters, QueueLine } from "./queue";
import type { EmrDb } from "@/lib/emr/db";
import type { ObservationFact } from "@/lib/facts/types";
import { and, desc, eq, gte, inArray, isNull, lt, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db as appDb } from "@/db";
import { admissions } from "@/db/schema/admissions";
import { auditLog } from "@/db/schema/audit-log";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { clinicalCosignRequests } from "@/db/schema/doctor-workspace";
import { conditions, diagnosisTerms } from "@/db/schema/emr";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { prescriptions } from "@/db/schema/prescribing";
import { cadres } from "@/db/schema/reference-data";
import { resusEpisodes, resusTimelineEvents } from "@/db/schema/resus";
import { encounters } from "@/db/schema/scheduling";
import { loadAllergyInput } from "@/lib/emr/read/allergies";
import { unitWords } from "@/lib/emr/unit-words";
import { decrypt } from "@/lib/encryption";
import { loadFactSnapshot } from "@/lib/facts/loader";
import { DEFAULT_TIME_ZONE, startOfLocalDay } from "@/supabase/functions/_shared/slots";
import { computeDoses } from "./emergency-doses";
import { computeQueue } from "./queue";

/**
 * Pharmacy Phase 0 reads (ADR 0231). Each takes the hospital from the caller's scope (never from the
 * client) and a database (the app's by default, a PGlite one in tests), reads as the owner with an
 * explicit field list (RV-7), and runs a fixed number of round trips whatever the row count. No
 * patient name is read here: the page reveals identities through identitiesFor, once per load. The
 * only write is the view log (RV-6).
 */

/**
 * The lines the pharmacy dispenses: not an emergency record, and not written at resus (prescribing kit
 * F4). A resus line was given from the cart first; the cart check restocks it (EC-1), so it never enters
 * the queue, a review or a hand-over. Every pharmacy read of prescriptions for supply uses this.
 */
export const dispensable = () =>
  and(
    eq(prescriptions.isEmergency, false),
    sql`${prescriptions.prescribePlace} IS DISTINCT FROM 'resus'`,
  )!;

const defaultDb = () => appDb as unknown as EmrDb;
/** "Medical Officer" → "Medical officer": the copy's sentence case for a cadre's name (Law 4). */
const sentence = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const DAY_MS = 86_400_000;

export type QueuePeriod = "today" | "yesterday" | "7d";
export type DosesPeriod = "today" | "7d" | "30d";

/** Hospital-local days (Africa/Kampala, no daylight saving), against the server clock (Law 9). */
export function periodRange(
  period: QueuePeriod | DosesPeriod,
  now: Date,
): { start: Date; end: Date } {
  const today = startOfLocalDay(now, DEFAULT_TIME_ZONE);
  if (period === "yesterday") return { start: new Date(today.getTime() - DAY_MS), end: today };
  if (period === "7d") return { start: new Date(today.getTime() - 6 * DAY_MS), end: now };
  if (period === "30d") return { start: new Date(today.getTime() - 29 * DAY_MS), end: now };
  return { start: today, end: now };
}

const safeDecrypt = (c: string | null) => {
  if (!c) return null;
  try {
    return decrypt(c);
  } catch {
    return null;
  }
};

/* ─── The queue ──────────────────────────────────────────────────────── */

export const lineColumns = {
  id: prescriptions.id,
  placementId: prescriptions.placementId,
  placementLine: prescriptions.placementLine,
  hospitalId: prescriptions.hospitalId,
  encounterId: prescriptions.encounterId,
  patientUserId: prescriptions.patientUserId,
  prescriberUserId: prescriptions.prescriberUserId,
  prescriberCadre: prescriptions.prescriberCadre,
  drugName: prescriptions.drugName,
  kind: prescriptions.kind,
  state: prescriptions.state,
  controlled: prescriptions.controlled,
  conditionId: prescriptions.conditionId,
  regimenId: prescriptions.regimenId,
  checkAnswers: prescriptions.checkAnswers,
  confirmedFlags: prescriptions.confirmedFlags,
  createdAt: prescriptions.createdAt,
  updatedAt: prescriptions.updatedAt,
};

interface CosignRow {
  prescriptionId: string;
  state: string;
  reviewedAt: Date | null;
  reviewedByUserId: string | null;
}

/** The newest co-sign request per prescription line. One round trip. */
export async function cosignsFor(database: EmrDb, hospitalId: string, ids: string[]) {
  if (!ids.length) return new Map<string, CosignRow>();
  const pid = sql<string>`${clinicalCosignRequests.actionPayload}->>'prescriptionId'`;
  const rows = await database
    .select({
      prescriptionId: pid,
      state: clinicalCosignRequests.state,
      reviewedAt: clinicalCosignRequests.reviewedAt,
      reviewedByUserId: clinicalCosignRequests.reviewedByUserId,
    })
    .from(clinicalCosignRequests)
    .where(
      and(
        eq(clinicalCosignRequests.hospitalId, hospitalId),
        inArray(clinicalCosignRequests.actionKind, [
          "prescription_routine",
          "prescription_controlled",
        ]),
        inArray(pid, ids),
      ),
    )
    .orderBy(desc(clinicalCosignRequests.createdAt));
  const out = new Map<string, CosignRow>();
  for (const r of rows) if (!out.has(r.prescriptionId)) out.set(r.prescriptionId, r);
  return out;
}

/** The encounters behind the lines: department, type, disposition and admission (PQ-3). One trip. */
export async function encountersFor(database: EmrDb, hospitalId: string, ids: string[]) {
  if (!ids.length) return new Map<string, QueueEncounter>();
  const rows = await database
    .select({
      id: encounters.id,
      departmentId: encounters.departmentId,
      departmentName: hospitalDepartments.name,
      encounterType: encounters.encounterType,
      disposition: encounters.disposition,
      admitted: sql<boolean>`exists (select 1 from ${admissions} a where a.source_encounter_id = ${encounters.id} and a.status <> 'cancelled')`,
    })
    .from(encounters)
    .leftJoin(hospitalDepartments, eq(hospitalDepartments.id, encounters.departmentId))
    .where(and(eq(encounters.hospitalId, hospitalId), inArray(encounters.id, ids)));
  return new Map(rows.map((r) => [r.id, { ...r, admitted: !!r.admitted }]));
}

/** Every cadre code → its name: the only title a pharmacy screen shows (Law 4). One trip. */
export async function cadreNames(database: EmrDb) {
  const rows = await database.select({ code: cadres.code, name: cadres.name }).from(cadres);
  return new Map(rows.map((r) => [r.code, sentence(r.name)]));
}

/** Each user's cadre name at this hospital (their newest affiliation there). One trip. */
export async function cadreOfUsers(database: EmrDb, hospitalId: string, userIds: string[]) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Map<string, string>();
  const rows = await database
    .select({ userId: staffAffiliations.userId, name: cadres.name })
    .from(staffAffiliations)
    .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
    .where(
      and(eq(staffAffiliations.hospitalId, hospitalId), inArray(staffAffiliations.userId, ids)),
    )
    .orderBy(desc(staffAffiliations.createdAt));
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(r.userId)) out.set(r.userId, sentence(r.name));
  return out;
}

async function queueLines(
  database: EmrDb,
  hospitalId: string,
  where: ReturnType<typeof and>,
): Promise<{
  lines: QueueLine[];
  encounters: Map<string, QueueEncounter>;
  cadres: Map<string, string>;
}> {
  const rows = await database
    .select(lineColumns)
    .from(prescriptions)
    .where(and(eq(prescriptions.hospitalId, hospitalId), dispensable(), where));
  const [cosigns, encs, names] = await Promise.all([
    cosignsFor(
      database,
      hospitalId,
      rows.map((r) => r.id),
    ),
    encountersFor(database, hospitalId, [
      ...new Set(rows.flatMap((r) => (r.encounterId ? [r.encounterId] : []))),
    ]),
    cadreNames(database),
  ]);
  const lines: QueueLine[] = rows.map((r) => ({
    ...r,
    prescriberCadre: r.prescriberCadre ? (names.get(r.prescriberCadre) ?? r.prescriberCadre) : null,
    checkAnswers: (r.checkAnswers ?? []) as StoredAnswer[],
    confirmedFlags: (r.confirmedFlags ?? []) as string[],
    cosign: cosigns.get(r.id)?.state ?? null,
  }));
  return { lines, encounters: encs, cadres: names };
}

/**
 * The stored lines and encounters of a period, for the screen to project in the browser so a lane
 * or state switch needs no request (§11). Four round trips.
 */
export async function loadQueue(
  hospitalId: string,
  period: QueuePeriod,
  database: EmrDb = defaultDb(),
) {
  const serverNow = new Date();
  const { start, end } = periodRange(period, serverNow);
  const { lines, encounters: encs } = await queueLines(
    database,
    hospitalId,
    and(gte(prescriptions.createdAt, start), lt(prescriptions.createdAt, end)),
  );
  return { lines, encounters: encs, serverNow };
}

/** The queue for a period (§5.3): every prescription written in it, as rows. Four round trips. */
export async function getPharmacyQueue(
  hospitalId: string,
  period: QueuePeriod,
  filters: QueueFilters,
  database: EmrDb = defaultDb(),
) {
  const serverNow = new Date();
  const { start, end } = periodRange(period, serverNow);
  const { lines, encounters: encs } = await queueLines(
    database,
    hospitalId,
    and(gte(prescriptions.createdAt, start), lt(prescriptions.createdAt, end)),
  );
  const queue = computeQueue({ lines, encounters: encs, hospitalId, filters });
  // The ward or clinic filter offers the places that wrote in the period.
  const places = new Map<string, string>();
  for (const e of encs.values())
    if (e.departmentId && e.departmentName) places.set(e.departmentId, e.departmentName);
  return { ...queue, places: [...places].map(([id, name]) => ({ id, name })), serverNow };
}

/** Sidebar count: prescriptions written today, All (§5.2). */
export async function countToday(hospitalId: string, database: EmrDb = defaultDb()) {
  const { total } = await getPharmacyQueue(
    hospitalId,
    "today",
    { lane: "all", state: "all", from: "all", sort: "written", desc: false },
    database,
  );
  return total;
}

/**
 * Find by patient number (§5.7, D-PH0-09): an exact patient code; that patient's prescriptions at
 * this hospital in the last 30 days, newest first. An unknown code and a code with nothing here
 * give the same empty answer. Five round trips at most.
 */
export async function findPrescriptions(
  hospitalId: string,
  patientCode: string,
  database: EmrDb = defaultDb(),
) {
  const serverNow = new Date();
  const code = patientCode.trim();
  const [patient] = code
    ? await database
        .select({ id: patientProfiles.id })
        .from(patientProfiles)
        .where(eq(patientProfiles.patientCode, code))
        .limit(1)
    : [];
  if (!patient) return { rows: [], serverNow };
  const { lines, encounters: encs } = await queueLines(
    database,
    hospitalId,
    and(
      eq(prescriptions.patientUserId, patient.id),
      gte(prescriptions.createdAt, new Date(serverNow.getTime() - 30 * DAY_MS)),
    ),
  );
  const { rows } = computeQueue({
    lines,
    encounters: encs,
    hospitalId,
    filters: { lane: "all", state: "all", from: "all", sort: "written", desc: true },
  });
  return { rows, serverNow };
}

/* ─── One prescription ───────────────────────────────────────────────── */

const TIME_KEY = /^t:([0-9a-f-]{36}|none):([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2}T[\d:.]+Z)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The rows of one placement key (PQ-1), or null for a key that is neither shape. */
export function keyFilter(key: string) {
  if (UUID.test(key)) return eq(prescriptions.placementId, key);
  const m = TIME_KEY.exec(key);
  if (!m) return null;
  return and(
    isNull(prescriptions.placementId),
    m[1] === "none" ? isNull(prescriptions.encounterId) : eq(prescriptions.encounterId, m[1]!),
    eq(prescriptions.prescriberUserId, m[2]!),
    eq(prescriptions.createdAt, new Date(m[3]!)),
  );
}

export interface PatientFacts {
  weight: { kg: number; at: string } | null;
  creatinine: { value: number; unit: string; at: string } | null;
  allergies:
    | { kind: "listed"; items: { substance: string; at: Date }[] }
    | { kind: "none_known"; at: Date }
    | { kind: "unable"; at: Date }
    | { kind: "not_recorded" };
}

/** The current weight, creatinine and allergies, each with its own date (RV-3). */
export async function patientFacts(
  patientUserId: string,
  now: Date,
  database: EmrDb = defaultDb(),
): Promise<PatientFacts> {
  const [snap, allergy] = await Promise.all([
    database.transaction((tx) =>
      loadFactSnapshot(tx, patientUserId, {
        manifest: ["obs.weight", "obs.creatinine"],
        asOf: now,
        purpose: "interactive",
      }),
    ),
    loadAllergyInput(database, patientUserId),
  ]);
  const newest = (concept: string) =>
    snap.facts.find(
      (f): f is ObservationFact =>
        f.concept === concept && f.kind === "observation" && f.value.type === "quantity",
    );
  const atOf = (f: ObservationFact) => ("at" in f.effective ? f.effective.at : f.effective.start);
  const qty = (f: ObservationFact | undefined) =>
    f && f.value.type === "quantity" ? f.value.canonical : null;
  const w = newest("obs.weight");
  const cr = newest("obs.creatinine");
  const s = allergy.status;
  return {
    weight: w && qty(w)?.unit === "kg" ? { kg: qty(w)!.value, at: atOf(w) } : null,
    creatinine:
      cr && qty(cr)
        ? { value: qty(cr)!.value, unit: unitWords(qty(cr)!.unit) ?? qty(cr)!.unit, at: atOf(cr) }
        : null,
    allergies:
      s.kind === "listed"
        ? {
            kind: "listed",
            items: s.allergies.map((a) => ({
              substance: a.allergy.substanceText ?? a.allergy.substanceCode ?? "Allergy",
              at: a.allergy.recordedAt,
            })),
          }
        : s.kind === "no_known_drug_allergies"
          ? { kind: "none_known", at: s.assertedAt }
          : s.kind === "unable_to_assess"
            ? { kind: "unable", at: s.assertedAt }
            : { kind: "not_recorded" },
  };
}

/**
 * The read list of one prescription (D-PH0-05, RV-1, RV-7): its lines as stored, each line's
 * indication, the stored answers and reasons, co-sign and state, the encounter's place and lane. Null
 * when the key is malformed or names nothing at this hospital. Five round trips.
 */
export async function getPrescription(
  hospitalId: string,
  key: string,
  database: EmrDb = defaultDb(),
) {
  const filter = keyFilter(key);
  if (!filter) return null;
  const rows = await database
    .select({
      ...lineColumns,
      concentration: prescriptions.concentration,
      dose: prescriptions.dose,
      route: prescriptions.route,
      frequency: prescriptions.frequency,
      duration: prescriptions.duration,
      quantity: prescriptions.quantity,
      method: prescriptions.method,
      infusionOver: prescriptions.infusionOver,
      diluent: prescriptions.diluent,
      prn: prescriptions.prn,
      fluidPurpose: prescriptions.fluidPurpose,
      volumeMl: prescriptions.volumeMl,
      overMinutes: prescriptions.overMinutes,
      instructionsCiphertext: prescriptions.instructionsCiphertext,
      indication: prescriptions.indication,
      edits: prescriptions.edits,
      reasonCiphertext: prescriptions.confirmReasonCiphertext,
      conditionTerm: diagnosisTerms.display,
      conditionText: conditions.textCiphertext,
    })
    .from(prescriptions)
    .leftJoin(conditions, eq(conditions.id, prescriptions.conditionId))
    .leftJoin(diagnosisTerms, eq(diagnosisTerms.id, conditions.termId))
    .where(and(eq(prescriptions.hospitalId, hospitalId), dispensable(), filter));
  if (!rows.length) return null;
  const first = rows[0]!;
  const [cosigns, encs, names] = await Promise.all([
    cosignsFor(
      database,
      hospitalId,
      rows.map((r) => r.id),
    ),
    encountersFor(database, hospitalId, first.encounterId ? [first.encounterId] : []),
    cadreNames(database),
  ]);
  const reviewers = await cadreOfUsers(
    database,
    hospitalId,
    [...cosigns.values()].flatMap((c) => (c.reviewedByUserId ? [c.reviewedByUserId] : [])),
  );
  const lines: ViewLineInput[] = rows.map((r) => {
    const c = cosigns.get(r.id);
    return {
      id: r.id,
      placementLine: r.placementLine,
      kind: r.kind,
      drugName: r.drugName,
      concentration: r.concentration,
      dose: r.dose,
      route: r.route,
      frequency: r.frequency,
      duration: r.duration,
      quantity: r.quantity,
      method: r.method,
      infusionOver: r.infusionOver,
      diluent: r.diluent,
      prn: r.prn,
      fluidPurpose: r.fluidPurpose,
      volumeMl: r.volumeMl,
      overMinutes: r.overMinutes,
      instructions: safeDecrypt(r.instructionsCiphertext),
      // D-PH0-06: a restricted problem is shown, as written; every open is logged.
      indication: r.conditionTerm ?? safeDecrypt(r.conditionText) ?? r.indication,
      conditionId: r.conditionId,
      regimenId: r.regimenId,
      edits: (r.edits ?? []) as ViewLineInput["edits"],
      controlled: r.controlled,
      state: r.state,
      cosign: c
        ? {
            state: c.state,
            reviewedAt: c.reviewedAt,
            reviewerCadre: c.reviewedByUserId ? (reviewers.get(c.reviewedByUserId) ?? null) : null,
          }
        : null,
      checkAnswers: (r.checkAnswers ?? []) as StoredAnswer[],
      confirmedFlags: (r.confirmedFlags ?? []) as string[],
      reasons: safeDecrypt(r.reasonCiphertext),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
  return {
    key,
    groupedByTime: !first.placementId,
    patientUserId: first.patientUserId,
    lines,
    encounter: first.encounterId ? encs.get(first.encounterId) : undefined,
    prescriberCadre: first.prescriberCadre
      ? (names.get(first.prescriberCadre) ?? first.prescriberCadre)
      : null,
  };
}

/**
 * RV-6: one audit row per open of a prescription — actor, placement, hospital, time — and none if
 * the same actor opened the same placement in the last minute. The only write a pharmacy user
 * causes (Law 2). Two round trips.
 */
export async function logPrescriptionViewed(
  actorId: string,
  hospitalId: string,
  key: string,
  database: EmrDb = defaultDb(),
): Promise<boolean> {
  const [recent] = await database
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.tableName, "pharmacy_prescription_view"),
        eq(auditLog.actorId, actorId),
        sql`${auditLog.afterData}->>'placement' = ${key}`,
        sql`${auditLog.timestamp} > now() - interval '1 minute'`,
      ),
    )
    .limit(1);
  if (recent) return false;
  await database.insert(auditLog).values({
    actorId,
    action: "insert",
    schemaName: "public",
    tableName: "pharmacy_prescription_view",
    recordId: key.slice(0, 120),
    afterData: { event: "pharmacy_prescription_viewed", placement: key, hospital_id: hospitalId },
  });
  return true;
}

/* ─── Emergency doses ────────────────────────────────────────────────── */

const superseding = alias(resusTimelineEvents, "superseding");

/**
 * Doses given on the resus desk at this hospital in the period, by cart (§5.5, ED-1..ED-5): every
 * `drug` event not corrected by a later one, and the cadre of each giver and witness. Two round
 * trips. Nothing from the cart stock tables is read (ED-5).
 */
export async function getEmergencyDoses(
  hospitalId: string,
  period: DosesPeriod,
  cart: string | "all",
  database: EmrDb = defaultDb(),
) {
  const serverNow = new Date();
  const { start } = periodRange(period, serverNow);
  const rows = await database
    .select({
      id: resusTimelineEvents.id,
      episodeId: resusTimelineEvents.episodeId,
      recordedAt: resusTimelineEvents.recordedAt,
      recordedByUserId: resusTimelineEvents.recordedByUserId,
      payload: resusTimelineEvents.payload,
      supersedesEventId: resusTimelineEvents.supersedesEventId,
      patientUserId: resusEpisodes.patientUserId,
      episodeStartedAt: resusEpisodes.startedAt,
    })
    .from(resusTimelineEvents)
    .innerJoin(resusEpisodes, eq(resusEpisodes.id, resusTimelineEvents.episodeId))
    .where(
      and(
        eq(resusEpisodes.hospitalId, hospitalId),
        eq(resusTimelineEvents.kind, "drug"),
        gte(resusTimelineEvents.recordedAt, start),
        notExists(
          database
            .select({ one: sql`1` })
            .from(superseding)
            .where(eq(superseding.supersedesEventId, resusTimelineEvents.id)),
        ),
      ),
    );
  const events: TimelineDrugEvent[] = rows.map((r) => ({
    ...r,
    payload: (r.payload ?? {}) as Record<string, unknown>,
  }));
  const patientOf = new Map(rows.map((r) => [r.episodeId, r.patientUserId]));
  const episodeStart = new Map(rows.map((r) => [r.episodeId, r.episodeStartedAt]));
  const result = computeDoses({ events, patientOf, cart });
  const people = await cadreOfUsers(
    database,
    hospitalId,
    result.rows.flatMap((r) => [
      ...(r.givenByUserId ? [r.givenByUserId] : []),
      ...(r.witness && r.witness !== "typed" ? [r.witness.userId] : []),
    ]),
  );
  return { ...result, cadreOf: people, episodeStart, serverNow };
}

/** Sidebar count: emergency doses in the last 7 days (§5.2). */
export async function countDoses7d(hospitalId: string, database: EmrDb = defaultDb()) {
  return (await getEmergencyDoses(hospitalId, "7d", "all", database)).total;
}
