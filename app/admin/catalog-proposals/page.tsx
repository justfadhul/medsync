import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getAuthState } from "@/lib/auth";
import { listPendingProposals } from "@/lib/catalog/governance";
import { encounterEngineLive } from "@/lib/encounter/feature";
import { ProposalReview } from "./_components/proposal-review";

export const metadata: Metadata = { title: "Catalog proposals · Admin · MedSync" };
export const dynamic = "force-dynamic";

/**
 * Superadmin (CSO) review of clinician-proposed symptom-catalog items. Approving
 * a symptom inserts it into the versioned catalog (the only governed path). The
 * admin layout already gates auth + AAL2; this also hard-requires superadmin.
 */
export default async function CatalogProposalsPage() {
  const state = await getAuthState();
  if (!state.user || !state.roles.includes("superadmin")) redirect("/admin");

  const proposals = encounterEngineLive() ? await listPendingProposals() : [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8 lg:py-10">
      <header className="flex flex-col gap-1.5">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
          <span aria-hidden className="bg-slate-icon ring-slate-edge size-1 rounded-full ring-2" />
          Catalog governance
        </span>
        <h1 className="font-display text-display-s text-foreground">Symptom-catalog proposals</h1>
        <p className="text-muted-foreground text-[12.5px]">
          Clinician-proposed additions to the shared catalog. Approving adds the item to the
          versioned catalog for everyone; rejecting leaves it as the clinician&rsquo;s local ad-hoc
          item only.
        </p>
      </header>

      {proposals.length === 0 ? (
        <div className="border-border bg-card/40 text-muted-foreground rounded-lg border border-dashed p-6">
          <span className="text-foreground/80 text-[14px] font-medium">Nothing to review</span>
          <p className="mt-1 text-[12px]">No pending proposals.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {proposals.map((p) => (
            <ProposalReview key={p.id} proposal={p} />
          ))}
        </ul>
      )}
    </div>
  );
}
