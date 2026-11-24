import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { RotaWeek } from "@/components/rota/rota-week";
import { WeekNav } from "@/components/rota/week-nav";
import { DUTY_ROTA_COPY } from "@/content/duty-rota";
import { db } from "@/db";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { requireHospitalAdminScope } from "@/lib/hospital-admin/scope";
import { rotaWeekStart } from "@/lib/rota/cover";
import { dutyRotaLiveFor } from "@/lib/rota/feature";
import { loadRotaWeek, rotaChoices } from "@/lib/rota/read";
import {
  addDelegateAction,
  archivePostAction,
  assignDutyAction,
  createPostAction,
  decideSwapAction,
  endDutyAction,
  endTemplateAction,
  fillWeekAction,
  publishWeekAction,
  revokeDelegateAction,
  saveTemplateAction,
  unlockWeekAction,
} from "./actions";

const P = DUTY_ROTA_COPY.page;
export const metadata: Metadata = { title: P.metaTitle("Hospital admin") };
export const dynamic = "force-dynamic";

/**
 * One department's duty rota for the hospital admin (ADR 0534): `?department=<id>`, `?week=` a Monday (else this
 * week's). Behind DUTY_ROTA; off, or a department not of this hospital, the page is not found.
 */
export default async function AdminRotaPage({
  searchParams,
}: {
  searchParams: Promise<{ department?: string | string[]; week?: string | string[] }>;
}) {
  const scope = await requireHospitalAdminScope();
  if (!dutyRotaLiveFor(scope.hospitalId)) notFound();
  const sp = await searchParams;
  const id = z.uuid().safeParse(sp.department);
  if (!id.success) notFound();
  const [dept] = await db
    .select({ name: hospitalDepartments.name })
    .from(hospitalDepartments)
    .where(
      and(
        eq(hospitalDepartments.id, id.data),
        eq(hospitalDepartments.hospitalId, scope.hospitalId),
        isNull(hospitalDepartments.archivedAt),
      ),
    );
  if (!dept) notFound();
  const weekStart = rotaWeekStart(typeof sp.week === "string" ? sp.week : undefined, new Date());
  const [week, choices] = await Promise.all([
    loadRotaWeek(scope.hospitalId, id.data, weekStart),
    rotaChoices(scope.hospitalId, id.data),
  ]);
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8 lg:py-10">
      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.16em] uppercase">
          {P.overline}
        </span>
        <h1 className="font-display text-display-s text-foreground">{P.title}</h1>
        <p className="text-muted-foreground max-w-[60ch] text-[12.5px] leading-relaxed">
          {P.adminLead}
        </p>
      </header>
      <WeekNav
        weekStart={weekStart}
        base={`/hospital-admin/departments/rota?department=${id.data}&`}
      />
      <RotaWeek
        week={week}
        departmentId={id.data}
        departmentName={dept.name}
        weekStart={weekStart}
        wards={choices.wards}
        cadres={choices.cadres}
        canEdit
        canPublish
        canDelegate
        actions={{
          saveTemplate: saveTemplateAction,
          endTemplate: endTemplateAction,
          fillWeek: fillWeekAction,
          publishWeek: publishWeekAction,
          unlockWeek: unlockWeekAction,
          decideSwap: decideSwapAction,
          addDelegate: addDelegateAction,
          revokeDelegate: revokeDelegateAction,
          createPost: createPostAction,
          archivePost: archivePostAction,
          assignDuty: assignDutyAction,
          endDuty: endDutyAction,
        }}
      />
    </div>
  );
}
