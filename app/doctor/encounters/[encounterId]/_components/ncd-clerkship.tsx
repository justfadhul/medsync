"use client";

import type { PulledVitals } from "./ncd-capture";
import type { AgeBand, NcdCatalog, SiteProfile } from "@/lib/ncd/catalog/schema";
import type { CaptureMap } from "@/lib/ncd/engine/evaluate";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  LoaderIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { buildProfile } from "@/lib/ncd/profile";
import { NcdCapture, NcdSectionRail, sectionProgress } from "./ncd-capture";
import { NcdProfileView } from "./ncd-profile";

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "failed"; error?: string };

/**
 * What happened to the last autosave, said plainly.
 *
 * A save that silently failed is worse than one that never ran: the clinician
 * believes their work is safe and closes the laptop. So a failure is stated, in
 * words, with the one thing that fixes it — and it stays on screen until a save
 * succeeds rather than fading like a toast.
 */
function SaveStatus({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state.kind === "idle") return null;
  if (state.kind === "saving") {
    return (
      <p className="text-muted-foreground text-caption mt-2 inline-flex items-center gap-1.5 px-2.5">
        <LoaderIcon className="size-3 animate-spin" aria-hidden />
        Saving…
      </p>
    );
  }
  if (state.kind === "saved") {
    return (
      <p className="text-muted-foreground text-caption mt-2 inline-flex items-center gap-1.5 px-2.5">
        <CheckIcon className="size-3 text-emerald-600 dark:text-emerald-400" aria-hidden />
        Draft saved{" "}
        <span className="font-mono tabular-nums">
          {new Date(state.at).toTimeString().slice(0, 5)}
        </span>
      </p>
    );
  }
  return (
    <div
      role="status"
      className="text-caption mt-2 flex flex-col gap-1 rounded-lg border border-amber-400/50 bg-amber-50 px-2.5 py-2 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <span className="inline-flex items-center gap-1.5 font-medium">
        <TriangleAlertIcon className="size-3 shrink-0" aria-hidden />
        Not saved
      </span>
      <span className="text-amber-800/90 dark:text-amber-300/90">
        {state.error ?? "The draft did not save."} Nothing is lost — it is still on this screen.
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="tap text-caption inline-flex w-fit items-center gap-1 rounded px-1.5 py-0.5 font-medium underline underline-offset-2"
      >
        <RotateCcwIcon className="size-3" aria-hidden />
        Try again
      </button>
    </div>
  );
}

/**
 * The NCD clerkship workspace.
 *
 * ── Why this is a bounded workspace and not a page ───────────────────────────
 * Seventy features stacked in one column is a long scroll, and a long scroll is
 * where a clinician loses their place mid-encounter — and worse, where the live
 * profile disappears off the top exactly when their answer has just changed it.
 *
 * So: three panes, each scrolling independently, none of them moving the page.
 * The rail keeps the whole protocol visible, the middle holds one section at a
 * time, and the profile never leaves the screen. The feedback loop between
 * answering something and seeing it land is the thing the old clerkship never
 * had; it only works if both halves are visible at once.
 *
 * Below `lg` this degrades to the honest stack — rail as a scrollable chip row,
 * then the section, then the profile — because side-by-side is a lie on a phone.
 */
