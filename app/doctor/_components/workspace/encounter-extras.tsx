import type { DoctorScope } from "@/lib/doctor/scope";

import { loadWorkspace } from "@/lib/workspace/queries";
import { AcuityChip } from "./acuity-chip";
import { NextPatientBar, RailPanel } from "./encounter-rail";
import { patientMeta, patientTitle } from "./patient-line";

const viewerOf = (scope: DoctorScope) => ({
  userId: scope.userId,
  hospitalId: scope.hospitalId,
  departmentId: scope.departmentId,
  cadreCode: scope.cadreCode,
});

/**
 * The clerking page's left rail (§5.4): Waiting for you and In progress, so
 * the doctor can move between patients without going back to the board. Only
 * those two lanes are read and revealed. Streams in beside the clerking — it
 * never holds the page.
 */
export async function EncounterRail({
  scope,
  currentEncounterId,
}: {
  scope: DoctorScope;
  currentEncounterId: string;
}) {
  const { flow, nowIso } = await loadWorkspace({
    viewer: viewerOf(scope),
    scope: "mine",
    lanes: ["waiting", "in_progress"],
  });
  return (
    <RailPanel rows={flow.rows} currentEncounterId={currentEncounterId} serverNowIso={nowIso} />
  );
}

/**
 * After End visit (§5.4): the next patient waiting for you, one tap from
 * started. Nothing is shown when no one is waiting.
 */
export async function NextPatient({ scope }: { scope: DoctorScope }) {
  const { flow } = await loadWorkspace({
    viewer: viewerOf(scope),
    scope: "mine",
    lanes: ["waiting"],
  });
  const next = flow.rows.find(
    (r) => r.primary?.kind === "start" || r.primary?.kind === "open_resus",
  );
  if (!next?.primary) {
    return (
      <NextPatientBar>
        <span className="text-body-s text-muted-foreground">No one else is waiting for you.</span>
      </NextPatientBar>
    );
  }
  const meta = patientMeta(next.identity);
  return (
    <NextPatientBar action={next.primary}>
      <span className="text-body-s text-muted-foreground">Next waiting for you:</span>
      <AcuityChip level={next.acuity.level} />
      <span className="text-body-m text-foreground font-medium">{patientTitle(next.identity)}</span>
      {meta ? (
        <span className="text-caption text-muted-foreground font-mono tabular-nums">{meta}</span>
      ) : null}
    </NextPatientBar>
  );
}
