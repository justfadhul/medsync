"use client";

import type { QueueEntry } from "@/lib/emr/sync/queue";
import type { ActionResult } from "@/lib/emr/write/context";
import type {
  Act,
  Btn,
  ChartView,
  Field,
  FlowItem,
  Role,
  Step,
} from "@/lib/protocols/engine/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";

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
import { MiniTrend, TrendPanel } from "./trends";

/**
 * One protocol chart, as the signed-in user's role sees it (F7–F8): the doctor's "Steps and orders",
 * the nurse's "Tasks and recording", both with the "Monitoring chart"; the pharmacy reads the drug
 * orders. Every button sends an act the server re-checks against the chart (P2, P6); a button that
 * belongs to the other cadre shows who does it, and does nothing. Workflow state is a grey square
 * tag and a word; colour marks only a value's clinical reading, always with its word.
 */

export interface ChartScreenProps {
  view: ChartView;
  role: Role;
  surface: "doctor" | "clinician" | "nurse";
  patientUserId: string;
  chartId: string;
  /** Medicine id → "Ward 4B: in stock" (or "Stock not linked"). */
  stock: Record<string, string>;
  /** Medicine id → its generic name. */
  names: Record<string, string>;
  prescribeHref: string | null;
  /** Local development only: the chart clock offset in minutes. */
  devClock: number | null;
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
const LINE_TONE = { alert: "caution", warn: "caution", ok: "neutral", "": "neutral" } as const;
const lvlTone = (l: "ok" | "abn" | "crit") =>
  l === "crit" ? "critical" : l === "abn" ? "caution" : "neutral";

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

export function ChartScreen(p: ChartScreenProps) {
  const { view, role } = p;
  const router = useRouter();
  const [tab, setTab] = useState<"work" | "chart">("work");
  const [mode, setMode] = useState<"flow" | "list">("list");
  const [open, setOpen] = useState<string | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const [undo, setUndo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ended = view.endedAt !== null;
  const ids = { surface: p.surface, patientUserId: p.patientUserId, chartId: p.chartId };

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

  const steps = [...view.phases.flatMap((ph) => ph.acts), ...view.rn.acts];
  const openStep = steps.find((s) => s.key === open) ?? null;

  const locked = (b: Btn) => {
    const who = role === "ph" ? (b.who ?? "dr") : b.who;
    if (!who || who === role) return null;
    return `${who === "rn" ? C.nurseDot : C.doctorDot}${b.word}`;
  };

  function ActButton({ b }: { b: Btn }) {
    if (b.act.t === "screen")
      return (
        <Button size="sm" variant="link" onClick={() => setTab("chart")}>
          {b.word}
        </Button>
      );
    if (b.act.t === "rx")
      return p.prescribeHref && role === "dr" ? (
        <Link
          href={p.prescribeHref}
          className="text-teal-text text-caption underline-offset-[3px] hover:underline"
        >
          {b.word}
        </Link>
      ) : null;
    const lw = ended ? b.word : locked(b);
    if (lw)
      return (
        <Button size="sm" variant="secondary" disabled aria-disabled>
          {lw}
        </Button>
      );
    if (b.act.t === "end")
      return (
        <Button size="sm" onClick={() => setEndOpen(true)}>
          {b.word}
        </Button>
      );
    const a = b.act;
    return (
      <Button
        size="sm"
        variant={b.kind === "main" ? "primary" : b.kind === "link" ? "link" : "secondary"}
        disabled={pending}
        onClick={() => act(a)}
      >
        {b.word}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header: what is running, the phase, the numbers that matter. */}
      <section className="border-border bg-card shadow-card flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-heading-m text-foreground">{view.title}</h2>
          <GreyTag>{ended ? C.ended : `${C.phaseWord}: ${view.phase.title}`}</GreyTag>
          {!view.signed ? <StatusWord tone="caution">{C.prototypeValues}</StatusWord> : null}
        </div>
        <p className="text-caption text-muted-foreground">
          {view.over} · {fill(C.startedAt, { t: formatClock(new Date(view.startedAt)) })} ·{" "}
          {view.nowWord}
        </p>
        {ended ? (
          <p className="text-body-s text-foreground">
            {fill(C.endedBanner, {
              t: formatClock(new Date(view.endedAt!)),
              reason: view.endReason ?? "",
            })}
          </p>
        ) : null}
        {view.blocked ? <StatusWord tone="caution">{view.blocked}</StatusWord> : null}
        {view.stats.length ? (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {view.stats.map((s) => (
              <div key={s.k} className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-caption text-muted-foreground">{s.k}</dt>
                <dd className="text-body-m text-foreground font-mono">{s.v}</dd>
                <dd className="text-caption text-muted-foreground">
                  {s.cls === "warn" ? <StatusWord tone="caution">{s.s}</StatusWord> : s.s}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {p.devClock !== null ? <DevClock minutes={p.devClock} /> : null}
      </section>

      {role !== "ph" ? (
        <div role="tablist" className="border-border flex gap-1 border-b">
          {(
            [
              ["work", role === "dr" ? C.screenWorkDr : C.screenWorkRn],
              ["chart", C.screenChart],
            ] as const
          ).map(([k, w]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn(
                "text-label -mb-px border-b-2 px-3 py-2",
                tab === k
                  ? "border-primary text-foreground"
                  : "text-muted-foreground border-transparent",
              )}
            >
              {w}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p role="alert">
          <StatusWord tone="caution">{error}</StatusWord>
        </p>
      ) : null}

      {waiting.length ? (
        <Outbox entries={waiting} onRetry={queue.retry} onDiscard={(k) => void queue.discard(k)} />
      ) : null}

      {role === "ph" ? (
        <Pharmacy view={view} names={p.names} stock={p.stock} />
      ) : tab === "work" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-5">
            {role === "rn" ? <Tasks view={view} ActButton={ActButton} /> : null}
            {role === "rn" && view.rn.acts.length ? (
              <section className="flex flex-col gap-2">
                <h3 className="text-heading-s text-foreground">{view.rn.title}</h3>
                <p className="text-caption text-muted-foreground">{view.rn.note}</p>
                {view.rn.acts.map((s) => (
                  <StepCard key={s.key} s={s} onOpen={setOpen} />
                ))}
              </section>
            ) : null}
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-heading-s text-foreground">{C.kicker}</h3>
                <div className="flex gap-1">
                  {(["list", "flow"] as const).map((m) => (
                    <Button
                      key={m}
                      size="sm"
                      variant={mode === m ? "soft" : "ghost"}
                      aria-pressed={mode === m}
                      onClick={() => setMode(m)}
                    >
                      {m === "flow" ? C.flowView : C.listView}
                    </Button>
                  ))}
                </div>
              </div>
              {mode === "flow" ? (
                <Flow
                  items={view.flow}
                  onOpen={(k) =>
                    setOpen(
                      view.phases.flatMap((x) => x.acts).find((s) => s.key === k)?.key ?? null,
                    )
                  }
                />
              ) : (
                view.phases.map((ph) => (
                  <div key={ph.id} className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h4 className="text-label text-foreground">{ph.title}</h4>
                      <span className="text-caption text-muted-foreground">{ph.win}</span>
                      {view.phase.id === ph.id && !ended ? <GreyTag>{C.now}</GreyTag> : null}
                    </div>
                    {ph.acts.map((s) => (
                      <StepCard key={s.key} s={s} onOpen={setOpen} />
                    ))}
                  </div>
                ))
              )}
            </section>
          </div>
          <aside className="flex min-w-0 flex-col gap-5">
            {role === "dr" ? (
              <Medicines
                view={view}
                names={p.names}
                stock={p.stock}
                busy={pending}
                ended={ended}
                onSend={() =>
                  run(sendChartOrderAction, { place: "ward", answers: {}, witness: null })
                }
              />
            ) : null}
            <Notes
              view={view}
              busy={pending}
              ended={ended}
              onAdd={(text, done) => run(addChartNoteAction, { text }, done)}
            />
            <Log view={view} role={role} onUndo={setUndo} ended={ended} />
            {role === "dr" ? (
              ended ? (
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => run(endChartAction, { reopen: true })}
                >
                  {C.reopen}
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setEndOpen(true)}>
                  {C.endTitle}
                </Button>
              )
            ) : null}
          </aside>
        </div>
      ) : (
        <MonitoringChart
          view={view}
          role={role}
          busy={pending}
          ended={ended}
          onRecord={(values, done) => run(recordSlotAction, { values }, done, "slot")}
          onVitals={(values, done) => run(recordVitalsAction, { values }, done, "vitals")}
          onParam={(input) => run(changeParamAction, input)}
        />
      )}

      <EditorDialog open={!!openStep} onOpenChange={(o) => !o && setOpen(null)} width="medium">
        {openStep ? (
          <StepPanel
            s={openStep}
            role={role}
            ended={ended}
            busy={pending}
            ActButton={ActButton}
            onValue={(f, value) =>
              act(f.key === "weight" ? { t: "weight" } : { t: "value", key: f.key }, value)
            }
            onChip={(a) => act(a)}
            onClose={() => setOpen(null)}
          />
        ) : null}
      </EditorDialog>

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

/* ─── Steps ──────────────────────────────────────────────────────── */

function StepCard({ s, onOpen }: { s: Step; onOpen: (k: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(s.key)}
      className="border-border bg-card hover:bg-muted/50 flex w-full items-start justify-between gap-3 rounded-lg border px-3 py-2.5 text-left"
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-caption text-muted-foreground">
          {s.head ?? fill(C.step, { n: s.n })}
        </span>
        <span className="text-label text-foreground">{s.title}</span>
        {s.brief ? <span className="text-caption text-muted-foreground">{s.brief}</span> : null}
      </span>
      <GreyTag
        className={s.status === "needs" ? "text-foreground border-foreground/40" : undefined}
      >
        {STEP_WORD[s.status]}
      </GreyTag>
    </button>
  );
}

function StepPanel({
  s,
  role,
  ended,
  busy,
  ActButton,
  onValue,
  onChip,
  onClose,
}: {
  s: Step;
  role: Role;
  ended: boolean;
  busy: boolean;
  ActButton: (props: { b: Btn }) => React.ReactNode;
  onValue: (f: Field, value: string) => void;
  onChip: (a: Act) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3 px-6 pt-5">
        <div className="flex flex-col gap-1">
          <span className="text-caption text-muted-foreground">
            {s.head ?? fill(C.step, { n: s.n })}
          </span>
          <DialogTitle>{s.title}</DialogTitle>
          {s.sub ? <p className="text-body-s text-muted-foreground">{s.sub}</p> : null}
        </div>
        <GreyTag>{STEP_WORD[s.status]}</GreyTag>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
        {s.segs.length ? (
          <ChipRow
            label={s.segLabel}
            chips={s.segs}
            who={s.segWho}
            role={role}
            ended={ended}
            busy={busy}
            onChip={onChip}
          />
        ) : null}
        {s.fields.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
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
              <li key={c.text} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-body-s text-foreground">{c.text}</span>
                <span className="text-caption text-muted-foreground">
                  {c.val} ·{" "}
                  <GreyTag>
                    {c.mark === "met" ? C.met : c.mark === "not" ? C.notMet : C.needsValue}
                  </GreyTag>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {s.rows.length ? (
          <dl className="divide-border flex flex-col divide-y">
            {s.rows.map((r) => (
              <div key={r.k} className="flex flex-wrap justify-between gap-2 py-1.5">
                <dt className="text-body-s text-muted-foreground">{r.k}</dt>
                <dd
                  className={cn(
                    "text-body-s text-foreground",
                    r.cls === "strong" && "font-semibold",
                  )}
                >
                  {r.cls === "warn" ? <StatusWord tone="caution">{r.v}</StatusWord> : r.v}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {s.branches.length ? (
          <div className="flex flex-col gap-2">
            {s.branchHead ? <p className="text-label text-foreground">{s.branchHead}</p> : null}
            {s.branches.map((b) => (
              <div
                key={b.range}
                className={cn(
                  "border-border flex flex-col gap-0.5 rounded-md border px-3 py-2",
                  b.on ? "bg-muted border-foreground/30" : "opacity-80",
                )}
              >
                <span className="text-label text-foreground flex flex-wrap items-center gap-2">
                  {b.range}
                  {b.tag ? <GreyTag>{b.tag}</GreyTag> : null}
                </span>
                <span className="text-body-s text-muted-foreground">{b.text}</span>
              </div>
            ))}
          </div>
        ) : null}
        {s.items.length ? (
          <ul className="divide-border flex flex-col divide-y">
            {s.items.map((it) => (
              <li key={it.name} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex min-w-0 flex-col">
                  <span className="text-body-s text-foreground">{it.name}</span>
                  {it.sub ? (
                    <span className="text-caption text-muted-foreground">{it.sub}</span>
                  ) : null}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {it.lvl === "alert" ? (
                    <StatusWord tone="caution">{it.word}</StatusWord>
                  ) : (
                    <GreyTag>{it.word}</GreyTag>
                  )}
                  {it.btns.map((b) => (
                    <ActButton key={b.word} b={b} />
                  ))}
                </span>
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
        {s.lines.length ? (
          <ul className="flex flex-col gap-1.5">
            {s.lines.map((l) => (
              <li key={l.text} className="text-body-s text-foreground">
                {l.kind === "alert" || l.kind === "warn" ? (
                  <StatusWord tone={LINE_TONE[l.kind]} className="whitespace-normal">
                    {l.text}
                  </StatusWord>
                ) : (
                  l.text
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="border-border flex flex-wrap items-center justify-between gap-2 border-t px-6 py-3">
        <div className="flex flex-wrap gap-2">
          {s.btns.map((b) => (
            <ActButton key={b.word} b={b} />
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {C.done2}
        </Button>
      </div>
    </>
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
}: {
  label: string;
  chips: Step["chips"];
  who: Role | null;
  role: Role;
  ended: boolean;
  busy: boolean;
  onChip: (a: Act) => void;
}) {
  const mine = !ended && (who === null || who === role);
  return (
    <div className="flex flex-col gap-1.5">
      {label ? <span className="text-caption text-muted-foreground">{label}</span> : null}
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button
            key={c.word}
            type="button"
            aria-pressed={c.on}
            disabled={!mine || busy || !c.act}
            onClick={() => c.act && onChip(c.act)}
            className={cn(
              "text-caption rounded-sm border px-2 py-1",
              c.on ? "border-primary bg-teal-tint text-teal-text" : "border-border text-foreground",
              !mine && "opacity-70",
            )}
          >
            {c.word}
          </button>
        ))}
      </div>
      {!mine && who ? (
        <span className="text-caption text-muted-foreground">
          {who === "rn" ? C.nurseDot : C.doctorDot}
          {label}
        </span>
      ) : null}
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
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-caption text-muted-foreground">
        {f.label}
        {f.unit ? `, ${f.unit}` : ""}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          inputMode="decimal"
          value={v}
          disabled={!mine}
          onChange={(e) => setV(e.target.value)}
          className="border-border bg-background text-body-s h-8 w-28 rounded-md border px-2 font-mono"
        />
        {mine && v !== f.value ? (
          <Button size="sm" disabled={busy} onClick={() => onValue(f, v)}>
            {f.key === "weight" ? C.saveWeight : C.save}
          </Button>
        ) : null}
        {f.flag ? <StatusWord tone={lvlTone(f.flag.lvl)}>{f.flag.word}</StatusWord> : null}
      </div>
      <span className="text-caption text-muted-foreground">{f.source}</span>
      {f.order ? <ActButton b={f.order} /> : null}
    </div>
  );
}

/* ─── The flow chart ─────────────────────────────────────────────── */

const FLOW_WORD = { done: C.done, needs: C.needsYou, todo: C.toDo, later: C.later } as const;

function Flow({ items, onOpen }: { items: FlowItem[]; onOpen: (key: string) => void }) {
  return (
    <ol className="flex flex-col gap-2">
      {items.map((f, i) =>
        f.kind === "phase" ? (
          <li key={`p${i}`} className="text-label text-foreground mt-2 flex items-center gap-2">
            {f.title}
            {f.now ? <GreyTag>{C.now}</GreyTag> : null}
          </li>
        ) : (
          <li
            key={`${f.key}${i}`}
            className="border-border flex flex-col gap-1.5 rounded-md border px-3 py-2"
          >
            <button
              type="button"
              onClick={() => onOpen(f.key)}
              className="flex flex-wrap items-center gap-2 text-left"
            >
              <span className="text-body-s text-foreground">
                {f.kind === "dec" ? f.q : f.title}
              </span>
              <GreyTag>{FLOW_WORD[f.st]}</GreyTag>
            </button>
            {f.kind === "node" && f.sub ? (
              <span className="text-caption text-muted-foreground">{f.sub}</span>
            ) : null}
            {f.kind === "dec" ? (
              <>
                {f.note ? (
                  <span className="text-caption text-muted-foreground">{f.note}</span>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {f.brs.map((b) => (
                    <span
                      key={b.label}
                      className={cn(
                        "border-border rounded-sm border px-2 py-1",
                        b.state === true
                          ? "bg-muted border-foreground/40"
                          : b.state === false
                            ? "opacity-60"
                            : "",
                      )}
                    >
                      <span className="text-caption text-foreground font-medium">{b.label}</span>
                      <span className="text-caption text-muted-foreground"> · {b.sub}</span>
                      {b.state === true ? (
                        <span className="sr-only"> ({C.thisPatient})</span>
                      ) : null}
                    </span>
                  ))}
                </div>
              </>
            ) : null}
          </li>
        ),
      )}
    </ol>
  );
}

/* ─── Nurse tasks ────────────────────────────────────────────────── */

function Tasks({
  view,
  ActButton,
}: {
  view: ChartView;
  ActButton: (props: { b: Btn }) => React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-heading-s text-foreground">{C.nurseTasks}</h3>
      {view.tasks.length ? (
        <ul className="flex flex-col gap-2">
          {view.tasks.map((t) => (
            <li
              key={t.key}
              className="border-border bg-card flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-label text-foreground">{t.title}</span>
                <span className="text-caption text-muted-foreground">
                  {t.sub ? `${t.sub} · ` : ""}
                  {t.lvl === "alert" ? <StatusWord tone="caution">{t.when}</StatusWord> : t.when}
                </span>
              </span>
              <span className="flex flex-wrap gap-2">
                {t.btns.map((b) => (
                  <ActButton key={b.word} b={b} />
                ))}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-s text-muted-foreground">{C.nothingDue}</p>
      )}
    </section>
  );
}

/* ─── Medicines, notes, log ──────────────────────────────────────── */

function Medicines({
  view,
  names,
  stock,
  busy,
  ended,
  onSend,
}: {
  view: ChartView;
  names: Record<string, string>;
  stock: Record<string, string>;
  busy: boolean;
  ended: boolean;
  onSend: () => void;
}) {
  return (
    <section className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3">
      <h3 className="text-heading-s text-foreground">{C.medsTitle}</h3>
      <ul className="flex flex-col gap-2">
        {view.meds.map((m) => (
          <li key={m.drug} className="flex flex-col gap-0.5">
            <span className="text-body-s text-foreground">
              {names[m.drug] ?? m.drug} · {m.qty}
            </span>
            <span className="text-caption text-muted-foreground">{m.why}</span>
            <span className="text-caption text-muted-foreground">{stock[m.drug] ?? C.noStock}</span>
          </li>
        ))}
      </ul>
      <p className="text-caption text-muted-foreground">{view.medsNote}</p>
      {view.sentAt ? (
        <GreyTag>{fill(C.sent, { t: formatClock(new Date(view.sentAt)) })}</GreyTag>
      ) : !ended && view.meds.length ? (
        <Button size="sm" disabled={busy} onClick={onSend}>
          {busy ? C.sending : C.sendOrder}
        </Button>
      ) : null}
    </section>
  );
}

function Pharmacy({
  view,
  names,
  stock,
}: {
  view: ChartView;
  names: Record<string, string>;
  stock: Record<string, string>;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3">
        <h3 className="text-heading-s text-foreground">{C.drugOrders}</h3>
        {view.sentAt ? (
          <GreyTag>{fill(C.sent, { t: formatClock(new Date(view.sentAt)) })}</GreyTag>
        ) : (
          <p className="text-body-s text-muted-foreground">{C.noOrder}</p>
        )}
        <ul className="flex flex-col gap-2">
          {view.meds.map((m) => (
            <li key={m.drug} className="flex flex-col gap-0.5">
              <span className="text-body-s text-foreground">
                {names[m.drug] ?? m.drug} · {m.qty}
              </span>
              <span className="text-caption text-muted-foreground">{m.why}</span>
              <span className="text-caption text-muted-foreground">
                {stock[m.drug] ?? C.noStock}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3">
        <h3 className="text-heading-s text-foreground">{C.needNext}</h3>
        <dl className="divide-border flex flex-col divide-y">
          {view.phRows.map((r) => (
            <div key={r.k} className="flex flex-col gap-0.5 py-1.5">
              <dt className="text-caption text-muted-foreground">{r.k}</dt>
              <dd className="text-body-s text-foreground">
                {r.cls === "warn" ? <StatusWord tone="caution">{r.v}</StatusWord> : r.v}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
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
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-heading-s text-foreground">{C.notes}</h3>
      <ul className="flex flex-col gap-1.5">
        {view.notes.map((n) => (
          <li key={n.eventId} className="text-body-s text-foreground">
            <span className="text-caption text-muted-foreground font-mono">
              {formatClock(new Date(n.at))} ·{" "}
            </span>
            {n.text}
          </li>
        ))}
      </ul>
      {!ended ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="pc-note" className="sr-only">
            {C.notePlaceholder}
          </label>
          <textarea
            id="pc-note"
            rows={2}
            value={text}
            placeholder={C.notePlaceholder}
            onChange={(e) => setText(e.target.value)}
            className="border-border bg-background text-body-s rounded-md border px-2 py-1.5"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !text.trim()}
            onClick={() => onAdd(text, () => setText(""))}
          >
            {C.addNote}
          </Button>
        </div>
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
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-heading-s text-foreground">{C.recent}</h3>
      <ol className="flex flex-col gap-1">
        {view.log.slice(0, 12).map((l) => (
          <li key={l.eventId} className="flex items-baseline justify-between gap-2">
            <span className="text-body-s text-foreground">
              <span className="text-caption text-muted-foreground font-mono">
                {formatClock(new Date(l.at))} ·{" "}
              </span>
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
  onRecord,
  onVitals,
  onParam,
}: {
  view: ChartView;
  role: Role;
  busy: boolean;
  ended: boolean;
  onRecord: (values: Record<string, string>, done: () => void) => void;
  onVitals: (values: Record<string, string>, done: () => void) => void;
  onParam: (input: { add?: { name: string; unit: string }; removeId?: string }) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      {view.aims.length ? (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-heading-s text-foreground">{C.aims}</h3>
          <ul className="flex flex-wrap gap-2">
            {view.aims.map((a) => (
              <li key={a.word}>
                <GreyTag>
                  {a.word} · {a.known ? (a.ok ? C.met : C.notMet) : C.needsValue}
                </GreyTag>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {role === "rn" && !ended && !view.full && !view.blocked ? (
        <RecordForm view={view} busy={busy} onRecord={onRecord} />
      ) : (
        <p className="text-body-s text-muted-foreground">
          {view.full ? C.allCharted : role === "dr" ? C.doctorRecNote : C.readOnly}
        </p>
      )}
      <VitalsCard
        view={view}
        role={role}
        busy={busy}
        ended={ended}
        onVitals={onVitals}
        onParam={onParam}
      />
      {view.panels.length ? (
        <section className="flex flex-col gap-3">
          <h3 className="text-heading-s text-foreground">{C.trends}</h3>
          <div className="grid gap-5 xl:grid-cols-2">
            {view.panels.map((pn) => (
              <TrendPanel key={pn.key} p={pn} slots={view.slotCount} slotWord={view.slotWord} />
            ))}
          </div>
        </section>
      ) : null}
      <section className="flex min-w-0 flex-col gap-2">
        <h3 className="text-heading-s text-foreground">{C.grid}</h3>
        <div className="max-w-full overflow-x-auto">
          <table className="text-caption border-collapse font-mono">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="text-muted-foreground bg-background sticky left-0 px-2 py-1 text-left font-sans"
                >
                  {view.slotWord}
                </th>
                {view.grid.head.map((h, i) => (
                  <th
                    key={i}
                    scope="col"
                    className={cn(
                      "px-2 py-1 text-right",
                      h.now ? "text-foreground" : "text-muted-foreground",
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
                    className="text-foreground bg-background sticky left-0 px-2 py-1 text-left font-sans font-normal whitespace-nowrap"
                  >
                    {r.label}
                  </th>
                  {r.cells.map((c, i) => (
                    <td
                      key={i}
                      className={cn(
                        "px-2 py-1 text-right whitespace-nowrap",
                        c.now && "bg-muted",
                        c.due && "border-muted-foreground border border-dashed",
                      )}
                    >
                      {c.due ? (
                        <span className="text-muted-foreground font-sans">{C.dueCell}</span>
                      ) : (
                        c.t
                      )}
                      {c.flag && c.flag.lvl !== "ok" ? (
                        <span className="font-sans"> · {c.flag.word}</span>
                      ) : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
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
  const [vals, setVals] = useState<Record<string, string>>(
    Object.fromEntries(view.form.map((f) => [f.key, f.dflt])),
  );
  return (
    <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-heading-s text-foreground">
          {fill(C.recordFor, { slot: `${view.slotWord} ${view.nextSlot}` })}
        </h3>
        <span className="text-caption text-muted-foreground">
          {fill(C.recordDue, { t: formatClock(new Date(view.nextDue)) })}
        </span>
      </div>
      <p className="text-caption text-muted-foreground">{view.recHint}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {view.form.map((f) => (
          <label key={f.key} className="flex min-w-0 flex-col gap-1">
            <span className="text-caption text-muted-foreground">
              {f.label}
              {f.unit ? `, ${f.unit}` : ""}
              {view.formReq.includes(f.key) ? " *" : ""}
            </span>
            <input
              inputMode={f.key === "uket" ? "text" : "decimal"}
              value={vals[f.key] ?? ""}
              onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
              className="border-border bg-background text-body-s h-8 w-full min-w-0 rounded-md border px-2 font-mono"
            />
          </label>
        ))}
      </div>
      <Button
        size="sm"
        className="w-fit"
        disabled={busy || view.formReq.some((k) => !vals[k]?.trim())}
        onClick={() =>
          onRecord(vals, () => setVals(Object.fromEntries(view.form.map((f) => [f.key, f.dflt]))))
        }
      >
        {busy ? C.saving : C.save}
      </Button>
    </section>
  );
}

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
  const gcs = ["gcsE", "gcsV", "gcsM"].map((k) => Number(vals[k]));
  const gcsTotal = gcs.every((n) => Number.isInteger(n) && n > 0)
    ? gcs.reduce((a, b) => a + b, 0)
    : null;
  return (
    <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-heading-s text-foreground">{C.vitalsTitle}</h3>
        <span className="text-caption text-muted-foreground">
          {V.last === null ? (
            C.vitalsNone
          ) : V.overdue ? (
            <StatusWord tone="caution">
              {fill(C.vitalsOverdue, {
                t: formatClock(new Date(V.due)),
                last: formatClock(new Date(V.last)),
              })}
            </StatusWord>
          ) : (
            fill(C.vitalsDue, {
              t: formatClock(new Date(V.due)),
              last: formatClock(new Date(V.last)),
            })
          )}
        </span>
      </div>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {V.tiles.map((t) => (
          <li
            key={t.key}
            className="border-border flex min-w-0 flex-col gap-1 rounded-md border p-2"
          >
            <span className="text-caption text-muted-foreground flex items-center justify-between gap-1">
              {t.label}
              {t.paramId && role === "dr" && !ended ? (
                <Button size="sm" variant="link" onClick={() => onParam({ removeId: t.paramId! })}>
                  {C.remove}
                </Button>
              ) : null}
            </span>
            <span className="text-body-m text-foreground font-mono">
              {t.value}
              {t.value !== "—" && t.unit ? (
                <span className="text-caption text-muted-foreground"> {t.unit}</span>
              ) : null}
            </span>
            {t.flag ? (
              <StatusWord tone={lvlTone(t.flag.lvl)}>{t.word}</StatusWord>
            ) : (
              <span className="text-caption text-muted-foreground">{t.word}</span>
            )}
            <MiniTrend t={t} />
            {t.delta ? <span className="text-caption text-muted-foreground">{t.delta}</span> : null}
          </li>
        ))}
      </ul>
      {role === "rn" && !ended ? (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {V.inputs.map((i) => (
              <label key={i.key} className="flex min-w-0 flex-col gap-1">
                <span className="text-caption text-muted-foreground">
                  {i.label}
                  {i.unit ? ` (${i.unit})` : ""}
                </span>
                <input
                  inputMode={i.key.startsWith("cx_") ? "text" : "numeric"}
                  value={vals[i.key] ?? ""}
                  onChange={(e) => setVals({ ...vals, [i.key]: e.target.value })}
                  className="border-border bg-background text-body-s h-8 w-full min-w-0 rounded-md border px-2 font-mono"
                />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {gcsTotal !== null ? (
              <span className="text-body-s text-foreground">
                {fill(C.gcsTotal, { n: gcsTotal })}
              </span>
            ) : null}
            <Button
              size="sm"
              disabled={busy || !Object.values(vals).some((x) => x.trim())}
              onClick={() => onVitals(vals, () => setVals({}))}
            >
              {C.saveVitals}
            </Button>
          </div>
        </div>
      ) : null}
      {role === "dr" && !ended ? (
        adding ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-caption text-muted-foreground">{C.paramName}</span>
              <input
                list="pc-params"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  const s = V.suggest.find((x) => x.name === e.target.value);
                  if (s) setUnit(s.unit);
                }}
                className="border-border bg-background text-body-s h-8 w-40 rounded-md border px-2"
              />
              <datalist id="pc-params">
                {V.suggest.map((s) => (
                  <option key={s.name} value={s.name} />
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-muted-foreground">{C.paramUnit}</span>
              <input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="border-border bg-background text-body-s h-8 w-20 rounded-md border px-2"
              />
            </label>
            <Button
              size="sm"
              disabled={busy || !name.trim()}
              onClick={() => {
                onParam({ add: { name, unit } });
                setAdding(false);
                setName("");
                setUnit("");
              }}
            >
              {C.add}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" className="w-fit" onClick={() => setAdding(true)}>
            {C.addParam}
          </Button>
        )
      ) : null}
      {V.rows.length ? (
        <div className="max-w-full overflow-x-auto">
          <table className="text-caption w-full border-collapse">
            <thead>
              <tr>
                {V.head.map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="text-muted-foreground px-2 py-1 text-left font-normal whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {V.rows.map((r) => (
                <tr key={r.at} className="border-border border-t">
                  {r.cells.map((c, i) => (
                    <td key={i} className="text-foreground px-2 py-1 font-mono whitespace-nowrap">
                      {c.t}
                      {c.flag && c.flag.lvl !== "ok" ? (
                        <span className="font-sans"> · {c.flag.word}</span>
                      ) : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

/** Local development only: move the chart clock to try the next hours (never in production). */
function DevClock({ minutes }: { minutes: number }) {
  const href = (m: number) => `?at=${m}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-caption text-muted-foreground">{C.devClock}</span>
      {[0, 60, 360].map((m) => (
        <Link
          key={m}
          href={href(minutes + m)}
          className="text-teal-text text-caption underline-offset-[3px] hover:underline"
        >
          {m === 0 ? `+0 (${minutes} min)` : `+${m / 60} h`}
        </Link>
      ))}
    </div>
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
