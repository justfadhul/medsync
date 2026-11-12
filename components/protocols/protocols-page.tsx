import "server-only";

import type { PickChip } from "./chart-screen";
import type { EmrSurface } from "@/lib/emr/actor";
import type { ChartVersion } from "@/lib/protocols/engine/types";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ArrowLeftIcon } from "lucide-react";

import { CHART_COPY as C, fill } from "@/content/protocol-charts";
import { db } from "@/db";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { encounters } from "@/db/schema/scheduling";
import { requireEmrActor } from "@/lib/emr/actor";
import { formatClock } from "@/lib/emr/charts/scale";
import { protocolsLiveFor } from "@/lib/emr/feature";
import { loadRunningCharts } from "@/lib/emr/read/protocol-charts";
import { EmrWriteError, withPatientWrite } from "@/lib/emr/write/context";
import { listPatientCharts, loadChart } from "@/lib/emr/write/protocol-charts";
import { listProtocols } from "@/lib/emr/write/protocols";
import { pharmacyStockAnswerLiveFor } from "@/lib/pharmacy/feature";
import { stockLinesFor } from "@/lib/pharmacy/stock/availability-read";
import { drugById } from "@/lib/prescribing/formulary";
import { stockLineWords } from "@/lib/prescribing/pharmacy";
import { isLocalDev } from "@/lib/protocols/quick";
import { RULE_MODULES } from "@/lib/protocols/rules";
import { ChartScreen } from "./chart-screen";
import { StartCard } from "./start-chart";

// Server-rendered per request: the clock, moved ahead only by the local dev clock.
const clockAhead = (minutes: number) => new Date(Date.now() + minutes * 60_000);

/** The protocol's short word for the pickers ("DKA"); a builder protocol keeps its name. */
const shortOf = (protocolId: string, name: string) =>
  RULE_MODULES[protocolId]?.short({ name } as ChartVersion) ?? name;

