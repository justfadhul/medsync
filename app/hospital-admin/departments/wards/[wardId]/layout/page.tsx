import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireHospitalAdminScope } from "@/lib/hospital-admin/scope";
import { loadLayoutEditor } from "@/lib/wards/data";
import { euObservationLiveFor, wardBuilderLiveFor } from "@/lib/wards/feature";
import { LayoutEditorClient } from "./layout-client";

export const metadata: Metadata = { title: "Ward layout · Hospital admin · MedSync" };
export const dynamic = "force-dynamic";

/** The ward builder (ADRs 0191–0196): a full-width page in the hospital shell, behind WARD_BUILDER. */
export default async function WardLayoutPage({ params }: { params: Promise<{ wardId: string }> }) {
  const scope = await requireHospitalAdminScope();
  if (!wardBuilderLiveFor(scope.hospitalId)) notFound();
  const { wardId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(wardId)) notFound();
  const data = await loadLayoutEditor(scope.hospitalId, wardId);
  if (!data) notFound();
  return (
    <LayoutEditorClient
      key={wardId}
      data={{ ...data, euLive: euObservationLiveFor(scope.hospitalId) }}
    />
  );
}
