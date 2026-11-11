import "server-only";

import type { SQL } from "drizzle-orm";
import { and, eq, inArray, notInArray } from "drizzle-orm";

import { db } from "@/db";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { hospitals } from "@/db/schema/hospitals";
import { users } from "@/db/schema/users";
import {
  BLOCKED_USER_STATES,
  REACHABLE_AFFILIATION_STATES,
  REACHABLE_HOSPITAL_STATES,
} from "./reachable-states";

export * from "./reachable-states";

/**
 * The one rule every staff workspace uses (review finding C-1, H-14, C-4): the affiliation is approved,
 * its hospital is live, and the person is not suspended, deactivated or rejected. The query must join
 * `hospitals` and `users` to `staff_affiliations`.
 */
export function reachableAffiliation(): SQL {
  return and(
    inArray(staffAffiliations.state, [...REACHABLE_AFFILIATION_STATES]),
    inArray(hospitals.state, [...REACHABLE_HOSPITAL_STATES]),
    notInArray(users.state, [...BLOCKED_USER_STATES]),
  )!;
}

/** For scopes granted by a designation or admin seat rather than an affiliation: is the hospital live and the person not blocked? */
export async function staffMayReach(userId: string, hospitalId: string): Promise<boolean> {
  const [[u], [h]] = await Promise.all([
    db.select({ state: users.state }).from(users).where(eq(users.id, userId)).limit(1),
    db
      .select({ state: hospitals.state })
      .from(hospitals)
      .where(eq(hospitals.id, hospitalId))
      .limit(1),
  ]);
  return !!u && !!h && userMayReach(u.state) && hospitalIsReachable(h.state);
}

function userMayReach(state: string): boolean {
  return !(BLOCKED_USER_STATES as readonly string[]).includes(state);
}
function hospitalIsReachable(state: string): boolean {
  return (REACHABLE_HOSPITAL_STATES as readonly string[]).includes(state);
}
