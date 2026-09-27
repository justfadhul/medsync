import { FlaskConicalIcon } from "lucide-react";

import { emrV1LiveFor } from "@/lib/emr/feature";
import { labResultsLive } from "@/lib/encounter/feature";
import { requireLabTechScope } from "@/lib/lab-tech/scope";
import { loadLabWorklist, summariseWorklist, worklistAgeLabel } from "@/lib/lab-tech/worklist";
import { cn } from "@/lib/utils";
import { EmrLabWorklist } from "./_components/emr-worklist";
import { ResultRowActions } from "./_components/result-row-actions";

export const dynamic = "force-dynamic";

/**
 * Lab incoming worklist — the results-in counterpart to orders-out. Reads the
 * real `encounterOrders` pipe (hospital-scoped, oldest-first). When the lab
 * workflow is live, each row gains result entry → release/reject controls
 * (entered ≠ released); otherwise it stays read-only.
 */
export default async function LabWorklistPage() {
  const scope = await requireLabTechScope();
  // EMR v1: the record's worklist. Flag off, everything below renders exactly as before.
  if (emrV1LiveFor(scope.hospitalId)) return <EmrLabWorklist scope={scope} />;
  const items = await loadLabWorklist(scope.hospitalId);
  const summary = summariseWorklist(items);
  const live = labResultsLive();
  const now = new Date();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-display-s text-foreground inline-flex items-center gap-2">
            <FlaskConicalIcon className="text-brand-600 dark:text-brand-400 size-5" aria-hidden />
            Incoming worklist
          </h1>
          <p className="text-muted-foreground text-[12.5px]">
            Orders awaiting the lab{scope.departmentName ? ` · ${scope.departmentName}` : ""} —
            oldest first.
          </p>
        </div>
        <div className="flex items-center gap-3 font-mono text-[12px]">
          <span className="text-foreground">
            {summary.total} <span className="text-muted-foreground">total</span>
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="text-foreground">
            {summary.ordered} <span className="text-muted-foreground">ordered</span>
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="text-foreground">
            {summary.collected} <span className="text-muted-foreground">collected</span>
          </span>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="border-border bg-muted/20 text-muted-foreground text-body-s rounded-xl border border-dashed p-8 text-center">
          No orders awaiting the lab right now. New orders from clinicians appear here.
        </div>
      ) : (
        <div className="border-border bg-card overflow-hidden rounded-lg border shadow-sm">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-border text-muted-foreground border-b text-[10.5px] font-semibold tracking-wide uppercase">
                <th className="px-3 py-2 font-semibold">Patient</th>
                <th className="px-3 py-2 font-semibold">Test</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 text-right font-semibold">Waiting</th>
                {live ? <th className="px-3 py-2 text-right font-semibold">Result</th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.orderId} className="border-border/60 border-b last:border-0">
                  <td className="px-3 py-2 align-top">
                    <span className="text-foreground text-[12.5px]">
                      {it.patientName ?? "Patient"}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-foreground text-[12.5px]">{it.test}</span>
                      <span className="text-muted-foreground flex items-center gap-2 text-[10px]">
                        <span className="bg-muted rounded px-1 font-mono uppercase">{it.kind}</span>
                        {it.loincCode ? <span className="font-mono">{it.loincCode}</span> : null}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10.5px] font-medium",
                        it.hasResult
                          ? "bg-brand-100 text-brand-800 dark:bg-brand-950/40 dark:text-brand-300"
                          : it.status === "collected"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                            : "text-muted-foreground bg-muted",
                      )}
                    >
                      {it.hasResult ? "result entered" : it.status}
                    </span>
                  </td>
                  <td className="text-muted-foreground px-3 py-2 text-right align-top font-mono text-[12px]">
                    {worklistAgeLabel(it.orderedAt, now)}
                  </td>
                  {live ? (
                    <td className="px-3 py-2 align-top">
                      <ResultRowActions item={it} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-muted-foreground/80 text-[10.5px] italic">
        {live
          ? "Enter a result, then DELIBERATELY release it (entered ≠ released) or reject for recollection. No result is auto-entered; critical-value alerting activates once the critical-value list is CSO-signed."
          : "Read-only worklist from the shared orders pipe. Result entry → verify/release activates with the lab module (entered ≠ released; no result is ever auto-entered)."}
      </p>
    </div>
  );
}
