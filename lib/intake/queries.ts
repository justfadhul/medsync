import "server-only";

import { and, asc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitals } from "@/db/schema/hospitals";
import { entryTypes, patientIntakes, priorityHintRank } from "@/db/schema/patient-intakes";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { DEFAULT_TIME_ZONE, startOfLocalDay } from "@/supabase/functions/_shared/slots";

/**
 * Read helpers for patient_intakes. Patient names on these surfaces
 * stay as patient_code only — the audited PHI decrypt path (doctor /
 * nurse patient-access helpers, and lib/reception/queries.ts for the
 * front desk) handles named rows.
 */

/* ─── Presence, not intent (ADR 0084 §7b) ───────────────────────── */

/**
 * When the patient was PHYSICALLY at the hospital.
 *
 * `arrived_at` is `notNull().defaultNow()` and `pt-declare-intake` inserts a
 * `declared` row without supplying it — so on a patient-declared intake
 * `arrived_at` stamps the DECLARATION, made from home. `ha-check-in-patient`
 * then flips the row to 'arrived' and stamps `checked_in_at`, leaving
 * `arrived_at` untouched. Ordering by `arrived_at` therefore ranked someone
 * who declared at 06:10 and walked in at 13:00 AHEAD of someone registered at
 * the desk at 07:30 — all day, on every board.
 *
 * `coalesce` is right for every writer of the table:
 *   - staff-created rows (`ha-register-intake`, booked check-in):
 *     `checked_in_at` IS NULL and `arrived_at` IS the physical arrival.
 *   - declared → arrived rows: `checked_in_at` is the arrival.
 *   - still-`declared` rows: no arrival exists yet, so this is the
 *     declaration — which is exactly why `declaredLast` keeps those rows out
 *     of the physical line rather than letting this timestamp place them in it.
 *
 * Read-side only: migration 0035 already ships both columns. Order by this
 * ASCENDING (longest-present first), never by `arrivedAt` directly.
 */
export const presenceAt = sql`coalesce(${patientIntakes.checkedInAt}, ${patientIntakes.arrivedAt})`;

/**
 * A Date bound beside `presenceAt`. Drizzle can type a parameter against a
 * COLUMN; against a raw expression it hands postgres.js a bare Date, which
 * the driver refuses ("Received an instance of Date") — and every reception
 * count 500'd. So the instant goes over as text with an explicit cast.
 * `tests/reception/presence-params.test.ts` holds the rule.
 */
export const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

/**
 * A `declared` row is a declaration of intent, not a position among present
 * patients (ADR 0084 §7b). Booleans sort false → true, so present rows lead
 * and declarations tail. ORDER BY this between `priorityHintRank` and
 * `presenceAt`.
 */
export const declaredLast = sql`${patientIntakes.status} = 'declared'`;

/**
 * The JS half of `presenceAt`, for projecting a selected row. Same rule, same
 * file, so the display timestamp and the sort key can never drift apart.
 */
export function presenceOf(row: { checkedInAt: Date | null; arrivedAt: Date }): Date {
  return row.checkedInAt ?? row.arrivedAt;
}

export interface IntakeRow {
  id: string;
  entryTypeCode: string;
  entryTypeName: string;
  isEmergency: boolean;
  priorityHint: string;
  status: string;
  /** PRESENCE, not declaration: `coalesce(checked_in_at, arrived_at)`.
   * On a still-`declared` row no arrival exists, so this is the declaration
   * time and the row carries `status==='declared'` to say so. Every surface
   * rendering this as a waited-for duration gets the honest number. */
  arrivedAtIso: string;
  /** True when this intake was patient-initiated via book-or-queue
   * (migration 0035). When also status='declared', the patient hasn't
   * physically arrived yet — surface a "Declared · not here yet" chip;
   * the SQL order already ranks them below present-and-waiting rows. */
  declaredByPatient: boolean;
  /** Triage acuity once assigned (migration 0036). Null = not yet
   * triaged. Drives the acuity chip + sort on staff boards. */
  triageLevel: number | null;
  patientCode: string | null;
  patientUnknownLabel: string | null;
  presentingComplaint: string | null;
  receivingDepartmentId: string | null;
  receivingDepartmentName: string | null;
  referringHospitalName: string | null;
  referringFacilityOther: string | null;
  broughtBy: string | null;
}

