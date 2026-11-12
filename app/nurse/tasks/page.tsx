import type { TaskView } from "./_components/task-list";
import type { NurseTaskRow } from "@/lib/emr/read/nursing";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { inArray } from "drizzle-orm";

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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-1.5">
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.16em] uppercase">
          {C.kicker}
        </span>
        <h1 className="font-display text-display-s text-foreground">{C.title}</h1>
        <p className="text-muted-foreground text-body-s max-w-[60ch]">{C.sub}</p>
      </header>
      {running ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-heading-s text-foreground">{P.running}</h2>
          <p className="text-muted-foreground text-body-s">{P.runningSub}</p>
          {running.length ? (
            <ul className="flex flex-col gap-2">
              {running.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/nurse/patients/${r.patientUserId}/protocols/${r.id}`}
                    className="border-border bg-card hover:bg-muted/50 text-body-s text-foreground block rounded-lg border px-3 py-2.5"
                  >
                    {fill(P.runningLine, {
                      short: r.name,
                      patient: codes.get(r.patientUserId) ?? "",
                      d: hoursSince(r.startedAt),
                      last: r.lastAt ? formatClock(new Date(r.lastAt)) : "—",
                    })}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-body-s">{P.runningNone}</p>
          )}
        </section>
      ) : null}
      <TaskList open={open.map(view)} done={done.map(view)} />
    </div>
  );
}
