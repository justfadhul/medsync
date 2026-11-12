import "server-only";

import type { EmrSurface } from "@/lib/emr/actor";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ArrowLeftIcon } from "lucide-react";

import { CHART_COPY as C, fill } from "@/content/protocol-charts";
import { encounters } from "@/db/schema/scheduling";
import { requireEmrActor } from "@/lib/emr/actor";
import { formatClock } from "@/lib/emr/charts/scale";
import { protocolsLiveFor } from "@/lib/emr/feature";
import { EmrWriteError, withPatientWrite } from "@/lib/emr/write/context";
import { listPatientCharts, loadChart } from "@/lib/emr/write/protocol-charts";
import { listProtocols } from "@/lib/emr/write/protocols";
import { pharmacyStockAnswerLiveFor } from "@/lib/pharmacy/feature";
import { stockLinesFor } from "@/lib/pharmacy/stock/availability-read";
import { drugById } from "@/lib/prescribing/formulary";
import { stockLineWords } from "@/lib/prescribing/pharmacy";
import { isLocalDev } from "@/lib/protocols/quick";
import { ChartScreen } from "./chart-screen";
import { StartChart } from "./start-chart";

// Server-rendered per request: the clock, moved ahead only by the local dev clock.
const clockAhead = (minutes: number) => new Date(Date.now() + minutes * 60_000);

/**
 * The patient record › Protocols (F7, FIT-MAP): the patient's charts and the start picker, or one
 * chart. Read through the write context (the access rule and the patient's facts in one
 * transaction); nothing is written. The role comes from the signed-in user's cadre.
 */
export async function ProtocolsPage({
  surface,
  patientId,
  chartId,
  at,
}: {
  surface: Extract<EmrSurface, "doctor" | "nurse">;
  patientId: string;
  chartId?: string;
  /** `?at=` minutes: the chart clock, local development only. */
  at?: string;
}) {
  const actor = await requireEmrActor(surface);
  if (!protocolsLiveFor(actor.hospitalId)) notFound();
  const base = `/${surface}/patients/${patientId}`;
  const dev = isLocalDev() ? Math.max(0, Math.min(100_000, Number(at) || 0)) : null;
  const now = clockAhead(dev ?? 0);

  const data = await withPatientWrite(
    actor,
    patientId,
    async (ctx) => {
      if (chartId) {
        const c = await loadChart(ctx, { chartId, patientUserId: patientId });
        const ids = c.view.meds.map((m) => m.drug);
        const stock =
          c.chart.encounterId && ids.length && pharmacyStockAnswerLiveFor(actor.hospitalId)
            ? Object.fromEntries(
                [
                  ...(
                    await stockLinesFor(ctx.tx, {
                      hospitalId: actor.hospitalId,
                      encounterId: c.chart.encounterId,
                      medicineIds: ids,
                      now: ctx.now,
                    })
                  ).entries(),
                ].map(([id, l]) => [id, stockLineWords(l)]),
              )
            : {};
        return { kind: "chart" as const, ...c, stock };
      }
      const charts = await listPatientCharts(ctx, patientId);
      const list = await listProtocols(ctx);
      const [enc] = await ctx.tx
        .select({ id: encounters.id })
        .from(encounters)
        .where(
          and(
            eq(encounters.patientUserId, patientId),
            eq(encounters.hospitalId, actor.hospitalId),
            inArray(encounters.state, ["planned", "in_progress"]),
          ),
        )
        .orderBy(desc(encounters.createdAt))
        .limit(1);
      return { kind: "list" as const, charts, list, encounterId: enc?.id ?? null };
    },
    { now },
  ).catch((e) => {
    if (e instanceof EmrWriteError && (e.code === "forbidden" || e.code === "not_found"))
      notFound();
    throw e;
  });

  const back = (
    <Link
      href={chartId ? `${base}/protocols` : base}
      className="text-body-s text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
    >
      <ArrowLeftIcon className="size-3.5" aria-hidden />
      {chartId ? C.areaTitle : C.previous}
    </Link>
  );

  if (data.kind === "chart") {
    const names = Object.fromEntries(
      data.view.meds.map((m) => [m.drug, drugById(m.drug)?.generic ?? m.drug]),
    );
    return (
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 py-6 md:px-8">
        {back}
        <ChartScreen
          view={data.view}
          role={data.role}
          surface={surface}
          patientUserId={patientId}
          chartId={data.chart.id}
          stock={data.stock}
          names={names}
          prescribeHref={surface === "doctor" ? `${base}/prescribe` : null}
          devClock={dev}
        />
      </div>
    );
  }

  const nameOf = new Map(data.list.items.map((i) => [i.protocolId, i.name]));
  const running = data.charts.filter((c) => !c.endedAt);
  const ended = data.charts.filter((c) => c.endedAt);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      {back}
      <header className="flex flex-col gap-1.5">
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.16em] uppercase">
          {C.kicker}
        </span>
        <h1 className="font-display text-display-s text-foreground">{C.areaTitle}</h1>
        <p className="text-muted-foreground text-body-s max-w-[60ch]">{C.areaSub}</p>
      </header>
      <section className="flex flex-col gap-2">
        <h2 className="text-heading-s text-foreground">{C.running}</h2>
        {running.length ? (
          <ul className="flex flex-col gap-2">
            {running.map((c) => (
              <li key={c.id}>
                <Link
                  href={`${base}/protocols/${c.id}`}
                  className="border-border bg-card hover:bg-muted/50 flex flex-col gap-0.5 rounded-lg border px-3 py-2.5"
                >
                  <span className="text-label text-foreground">
                    {nameOf.get(c.protocolId) ?? c.protocolId}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {fill(C.startedAt, { t: formatClock(c.startedAt) })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-s text-muted-foreground">{C.runningNone}</p>
        )}
      </section>
      {surface === "doctor" && data.encounterId ? (
        <StartChart
          patientUserId={patientId}
          encounterId={data.encounterId}
          base={`${base}/protocols`}
          items={data.list.items
            .filter((i) => !running.some((c) => c.protocolId === i.protocolId))
            .map((i) => ({
              versionId: i.versionId,
              name: i.name,
              source: i.source,
              signed: i.status === "signed",
              startable: i.startable,
            }))}
        />
      ) : null}
      {ended.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-heading-s text-foreground">{C.ended}</h2>
          <ul className="flex flex-col gap-1.5">
            {ended.map((c) => (
              <li key={c.id}>
                <Link
                  href={`${base}/protocols/${c.id}`}
                  className="text-body-s text-foreground underline-offset-4 hover:underline"
                >
                  {fill(C.endedLine, {
                    short: nameOf.get(c.protocolId) ?? c.protocolId,
                    t: formatClock(c.endedAt!),
                    reason: c.endReason ?? "",
                  })}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
