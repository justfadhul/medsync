"use client";

import type { QueueEntry } from "@/lib/emr/sync/queue";
import type { ActionResult } from "@/lib/emr/write/context";
import type {
  Act,
  Btn,
  ChartView,
  Field,
  FlowItem,
  FlowSt,
  Interp,
  Phase,
  Role,
  Step,
} from "@/lib/protocols/engine/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { OctagonAlertIcon, TriangleAlertIcon } from "lucide-react";

import { StatusWord } from "@/components/emr/status-word";
import { EditorDialog } from "@/components/medsync/editor-dialog";
import { TAG_BASE } from "@/components/medsync/tag";
import { Button } from "@/components/ui/button";
import { DialogTitle } from "@/components/ui/dialog";
import { CHART_COPY as C, fill } from "@/content/protocol-charts";
import {
  addChartNoteAction,
  changeParamAction,
  chartActAction,
  endChartAction,
  recordSlotAction,
  recordVitalsAction,
  sendChartOrderAction,
  undoChartEventAction,
} from "@/lib/emr/actions/protocol-charts";
import { formatClock } from "@/lib/emr/charts/scale";
import { attachToWindow, createWriteQueue } from "@/lib/emr/sync/queue";
import { cn } from "@/lib/utils";
import { MiniTrend, slotLabel, TrendsCard } from "./trends";

/**
 * One protocol chart, laid out as the prototype's (Main.dc.html, the PROTOCOLS block): a header
 * card (the protocol and patient pickers, the stat tiles, the recent line, the aims), then the
 * role's two screens behind one large switch — the doctor's "Steps and orders" (steps as a flow
 * chart or a list, the open step beside them, the medicines and notes), the nurse's "Tasks and
 * recording" (tasks, the record form and the check card, the medicines and notes), and the
 * "Monitoring chart" (trends, the vitals card, the time grid). The pharmacy reads the drug orders
 * and the chart from a rail. The role comes from the signed-in user's cadre, never a switch.
 *
 * Every button sends an act the server re-checks against the chart (P2, P6); a button that
 * belongs to the other cadre shows who does it, and does nothing. Workflow state is a grey square
 * tag and a word; colour marks only a value's clinical reading, always with its word or glyph.
 */

/** A picker chip: a protocol or a patient, as a link. */
export interface PickChip {
  key: string;
  word: string;
  href: string;
  on: boolean;
}

export interface ChartScreenProps {
  view: ChartView;
  role: Role;
  surface: "doctor" | "clinician" | "nurse";
  patientUserId: string;
  chartId: string;
  /** Medicine id → "On the shelf at Ward 4B…" (or "Stock not linked"). */
  stock: Record<string, string>;
  /** Medicine id → its generic name. */
  names: Record<string, string>;
  prescribeHref: string | null;
  /** Local development only: the chart clock offset in minutes. */
  devClock: number | null;
  /** The patient's code, beside the protocol's title. */
  patientLabel?: string;
  /** The protocol picker: each protocol, to its running chart or its start card. */
  protocols?: PickChip[];
  /** The patient picker: this patient, then the ward's other patients on this protocol. */
  patients?: PickChip[];
  /** The server's clock at render (ms), for the "now" marker and the stock time. */
  now?: number;
}

type Res = { ok: true } | { ok: false; error: string };

/** What a write is, for the offline rule (P11). */
export type ChartWrite = "slot" | "vitals" | "act" | "other";

/**
 * P11: offline, the nurse can still record a slot, record vitals and give a dose or mark a step: those
 * wait in the EMR outbox and are sent once, by their client key, when the connection is back. Every
 * doctor act (rates, doses, orders, sign and send), notes, parameters, ending and undo need a
 * connection; the server re-checks each queued act against the chart as it is when it arrives.
 */
export const queuesOffline = (role: Role, w: ChartWrite) =>
  role === "rn" && (w === "slot" || w === "vitals" || w === "act");

const QUEUE_LABEL = { slot: C.qSlot, vitals: C.qVitals, act: C.qAct, other: C.qAct } as const;
const NO_ENTRIES: readonly QueueEntry[] = [];

const STEP_WORD = { todo: C.toDo, needs: C.needsYou, done: C.done } as const;
const FLOW_WORD = { done: C.done, needs: C.needsYou, todo: C.toDo, later: C.later } as const;
const ROLE_WORD = { dr: C.roleWordDr, rn: C.roleWordRn, ph: C.roleWordPh } as const;
const ROLE_NOTE = { dr: C.roleNoteDr, rn: C.roleNoteRn, ph: C.roleNotePh } as const;
const lvlTone = (l: Interp["lvl"]) =>
  l === "crit" ? "critical" : l === "abn" ? "caution" : "neutral";
/** A value cell's background follows its clinical reading (never a workflow state). */
const lvlCell = (f: Interp | null) =>
  f?.lvl === "crit"
    ? "bg-status-critical-bg font-semibold"
    : f?.lvl === "abn"
      ? "bg-status-caution-bg font-semibold"
      : "";

const card = "bg-card shadow-card flex min-w-0 flex-col rounded-2xl";
const over = "text-overline text-muted-foreground uppercase";
const boxList =
  "border-border divide-border flex flex-col divide-y overflow-hidden rounded-xl border";
const placeholder =
  "border-border bg-muted text-body-s text-muted-foreground rounded-xl border border-dashed px-3.5 py-3";
const chipCls = (on: boolean) =>
  cn(
    "text-label inline-flex h-8 shrink-0 items-center rounded-full px-3 whitespace-nowrap",
    on
      ? "bg-primary text-primary-foreground"
      : "bg-card text-foreground ring-border hover:bg-muted ring-1 ring-inset",
  );

function GreyTag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        TAG_BASE,
        "border-border bg-muted text-muted-foreground rounded-none",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A clinical flag as a glyph and a hidden word, for cells too small to hold the word. */
function FlagGlyph({ f }: { f: Interp | null }) {
  if (!f || f.lvl === "ok") return null;
  const Icon = f.lvl === "crit" ? OctagonAlertIcon : TriangleAlertIcon;
  return (
    <>
      <Icon aria-hidden className="ml-0.5 inline size-3 shrink-0" />
      <span className="sr-only"> {f.word}</span>
    </>
  );
}

