import "server-only";

import type { NurseScope } from "./scope";
import { and, eq, gt, gte, inArray, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { admissions } from "@/db/schema/admissions";
import { medicationAdministrationRecords, nursingAssignments } from "@/db/schema/nurse-workspace";
import { safetyIncidents } from "@/db/schema/ward-desk";
import { incidentCounts } from "@/lib/ward-desk/fold";
import { loadBedBoard } from "@/lib/wards/board";
import { wardBuilderLiveFor } from "@/lib/wards/feature";
import { DEFAULT_TIME_ZONE, startOfLocalDay } from "@/supabase/functions/_shared/slots";
import { nurseWardV2LiveFor } from "./feature";
import { loadWardNews } from "./ward-news";

/**
 * The in-charge's ward figures (ADR 0546, Phase 1), counted from the ward's own records today. A figure the build
 * cannot count yet is null and the page says so; nothing is estimated.
 */
export interface WardFigures {
  wardId: string;
  wardName: string;
  beds: { usable: number; occupied: number; arriving: number; free: number } | null;
  waitingForBed: number | null;
  admittedToday: number;
  nursesWithPatients: number;
  patients: number;
  vitals: { withDue: number; late: number };
  notGivenToday: number;
  /** This month's reported falls and pressure injuries; null before migration 0315. */
  incidents: { falls: number; pressure: number } | null;
}

export async function loadWardOverview(scope: NurseScope): Promise<WardFigures[]> {
  if (!scope.isInCharge || !nurseWardV2LiveFor(scope.hospitalId)) return [];
  const dayStart = startOfLocalDay(new Date(), DEFAULT_TIME_ZONE);
  const now = new Date();
  const current = or(isNull(nursingAssignments.endsAt), gt(nursingAssignments.endsAt, now));
  const out: WardFigures[] = [];
  for (const wardId of scope.inChargeWardIds) {
    const board = wardBuilderLiveFor(scope.hospitalId)
      ? await loadBedBoard(scope.hospitalId, wardId, { patients: "none" })
      : null;
    const assigned = await db
      .select({ nurse: nursingAssignments.nurseUserId, patient: nursingAssignments.patientUserId })
      .from(nursingAssignments)
      .where(
        and(
          eq(nursingAssignments.hospitalId, scope.hospitalId),
          eq(nursingAssignments.wardId, wardId),
          current,
        ),
      );
    const patients = [...new Set(assigned.map((a) => a.patient))];
    const [adm] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(admissions)
      .where(and(eq(admissions.wardId, wardId), gte(admissions.arrivedAt, dayStart)));
    const [ng] = patients.length
      ? await db
          .select({ n: sql<number>`count(*)::int` })
          .from(medicationAdministrationRecords)
          .where(
            and(
              eq(medicationAdministrationRecords.hospitalId, scope.hospitalId),
              inArray(medicationAdministrationRecords.patientUserId, patients),
              inArray(medicationAdministrationRecords.state, ["withheld", "refused"]),
              gte(medicationAdministrationRecords.administeredAt, dayStart),
            ),
          )
      : [{ n: 0 }];
    const news = await loadWardNews(
      { userId: scope.userId, hospitalId: scope.hospitalId },
      patients,
      now,
    );
    const due = [...news.values()].filter((n) => n.dueAt !== null);
    let incidents: WardFigures["incidents"] = null;
    try {
      const monthStart = new Date(dayStart);
      monthStart.setDate(1);
      const c = incidentCounts(
        await db
          .select({
            id: safetyIncidents.id,
            replacesId: safetyIncidents.replacesId,
            kind: safetyIncidents.kind,
            state: safetyIncidents.state,
          })
          .from(safetyIncidents)
          .where(
            and(eq(safetyIncidents.wardId, wardId), gte(safetyIncidents.occurredAt, monthStart)),
          ),
      );
      incidents = { falls: c.fall ?? 0, pressure: c.pressure_injury ?? 0 };
    } catch (e) {
      if (!(typeof e === "object" && e !== null && JSON.stringify(e).includes("42P01"))) throw e;
    }
    const count = (s: string) => board?.beds.filter((b) => b.state === s).length ?? 0;
    out.push({
      wardId,
      wardName: board?.ward.name ?? "Your ward",
      beds: board
        ? {
            usable: board.beds.length - count("out"),
            occupied: count("occupied"),
            arriving: count("arriving"),
            free: count("free"),
          }
        : null,
      waitingForBed: board ? board.waiting.length : null,
      admittedToday: adm?.n ?? 0,
      nursesWithPatients: new Set(assigned.map((a) => a.nurse)).size,
      patients: patients.length,
      vitals: { withDue: due.length, late: due.filter((n) => n.late).length },
      notGivenToday: ng?.n ?? 0,
      incidents,
    });
  }
  return out;
}
