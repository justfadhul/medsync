import "server-only";

import type { SQL } from "drizzle-orm";
import { and, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { clinicalPhiAccessLog } from "@/db/schema/doctor-workspace";
import { clinicalObservations } from "@/db/schema/nurse-workspace";
import { entryTypes, patientIntakes, priorityHintRank } from "@/db/schema/patient-intakes";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { triageRecords } from "@/db/schema/triage";
import { computeAgeYears } from "@/lib/age";
import { decrypt } from "@/lib/encryption";
import { presenceAt, presenceOf } from "@/lib/intake/queries";
import { logger } from "@/lib/logger";
import { DEFAULT_TIME_ZONE, startOfLocalDay } from "@/supabase/functions/_shared/slots";

/**
 * Triage worklist + trend reads.
 *
 * Patient NAMES are decrypted here on the worklist — a deliberate,
 * audited deviation from the code-only default (see ADR 0038): triage
 * is a clinical act and the nurse must identify the patient they are
 * assessing. The legitimate access basis is "the patient has an open
 * intake in the triaging clinician's department" (department_recent);
 * every reveal writes one clinical_phi_access_log row. The caller has
 * already passed requireTriageScope, so access is gated before we ever
 * decrypt.
 */

export interface TriageWorklistRow {
  intakeId: string;
  patientUserId: string | null;
  patientCode: string | null;
  patientUnknownLabel: string | null;
  /** Decrypted "First Surname" — null when the patient is unidentified
   * (emergency unknown) or decrypt is unavailable. */
  displayName: string | null;
  /** Auto-computed from the patient's date of birth (server time). */
  ageYears: number | null;
  sex: string | null;
  entryTypeName: string;
  isEmergency: boolean;
  priorityHint: string;
  presentingComplaint: string | null;
  /** PRESENCE, not declaration — `coalesce(checked_in_at, arrived_at)`. A
   * patient who declared from home at 06:10 and was checked in at 13:00 has
   * waited since 13:00, and the "waited for" chip must say so. See
   * `presenceAt` in lib/intake/queries.ts. */
  arrivedAtIso: string;
  status: string;
  /** Set once triaged — drives the "re-triage" affordance + prior chip. */
  priorLevel: number | null;
}

/** The triage queue for a department: awaiting + already-triaged (retriage). */
export async function fetchTriageWorklist(args: {
  hospitalId: string;
  departmentId?: string | null;
  /** The scoped triaging clinician — required to audit name reveals. */
  clinicianUserId: string;
  limit?: number;
}): Promise<TriageWorklistRow[]> {
  const conditions: (SQL | undefined)[] = [
    eq(patientIntakes.hospitalId, args.hospitalId),
    // Includes 'triaged' so an already-triaged patient stays visible for
    // re-triage (deterioration / correction).
    inArray(patientIntakes.status, ["arrived", "awaiting_triage", "triaged"]),
    // ADR 0101 R1: the desk sent this arrival straight to the clinic, so it
    // waits on the doctor's queue, not here. NULL is every row from before the
    // route existed — those were all sent to triage and must stay on it; a
    // bare `<> 'clinic'` would drop them, because NULL <> 'clinic' is NULL.
    or(isNull(patientIntakes.routedTo), ne(patientIntakes.routedTo, "clinic")),
  ];
  if (args.departmentId) {
    // An intake with no receiving department (a desk registration that named
    // none) belongs to no department's worklist, so it reached nobody's. Every
    // department's triage staff at the hospital see it until someone takes it.
    conditions.push(
      or(
        eq(patientIntakes.receivingDepartmentId, args.departmentId),
        isNull(patientIntakes.receivingDepartmentId),
      ),
    );
  }

  const rows = await db
    .select({
      intakeId: patientIntakes.id,
      patientUserId: patientIntakes.patientUserId,
      patientCode: patientProfiles.patientCode,
      patientUnknownLabel: patientIntakes.patientUnknownLabel,
      firstNameEncrypted: patientProfiles.firstNameEncrypted,
      surnameEncrypted: patientProfiles.surnameEncrypted,
      dateOfBirth: patientProfiles.dateOfBirth,
      sex: patientProfiles.sex,
      entryTypeName: entryTypes.name,
      isEmergency: entryTypes.isEmergency,
      priorityHint: patientIntakes.priorityHint,
      presentingComplaint: patientIntakes.presentingComplaint,
      arrivedAt: patientIntakes.arrivedAt,
      checkedInAt: patientIntakes.checkedInAt,
      status: patientIntakes.status,
      triageLevel: patientIntakes.triageLevel,
    })
    .from(patientIntakes)
    .innerJoin(entryTypes, eq(entryTypes.code, patientIntakes.entryTypeCode))
    .leftJoin(patientProfiles, eq(patientProfiles.id, patientIntakes.patientUserId))
    .where(and(...conditions))
    // Un-triaged first (they NEED assessment): `triage_level IS NOT NULL`
    // sorts false→true, so nulls (un-triaged) lead. Within each group:
    // higher priority hint, then longest-present.
    //
    // `priorityHintRank` ASC, never `desc(priorityHint)` — the column is TEXT
    // and a descending collation puts 'high' below 'routine'. See the helper.
    //
    // `presenceAt`, never `arrivedAt` — on a patient-declared intake
    // `arrived_at` holds the DECLARATION, so a 06:10 declarer who walked in at
    // 13:00 outranked an 07:30 desk registration all day. No 'declared' row
    // reaches this worklist (the status filter above excludes them), so the
    // declared/present split isn't needed here — only the timestamp is.
    .orderBy(sql`${patientIntakes.triageLevel} IS NOT NULL`, priorityHintRank, presenceAt)
    .limit(args.limit ?? 100);

  const now = new Date();
  const mapped = rows.map((r) => {
    let displayName: string | null = null;
    if (r.patientUserId && r.firstNameEncrypted && r.surnameEncrypted) {
      try {
        displayName = `${decrypt(r.firstNameEncrypted)} ${decrypt(r.surnameEncrypted)}`.trim();
      } catch (e) {
        logger.warn("triage.worklist.decrypt_failed", { reason: String(e) });
        displayName = null;
      }
    }
    return {
      intakeId: r.intakeId,
      patientUserId: r.patientUserId,
      patientCode: r.patientCode,
      patientUnknownLabel: r.patientUnknownLabel,
      displayName,
      ageYears: r.dateOfBirth ? computeAgeYears(r.dateOfBirth.toString(), now) : null,
      sex: r.sex,
      entryTypeName: r.entryTypeName,
      isEmergency: r.isEmergency,
      priorityHint: r.priorityHint,
      presentingComplaint: r.presentingComplaint,
      arrivedAtIso: presenceOf(r).toISOString(),
      status: r.status,
      priorLevel: r.triageLevel,
    };
  });

  // Audit every name reveal — one clinical_phi_access_log row per
  // identified patient shown, basis 'department_recent', surface
  // 'triage_worklist'. Best-effort (a failed audit must not crash the
  // worklist, but is logged loudly).
  const revealed = mapped.filter((r) => r.displayName && r.patientUserId);
  if (revealed.length > 0) {
    try {
      await db.insert(clinicalPhiAccessLog).values(
        revealed.map((r) => ({
          hospitalId: args.hospitalId,
          clinicianUserId: args.clinicianUserId,
          patientUserId: r.patientUserId!,
          accessBasis: "department_recent" as const,
          surface: "triage_worklist",
        })),
      );
    } catch (e) {
      logger.error("triage.worklist.phi_audit_failed", { reason: String(e) });
    }
  }

  return mapped;
}

/**
 * One intake row for the full-page triage desk (/nurse/triage/[intakeId]).
 * Same shape + audited name-reveal as the worklist, scoped to a single
 * intake in the clinician's hospital. Returns null if not found / not in
 * scope so the page can notFound() rather than leak existence.
 */
export async function fetchTriageWorklistRow(args: {
  intakeId: string;
  hospitalId: string;
  clinicianUserId: string;
}): Promise<TriageWorklistRow | null> {
  const rows = await db
    .select({
      intakeId: patientIntakes.id,
      patientUserId: patientIntakes.patientUserId,
      patientCode: patientProfiles.patientCode,
      patientUnknownLabel: patientIntakes.patientUnknownLabel,
      firstNameEncrypted: patientProfiles.firstNameEncrypted,
      surnameEncrypted: patientProfiles.surnameEncrypted,
      dateOfBirth: patientProfiles.dateOfBirth,
      sex: patientProfiles.sex,
      entryTypeName: entryTypes.name,
      isEmergency: entryTypes.isEmergency,
      priorityHint: patientIntakes.priorityHint,
      presentingComplaint: patientIntakes.presentingComplaint,
      arrivedAt: patientIntakes.arrivedAt,
      checkedInAt: patientIntakes.checkedInAt,
      status: patientIntakes.status,
      triageLevel: patientIntakes.triageLevel,
    })
    .from(patientIntakes)
    .innerJoin(entryTypes, eq(entryTypes.code, patientIntakes.entryTypeCode))
    .leftJoin(patientProfiles, eq(patientProfiles.id, patientIntakes.patientUserId))
    .where(
      and(eq(patientIntakes.id, args.intakeId), eq(patientIntakes.hospitalId, args.hospitalId)),
    )
    .limit(1);

  const r = rows[0];
  if (!r) return null;

  let displayName: string | null = null;
  if (r.patientUserId && r.firstNameEncrypted && r.surnameEncrypted) {
    try {
      displayName = `${decrypt(r.firstNameEncrypted)} ${decrypt(r.surnameEncrypted)}`.trim();
    } catch (e) {
      logger.warn("triage.desk.decrypt_failed", { reason: String(e) });
      displayName = null;
    }
  }

  // Audit the name reveal (one row, basis department_recent, surface triage_desk).
  if (displayName && r.patientUserId) {
    try {
      await db.insert(clinicalPhiAccessLog).values({
        hospitalId: args.hospitalId,
        clinicianUserId: args.clinicianUserId,
        patientUserId: r.patientUserId,
        accessBasis: "department_recent" as const,
        surface: "triage_desk",
      });
    } catch (e) {
      logger.error("triage.desk.phi_audit_failed", { reason: String(e) });
    }
  }

  const now = new Date();
  return {
    intakeId: r.intakeId,
    patientUserId: r.patientUserId,
    patientCode: r.patientCode,
    patientUnknownLabel: r.patientUnknownLabel,
    displayName,
    ageYears: r.dateOfBirth ? computeAgeYears(r.dateOfBirth.toString(), now) : null,
    sex: r.sex,
    entryTypeName: r.entryTypeName,
    isEmergency: r.isEmergency,
    priorityHint: r.priorityHint,
    presentingComplaint: r.presentingComplaint,
    arrivedAtIso: presenceOf(r).toISOString(),
    status: r.status,
    priorLevel: r.triageLevel,
  };
}

export interface RecentVital {
  kind: string;
  value1: number | null;
  value2: number | null;
  unit: string | null;
  recordedAtIso: string;
}

/**
 * The patient's recent clinician-recorded observations (last 14 days),
 * for the trend view + auto-populating the triage vital set.
 */
export async function fetchRecentVitals(args: {
  patientUserId: string;
  limit?: number;
}): Promise<RecentVital[]> {
  const since = new Date();
  since.setDate(since.getDate() - 14);

  const rows = await db
    .select({
      kind: clinicalObservations.observationKind,
      value1: clinicalObservations.numericValue1,
      value2: clinicalObservations.numericValue2,
      unit: clinicalObservations.unit,
      recordedAt: clinicalObservations.recordedAt,
    })
    .from(clinicalObservations)
    .where(
      and(
        eq(clinicalObservations.patientUserId, args.patientUserId),
        eq(clinicalObservations.state, "active"),
        gte(clinicalObservations.recordedAt, since),
      ),
    )
    .orderBy(desc(clinicalObservations.recordedAt))
    .limit(args.limit ?? 200);

  return rows.map((r) => ({
    kind: r.kind,
    value1: r.value1 === null ? null : Number(r.value1),
    value2: r.value2 === null ? null : Number(r.value2),
    unit: r.unit,
    recordedAtIso: r.recordedAt.toISOString(),
  }));
}

/* ─── Aggregate triage metrics (admin snippet, §4) ──────────────── */

export interface TriageMetrics {
  total: number;
  byLevel: Record<1 | 2 | 3 | 4 | 5, number>;
  overrides: number;
  baselineAdjustments: number;
}

export async function fetchTriageMetricsToday(args: {
  hospitalId: string;
}): Promise<TriageMetrics> {
  // The hospital's day, not the host's (UTC on Vercel — 03:00 EAT).
  const start = startOfLocalDay(new Date(), DEFAULT_TIME_ZONE);

  const rows = await db
    .select({
      assignedLevel: triageRecords.assignedLevel,
      overrideDirection: triageRecords.overrideDirection,
      baselineAdjusted: triageRecords.baselineAdjusted,
    })
    .from(triageRecords)
    .where(and(eq(triageRecords.hospitalId, args.hospitalId), gte(triageRecords.triagedAt, start)));

  const byLevel: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let overrides = 0;
  let baselineAdjustments = 0;
  for (const r of rows) {
    const lvl = r.assignedLevel as 1 | 2 | 3 | 4 | 5;
    if (lvl >= 1 && lvl <= 5) byLevel[lvl]++;
    if (r.overrideDirection !== "none") overrides++;
    if (r.baselineAdjusted) baselineAdjustments++;
  }
  return { total: rows.length, byLevel, overrides, baselineAdjustments };
}

/** The most-recent prior triage level for a patient (trend input). */
export async function fetchPriorTriageLevel(args: {
  patientUserId: string;
  beforeIso?: string;
}): Promise<number | null> {
  const before = args.beforeIso ? new Date(args.beforeIso) : new Date();
  const rows = await db
    .select({ level: triageRecords.assignedLevel, at: triageRecords.triagedAt })
    .from(triageRecords)
    .where(
      and(eq(triageRecords.patientUserId, args.patientUserId), lt(triageRecords.triagedAt, before)),
    )
    .orderBy(desc(triageRecords.triagedAt))
    .limit(1);
  return rows[0]?.level ?? null;
}
