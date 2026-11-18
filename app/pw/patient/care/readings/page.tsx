import type { CardReading } from "@patient-core/care-plan";
import type { ReadingKind } from "@patient-core/readings";
import { readingsFrom } from "@patient-core/log";

import { ReadingForm } from "@/components/tide/reading-dialog";
import { PageHeader } from "@/components/tide/shell";
import { ReadingsPageWeb } from "@/components/tide/v2-readings-web";
import { CARE_V2_COPY } from "@/content/patient-app/care";
import { READINGS_COPY } from "@/content/patient/readings";
import { loadLog } from "@/lib/patient-web/day";
import { careModeOn, patientFlag } from "@/lib/patient-web/flags";
import { recentReadingsAction } from "@/lib/patient-web/reading-actions";
import { requirePatientScope } from "@/lib/patient/scope";

const KINDS: readonly ReadingKind[] = ["bp", "sugar", "pulse", "weight"];

/** Log a reading, full page (/patient/care/readings, `?kind=` preselects). The dialog shares the form. */
export default async function ReadingsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind } = await searchParams;
  const recent = await recentReadingsAction();
  // Patient app v2 (§5.7), behind appV2Web: tabs, timing, the 30-day chart, stats, the table, and Add beside it.
  if (patientFlag("appV2Web")) {
    const scope = await requirePatientScope();
    const rows = await loadLog(scope.userId, 45).catch(() => []);
    const tab = kind === "bp" || kind === "weight" ? kind : "sugar";
    return (
      <>
        <PageHeader title={CARE_V2_COPY.readingsPage.title} area="readings" />
        <ReadingsPageWeb
          readings={readingsFrom(rows) as unknown as CardReading[]}
          recent={recent}
          nowIso={new Date().toISOString()}
          initial={tab}
          careFlow={careModeOn()}
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title={READINGS_COPY.title}
        area="readings"
        back={{ href: "/patient/care", label: READINGS_COPY.backToCare }}
      />
      <div className="w-full max-w-[720px]">
        <ReadingForm
          initialKind={KINDS.find((k) => k === kind) ?? "bp"}
          recent={recent}
          sayIt={patientFlag("sayIt")}
          careFlow={careModeOn()}
        />
      </div>
    </>
  );
}
