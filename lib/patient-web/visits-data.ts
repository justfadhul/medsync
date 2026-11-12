import "server-only";

import { sessionTakeable } from "@patient-core/doctors";
import { dayKeyOf, partOf } from "@patient-core/visits-calendar";
import { and, asc, desc, eq, gte, inArray, lt, or } from "drizzle-orm";

import { db } from "@/db";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitals } from "@/db/schema/hospitals";
import { appointments } from "@/db/schema/scheduling";
import { users } from "@/db/schema/users";
import { fetchHousehold } from "@/lib/patient/household";
import { callEdge } from "@/lib/supabase/edge";
import { createClient } from "@/lib/supabase/server";
import { PATIENT_BOOKING_HORIZON_DAYS } from "@/supabase/functions/_shared/booking-horizon";

/**
 * Visits on the server, the phone's `loadWeek` / `loadVisit` / `moveOptions` (mobile/src/data/visits.ts): the
 * patient's own visits plus the ones they booked for a household member (the `appointments_select_agent` rule,
 * restated for the service read as lib/patient/household.ts does), the clinic days at their hospital that still
 * have a place (`clinic_sessions` under RLS), and this clinician's open slots (`pt-bookable-clinicians`). The
 * place number is never read (L8).
 */

export interface VisitRow {
  id: string;
  startsAtIso: string;
  endsAtIso: string;
  status: string;
  type: string;
  reason: string;
  clinicianName: string;
  departmentName: string;
  hospitalName: string;
  hospitalPin: { lat: number; lng: number } | null;
  hospitalId: string;
  departmentId: string;
  clinicianUserId: string;
  bookingCode: string | null;
  sessionId: string | null;
  forMember: string | null;
  confirmedByPatientAtIso: string | null;
  cancelledReason: string | null;
  quotedFeeUgx: number | null;
}

const LIMIT = 30;

async function readVisits(userId: string, past: boolean, now: Date): Promise<VisitRow[]> {
  const household = await fetchHousehold(userId).catch(() => []);
  const labels = new Map(household.map((m) => [m.provisionalPatientId, m.memberLabel]));
  const rows = await db
    .select({
      id: appointments.id,
      provisionalPatientId: appointments.provisionalPatientId,
      patientUserId: appointments.patientUserId,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      status: appointments.status,
      type: appointments.type,
      reason: appointments.reason,
      clinicianName: users.fullName,
      departmentName: hospitalDepartments.name,
      hospitalName: hospitals.name,
      lat: hospitals.latitude,
      lng: hospitals.longitude,
      hospitalId: appointments.hospitalId,
      departmentId: appointments.departmentId,
      clinicianUserId: appointments.clinicianUserId,
      bookingCode: appointments.bookingCode,
      sessionId: appointments.sessionId,
      confirmedByPatientAt: appointments.confirmedByPatientAt,
      cancelledReason: appointments.cancelledReason,
      quotedFeeUgx: appointments.quotedFeeUgx,
    })
    .from(appointments)
    .leftJoin(users, eq(users.id, appointments.clinicianUserId))
    .innerJoin(hospitalDepartments, eq(hospitalDepartments.id, appointments.departmentId))
    .innerJoin(hospitals, eq(hospitals.id, appointments.hospitalId))
    .where(
      and(
        labels.size
          ? or(
              eq(appointments.patientUserId, userId),
              and(
                eq(appointments.createdByUserId, userId),
                inArray(appointments.provisionalPatientId, [...labels.keys()]),
              ),
            )
          : eq(appointments.patientUserId, userId),
        past ? lt(appointments.startsAt, now) : gte(appointments.startsAt, now),
      ),
    )
    .orderBy(past ? desc(appointments.startsAt) : asc(appointments.startsAt))
    .limit(LIMIT);

  return rows.map((r) => ({
    id: r.id,
    startsAtIso: r.startsAt.toISOString(),
    endsAtIso: r.endsAt.toISOString(),
    status: r.status,
    type: r.type,
    reason: r.reason,
    clinicianName: r.clinicianName?.trim() || "Your clinician",
    departmentName: r.departmentName,
    hospitalName: r.hospitalName,
    hospitalPin: r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng } : null,
    hospitalId: r.hospitalId,
    departmentId: r.departmentId,
    clinicianUserId: r.clinicianUserId,
    bookingCode: r.bookingCode,
    sessionId: r.sessionId,
    // A member's visit is the patient's own when it is theirs; else it is named by the agent's label.
    forMember:
      r.patientUserId === userId ? null : (labels.get(r.provisionalPatientId ?? "") ?? null),
    confirmedByPatientAtIso: r.confirmedByPatientAt?.toISOString() ?? null,
    cancelledReason: r.cancelledReason,
    quotedFeeUgx: r.quotedFeeUgx,
  }));
}