/** Patient codes (the nurse Tasks page shows the same). */
async function codesOf(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db
    .select({ id: patientProfiles.id, code: patientProfiles.patientCode })
    .from(patientProfiles)
    .where(inArray(patientProfiles.id, ids));
  return new Map(rows.map((r) => [r.id, r.code]));
}

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
  start,
}: {
  surface: Extract<EmrSurface, "doctor" | "nurse">;
  patientId: string;
  chartId?: string;
  /** `?at=` minutes: the chart clock, local development only. */
  at?: string;
  /** `?start=` a protocol id: its start card (the prototype's "Start the … chart for …"). */
  start?: string;
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
      const charts = await listPatientCharts(ctx, patientId);
      const list = await listProtocols(ctx);
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
        const running = await loadRunningCharts(ctx.tx, actor.hospitalId);
        return { kind: "chart" as const, ...c, stock, charts, list, running };
      }
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

  const live = data.charts.filter((c) => !c.endedAt);
  const protocolChips = (on: string | null): PickChip[] =>
    data.list.items.map((i) => {
      const c = live.find((x) => x.protocolId === i.protocolId);
      return {
        key: i.protocolId,
        word: shortOf(i.protocolId, i.name),
        href: c
          ? `${base}/protocols/${c.id}`
          : `${base}/protocols?start=${encodeURIComponent(i.protocolId)}`,
        on: i.protocolId === on,
      };
    });

  if (data.kind === "chart") {
    const names = Object.fromEntries(
      data.view.meds.map((m) => [m.drug, drugById(m.drug)?.generic ?? m.drug]),
    );
    // The patient picker: this patient, then the ward's other patients on this protocol.
    const others = data.running.filter(
      (r) => r.name === data.version.name && r.patientUserId !== patientId,
    );
    const codes = await codesOf([patientId, ...others.map((r) => r.patientUserId)]);
    const onIt = fill(C.onTheChart, { short: data.view.short });
    const patients: PickChip[] = [
      {
        key: patientId,
        word: `${codes.get(patientId) ?? ""}${data.view.endedAt === null ? ` · ${onIt}` : ""}`,
        href: `${base}/protocols/${data.chart.id}`,
        on: true,
      },
      ...others.map((r) => ({
        key: r.patientUserId,
        word: `${codes.get(r.patientUserId) ?? ""} · ${onIt}`,
        href: `/${surface}/patients/${r.patientUserId}/protocols/${r.id}`,
        on: false,
      })),
    ];
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
          patientLabel={codes.get(patientId) ?? ""}
          protocols={protocolChips(data.chart.protocolId)}
          patients={patients}
          now={now.getTime()}
        />
      </div>
    );
  }

  const nameOf = new Map(data.list.items.map((i) => [i.protocolId, i.name]));
  const ended = data.charts.filter((c) => c.endedAt);
  const code = (await codesOf([patientId])).get(patientId) ?? "";
  const pick = start ? data.list.items.find((i) => i.protocolId === start) : undefined;
  const pickShort = pick ? shortOf(pick.protocolId, pick.name) : "";
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 py-6 md:px-8">
      {back}
      <section className="bg-card shadow-card flex flex-col gap-2.5 rounded-2xl px-4 py-3.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-overline text-muted-foreground uppercase">{C.kicker}</span>
          <h1 className="text-heading-l text-foreground">
            {C.areaTitle}
            {code ? ` · ${code}` : ""}
          </h1>
          <span className="text-body-s text-muted-foreground">{C.areaSub}</span>
        </div>
        <ChipRow label={C.protocolLabel} items={protocolChips(pick?.protocolId ?? null)} />
      </section>
      {pick ? (
        <StartCard
          patientUserId={patientId}
          encounterId={data.encounterId}
          base={`${base}/protocols`}
          canStart={surface === "doctor"}
          title={fill(C.startFor, { short: pickShort, patient: code })}
          short={pickShort}
          item={{
            versionId: pick.versionId,
            source: pick.source,
            signed: pick.status === "signed",
            startable: pick.startable,
          }}
        />
      ) : (
        <section className="bg-card shadow-card flex flex-col gap-2.5 rounded-2xl px-4 py-3.5">
          <h2 className="text-heading-m text-foreground">{C.running}</h2>
          {live.length ? (
            <ul className="flex flex-col gap-2">
              {live.map((c) => (
                <li
                  key={c.id}
                  className="bg-teal-tint flex flex-wrap items-center gap-2.5 rounded-xl px-3.5 py-2.5"
                >
                  <span className="text-body-s text-muted-foreground min-w-0 flex-1">
                    <b className="text-foreground font-semibold">
                      {nameOf.get(c.protocolId) ?? c.protocolId}
                    </b>{" "}
                    · {fill(C.startedAt, { t: formatClock(c.startedAt) })}
                  </span>
                  <Link
                    href={`${base}/protocols/${c.id}`}
                    className="bg-card text-label text-teal-text inline-flex min-h-8 items-center rounded-full px-3.5"
                  >
                    {C.openChart}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-border bg-muted text-body-s text-muted-foreground rounded-xl border border-dashed px-3.5 py-3">
              {C.runningNone} {C.pickProtocol}
            </p>
          )}
          {ended.length ? (
            <>
              <h3 className="text-heading-s text-foreground mt-1">{C.ended}</h3>
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
            </>
          ) : null}
        </section>
      )}
    </div>
  );
}

/** A picker row of links, as the chart header's (the prototype's protocol chips). */
function ChipRow({ label, items }: { label: string; items: PickChip[] }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1.5 overflow-x-auto">
      <span className="text-label text-muted-foreground shrink-0">{label}</span>
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.on ? "page" : undefined}
          className={
            i.on
              ? "bg-primary text-primary-foreground text-label inline-flex h-8 shrink-0 items-center rounded-full px-3 whitespace-nowrap"
              : "bg-card text-foreground ring-border hover:bg-muted text-label inline-flex h-8 shrink-0 items-center rounded-full px-3 whitespace-nowrap ring-1 ring-inset"
          }
        >
          {i.word}
        </Link>
      ))}
    </div>
  );
}
