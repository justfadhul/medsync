import "server-only";

import type { FloorClinic, FloorData, FloorPerson, Role } from "./fixture";
import type { EventKind, FloorEvent } from "./model";
import type { TriageScope } from "@/lib/triage/scope";
import type { AcuityLevel, TriageInput, TriageVitals } from "@/lib/triage/types";
import { and, asc, eq, gte, inArray, lt, ne, notInArray } from "drizzle-orm";

import { db } from "@/db";
import { clinicFloorEvents } from "@/db/schema/clinic-floor";
import { clinicSessions } from "@/db/schema/clinic-sessions";
import { patientIntakes } from "@/db/schema/patient-intakes";
import { appointments } from "@/db/schema/scheduling";
import { triageRecords } from "@/db/schema/triage";
import { users } from "@/db/schema/users";
import { fetchIncomingPreArrivals } from "@/lib/emergency/queries";
import { listHospitalDepartments } from "@/lib/intake/queries";
import { clinicOf, preAlertOf } from "@/lib/reception/desk/map";
import { kampala } from "@/lib/reception/desk/model";
import { runTriage } from "@/lib/triage/engine";
import { recommend } from "@/lib/triage/recommend";
import { ETA_BAND_LABEL } from "@/supabase/functions/_shared/pre-arrival";

const DAY = 86_400_000;
const hhmm = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Kampala",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);

/**
 * The live floor's data (Step 8): today's visits at this hospital, each one's latest triage record (the engine
 * input as stored, `vitals_snapshot`), today's floor events and today's clinic sessions. Levels are the assigned
 * level on the record; the re-check band is re-derived by the engine from that input. No name goes to the logs.
 */
