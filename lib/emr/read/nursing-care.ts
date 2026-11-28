import "server-only";

import type { EmrTx } from "@/lib/emr/db";
import type { PlanProblem } from "@/lib/nursing-care/fold";
import { and, eq, inArray } from "drizzle-orm";

import { nursingCareEvents, nursingCareProblems } from "@/db/schema/nursing-care";
import { foldPlan } from "@/lib/nursing-care/fold";

/** The visit's nursing care plan as it stands, read under the clinical reader (RLS decides). */
export async function loadCarePlan(
  tx: EmrTx,
  i: { hospitalId: string; patientUserId: string; encounterId: string },
): Promise<PlanProblem[]> {
  const problems = await tx
    .select()
    .from(nursingCareProblems)
    .where(
      and(
        eq(nursingCareProblems.hospitalId, i.hospitalId),
        eq(nursingCareProblems.patientUserId, i.patientUserId),
        eq(nursingCareProblems.encounterId, i.encounterId),
      ),
    );
  if (!problems.length) return [];
  const events = await tx
    .select()
    .from(nursingCareEvents)
    .where(
      inArray(
        nursingCareEvents.problemId,
        problems.map((p) => p.id),
      ),
    );
  return foldPlan(problems, events);
}
