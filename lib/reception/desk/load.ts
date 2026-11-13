import "server-only";

import type { DeskData } from "./fixture";
import type { ReceptionScope } from "@/lib/reception/scope";
import { and, asc, eq, gte, lt, ne } from "drizzle-orm";

import { db } from "@/db";
import { clinicSessions } from "@/db/schema/clinic-sessions";
import { users } from "@/db/schema/users";
import { fetchIncomingPreArrivals } from "@/lib/emergency/queries";
import { fetchHospitalIncomingIntakes, listHospitalDepartments } from "@/lib/intake/queries";
import { fetchDeclaredIntakesToday, fetchExpectedArrivals } from "@/lib/reception/queries";
import { ETA_BAND_LABEL } from "@/supabase/functions/_shared/pre-arrival";
import {
  bookingRow,
  clinicOf,
  declaredRow,
  deskSessions,
  emergencyRow,
  preAlertOf,
  sexOf,
} from "./map";
import { kampala } from "./model";

const DAY = 86_400_000;

/**
 * The live desk's data (Step 6): the same audited reads the old pages use, mapped by ./map.ts. Calendar days other
 * than today carry counts only (D-RD-27, no patient lists for other days).
 */
export async function loadDeskData(scope: ReceptionScope): Promise<DeskData> {
  const now = new Date();
  const [depts, booked, declared, inside, alerts, sess] = await Promise.all([
    listHospitalDepartments(scope.hospitalId),
    fetchExpectedArrivals({
      hospitalId: scope.hospitalId,
      receptionUserId: scope.userId,
      surface: "reception_desk",
      limit: 500,
    }),
    fetchDeclaredIntakesToday({ hospitalId: scope.hospitalId, receptionUserId: scope.userId }),
    fetchHospitalIncomingIntakes({
      hospitalId: scope.hospitalId,
      statuses: ["arrived", "awaiting_triage"],
      limit: 100,
    }),
    fetchIncomingPreArrivals({ facilityId: scope.hospitalId }),
    db
      .select({
        id: clinicSessions.id,
        departmentId: clinicSessions.departmentId,
        startsAt: clinicSessions.startsAt,
        endsAt: clinicSessions.endsAt,
        capacityTotal: clinicSessions.capacityTotal,
        bookedCount: clinicSessions.bookedCount,
        delayMinutes: clinicSessions.delayMinutes,
        clinician: users.fullName,
      })
      .from(clinicSessions)
      .leftJoin(users, eq(users.id, clinicSessions.clinicianUserId))
      .where(
        and(
          eq(clinicSessions.hospitalId, scope.hospitalId),
          ne(clinicSessions.status, "cancelled"),
          gte(clinicSessions.startsAt, new Date(now.getTime() - 42 * DAY)),
          lt(clinicSessions.startsAt, new Date(now.getTime() + 43 * DAY)),
        ),
      )
      .orderBy(asc(clinicSessions.startsAt)),
  ]);

  const clinics = depts.map(clinicOf);
  const me = { id: scope.userId, name: scope.fullName ?? "Reception" };
  return {
    hospitalId: scope.hospitalId,
    hospitalName: scope.hospitalName,
    today: kampala(now).key,
    nowIso: now.toISOString(),
    user: me,
    // ponytail: shared-desk switching lists only the signed-in user until the admin sets the desk's people (D-RD-20).
    deskUsers: [me],
    clinics,
    mine: clinics.map((c) => c.id),
    sessions: deskSessions(sess),
    rows: [
      ...inside.filter((i) => i.isEmergency).map((i) => emergencyRow(i)),
      ...booked.flatMap((b) => bookingRow(b) ?? []),
      ...declared.map(declaredRow),
    ],
    preAlerts: alerts.map((p) => preAlertOf({ ...p, etaLabel: ETA_BAND_LABEL[p.etaBand] })),
    // ponytail: people the desk can book come from today's board; wider search is the find action (Step 7 follow-up).
    directory: booked.flatMap((b) =>
      b.patientUserId && b.identity.displayName
        ? [
            {
              id: b.patientUserId,
              name: b.identity.displayName,
              sex: sexOf(b.identity.sex),
              age: b.identity.ageYears,
              phone: "",
              pno: b.patientCode ?? "",
            },
          ]
        : [],
    ),
  };
}
