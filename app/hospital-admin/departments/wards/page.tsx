import type { WardItem, WardPlan } from "./_lib/model";
import type { Metadata } from "next";

import { WARDS } from "@/content/hospital-admin/wards";
import { requireHospitalAdminScope } from "@/lib/hospital-admin/scope";
import { dutyRotaLiveFor } from "@/lib/rota/feature";
import { coverForWard } from "@/lib/rota/read";
import { soft } from "@/lib/rota/soft";
import {
  loadDepartments,
  loadPlaces,
  loadStaffPool,
  loadWards,
  nursingPool,
} from "@/lib/services/data";
import { loadBedBoard } from "@/lib/wards/board";
import { layoutStatusByWard, wardTabs } from "@/lib/wards/data";
import { euObservationLiveFor, wardBuilderLiveFor } from "@/lib/wards/feature";
import { WardsView } from "./_components/wards-view";

export const metadata: Metadata = { title: WARDS.title };
export const dynamic = "force-dynamic";

/**
 * Wards and beds (phase 2 of ADR 0520), in the Tether desk. With WARD_BUILDER on, each ward with a published layout
 * shows its live plan and its bed states from the bed board (ADR 0194, the engine behind every count here); off,
 * the list works from the register alone and the builder entry is hidden.
 */
export default async function WardsPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string; new?: string }>;
}) {
  const scope = await requireHospitalAdminScope();
  const h = scope.hospitalId;
  const builder = wardBuilderLiveFor(h);
  const [wards, departments, pool, places, layouts, tabs] = await Promise.all([
    loadWards(h),
    loadDepartments(h),
    loadStaffPool(h),
    loadPlaces(h),
    // ADR 0191 §6: the layout tables are read only when the ward builder is on (migration 0090).
    builder ? layoutStatusByWard(h) : Promise.resolve(null),
    builder ? wardTabs(h) : Promise.resolve([]),
  ]);
  // The live boards of the wards with a published layout; no patient is read (`patients: "none"`).
  const boards = layouts
    ? await Promise.all(
        wards
          .filter((w) => !w.archived && layouts[w.id]?.published)
          .map((w) => loadBedBoard(h, w.id, { patients: "none", tabs })),
      )
    : [];
  const plans = new Map<string, WardPlan>();
  for (const b of boards)
    if (b?.doc)
      plans.set(b.ward.id, {
        doc: b.doc,
        states: Object.fromEntries(b.beds.map((x) => [x.key, x.state])),
      });
  const now = new Date();
  const covers = dutyRotaLiveFor(h)
    ? new Map(
        await Promise.all(
          wards
            .filter((w) => !w.archived)
            .map(async (w) => [w.id, await soft(coverForWard(h, w.id, now), undefined)] as const),
        ),
      )
    : null;
  const items: WardItem[] = wards.map((w) => ({
    ...w,
    layout: layouts ? (layouts[w.id] ?? { published: false, draft: false }) : null,
    plan: plans.get(w.id) ?? null,
    cover: covers?.get(w.id),
  }));
  const sp = await searchParams;
  return (
    <WardsView
      wards={items}
      builder={builder}
      euLive={euObservationLiveFor(h)}
      departments={departments
        .filter((d) => d.parentId === null && !d.archived)
        .map((d) => ({ id: d.id, name: d.name }))}
      nurses={[
        ...new Map(
          nursingPool(pool).map((p) => [
            p.userId,
            { userId: p.userId, name: p.name, cadre: p.cadre },
          ]),
        ).values(),
      ]}
      places={places.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name }))}
      openId={typeof sp.open === "string" ? sp.open : null}
      adding={sp.new === "1"}
    />
  );
}
