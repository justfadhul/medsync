import "server-only";

import { notFound, redirect } from "next/navigation";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";

import { db } from "@/db";
import { hospitalDesignations, hospitals, userRoles } from "@/db/schema";
import { getAuthState } from "@/lib/auth";
import { staffMayReach } from "@/lib/auth/reachable";
import { labReferralLiveFor, patientResultsLiveFor } from "./feature";

export type GovernanceRole = "data_protection_lead" | "ipc_lead";

/**
 * The referral governance desk (`/referral-governance`, Lab Phase 4 P8, A6): the data protection lead (the legal
 * record and field list per partner), the IPC lead (the high-risk wording) and the hospital admin (who names
 * both). None needs a lab role. AAL2; the designation (or the admin role) decides the hospital; `labReferral`
 * must be on there. Nothing here reads a patient.
 */
export async function governanceWho(redirectTo: string | null): Promise<{
  userId: string;
  hospitalId: string;
  hospitalName: string;
  roles: GovernanceRole[];
  admin: boolean;
} | null> {
  const state = await getAuthState();
  if (!state.user) {
    if (redirectTo) redirect(`/sign-in?redirect=${redirectTo}`);
    return null;
  }
  if (state.aal !== "aal2") {
    if (redirectTo) redirect(`/sign-in/mfa?redirect=${redirectTo}`);
    return null;
  }
  const userId = state.user.id;
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Kampala" });
  const [designations, admins] = await Promise.all([
    db
      .select({ hospitalId: hospitalDesignations.hospitalId, role: hospitalDesignations.role })
      .from(hospitalDesignations)
      .where(
        and(
          eq(hospitalDesignations.userId, userId),
          lte(hospitalDesignations.startsOn, day),
          or(isNull(hospitalDesignations.endsOn), gte(hospitalDesignations.endsOn, day)),
        ),
      ),
    db
      .select({ hospitalId: userRoles.hospitalId })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.role, "hospital_admin"))),
  ]);
  const hospitalId = designations[0]?.hospitalId ?? admins.find((a) => a.hospitalId)?.hospitalId;
  // The desk serves referrals (Phase 4) and the results consent wording (Phase 5, ADR 0339).
  if (!hospitalId || !(labReferralLiveFor(hospitalId) || patientResultsLiveFor(hospitalId)))
    return null;
  if (!(await staffMayReach(userId, hospitalId))) return null;
  const [h] = await db
    .select({ name: hospitals.name })
    .from(hospitals)
    .where(eq(hospitals.id, hospitalId));
  return {
    userId,
    hospitalId,
    hospitalName: h?.name ?? "This hospital",
    roles: [
      ...new Set(
        designations
          .filter((d) => d.hospitalId === hospitalId)
          .map((d) => d.role as GovernanceRole),
      ),
    ],
    admin: admins.some((a) => a.hospitalId === hospitalId),
  };
}

export async function governanceScope() {
  const who = await governanceWho("/referral-governance");
  if (!who) notFound();
  return who;
}