export async function loadFloorData(scope: TriageScope): Promise<FloorData> {
  const now = new Date();
  const dayStart = new Date(Date.parse(`${kampala(now).key}T00:00:00+03:00`));
  const dayEnd = new Date(dayStart.getTime() + DAY);

  const [depts, intakes, events, sess, alerts] = await Promise.all([
    listHospitalDepartments(scope.hospitalId),
    db
      .select({
        id: patientIntakes.id,
        patientUserId: patientIntakes.patientUserId,
        name: users.fullName,
        unknown: patientIntakes.patientUnknownLabel,
        dept: patientIntakes.receivingDepartmentId,
        complaint: patientIntakes.presentingComplaint,
        status: patientIntakes.status,
        arrivedAt: patientIntakes.arrivedAt,
        checkedInAt: patientIntakes.checkedInAt,
        routedTo: patientIntakes.routedTo,
        code: appointments.bookingCode,
      })
      .from(patientIntakes)
      .leftJoin(users, eq(users.id, patientIntakes.patientUserId))
      .leftJoin(appointments, eq(appointments.id, patientIntakes.appointmentId))
      .where(
        and(
          eq(patientIntakes.hospitalId, scope.hospitalId),
          gte(patientIntakes.arrivedAt, dayStart),
          lt(patientIntakes.arrivedAt, dayEnd),
          notInArray(patientIntakes.status, ["declared", "cancelled"]),
        ),
      )
      .orderBy(asc(patientIntakes.arrivedAt))
      .limit(500),
    db
      .select()
      .from(clinicFloorEvents)
      .where(
        and(
          eq(clinicFloorEvents.hospitalId, scope.hospitalId),
          gte(clinicFloorEvents.at, dayStart),
        ),
      )
      .orderBy(asc(clinicFloorEvents.at)),
    db
      .select({
        departmentId: clinicSessions.departmentId,
        clinicianUserId: clinicSessions.clinicianUserId,
        clinician: users.fullName,
        venue: clinicSessions.venue,
        startsAt: clinicSessions.startsAt,
        endsAt: clinicSessions.endsAt,
      })
      .from(clinicSessions)
      .leftJoin(users, eq(users.id, clinicSessions.clinicianUserId))
      .where(
        and(
          eq(clinicSessions.hospitalId, scope.hospitalId),
          ne(clinicSessions.status, "cancelled"),
          gte(clinicSessions.startsAt, dayStart),
          lt(clinicSessions.startsAt, dayEnd),
        ),
      ),
    fetchIncomingPreArrivals({ facilityId: scope.hospitalId }),
  ]);

  const ids = intakes.map((i) => i.id);
  const records = ids.length
    ? await db
        .select({
          intakeId: triageRecords.intakeId,
          vitals: triageRecords.vitalsSnapshot,
          level: triageRecords.assignedLevel,
          at: triageRecords.triagedAt,
          by: users.fullName,
        })
        .from(triageRecords)
        .leftJoin(users, eq(users.id, triageRecords.triagedByUserId))
        .where(inArray(triageRecords.intakeId, ids))
        .orderBy(asc(triageRecords.triagedAt))
    : [];
  const latest = new Map(records.map((r) => [r.intakeId, r]));

  const clinics: FloorClinic[] = depts.map((d, i) => {
    const mine = sess.filter((s) => s.departmentId === d.id);
    const docs = new Map(
      mine.flatMap((s) =>
        s.clinicianUserId ? [[s.clinicianUserId, s.clinician ?? ""] as const] : [],
      ),
    );
    const rooms = [...new Set(mine.map((s) => s.venue).filter((v): v is string => !!v))];
    const from = mine.length ? new Date(Math.min(...mine.map((s) => s.startsAt.getTime()))) : null;
    const to = mine.length ? new Date(Math.max(...mine.map((s) => s.endsAt.getTime()))) : null;
    return {
      id: d.id,
      name: d.name,
      short: d.name,
      hue: clinicOf(d, i).hue,
      room: rooms[0] ?? d.name,
      rooms: rooms.join(", "),
      hours: from && to ? `${hhmm(from)}–${hhmm(to)}` : "",
      doctors: [...docs].map(([id, name]) => ({ id, name })),
      // ponytail: follow-up days come from the clinic's weekdays; the booking engine checks real sessions.
      days: [1, 2, 3, 4, 5],
    };
  });

  const people: FloorPerson[] = intakes.map((r) => {
    const t = latest.get(r.id);
    const vitals = t && isVitals(t.vitals) ? t.vitals : null;
    const input: TriageInput | null = vitals
      ? {
          context: {
            ageYears: null,
            pregnancy: "unknown",
            reproductiveAgeFemale: false,
            spo2Scale2Enabled: false,
          },
          vitals,
        }
      : null;
    const level = (t?.level ?? null) as AcuityLevel | null;
    return {
      id: r.id,
      patientUserId: r.patientUserId,
      name: r.name ?? r.unknown ?? "Unknown patient",
      sex: null,
      age: null,
      clinic: r.dept ?? depts[0]?.id ?? "",
      doctorId: null,
      reason: r.complaint ?? "",
      own: false,
      arrivedAt: (r.checkedInAt ?? r.arrivedAt).getTime(),
      needsTriage: r.routedTo !== "clinic",
      needs: [],
      code: r.code ?? "",
      pno: "",
      triage:
        t && input && level
          ? {
              input,
              level,
              at: t.at.getTime(),
              by: t.by ?? "",
              note: "",
              recheck:
                recommend(runTriage(input), level).find((x) => x.code === "monitor_interval")
                  ?.recheck ?? null,
            }
          : null,
      history: [],
      meds: [],
      allergy: null,
      hist: [],
      readings: [],
      // ponytail: lab release (encounter_results.released_at) joins in with the lab round-trip (REPORT §9).
      resultsReleasedAt: [],
    };
  });

  const floorEvents: FloorEvent[] = events.map((e) => ({
    intakeId: e.intakeId,
    kind: e.kind as EventKind,
    detail: e.detail,
    doctorUserId: e.doctorUserId,
    departmentId: e.departmentId,
    room: e.room,
    note: e.note,
    at: e.at.getTime(),
  }));

  const role: Role = sess.some((s) => s.clinicianUserId === scope.userId) ? "doctor" : "nurse";
  const me = { id: scope.userId, name: scope.fullName ?? scope.cadreName, role };
  return {
    hospitalId: scope.hospitalId,
    hospitalName: scope.hospitalName,
    nowIso: now.toISOString(),
    user: me,
    users: [me],
    clinics,
    people,
    events: floorEvents,
    preAlerts: alerts.map((p) => {
      const a = preAlertOf({ ...p, etaLabel: ETA_BAND_LABEL[p.etaBand] });
      return { id: a.id, name: a.who || a.name, what: a.what, km: a.eta };
    }),
    fixture: false,
  };
}

function isVitals(v: unknown): v is TriageVitals {
  return !!v && typeof v === "object" && "spo2" in v && "pulse" in v;
}
