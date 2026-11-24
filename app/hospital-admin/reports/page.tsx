import type { Metadata } from "next";

import { fetchEuReport } from "@/lib/eu/report-load";
import { fetchPilotWeeks, PILOT_WEEKS } from "@/lib/hospital-admin/pilot";
import {
  fetchHospitalReport,
  MIN_RATE_SAMPLE,
  parseReportDays,
  REPORT_WINDOWS,
  reportWindow,
} from "@/lib/hospital-admin/reports";
import { requireHospitalAdminScope } from "@/lib/hospital-admin/scope";
import { EuAggregates } from "./_components/eu-aggregates";
import { LabAggregates } from "./_components/lab-aggregates";
import { ReportsView } from "./_components/reports-view";
import { reportView } from "./_lib/view";

export const metadata: Metadata = {
  title: "Reports · Hospital admin",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ days?: string }>;
}

/**
 * Reports (Gate H, PRD §3.4; in the Tether desk since ADR 0520 phase 2).
 *
 * Six tiles, each with its window and its denominator, and a sample floor (MIN_RATE_SAMPLE) under which a rate
 * says "too few to say" instead of a percentage. The one flag on the page, "positions not honoured", is the §3.6
 * detector and it judges a service line, never a person. The ruling that makes the page safe to show is printed
 * above the numbers, in words (content/hospital-admin/profile-reports.ts: "never a patient", "nothing in the
 * booking path reads these figures"), because the no-show figure is easy to misread.
 *
 * The window comes from `?days=`; anything outside REPORT_WINDOWS falls back to the default. Pending moved on to
 * Requests (ADR 0520): a queue to act on, not a report.
 */
export default async function ReportsPage({ searchParams }: PageProps) {
  const scope = await requireHospitalAdminScope();
  const params = await searchParams;
  const days = parseReportDays(params.days);
  const window = reportWindow(days);
  const [report, pilot, eu] = await Promise.all([
    fetchHospitalReport(scope.hospitalId, window),
    fetchPilotWeeks(scope.hospitalId),
    fetchEuReport(scope.hospitalId, days),
  ]);

  return (
    <ReportsView
      data={reportView(report, pilot.hospitals.get(scope.hospitalId), window)}
      windows={REPORT_WINDOWS}
      min={MIN_RATE_SAMPLE}
      pilotWeeks={PILOT_WEEKS}
      eu={eu ? <EuAggregates read={eu} /> : null}
      lab={<LabAggregates scope={scope} from={window.from} to={window.to} />}
    />
  );
}
