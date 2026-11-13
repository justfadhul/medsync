import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FloorLive } from "@/components/clinic-floor/live";
import { clinicFloorLiveFor } from "@/lib/clinic-floor/feature";
import { loadFloorData } from "@/lib/clinic-floor/load";
import { requireTriageScope } from "@/lib/triage/scope";

/**
 * The Tether clinic floor (ADR 0491): Triage, Clinic line and Floor on one surface. Behind CLINIC_FLOOR; the old
 * pages stay until parity is signed (no redirects yet). `?view=triage|line|floor` picks the first view.
 */
export const metadata: Metadata = { title: "Clinic floor", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const scope = await requireTriageScope();
  if (!clinicFloorLiveFor(scope.hospitalId)) notFound();
  const [data, sp] = await Promise.all([loadFloorData(scope), searchParams]);
  const view =
    sp.view === "triage" || sp.view === "line" || sp.view === "floor" ? sp.view : undefined;
  return <FloorLive data={data} view={view} />;
}