export async function fetchHospitalIncomingIntakes(args: {
  hospitalId: string;
  departmentId?: string | null;
  statuses?: ReadonlyArray<string>;
  limit?: number;
}): Promise<IntakeRow[]> {
  // Default widened to include 'declared' (patient-initiated, not
  // physically here yet). Callers can still override.
  const statuses = args.statuses ?? ["declared", "arrived", "awaiting_triage"];
  const conditions = [
    eq(patientIntakes.hospitalId, args.hospitalId),
    inArray(patientIntakes.status, statuses as string[]),
    // ADR 0101: the panel this feeds is titled "Awaiting triage" on every
    // home, and a patient the desk sent straight to the clinic is not. NULL
    // (every row before migration 0067) still means triage.
    or(isNull(patientIntakes.routedTo), ne(patientIntakes.routedTo, "clinic")),
  ];
  if (args.departmentId) {
    conditions.push(eq(patientIntakes.receivingDepartmentId, args.departmentId));
  }

  const rows = await db
    .select({
      id: patientIntakes.id,
      entryTypeCode: patientIntakes.entryTypeCode,
      entryTypeName: entryTypes.name,
      isEmergency: entryTypes.isEmergency,
      priorityHint: patientIntakes.priorityHint,
      status: patientIntakes.status,
      arrivedAt: patientIntakes.arrivedAt,
      checkedInAt: patientIntakes.checkedInAt,
      declaredByPatient: patientIntakes.declaredByPatient,
      triageLevel: patientIntakes.triageLevel,
      patientCode: patientProfiles.patientCode,
      patientUnknownLabel: patientIntakes.patientUnknownLabel,
      presentingComplaint: patientIntakes.presentingComplaint,
      receivingDepartmentId: patientIntakes.receivingDepartmentId,
      receivingDepartmentName: hospitalDepartments.name,
      referringHospitalName: hospitals.name,
      referringFacilityOther: patientIntakes.referringFacilityOther,
      broughtBy: patientIntakes.broughtBy,
    })
    .from(patientIntakes)
    .innerJoin(entryTypes, eq(entryTypes.code, patientIntakes.entryTypeCode))
    .leftJoin(patientProfiles, eq(patientProfiles.id, patientIntakes.patientUserId))
    .leftJoin(hospitalDepartments, eq(hospitalDepartments.id, patientIntakes.receivingDepartmentId))
    .leftJoin(hospitals, eq(hospitals.id, patientIntakes.referringHospitalId))
    .where(and(...conditions))
    // Clinical priority first (priorityHintRank ASC — a bare desc() on the
    // TEXT column sorts 'high' below 'routine'), then presence: people who
    // are physically here, longest-present first, then declarations.
    //
    // The declared-to-the-tail split used to run in JS AFTER .limit(), which
    // was the right instinct in the wrong place: it only caught rows still in
    // 'declared' (a checked-in declarer re-entered the line on its 06:00
    // declaration), and on a board with more declarations than `limit` the
    // SQL window filled with not-here-yet rows and silently dropped present
    // patients off the end. In SQL it happens before the cut.
    .orderBy(priorityHintRank, declaredLast, presenceAt)
    .limit(args.limit ?? 50);

  const mapped: IntakeRow[] = rows.map((r) => ({
    id: r.id,
    entryTypeCode: r.entryTypeCode,
    entryTypeName: r.entryTypeName,
    isEmergency: r.isEmergency,
    priorityHint: r.priorityHint,
    status: r.status,
    arrivedAtIso: presenceOf(r).toISOString(),
    declaredByPatient: r.declaredByPatient,
    triageLevel: r.triageLevel,
    patientCode: r.patientCode,
    patientUnknownLabel: r.patientUnknownLabel,
    presentingComplaint: r.presentingComplaint,
    receivingDepartmentId: r.receivingDepartmentId,
    receivingDepartmentName: r.receivingDepartmentName,
    referringHospitalName: r.referringHospitalName,
    referringFacilityOther: r.referringFacilityOther,
    broughtBy: r.broughtBy,
  }));

  return mapped;
}

export interface EntryTypeRow {
  code: string;
  name: string;
  isEmergency: boolean;
  defaultPriorityHint: string;
  requiresAppointmentLink: boolean;
  requiresReferral: boolean;
  allowsUnknownPatient: boolean;
  sortOrder: number;
}

export async function listEntryTypes(): Promise<EntryTypeRow[]> {
  const rows = await db
    .select({
      code: entryTypes.code,
      name: entryTypes.name,
      isEmergency: entryTypes.isEmergency,
      defaultPriorityHint: entryTypes.defaultPriorityHint,
      requiresAppointmentLink: entryTypes.requiresAppointmentLink,
      requiresReferral: entryTypes.requiresReferral,
      allowsUnknownPatient: entryTypes.allowsUnknownPatient,
      sortOrder: entryTypes.sortOrder,
    })
    .from(entryTypes)
    .orderBy(asc(entryTypes.sortOrder));
  return rows;
}

export async function listHospitalDepartments(
  hospitalId: string,
): Promise<Array<{ id: string; name: string }>> {
  return db
    .select({ id: hospitalDepartments.id, name: hospitalDepartments.name })
    .from(hospitalDepartments)
    .where(eq(hospitalDepartments.hospitalId, hospitalId))
    .orderBy(asc(hospitalDepartments.name));
}

export async function listActiveHospitals(): Promise<
  Array<{ id: string; name: string; level: string }>
> {
  return db
    .select({ id: hospitals.id, name: hospitals.name, level: hospitals.level })
    .from(hospitals)
    .where(eq(hospitals.state, "active"))
    .orderBy(asc(hospitals.name));
}

export async function fetchTodayIntakeCount(args: {
  hospitalId: string;
}): Promise<{ awaitingTriage: number; emergencyAwaiting: number }> {
  // The hospital's day, not the host's (UTC on Vercel — 03:00 EAT).
  const start = startOfLocalDay(new Date(), DEFAULT_TIME_ZONE);
  const rows = await db
    .select({
      isEmergency: entryTypes.isEmergency,
      status: patientIntakes.status,
    })
    .from(patientIntakes)
    .innerJoin(entryTypes, eq(entryTypes.code, patientIntakes.entryTypeCode))
    // Windowed on presence, so a patient who declared at 23:50 last night and
    // checked in at 08:00 counts against today, not yesterday.
    .where(and(eq(patientIntakes.hospitalId, args.hospitalId), gte(presenceAt, ts(start))));
  let awaiting = 0;
  let emergency = 0;
  for (const r of rows) {
    if (r.status === "awaiting_triage" || r.status === "arrived") {
      awaiting++;
      if (r.isEmergency) emergency++;
    }
  }
  return { awaitingTriage: awaiting, emergencyAwaiting: emergency };
}
