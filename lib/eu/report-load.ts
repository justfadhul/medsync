import "server-only";

import type { EuReport } from "./report";
import type { ReportDays, ReportWindow } from "@/lib/hospital-admin/reports";
import { and, eq, gte, lt } from "drizzle-orm";

import { db } from "@/db";
import { admissions } from "@/db/schema/admissions";
import { euStays } from "@/db/schema/eu";
import { patientIntakes } from "@/db/schema/patient-intakes";
import { reportWindow } from "@/lib/hospital-admin/reports";
import { logger } from "@/lib/logger";
import { euObservationLiveFor } from "@/lib/wards/feature";
import { euStayLimitHours } from "./limit";
import { euReport } from "./report";

/** The report and the window it was measured over, so the page can print both. */
export interface EuReportRead {
  report: EuReport;
  window: ReportWindow;
  limitHours: number;
}

/** A read that failed for any reason but a missing table: the page says so and prints no figure. */
export interface EuReportUnavailable {
  unavailable: true;
}

/** Table not there yet (0311/0313 not applied): Postgres 42P01, or PostgREST's PGRST205. */
function missingTable(e: unknown): boolean {
  const s = `${(e as { code?: string })?.code ?? ""} ${(e as { cause?: { code?: string } })?.cause?.code ?? ""} ${String(e)}`;
  return /42P01|PGRST205/.test(s);
}

/**
 * The EU indicators for the Reports page: times and an end kind only, for stays decided in the window, scoped to
 * the hospital. Null when the flag is off or the table is not applied yet. Nothing here names a patient.
 */
export async function fetchEuReport(
  hospitalId: string,
  days: ReportDays,
): Promise<EuReportRead | EuReportUnavailable | null> {
  if (!euObservationLiveFor(hospitalId)) return null;
  const window = reportWindow(days);
  try {
    const [rows, limitHours] = await Promise.all([
      db
        .select({
          hospitalArrivedAt: patientIntakes.arrivedAt,
          decidedAt: euStays.decidedAt,
          endedAt: euStays.endedAt,
          endKind: euStays.endKind,
          admissionDecidedAt: admissions.decidedAt,
        })
        .from(euStays)
        .leftJoin(patientIntakes, eq(patientIntakes.id, euStays.intakeId))
        .leftJoin(admissions, eq(admissions.id, euStays.admissionId))
        .where(
          and(
            eq(euStays.hospitalId, hospitalId),
            gte(euStays.decidedAt, window.from),
            lt(euStays.decidedAt, window.to),
          ),
        ),
      euStayLimitHours(hospitalId),
    ]);
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    const report = euReport(
      rows.map((r) => ({
        hospitalArrivedAt: iso(r.hospitalArrivedAt),
        decidedAt: r.decidedAt.toISOString(),
        endedAt: iso(r.endedAt),
        endKind: r.endKind,
        admissionDecidedAt: iso(r.admissionDecidedAt),
      })),
      window,
      limitHours,
    );
    return { report, window, limitHours };
  } catch (e) {
    // Name and code only: no row data in the log.
    const err = e as { name?: string; code?: string };
    if (missingTable(e)) {
      logger.warn("eu.report.table_missing", { name: err.name, code: err.code });
      return null;
    }
    logger.warn("eu.report.read_failed", { name: err.name, code: err.code });
    return { unavailable: true };
  }
}
