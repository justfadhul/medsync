/**
 * Lifecycle state machine — applies to users, staff_affiliations,
 * and hospital_applications.
 *
 * Per the onboarding kickoff section C:
 *
 *   unverified → (contact verified) → verified
 *   verified → patients: active
 *            → staff/hospital: pending_approval → approved → active
 *
 *   side states: rejected · suspended · deactivated (terminal-ish)
 *
 * Rules enforced by `canTransition`:
 *   - no clinical access before `active`
 *   - clinical / admin require MFA enrolled before `active` (the MFA
 *     gate is enforced at the proxy / Edge Function layer, not here)
 *   - rejection captures a reason (caller responsibility)
 *   - for staff the state lives on the affiliation row — a user can
 *     hold one `active` and one `pending_approval` simultaneously
 *
 * This module is pure TS — no DB writes. The matching Postgres ENUM
 * (`public.lifecycle_state`) and the service-role wrappers that
 * actually flip state columns will land in the GATE A migration
 * after the schema proposal is approved.
 */

export const LIFECYCLE_STATES = [
  "unverified",
  "verified",
  "pending_approval",
  "approved",
  "active",
  "rejected",
  "suspended",
  "deactivated",
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/**
 * Valid forward transitions. Anything not listed is rejected.
 *
 * `rejected` allows a reset back to `pending_approval` so a hospital
 * applicant can re-apply after fixing their authorisation letter,
 * and so a clinical affiliation can be re-reviewed after the
 * clinician resubmits a corrected licence.
 */
export const LIFECYCLE_TRANSITIONS: Readonly<
  Record<LifecycleState, ReadonlyArray<LifecycleState>>
> = {
  unverified: ["verified", "deactivated"],
  verified: ["active", "pending_approval", "deactivated"],
  pending_approval: ["approved", "rejected", "deactivated"],
  approved: ["active", "suspended", "deactivated"],
  active: ["suspended", "deactivated"],
  rejected: ["pending_approval", "deactivated"],
  suspended: ["active", "deactivated"],
  deactivated: [],
} as const;

/** Validate a forward transition against the table above. */
export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return LIFECYCLE_TRANSITIONS[from].includes(to);
}

/** States that indicate the holder may use the system. */
export const ACTIVE_STATES: ReadonlySet<LifecycleState> = new Set<LifecycleState>(["active"]);

/** States that block clinical access. Used by the proxy + Edge Function guards. */
export const BLOCKS_CLINICAL: ReadonlySet<LifecycleState> = new Set<LifecycleState>([
  "unverified",
  "verified",
  "pending_approval",
  "rejected",
  "suspended",
  "deactivated",
]);

/** Human-readable label for UI surfaces (kept here so copy stays consistent). */
export function describeState(state: LifecycleState): string {
  switch (state) {
    case "unverified":
      return "Unverified";
    case "verified":
      return "Verified";
    case "pending_approval":
      return "Pending approval";
    case "approved":
      return "Approved";
    case "active":
      return "Active";
    case "rejected":
      return "Rejected";
    case "suspended":
      return "Suspended";
    case "deactivated":
      return "Deactivated";
  }
}
