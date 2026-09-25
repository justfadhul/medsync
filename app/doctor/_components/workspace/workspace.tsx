import type { DoctorScope } from "@/lib/doctor/scope";

import { endedWord } from "@/app/nurse/resus/[episodeId]/_components/v2/close-out-words";
import { visibleLanes } from "@/lib/workspace/lanes";
import { loadWorkspace } from "@/lib/workspace/queries";
import { patientMeta, patientTitle } from "./patient-line";
import { WorkspaceBoard } from "./workspace-board";

/**
 * The workspace page's server half: one load (lib/workspace/queries.ts, a
 * fixed number of round trips), then the board. The resus board's arrest,
 * ended and openable lists ride along from the same projection — no second
 * resus read.
 */
export async function Workspace({
  scope,
  scopeMode,
}: {
  scope: DoctorScope;
  scopeMode: "mine" | "department";
}) {
  const data = await loadWorkspace({
    viewer: {
      userId: scope.userId,
      hospitalId: scope.hospitalId,
      departmentId: scope.departmentId,
      cadreCode: scope.cadreCode,
    },
    scope: scopeMode,
  });
  const { rows } = data.flow;
  const byEpisode = new Map(rows.filter((r) => r.resus).map((r) => [r.resus!.id, r.identity]));

  return (
    <WorkspaceBoard
      rows={rows}
      visibleLaneIds={visibleLanes({ mayAssign: data.mayAssign }).map((l) => l.id)}
      scope={data.scope}
      mayAssign={data.mayAssign}
      hospitalId={scope.hospitalId}
      place={`${scope.hospitalName} · ${scope.departmentName}`}
      serverNowIso={data.nowIso}
      arrests={data.board.arrest.map((a) => {
        const who = byEpisode.get(a.episodeId);
        return {
          episodeId: a.episodeId,
          title: who
            ? [patientTitle(who), patientMeta(who)].filter(Boolean).join(" · ")
            : (a.displayName ?? "Unidentified patient"),
          sinceIso: a.arrest?.sinceIso ?? null,
          leader: a.leader,
        };
      })}
      resus={{
        ended: data.board.ended.map((e) => ({
          episodeId: e.episodeId,
          title: e.displayName ?? "Unidentified patient",
          word: endedWord(e),
          endedAtIso: e.endedAtIso,
        })),
        openable: data.board.openable.map((o) => ({
          triageRecordId: o.triageRecordId,
          title: o.displayName ?? "Unidentified patient",
          reason: o.lifeThreatReason ?? "Red / Level 1",
          triagedAtIso: o.triagedAtIso,
        })),
      }}
    />
  );
}
