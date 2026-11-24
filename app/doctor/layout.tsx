import type { Metadata } from "next";
import type { ReactNode } from "react";

import { CriticalLive } from "@/components/medsync/critical-live";
import { TideScope } from "@/components/medsync/tide-scope";
import { ArrestAlarm } from "@/components/resus/arrest-alarm";
import { DutyChip } from "@/components/rota/duty-chip";
import { signedAvatarUrl } from "@/lib/avatars";
import { requireDoctorScope } from "@/lib/doctor/scope";
import { careRequestsLiveFor } from "@/lib/requests/feature";
import { resusDeskV2 } from "@/lib/resus/feature";
import { dutyRotaLiveFor } from "@/lib/rota/feature";
import { myDuties } from "@/lib/rota/read";
import { soft } from "@/lib/rota/soft";
import { doctorWorkspace } from "@/lib/workspace/feature";
import { newestAnnouncement } from "./_components/critical-alerts";
import { DoctorShell } from "./_components/doctor-shell";
import { myCriticals } from "./_lib/criticals";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function DoctorLayout({ children }: { children: ReactNode }) {
  const scope = await requireDoctorScope();
  const [avatarUrl, criticals, duties] = await Promise.all([
    signedAvatarUrl(scope.avatarPath),
    myCriticals(scope.userId, scope.hospitalId),
    // Rostered now (not past, not ended early); the rota is a plan, never proof of presence.
    dutyRotaLiveFor(scope.hospitalId)
      ? soft(myDuties(scope.userId, scope.hospitalId, new Date()), []).then((ds) =>
          ds.filter((d) => d.state === "in_post"),
        )
      : [],
  ]);
  return (
    <DoctorShell
      scope={scope}
      avatarUrl={avatarUrl}
      duty={duties.length ? <DutyChip duties={duties} /> : null}
      workspace={doctorWorkspace(scope.hospitalId)}
      criticalCount={criticals?.alerts.open.length ?? null}
    >
      <TideScope group="doctor">{children}</TideScope>
      {criticals || careRequestsLiveFor(scope.hospitalId) ? (
        <CriticalLive
          userId={scope.userId}
          announce={criticals ? newestAnnouncement(criticals.alerts.open) : null}
        />
      ) : null}
      {resusDeskV2() ? (
        <ArrestAlarm hospitalId={scope.hospitalId} resusBase="/doctor/resus" />
      ) : null}
    </DoctorShell>
  );
}
