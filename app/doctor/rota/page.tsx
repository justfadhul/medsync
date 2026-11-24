import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, asc, eq, gt, isNull, lte, or } from "drizzle-orm";

import { Panel } from "@/components/medsync/panel";
import { Tag } from "@/components/medsync/tag";
import { when } from "@/components/rota/gap-report";
import { RotaWeek } from "@/components/rota/rota-week";
import { WeekNav } from "@/components/rota/week-nav";
import { DUTY_ROTA_COPY } from "@/content/duty-rota";
import { db } from "@/db";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { departmentHeads } from "@/db/schema/services-hub";
import { requireDoctorScope } from "@/lib/doctor/scope";
import { rotaWeekStart } from "@/lib/rota/cover";
import { dutyRotaLiveFor } from "@/lib/rota/feature";
import { loadRotaWeek, myDuties, rotaChoices } from "@/lib/rota/read";
import { archivePostAction, assignDutyAction, createPostAction, endDutyAction } from "./actions";

const P = DUTY_ROTA_COPY.page;
const M = DUTY_ROTA_COPY.mine;
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
  const [mine, rotas] = await Promise.all([
    myDuties(scope.userId, scope.hospitalId, now),
    Promise.all(
      headed.map(async (d) => {
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
      <Panel title={M.title} count={mine.length}>
        <p className="text-muted-foreground text-caption px-4 pt-3">
          {DUTY_ROTA_COPY.plannedNotPresent}
        </p>
        {mine.length ? (
          <ul className="divide-border divide-y">
            {mine.map((m, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <span className="text-label text-foreground">{m.postName}</span>
                <span className="text-muted-foreground text-caption tabular-nums">
                  {M.until(when(m.until))}
                </span>
                <Tag>{DUTY_ROTA_COPY.state[m.state]}</Tag>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-body-s px-4 py-3">{M.none}</p>
        )}
      </Panel>
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
