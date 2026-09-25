import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { catalogRenderMode } from "@/lib/emergency/feature";
import { fetchCatalogVersionStatus } from "@/lib/emergency/queries";
import { requirePatientScope } from "@/lib/patient/scope";
import {
  CATALOG,
  CATALOG_CHECKSUM,
} from "@/supabase/functions/_shared/symptom-catalog/catalog.v0.1";
import { Catalog } from "./_components/catalog";

export const metadata: Metadata = {
  title: "What's wrong? · MedSync",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * /patient/symptoms — the catalog pre-step (ADR 0098). Gate CS decides what
 * renders: `off` sends the patient back to the home, where the ADR 0096
 * shortlist stands exactly as shipped. The page reads nothing clinical: the
 * catalog is the bundled const and the tier is computed on the device.
 */
export default async function SymptomsPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string; list?: string }>;
}) {
  const scope = await requirePatientScope();
  const [status, params, profile] = await Promise.all([
    // A database before migration 0066 has no versions table: "not signed",
    // never a crash on a patient's screen.
    fetchCatalogVersionStatus(CATALOG.version, CATALOG_CHECKSUM).catch(() => null),
    searchParams,
    db
      .select({ sex: patientProfiles.sex })
      .from(patientProfiles)
      .where(eq(patientProfiles.id, scope.userId))
      .limit(1),
  ]);
  const mode = catalogRenderMode(status?.signed === true);
  if (mode === "off") redirect("/patient");

  return (
    // No wrapper: the catalog follows the site theme (owner decision
    // 2026-09-23, superseding PRD Law 3's forced light — /emergency went the
    // same way in aa1fe46), so it sits on the shell's own ground.
    <Catalog
      mode={mode}
      hospital={
        scope.primaryHospitalId
          ? {
              id: scope.primaryHospitalId,
              name: scope.primaryHospitalName ?? "Your hospital",
              emergencyPhone: scope.emergencyEntrancePhone,
            }
          : null
      }
      showPregnancyForMe={profile[0]?.sex !== "male"}
      initialItem={typeof params.item === "string" ? params.item : null}
      initialList={params.list === "danger" ? "danger" : null}
    />
  );
}
