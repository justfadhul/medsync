import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { mayReadEuNames } from "@/lib/eu/cover";
import { loadEuList } from "@/lib/eu/list";
import { requireHospitalAdminScope } from "@/lib/hospital-admin/scope";
import { loadBedBoard } from "@/lib/wards/board";
import { wardBuilderLiveFor } from "@/lib/wards/feature";
import { BoardClient } from "./board-client";

export const metadata: Metadata = { title: "Bed board · Hospital admin · MedSync" };
export const dynamic = "force-dynamic";

/**
 * The live bed board for the hospital admin (ADR 0194): the published plan with every bed's state.
 * Patients show by MRN only, as on the admin's other surfaces; the EU list alone shows names (D10). Behind WARD_BUILDER.
 */
export default async function WardBoardPage({ params }: { params: Promise<{ wardId: string }> }) {
  const scope = await requireHospitalAdminScope();
  if (!wardBuilderLiveFor(scope.hospitalId)) notFound();
  const { wardId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(wardId)) notFound();
  const euRead = await loadEuList(
    scope.hospitalId,
    wardId,
    {
      userId: scope.userId,
      names: mayReadEuNames(
        { admin: true, inChargeWardIds: [], assignedWardIds: [], onDutyDoctor: false },
        wardId,
      ),
      surface: "admin",
    },
    { patients: "mrn" },
  );
  const data = euRead?.board ?? (await loadBedBoard(scope.hospitalId, wardId, { patients: "mrn" }));
  if (!data) notFound();
  const eu = euRead?.eu ?? null;
  return <BoardClient key={wardId} data={data} hospitalId={scope.hospitalId} eu={eu} />;
}
