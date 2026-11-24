import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { hospitalWards } from "@/db/schema/hospital-wards";
import { resusBayProfiles } from "@/db/schema/resus";
import { hospitalBeds } from "@/db/schema/services-hub";

/** The resus spaces of a hospital's emergency units, and its active resus bays (D7). Read only with the EU flag on. */
export async function loadResusDesk(hospitalId: string) {
  const [spaces, bays] = await Promise.all([
    db
      .select({ id: hospitalBeds.id, label: hospitalBeds.label, wardId: hospitalBeds.wardId })
      .from(hospitalBeds)
      .innerJoin(hospitalWards, eq(hospitalWards.id, hospitalBeds.wardId))
      .where(
        and(
          eq(hospitalBeds.hospitalId, hospitalId),
          eq(hospitalBeds.bedType, "resus"),
          isNull(hospitalBeds.archivedAt),
          inArray(hospitalWards.wardType, ["emergency_observation"]),
        ),
      )
      .orderBy(asc(hospitalBeds.label)),
    db
      .select({
        id: resusBayProfiles.id,
        label: resusBayProfiles.bayLabel,
        bedId: resusBayProfiles.bedId,
      })
      .from(resusBayProfiles)
      .where(and(eq(resusBayProfiles.hospitalId, hospitalId), eq(resusBayProfiles.active, true)))
      .orderBy(asc(resusBayProfiles.bayLabel)),
  ]);
  return { spaces, bays };
}

export type ResusDesk = Awaited<ReturnType<typeof loadResusDesk>>;
