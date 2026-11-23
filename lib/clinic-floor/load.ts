import "server-only";

import type { FloorClinic, FloorData, FloorPerson, Role } from "./fixture";
import type { EventKind, FloorEvent } from "./model";
import type { Reading, TriageRow } from "./trends";
import type { TriageScope } from "@/lib/triage/scope";
import type { AcuityLevel, TriageInput, TriageVitals } from "@/lib/triage/types";
import { and, asc, eq, gte, inArray, isNotNull, lt, ne, notInArray } from "drizzle-orm";

import { FLOOR } from "@/content/clinic-floor/floor";
import { db } from "@/db";
import { clinicFloorEvents } from "@/db/schema/clinic-floor";
import { clinicSessions } from "@/db/schema/clinic-sessions";
import { clinicalPhiAccessLog } from "@/db/schema/doctor-workspace";
import { encounterOrders, encounterResults } from "@/db/schema/encounter";
import { patientIntakes } from "@/db/schema/patient-intakes";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { appointments, encounters } from "@/db/schema/scheduling";
import { triageRecords } from "@/db/schema/triage";
import { users } from "@/db/schema/users";
import { computeAgeYears } from "@/lib/age";
import { signedAvatarUrl } from "@/lib/avatars";
import { fetchIncomingPreArrivals } from "@/lib/emergency/queries";
import { emrV1LiveFor } from "@/lib/emr/feature";
import { encounterEngineLive } from "@/lib/encounter/feature";
import { listClinicDepartments } from "@/lib/intake/queries";
import { logger } from "@/lib/logger";
import { clinicOf, preAlertOf, setUpClinics } from "@/lib/reception/desk/map";
import { kampala } from "@/lib/reception/desk/model";
import { createClient } from "@/lib/supabase/server";
import { runTriage } from "@/lib/triage/engine";
import { recommend } from "@/lib/triage/recommend";
import { ETA_BAND_LABEL } from "@/supabase/functions/_shared/pre-arrival";
import { engineContext, floorSex } from "./model";
import { triageReadings } from "./trends";

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
export async function loadFloorData(
  scope: TriageScope,
  { readings = true }: { readings?: boolean } = {},
): Promise<FloorData> {
  const now = new Date();
  const dayStart = new Date(Date.parse(`${kampala(now).key}T00:00:00+03:00`));
  const dayEnd = new Date(dayStart.getTime() + DAY);

  const [set, intakes, events, sess, alerts] = await Promise.all([
    listClinicDepartments(scope.hospitalId),
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
        dob: patientProfiles.dateOfBirth,
        sex: patientProfiles.sex,
      })
      .from(patientIntakes)
      .leftJoin(users, eq(users.id, patientIntakes.patientUserId))
      .leftJoin(patientProfiles, eq(patientProfiles.id, patientIntakes.patientUserId))
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
        avatar: users.avatarPath,
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

  // "Clinics today" is the clinics the admin set up, not every department (a lab section is not a clinic).
  const depts = setUpClinics(
    set.depts,
    set.lines,
    new Set(intakes.flatMap((i) => (i.dept ? [i.dept] : []))),
  );
  const ids = intakes.map((i) => i.id);
  const records = ids.length
    ? await db
        .select({
          id: triageRecords.id,
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
  // ADR 0532: each visit's encounter in MedSync's record, through its triage record (how the desk opens one).
  const encounterLive = encounterEngineLive() && emrV1LiveFor(scope.hospitalId);
  const opened =
    encounterLive && records.length
      ? await db
          .select({ id: encounters.id, tr: encounters.triageRecordId, state: encounters.state })
          .from(encounters)
          .where(
            and(
              inArray(
                encounters.triageRecordId,
                records.map((r) => r.id),
              ),
              // A planned one (assigned, not begun) is left to Start, which begins it (takePatientAction).
              inArray(encounters.state, ["in_progress", "completed"]),
            ),
          )
      : [];
  const intakeOfRecord = new Map(records.map((r) => [r.id, r.intakeId]));
  const encounterOf = new Map<string | null | undefined, { id: string; done: boolean }>();
  // An open one wins over a finished one for the same visit.
  for (const e of opened) {
    const k = intakeOfRecord.get(e.tr!);
    if (!encounterOf.has(k) || e.state === "in_progress")
      encounterOf.set(k, { id: e.id, done: e.state !== "in_progress" });
  }
  const patients = [...new Set(intakes.flatMap((r) => (r.patientUserId ? [r.patientUserId] : [])))];
  // Lab "results back" (follow-up 4): released results for today's patients at this hospital, released today.
  // Encounters carry no intake, so the match is patient + hospital + day; the model keeps only those released
  // after the visit was sent for tests. Times only: no value leaves the database here.
  const released = patients.length
    ? await db
        .select({ patientUserId: encounterOrders.patientUserId, at: encounterResults.releasedAt })
        .from(encounterResults)
        .innerJoin(encounterOrders, eq(encounterOrders.id, encounterResults.orderId))
        .where(
          and(
            eq(encounterOrders.hospitalId, scope.hospitalId),
            inArray(encounterOrders.patientUserId, patients),
            eq(encounterResults.qualityStatus, "released"),
            isNotNull(encounterResults.releasedAt),
            gte(encounterResults.releasedAt, dayStart),
          ),
        )
    : [];
  const backAt = new Map<string, number[]>();
  for (const x of released) {
    if (!x.patientUserId || !x.at) continue;
    backAt.set(x.patientUserId, [...(backAt.get(x.patientUserId) ?? []), x.at.getTime()]);
  }

  // The waiting-room screen sends codes and rooms only (S3), so it skips the readings.
  const past = await pastReadings(readings ? patients : [], {
    hospitalId: scope.hospitalId,
    dayStart: dayStart.getTime(),
  });

  // Today's doctors' own profile pictures for the triage pop-up's Send to (signed, one hour). The waiting-room
  // screen gets none (S3).
  const paths = new Map(
    sess.flatMap((s) =>
      readings && s.clinicianUserId && s.avatar ? [[s.clinicianUserId, s.avatar] as const] : [],
    ),
  );
  const photos = new Map(
    await Promise.all(
      [...paths].map(async ([id, path]) => [id, await signedAvatarUrl(path)] as const),
    ),
  );
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
      doctors: [...docs].map(([id, name]) => ({ id, name, photo: photos.get(id) ?? null })),
      // ponytail: follow-up days come from the clinic's weekdays; the booking engine checks real sessions.
      days: [1, 2, 3, 4, 5],
    };
  });

  const people: FloorPerson[] = intakes.map((r) => {
    const t = latest.get(r.id);
    const who = {
      sex: floorSex(r.sex),
      age: r.dob ? computeAgeYears(r.dob.toString(), now) : null,
    };
    const vitals = t && isVitals(t.vitals) ? t.vitals : null;
    // Pregnancy and scale 2 are not stored on triage_records: rebuilt as not known / off (owner ruling 15 Nov).
    const input: TriageInput | null = vitals
      ? { context: engineContext(who, "unknown", false), vitals }
      : null;
    const level = (t?.level ?? null) as AcuityLevel | null;
    return {
      id: r.id,
      patientUserId: r.patientUserId,
      name: r.name ?? r.unknown ?? "Unknown patient",
      sex: who.sex,
      age: who.age,
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
      readings: (r.patientUserId && past.get(r.patientUserId)) || [],
      resultsReleasedAt: (r.patientUserId && backAt.get(r.patientUserId)) || [],
      encounter: encounterOf.get(r.id) ?? null,
    };
  });

  // Owner ruling 16 Nov: the floor logs its patient reads like the nurse worklist (one row per patient shown,
  // basis department_recent). The screen (codes only) does not log.
  // The board refreshes every 10 s, so each user logs each patient once a day on this surface, not on every load.
  if (readings && patients.length) {
    try {
      const done = new Set(
        (
          await db
            .select({ id: clinicalPhiAccessLog.patientUserId })
            .from(clinicalPhiAccessLog)
            .where(
              and(
                eq(clinicalPhiAccessLog.clinicianUserId, scope.userId),
                eq(clinicalPhiAccessLog.hospitalId, scope.hospitalId),
                eq(clinicalPhiAccessLog.surface, "clinic_floor"),
                inArray(clinicalPhiAccessLog.patientUserId, patients),
                gte(clinicalPhiAccessLog.createdAt, dayStart),
              ),
            )
        ).map((x) => x.id),
      );
      const fresh = patients.filter((id) => !done.has(id));
      if (fresh.length)
        await db.insert(clinicalPhiAccessLog).values(
          fresh.map((id) => ({
            hospitalId: scope.hospitalId,
            clinicianUserId: scope.userId,
            patientUserId: id,
            accessBasis: "department_recent" as const,
            surface: "clinic_floor",
          })),
        );
    } catch (e) {
      logger.error("clinic_floor.phi_audit_failed", { reason: String(e) });
    }
  }

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
    encounterLive,
  };
}