export function ChartScreen(p: ChartScreenProps) {
  const { view, role } = p;
  const router = useRouter();
  const [screen, setScreen] = useState<"work" | "chart">("work");
  const [phTab, setPhTab] = useState<"meds" | "chart">("meds");
  const [stepView, setStepView] = useState<"flow" | "list">("flow");
  const [sel, setSel] = useState<string | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const [undo, setUndo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const stepRef = useRef<HTMLDivElement>(null);
  const ended = view.endedAt !== null;
  const ids = { surface: p.surface, patientUserId: p.patientUserId, chartId: p.chartId };
  const slotMs = view.slotMinutes * 60_000;
  const nowMs = p.now ?? view.startedAt + view.hNow * slotMs;
  const isChart = role === "ph" ? phTab === "chart" : screen === "chart";

  // The EMR outbox (lib/emr/sync/queue.ts), as the clerking desk uses it: online, a write is sent
  // at once; offline, a nurse's entry waits here and is sent once, in order, when back online.
  const [queue] = useState(() => createWriteQueue({ now: () => Date.now() }));
  const waiting = useSyncExternalStore(queue.subscribe, queue.getSnapshot, () => NO_ENTRIES);
  useEffect(() => attachToWindow(queue, window), [queue]);

  const run = (
    fn: (raw: unknown) => Promise<Res>,
    input: Record<string, unknown>,
    then?: () => void,
    kind: ChartWrite = "other",
  ) => {
    const send = (clientKey: string) =>
      fn({ ...ids, clientKey, ...(p.devClock ? { devAt: p.devClock } : {}), ...input });
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      if (!queuesOffline(role, kind)) return setError(C.needsConnection);
      queue.submit({
        label: QUEUE_LABEL[kind],
        run: ({ clientKey }) => send(clientKey) as Promise<ActionResult<unknown>>,
        onSaved: () => router.refresh(),
      });
      setError(null);
      then?.();
      return;
    }
    start(async () => {
      const r = await send(crypto.randomUUID());
      if (!r.ok) setError(r.error || C.failed);
      else {
        setError(null);
        then?.();
        router.refresh();
      }
    });
  };
  const act = (a: Act, value?: string) => run(chartActAction, { act: a, value }, undefined, "act");

  // The steps this role works through, and the one open beside them (the prototype's pick: the
  // first that needs you, else the first not done in the current phase, else the first not done).
  const flat: { ph: Phase | null; a: Step }[] =
    role === "dr"
      ? view.phases.flatMap((ph) => ph.acts.map((a) => ({ ph, a })))
      : role === "rn"
        ? view.rn.acts.map((a) => ({ ph: null, a }))
        : [];
  const pickKey =
    sel && flat.some((x) => x.a.key === sel)
      ? sel
      : (
          flat.find((x) => x.a.status === "needs") ??
          flat.find((x) => x.ph?.id === view.phase.id && x.a.status !== "done") ??
          flat.find((x) => x.a.status !== "done") ??
          flat[0]
        )?.a.key;
  const idx = flat.findIndex((x) => x.a.key === pickKey);
  const cur = idx >= 0 ? flat[idx]! : null;
  const openStep = (k: string) => {
    setSel(k);
    // On a phone the open step sits under the steps: bring it into view.
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 859px)").matches)
      requestAnimationFrame(() => stepRef.current?.scrollIntoView({ block: "start" }));
  };

  const locked = (b: Btn) => {
    const who = role === "ph" ? (b.who ?? "dr") : b.who;
    if (!who || who === role) return null;
    return `${who === "rn" ? C.nurseDot : C.doctorDot}${b.word}`;
  };

  function ActButton({ b }: { b: Btn }) {
    if (b.act.t === "screen") {
      const to = b.act.to;
      return (
        <Button size="md" variant="link" onClick={() => setScreen(to)}>
          {b.word}
        </Button>
      );
    }
    if (b.act.t === "rx")
      return p.prescribeHref && role === "dr" ? (
        <Link
          href={p.prescribeHref}
          className="text-teal-text text-label underline-offset-[3px] hover:underline"
        >
          {b.word}
        </Link>
      ) : null;
    if (b.act.t === "proto") {
      const id = b.act.id;
      const to = p.protocols?.find((x) => x.key === id);
      return to ? (
        <Link
          href={to.href}
          className="text-teal-text text-label underline-offset-[3px] hover:underline"
        >
          {b.word}
        </Link>
      ) : null;
    }
    const lw = ended ? b.word : locked(b);
    if (lw)
      return (
        <span
          aria-disabled
          className="border-border text-label text-muted-foreground inline-flex min-h-8 items-center rounded-full border border-dashed px-3"
        >
          {lw}
        </span>
      );
    if (b.act.t === "end")
      return (
        <Button size="md" variant="soft" className="rounded-full" onClick={() => setEndOpen(true)}>
          {b.word}
        </Button>
      );
    const a = b.act;
    return (
      <Button
        size="md"
        variant={b.kind === "main" ? "soft" : b.kind === "link" ? "link" : "secondary"}
        className={b.kind === "link" ? undefined : "rounded-full"}
        disabled={pending}
        onClick={() => act(a)}
      >
        {b.word}
      </Button>
    );
  }

  const needsN = view.phases.reduce(
    (n, ph) => n + ph.acts.filter((a) => a.status === "needs").length,
    0,
  );
  const dueN = view.tasks.filter((t) => t.lvl !== "na").length;
  const nowLbl = slotLabel(view.hNow, view.slotMinutes);
  const screens = [
    {
      k: "work" as const,
      word: role === "dr" ? C.screenWorkDr : C.screenWorkRn,
      badge:
        role === "dr" ? (needsN ? String(needsN) : "") : dueN ? fill(C.dueCount, { n: dueN }) : "",
    },
    { k: "chart" as const, word: C.screenChart, badge: nowLbl },
  ];

  const notesCard = (
    <Notes
      view={view}
      busy={pending}
      ended={ended}
      onAdd={(text, done) => run(addChartNoteAction, { text }, done)}
    />
  );
  const logCard = <Log view={view} role={role} onUndo={setUndo} ended={ended} />;
  const stepPanel = cur ? (
    <div ref={stepRef} className="flex min-w-0 scroll-mt-4 flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={over}>
          {cur.ph
            ? `${cur.ph.title} · ${cur.ph.win}`
            : `${view.rn.title}${flat.length > 1 ? ` · ${fill(C.ofN, { i: idx + 1, n: flat.length })}` : ""}`}
        </span>
        {role === "dr" || flat.length > 1 ? (
          <div className="flex gap-1">
            <Button
              size="md"
              variant="secondary"
              className="rounded-full"
              disabled={idx <= 0}
              onClick={() => setSel(flat[idx - 1]!.a.key)}
            >
              {C.previousStep}
            </Button>
            <Button
              size="md"
              variant="secondary"
              className="rounded-full"
              disabled={idx >= flat.length - 1}
              onClick={() => setSel(flat[idx + 1]!.a.key)}
            >
              {C.nextStep}
            </Button>
          </div>
        ) : null}
      </div>
      <StepPanel
        s={cur.a}
        head={cur.ph ? fill(C.step, { n: cur.a.n }) : (cur.a.head ?? C.check)}
        role={role}
        ended={ended}
        busy={pending}
        ActButton={ActButton}
        onValue={(f, value) =>
          act(f.key === "weight" ? { t: "weight" } : { t: "value", key: f.key }, value)
        }
        onChip={(a) => act(a)}
      />
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-3.5">
      <Header
        p={p}
        ended={ended}
        busy={pending}
        onEnd={() => setEndOpen(true)}
        onReopen={() => run(endChartAction, { reopen: true })}
      />

      {error ? (
        <p role="alert">
          <StatusWord tone="caution">{error}</StatusWord>
        </p>
      ) : null}

      {waiting.length ? (
        <Outbox entries={waiting} onRetry={queue.retry} onDiscard={(k) => void queue.discard(k)} />
      ) : null}

      {role !== "ph" ? (
        <div
          role="tablist"
          aria-label={C.screenChart}
          className="bg-muted flex max-w-full gap-1 self-start overflow-x-auto rounded-2xl p-1"
        >
          {screens.map((x) => (
            <button
              key={x.k}
              type="button"
              role="tab"
              aria-selected={screen === x.k}
              onClick={() => setScreen(x.k)}
              className={cn(
                "text-body-m inline-flex min-h-11 items-center gap-2 rounded-xl px-5 font-semibold whitespace-nowrap",
                screen === x.k
                  ? "bg-card text-foreground shadow-card"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {x.word}
              {x.badge ? (
                <span className="bg-background text-caption text-muted-foreground rounded-full px-2 font-semibold">
                  {x.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {role === "ph" ? (
        <div className="flex flex-col items-start gap-4 min-[860px]:flex-row">
          <PharmacyRail
            view={view}
            tab={phTab}
            onTab={setPhTab}
            nowLbl={nowLbl}
            className="w-full min-[860px]:sticky min-[860px]:top-3 min-[860px]:w-[250px] min-[860px]:shrink-0"
          />
          <div className="flex w-full min-w-0 flex-1 flex-col gap-3">
            {isChart ? (
              <MonitoringChart
                view={view}
                role={role}
                busy={pending}
                ended={ended}
                nowSlot={(nowMs - view.startedAt) / slotMs}
                onVitals={() => undefined}
                onParam={() => undefined}
              />
            ) : (
              <Pharmacy
                view={view}
                names={p.names}
                stock={p.stock}
                patient={p.patientLabel ?? ""}
                stockAt={formatClock(new Date(nowMs))}
              />
            )}
          </div>
        </div>
      ) : isChart ? (
        <MonitoringChart
          view={view}
          role={role}
          busy={pending}
          ended={ended}
          nowSlot={(nowMs - view.startedAt) / slotMs}
          onVitals={(values, done) => run(recordVitalsAction, { values }, done, "vitals")}
          onParam={(input) => run(changeParamAction, input)}
        />
      ) : (
        <div
          className={cn(
            "grid items-start gap-3.5 min-[860px]:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]",
            role === "dr"
              ? "min-[1180px]:grid-cols-[minmax(250px,300px)_minmax(0,1fr)_minmax(280px,340px)]"
              : "min-[1180px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(260px,320px)]",
          )}
        >
          <div className="flex min-w-0 flex-col gap-2.5">
            {role === "dr" ? (
              <Steps
                view={view}
                mode={stepView}
                onMode={setStepView}
                selKey={pickKey ?? null}
                onOpen={openStep}
                ended={ended}
              />
            ) : (
              <Tasks view={view} ActButton={ActButton} />
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-2.5">
            {role === "rn" && !ended && !view.full && !view.blocked ? (
              <RecordForm
                view={view}
                busy={pending}
                onRecord={(values, done) => run(recordSlotAction, { values }, done, "slot")}
              />
            ) : null}
            {stepPanel}
          </div>
          <div className="flex min-w-0 flex-col gap-2.5 min-[860px]:col-span-2 min-[1180px]:col-span-1">
            {role === "dr" ? (
              <Medicines
                view={view}
                names={p.names}
                stock={p.stock}
                stockAt={formatClock(new Date(nowMs))}
                busy={pending}
                ended={ended}
                onSend={() =>
                  run(sendChartOrderAction, { place: "ward", answers: {}, witness: null })
                }
              />
            ) : (
              <NurseMeds view={view} names={p.names} />
            )}
            {notesCard}
            {logCard}
          </div>
        </div>
      )}

      <ReasonDialog
        open={endOpen}
        title={C.endTitle}
        label={C.endReason}
        confirm={C.endConfirm}
        busy={pending}
        onClose={() => setEndOpen(false)}
        onConfirm={(reason) => run(endChartAction, { reason }, () => setEndOpen(false))}
      />
      <ReasonDialog
        open={!!undo}
        title={C.undoTitle}
        label={C.undoReason}
        confirm={C.undoConfirm}
        busy={pending}
        onClose={() => setUndo(null)}
        onConfirm={(reason) =>
          run(undoChartEventAction, { eventId: undo, reason }, () => setUndo(null))
        }
      />
    </div>
  );
}

/* ─── Header ─────────────────────────────────────────────────────── */

function PickRow({ label, items }: { label: string; items: PickChip[] }) {
  if (!items.length) return null;
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1.5 overflow-x-auto">
      <span className="text-label text-muted-foreground shrink-0">{label}</span>
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.on ? "page" : undefined}
          className={chipCls(i.on)}
        >
          {i.word}
        </Link>
      ))}
    </div>
  );
}

function Header({
  p,
  ended,
  busy,
  onEnd,
  onReopen,
}: {
  p: ChartScreenProps;
  ended: boolean;
  busy: boolean;
  onEnd: () => void;
  onReopen: () => void;
}) {
  const { view, role } = p;
  const recent = view.log
    .slice(0, 4)
    .map((l) => `${formatClock(new Date(l.at))} ${l.text}`)
    .join(" · ");
  return (
    <section className={cn(card, "gap-2.5 px-4 py-3.5")}>
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-0.5">
          <span className={over}>{view.over}</span>
          <h1 className="text-heading-l text-foreground">
            {view.title}
            {p.patientLabel ? ` · ${p.patientLabel}` : ""}
          </h1>
          <span className="text-body-s text-muted-foreground">
            {fill(C.startedAt, { t: formatClock(new Date(view.startedAt)) })} · {view.nowWord} ·{" "}
            {view.phase.title} · {view.phase.win}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {ended ? (
            <>
              <GreyTag>{fill(C.endedTag, { reason: view.endReason ?? "" })}</GreyTag>
              {role === "dr" ? (
                <Button size="md" variant="link" disabled={busy} onClick={onReopen}>
                  {C.reopenShort}
                </Button>
              ) : null}
            </>
          ) : role === "dr" ? (
            <Button size="md" variant="link" onClick={onEnd}>
              {C.endTitle}
            </Button>
          ) : null}
          {p.devClock !== null ? <DevClock minutes={p.devClock} /> : null}
        </div>
      </div>
      <PickRow label={C.protocolLabel} items={p.protocols ?? []} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-label text-muted-foreground">{C.viewingAs}</span>
        <GreyTag className="text-foreground">{ROLE_WORD[role]}</GreyTag>
        <span className="text-body-s text-muted-foreground">{ROLE_NOTE[role]}</span>
      </div>
      <PickRow label={C.patientLabel} items={p.patients ?? []} />
      {view.blocked ? <StatusWord tone="caution">{view.blocked}</StatusWord> : null}
      {view.stats.length ? (
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(118px,1fr))] gap-1.5">
          {view.stats.map((s) => (
            <div
              key={s.k}
              title={s.s}
              className="bg-muted flex min-w-0 flex-col rounded-xl px-2.5 py-1.5"
            >
              <dt className="text-label text-muted-foreground">{s.k}</dt>
              <dd className="text-body-m text-foreground font-semibold">{s.v}</dd>
              {s.cls === "warn" ? (
                <dd>
                  <StatusWord tone="caution" className="whitespace-normal">
                    {s.s}
                  </StatusWord>
                </dd>
              ) : null}
            </div>
          ))}
        </dl>
      ) : null}
      {ended ? (
        <p className="bg-muted text-body-s text-foreground rounded-xl px-3 py-2">
          {fill(C.endedLine2, {
            short: view.short,
            t: formatClock(new Date(view.endedAt!)),
            reason: view.endReason ?? "",
          })}
        </p>
      ) : null}
      {role !== "ph" && recent ? (
        <span className="text-body-s text-muted-foreground">
          <b className="text-foreground font-semibold">{C.recent}</b> · {recent}
        </span>
      ) : null}
      {view.aims.length ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="text-label text-muted-foreground">{C.aims}</span>
          {view.aims.map((a) => (
            <StatusWord key={a.word} tone={a.known && !a.ok ? "caution" : "neutral"}>
              <b className="text-overline uppercase">{a.ok ? C.met : a.known ? C.notMet : "—"}</b>{" "}
              {a.word}
            </StatusWord>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/* ─── Steps: the flow chart and the list ─────────────────────────── */

function Steps({
  view,
  mode,
  onMode,
  selKey,
  onOpen,
  ended,
}: {
  view: ChartView;
  mode: "flow" | "list";
  onMode: (m: "flow" | "list") => void;
  selKey: string | null;
  onOpen: (k: string) => void;
  ended: boolean;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <h2 className="text-heading-m text-foreground">{C.stepsTitle}</h2>
        <div role="group" aria-label={C.stepsAs} className="bg-muted flex gap-1 rounded-full p-1">
          {(["flow", "list"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => onMode(m)}
              className={cn(
                "text-label min-h-8 rounded-full px-3",
                mode === m ? "bg-primary text-primary-foreground" : "text-foreground",
              )}
            >
              {m === "flow" ? C.flowView : C.listView}
            </button>
          ))}
        </div>
      </div>
      <span className="text-body-s text-muted-foreground">{C.stepsHint}</span>
      {mode === "flow" ? (
        <>
          <Flow items={view.flow} selKey={selKey} onOpen={onOpen} />
          <ul className="text-caption text-muted-foreground flex flex-wrap gap-x-2.5 gap-y-1">
            <li className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="bg-teal-tint ring-primary h-2.5 w-3.5 rounded-[3px] ring-[1.5px] ring-inset"
              />
              {C.keyPath}
            </li>
            <li className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="ring-border h-2.5 w-3.5 rounded-[3px] ring-1 ring-inset"
              />
              {C.keyOff}
            </li>
            <li className="inline-flex items-center gap-1.5">
              <span aria-hidden className="bg-muted h-2.5 w-3.5 rounded-[3px]" />
              {C.keyUnknown}
            </li>
          </ul>
        </>
      ) : (
        view.phases
          .filter((ph) => ph.acts.length)
          .map((ph) => {
            const done = ph.acts.filter((a) => a.status === "done").length;
            const needs = ph.acts.filter((a) => a.status === "needs").length;
            return (
              <div key={ph.id} className="flex flex-col gap-1.5">
                <div
                  className="mt-1.5 flex min-w-0 items-center gap-2"
                  title={`${ph.title} · ${ph.win}`}
                >
                  <h3 className="text-heading-s text-foreground truncate">{ph.title}</h3>
                  {view.phase.id === ph.id && !ended ? <GreyTag>{C.now}</GreyTag> : null}
                  <span className="grow" />
                  <span className="text-caption text-muted-foreground shrink-0 font-semibold">
                    {fill(C.countDone, { done, n: ph.acts.length })}
                    {needs ? ` · ${fill(C.stepsNeedYou, { n: needs })}` : ""}
                  </span>
                </div>
                <div className={cn(card, "overflow-hidden rounded-xl")}>
                  {ph.acts.map((a) => (
                    <StepRow key={a.key} s={a} on={a.key === selKey} onOpen={onOpen} />
                  ))}
                </div>
              </div>
            );
          })
      )}
    </>
  );
}

/** A step's state as a mark: filled (done), ringed (needs you), empty (to do), with its word. */
function StateMark({ st }: { st: FlowSt }) {
  return (
    <>
      <span
        aria-hidden
        className={cn(
          "size-2.5 shrink-0 rounded-full",
          st === "done"
            ? "bg-foreground"
            : st === "needs"
              ? "ring-foreground bg-card ring-2"
              : "bg-border",
        )}
      />
      <span className="sr-only">{FLOW_WORD[st]}</span>
    </>
  );
}

function StepRow({ s, on, onOpen }: { s: Step; on: boolean; onOpen: (k: string) => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onOpen(s.key)}
      className={cn(
        "border-border flex min-w-0 items-center gap-2.5 border-t px-3 py-2 text-left first:border-t-0",
        on ? "bg-teal-tint ring-primary ring-2 ring-inset" : "hover:bg-muted",
      )}
    >
      <span
        className={cn(
          "text-caption inline-flex size-[22px] shrink-0 items-center justify-center rounded-full font-semibold",
          on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {s.n}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-label text-foreground">{s.title}</span>
        {s.brief ? (
          <span className="text-caption text-muted-foreground truncate">{s.brief}</span>
        ) : null}
      </span>
      {s.status === "needs" ? (
        <GreyTag className="text-foreground border-foreground/40">{STEP_WORD.needs}</GreyTag>
      ) : (
        <StateMark st={s.status} />
      )}
    </button>
  );
}

function Flow({
  items,
  selKey,
  onOpen,
}: {
  items: FlowItem[];
  selKey: string | null;
  onOpen: (key: string) => void;
}) {
  return (
    <ol aria-label={C.flowView} className="flex flex-col">
      {items.map((f, i) => {
        const joined = i > 0 && f.kind !== "phase";
        return (
          <li
            key={f.kind === "phase" ? `p${i}` : `${f.key}${i}`}
            className={cn("relative", f.kind === "phase" ? "pt-3 first:pt-0" : joined && "pt-3.5")}
          >
            {joined ? (
              <span aria-hidden className="bg-border absolute top-0 left-1/2 -ml-px h-3.5 w-0.5" />
            ) : null}
            {f.kind === "phase" ? (
              <div className={cn(over, "flex items-center gap-1.5")}>
                <span>{f.title}</span>
                {f.now ? <GreyTag>{C.now}</GreyTag> : null}
              </div>
            ) : f.kind === "node" ? (
              <button
                type="button"
                aria-pressed={f.key === selKey}
                onClick={() => onOpen(f.key)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left",
                  f.st === "later"
                    ? "bg-muted ring-border ring-1 ring-inset"
                    : "bg-card shadow-card",
                  f.key === selKey && "ring-primary ring-2 ring-inset",
                )}
              >
                <StateMark st={f.st} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn(
                      "text-caption font-semibold",
                      f.st === "later" ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {f.title}
                  </span>
                  {f.sub ? (
                    <span className="text-caption text-muted-foreground truncate">{f.sub}</span>
                  ) : null}
                </span>
                {f.st === "needs" ? (
                  <GreyTag className="text-foreground border-foreground/40">{C.needsYou}</GreyTag>
                ) : null}
              </button>
            ) : (
              <div
                className={cn(
                  "flex flex-col gap-1.5 rounded-xl px-2.5 py-2",
                  f.st === "later"
                    ? "bg-muted ring-border ring-1 ring-inset"
                    : "bg-card shadow-card",
                  f.key === selKey && "ring-primary ring-2 ring-inset",
                )}
              >
                <button
                  type="button"
                  aria-pressed={f.key === selKey}
                  onClick={() => onOpen(f.key)}
                  className="flex flex-wrap items-center gap-2 text-left"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mx-px size-[11px] shrink-0 rotate-45 rounded-[2px]",
                      f.st === "done"
                        ? "bg-foreground"
                        : f.st === "needs"
                          ? "ring-foreground bg-card ring-2"
                          : "bg-border",
                    )}
                  />
                  <span className="sr-only">{FLOW_WORD[f.st]}: </span>
                  <span
                    className={cn(
                      "text-caption font-semibold",
                      f.st === "later" ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {f.q}
                  </span>
                  {f.note ? (
                    <span className="text-caption text-muted-foreground">{f.note}</span>
                  ) : null}
                </button>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(80px,1fr))] gap-1">
                  {f.brs.map((b) => (
                    <span
                      key={b.label}
                      className={cn(
                        "text-caption flex flex-col rounded-lg px-2 py-1",
                        b.state === true
                          ? "bg-teal-tint ring-primary text-foreground ring-[1.5px] ring-inset"
                          : b.state === false
                            ? "ring-border text-muted-foreground ring-1 ring-inset"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "font-semibold",
                          b.state === false ? "text-muted-foreground" : "text-foreground",
                        )}
                      >
                        {b.label}
                        <span className="sr-only">
                          {" "}
                          (
                          {b.state === true
                            ? C.keyPath
                            : b.state === false
                              ? C.keyOff
                              : C.keyUnknown}
                          )
                        </span>
                      </span>
                      <span>{b.sub}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ─── The open step ──────────────────────────────────────────────── */

function StepPanel({
  s,
  head,
  role,
  ended,
  busy,
  ActButton,
  onValue,
  onChip,
}: {
  s: Step;
  head: string;
  role: Role;
  ended: boolean;
  busy: boolean;
  ActButton: (props: { b: Btn }) => React.ReactNode;
  onValue: (f: Field, value: string) => void;
  onChip: (a: Act) => void;
}) {
  return (
    <section aria-label={s.title} className={cn(card, "gap-2.5 px-3.5 py-3")}>
      <div className="flex items-center gap-2.5">
        <span className={cn(over, "shrink-0")}>{head}</span>
        <h3 className="text-heading-m text-foreground min-w-0 flex-1">{s.title}</h3>
        <GreyTag
          className={s.status === "needs" ? "text-foreground border-foreground/40" : undefined}
        >
          {STEP_WORD[s.status]}
        </GreyTag>
      </div>
      {s.sub ? <p className="text-body-s text-muted-foreground">{s.sub}</p> : null}
      {s.segs.length ? (
        <ChipRow
          label={s.segLabel}
          chips={s.segs}
          who={s.segWho}
          role={role}
          ended={ended}
          busy={busy}
          onChip={onChip}
          seg
        />
      ) : null}
      {s.fields.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-3 gap-y-2.5">
          {s.fields.map((f) => (
            <FieldRow
              key={f.key}
              f={f}
              role={role}
              ended={ended}
              busy={busy}
              onValue={onValue}
              ActButton={ActButton}
            />
          ))}
        </div>
      ) : null}
      {s.crit.length ? (
        <ul className="flex flex-col gap-1.5">
          {s.crit.map((c) => (
            <li key={c.text} className="bg-muted flex items-center gap-2.5 rounded-xl px-3 py-2">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body-s text-foreground font-semibold">{c.text}</span>
                <span className="text-caption text-muted-foreground">{c.val}</span>
              </span>
              <GreyTag className={c.mark === "met" ? "text-foreground" : undefined}>
                {c.mark === "met" ? C.met : c.mark === "not" ? C.notMet : C.needsValue}
              </GreyTag>
            </li>
          ))}
        </ul>
      ) : null}
      {s.rows.length ? (
        <dl className={boxList}>
          {s.rows.map((r) => (
            <div
              key={r.k}
              className="text-body-s grid grid-cols-[minmax(0,200px)_1fr] gap-2.5 px-3 py-2"
            >
              <dt className="text-label text-muted-foreground">{r.k}</dt>
              <dd className={cn("text-foreground", r.cls === "strong" && "font-semibold")}>
                {r.cls === "warn" ? (
                  <StatusWord tone="caution" className="text-body-s whitespace-normal">
                    {r.v}
                  </StatusWord>
                ) : (
                  r.v
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {s.branches.length ? (
        <div className="flex flex-col gap-1.5">
          {s.branchHead ? (
            <span className="text-label text-muted-foreground">{s.branchHead}</span>
          ) : null}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-1.5">
            {s.branches.map((b) => (
              <div
                key={b.range}
                className={cn(
                  "text-body-s flex flex-col gap-1 rounded-xl px-2.5 py-2",
                  b.on
                    ? b.stop
                      ? "bg-status-caution-bg text-foreground"
                      : "bg-teal-tint ring-primary text-foreground ring-2 ring-inset"
                    : b.known
                      ? "text-muted-foreground"
                      : "bg-muted text-muted-foreground",
                )}
              >
                <span className="text-foreground flex flex-wrap items-center gap-1.5 font-semibold">
                  {b.range}
                  {b.on ? (
                    b.stop ? (
                      <StatusWord tone="caution">{b.tag || C.thisPatient}</StatusWord>
                    ) : (
                      <GreyTag className="text-foreground">{b.tag || C.thisPatient}</GreyTag>
                    )
                  ) : null}
                </span>
                <span>{b.text}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {s.items.length ? (
        <ul className={boxList}>
          {s.items.map((it) => (
            <li key={it.name} className="flex flex-wrap items-center gap-2.5 px-3 py-2">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body-s text-foreground font-semibold">{it.name}</span>
                {it.sub ? (
                  <span className="text-caption text-muted-foreground">{it.sub}</span>
                ) : null}
              </span>
              {it.lvl === "alert" ? (
                <StatusWord tone="caution">{it.word}</StatusWord>
              ) : (
                <GreyTag className={it.lvl === "done" ? "text-foreground" : undefined}>
                  {it.word}
                </GreyTag>
              )}
              {it.btns.map((b) => (
                <ActButton key={b.word} b={b} />
              ))}
            </li>
          ))}
        </ul>
      ) : null}
      {s.chips.length ? (
        <ChipRow
          label={s.chipHead}
          chips={s.chips}
          who={s.chipWho}
          role={role}
          ended={ended}
          busy={busy}
          onChip={onChip}
        />
      ) : null}
      {s.lines.map((l) =>
        l.kind === "alert" || l.kind === "warn" ? (
          <StatusWord
            key={l.text}
            tone="caution"
            className="text-body-s w-full justify-start rounded-xl px-3 py-2 whitespace-normal"
          >
            {l.text}
          </StatusWord>
        ) : (
          <p
            key={l.text}
            className={cn(
              "bg-muted text-body-s rounded-xl px-3 py-2",
              l.kind === "ok" ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {l.text}
          </p>
        ),
      )}
      {s.btns.length ? (
        <div className="flex flex-wrap gap-2">
          {s.btns.map((b) => (
            <ActButton key={b.word} b={b} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ChipRow({
  label,
  chips,
  who,
  role,
  ended,
  busy,
  onChip,
  seg = false,
}: {
  label: string;
  chips: Step["chips"];
  who: Role | null;
  role: Role;
  ended: boolean;
  busy: boolean;
  onChip: (a: Act) => void;
  /** A segmented choice (one of), as the prototype's `seg`. */
  seg?: boolean;
}) {
  const mine = !ended && (who === null || who === role);
  const lockNote = !mine && who ? (who === "dr" ? C.lockDr : C.lockRn) : "";
  return (
    <div className={cn("flex gap-2", seg ? "flex-wrap items-center" : "flex-col")}>
      {label ? <span className="text-label text-muted-foreground">{label}</span> : null}
      <div
        role="group"
        aria-label={label || undefined}
        className={cn(
          "flex flex-wrap gap-1.5",
          seg && "bg-muted max-w-full gap-1 overflow-x-auto rounded-full p-1",
        )}
      >
        {chips.map((c) => (
          <button
            key={c.word}
            type="button"
            aria-pressed={c.on}
            disabled={!mine || busy || !c.act}
            onClick={() => c.act && onChip(c.act)}
            className={cn(
              "text-label min-h-8 shrink-0 rounded-full px-3",
              c.on
                ? "bg-primary text-primary-foreground"
                : seg
                  ? "text-foreground"
                  : "bg-card text-foreground ring-border ring-1 ring-inset",
              !mine && "opacity-75",
            )}
          >
            {c.word}
          </button>
        ))}
        {lockNote && !seg ? (
          <span className="text-caption text-muted-foreground self-center">{lockNote}</span>
        ) : null}
      </div>
    </div>
  );
}

function FieldRow({
  f,
  role,
  ended,
  busy,
  onValue,
  ActButton,
}: {
  f: Field;
  role: Role;
  ended: boolean;
  busy: boolean;
  onValue: (f: Field, value: string) => void;
  ActButton: (props: { b: Btn }) => React.ReactNode;
}) {
  const [v, setV] = useState(f.value);
  const mine = !ended && f.who === role;
  const id = `pf-${f.key}`;
  const fl = f.flag;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-label text-muted-foreground truncate">
        {f.label} {f.unit ? <span className="text-caption font-normal">{f.unit}</span> : null}
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          inputMode="decimal"
          value={v}
          disabled={!mine}
          title={f.source}
          onChange={(e) => setV(e.target.value)}
          className={cn(
            "border-border bg-background text-body-m h-10 w-full min-w-0 rounded-xl border px-3 font-mono tabular-nums",
            fl?.lvl === "abn" && "border-status-caution-fg",
            fl?.lvl === "crit" && "border-status-critical-fg",
          )}
        />
        {mine && v !== f.value ? (
          <Button size="md" disabled={busy} onClick={() => onValue(f, v)}>
            {f.key === "weight" ? C.saveWeight : C.save}
          </Button>
        ) : null}
      </div>
      <span
        className="text-caption text-muted-foreground flex flex-wrap items-center gap-1"
        title={fl ? `${fl.ref} · ${f.source}` : f.source}
      >
        {fl ? (
          <>
            <StatusWord tone={lvlTone(fl.lvl)}>{fl.word}</StatusWord>
            <span>{fill(C.refRange, { r: fl.ref.replace(" to ", "–") })} ·</span>
          </>
        ) : null}
        <span className="truncate">{f.source}</span>
      </span>
      {f.order ? <ActButton b={f.order} /> : null}
      {fl && fl.lvl !== "ok" && fl.text ? (
        <span className="text-caption text-muted-foreground line-clamp-2">{fl.text}</span>
      ) : null}
    </div>
  );
}

/* ─── Nurse: tasks and recording ─────────────────────────────────── */

function Tasks({
  view,
  ActButton,
}: {
  view: ChartView;
  ActButton: (props: { b: Btn }) => React.ReactNode;
}) {
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-heading-m text-foreground">{C.nurseTasks}</h2>
        <span className="text-body-s text-muted-foreground">{C.tasksHint}</span>
      </div>
      {view.tasks.length ? (
        <ul className={cn(boxList, "bg-card")}>
          {view.tasks.map((t) => (
            <li key={t.key} className="flex flex-wrap items-center gap-2.5 px-3 py-2">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body-s text-foreground font-semibold">{t.title}</span>
                {t.sub ? <span className="text-caption text-muted-foreground">{t.sub}</span> : null}
              </span>
              {t.lvl === "alert" ? (
                <StatusWord tone="caution">{t.when}</StatusWord>
              ) : (
                <GreyTag className={t.lvl === "todo" ? "text-foreground" : "bg-card"}>
                  {t.when}
                </GreyTag>
              )}
              {t.btns.map((b) => (
                <ActButton key={b.word} b={b} />
              ))}
            </li>
          ))}
        </ul>
      ) : (
        <p className={placeholder}>{C.nothingDue}</p>
      )}
    </>
  );
}

function RecordForm({
  view,
  busy,
  onRecord,
}: {
  view: ChartView;
  busy: boolean;
  onRecord: (values: Record<string, string>, done: () => void) => void;
}) {
  const fresh = () => Object.fromEntries(view.form.map((f) => [f.key, f.dflt]));
  const [vals, setVals] = useState<Record<string, string>>(fresh);
  const slot = `${view.slotWord} ${view.nextSlot}`;
  return (
    <section aria-label={C.record} className={cn(card, "gap-2.5 px-3.5 py-3")}>
      <div className="flex flex-wrap items-baseline gap-2.5">
        <span className={over}>{C.record}</span>
        <h3 className="text-heading-m text-foreground">
          {fill(C.recordWhen, { slot, t: formatClock(new Date(view.nextDue)) })}
        </h3>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2">
        {view.form.map((f) => (
          <label key={f.key} className="flex min-w-0 flex-col gap-1">
            <span className="text-label text-muted-foreground truncate">
              {f.label}
              {view.formReq.includes(f.key) ? " *" : ""}{" "}
              {f.unit ? <span className="text-caption font-normal">{f.unit}</span> : null}
            </span>
            <input
              inputMode={f.key === "uket" ? "text" : "decimal"}
              value={vals[f.key] ?? ""}
              onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
              className="border-border bg-background text-body-m h-10 w-full min-w-0 rounded-xl border px-3 font-mono tabular-nums"
            />
          </label>
        ))}
      </div>
      <span className="text-body-s text-muted-foreground">{view.recHint}</span>
      <Button
        size="lg"
        className="w-fit"
        disabled={busy || view.formReq.some((k) => !vals[k]?.trim())}
        onClick={() => onRecord(vals, () => setVals(fresh()))}
      >
        {busy ? C.saving : fill(C.saveSlot, { slot: slot.toLowerCase() })}
      </Button>
    </section>
  );
}

/* ─── Medicines, notes, log ──────────────────────────────────────── */

function MedRow({
  name,
  why,
  qty,
  stock,
  tag,
}: {
  name: string;
  why?: string;
  qty: number;
  stock?: string;
  tag?: string;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-3 py-2">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body-s text-foreground font-semibold">{name}</span>
        {why ? <span className="text-caption text-muted-foreground">{why}</span> : null}
      </span>
      <span className="bg-muted text-caption text-muted-foreground inline-flex h-6 items-center rounded-full px-2.5 font-semibold">
        {fill(C.qty, { n: qty })}
      </span>
      {tag ? <GreyTag>{tag}</GreyTag> : null}
      {stock ? (
        <span className="text-caption text-muted-foreground basis-full">{stock}</span>
      ) : null}
    </li>
  );
}

function Medicines({
  view,
  names,
  stock,
  stockAt,
  busy,
  ended,
  onSend,
}: {
  view: ChartView;
  names: Record<string, string>;
  stock: Record<string, string>;
  stockAt: string;
  busy: boolean;
  ended: boolean;
  onSend: () => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-heading-m text-foreground">{C.medsChart}</h2>
        <span className="text-caption text-muted-foreground font-semibold">
          {fill(C.stockAsOf, { t: stockAt })}
        </span>
        <span className="text-body-s text-muted-foreground">{view.medsNote}</span>
      </div>
      {view.meds.length ? (
        <ul className={cn(boxList, "bg-card")}>
          {view.meds.map((m) => (
            <MedRow
              key={m.drug}
              name={names[m.drug] ?? m.drug}
              why={m.why}
              qty={m.qty}
              stock={stock[m.drug] ?? C.noStock}
            />
          ))}
        </ul>
      ) : null}
      {view.sentAt ? (
        <p className="bg-muted text-body-s text-foreground rounded-xl px-3 py-2">
          {fill(C.sentAtLine, { t: formatClock(new Date(view.sentAt)) })}
        </p>
      ) : !ended && view.meds.length ? (
        <Button size="lg" className="w-full" disabled={busy} onClick={onSend}>
          {busy ? C.sending : C.sendOrder}
        </Button>
      ) : null}
    </>
  );
}

function NurseMeds({ view, names }: { view: ChartView; names: Record<string, string> }) {
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-heading-m text-foreground">{C.medsChart}</h2>
        <span className="text-body-s text-muted-foreground">{C.medsNurseNote}</span>
      </div>
      {view.sentAt ? (
        <ul className={cn(boxList, "bg-card")}>
          {view.meds.map((m) => (
            <MedRow
              key={m.drug}
              name={names[m.drug] ?? m.drug}
              why={m.why}
              qty={m.qty}
              tag={fill(C.railSentAt, { t: formatClock(new Date(view.sentAt!)) })}
            />
          ))}
        </ul>
      ) : (
        <p className={placeholder}>{C.notSentNurse}</p>
      )}
    </>
  );
}

function PharmacyRail({
  view,
  tab,
  onTab,
  nowLbl,
  className,
}: {
  view: ChartView;
  tab: "meds" | "chart";
  onTab: (t: "meds" | "chart") => void;
  nowLbl: string;
  className?: string;
}) {
  const items = [
    {
      k: "meds" as const,
      title: C.drugOrders,
      win: view.sentAt
        ? fill(C.railSentAt, { t: formatClock(new Date(view.sentAt)) })
        : C.railNoOrder,
      count: view.sentAt ? fill(C.railLines, { n: view.meds.length }) : C.railWaiting,
    },
    {
      k: "chart" as const,
      title: C.screenChart,
      win: C.railReadOnly,
      count: fill(C.railNow, { t: nowLbl }),
    },
  ];
  return (
    <nav aria-label={C.screenChart} className={cn("flex flex-col gap-1.5", className)}>
      {items.map((r) => (
        <button
          key={r.k}
          type="button"
          aria-pressed={tab === r.k}
          onClick={() => onTab(r.k)}
          className={cn(
            "flex flex-col gap-px rounded-2xl px-3 py-2 text-left",
            tab === r.k ? "bg-teal-tint ring-primary ring-2 ring-inset" : "bg-card shadow-card",
          )}
        >
          <span className="text-body-m text-foreground font-semibold">{r.title}</span>
          <span className="flex flex-wrap justify-between gap-2">
            <span className="text-caption text-muted-foreground">{r.win}</span>
            <span className="text-caption text-muted-foreground font-semibold">{r.count}</span>
          </span>
        </button>
      ))}
      <div className="flex flex-col gap-1 px-3 py-2.5">
        <span className="text-label text-muted-foreground">{C.recent}</span>
        {view.log.slice(0, 6).map((l) => (
          <span key={l.eventId} className="text-caption text-muted-foreground">
            <b className="text-foreground font-mono font-semibold">{formatClock(new Date(l.at))}</b>{" "}
            {l.text}
          </span>
        ))}
      </div>
    </nav>
  );
}

function Pharmacy({
  view,
  names,
  stock,
  patient,
  stockAt,
}: {
  view: ChartView;
  names: Record<string, string>;
  stock: Record<string, string>;
  patient: string;
  stockAt: string;
}) {
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-heading-m text-foreground">
          {patient ? fill(C.drugOrdersFor, { patient }) : C.drugOrders}
        </h2>
        <span className="text-body-s text-muted-foreground">
          {fill(C.drugOrdersSub, { short: view.short })}
        </span>
        <span className="text-caption text-muted-foreground font-semibold">
          {fill(C.stockAsOf, { t: stockAt })}
        </span>
      </div>
      {view.sentAt ? (
        <ul className={cn(boxList, "bg-card")}>
          {view.meds.map((m) => (
            <MedRow
              key={m.drug}
              name={names[m.drug] ?? m.drug}
              why={m.why}
              qty={m.qty}
              tag={fill(C.railSentAt, { t: formatClock(new Date(view.sentAt!)) })}
              stock={stock[m.drug] ?? C.noStock}
            />
          ))}
        </ul>
      ) : (
        <p className={placeholder}>{C.noOrderPh}</p>
      )}
      <span className="text-label text-muted-foreground">{C.needNext}</span>
      <dl className={cn(boxList, "bg-card")}>
        {view.phRows.map((r) => (
          <div
            key={r.k}
            className="text-body-s grid grid-cols-[minmax(0,200px)_1fr] gap-2.5 px-3 py-2"
          >
            <dt className="text-label text-muted-foreground">{r.k}</dt>
            <dd className={cn("text-foreground", r.cls === "strong" && "font-semibold")}>
              {r.cls === "warn" ? (
                <StatusWord tone="caution" className="text-body-s whitespace-normal">
                  {r.v}
                </StatusWord>
              ) : (
                r.v
              )}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function Notes({
  view,
  busy,
  ended,
  onAdd,
}: {
  view: ChartView;
  busy: boolean;
  ended: boolean;
  onAdd: (text: string, done: () => void) => void;
}) {
  const [text, setText] = useState("");
  const notes = view.notes.slice(-5).reverse();
  return (
    <section aria-label={C.notes} className={cn(card, "gap-2.5 px-3.5 py-3")}>
      <div className="flex flex-wrap items-baseline gap-2.5">
        <span className={over}>{C.notes}</span>
        <h3 className="text-heading-m text-foreground">{C.notesHint}</h3>
      </div>
      {!ended ? (
        <>
          <label htmlFor="pc-note" className="sr-only">
            {C.notePlaceholder}
          </label>
          <textarea
            id="pc-note"
            rows={2}
            value={text}
            placeholder={C.notePlaceholder2}
            onChange={(e) => setText(e.target.value)}
            className="border-border bg-background text-body-s min-h-16 rounded-xl border px-3 py-2"
          />
          <Button
            size="md"
            variant="soft"
            className="w-fit rounded-full"
            disabled={busy || !text.trim()}
            onClick={() => onAdd(text, () => setText(""))}
          >
            {C.addNote}
          </Button>
        </>
      ) : null}
      {notes.length ? (
        <ul className={boxList}>
          {notes.map((n) => (
            <li key={n.eventId} className="flex flex-col gap-px px-3 py-2">
              <span className="text-caption text-muted-foreground">
                <b className="text-foreground font-mono font-semibold">
                  {formatClock(new Date(n.at))}
                </b>{" "}
                · {ROLE_WORD[n.who]}
              </span>
              <span className="text-body-s text-foreground">{n.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Log({
  view,
  role,
  ended,
  onUndo,
}: {
  view: ChartView;
  role: Role;
  ended: boolean;
  onUndo: (id: string) => void;
}) {
  const undoable = new Set(["start", "end", "reopen", "send", "reverse"]);
  if (!view.log.length) return null;
  return (
    <section aria-label={C.recent} className="flex flex-col gap-1 px-1">
      <span className="text-label text-muted-foreground">{C.recent}</span>
      <ol className="flex flex-col gap-0.5">
        {view.log.slice(0, 12).map((l) => (
          <li key={l.eventId} className="flex items-baseline justify-between gap-2">
            <span className="text-caption text-muted-foreground">
              <b className="text-foreground font-mono font-semibold">
                {formatClock(new Date(l.at))}
              </b>{" "}
              {l.role === "rn" ? C.nurseDot : C.doctorDot}
              {l.text}
            </span>
            {!ended && !undoable.has(l.type) && (role === "dr" || role === l.role) ? (
              <Button size="sm" variant="link" onClick={() => onUndo(l.eventId)}>
                {C.undoEvent}
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ReasonDialog({
  open,
  title,
  label,
  confirm,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  label: string;
  confirm: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <EditorDialog open={open} onOpenChange={(o) => !o && onClose()} width="medium">
      <div className="px-6 pt-5">
        <DialogTitle>{title}</DialogTitle>
      </div>
      <div className="flex flex-col gap-1.5 px-6 py-4">
        <label htmlFor="pc-reason" className="text-caption text-muted-foreground">
          {label}
        </label>
        <input
          id="pc-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="border-border bg-background text-body-s h-9 rounded-md border px-2"
        />
      </div>
      <div className="border-border flex justify-end gap-2 border-t px-6 py-3">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {C.previous}
        </Button>
        <Button
          size="sm"
          disabled={busy || reason.trim().length < 3}
          onClick={() => onConfirm(reason)}
        >
          {confirm}
        </Button>
      </div>
    </EditorDialog>
  );
}

/* ─── The monitoring chart ───────────────────────────────────────── */

function MonitoringChart({
  view,
  role,
  busy,
  ended,
  nowSlot,
  onVitals,
  onParam,
}: {
  view: ChartView;
  role: Role;
  busy: boolean;
  ended: boolean;
  nowSlot: number;
  onVitals: (values: Record<string, string>, done: () => void) => void;
  onParam: (input: { add?: { name: string; unit: string }; removeId?: string }) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h2 className="text-heading-m text-foreground">{C.screenChart}</h2>
      {role !== "rn" ? (
        <p className="bg-muted text-body-s text-muted-foreground rounded-xl px-3 py-2">
          {role === "dr" ? C.doctorRecNote : C.readOnly}
        </p>
      ) : null}
      <div className="grid items-start gap-3 min-[860px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        {view.panels.length ? (
          <TrendsCard
            panels={view.panels}
            slots={view.slotCount}
            slotMinutes={view.slotMinutes}
            slotWord={view.slotWord}
            nowSlot={nowSlot}
          />
        ) : null}
        <VitalsCard
          view={view}
          role={role}
          busy={busy}
          ended={ended}
          onVitals={onVitals}
          onParam={onParam}
        />
      </div>
      <div
        role="region"
        aria-label={C.grid}
        tabIndex={0}
        className="bg-card shadow-card max-w-full overflow-x-auto rounded-2xl"
      >
        <table className="text-caption w-full min-w-max border-collapse tabular-nums">
          <thead>
            <tr>
              <th
                scope="col"
                className="bg-card text-muted-foreground border-border sticky left-0 z-[1] w-[150px] min-w-[150px] border-r px-2.5 py-1 text-left font-semibold"
              >
                {view.slotWord}
              </th>
              {view.grid.head.map((h, i) => (
                <th
                  key={i}
                  scope="col"
                  className={cn(
                    "border-border text-muted-foreground h-[26px] min-w-11 border-r px-1 text-center font-semibold",
                    h.now ? "bg-teal-tint" : "bg-muted",
                  )}
                >
                  {h.t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.grid.rows.map((r) => (
              <tr key={r.key} className="border-border border-t">
                <th
                  scope="row"
                  className="bg-card text-muted-foreground border-border sticky left-0 z-[1] border-r px-2.5 py-1 text-left font-semibold whitespace-nowrap"
                >
                  {r.label}
                </th>
                {r.cells.map((c, i) => (
                  <td
                    key={i}
                    title={c.flag && c.flag.lvl !== "ok" ? `${c.t} · ${c.flag.word}` : undefined}
                    className={cn(
                      "border-border text-foreground h-[26px] min-w-11 border-r px-1 text-center whitespace-nowrap",
                      c.now && "bg-teal-tint",
                      lvlCell(c.flag),
                      c.due && "bg-muted outline-border outline-1 -outline-offset-2 outline-dashed",
                    )}
                  >
                    {c.due ? <span className="sr-only">{C.dueCell}</span> : c.t}
                    <FlagGlyph f={c.flag} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.full ? <p className={placeholder}>{C.allCharted}</p> : null}
    </div>
  );
}

const GCS = ["gcsE", "gcsV", "gcsM"] as const;
const GCS_MAX = { gcsE: 4, gcsV: 5, gcsM: 6 } as const;

function VitalsCard({
  view,
  role,
  busy,
  ended,
  onVitals,
  onParam,
}: {
  view: ChartView;
  role: Role;
  busy: boolean;
  ended: boolean;
  onVitals: (values: Record<string, string>, done: () => void) => void;
  onParam: (input: { add?: { name: string; unit: string }; removeId?: string }) => void;
}) {
  const V = view.vitals;
  const [vals, setVals] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const gOk = (k: (typeof GCS)[number]) => {
    const n = Number(vals[k]);
    return Number.isInteger(n) && n >= 1 && n <= GCS_MAX[k] ? n : null;
  };
  const gcsTotal = GCS.every((k) => gOk(k) !== null) ? GCS.reduce((a, k) => a + gOk(k)!, 0) : null;
  const canSave =
    Object.entries(vals).some(([k, x]) => !k.startsWith("gcs") && x.trim()) || gcsTotal !== null;
  const custom = V.inputs.filter((i) => i.key.startsWith("cx_"));
  const input = (key: string, label: string, ph: string, cls = "w-full") => (
    <input
      aria-label={label}
      placeholder={ph}
      inputMode={key.startsWith("cx_") ? "text" : "numeric"}
      value={vals[key] ?? ""}
      onChange={(e) => setVals({ ...vals, [key]: e.target.value })}
      className={cn(
        "border-border bg-card text-body-s h-[30px] min-w-0 rounded-lg border px-1.5 font-mono tabular-nums",
        cls,
      )}
    />
  );
  const nurse = role === "rn" && !ended;
  return (
    <section aria-label={C.vitalsTitle} className={cn(card, "gap-2.5 px-3.5 py-3")}>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className={over}>{C.vitalsTitle}</span>
        <h3 className="text-heading-s text-foreground min-w-0 flex-1">{C.vitalsSub}</h3>
        {V.last === null || V.overdue ? (
          <StatusWord tone="caution">
            {V.last === null
              ? C.vitalsNone
              : fill(C.vitalsOverdue, {
                  t: formatClock(new Date(V.due)),
                  last: formatClock(new Date(V.last)),
                })}
          </StatusWord>
        ) : (
          <GreyTag>
            {fill(C.vitalsDue, {
              t: formatClock(new Date(V.due)),
              last: formatClock(new Date(V.last)),
            })}
          </GreyTag>
        )}
        {role === "dr" && !ended ? (
          <Button
            size="md"
            variant="soft"
            className="rounded-full"
            aria-expanded={adding}
            onClick={() => setAdding(!adding)}
          >
            {C.addParam}
          </Button>
        ) : null}
      </div>
      {role === "dr" && adding && !ended ? (
        <div className="bg-muted flex flex-col gap-2 rounded-xl p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-caption text-muted-foreground">{C.quickPick}</span>
            {V.suggest.map((s) => (
              <button
                key={s.name}
                type="button"
                onClick={() => {
                  setName(s.name);
                  setUnit(s.unit);
                }}
                className={chipCls(false)}
              >
                {s.name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2.5">
            <label className="flex min-w-0 flex-[2_1_180px] flex-col gap-1">
              <span className="text-label text-muted-foreground">{C.paramName}</span>
              <input
                value={name}
                placeholder={C.paramNamePh}
                onChange={(e) => setName(e.target.value)}
                className="border-border bg-card text-body-s h-10 w-full min-w-0 rounded-xl border px-3"
              />
            </label>
            <label className="flex min-w-0 flex-[1_1_100px] flex-col gap-1">
              <span className="text-label text-muted-foreground">{C.paramUnit}</span>
              <input
                value={unit}
                placeholder={C.paramUnitPh}
                onChange={(e) => setUnit(e.target.value)}
                className="border-border bg-card text-body-s h-10 w-full min-w-0 rounded-xl border px-3"
              />
            </label>
            <Button
              size="lg"
              disabled={busy || !name.trim()}
              onClick={() => {
                onParam({ add: { name: name.trim(), unit: unit.trim() } });
                setAdding(false);
                setName("");
                setUnit("");
              }}
            >
              {C.addToVitals}
            </Button>
            <Button size="md" variant="link" onClick={() => setAdding(false)}>
              {C.cancel}
            </Button>
          </div>
        </div>
      ) : null}
      <ul className="grid grid-cols-2 gap-1.5">
        {V.tiles.map((t) => (
          <li
            key={t.key}
            className={cn(
              "flex min-w-0 flex-col overflow-hidden rounded-xl px-2.5 pt-1.5 pb-1.5",
              t.flag?.lvl === "crit"
                ? "bg-status-critical-bg"
                : t.flag?.lvl === "abn"
                  ? "bg-status-caution-bg"
                  : "bg-muted",
            )}
          >
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="text-caption text-muted-foreground">{t.label}</span>
              <span className="text-foreground min-w-0 truncate">
                <b className="text-body-m font-mono font-semibold tabular-nums">{t.value}</b>{" "}
                {t.value !== "—" && t.unit ? (
                  <span className="text-caption text-muted-foreground">{t.unit}</span>
                ) : null}
              </span>
              {t.paramId && role === "dr" && !ended ? (
                <button
                  type="button"
                  aria-label={C.removeParam}
                  onClick={() => onParam({ removeId: t.paramId! })}
                  className="text-muted-foreground hover:text-foreground ml-auto px-0.5"
                >
                  ×
                </button>
              ) : null}
            </span>
            <span className="flex min-w-0 justify-between gap-1.5 overflow-hidden whitespace-nowrap">
              <span className="text-caption text-foreground truncate font-semibold">
                {t.flag && t.flag.lvl !== "ok" ? (
                  <>
                    {t.flag.lvl === "crit" ? (
                      <OctagonAlertIcon aria-hidden className="mr-0.5 inline size-3" />
                    ) : (
                      <TriangleAlertIcon aria-hidden className="mr-0.5 inline size-3" />
                    )}
                    {t.word}
                  </>
                ) : (
                  t.word
                )}
              </span>
              {t.delta ? (
                <span className="text-caption text-muted-foreground truncate">{t.delta}</span>
              ) : null}
            </span>
            <MiniTrend t={t} />
          </li>
        ))}
      </ul>
      <div className="max-w-full overflow-x-auto">
        <table className="text-body-s border-border w-full min-w-max border-separate border-spacing-0 overflow-hidden rounded-xl border tabular-nums">
          <thead>
            <tr className="bg-muted">
              {V.head.map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="text-caption text-muted-foreground px-2 py-1.5 text-left font-semibold whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {nurse ? (
              <>
                <tr className="bg-teal-tint">
                  <td className="text-caption text-teal-text border-border border-t px-1.5 py-1 font-semibold">
                    {C.now}
                  </td>
                  <td className="border-border border-t px-1.5 py-1">
                    <span className="flex items-center gap-0.5">
                      {input("sbp", C.sysBp, C.sys, "w-12")}
                      <i className="text-muted-foreground not-italic">/</i>
                      {input("dbp", C.diaBp, C.dia, "w-12")}
                    </span>
                  </td>
                  <td className="border-border border-t px-1.5 py-1">
                    {input("pulse", C.pulse, "/min", "w-16")}
                  </td>
                  <td className="border-border border-t px-1.5 py-1">
                    {input("rr", C.rr, "/min", "w-16")}
                  </td>
                  <td className="border-border border-t px-1.5 py-1">
                    <span className="flex items-center gap-1">
                      {GCS.map((k) => {
                        const bad = !!vals[k]?.trim() && gOk(k) === null;
                        return (
                          <span key={k} className="flex items-center gap-0.5">
                            <i className="text-caption text-muted-foreground font-semibold not-italic">
                              {k.slice(3)}
                            </i>
                            <input
                              aria-label={C.gcsParts[k].label}
                              aria-invalid={bad || undefined}
                              title={C.gcsParts[k].scale}
                              placeholder={`1–${GCS_MAX[k]}`}
                              inputMode="numeric"
                              value={vals[k] ?? ""}
                              onChange={(e) => setVals({ ...vals, [k]: e.target.value })}
                              className={cn(
                                "border-border bg-card text-body-s h-[30px] w-10 min-w-0 rounded-lg border px-1 font-mono tabular-nums",
                                bad && "border-foreground ring-foreground ring-1",
                              )}
                            />
                          </span>
                        );
                      })}
                      <b className="text-body-s min-w-[34px] whitespace-nowrap">
                        {fill(C.gcsSum, { n: gcsTotal ?? "—" })}
                      </b>
                    </span>
                  </td>
                  {custom.map((i) => (
                    <td key={i.key} className="border-border border-t px-1.5 py-1">
                      {input(i.key, i.label, i.unit, "w-16")}
                    </td>
                  ))}
                </tr>
                <tr className="bg-teal-tint">
                  <td colSpan={V.head.length} className="border-border border-t px-2 py-1.5">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-caption text-muted-foreground max-w-[60ch] whitespace-normal">
                        {C.vitalsHint}
                      </span>
                      <Button
                        size="md"
                        variant="soft"
                        className="rounded-full"
                        disabled={busy || !canSave}
                        onClick={() => onVitals(vals, () => setVals({}))}
                      >
                        {C.saveVitals}
                      </Button>
                    </span>
                  </td>
                </tr>
              </>
            ) : null}
            {V.rows.map((r) => (
              <tr key={r.at}>
                {r.cells.map((c, i) => (
                  <td
                    key={i}
                    title={c.flag && c.flag.lvl !== "ok" ? c.flag.word : undefined}
                    className={cn(
                      "border-border text-foreground border-t px-2 py-1 whitespace-nowrap",
                      i === 0 && "text-muted-foreground font-mono",
                      lvlCell(c.flag),
                    )}
                  >
                    {c.t}
                    <FlagGlyph f={c.flag} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Local development only: move the chart clock to try the next hours (never in production). */
function DevClock({ minutes }: { minutes: number }) {
  const href = (m: number) => `?at=${m}`;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="text-caption text-muted-foreground">{C.devClock}</span>
      {[60, 360].map((m) => (
        <Link
          key={m}
          href={href(minutes + m)}
          className="border-border text-label text-teal-text inline-flex min-h-[30px] items-center rounded-full border px-3"
        >
          {`+${m / 60} h`}
        </Link>
      ))}
      <Link
        href={href(0)}
        className="text-teal-text text-label underline-offset-[3px] hover:underline"
      >
        {`+0 (${minutes} min)`}
      </Link>
    </span>
  );
}

/** The nurse's entries waiting in the outbox (P11): a neutral strip, never a clinical colour. */
function Outbox({
  entries,
  onRetry,
  onDiscard,
}: {
  entries: readonly QueueEntry[];
  onRetry: (clientKey: string) => void;
  onDiscard: (clientKey: string) => void;
}) {
  return (
    <section
      role="status"
      className="border-border bg-muted flex flex-col gap-2 rounded-lg border p-3"
    >
      <p className="text-body-s text-foreground">{fill(C.offlineWaiting, { n: entries.length })}</p>
      <ul className="flex flex-col gap-1">
        {entries.map((e) => (
          <li key={e.clientKey} className="flex flex-wrap items-center gap-2">
            <GreyTag>{e.status === "failed" ? C.notSaved : C.waiting}</GreyTag>
            <span className="text-caption text-foreground">{e.label}</span>
            {e.error && e.status === "failed" ? (
              <span className="text-caption text-muted-foreground">{e.error}</span>
            ) : null}
            {e.status === "failed" ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => onRetry(e.clientKey)}>
                  {C.retry}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onDiscard(e.clientKey)}>
                  {C.discard}
                </Button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
