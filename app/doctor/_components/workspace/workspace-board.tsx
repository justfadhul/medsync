"use client";

import type { ArrestBannerItem } from "./arrest-banner";
import type { PanelSection } from "./board-context";
import type { PatientFlowRow } from "@/lib/workspace/flow";
import type { LaneId } from "@/lib/workspace/lanes";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { ChevronRightIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";

import { AMBER_CHIP } from "@/app/nurse/resus/[episodeId]/_components/v2/close-out-words";
import { openBlankResus } from "@/app/nurse/resus/actions";
import { cn } from "@/lib/utils";
import { arrivals, countChanges } from "@/lib/workspace/changes";
import { laneFromParam, LANES } from "@/lib/workspace/lanes";
import { PageHeader } from "../page-header";
import { ArrestBanner } from "./arrest-banner";
import { BoardContext } from "./board-context";
import { when } from "./clock";
import { patientTitle } from "./patient-line";
import { PatientPanel } from "./patient-panel";
import { hrefOf, PRIMARY_BUTTON, SECONDARY_BUTTON, useRunAction } from "./row-actions";
import { useWorkspaceLive } from "./use-workspace-live";
import { WorkspaceRow } from "./workspace-row";

const PanelSheet = dynamic(() => import("./panel-sheet"), { ssr: false });
const KeyboardHelp = dynamic(() => import("./keyboard-help"), { ssr: false });

export interface ResusExtras {
  ended: { episodeId: string; title: string; word: string; endedAtIso: string | null }[];
  openable: { triageRecordId: string; title: string; reason: string; triagedAtIso: string }[];
}

export interface WorkspaceBoardProps {
  rows: PatientFlowRow[];
  visibleLaneIds: LaneId[];
  scope: "mine" | "department";
  /** Unassigned and the Department scope are for whoever may assign (D8). */
  mayAssign: boolean;
  hospitalId: string;
  place: string;
  serverNowIso: string;
  arrests: ArrestBannerItem[];
  resus: ResusExtras;
}

const WIDE = "(min-width: 1280px)";

function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(WIDE);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

const matches = (r: PatientFlowRow, q: string) =>
  [r.identity.name, r.identity.code, r.identity.unknownLabel].some((v) =>
    v?.toLowerCase().includes(q),
  );

/**
 * The doctor workspace (prompt §4–§5): one list, each patient once, in the
 * lane that says what happens next. Lane, scope and the open patient live in
 * the URL — lane and patient change with history.pushState (no refetch, back
 * and forward work), scope re-reads the server. While the pointer or focus is
 * in the list, new server data is held behind "N updates · Show" so rows never
 * move under a hand (E3).
 */
export function WorkspaceBoard(props: WorkspaceBoardProps) {
  const {
    rows,
    visibleLaneIds,
    scope,
    mayAssign,
    hospitalId,
    place,
    serverNowIso,
    arrests,
    resus,
  } = props;
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const lane = laneFromParam(params.get("lane"));
  const patientKey = params.get("patient");
  const wide = useWide();
  const live = useWorkspaceLive(hospitalId);

  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [section, setSection] = useState<PanelSection | null>(null);
  const [help, setHelp] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // The narrow-screen sheet loads on first use and stays mounted, so closing still animates.
  const [sheetUsed, setSheetUsed] = useState(false);
  if (!wide && patientKey && !sheetUsed) setSheetUsed(true);

  // E3: held updates. `frozen` is what the doctor is looking at while their
  // hand is on the list; an own action follows its answer through.
  const [frozen, setFrozen] = useState<PatientFlowRow[] | null>(null);
  const [following, setFollowing] = useState(false);
  const [seen, setSeen] = useState(rows);
  const [news, setNews] = useState("");
  if (rows !== seen) {
    setSeen(rows);
    setNews(
      arrivals(seen, rows)
        .map(
          (r) =>
            `${patientTitle(r.identity)} ${r.lane === "resus" ? "moved to Resus" : "is waiting for you"}.`,
        )
        .join(" "),
    );
    if (following) {
      setFollowing(false);
      if (frozen) setFrozen(rows);
    }
  }
  const shown = frozen ?? rows;
  const held = frozen ? countChanges(frozen, rows) : 0;
  const pointerIn = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    window.history.pushState(null, "", qs ? `${pathname}?${qs}` : pathname);
  };
  const openPanel = (key: string, s?: PanelSection) => {
    setSection(s ?? null);
    setActiveKey(key);
    setParams({ patient: key });
  };
  const closePanel = () => {
    setSection(null);
    setParams({ patient: null });
  };

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      shown.filter(
        (r) =>
          visibleLaneIds.includes(r.lane) &&
          (q ? matches(r, q) : lane === "all" || r.lane === lane),
      ),
    [shown, visibleLaneIds, q, lane],
  );
  const counts = useMemo(() => {
    const c = Object.fromEntries(LANES.map((l) => [l.id, 0])) as Record<LaneId, number>;
    for (const r of shown) c[r.lane]++;
    return c;
  }, [shown]);
  const lanes = LANES.filter((l) => visibleLaneIds.includes(l.id));
  const arrestNow = arrests.length > 0;
  const selected = shown.find((r) => r.key === patientKey) ?? null;
  const active =
    activeKey && visible.some((r) => r.key === activeKey) ? activeKey : (visible[0]?.key ?? null);
  const next = shown.find(
    (r) =>
      r.lane === "waiting" && (r.primary?.kind === "start" || r.primary?.kind === "open_resus"),
  );

  const focusRow = (key: string) => {
    setActiveKey(key);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-row="${CSS.escape(key)}"] [data-row-body]`)
        ?.focus(),
    );
  };

  // Below 1280 px the panel is a sheet: fetch its code while the doctor reads the list.
  useEffect(() => {
    if (wide) return;
    const id = setTimeout(() => void import("./panel-sheet"), 1500);
    return () => clearTimeout(id);
  }, [wide]);

  // Keyboard (§5.5): off inside text fields and while a sheet or menu is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const index = visible.findIndex((r) => r.key === active);
      const row = visible[index];
      const lanesByKey = Object.fromEntries(lanes.map((l) => [l.hotkey, l.id]));
      if (e.key === "j" || e.key === "ArrowDown" || e.key === "k" || e.key === "ArrowUp") {
        const step = e.key === "j" || e.key === "ArrowDown" ? 1 : -1;
        const to = visible[Math.min(visible.length - 1, Math.max(0, index + step))];
        if (to) {
          e.preventDefault();
          focusRow(to.key);
        }
      } else if (e.key === "Enter" && row) {
        // On a button or link Enter is that control's own; only a bare page opens the patient.
        if (target?.closest("button, a")) return;
        openPanel(row.key);
      } else if (e.key === "s" && row) {
        document
          .querySelector<HTMLElement>(`[data-row="${CSS.escape(row.key)}"] [data-primary]`)
          ?.click();
      } else if (e.key === "t" && row) {
        const t = [row.primary, ...row.overflow].find(
          (a) => a?.kind === "triage" || a?.kind === "retriage",
        );
        const href = t ? hrefOf(t) : null;
        if (href) router.push(href);
      } else if (
        e.key === "a" &&
        row &&
        [row.primary, ...row.overflow].some((x) => x?.kind === "assign" || x?.kind === "take")
      ) {
        openPanel(row.key, "assign");
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "?") {
        setHelp(true);
      } else if (e.key === "0") {
        setParams({ lane: null });
      } else if (lanesByKey[e.key]) {
        setParams({ lane: lanesByKey[e.key]! });
      } else if (e.key === "Escape" && patientKey) {
        closePanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const api = {
    openPanel,
    report: setMessage,
    follow: () => setFollowing(true),
    serverNowIso,
  };

  const hold = () => setFrozen((f) => f ?? rows);
  const release = () => setFrozen(null);

  const groups = lanes
    .map((l) => ({ lane: l, rows: visible.filter((r) => r.lane === l.id) }))
    .filter((g) => (q || lane === "all" ? g.rows.length > 0 : g.lane.id === lane));

  return (
    <BoardContext.Provider value={api}>
      <div
        className={cn(
          "mx-auto flex w-full max-w-[1440px] gap-6 px-4 py-6 sm:px-6 lg:py-8",
          next && "max-md:pb-28",
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <PageHeader
            place={place}
            title="Workspace"
            placeInTopBar
            subline={live ? "Live" : "Updates every 15 s"}
            right={
              <>
                {mayAssign ? (
                  <ScopeSwitch scope={scope} params={params} pathname={pathname} />
                ) : null}
                <label className="border-input bg-card focus-within:shadow-focus relative flex min-h-11 w-full items-center gap-2 rounded-md border px-2.5 focus-within:border-teal-500 sm:w-72">
                  <SearchIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
                  <span className="sr-only">Find patient by MRN or name</span>
                  <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    placeholder="Find patient — MRN or name"
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && visible[0]) {
                        openPanel(visible[0].key);
                        focusRow(visible[0].key);
                      } else if (e.key === "Escape") {
                        setQuery("");
                        e.currentTarget.blur();
                      }
                    }}
                    className="text-body-s text-foreground min-w-0 flex-1 bg-transparent outline-none placeholder:text-gray-400"
                  />
                  <kbd className="text-caption text-muted-foreground hidden font-mono lg:inline">
                    ⌘K
                  </kbd>
                </label>
              </>
            }
          />

          <ArrestBanner arrests={arrests} serverNowIso={serverNowIso} />

          <nav
            aria-label="Lanes"
            className="-mx-4 [scrollbar-width:none] overflow-x-auto px-4 sm:mx-0 sm:px-0"
          >
            <div role="tablist" aria-label="Lanes" className="flex gap-1 sm:flex-wrap">
              <LaneChip
                label="All"
                count={shown.filter((r) => visibleLaneIds.includes(r.lane)).length}
                selected={lane === "all"}
                onSelect={() => setParams({ lane: null })}
              />
              {lanes.map((l) => (
                <LaneChip
                  key={l.id}
                  label={l.short}
                  count={counts[l.id]}
                  selected={lane === l.id}
                  alarm={l.id === "resus" && arrestNow}
                  onSelect={() => setParams({ lane: l.id })}
                />
              ))}
            </div>
          </nav>

          {message ? (
            <p
              role="alert"
              className={cn(
                "text-body-s flex items-start justify-between gap-3 rounded-md px-3 py-2",
                AMBER_CHIP,
              )}
            >
              <span>{message}</span>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setMessage(null)}
                className="tap -m-1 rounded-sm p-1"
              >
                <XIcon aria-hidden className="size-4" />
              </button>
            </p>
          ) : null}

          <div
            ref={listRef}
            id="lane-panel"
            role="tabpanel"
            aria-label={
              lane === "all" ? "All lanes" : (lanes.find((l) => l.id === lane)?.label ?? "Lane")
            }
            onPointerEnter={() => {
              pointerIn.current = true;
              hold();
            }}
            onPointerLeave={() => {
              pointerIn.current = false;
              if (!listRef.current?.contains(document.activeElement)) release();
            }}
            onFocusCapture={hold}
            onBlurCapture={(e) => {
              if (!pointerIn.current && !e.currentTarget.contains(e.relatedTarget as Node | null))
                release();
            }}
            className="relative flex flex-col gap-7"
          >
            {held > 0 ? (
              <div className="sticky top-16 z-10 -mb-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => setFrozen(rows)}
                  className="tap text-caption bg-foreground text-background animate-in fade-in-0 rounded-full px-3 py-1.5 font-medium shadow-md duration-150 motion-reduce:animate-none"
                >
                  {held} {held === 1 ? "update" : "updates"} · Show
                </button>
              </div>
            ) : null}

            {groups.length === 0 ? (
              <EmptyBoard
                query={q}
                lane={lane === "all" ? null : (lanes.find((l) => l.id === lane)?.empty ?? null)}
              />
            ) : (
              groups.map(({ lane: l, rows: laneRows }) => {
                const list = (
                  <ul className="flex flex-col gap-2">
                    {laneRows.map((r) => (
                      <WorkspaceRow
                        key={r.key}
                        row={r}
                        selected={r.key === patientKey}
                        active={r.key === active}
                        serverNowIso={serverNowIso}
                        onSelect={(key) => openPanel(key)}
                        onActivate={setActiveKey}
                      />
                    ))}
                  </ul>
                );
                const heading = (
                  <>
                    {l.label}
                    <span className="text-caption text-muted-foreground font-mono tabular-nums">
                      {laneRows.length}
                    </span>
                    {l.id === "resus" && arrestNow ? (
                      <span className="size-2 self-center rounded-full bg-rose-600">
                        <span className="sr-only">Cardiac arrest in progress</span>
                      </span>
                    ) : null}
                  </>
                );
                if (l.collapsed && lane === "all" && !q) {
                  return (
                    <details key={l.id} className="group flex flex-col gap-2">
                      <summary className="text-heading-s text-foreground flex cursor-default list-none items-baseline gap-2 [&::-webkit-details-marker]:hidden">
                        <ChevronRightIcon
                          aria-hidden
                          className="text-muted-foreground size-4 self-center transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
                        />
                        {heading}
                      </summary>
                      <div className="mt-2">{list}</div>
                    </details>
                  );
                }
                return (
                  <section
                    key={l.id}
                    aria-labelledby={`lane-${l.id}`}
                    className="flex flex-col gap-2"
                  >
                    <h2
                      id={`lane-${l.id}`}
                      className="text-heading-s text-foreground flex items-baseline gap-2"
                    >
                      {heading}
                    </h2>
                    {laneRows.length ? (
                      list
                    ) : (
                      <p className="text-body-s text-muted-foreground border-border rounded-lg border border-dashed px-4 py-3">
                        {l.empty}
                      </p>
                    )}
                    {l.id === "resus" && lane === "resus" ? (
                      <ResusMore resus={resus} rows={shown} serverNowIso={serverNowIso} />
                    ) : null}
                  </section>
                );
              })
            )}
          </div>
        </div>

        {wide ? (
          <aside
            aria-label="Patient"
            className="border-border bg-card sticky top-[76px] hidden h-[calc(100svh-96px)] w-90 shrink-0 overflow-y-auto rounded-lg border p-5 xl:block"
          >
            {selected ? (
              <PatientPanel row={selected} section={section} />
            ) : patientKey ? (
              <GonePatient onClose={closePanel} />
            ) : (
              <div className="text-body-s text-muted-foreground flex flex-col gap-3">
                <p>Choose a patient to see their day, what is still open, and the next step.</p>
                <p className="text-caption">
                  <kbd className="font-mono">j</kbd> / <kbd className="font-mono">k</kbd> to move ·{" "}
                  <kbd className="font-mono">Enter</kbd> to open ·{" "}
                  <kbd className="font-mono">?</kbd> for every key
                </p>
              </div>
            )}
          </aside>
        ) : sheetUsed ? (
          <PanelSheet
            open={patientKey !== null}
            row={selected}
            section={section}
            onClose={closePanel}
          />
        ) : null}
      </div>

      {next ? <StartNextBar row={next} /> : null}

      {help ? <KeyboardHelp onClose={() => setHelp(false)} /> : null}
      <p className="sr-only" role="status" aria-live="polite">
        {news}
      </p>
    </BoardContext.Provider>
  );
}

function LaneChip({
  label,
  count,
  selected,
  alarm,
  onSelect,
}: {
  label: string;
  count: number;
  selected: boolean;
  alarm?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls="lane-panel"
      aria-label={`${label}, ${count}${alarm ? ", cardiac arrest in progress" : ""}`}
      onClick={onSelect}
      className={cn(
        "tap text-body-s inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-2.5 outline-none sm:min-h-9",
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-border text-foreground hover:bg-muted",
      )}
    >
      {alarm ? <span aria-hidden className="size-2 rounded-full bg-rose-600" /> : null}
      {label}
      <span
        className={cn(
          "font-mono text-[12px] tabular-nums",
          selected ? "text-background/70" : "text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function ScopeSwitch({
  scope,
  params,
  pathname,
}: {
  scope: "mine" | "department";
  params: URLSearchParams;
  pathname: string;
}) {
  const href = (s: "mine" | "department") => {
    const next = new URLSearchParams(params.toString());
    next.delete("patient");
    if (s === "mine") next.delete("scope");
    else next.set("scope", s);
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  return (
    <div
      role="group"
      aria-label="Scope"
      className="border-border inline-flex min-h-11 rounded-md border p-0.5"
    >
      {(["mine", "department"] as const).map((s) => (
        <Link
          key={s}
          href={href(s)}
          scroll={false}
          aria-current={scope === s ? "page" : undefined}
          className={cn(
            "tap text-body-s inline-flex items-center rounded-sm px-3 font-medium outline-none",
            scope === s
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {s === "mine" ? "Mine" : "Department"}
        </Link>
      ))}
    </div>
  );
}

function EmptyBoard({ query, lane }: { query: string; lane: string | null }) {
  return (
    <p className="text-body-s text-muted-foreground border-border rounded-lg border border-dashed px-4 py-6 text-center">
      {query
        ? `No patient on the board matches “${query}”.`
        : (lane ?? "Nothing needs you right now. New patients appear here as they arrive.")}
    </p>
  );
}

function GonePatient({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-body-s text-muted-foreground">
        This patient is no longer on your board — their visit moved on or was closed.
      </p>
      <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
        Close
      </button>
    </div>
  );
}

/** The resus v2 board's own extras, in the Resus lane: an ad-hoc resus, Red/L1 without one, recently ended. */
function ResusMore({
  resus,
  rows,
  serverNowIso,
}: {
  resus: ResusExtras;
  rows: PatientFlowRow[];
  serverNowIso: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const onBoard = new Set(
    rows.flatMap((r) => [r.primary?.triageRecordId, ...r.overflow.map((a) => a.triageRecordId)]),
  );
  const openable = resus.openable.filter((o) => !onBoard.has(o.triageRecordId));
  const nowMs = Date.parse(serverNowIso);
  return (
    <div className="mt-2 flex flex-col gap-4">
      <div>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await openBlankResus("/doctor/resus");
              if (r?.error) setError(r.error);
            })
          }
          className={SECONDARY_BUTTON}
        >
          <PlusIcon aria-hidden className="size-4" />
          Start ad-hoc resus
        </button>
        {error ? (
          <p role="alert" className={cn("text-body-s mt-2 rounded-md px-3 py-2", AMBER_CHIP)}>
            {error}
          </p>
        ) : null}
      </div>
      {openable.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-body-s text-foreground font-medium">
            Red / L1 in other queues · 24 h
          </h3>
          <ul className="flex flex-col gap-1.5">
            {openable.map((o) => (
              <li key={o.triageRecordId} className="text-body-s text-muted-foreground">
                <span className="text-foreground">{o.title}</span> · {o.reason} · triaged{" "}
                {when(Date.parse(o.triagedAtIso), nowMs)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {resus.ended.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-body-s text-foreground font-medium">Recently ended · 24 h</h3>
          <ul className="flex flex-col gap-1.5">
            {resus.ended.map((e) => (
              <li key={e.episodeId}>
                <Link
                  href={`/doctor/resus/${e.episodeId}`}
                  className="text-body-s text-foreground hover:underline"
                >
                  {e.title}
                </Link>
                <span className="text-body-s text-muted-foreground">
                  {" "}
                  ·{" "}
                  <span className="text-caption bg-muted text-foreground rounded-sm px-1.5 py-0.5">
                    {e.word}
                  </span>
                  {e.endedAtIso ? ` · ended ${when(Date.parse(e.endedAtIso), nowMs)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Phones: the top waiting patient, one tap away (§5.3). */
function StartNextBar({ row }: { row: PatientFlowRow }) {
  const { run, pending, dialog } = useRunAction(row);
  const a = row.primary!;
  const level = row.acuity.level ? ` · L${row.acuity.level}` : "";
  return (
    <div className="bg-background/95 border-border fixed inset-x-0 bottom-0 z-20 border-t px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] supports-backdrop-filter:backdrop-blur-sm md:hidden">
      <button
        type="button"
        disabled={pending}
        onClick={() => run(a)}
        className={cn(PRIMARY_BUTTON, "w-full")}
      >
        {a.kind === "open_resus" ? "Open resus" : "Start next"}: {patientTitle(row.identity)}
        {level}
      </button>
      {dialog}
    </div>
  );
}