/** Clinic days at the patient's hospital with a place left and a clinician named, as day keys. */
async function openDays(hospitalId: string | null): Promise<string[]> {
  if (!hospitalId) return [];
  const supabase = await createClient();
  const now = Date.now();
  const { data, error } = await supabase
    .from("clinic_sessions")
    .select("starts_at, clinician_user_id, capacity_booked, overbooking_factor, booked_count")
    .eq("status", "published")
    .eq("hospital_id", hospitalId)
    .gt("starts_at", new Date(now).toISOString())
    .lt("starts_at", new Date(now + PATIENT_BOOKING_HORIZON_DAYS * 86_400_000).toISOString())
    .overrideTypes<
      {
        starts_at: string;
        clinician_user_id: string | null;
        capacity_booked: number;
        overbooking_factor: number | string;
        booked_count: number;
      }[],
      { merge: false }
    >();
  if (error) return [];
  return [
    ...new Set(
      (data ?? [])
        .filter((r) =>
          sessionTakeable({
            clinicianUserId: r.clinician_user_id,
            placesLeft:
              Math.ceil(r.capacity_booked * Number(r.overbooking_factor)) - r.booked_count,
          }),
        )
        .map((r) => dayKeyOf(r.starts_at)),
    ),
  ];
}

export interface Week {
  upcoming: VisitRow[];
  past: VisitRow[];
  openDays: string[];
}

/** One instant for both halves, so no visit falls between them. */
export async function loadWeek(
  userId: string,
  hospitalId: string | null,
  now: Date,
): Promise<Week> {
  const [upcoming, past, days] = await Promise.all([
    readVisits(userId, false, now),
    readVisits(userId, true, now),
    openDays(hospitalId),
  ]);
  return { upcoming, past, openDays: days };
}

/** One visit. There is no single-row read on the phone, so both lists, as it does. */
export async function loadVisit(userId: string, id: string): Promise<VisitRow | null> {
  const now = new Date();
  const [upcoming, past] = await Promise.all([
    readVisits(userId, false, now),
    readVisits(userId, true, now),
  ]);
  return [...upcoming, ...past].find((r) => r.id === id) ?? null;
}

/** The fields of a `pt-bookable-clinicians` row a move reads. */
interface ClinicianSlots {
  userId: string;
  departmentId: string;
  slotsByDate: Record<string, { startsAtIso: string; endsAtIso: string }[]>;
}

export interface MoveOption {
  dayKey: string;
  part: "Morning" | "Afternoon";
  startsAtIso: string;
  endsAtIso: string;
}

/** Where a visit can move: this clinician's open slots in this department, from the server's own grid. */
export async function moveOptions(visit: VisitRow): Promise<MoveOption[]> {
  const res = await callEdge<{ data?: ClinicianSlots[] } | ClinicianSlots[]>(
    "pt-bookable-clinicians",
    { hospital_id: visit.hospitalId },
    "patient-web.visits",
  );
  if (!res.ok) throw new Error(res.error);
  const all = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
  const mine = all.find(
    (c) => c.userId === visit.clinicianUserId && c.departmentId === visit.departmentId,
  );
  if (!mine) return [];
  const current = new Date(visit.startsAtIso).getTime();
  return Object.keys(mine.slotsByDate)
    .sort()
    .flatMap((dayKey) =>
      (mine.slotsByDate[dayKey] ?? [])
        .filter((s) => new Date(s.startsAtIso).getTime() !== current)
        .map((s) => ({
          dayKey,
          part: partOf(s.startsAtIso),
          startsAtIso: s.startsAtIso,
          endsAtIso: s.endsAtIso,
        })),
    );
}
