import { resusDeskV2 } from "@/lib/resus/feature";
import { requireTriageScope } from "@/lib/triage/scope";
import { fetchTriageWorklistRow } from "@/lib/triage/worklist";
import { doctorWorkspace } from "@/lib/workspace/feature";
import { TriageSheet } from "../../../../_components/workspace/triage-sheet";

/**
 * Triage in place (E1, §5.4): /doctor/triage/<intake> opened from the board
 * renders the existing triage desk in a sheet over it. The URL is the desk's
 * own, so a reload or a shared link lands on the full triage page; Esc and
 * back close the sheet.
 */
export default async function TriageOverBoard({
  params,
}: {
  params: Promise<{ intakeId: string }>;
}) {
  const { intakeId } = await params;
  const scope = await requireTriageScope();
  if (!doctorWorkspace(scope.hospitalId)) return null;
  const row = await fetchTriageWorklistRow({
    intakeId,
    hospitalId: scope.hospitalId,
    clinicianUserId: scope.userId,
  });
  return (
    <TriageSheet
      row={row}
      mayDownTriage={scope.authority.mayDownTriage}
      openResusOnArrest={resusDeskV2()}
    />
  );
}
