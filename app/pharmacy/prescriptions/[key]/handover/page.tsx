import { notFound } from "next/navigation";

import { PageHeader } from "@/components/medsync/page-header";
import { PHARMACY } from "@/content/pharmacy";
import { CONTROLLED_UI } from "@/content/pharmacy-controlled";
import { SUPPLY } from "@/content/pharmacy-supply";
import { db } from "@/db";
import { prescribeV2LiveFor } from "@/lib/emr/feature";
import { identitiesFor } from "@/lib/emr/read/results";
import { can } from "@/lib/pharmacy/access";
import { requirePharmacyActor } from "@/lib/pharmacy/actor";
import { witnessCandidates } from "@/lib/pharmacy/controlled-read";
import { managesPharmacy } from "@/lib/pharmacy/downtime-store";
import { pharmacyDispensingLiveFor } from "@/lib/pharmacy/feature";
import { requirePharmacyScope } from "@/lib/pharmacy/scope";
import { getHandover } from "@/lib/pharmacy/supply/read";
import { DEFAULT_TIME_ZONE } from "@/supabase/functions/_shared/slots";
import { HandoverScreen } from "./_components/handover-screen";

export const dynamic = "force-dynamic";

/**
 * The hand-over (5.6, artboard 1.4; wireframe §6). The lines staged at Ready on the review screen, or one
 * open line for "Supply now" from Open lines (5.7, `?line=` carries its id only). Four sections and the
 * summary; `recordHandover` re-checks everything under the locks. Behind `pharmacyDispensing`, at a live
 * point, for a holder of `pharmacy.dispense`. No stored date of birth or phone number is read here.
 * A hand-over with a controlled line is the controlled supply (5.9, CD-1): the same screen with the
 * witness, the count, the paper and the witness's agreement first, for a holder of `pharmacy.controlled`.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function HandoverPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ line?: string }>;
}) {
  const scope = await requirePharmacyScope();
  if (!pharmacyDispensingLiveFor(scope.hospitalId)) notFound();
  const actor = await requirePharmacyActor();
  if (!can(actor.access, "pharmacy.dispense")) notFound();
  const key = decodeURIComponent((await params).key);
  const line = (await searchParams).line;
  const point = actor.points.find((p) => p.id === actor.pointId) ?? null;
  const data = await getHandover(
    scope.hospitalId,
    key,
    point ? { id: point.id, labelMode: point.labelMode } : null,
    line && UUID.test(line) ? line : null,
  );
  if (!data) notFound();
  const [ids, manages, witnesses] = await Promise.all([
    identitiesFor(scope, [data.patientUserId], "pharmacy_handover"),
    managesPharmacy(scope.userId, scope.hospitalId),
    data.controlled ? witnessCandidates(db, scope.hospitalId, scope.userId) : Promise.resolve([]),
  ]);
  const who = ids.get(data.patientUserId) ?? { name: "Name withheld", mrn: "", ageSex: "" };
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
      <PageHeader
        place={`${scope.hospitalName} · ${PHARMACY.place}`}
        placeInTopBar
        title={data.controlled ? CONTROLLED_UI.title : SUPPLY.handover.title}
        subline={
          <span className="text-body-s text-muted-foreground">
            {[who.name, who.mrn, who.ageSex].filter(Boolean).join(" · ")}
          </span>
        }
      />
      <HandoverScreen
        data={data}
        canManage={manages}
        timeZone={DEFAULT_TIME_ZONE}
        witnesses={witnesses}
        canSupplyControlled={can(actor.access, "pharmacy.controlled")}
        slip={{ hospital: scope.hospitalName, patientName: who.name, medsyncNumber: who.mrn }}
        explainRequired={prescribeV2LiveFor(scope.hospitalId)}
      />
    </div>
  );
}
