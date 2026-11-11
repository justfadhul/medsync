/** Affiliation states that may open a staff workspace. `pending_approval`, `rejected`, `suspended` and `deactivated` may not. */
export const REACHABLE_AFFILIATION_STATES = ["active", "approved"] as const;
/** Hospital states whose staff may work. `offboarded`, `suspended` and the application states may not. */
export const REACHABLE_HOSPITAL_STATES = ["provisioning", "active"] as const;
/** User states that lose every staff workspace, whatever their affiliations say. */
export const BLOCKED_USER_STATES = ["suspended", "deactivated", "rejected"] as const;

/** The same rule as `reachableAffiliation()`, for scopes that pick among rows in code. */
export function staffReachable(s: {
  affiliationState: string;
  hospitalState: string;
  userState: string;
}): boolean {
  return (
    (REACHABLE_AFFILIATION_STATES as readonly string[]).includes(s.affiliationState) &&
    (REACHABLE_HOSPITAL_STATES as readonly string[]).includes(s.hospitalState) &&
    !(BLOCKED_USER_STATES as readonly string[]).includes(s.userState)
  );
}
