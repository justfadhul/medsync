import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, asc, eq, gt, isNull, lte, or } from "drizzle-orm";

import { MyDuties } from "@/components/rota/my-duties";
import { RotaWeek } from "@/components/rota/rota-week";
import { WeekNav } from "@/components/rota/week-nav";
import { DUTY_ROTA_COPY } from "@/content/duty-rota";
import { db } from "@/db";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { departmentHeads } from "@/db/schema/services-hub";
import { requireDoctorScope } from "@/lib/doctor/scope";
import { rotaWeekStart } from "@/lib/rota/cover";
import { dutyRotaLiveFor } from "@/lib/rota/feature";
import {
  delegatedDepartments,
  loadRotaWeek,
  rotaChoices,
  swapOptions,
  swapsAskedOfMe,
} from "@/lib/rota/read";
import {
  addDelegateAction,
  answerSwapAction,
  archivePostAction,
  askSwapAction,
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
export const metadata: Metadata = { title: P.metaTitle("Doctor") };
export const dynamic = "force-dynamic";

/**
 * The heads' rota (ADR 0534): the week grid for each department the doctor heads (substantive or acting, in office
 * now), and their own duties, read only. The 0307 guard decides every write. Behind DUTY_ROTA; off, not found.
 */
export default async function DoctorRotaPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string | string[] }>;
}) {
  const scope = await requireDoctorScope();
  if (!dutyRotaLiveFor(scope.hospitalId)) notFound();
  const sp = await searchParams;
  const now = new Date();
  const weekStart = rotaWeekStart(typeof sp.week === "string" ? sp.week : undefined, now);
  const headed = await db
    .selectDistinct({ id: hospitalDepartments.id, name: hospitalDepartments.name })
    .from(departmentHeads)
    .innerJoin(hospitalDepartments, eq(hospitalDepartments.id, departmentHeads.departmentId))
    .where(
      and(
        eq(departmentHeads.hospitalId, scope.hospitalId),
        eq(departmentHeads.userId, scope.userId),
        lte(departmentHeads.startsAt, now),
        or(isNull(departmentHeads.endsAt), gt(departmentHeads.endsAt, now)),
        isNull(hospitalDepartments.archivedAt),
      ),
    )
    .orderBy(asc(hospitalDepartments.name));
  // Owners (heads) keep every right; a hand-over carries its own publish right and cannot be passed on (R52).
  const delegated = (await delegatedDepartments(scope.userId, scope.hospitalId)).filter(
    (d) => !headed.some((h) => h.id === d.id),
  );
  const departments = [
    ...headed.map((d) => ({ ...d, owner: true, canPublish: true })),
    ...delegated.map((d) => ({ ...d, owner: false })),
  ];
  const [mine, asked, rotas] = await Promise.all([
    swapOptions(scope.userId, scope.hospitalId, now),
    swapsAskedOfMe(scope.userId, scope.hospitalId),
    Promise.all(
      departments.map(async (d) => {
        const [week, choices] = await Promise.all([
          loadRotaWeek(scope.hospitalId, d.id, weekStart, { now }),
          rotaChoices(scope.hospitalId, d.id),
        ]);
        return { d, week, choices };
      }),
    ),
  ]);
  const actions = {
    createPost: createPostAction,
    archivePost: archivePostAction,
    assignDuty: assignDutyAction,
    endDuty: endDutyAction,
    saveTemplate: saveTemplateAction,
    endTemplate: endTemplateAction,
    fillWeek: fillWeekAction,
    publishWeek: publishWeekAction,
    unlockWeek: unlockWeekAction,
    askSwap: askSwapAction,
    decideSwap: decideSwapAction,
    addDelegate: addDelegateAction,
    revokeDelegate: revokeDelegateAction,
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8 lg:py-10">
      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.16em] uppercase">
          {P.overline}
        </span>
        <h1 className="font-display text-display-s text-foreground">{P.title}</h1>
        <p className="text-muted-foreground max-w-[60ch] text-[12.5px] leading-relaxed">
          {P.headLead}
        </p>
      </header>
      <MyDuties duties={mine} asked={asked} ask={askSwapAction} answer={answerSwapAction} />
      {rotas.length ? (
        <>
          <WeekNav weekStart={weekStart} base="/doctor/rota?" />
          {rotas.map(({ d, week, choices }) => (
            <RotaWeek
              key={d.id}
              week={week}
              departmentId={d.id}
              departmentName={d.name}
              weekStart={weekStart}
              wards={choices.wards}
              cadres={choices.cadres}
              canEdit
              canPublish={d.canPublish}
              canDelegate={d.owner}
              viewerId={scope.userId}
              actions={actions}
            />
          ))}
        </>
      ) : (
        <p className="text-muted-foreground text-body-s">{P.noHeads}</p>
      )}
    </div>
  );
}
