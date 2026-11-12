import type { TaskView } from "./_components/task-list";
import type { NurseTaskRow } from "@/lib/emr/read/nursing";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { inArray } from "drizzle-orm";

import { EmptyState } from "@/components/tide/work/kit";
import { fill } from "@/content/lab-workspace-v2";
import { NURSE_TASKS_COPY as C } from "@/content/nurse-tasks";
import { CHART_COPY as P } from "@/content/protocol-charts";
import { db } from "@/db";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { formatClock } from "@/lib/emr/charts/scale";
import { asClinicalReader } from "@/lib/emr/db";
import { nurseTasksLiveFor, protocolsLiveFor } from "@/lib/emr/feature";
import { loadNurseTasks } from "@/lib/emr/read/nursing";
import { loadRunningCharts } from "@/lib/emr/read/protocol-charts";
import { requireNurseScope } from "@/lib/nurse/scope";
import { dur } from "@/lib/protocols/engine/kit";
import { TaskList } from "./_components/task-list";

export const metadata: Metadata = { title: "Tasks · Nurse · MedSync" };
export const dynamic = "force-dynamic";

type Payload = {
  drugs?: string[];
  first?: string;
  test?: string;
  unit?: string;
  title?: string;
  sub?: string;
  chartId?: string;
  short?: string;
};

function titleOf(t: NurseTaskRow): string {
  const p = t.payload as Payload;
  if (t.type === "iv_cannula") return C.ivTitle;
  if (t.type === "enter_result") return fill(C.resultTitle, { test: p.test ?? "" });
  if (t.type === "protocol_step") return p.title ?? "";
  return t.type;
}

function whyOf(t: NurseTaskRow): string | null {
  const p = t.payload as Payload;
  if (t.type === "protocol_step") return [p.short, p.sub].filter(Boolean).join(" · ") || null;
  if (t.type !== "iv_cannula") return null;
  return fill(C.ivWhy, {
    names: (p.drugs ?? []).join(", "),
    first: p.first === "next_round" ? C.firstNextRound : C.firstNow,
  });
}

function resultOf(t: NurseTaskRow): string {
  const o = (t.outcome ?? {}) as { size?: string; site?: string };
  return o.size && o.site ? fill(C.ivResult, { size: o.size, site: o.site }) : C.done;
}

// Server-rendered on each request: the time on the chart as of this render.
const hoursSince = (at: Date) => dur(Date.now() - at.getTime());

/** Nurse tasks (prescribing kit P2 (b), F5): what the prescriptions asked the nurses to do. */
export default async function NurseTasksPage() {
  const scope = await requireNurseScope();
  if (!nurseTasksLiveFor(scope.hospitalId)) notFound();
  const { open, done, running } = await asClinicalReader(
    { userId: scope.userId, hospitalId: scope.hospitalId },
    async (tx) => ({
      ...(await loadNurseTasks(tx, scope.hospitalId)),
      running: protocolsLiveFor(scope.hospitalId)
        ? await loadRunningCharts(tx, scope.hospitalId)
        : null,
    }),
  );
  const ids = [...new Set([...open, ...done, ...(running ?? [])].map((t) => t.patientUserId))];
  const codes = new Map(
    ids.length
      ? (
          await db
            .select({ id: patientProfiles.id, code: patientProfiles.patientCode })
            .from(patientProfiles)
            .where(inArray(patientProfiles.id, ids))
        ).map((r) => [r.id, r.code])
      : [],
  );
  const view = (t: NurseTaskRow): TaskView => ({
    id: t.id,
    type: t.type,
    patientUserId: t.patientUserId,
    patient: codes.get(t.patientUserId) ?? "",
    title: titleOf(t),
    why: whyOf(t),
    asked: fill(C.asked, { at: formatClock(t.createdAt), by: C.byPrescriber }),
    unit: (t.payload as Payload).unit ?? null,
    href:
      t.type === "protocol_step" && (t.payload as Payload).chartId
        ? `/nurse/patients/${t.patientUserId}/protocols/${(t.payload as Payload).chartId}`
        : null,
    doneLine:
      t.status === "done" && t.doneAt
        ? fill(C.doneLine, {
            title: titleOf(t),
            patient: codes.get(t.patientUserId) ?? "",
            result: resultOf(t),
            at: formatClock(t.doneAt),
          })
        : null,
  });

  // The prototype's NURSES block: the header, then one card with Protocols running and Tasks.
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-1">
        <span className="text-overline text-muted-foreground uppercase">{C.kicker}</span>
        <h1 className="font-display text-display-s text-foreground">{C.title}</h1>
        <p className="text-muted-foreground text-body-s max-w-[60ch]">{C.sub}</p>
      </header>
      <div className="bg-card shadow-tide-card rounded-tide-card flex flex-col gap-3 p-4 sm:p-5">
        {running ? (
          <section aria-labelledby="nurse-running-h" className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="nurse-running-h" className="text-heading-m text-foreground">
                {P.running}
              </h2>
              <span className="text-caption text-muted-foreground tabular-nums">
                {running.length}
              </span>
            </div>
            {running.length ? (
              <ul className="flex flex-col gap-2">
                {running.map((r) => (
                  <li
                    key={r.id}
                    className="bg-muted rounded-tide-row flex flex-wrap items-center gap-2.5 px-3.5 py-2.5"
                  >
                    <span className="text-body-s min-w-0 flex-1">
                      <b className="text-foreground font-semibold">
                        {fill(C.runningHead, {
                          short: r.name,
                          patient: codes.get(r.patientUserId) ?? "",
                        })}
                      </b>{" "}
                      <span className="text-caption text-muted-foreground">
                        ·{" "}
                        {fill(C.runningMeta, {
                          d: hoursSince(r.startedAt),
                          last: r.lastAt ? formatClock(new Date(r.lastAt)) : "—",
                        })}
                      </span>
                    </span>
                    <Link
                      href={`/nurse/patients/${r.patientUserId}/protocols/${r.id}`}
                      className="bg-tide-lagoon-tint text-body-s text-foreground focus-visible:shadow-focus inline-flex min-h-11 items-center rounded-full px-4 font-semibold outline-none"
                    >
                      {P.openChart}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact title={P.runningNone} />
            )}
          </section>
        ) : null}
        <TaskList open={open.map(view)} done={done.map(view)} />
      </div>
    </div>
  );
}
