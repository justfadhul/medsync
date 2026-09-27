"use client";

import type { Recommendation } from "@/lib/triage/recommend";
import type { AcuityLevel, TriageResult } from "@/lib/triage/types";
import { useMemo, useState } from "react";
import { CheckIcon, PencilIcon, XIcon } from "lucide-react";

import { recommend } from "@/lib/triage/recommend";
import { cn } from "@/lib/utils";

/**
 * Next Steps — the recommendations layer (GATE C). Renders the engine's
 * suggested next actions beside the triage result, each with its
 * rationale + guideline source + an accept / modify / dismiss control.
 *
 * SUGGESTIONS, NOT ORDERS: accepting records intent only — it never
 * auto-executes. Live-seam suggestions (urgent appointment, care-team
 * notify) hand off where a surface exists; everything else is a
 * "pending intent · workflow to follow", recorded not dropped.
 *
 * Recompute on override: the parent passes assignedLevel, so the
 * suggestions follow the clinician's final call. The clinician's
 * decisions are lifted to the parent via onChange for storage with the
 * triage record.
 */

export type RecDecision = "pending" | "accepted" | "modified" | "dismissed";

export interface RecDecisionRecord {
  code: string;
  category: string;
  decision: RecDecision;
  note?: string;
}

const SEAM_BADGE: Record<Recommendation["seam"], { label: string; cls: string }> = {
  live: {
    label: "live",
    cls: "bg-mint-50 text-mint-700 dark:bg-mint-950/30 dark:text-mint-300",
  },
  pending_intent: {
    label: "workflow to follow",
    cls: "bg-muted text-muted-foreground",
  },
};

const CAT_LABEL: Record<string, string> = {
  disposition: "Disposition",
  pathway_flag: "Pathway",
  escalation: "Escalation",
  immediate_measure: "Immediate measure",
  monitoring: "Monitoring",
  investigation: "Investigation",
  onward_routing: "Onward routing",
};

export function NextSteps({
  result,
  assignedLevel,
  onChange,
}: {
  result: TriageResult;
  assignedLevel: AcuityLevel;
  /** Lifts the full decision set to the parent for storage with the record. */
  onChange?: (decisions: RecDecisionRecord[]) => void;
}) {
  // The recommendation set is unchanged (clinical logic); the panel only
  // PINS "obtain missing vitals" to the top when the assessment is
  // incomplete — it's the most important action when data is missing
  // (layout addendum §3). Stable order otherwise.
  const recs = useMemo(() => {
    const list = recommend(result, assignedLevel);
    return [...list].sort((a, b) => {
      const pa = a.code === "measure_complete_vitals" ? 0 : 1;
      const pb = b.code === "measure_complete_vitals" ? 0 : 1;
      return pa - pb;
    });
  }, [result, assignedLevel]);

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-foreground/80 flex items-center gap-1.5 text-[12px] font-medium">
          Next steps
          <span className="text-muted-foreground/70 font-mono text-[10px]">
            suggested actions — not orders
          </span>
        </h3>
        <span className="text-muted-foreground/70 font-mono text-[10px] tracking-wide">
          {recs.length} suggested
        </span>
      </div>

      {recs.length === 0 ? (
        <div className="border-border text-muted-foreground rounded-2xl border border-dashed px-4 py-6 text-center text-[12px]">
          No guideline-mapped suggestions for this finding.
        </div>
      ) : (
        <RecList recs={recs} onChange={onChange} />
      )}

      <p className="text-muted-foreground/70 text-[10.5px] leading-relaxed">
        General, guideline-derived suggestions requiring your judgement — not a treatment plan.
        Accepting records intent; nothing is ordered or auto-executed.
      </p>
    </section>
  );
}

