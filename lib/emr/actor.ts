import "server-only";

import { eq } from "drizzle-orm";

/**
 * Who is writing to the record. Every EMR server action starts here, whichever
 * workspace the clinician is in: the four role scopes already enforce sign-in,
 * AAL2 and an active affiliation (and redirect otherwise), so this only
 * normalises them into one shape the write paths and the access rule share.
 * Reception never reaches the EMR: its cadre is `is_clinical = false`, and the
 * SQL access rule refuses it again at the database.
 */
export type EmrSurface = "doctor" | "nurse" | "clinician" | "lab";

export interface EmrActor {
  userId: string;
  fullName: string | null;
  hospitalId: string;
  departmentId: string | null;
  affiliationId: string;
  cadreCode: string;
  isClinical: boolean;
  surface: EmrSurface;
}

export async function requireEmrActor(surface: EmrSurface): Promise<EmrActor> {
  switch (surface) {
    case "doctor": {
      const s = await (await import("@/lib/doctor/scope")).requireDoctorScope();
      return {
        ...pick(s),
        departmentId: s.departmentId,
        cadreCode: s.cadreCode,
        isClinical: true,
        surface,
      };
    }
    case "nurse": {
      const s = await (await import("@/lib/nurse/scope")).requireNurseScope();
      return {
        ...pick(s),
        departmentId: s.departmentId,
        cadreCode: s.cadreCode,
        isClinical: true,
        surface,
      };
    }
    case "lab": {
      const s = await (await import("@/lib/lab-tech/scope")).requireLabTechScope();
      return {
        ...pick(s),
        departmentId: s.departmentId,
        cadreCode: s.cadreCode,
        isClinical: true,
        surface,
      };
    }
    case "clinician": {
      // The generic scope carries no cadre, so read it from the pinned affiliation.
      const s = await (await import("@/lib/clinician/scope")).requireClinicianScope();
      const cadre = await affiliationCadre(s.affiliationId);
      return { ...pick(s), departmentId: s.departmentId, ...cadre, surface };
    }
  }
}

function pick(s: {
  userId: string;
  fullName: string | null;
  hospitalId: string;
  affiliationId: string;
}) {
  return {
    userId: s.userId,
    fullName: s.fullName,
    hospitalId: s.hospitalId,
    affiliationId: s.affiliationId,
  };
}

async function affiliationCadre(
  affiliationId: string,
): Promise<{ cadreCode: string; isClinical: boolean }> {
  const { db } = await import("@/db");
  const { staffAffiliations } = await import("@/db/schema/clinician-profiles");
  const { cadres } = await import("@/db/schema/reference-data");
  const [row] = await db
    .select({ cadreCode: cadres.code, isClinical: cadres.isClinical })
    .from(staffAffiliations)
    .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
    .where(eq(staffAffiliations.id, affiliationId))
    .limit(1);
  // No cadre row means no clinical standing: fail closed.
  return row ?? { cadreCode: "UNKNOWN", isClinical: false };
}
