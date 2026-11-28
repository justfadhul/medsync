import type { PlanProblem } from "@/lib/nursing-care/fold";

import { k } from "@/components/nurse-ward/ui";
import { CARE_LIBRARY } from "@/content/nursing-care-library";
import { requireEmrActor } from "@/lib/emr/actor";
import { asClinicalReader } from "@/lib/emr/db";
import { loadCarePlan } from "@/lib/emr/read/nursing-care";
import { nurseWardV2LiveFor } from "@/lib/nurse/feature";
import { CarePlanPanel } from "./care-plan-panel";

/** Postgres 42P01 (undefined table), bare or wrapped in Drizzle's error (`cause`). */
const isMissingTable = (e: unknown): boolean =>
  typeof e === "object" &&
  e !== null &&
  (("code" in e && e.code === "42P01") || ("cause" in e && isMissingTable(e.cause)));

/**
 * The nursing care plan on the nurse's chart (ADR 0546 Phase 2). Behind NURSE_WARD_V2; before migration 0314 is
 * applied it says so instead of failing.
 */
export async function NurseCarePlan({
  patientUserId,
  encounterId,
  actionsAllowed,
}: {
  patientUserId: string;
  encounterId: string;
  actionsAllowed: boolean;
}) {
  const actor = await requireEmrActor("nurse");
  if (!nurseWardV2LiveFor(actor.hospitalId)) return null;
  let plan: PlanProblem[] | null;
  try {
    plan = await asClinicalReader({ userId: actor.userId, hospitalId: actor.hospitalId }, (tx) =>
      loadCarePlan(tx, { hospitalId: actor.hospitalId, patientUserId, encounterId }),
    );
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    plan = null;
  }
  // Drawn inside the ward desk's chart (ADR 0546), which names the tab.
  return plan === null ? (
    <p className={k("cf-note")}>
      The care plan is not set up at this hospital yet (migration 0314).
    </p>
  ) : (
    <CarePlanPanel
      patientUserId={patientUserId}
      encounterId={encounterId}
      plan={plan}
      library={[...CARE_LIBRARY]}
      actionsAllowed={actionsAllowed}
    />
  );
}
