import type { PrintPageProps } from "../_lib/load";
import type { Metadata } from "next";

import { formatters } from "@/components/emr/format";
import { printable, PrintLayout } from "@/components/emr/print-layout";
import { PrintToolbar } from "@/components/emr/print-toolbar";
import { identityOf, ReferralPrint } from "@/components/emr/print-views";
import { includeSet, loadPrint, restrictedChoices } from "../_lib/load";

export const metadata: Metadata = { title: "Referral note · MedSync" };
export const dynamic = "force-dynamic";

export default async function ReferralPrintPage({ params, searchParams }: PrintPageProps) {
  const { encounterId } = await params;
  const include = includeSet((await searchParams).include);
  const { chart, encounter } = await loadPrint(encounterId, "emr_print_referral");
  const s = chart.payload.summary;
  const choices = restrictedChoices(
    [
      ...s.problems.map((p) => ({ ...p, label: p.display })),
      ...s.results.map((r) => ({ ...r, label: r.display })),
      ...s.medicines.map((m) => ({ ...m, label: m.display })),
    ],
    include,
  );
  return (
    <PrintLayout
      title="Referral note"
      hospital={chart.hospitalName}
      patient={identityOf(chart.payload)}
      date={formatters(chart.timeZone).date(encounter.startedAt)}
      toolbar={<PrintToolbar withheld={choices.withheld} included={choices.included} />}
    >
      <ReferralPrint
        encounter={encounter}
        conditions={printable(s.problems, include).kept}
        results={printable(s.results, include).kept}
        medicines={printable(s.medicines, include).kept}
        timeZone={chart.timeZone}
      />
    </PrintLayout>
  );
}
