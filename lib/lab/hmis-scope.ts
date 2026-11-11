import "server-only";

import type { HmisRole } from "./hmis-designations";
import { notFound, redirect } from "next/navigation";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";

import { db } from "@/db";
import { hmisDesignations, hospitals, userRoles } from "@/db/schema";
import { getAuthState } from "@/lib/auth";
import { staffMayReach } from "@/lib/auth/reachable";
import { DEFAULT_TIME_ZONE } from "@/supabase/functions/_shared/slots";
import { labHmisLiveFor } from "./feature";

/**
 * The HMIS desk (`/hmis`, GATE A §4): the Health Unit In-Charge, the HMIS focal person and the hospital admin,
 * none of whom needs a lab role. AAL2; the designation (or the admin role) decides the hospital; `labHmis` must
 * be on there. Everything this scope reads is aggregate (Law 10).
 */
export async function hmisDeskScope(): Promise<{
  userId: string;
  hospitalId: string;
  hospitalName: string;
  roles: HmisRole[];
  admin: boolean;
}> {
  const state = await getAuthState();
  if (!state.user) redirect("/sign-in?redirect=/hmis");
  if (state.aal !== "aal2") redirect("/sign-in/mfa?redirect=/hmis");
  const userId = state.user.id;
  const day = new Date().toLocaleDateString("en-CA", { timeZone: DEFAULT_TIME_ZONE });
  const [designations, admins] = await Promise.all([
    db
      .select({ hospitalId: hmisDesignations.hospitalId, role: hmisDesignations.role })
      .from(hmisDesignations)
      .where(
        and(
          eq(hmisDesignations.userId, userId),
          lte(hmisDesignations.startsOn, day),
          or(isNull(hmisDesignations.endsOn), gte(hmisDesignations.endsOn, day)),
        ),
      ),
    db
      .select({ hospitalId: userRoles.hospitalId })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.role, "hospital_admin"))),
  ]);
  const hospitalId = designations[0]?.hospitalId ?? admins.find((a) => a.hospitalId)?.hospitalId;
  if (!hospitalId || !labHmisLiveFor(hospitalId)) notFound();
  if (!(await staffMayReach(userId, hospitalId))) notFound();
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
        designations.filter((d) => d.hospitalId === hospitalId).map((d) => d.role as HmisRole),
      ),
    ],
    admin: admins.some((a) => a.hospitalId === hospitalId),
  };
}
