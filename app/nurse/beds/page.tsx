import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { mayReadEuNames } from "@/lib/eu/cover";
import { loadEuList } from "@/lib/eu/list";
import { requireNurseScope } from "@/lib/nurse/scope";
import { loadBedBoard } from "@/lib/wards/board";
import { nurseWardIds, nurseWardTabs } from "@/lib/wards/data";
import { euObservationLiveFor, wardBuilderLiveFor } from "@/lib/wards/feature";
import { NurseBoardClient } from "./board-client";

export const metadata: Metadata = { title: "Bed board · Nurse · MedSync" };
export const dynamic = "force-dynamic";

/**
 * The bed board for nurses (ADR 0194): the wards they are in charge of or assigned to, one at a time.
 * They set Free, Cleaning or Reserved, and put patients in beds or take them out; the Edge Function
 * checks each action against the ward. Behind WARD_BUILDER.
 */
export default async function NurseBedsPage({
  searchParams,
}: {
  searchParams: Promise<{ ward?: string }>;
}) {
  const scope = await requireNurseScope();
  if (!wardBuilderLiveFor(scope.hospitalId)) notFound();
  const wardIds = await nurseWardIds(scope.hospitalId, scope.userId);
  if (!wardIds.length) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-6 py-10">
        <h1 className="font-display text-display-s text-foreground">Bed board</h1>
        <p className="text-body-s text-muted-foreground">
          The bed board shows the wards you are in charge of or assigned to. You aren&rsquo;t on a
          ward right now; your nurse-in-charge assigns you to patients on a ward.
        </p>
      </div>
    );
  }
  const { ward } = await searchParams;
  const wardId = ward && wardIds.includes(ward) ? ward : wardIds[0]!;
  const tabs = await nurseWardTabs(scope.hospitalId, wardIds);
  const data = await loadBedBoard(scope.hospitalId, wardId, { patients: "names", tabs });
  if (!data) notFound();
  // An EU ward gets the tracking list (ADR 0541); the nurse is on this ward by construction.
  const eu =
    data.ward.wardType === "emergency_observation" && euObservationLiveFor(scope.hospitalId)
      ? await loadEuList(scope.hospitalId, wardId, {
          userId: scope.userId,
          names: mayReadEuNames(
            {
              admin: false,
              inChargeWardIds: scope.inChargeWardIds,
              assignedWardIds: wardIds,
              onDutyDoctor: false,
            },
            wardId,
          ),
          surface: "nurse",
        })
      : null;
  return <NurseBoardClient key={wardId} data={data} hospitalId={scope.hospitalId} eu={eu} />;
}
