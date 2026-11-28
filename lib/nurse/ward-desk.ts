import "server-only";

import type { NurseScope } from "./scope";
import { and, eq, gt, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import { nursingAssignments } from "@/db/schema/nurse-workspace";

/** ADR 0547: a ward nurse is in charge of a ward or holds a current patient assignment; others work the clinic floor. */
export async function isWardNurse(scope: NurseScope): Promise<boolean> {
  if (scope.isInCharge) return true;
  const [row] = await db
    .select({ id: nursingAssignments.id })
    .from(nursingAssignments)
    .where(
      and(
        eq(nursingAssignments.nurseUserId, scope.userId),
        eq(nursingAssignments.hospitalId, scope.hospitalId),
        or(isNull(nursingAssignments.endsAt), gt(nursingAssignments.endsAt, new Date())),
      ),
    )
    .limit(1);
  return !!row;
}
