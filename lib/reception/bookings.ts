import "server-only";

import { and, asc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { clinicSessions } from "@/db/schema/clinic-sessions";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { appointments } from "@/db/schema/scheduling";
import { serviceLines } from "@/db/schema/service-lines";
import { users } from "@/db/schema/users";
import { DEFAULT_TIME_ZONE, startOfLocalDay } from "@/supabase/functions/_shared/slots";

/** What the desk may still cancel (`cancel-appointment`'s CANCELLABLE_STATES). Move is narrower: no `arrived`. */
const CHANGEABLE = ["requested", "pending_approval", "confirmed", "arrived"];

export interface DeskBooking {
  id: string;
  bookingCode: string | null;
  status: string;
  reason: string;
  startsAtIso: string;
  /** A clinic-day booking's number and window; null for a timed one. */
  positionNumber: number | null;
  arrivalWindowStartIso: string | null;
  arrivalWindowEndIso: string | null;
  sessionId: string | null;
  serviceLineId: string | null;
  lineName: string | null;
  departmentId: string;
  departmentName: string | null;
  clinicianName: string | null;
  /** Null for a new caller's booking (provisional) until the desk confirms who it is. */
  patientCode: string | null;
}

/**
 * Bookings at THIS hospital from today on that can still be cancelled, by
 * booking code (exact, any case) or patient code (prefix) — the two codes the
 * desk is read out. Codes only: no name is revealed here (ADR 0473).
 */
export async function findDeskBookings(args: {
  hospitalId: string;
  query: string;
}): Promise<DeskBooking[]> {
  const q = args.query.trim();
  if (q.length < 3) return [];

  const rows = await db
    .select({
      id: appointments.id,
      bookingCode: appointments.bookingCode,
      status: appointments.status,
      reason: appointments.reason,
      startsAt: appointments.startsAt,
      positionNumber: appointments.positionNumber,
      arrivalWindowStart: appointments.arrivalWindowStart,
      arrivalWindowEnd: appointments.arrivalWindowEnd,
      sessionId: appointments.sessionId,
      serviceLineId: clinicSessions.serviceLineId,
      lineName: serviceLines.name,
      departmentId: appointments.departmentId,
      departmentName: hospitalDepartments.name,
      clinicianName: users.fullName,
      patientCode: patientProfiles.patientCode,
    })
    .from(appointments)
    .leftJoin(patientProfiles, eq(patientProfiles.id, appointments.patientUserId))
    .leftJoin(clinicSessions, eq(clinicSessions.id, appointments.sessionId))
    .leftJoin(serviceLines, eq(serviceLines.id, clinicSessions.serviceLineId))
    .leftJoin(hospitalDepartments, eq(hospitalDepartments.id, appointments.departmentId))
    .leftJoin(users, eq(users.id, appointments.clinicianUserId))
    .where(
      and(
        eq(appointments.hospitalId, args.hospitalId),
        inArray(appointments.status, CHANGEABLE),
        gte(appointments.startsAt, startOfLocalDay(new Date(), DEFAULT_TIME_ZONE)),
        or(
          sql`upper(${appointments.bookingCode}) = ${q.toUpperCase()}`,
          ilike(patientProfiles.patientCode, `${q}%`),
        ),
      ),
    )
    .orderBy(asc(appointments.startsAt), sql`${appointments.positionNumber} asc nulls last`)
    .limit(20);

  return rows.map(({ startsAt, arrivalWindowStart, arrivalWindowEnd, ...r }) => ({
    ...r,
    startsAtIso: startsAt.toISOString(),
    arrivalWindowStartIso: arrivalWindowStart?.toISOString() ?? null,
    arrivalWindowEndIso: arrivalWindowEnd?.toISOString() ?? null,
  }));
}
