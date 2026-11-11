import "server-only";

import type { NcdContext } from "./context";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { hospitalAdminRoster } from "@/db/schema/hospital-admin-roster";
import { hospitals } from "@/db/schema/hospitals";
import { ncdStaffRole } from "@/db/schema/ncd-registry";
import { users } from "@/db/schema/users";
import { getAuthState } from "@/lib/auth";
import { REACHABLE_AFFILIATION_STATES, staffMayReach } from "@/lib/auth/reachable";
import { resolveContext } from "./context";

/**
 * The NCD registry is off until the owner applies migration 0093 and names the hospital:
 * `NCD_REGISTRY=1` everywhere, or a comma-separated list of hospital ids (the repository's flag style).
 */
export function ncdRegistryLiveFor(hospitalId: string): boolean {
  const value = process.env.NCD_REGISTRY?.trim();
  if (!value) return false;
  return value === "1" || value.split(",").some((id) => id.trim() === hospitalId);
}

export type NcdScope = {
  ctx: NcdContext;
  hospitalName: string;
  fullName: string;
};

/**
 * Who is using the registry, where, with which NCD roles (ADR 0209). Auth and AAL2 as every clinical
 * workspace; the facility is the user's most recent active affiliation, admin roster seat or NCD role
 * assignment. A user with no NCD role there gets a 404, not a hint that the module exists.
 */
export const requireNcdScope = cache(async (): Promise<NcdScope> => {
  const state = await getAuthState();
  if (!state.user) redirect("/sign-in?redirect=/ncd");
  if (state.nextAal !== "aal2") redirect("/onboarding/mfa-setup");
  if (state.aal !== "aal2") redirect("/sign-in/mfa?redirect=/ncd");
  const userId = state.user.id;

  // The three ways a person belongs to a facility, looked up together (one round trip of latency),
  // then chosen in order: an active affiliation, an admin seat, an explicit NCD role.
  const [[aff], [admin], [assigned]] = await Promise.all([
    db
      .select({ hospitalId: staffAffiliations.hospitalId })
      .from(staffAffiliations)
      .where(
        and(
          eq(staffAffiliations.userId, userId),
          inArray(staffAffiliations.state, [...REACHABLE_AFFILIATION_STATES]),
        ),
      )
      .orderBy(desc(staffAffiliations.approvedAt))
      .limit(1),
    db
      .select({ hospitalId: hospitalAdminRoster.hospitalId })
      .from(hospitalAdminRoster)
      .where(and(eq(hospitalAdminRoster.userId, userId), isNull(hospitalAdminRoster.succeededAt)))
      .limit(1),
    db
      .select({ hospitalId: ncdStaffRole.facilityId })
      .from(ncdStaffRole)
      .where(and(eq(ncdStaffRole.userId, userId), isNull(ncdStaffRole.revokedAt)))
      .limit(1),
  ]);
  const facilityId = aff?.hospitalId ?? admin?.hospitalId ?? assigned?.hospitalId;
  if (!facilityId || !ncdRegistryLiveFor(facilityId)) notFound();
  if (!(await staffMayReach(userId, facilityId))) notFound();

  const [ctx, [h], [u]] = await Promise.all([
    resolveContext({ userId, facilityId, principal: "user" }),
    db.select({ name: hospitals.name }).from(hospitals).where(eq(hospitals.id, facilityId)),
    db
      .select({ fullName: users.fullName, email: users.email })
      .from(users)
      .where(eq(users.id, userId)),
  ]);
  if (!ctx.roles.length) notFound();
  return {
    ctx,
    hospitalName: h?.name ?? "Hospital",
    fullName: u?.fullName ?? u?.email ?? "Signed in",
  };
});
