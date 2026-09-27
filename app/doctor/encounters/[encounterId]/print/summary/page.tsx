import type { PrintPageProps } from "../_lib/load";
import type { Metadata } from "next";

import { formatters, withoutNameOnly } from "@/components/emr/format";
import { printable, PrintLayout } from "@/components/emr/print-layout";
import { PrintToolbar } from "@/components/emr/print-toolbar";
import {
  followUpWords,
  identityOf,
  printableAllergy,
  VisitSummaryPrint,
} from "@/components/emr/print-views";
import { includeSet, loadPrint, restrictedChoices } from "../_lib/load";

export const metadata: Metadata = { title: "Visit summary · MedSync" };
export const dynamic = "force-dynamic";

export default async function VisitSummaryPrintPage({ params, searchParams }: PrintPageProps) {
  const { encounterId } = await params;
  const include = includeSet((await searchParams).include);
  const { chart, encounter } = await loadPrint(encounterId, "emr_print_visit_summary");
  const s = chart.payload.summary;
  const tests = chart.orders
    .filter((o) => o.encounterId === encounterId)
    .map((o) => ({ id: o.id, display: o.display, restricted: o.restricted }));
  const allergyItems = s.allergies.state === "listed" ? s.allergies.items : [];
  const choices = restrictedChoices(
    [
      ...s.problems.map((p) => ({ ...p, label: p.display })),
      ...s.medicines.map((m) => ({ ...m, label: m.display })),
      ...allergyItems.map((a) => ({ ...a, label: withoutNameOnly(a.text) })),
      ...tests.map((t) => ({ ...t, label: t.display })),
    ],
    include,
  );
  return (
    <PrintLayout
      title="Visit summary"
      hospital={chart.hospitalName}
      patient={identityOf(chart.payload)}
      date={formatters(chart.timeZone).date(encounter.startedAt)}
      toolbar={<PrintToolbar withheld={choices.withheld} included={choices.included} />}
    >
      <VisitSummaryPrint
        conditions={printable(s.problems, include).kept}
        medicines={printable(s.medicines, include).kept}
        allergies={printableAllergy(s.allergies, include)}
        tests={printable(tests, include).kept}
        followUp={followUpWords(encounter.followUp, chart.timeZone)}
      />
    </PrintLayout>
  );
}