export function NcdClerkship({
  catalog,
  site,
  initialValues,
  established,
  onChange,
  onSave,
  siteOptions,
  pulled,
  ageBand,
}: {
  catalog: NcdCatalog;
  site: SiteProfile;
  initialValues?: CaptureMap;
  /** The patient already carries the diagnosis — skips re-adjudication. */
  established?: boolean;
  onChange?: (values: CaptureMap) => void;
  /**
   * Persist the working draft. Called when the clinician LEAVES a section —
   * see `leave` below for why that moment and not every keystroke.
   */
  onSave?: (values: CaptureMap) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Preview only. In production the site's capability profile comes from the
   * hospital's configuration — it is a property of the building, not a choice
   * the clinician makes at the bedside.
   */
  siteOptions?: SiteProfile[];
  /** Vitals already on the record, offered to whichever section holds them. */
  pulled?: PulledVitals;
  /**
   * The patient's life stage, from their date of birth. Absent leaves every
   * finding and rule in scope — a missing band is harmless, a guessed one
   * silently narrows the examination.
   */
  ageBand?: AgeBand;
}) {
  const [values, setValues] = useState<CaptureMap>(initialValues ?? {});
  const [activeSite, setActiveSite] = useState<SiteProfile>(site);
  const [activeId, setActiveId] = useState<string>(
    () => [...catalog.sections].sort((a, b) => a.order - b.order)[0]?.id ?? "",
  );

  const profile = useMemo(
    () => buildProfile({ catalog, values, site: activeSite, established, ageBand }),
    [catalog, values, activeSite, established, ageBand],
  );
  const progress = useMemo(
    () => sectionProgress(catalog, activeSite, values),
    [catalog, activeSite, values],
  );

  const index = progress.findIndex((s) => s.id === activeId);
  const prev = index > 0 ? progress[index - 1] : undefined;
  const next = index >= 0 && index < progress.length - 1 ? progress[index + 1] : undefined;

  const update = (v: CaptureMap) => {
    setValues(v);
    onChange?.(v);
  };

  /**
   * Autosave on LEAVING a section, which is the moment the clinician has
   * finished a thought — not on every keystroke, which would put a write behind
   * every digit of a glucose, and not on a timer, which fires mid-sentence.
   *
   * Navigation does NOT wait for the round trip. Blocking a tab change on the
   * network would make the form feel broken on a slow link, and nothing is at
   * risk by moving on: the values live in this component either way. What the
   * clinician is owed is the TRUTH about whether the save landed, which the
   * status line beside the rail gives them, with a retry when it did not.
   *
   * Clicking through three tabs quickly fires three saves. Last write wins at
   * the database (the draft is a per-author upsert), and a sequence number keeps
   * a slow earlier response from overwriting a newer verdict on screen.
   */
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const seq = useRef(0);

  const persist = useCallback(
    async (v: CaptureMap) => {
      if (!onSave) return;
      const mine = ++seq.current;
      setSave({ kind: "saving" });
      try {
        const r = await onSave(v);
        if (mine !== seq.current) return; // a newer save has already answered
        setSave(r.ok ? { kind: "saved", at: Date.now() } : { kind: "failed", error: r.error });
      } catch {
        if (mine !== seq.current) return;
        setSave({ kind: "failed", error: "Could not reach the server." });
      }
    },
    [onSave],
  );

  /** Move to another section, saving what was just done on the way out. */
  const leave = (id: string) => {
    if (id === activeId) return;
    setActiveId(id);
    void persist(values);
  };

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex items-center gap-1.5">
          <ActivityIcon className="text-brand-600 dark:text-brand-400 size-4" aria-hidden />
          <h2 className="text-foreground text-body-l leading-tight font-medium tracking-[-0.012em]">
            {catalog.display}
          </h2>
        </span>
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.08em]">
          v{catalog.version}
        </span>

        {siteOptions?.length ? (
          <span className="ml-auto flex items-center gap-2">
            <span className="text-muted-foreground text-[10px] font-medium tracking-[0.1em] uppercase">
              Site
            </span>
            <span className="border-border inline-flex overflow-hidden rounded-md border">
              {siteOptions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={s.id === activeSite.id}
                  onClick={() => setActiveSite(s)}
                  className={`ease-expo-out px-2.5 py-1 text-[11.5px] font-medium transition-colors duration-100 active:scale-[0.97] ${
                    s.id === activeSite.id
                      ? "bg-brand-600 text-white"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {s.display}
                </button>
              ))}
            </span>
          </span>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-3 lg:h-[calc(100svh-9rem)] lg:max-h-[52rem] lg:min-h-[32rem] lg:grid-cols-[13rem_minmax(0,1fr)_24rem]">
        {/* Rail — the whole protocol, so one-at-a-time never means hidden. */}
        <div className="border-border bg-card overflow-x-auto rounded-lg border p-1.5 shadow-xs lg:overflow-x-hidden lg:overflow-y-auto">
          <NcdSectionRail progress={progress} activeId={activeId} onPick={leave} />
          {onSave ? <SaveStatus state={save} onRetry={() => void persist(values)} /> : null}
        </div>

        {/* One section, plus its own step controls. */}
        <div className="flex min-h-0 flex-col gap-2">
          <div className="min-h-0 flex-1 lg:overflow-y-auto lg:pr-1">
            <NcdCapture
              catalog={catalog}
              site={activeSite}
              values={values}
              onChange={update}
              pulled={pulled}
              sectionId={activeId}
              ageBand={ageBand}
            />
          </div>

          {/* Stepping is navigation, done many times per encounter — no motion. */}
          <div className="flex shrink-0 items-center gap-2">
            <StepButton dir="prev" label={prev?.display} onClick={() => prev && leave(prev.id)} />
            <span className="text-muted-foreground mx-auto font-mono text-[10px] tabular-nums">
              {index + 1} / {progress.length}
            </span>
            <StepButton dir="next" label={next?.display} onClick={() => next && leave(next.id)} />
          </div>
        </div>

        {/* Profile — never leaves the screen. */}
        <div className="min-h-0 lg:overflow-y-auto lg:pr-1">
          <NcdProfileView profile={profile} />
        </div>
      </div>
    </div>
  );
}

function StepButton({
  dir,
  label,
  onClick,
}: {
  dir: "prev" | "next";
  label?: string;
  onClick: () => void;
}) {
  const disabled = !label;
  const Icon = dir === "prev" ? ArrowLeftIcon : ArrowRightIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`border-border ease-expo-out inline-flex max-w-[45%] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors duration-100 ${
        disabled
          ? "text-muted-foreground/40 cursor-default"
          : "text-foreground/85 hover:bg-muted active:scale-[0.97]"
      }`}
    >
      {dir === "prev" ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
      <span className="truncate">{label ?? (dir === "prev" ? "Start" : "End")}</span>
      {dir === "next" ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
    </button>
  );
}
