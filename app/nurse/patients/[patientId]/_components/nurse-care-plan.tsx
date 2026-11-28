import type { PlanProblem } from "@/lib/nursing-care/fold";

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
 * The nursing care plan on the nurse's chart (ADR 0545 Phase 2). Behind NURSE_WARD_V2; before migration 0314 is
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
  return (
    <section
      aria-labelledby="care-plan-heading"
      className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 pb-6 md:px-8"
    >
      <h2 id="care-plan-heading" className="text-heading-m text-foreground">
        Nursing care plan
      </h2>
      {plan === null ? (
        <p className="text-muted-foreground text-body-s">
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
      )}
    </section>
  );
}
