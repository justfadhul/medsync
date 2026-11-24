"use client";

import type { SimpleResult } from "@/components/wards/editor/ward-editor";
import type { WaitReason } from "@/lib/emr/closure";
import type { BoardBed, BoardData, BoardWaiting } from "@/lib/wards/board";
import type { BedState, SettableState } from "@/supabase/functions/_shared/ward-layout";
import type { PointerEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { XIcon } from "lucide-react";

import { StatusWord } from "@/components/emr/status-word";
import { EditorDialog } from "@/components/medsync/editor-dialog";
import { Button } from "@/components/ui/button";
import { DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { planAspect, PlanView } from "@/components/wards/plan/plan-view";
import { PlanZoomControls, PlanZoomFrame, usePlanZoom } from "@/components/wards/plan/plan-zoom";
import { WardHeader } from "@/components/wards/ward-header";
import { EU_BOARD } from "@/content/eu/words";
import { cn } from "@/lib/utils";
import { moveTargets } from "@/lib/wards/eu-move";
import { useBedBoardLive } from "@/lib/wards/use-board-live";
import { ARRIVING_ATTENTION_MS, WAIT_REASON_WORDS } from "@/lib/wards/waiting";
import { ago } from "@/lib/workspace/words";
import {
  BED_STATES,
  bedStateMeta,
  freeByNeed,
  SERVICES,
  stateCounts,
} from "@/supabase/functions/_shared/ward-layout";
import { CautionNote, Chip, ChipChoice, inputClass, Section } from "../ui";

export interface BoardActions {
  setState: (
    wardId: string,
    bedId: string,
    state: SettableState,
    reason: string | null,
  ) => Promise<SimpleResult>;
  assign: (wardId: string, bedId: string, patientUserId: string) => Promise<SimpleResult>;
  release: (
    wardId: string,
    assignmentId: string,
    reason: string,
    next: "cleaning" | "free" | null,
  ) => Promise<SimpleResult>;
  /** ADR 0199: a free bed for an admission on the waiting list; the bed becomes Arriving. */
  allocate: (wardId: string, admissionId: string, bedId: string) => Promise<SimpleResult>;
  /** Arrived: the Arriving bed is Occupied and the inpatient encounter opens. */
  confirmArrival: (wardId: string, assignmentId: string) => Promise<SimpleResult>;
  /** Cancel an allocation (back to the waiting list, or the admission ends), or end a wait. */
  releaseAdmission: (
    wardId: string,
    admissionId: string,
    reason: string,
    outcome: "wait" | "end",
  ) => Promise<SimpleResult>;
  /** An EU stay moves to a free space of this unit, or waits for one (only where the EU is live). */
  moveEu?: (
    wardId: string,
    stayId: string,
    target: { bedId?: string; waitReason?: WaitReason; waitNote?: string },
  ) => Promise<SimpleResult>;
}

export interface BoardLinks {
  crumbs: { label: string; href?: string }[];
  board: (wardId: string) => string;
  /** The layout editor, for the hospital admin; null for nurses. */
  layout: ((wardId: string) => string) | null;
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Kampala",
  });

/** "3 h" since an instant. Rendered on the server and again in the browser, so a minute may differ. */
const heldFor = (iso: string) => ago(Date.now() - Date.parse(iso));

const CANCEL_OUTCOMES = [
  { value: "wait", label: "Still needs a bed (back to the waiting list)" },
  { value: "end", label: "No longer needs one (end the admission)" },
] as const;

/** The patient as this viewer may see them: the name for the ward's staff, else the MRN. */
function Who({ p }: { p: { name: string | null; mrn: string | null } }) {
  return (
    <>
      {p.name ? <span className="text-body-s text-foreground truncate">{p.name}</span> : null}
      <span className="text-mono-s text-ink-600 font-mono">{p.mrn ?? "No MRN"}</span>
    </>
  );
}

/** The legend's swatch for each state: the same paint as the plan, and the word. */
const SWATCH: Record<BedState, string> = {
  occupied: "bg-teal-tint border-teal-700 text-teal-text",
  arriving: "bg-card border-teal-700 border-dashed text-teal-text",
  free: "bg-card border-ink-700 text-foreground",
  cleaning: "bg-sky-tint border-sky-icon text-sky-text",
  reserved: "bg-ink-100 border-ink-600 border-dashed text-ink-700",
  out: "border-ink-400 text-ink-700 [background:repeating-linear-gradient(45deg,var(--color-card)_0_4px,var(--color-ink-200)_4px_8px)]",
};

export function StateWord({ state, className }: { state: BedState; className?: string }) {
  const m = bedStateMeta(state);
  return (
    <span
      className={cn(
        "text-caption inline-flex h-[22px] min-w-10 items-center justify-center rounded-xs border-[1.5px] px-1.5 font-semibold",
        SWATCH[state],
        className,
      )}
    >
      {m.short}
    </span>
  );
}

/**
 * The live bed board (ADR 0194): the published plan, read-only, each bed with its state word and tint;
 * choosing a bed shows its services and state, and staff with rights set Free, Cleaning or Reserved,
 * put a patient in the bed or take them out. "Free beds, by what the patient needs" is one pass over
 * the beds, their services and state. The same component serves the hospital admin and the ward's
 * nurses; `mayAct` and what of a patient is shown come from the server.
 */
export function BedBoard({
  data,
  hospitalId,
  mayAct,
  actions,
  links,
  initialSelected = null,
  live: liveOn = true,
  fit = "screen",
}: {
  data: BoardData;
  hospitalId: string;
  mayAct: boolean;
  actions: BoardActions;
  links: BoardLinks;
  initialSelected?: string | null;
  /** Subscribe to the live topic (off in the styleguide fixture). */
  live?: boolean;
  /** `frame`: fill the admin frame's page (phase 2 of ADR 0520) instead of the screen under a 3rem top bar. */
  fit?: "screen" | "frame";
}) {
  const router = useRouter();
  const zoom = usePlanZoom();
  const live = useBedBoardLive(hospitalId, data.ward.id, liveOn);
  const [selectedKey, setSelectedKey] = useState<string | null>(initialSelected);
  // A bed chosen from a list or a chip takes focus to its panel (the button that was pressed is
  // gone); closing the panel brings it back to that bed in "Every bed".
  const [focusPanel, setFocusPanel] = useState(false);
  const [returnKey, setReturnKey] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const choose = (key: string) => {
    setSelectedKey(key);
    setFocusPanel(true);
  };
  useEffect(() => {
    if (selectedKey || !returnKey) return;
    listRef.current
      ?.querySelector<HTMLButtonElement>(`[data-bed-key="${CSS.escape(returnKey)}"]`)
      ?.focus();
  }, [selectedKey, returnKey]);
  const byKey = useMemo(() => new Map(data.beds.map((b) => [b.key, b])), [data.beds]);
  const selected = selectedKey ? (byKey.get(selectedKey) ?? null) : null;
  const states = useMemo(
    () => Object.fromEntries(data.beds.map((b) => [b.key, b.state])),
    [data.beds],
  );
  const counts = stateCounts(data.beds);
  const byNeed = freeByNeed(data.beds.map((b) => ({ ...b, id: b.key })));
  const inService = data.beds.length - counts.out;

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    const raw = (e.target as Element).closest("[data-ref]")?.getAttribute("data-ref");
    if (raw?.startsWith("bed:")) setSelectedKey(raw.slice(4));
    else setSelectedKey(null);
  };

  const tabs = data.tabs.map((t) => ({
    id: t.id,
    name: t.name,
    sub: `${t.sex ? `${t.sex[0]!.toUpperCase()}${t.sex.slice(1)} · ` : ""}${t.bedCount} ${t.bedCount === 1 ? "bed" : "beds"}`,
    href: links.board(t.id),
    current: t.id === data.ward.id,
  }));

  return (
    <div
      className={cn(
        "flex flex-col",
        fit === "frame" ? "h-full min-h-[560px]" : "h-[calc(100svh-3rem)] min-h-[640px]",
      )}
    >
      <WardHeader
        crumbs={[...links.crumbs, { label: data.ward.name }]}
        title="Bed board"
        mode="live"
        buildHref={links.layout ? links.layout(data.ward.id) : null}
        liveHref={links.layout ? links.board(data.ward.id) : null}
        tabs={tabs}
        right={
          <span className="text-caption text-ink-600 font-normal" role="status">
            {live ? "Live: changes appear as they happen" : "Updates every 15 seconds"}
            {data.published ? ` · layout version ${data.published.version}` : ""}
          </span>
        }
      />

      {!data.doc ? (
        <div className="bg-ink-100 flex flex-1 items-start justify-center p-6">
          <div className="bg-card shadow-card flex max-w-xl flex-col gap-2 rounded-lg p-6">
            <h2 className="text-heading-m text-foreground">No published layout yet</h2>
            <p className="text-body-s text-ink-600">
              The bed board shows the ward&rsquo;s published floor plan.
              {links.layout
                ? " Lay the ward out and publish it first."
                : " The hospital admin lays the ward out and publishes it."}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto xl:grid-cols-[200px_minmax(0,1fr)_272px] xl:overflow-hidden 2xl:grid-cols-[216px_minmax(0,1fr)_296px]">
          <aside
            aria-label="Bed states"
            className="border-border bg-card order-3 flex flex-col gap-3 overflow-y-auto border-t p-3 xl:order-1 xl:border-t-0 xl:border-r"
          >
            <Section title="Bed state">
              <ul className="flex flex-col gap-2">
                {BED_STATES.map((s) => (
                  <li key={s.code} className="text-body-s flex items-center gap-2.5">
                    <StateWord state={s.code} />
                    <span className="text-foreground flex-1">{s.label}</span>
                    <span className="text-ink-600 font-mono tabular-nums">{counts[s.code]}</span>
                  </li>
                ))}
              </ul>
            </Section>
            <p className="text-caption text-muted-foreground font-normal">
              Occupied comes from putting a patient in a bed here; Arriving from a bed given to an
              admitted patient who is not here yet; Out from the layout or the register. Nurses on
              the ward set Cleaning and Reserved.
            </p>
            {links.layout ? (
              <Link
                href={links.layout(data.ward.id)}
                className="text-label text-teal-text self-start hover:underline"
              >
                Edit the layout
              </Link>
            ) : null}
          </aside>

          <main className="order-1 flex min-h-[520px] min-w-0 flex-col xl:order-2 xl:min-h-0">
            <div className="border-border bg-card flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-1.5">
              <p className="text-caption text-ink-600 min-w-48 flex-1 basis-60 font-normal">
                Choose a bed to see its services or change its state. The layout is locked here
                {links.layout ? "; switch to Build to edit it." : "."}
              </p>
              <PlanZoomControls z={zoom} />
            </div>
            <div className="bg-ink-100 flex min-h-[280px] flex-1 flex-col p-3">
              <PlanZoomFrame z={zoom} aspect={planAspect(data.doc.floor)} className="flex-1">
                <PlanView
                  doc={data.doc}
                  mode="live"
                  label={`Bed board of ${data.ward.name}: ${counts.occupied} of ${inService} beds occupied, ${counts.arriving} arriving, ${counts.free} free`}
                  states={states}
                  selected={selected ? { kind: "bed", key: selected.key } : null}
                  className="h-full w-full"
                  onPointerDown={onPointerDown}
                />
              </PlanZoomFrame>
            </div>
            <div className="border-border bg-card flex min-h-10 flex-wrap items-center gap-x-5 gap-y-1.5 border-t px-3 py-1.5">
              {(
                [
                  [`${counts.occupied}/${inService}`, "occupied"],
                  [String(counts.arriving), "arriving"],
                  [String(counts.free), "free"],
                  [String(counts.cleaning), "cleaning"],
                  [String(counts.reserved), "reserved"],
                  [String(counts.out), "out of service"],
                ] as const
              ).map(([v, l]) => (
                <span
                  key={l}
                  className="text-caption text-muted-foreground inline-flex items-baseline gap-1.5 font-normal"
                >
                  <span className="text-foreground font-mono text-[14px] font-medium tabular-nums">
                    {v}
                  </span>
                  {l}
                </span>
              ))}
            </div>
          </main>

          <aside
            aria-label="Bed"
            className="border-border bg-card order-2 overflow-y-auto border-t p-4 xl:order-3 xl:border-t-0 xl:border-l xl:pb-24"
          >
            {selected ? (
              <BedPanel
                key={`${selected.key}:${selected.state}:${selected.assignmentId ?? ""}`}
                bed={selected}
                wardId={data.ward.id}
                mayAct={mayAct}
                candidates={data.candidates}
                waiting={data.waiting}
                freeBeds={moveTargets(data.beds)}
                actions={actions}
                autoFocus={focusPanel}
                onClose={() => {
                  setReturnKey(selected.key);
                  setSelectedKey(null);
                }}
                onDone={() => router.refresh()}
              />
            ) : (
              <div className="flex flex-col gap-5">
                {data.needsAttention.length ? (
                  <Section title="Needs attention">
                    <CautionNote>
                      Held as Arriving for more than {ARRIVING_ATTENTION_MS / 3_600_000} h. Nothing
                      releases a bed on its own: confirm the arrival or cancel it.
                    </CautionNote>
                    <ul className="flex flex-wrap gap-1">
                      {data.needsAttention.map((b) => (
                        <li key={b.key}>
                          <button
                            type="button"
                            onClick={() => choose(b.key)}
                            className="border-ink-300 bg-card text-foreground hover:bg-ink-50 focus-visible:shadow-focus text-caption inline-flex h-7 items-center gap-1.5 rounded-sm border px-2 outline-none"
                          >
                            <span className="font-mono">{b.label}</span>
                            <span className="text-ink-600 font-normal" suppressHydrationWarning>
                              Arriving · held {b.since ? heldFor(b.since) : ""}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </Section>
                ) : null}
                <Section title={`Waiting for a bed (${data.waiting.length})`}>
                  {data.waiting.length ? (
                    <ul className="flex flex-col gap-1.5">
                      {data.waiting.map((w) => (
                        <WaitingRow
                          key={w.admissionId}
                          w={w}
                          wardId={data.ward.id}
                          mayAct={mayAct}
                          freeBeds={data.beds.filter((b) => b.state === "free")}
                          actions={actions}
                          onDone={() => router.refresh()}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-caption text-muted-foreground font-normal">
                      Nobody admitted to this ward is waiting for a bed.
                    </p>
                  )}
                </Section>
                <Section title="Free beds, by what the patient needs">
                  <ul className="flex flex-col">
                    {byNeed.map((n) => (
                      <li
                        key={n.need}
                        className="border-ink-150 flex flex-col gap-1.5 border-b py-2 first:pt-0"
                      >
                        <div className="text-body-s flex justify-between">
                          <span className="text-foreground font-medium">{n.label}</span>
                          <span className="text-ink-600 font-mono tabular-nums">
                            {n.beds.length}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {n.beds.length ? (
                            n.beds.map((b) => (
                              <button
                                key={b.id}
                                type="button"
                                onClick={() => choose(b.id)}
                                className="border-ink-300 bg-card text-foreground hover:bg-ink-50 focus-visible:shadow-focus h-6 rounded-sm border px-2 font-mono text-[12px] outline-none"
                                aria-label={`Bed ${b.label}, free`}
                              >
                                {b.label}
                              </button>
                            ))
                          ) : (
                            <span className="text-caption text-ink-600 font-normal">None free</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="text-caption text-muted-foreground font-normal">
                    This is why the layout records services per bed: a patient on oxygen is matched
                    to a free bed that has it.
                  </p>
                </Section>
                <Section title="Every bed">
                  <ul ref={listRef} className="grid grid-cols-2 gap-1">
                    {data.beds.map((b) => (
                      <li key={b.key}>
                        <button
                          type="button"
                          data-bed-key={b.key}
                          onClick={() => choose(b.key)}
                          className="hover:bg-ink-50 focus-visible:shadow-focus flex w-full items-center justify-between gap-2 rounded-sm px-1.5 py-1 text-left outline-none"
                        >
                          <span className="text-body-s text-foreground font-mono">{b.label}</span>
                          <StateWord state={b.state} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </Section>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

/* ─── one bed ───────────────────────────────────────────────────────── */

function BedPanel({
  bed,
  wardId,
  mayAct,
  candidates,
  waiting,
  freeBeds,
  actions,
  autoFocus,
  onClose,
  onDone,
}: {
  bed: BoardBed;
  wardId: string;
  mayAct: boolean;
  candidates: BoardData["candidates"];
  waiting: BoardData["waiting"];
  /** This unit's free spaces, for Move. */
  freeBeds: BoardBed[];
  actions: BoardActions;
  /** Focus the bed's heading on mount: chosen from a list, or back after an action changed it. */
  autoFocus: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  // Only when focus was lost (its button went) or is already in this panel: a live update that
  // re-renders the bed never pulls focus from where the user is working.
  useEffect(() => {
    if (!autoFocus) return;
    const a = document.activeElement;
    if (!a || a === document.body || heading.current?.closest("aside")?.contains(a))
      heading.current?.focus();
  }, [autoFocus]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reserving, setReserving] = useState(false);
  const [holdFor, setHoldFor] = useState("");
  const [why, setWhy] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [outcome, setOutcome] = useState<"wait" | "end" | null>(null);
  const [moving, setMoving] = useState(false);
  const run = (fn: () => Promise<SimpleResult>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else onDone();
      // The pressed button was disabled while the action ran, which drops focus.
      if (document.activeElement === document.body) heading.current?.focus();
    });
  };
  const meta = bedStateMeta(bed.state);
  const where = [
    bed.roomName ?? "open ward",
    meta.label.toLowerCase(),
    bed.since ? `since ${clock(bed.since)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const services = SERVICES.filter((s) => bed.services.includes(s.code));
  const occupied = bed.state === "occupied";
  const arriving = bed.state === "arriving";
  const out = bed.state === "out";
  // Free, Cleaning and Reserved: the states ward staff set, and where a patient can be put.
  const settable = !occupied && !arriving && !out;
  // An EU space ends by the visit closing or a move, never Release; Move needs the action the page passed.
  const eu = bed.euStayId != null;
  const mayMove = mayAct && eu && !!actions.moveEu && !!bed.assignmentId;
  // An admission takes only a Free bed (the allocation refuses Cleaning and Reserved).
  const offer = bed.state === "free" ? waiting : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-overline text-muted-foreground uppercase">Bed</span>
          <h2
            ref={heading}
            tabIndex={-1}
            className="text-heading-m text-foreground flex items-center gap-2 outline-none"
          >
            <span className="font-mono">{bed.label}</span>
            <StateWord state={bed.state} />
          </h2>
          <span className="text-caption text-muted-foreground font-normal">{where}</span>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close, back to free beds" onClick={onClose}>
          <XIcon aria-hidden />
        </Button>
      </div>

      {occupied ? (
        <section
          aria-label="Patient"
          className="border-border flex flex-col gap-1 rounded-lg border p-3"
        >
          <span className="text-caption text-ink-600">Patient</span>
          {bed.patient ? (
            <>
              {bed.patient.name ? (
                <span className="text-body-m text-foreground">{bed.patient.name}</span>
              ) : null}
              <span className="text-mono-s text-ink-600 font-mono">
                {bed.patient.mrn ?? "No MRN"}
              </span>
              {bed.ipc?.map((f) => (
                <StatusWord key={f} tone="caution">{`Infection prevention: ${f}`}</StatusWord>
              ))}
            </>
          ) : (
            <span className="text-body-s text-ink-600">Occupied.</span>
          )}
        </section>
      ) : null}

      {arriving ? (
        <section
          aria-label="Arriving patient"
          className="border-border flex flex-col gap-1 rounded-lg border p-3"
        >
          <span className="text-caption text-ink-600">Arriving</span>
          {bed.patient ? <Who p={bed.patient} /> : null}
          {bed.admittedBy ? (
            <span className="text-caption text-ink-700 font-normal">
              Admitted by {bed.admittedBy}
            </span>
          ) : null}
          {bed.since ? (
            <span className="text-caption text-muted-foreground font-normal">
              Bed held since {clock(bed.since)} ·{" "}
              <span suppressHydrationWarning>{heldFor(bed.since)}</span>
            </span>
          ) : null}
        </section>
      ) : null}

      {mayAct && arriving && bed.assignmentId && (bed.admissionId || eu) ? (
        <Section title="When the patient is here">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() => run(() => actions.confirmArrival(wardId, bed.assignmentId!))}
            >
              Arrived
            </Button>
            {bed.admissionId ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                aria-expanded={cancelling}
                onClick={() => setCancelling((v) => !v)}
              >
                Cancel…
              </Button>
            ) : null}
          </div>
          <p className="text-caption text-muted-foreground font-normal">
            {eu
              ? EU_BOARD.arrivedNote
              : "Arrived makes the bed Occupied and opens the patient\u2019s inpatient record."}
          </p>
          {cancelling && bed.admissionId ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cancel-why" className="text-caption text-ink-700">
                Why the bed is no longer held
              </label>
              <input
                id="cancel-why"
                className={inputClass}
                value={why}
                maxLength={200}
                placeholder="For example, went to another hospital"
                onChange={(e) => setWhy(e.target.value)}
              />
              <ChipChoice
                label="What happens to the admission"
                value={outcome}
                options={CANCEL_OUTCOMES}
                onChange={setOutcome}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={pending || why.trim().length < 3 || !outcome}
                  onClick={() =>
                    run(() =>
                      actions.releaseAdmission(wardId, bed.admissionId!, why.trim(), outcome!),
                    )
                  }
                >
                  Cancel the allocation
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCancelling(false)}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : null}
        </Section>
      ) : null}

      {out ? (
        <p className="text-body-s text-ink-700">
          Out of service. The hospital admin puts it back in service in the layout or the register.
        </p>
      ) : null}

      {mayAct && settable ? (
        <Section title="State">
          <div className="flex flex-wrap gap-1.5">
            {(["free", "cleaning", "reserved"] as const).map((s) => (
              <Chip
                key={s}
                on={bed.state === s || (s === "reserved" && reserving)}
                disabled={pending}
                onClick={() => {
                  if (s === "reserved") return setReserving(true);
                  setReserving(false);
                  if (bed.state !== s) run(() => actions.setState(wardId, bed.bedId, s, null));
                }}
              >
                {bedStateMeta(s).label}
              </Chip>
            ))}
          </div>
          {bed.state === "reserved" && bed.reason ? (
            <p className="text-caption text-ink-600 font-normal">Held for: {bed.reason}</p>
          ) : null}
          {reserving ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="hold-for" className="text-caption text-ink-700">
                Held for (who or why)
              </label>
              <input
                id="hold-for"
                className={inputClass}
                value={holdFor}
                maxLength={200}
                placeholder="For example, transfer from HDU"
                onChange={(e) => setHoldFor(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={pending || holdFor.trim().length < 3}
                  onClick={() =>
                    run(() => actions.setState(wardId, bed.bedId, "reserved", holdFor.trim()))
                  }
                >
                  Reserve {bed.label}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setReserving(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </Section>
      ) : null}

      {mayMove && (occupied || arriving) ? (
        <Section title={EU_BOARD.moveSection}>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => setMoving(true)}
            >
              {EU_BOARD.move}
            </Button>
          </div>
          <MoveEuDialog
            open={moving}
            onOpenChange={setMoving}
            from={bed.label}
            freeBeds={freeBeds.filter((b) => b.key !== bed.key)}
            pending={pending}
            error={error}
            onMove={(target) => run(() => actions.moveEu!(wardId, bed.euStayId!, target))}
          />
        </Section>
      ) : null}

      {mayAct && occupied && bed.assignmentId && !eu ? (
        <Section title="Take the patient out of this bed">
          <label htmlFor="release-why" className="text-caption text-ink-700">
            Why
          </label>
          <input
            id="release-why"
            className={inputClass}
            value={why}
            maxLength={200}
            placeholder="For example, discharged home"
            onChange={(e) => setWhy(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending || why.trim().length < 3}
              onClick={() =>
                run(() => actions.release(wardId, bed.assignmentId!, why.trim(), "cleaning"))
              }
            >
              Release, bed to cleaning
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || why.trim().length < 3}
              onClick={() =>
                run(() => actions.release(wardId, bed.assignmentId!, why.trim(), "free"))
              }
            >
              Release, bed free
            </Button>
          </div>
        </Section>
      ) : null}

      {mayAct && settable ? (
        <Section title="Put a patient in this bed">
          {waiting.length && !offer.length ? (
            <p className="text-caption text-ink-600 font-normal">
              {waiting.length} admitted {waiting.length === 1 ? "patient is" : "patients are"}{" "}
              waiting for a bed: set this bed Free to give it to one of them.
            </p>
          ) : null}
          {offer.length || candidates.length ? (
            <ul className="flex flex-col gap-1.5">
              {/* Admitted patients on the waiting list first (ADR 0200 §4): the bed becomes Arriving. */}
              {offer.map((w) => (
                <li
                  key={w.admissionId}
                  className="border-border flex items-center justify-between gap-2 rounded-md border px-2.5 py-2"
                >
                  <span className="flex min-w-0 flex-col">
                    <Who p={w} />
                    <span className="text-caption text-muted-foreground font-normal">
                      Admitted, waiting since {clock(w.decidedAt)}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => run(() => actions.allocate(wardId, w.admissionId, bed.bedId))}
                  >
                    Give {bed.label}
                  </Button>
                </li>
              ))}
              {/* Sent straight to the ward by the desk (ADR 0194 §4): Occupied at once. */}
              {candidates.map((c) => (
                <li
                  key={c.patientUserId}
                  className="border-border flex items-center justify-between gap-2 rounded-md border px-2.5 py-2"
                >
                  <span className="flex min-w-0 flex-col">
                    {c.name ? (
                      <span className="text-body-s text-foreground truncate">{c.name}</span>
                    ) : null}
                    <span className="text-mono-s text-ink-600 font-mono">{c.mrn ?? "No MRN"}</span>
                    <span className="text-caption text-muted-foreground font-normal">
                      Arrived {clock(c.arrivedAt)}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => run(() => actions.assign(wardId, bed.bedId, c.patientUserId))}
                  >
                    Put in {bed.label}
                  </Button>
                </li>
              ))}
            </ul>
          ) : waiting.length ? null : (
            <p className="text-body-s text-ink-600">
              Nobody is waiting for this ward. Patients appear here when they are admitted to it, or
              when their intake names it as the receiving ward.
            </p>
          )}
        </Section>
      ) : null}

      <Section title="Services at this bed">
        {services.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {services.map((s) => (
              <li
                key={s.code}
                className="bg-ink-100 text-caption text-foreground inline-flex h-[26px] items-center rounded-sm px-2 font-normal"
              >
                {s.label}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-caption text-muted-foreground font-normal">None recorded</p>
        )}
      </Section>

      {error ? <CautionNote alert>{error}</CautionNote> : null}
    </div>
  );
}

/* ─── one admitted patient waiting for a bed ─────────────────────────── */

/** Move an EU patient: a free space of this unit as a chip, or the reason they wait for one. */
function MoveEuDialog({
  open,
  onOpenChange,
  from,
  freeBeds,
  pending,
  error,
  onMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  from: string;
  freeBeds: BoardBed[];
  pending: boolean;
  error: string | null;
  onMove: (target: { bedId?: string; waitReason?: WaitReason; waitNote?: string }) => void;
}) {
  const [bedId, setBedId] = useState<string | null>(null);
  const [reason, setReason] = useState<WaitReason | null>(null);
  const [note, setNote] = useState("");
  const to = freeBeds.find((b) => b.bedId === bedId);
  return (
    <EditorDialog open={open} onOpenChange={onOpenChange} width="medium">
      <DialogHeader className="p-4 pb-0">
        <DialogTitle>{EU_BOARD.moveTitle(from)}</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-4 overflow-y-auto p-4">
        <Section title={EU_BOARD.moveSpace}>
          {freeBeds.length ? (
            <div className="flex flex-wrap gap-1.5">
              {freeBeds.map((b) => (
                <Chip
                  key={b.bedId}
                  on={bedId === b.bedId}
                  disabled={pending}
                  onClick={() => {
                    setBedId(b.bedId);
                    setReason(null);
                  }}
                >
                  {b.label}
                </Chip>
              ))}
            </div>
          ) : (
            <p className="text-caption text-ink-600 font-normal">{EU_BOARD.noFreeSpace}</p>
          )}
        </Section>
        <Section title={EU_BOARD.moveWait}>
          <ChipChoice
            label={EU_BOARD.waitWhy}
            value={reason}
            options={(Object.keys(WAIT_REASON_WORDS) as WaitReason[]).map((value) => ({
              value,
              label: WAIT_REASON_WORDS[value],
            }))}
            onChange={(v) => {
              setReason(v);
              setBedId(null);
            }}
          />
          {reason ? (
            <>
              <label htmlFor="move-wait-note" className="text-caption text-ink-700">
                {EU_BOARD.waitNote}
              </label>
              <input
                id="move-wait-note"
                className={inputClass}
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
              />
            </>
          ) : null}
        </Section>
        {error ? <CautionNote alert>{error}</CautionNote> : null}
        {!to && !reason ? (
          <p className="text-caption text-ink-600 font-normal">{EU_BOARD.chooseSpace}</p>
        ) : null}
      </div>
      <DialogFooter className="p-4 pt-0">
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          {EU_BOARD.keep}
        </Button>
        <Button
          size="sm"
          disabled={pending || (!to && !reason)}
          onClick={() =>
            onMove(
              to
                ? { bedId: to.bedId }
                : { waitReason: reason!, ...(note.trim() ? { waitNote: note.trim() } : {}) },
            )
          }
        >
          {to ? EU_BOARD.moveSpaceAction(to.label) : EU_BOARD.moveWaitAction}
        </Button>
      </DialogFooter>
    </EditorDialog>
  );
}

function WaitingRow({
  w,
  wardId,
  mayAct,
  freeBeds,
  actions,
  onDone,
}: {
  w: BoardWaiting;
  wardId: string;
  mayAct: boolean;
  freeBeds: BoardBed[];
  actions: BoardActions;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"give" | "remove" | null>(null);
  const [why, setWhy] = useState("");
  const run = (fn: () => Promise<SimpleResult>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else onDone();
    });
  };
  const reason = w.waitReason ? WAIT_REASON_WORDS[w.waitReason] : null;
  return (
    <li className="border-border flex flex-col gap-2 rounded-md border px-2.5 py-2">
      <span className="flex min-w-0 flex-col">
        <Who p={w} />
        <span className="text-caption text-muted-foreground font-normal">
          <span suppressHydrationWarning>Waiting {heldFor(w.decidedAt)}</span>
          {reason ? ` · ${reason}` : ""}
          {w.admittedBy ? ` · admitted by ${w.admittedBy}` : ""}
        </span>
      </span>
      {mayAct ? (
        <div className="flex flex-wrap gap-1.5">
          <Chip on={mode === "give"} onClick={() => setMode(mode === "give" ? null : "give")}>
            Give a bed
          </Chip>
          <Chip on={mode === "remove"} onClick={() => setMode(mode === "remove" ? null : "remove")}>
            Remove from the list…
          </Chip>
        </div>
      ) : null}
      {mode === "give" ? (
        freeBeds.length ? (
          <div
            role="group"
            aria-label={`Free beds for ${w.name ?? w.mrn ?? "this patient"}`}
            className="flex flex-wrap gap-1"
          >
            {freeBeds.map((b) => (
              <button
                key={b.key}
                type="button"
                disabled={pending}
                onClick={() => run(() => actions.allocate(wardId, w.admissionId, b.bedId))}
                className="border-ink-300 bg-card text-foreground hover:bg-ink-50 focus-visible:shadow-focus h-7 rounded-sm border px-2 font-mono text-[12px] outline-none disabled:opacity-45"
                aria-label={`Give bed ${b.label}`}
              >
                {b.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-caption text-ink-600 font-normal">No bed on this ward is free.</p>
        )
      ) : null}
      {mode === "remove" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`end-${w.admissionId}`} className="text-caption text-ink-700">
            Why they no longer need a bed here
          </label>
          <input
            id={`end-${w.admissionId}`}
            className={inputClass}
            value={why}
            maxLength={200}
            placeholder="For example, went home against advice"
            onChange={(e) => setWhy(e.target.value)}
          />
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            disabled={pending || why.trim().length < 3}
            onClick={() =>
              run(() => actions.releaseAdmission(wardId, w.admissionId, why.trim(), "end"))
            }
          >
            End the admission
          </Button>
        </div>
      ) : null}
      {error ? <CautionNote alert>{error}</CautionNote> : null}
    </li>
  );
}
