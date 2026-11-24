import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";

import { EU_LIST } from "@/content/eu/words";
import { db } from "@/db";
import { hospitalWards } from "@/db/schema/hospital-wards";
import { requireDoctorScope } from "@/lib/doctor/scope";
import { euDoctorOnDuty } from "@/lib/eu/cover";
import { euTriageSystem } from "@/lib/eu/limit";
import { loadEuBoard } from "@/lib/eu/load";
import { loadBedBoard } from "@/lib/wards/board";
import { wardTabs } from "@/lib/wards/data";
import { euObservationLiveFor } from "@/lib/wards/feature";
import { DoctorEuBoard } from "./_components/eu-board-client";

export const metadata: Metadata = { title: "Emergency unit · Doctor · MedSync" };
export const dynamic = "force-dynamic";

/**
 * The emergency unit for a doctor (ADR 0541): the EU wards as tabs, each as the plan with states and counts.
 * Names and the tracking list only for the EU doctor on duty, from the duty rota; everyone else gets the plan
 * and the line saying so. Behind EU_OBSERVATION; off, not found.
 */
export default async function DoctorEuPage({
  searchParams,
}: {
  searchParams: Promise<{ ward?: string }>;
}) {
  const scope = await requireDoctorScope();
  if (!euObservationLiveFor(scope.hospitalId)) notFound();
  const eus = await db
    .select({ id: hospitalWards.id })
    .from(hospitalWards)
    .where(
      and(
        eq(hospitalWards.hospitalId, scope.hospitalId),
        eq(hospitalWards.wardType, "emergency_observation"),
        isNull(hospitalWards.archivedAt),
      ),
    )
    .orderBy(asc(hospitalWards.name));
  if (!eus.length) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-6 py-10">
        <h1 className="font-display text-display-s text-foreground">{EU_LIST.doctor.title}</h1>
        <p className="text-body-s text-muted-foreground">{EU_LIST.doctor.noUnits}</p>
      </div>
    );
  }
  const { ward } = await searchParams;
  const ids = eus.map((e) => e.id);
  const wardId = ward && ids.includes(ward) ? ward : ids[0]!;
  const tabs = (await wardTabs(scope.hospitalId)).filter((t) => ids.includes(t.id));

  const now = new Date();
  const onDuty = (await euDoctorOnDuty(scope.hospitalId, wardId, now)).includes(scope.userId);
  if (onDuty) {
    const d = await loadEuBoard(scope.hospitalId, wardId, {
      userId: scope.userId,
      names: true,
      surface: "doctor",
    });
    if (!d) notFound();
    return (
      <DoctorEuBoard
        key={wardId}
        data={{ ...d.board, tabs }}
        hospitalId={scope.hospitalId}
        eu={{
          data: {
            rows: d.rows,
            needsAttention: d.needsAttention,
            limitHours: d.limitHours,
            names: d.names,
          },
          nowMs: now.getTime(),
          triageSystem: await euTriageSystem(scope.hospitalId),
        }}
      />
    );
  }
  const data = await loadBedBoard(scope.hospitalId, wardId, { patients: "none", tabs });
  if (!data) notFound();
  return (
    <div className="flex h-[calc(100svh-3rem)] min-h-[640px] flex-col">
      <p className="text-body-s text-muted-foreground border-border bg-card border-b px-4 py-2">
        {EU_LIST.doctor.notOnDuty}
      </p>
      <div className="min-h-0 flex-1">
        <DoctorEuBoard key={wardId} data={data} hospitalId={scope.hospitalId} />
      </div>
    </div>
  );
}