function RecList({
  recs,
  onChange,
}: {
  recs: Recommendation[];
  onChange?: (decisions: RecDecisionRecord[]) => void;
}) {
  // Decisions keyed by suggestion code; default pending.
  const [decisions, setDecisions] = useState<
    Record<string, { decision: RecDecision; note?: string }>
  >({});

  function update(code: string, category: string, decision: RecDecision, note?: string) {
    const next = { ...decisions, [code]: { decision, note } };
    setDecisions(next);
    onChange?.(
      recs.map((r) => ({
        code: r.code,
        category: r.category,
        decision: next[r.code]?.decision ?? "pending",
        note: next[r.code]?.note,
      })),
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {recs.map((r) => (
        <RecCard
          key={r.code}
          rec={r}
          state={decisions[r.code] ?? { decision: "pending" }}
          onDecision={(decision, note) => update(r.code, r.category, decision, note)}
        />
      ))}
    </ul>
  );
}

function RecCard({
  rec,
  state,
  onDecision,
}: {
  rec: Recommendation;
  state: { decision: RecDecision; note?: string };
  onDecision: (decision: RecDecision, note?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(state.note ?? rec.suggestion);
  const decided = state.decision;

  return (
    <li
      className={cn(
        "border-border bg-card rounded-2xl border p-3.5 transition-colors",
        decided === "accepted" && "border-mint-500/40 bg-mint-50/30 dark:bg-mint-950/15",
        decided === "dismissed" && "opacity-55",
        decided === "modified" && "border-amber-400/40 bg-amber-50/30 dark:bg-amber-950/15",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground font-mono text-[9px] tracking-[0.14em] uppercase">
              {CAT_LABEL[rec.category] ?? rec.category}
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[8.5px] font-semibold tracking-wide uppercase",
                SEAM_BADGE[rec.seam].cls,
              )}
            >
              {SEAM_BADGE[rec.seam].label}
            </span>
            {rec.confidence === "needs_cso_input" ? (
              <span className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 font-mono text-[8.5px] font-semibold tracking-wide text-amber-700 uppercase dark:bg-amber-950/30 dark:text-amber-300">
                provisional
              </span>
            ) : null}
          </div>
          {editing ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              autoFocus
              className="border-input bg-background focus-visible:border-ring mt-0.5 rounded-md border p-2 text-[12.5px] outline-none"
            />
          ) : (
            <p className="text-foreground text-[12.5px] leading-snug font-medium">
              {state.note ?? rec.suggestion}
            </p>
          )}
          <p className="text-muted-foreground text-caption leading-relaxed">{rec.rationale}</p>
          <p className="text-muted-foreground/60 text-[10px] leading-relaxed italic">
            {rec.source}
          </p>
        </div>

        {decided !== "pending" && !editing ? (
          <span
            // Re-keyed per decision so the state word pops when it changes.
            key={decided}
            className={cn(
              "scale-in shrink-0 font-mono text-[9.5px] font-semibold tracking-wide uppercase",
              decided === "accepted" && "text-mint-700 dark:text-mint-300",
              decided === "dismissed" && "text-muted-foreground",
              decided === "modified" && "text-amber-700 dark:text-amber-300",
            )}
          >
            {decided}
          </span>
        ) : null}
      </div>

      {/* Controls */}
      <div className="mt-2.5 flex items-center gap-1.5">
        {editing ? (
          <>
            <button
              type="button"
              onClick={() => {
                onDecision("modified", draft.trim() || rec.suggestion);
                setEditing(false);
              }}
              className="tap text-caption inline-flex items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1 font-semibold text-white transition-colors hover:bg-amber-600"
            >
              <CheckIcon className="size-3" aria-hidden />
              Save change
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(state.note ?? rec.suggestion);
                setEditing(false);
              }}
              className="text-muted-foreground hover:text-foreground text-caption px-2 py-1"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <CtlButton
              active={decided === "accepted"}
              onClick={() => onDecision("accepted", state.note)}
              tone="teal"
            >
              <CheckIcon className="size-3" aria-hidden /> Accept
            </CtlButton>
            <CtlButton
              active={decided === "modified"}
              onClick={() => setEditing(true)}
              tone="amber"
            >
              <PencilIcon className="size-3" aria-hidden /> Modify
            </CtlButton>
            <CtlButton
              active={decided === "dismissed"}
              onClick={() => onDecision("dismissed", state.note)}
              tone="muted"
            >
              <XIcon className="size-3" aria-hidden /> Dismiss
            </CtlButton>
          </>
        )}
      </div>
    </li>
  );
}

function CtlButton({
  active,
  onClick,
  tone,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone: "teal" | "amber" | "muted";
  children: React.ReactNode;
}) {
  const toneCls =
    tone === "teal"
      ? "border-mint-500/50 bg-mint-50 text-mint-700 dark:bg-mint-950/30 dark:text-mint-300"
      : tone === "amber"
        ? "border-amber-400/50 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
        : "border-border bg-muted/40 text-muted-foreground";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "tap text-caption inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium transition-colors",
        active
          ? toneCls
          : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40",
      )}
    >
      {children}
    </button>
  );
}
