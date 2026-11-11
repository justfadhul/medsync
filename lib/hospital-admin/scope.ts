import "server-only";

import { redirect } from "next/navigation";
import { and, desc, eq, notInArray } from "drizzle-orm";

import { db } from "@/db";
import { hospitalAdminRoster } from "@/db/schema/hospital-admin-roster";
import { hospitals } from "@/db/schema/hospitals";
import { userRoles } from "@/db/schema/user-roles";
import { users } from "@/db/schema/users";
import { getAuthState } from "@/lib/auth";
import { BLOCKED_USER_STATES, REACHABLE_HOSPITAL_STATES } from "@/lib/auth/reachable";
import { logger } from "@/lib/logger";

/**
 * Hospital-admin tenant scope — the single source of truth for "which
 * hospital does the signed-in admin operate on".
 *
 * Read this in every server component / Server Action / route handler
 * under /hospital-admin. NEVER re-derive the scope from a request param
 * or a client-passed value; that's the whole point of having one
 * accessor — features can't accidentally widen it.
 *
 * What the scope contains:
 *   - hospitalId   — the FK every feature query filters on
 *   - hospitalSlug — for URL building when needed
 *   - hospitalName — for the top-bar identity strip
 *   - level        — facility level (HC III, regional, etc.) for chrome
 *   - state        — hospital lifecycle state; the helper refuses to
 *                    return a scope for an unreachable hospital
 *   - designation  — primary | backup | null (null while migration
 *                    grandfathered admins haven't been written into
 *                    hospital_admin_roster yet)
 *
 * Why the helper redirects rather than returns null:
 *   - it always runs inside a server component / action
 *   - the only sensible response to "no scope" inside /hospital-admin is
 *     to bounce the user out — return-null would force every caller to
 *     re-implement the bounce, which is exactly the leak we're guarding
 *     against
 *
 * Multi-hospital admins: the user_roles schema allows a user to hold
 * `hospital_admin` against multiple hospitals. The kickoff is explicit:
 * single-tenant scope per session. For now we resolve to the MOST
 * RECENTLY-DESIGNATED roster row (or, if no roster, the oldest
 * user_roles row) and pin to it. A workspace switcher lands in a later
 * feature prompt; until then a multi-hospital admin sees their
 * "default" hospital and can't accidentally act on another.
 */

export interface HospitalAdminScope {
  hospitalId: string;
  hospitalSlug: string;
  hospitalName: string;
  level: string;
  state: string;
  designation: "primary" | "backup" | null;
  /** The authenticated user's id (convenience — saves a round-trip). */
  userId: string;
  /** The authenticated user's email (for chrome). */
  userEmail: string;
}

/**
 * States in which a hospital-admin workspace IS reachable. Anything
 * else bounces the admin out — there's no useful surface to render for
 * a suspended or offboarded tenant.
 *
 *   - provisioning: setup wizard in progress; admin must finish it
 *   - active:       fully operational
 *
 * Notable EXCLUSIONS:
 *   - agreement_expired: blocks; chrome should later show a renewal
 *     banner once that flow exists. For now, bounce to a not-ready
 *     page. (Tracked separately; out of shell scope.)
 *   - suspended / offboarded: terminal-ish, no admin surface.
 */

/**
 * Resolve the scope or redirect.
 *
 * Call this at the TOP of `/hospital-admin/layout.tsx` and in any
 * Server Action that mutates hospital-scoped state. The redirect
 * branches encode the security boundary: no scope = no workspace.
 */
export async function requireHospitalAdminScope(): Promise<HospitalAdminScope> {
  const state = await getAuthState();

  if (!state.user) redirect("/sign-in?redirect=/hospital-admin");
  if (state.mfaRequired && state.nextAal !== "aal2") redirect("/onboarding/mfa-setup");
  if (state.aal !== "aal2") redirect("/sign-in/mfa?redirect=/hospital-admin");

  // Find every hospital_admin grant for this user, joined to its
  // hospital + roster designation (left-join: a grandfathered admin
  // may have no roster row yet). Order by roster designation date so
  // the most-recently-designated primary wins; fall back to user_roles
  // creation order otherwise.
  const rows = await db
    .select({
      hospitalId: hospitals.id,
      hospitalSlug: hospitals.slug,
      hospitalName: hospitals.name,
      level: hospitals.level,
      hospitalState: hospitals.state,
      designation: hospitalAdminRoster.designation,
      designatedAt: hospitalAdminRoster.designatedAt,
    })
    .from(userRoles)
    .innerJoin(hospitals, eq(hospitals.id, userRoles.hospitalId))
    .leftJoin(
      hospitalAdminRoster,
      and(
        eq(hospitalAdminRoster.hospitalId, userRoles.hospitalId),
        eq(hospitalAdminRoster.userId, userRoles.userId),
      ),
    )
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(
      and(
        eq(userRoles.userId, state.user.id),
        eq(userRoles.role, "hospital_admin"),
        notInArray(users.state, [...BLOCKED_USER_STATES]),
      ),
    )
    .orderBy(desc(hospitalAdminRoster.designatedAt));

  if (rows.length === 0) {
    // Authenticated but not a hospital admin. Don't leak the existence
    // of /hospital-admin — bounce to /.
    logger.warn("hospital-admin.scope.no_role", { user_id: state.user.id });
    redirect("/");
  }

  // Pick the first reachable hospital (most-recently-designated
  // primary, then most-recent backup, then anything else). If none
  // are reachable, bounce.
  const reachable = rows.find((r) =>
    (REACHABLE_HOSPITAL_STATES as readonly string[]).includes(r.hospitalState),
  );
  if (!reachable) {
    logger.warn("hospital-admin.scope.no_reachable_hospital", {
      user_id: state.user.id,
      hospital_states: rows.map((r) => r.hospitalState),
    });
    redirect("/");
  }

  const designation =
    reachable.designation === "primary" || reachable.designation === "backup"
      ? (reachable.designation as "primary" | "backup")
      : null;

  return {
    hospitalId: reachable.hospitalId,
    hospitalSlug: reachable.hospitalSlug,
    hospitalName: reachable.hospitalName,
    level: reachable.level,
    state: reachable.hospitalState,
    designation,
    userId: state.user.id,
    userEmail: state.user.email ?? "admin",
  };
}

/**
 * Assert that an arbitrary hospital_id matches the current admin's
 * scope. Use inside Server Actions / Edge Functions when a request
 * body carries a hospital_id (e.g. forms): never trust the input.
 *
 * Throws on mismatch so the caller can return 403 — never silently
 * downgrade or substitute.
 */
export function assertScopeOwnsHospital(scope: HospitalAdminScope, hospitalId: string): void {
  if (scope.hospitalId !== hospitalId) {
    throw new ScopeViolationError(
      `Hospital ${hospitalId} is outside the current admin's scope (${scope.hospitalId}).`,
    );
  }
}

export class ScopeViolationError extends Error {
  override readonly name = "ScopeViolationError" as const;
  constructor(message: string) {
    super(message);
  }
}
