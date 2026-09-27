import type { CatalogSection } from "../_components/catalog/browser";
import type { Metadata } from "next";

import {
  listCadres,
  listCouncils,
  listDistricts,
  listRegions,
  listRoles,
  listSpecialties,
} from "@/lib/reference-data";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { CatalogBrowser } from "../_components/catalog/browser";

export const metadata: Metadata = {
  title: "Catalog · Superadmin · MedSync",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Catalog viewer (READ-ONLY). Browse the seeded reference data —
 * councils → cadres → roles + the regions / districts / specialties
 * lookup. Editing is deferred until preview + four-eyes + audit
 * safeguards are all in place (per kickoff Area 4).
 *
 * Server fetches each section via the unstable_cache-wrapped helpers
 * in `lib/reference-data` (1h TTL, tagged "reference-data"), then
 * hands the data to the client browser which owns the segmented
 * control + filter input.
 */
export default async function CatalogPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const service = createServiceClient();
  const { data: rolesData } = await service
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id);
  if (!rolesData?.some((r) => r.role === "superadmin")) {
    return <div className="mx-auto max-w-2xl px-5 py-12">Superadmin only.</div>;
  }

  const [councils, allCadres, allRoles, regions, districts, specialties] = await Promise.all([
    listCouncils(),
    listCadres(),
    listRoles(),
    listRegions(),
    listDistricts(),
    listSpecialties(),
  ]);

  const sections: CatalogSection[] = [
    {
      key: "councils",
      label: "Councils",
      entries: councils.map((c) => ({ id: c.id, name: c.name, code: c.code })),
    },
    {
      key: "cadres",
      label: "Cadres",
      entries: allCadres.map((c) => ({ id: c.id, name: c.name, code: c.code })),
    },
    {
      key: "roles",
      label: "Roles",
      entries: allRoles.map((r) => ({ id: r.id, name: r.name, code: r.code })),
    },
    {
      key: "specialties",
      label: "Specialties",
      entries: specialties.map((s) => ({ id: s.id, name: s.name, code: s.code })),
    },
    {
      key: "regions",
      label: "Regions",
      entries: regions.map((r) => ({ id: r.id, name: r.name })),
    },
    {
      key: "districts",
      label: "Districts",
      entries: districts.map((d) => ({ id: d.id, name: d.name })),
    },
  ];

  return (
    <div className="flex flex-col">
      <header className="border-border border-b px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-1">
          <h1 className="font-display text-display-s text-foreground">Catalog</h1>
          <p className="text-muted-foreground max-w-[60ch] text-[13.5px]">
            Seeded reference data — read-only. Editing is deferred behind preview + four-eyes +
            audit (per kickoff Area 4); role → permission edits are the quietest catastrophic risk
            in the system and never surface as a UI affordance without the safeguards.
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-8 sm:py-8">
        <CatalogBrowser sections={sections} />
      </div>
    </div>
  );
}
