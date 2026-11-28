import type { Metadata } from "next";
import type { ReactNode } from "react";

import { WitnessInbox } from "@/app/pharmacy/_components/witness";
import { TideScope } from "@/components/medsync/tide-scope";
import { NurseWardFrame } from "@/components/nurse-ward/frame";
import { ArrestAlarm } from "@/components/resus/arrest-alarm";
import { emrV1LiveFor, nurseTasksLiveFor } from "@/lib/emr/feature";
import { labPoctQualityLiveFor } from "@/lib/lab/feature";
import { loadDeskFrame } from "@/lib/nurse/desk-frame";
import { nurseWardV2LiveFor } from "@/lib/nurse/feature";
import { requireNurseScope } from "@/lib/nurse/scope";
import { nurseHoldsWardRight } from "@/lib/nurse/ward-stock";
import { resusDeskV2 } from "@/lib/resus/feature";
import { wardBuilderLiveFor } from "@/lib/wards/feature";
import { NurseShell } from "./_components/nurse-shell";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function NurseLayout({ children }: { children: ReactNode }) {
  const scope = await requireNurseScope();
  const alarm = resusDeskV2() ? (
    <ArrestAlarm hospitalId={scope.hospitalId} resusBase="/nurse/resus" />
  ) : null;
  // ADR 0546: a hospital with the ward desk on draws every nurse page in prototype v82's desk, on both domains.
  if (nurseWardV2LiveFor(scope.hospitalId)) {
    const { todo: _todo, list: _list, ...frame } = await loadDeskFrame();
    return (
      <NurseWardFrame data={{ ...frame, nowIso: new Date().toISOString() }}>
        {children}
        <WitnessInbox />
        {alarm}
      </NurseWardFrame>
    );
  }
  return (
    <NurseShell
      scope={scope}
      flags={{
        wardBuilder: wardBuilderLiveFor(scope.hospitalId),
        poctQuality: emrV1LiveFor(scope.hospitalId) && labPoctQualityLiveFor(scope.hospitalId),
        wardStock: await nurseHoldsWardRight(scope),
        tasks: nurseTasksLiveFor(scope.hospitalId) || nurseWardV2LiveFor(scope.hospitalId),
        desk: nurseWardV2LiveFor(scope.hospitalId),
      }}
    >
      <TideScope group="nurse">{children}</TideScope>
      <WitnessInbox />
      {alarm}
    </NurseShell>
  );
}