/**
 * Every triage reading for these patients that the signed-in user may see (follow-up 3, owner ruling 16 Nov: all
 * hospitals). Read through the user's own Supabase client so RLS decides (`triage_records_select_scoped`): records
 * at a hospital where they hold an active clinical affiliation, or that they triaged themselves. No bypass.
 */
async function pastReadings(
  patientIds: string[],
  here: { hospitalId: string; dayStart: number },
): Promise<Map<string, Reading[]>> {
  const out = new Map<string, Reading[]>();
  const ids = [...new Set(patientIds)];
  if (!ids.length) return out;
  const supabase = await createClient();
  // ponytail: 50 patients a request keeps the URL short; the newest 1,000 rows each. Page further if a floor needs it.
  for (let i = 0; i < ids.length; i += 50) {
    const { data, error } = await supabase
      .from("triage_records")
      .select("patient_user_id, hospital_id, triaged_at, vitals_snapshot")
      .in("patient_user_id", ids.slice(i, i + 50))
      .order("triaged_at", { ascending: false })
      .limit(1000);
    if (error) {
      logger.error("clinic_floor.past_readings_failed", { reason: error.message });
      continue;
    }
    for (const row of data ?? []) {
      if (!row.patient_user_id || !isVitals(row.vitals_snapshot)) continue;
      const t: TriageRow = {
        at: new Date(row.triaged_at).getTime(),
        hospitalId: row.hospital_id,
        vitals: row.vitals_snapshot,
      };
      const list = out.get(row.patient_user_id) ?? [];
      list.push(...triageReadings([t], here, FLOOR.trends.source));
      out.set(row.patient_user_id, list);
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.at - b.at);
  return out;
}

function isVitals(v: unknown): v is TriageVitals {
  return !!v && typeof v === "object" && "spo2" in v && "pulse" in v;
}
