import type { PrintPageProps } from "../_lib/load";
import type { Metadata } from "next";

import { formatters } from "@/components/emr/format";
import { printable, PrintLayout } from "@/components/emr/print-layout";
import { PrintToolbar } from "@/components/emr/print-toolbar";
import { identityOf, LabRequestPrint } from "@/components/emr/print-views";
import { includeSet, loadPrint, restrictedChoices } from "../_lib/load";

export const metadata: Metadata = { title: "Laboratory request · MedSync" };
export const dynamic = "force-dynamic";

const LAB_KINDS = new Set(["lab", "bloods"]);

export default async function LabRequestPrintPage({ params, searchParams }: PrintPageProps) {
  const { encounterId } = await params;
  const include = includeSet((await searchParams).include);
  const { chart, encounter } = await loadPrint(encounterId, "emr_print_lab_request");
  const orders = chart.orders.filter(
    (o) => o.encounterId === encounterId && LAB_KINDS.has(o.kind) && o.open,
  );
  const choices = restrictedChoices(
    orders.map((o) => ({ ...o, label: o.display })),
    include,
  );
  return (
    <PrintLayout
      title="Laboratory request"
      hospital={chart.hospitalName}
      patient={identityOf(chart.payload)}
      date={formatters(chart.timeZone).date(encounter.startedAt)}
      toolbar={<PrintToolbar withheld={choices.withheld} included={choices.included} />}
    >
      <LabRequestPrint orders={printable(orders, include).kept} timeZone={chart.timeZone} />
    </PrintLayout>
  );
}
