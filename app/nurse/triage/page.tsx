import type { Metadata } from "next";

import { resusDeskV2 } from "@/lib/resus/feature";
import { requireTriageScope } from "@/lib/triage/scope";
import { fetchTriageWorklist } from "@/lib/triage/worklist";
import { TriageWorklist } from "./_components/triage-worklist";

export const metadata: Metadata = {
  title: "Triage · MedSync",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * /nurse/triage — the triage worklist. Consumes the awaiting_triage
 * queue for the clinician's department; each row opens the transparent
 * triage panel. Authority (R1) is resolved in requireTriageScope and
 * passed to the panel so the override control reflects what this cadre
 * may do.
 */
export default async function TriagePage() {
  const scope = await requireTriageScope();
  const rows = await fetchTriageWorklist({
    hospitalId: scope.hospitalId,
    departmentId: scope.departmentId,
    clinicianUserId: scope.userId,
    limit: 100,
  });

  return (
    <div className="relative isolate mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-9">
      {/* Quiet atmosphere — a 4% teal glow behind the header, nothing more. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-48 bg-[radial-gradient(ellipse_at_top_left,rgba(159,47,126,0.04),transparent_60%)]"
      />
      <header className="flex flex-col gap-1.5">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
          <span aria-hidden className="bg-mint-500 ring-mint-500/20 size-1 rounded-full ring-2" />
          {scope.hospitalName} · {scope.departmentName} · Triage
        </span>
        <h1 className="font-display text-foreground sm:text-heading-l text-[24px] leading-[1.15] font-medium tracking-[-0.015em]">
          Triage worklist
        </h1>
        <p className="text-muted-foreground text-body-s max-w-2xl leading-relaxed">
          Assess each waiting patient and assign an acuity. The score is decision-support — you
          confirm or override every result, and the engine biases up when uncertain.
          {scope.authority.mayDownTriage ? null : (
            <>
              {" "}
              As a {scope.cadreName.toLowerCase()}, you may confirm or escalate; only a doctor or
              clinical officer may assign a lower acuity than computed.
            </>
          )}
        </p>
        <div className="bg-mint-500/60 dark:bg-mint-400/50 h-px w-10" aria-hidden />
      </header>

      <TriageWorklist
        rows={rows}
        departmentName={scope.departmentName}
        openResusOnArrest={resusDeskV2()}
      />
    </div>
  );
}
