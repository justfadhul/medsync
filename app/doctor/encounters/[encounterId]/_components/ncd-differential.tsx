"use client";

import type { Urgency } from "@/lib/ncd/catalog/schema";
import type {
  Confidence,
  DifferentialEvidence,
  DifferentialResult,
  RankedCondition,
} from "@/lib/ncd/engine/differential";
import { useState } from "react";
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  MinusCircleIcon,
  PlusCircleIcon,
  SearchIcon,
  ShieldQuestionIcon,
} from "lucide-react";

/**
 * The live differential (ADR 0083).
 *
 * ── What this surface is careful never to say ────────────────────────────────
 * It does not diagnose. Every string here is `suggests`, `consistent with` or
 * `consider`, and the confirmation framing at the foot of the panel is
 * PERSISTENT rather than dismissible — a clinician confirms every conclusion,
 * and a banner that can be closed is one that stops being read.
 *
 * ── Traceability is structural ───────────────────────────────────────────────
 * A ranked row cannot render without the findings that raised it. Expanding a
 * row shows the finding CODES on both sides of the argument — what supported it
 * and what argued against it — because a ranking a clinician cannot audit is one
 * they are being asked to take on trust, which is the opposite of decision
 * support.
 *
 * ── What is deliberately not rendered ────────────────────────────────────────
 * `score`. It is an ordering integer, not a probability, and putting a number
 * beside a condition invites it to be read as a likelihood. The ORDER is the
 * output; the arithmetic behind it stays in the engine.
 *
 * ── Colour ───────────────────────────────────────────────────────────────────
 * Red is reserved for `immediate` urgency, which is a genuine emergency. Every
 * colour is paired with a word, so none of it is load-bearing alone.
 *
 * Runs entirely on-device from catalog data. No model call, ever.
 */

const OVERLINE = "font-mono text-[10px] tracking-[0.16em] uppercase text-muted-foreground/80";
const CARD = "border-border bg-card rounded-lg border shadow-xs";

/* ── vocabulary ──────────────────────────────────────────────────────────── */

/** By WHEN. Distinct from severity, which is how loud — see ADR 0083. */
const URGENCY_WORD: Record<Urgency, string> = {
  immediate: "Now",
  urgent: "Within hours",
  same_day: "Same day",
  routine: "Routine",
};

const URGENCY_CLS: Record<Urgency, string> = {
  immediate:
    "bg-red-100 text-red-800 ring-red-500/30 dark:bg-red-950/50 dark:text-red-200 dark:ring-red-400/30",
  urgent:
    "bg-orange-100 text-orange-900 ring-orange-500/30 dark:bg-orange-950/45 dark:text-orange-200",
  same_day:
    "bg-amber-100 text-amber-900 ring-amber-500/30 dark:bg-amber-950/40 dark:text-amber-100",
  routine: "bg-muted text-muted-foreground ring-border",
};

const CONFIDENCE_WORD: Record<Confidence, string> = {
  high: "Well supported",
  moderate: "Partly supported",
  low: "Too little recorded",
};

const CONFIDENCE_CLS: Record<Confidence, string> = {
  high: "bg-brand-50 text-brand-800 ring-brand-500/30 dark:bg-brand-950/40 dark:text-brand-200",
  moderate: "bg-amber-50 text-amber-900 ring-amber-400/40 dark:bg-amber-950/30 dark:text-amber-100",
  low: "bg-muted text-muted-foreground ring-border",
};

/**
 * How hard a finding argues, in words. The tiers are never rendered as numbers:
 * a clinician reads "strongly", not "4".
 */
const STRENGTH_WORD = {
  weak: "weakly",
  moderate: "moderately",
  strong: "strongly",
  pathognomonic: "decisively",
} as const;

function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium ring-1 ring-inset ${URGENCY_CLS[urgency]}`}
    >
      {urgency === "immediate" ? <AlertTriangleIcon className="size-3" aria-hidden /> : null}
      {URGENCY_WORD[urgency]}
    </span>
  );
}

/* ── one line of evidence ────────────────────────────────────────────────── */

function EvidenceRow({ e }: { e: DifferentialEvidence }) {
  const supports = e.direction === "supports";
  return (
    <li className="flex items-start gap-2 py-1.5">
      {supports ? (
        <PlusCircleIcon
          className="text-brand-600 dark:text-brand-400 mt-0.5 size-3.5 shrink-0"
          aria-hidden
        />
      ) : (
        <MinusCircleIcon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-[12px] leading-snug font-medium">
          {e.display}
          {e.viaAbsence ? (
            <span className="text-muted-foreground font-normal"> — recorded as absent</span>
          ) : null}
          <span className="text-muted-foreground font-normal">
            {" "}
            {supports ? "supports" : "argues against"} this {STRENGTH_WORD[e.strength]}
          </span>
        </p>
        <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">{e.rationale}</p>
        <p className="text-muted-foreground/70 mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[10px]">
          {/* The traceability anchor: the exact code the ranking read. */}
          <span>{e.feature}</span>
          {e.lrPositive != null ? <span>LR+ {e.lrPositive}</span> : null}
          {e.lrNegative != null ? <span>LR− {e.lrNegative}</span> : null}
          <span className="truncate">{e.citation.standard}</span>
        </p>
      </div>
    </li>
  );
}

/* ── one ranked condition ────────────────────────────────────────────────── */

function ConditionRow({
  c,
  open,
  onToggle,
}: {
  c: RankedCondition;
  open: boolean;
  onToggle: () => void;
}) {
  const emergency = c.urgency === "immediate";
  return (
    <li
      className={`overflow-hidden rounded-lg border ${
        emergency
          ? "border-red-500/40 bg-red-50/60 dark:bg-red-950/20"
          : "border-border/70 bg-background/40"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        /* 44px min target: this is used one-handed at a bedside. */
        className="hover:bg-muted/50 ease-expo-out flex min-h-11 w-full items-center gap-2 px-2.5 py-2 text-left transition-colors duration-100"
      >
        <span className="text-muted-foreground w-4 shrink-0 font-mono text-[11px] tabular-nums">
          {c.rank}
        </span>
        <span className="text-foreground min-w-0 flex-1 text-[12.5px] font-medium">
          {c.display}
        </span>
        {c.posterior === "high" ? (
          <span className="text-muted-foreground shrink-0 text-[10.5px]">consistent with</span>
        ) : null}
        <UrgencyBadge urgency={c.urgency} />
        <ChevronRightIcon
          className={`text-muted-foreground ease-expo-out size-3.5 shrink-0 transition-transform duration-150 ${
            open ? "rotate-90" : ""
          }`}
          aria-hidden
        />
      </button>

      {open ? (
        <div className="border-border/60 border-t px-2.5 py-2">
          {c.firedRules.length > 0 ? (
            <div className="mb-2">
              <p className={OVERLINE}>Why</p>
              {c.firedRules.map((r) => (
                <div key={r.id} className="mt-1">
                  <p className="text-foreground text-[12px] leading-snug font-medium">
                    {r.display}
                  </p>
                  {r.notes ? (
                    <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-900 ring-1 ring-amber-300/40 ring-inset dark:bg-amber-950/25 dark:text-amber-100">
                      {r.notes}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {c.supporting.length > 0 ? (
            <>
              <p className={OVERLINE}>Findings that support this</p>
              <ul className="divide-border/40 divide-y">
                {c.supporting.map((e) => (
                  <EvidenceRow key={`${e.feature}-s`} e={e} />
                ))}
              </ul>
            </>
          ) : null}

          {c.refuting.length > 0 ? (
            <>
              <p className={`${OVERLINE} mt-2`}>Findings that argue against it</p>
              <ul className="divide-border/40 divide-y">
                {c.refuting.map((e) => (
                  <EvidenceRow key={`${e.feature}-r`} e={e} />
                ))}
              </ul>
            </>
          ) : null}

          {c.confirmWith.length > 0 ? (
            <div className="mt-2">
              <p className={OVERLINE}>Confirm with</p>
              <ul className="mt-1 flex flex-wrap gap-1">
                {c.confirmWith.map((t) => (
                  /* The clinician's words, with the catalog code kept as the
                     audit anchor rather than as the label. */
                  <li
                    key={t.code}
                    title={t.code}
                    className="bg-muted/70 text-foreground/85 rounded px-1.5 py-0.5 text-[11px]"
                  >
                    {t.display}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {c.mimicsToExclude.length > 0 ? (
            <div className="mt-2">
              <p className={OVERLINE}>Exclude first</p>
              {/* One per line. Several of these are full sentences, and joining
                  them into a single run of text is how a safety list stops
                  being read. */}
              <ul className="mt-1 space-y-0.5">
                {c.mimicsToExclude.map((m) => (
                  <li
                    key={m}
                    className="text-foreground/85 flex gap-1.5 text-[11.5px] leading-snug"
                  >
                    <span aria-hidden className="text-muted-foreground select-none">
                      &middot;
                    </span>
                    <span className="min-w-0 flex-1">{m}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/* ── the panel ───────────────────────────────────────────────────────────── */

export function NcdDifferential({ result }: { result: DifferentialResult }) {
  const [open, setOpen] = useState<string | null>(null);

  /*
   * Red flags pin ABOVE the ranking and are not part of it. A rule demanding
   * something happen now is not a row to scroll past, and it cannot be
   * dismissed — there is deliberately no close control.
   */
  const pinned = result.conditions.filter((c) => c.urgency === "immediate");

  if (result.conditions.length === 0) {
    return (
      <section className={`${CARD} p-3`}>
        <p className={OVERLINE}>Differential</p>
        <p className="text-muted-foreground mt-2 flex items-start gap-2 text-[12px] leading-snug">
          <CircleDashedIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Nothing recorded yet that separates one condition from another. Record the examination and
          this will fill in.
        </p>
      </section>
    );
  }

  return (
    <section className={`${CARD} overflow-hidden`}>
      {pinned.length > 0 ? (
        <div className="border-b border-red-500/30 bg-red-50 px-3 py-2.5 dark:bg-red-950/30">
          <p className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] text-red-800 uppercase dark:text-red-200">
            <AlertTriangleIcon className="size-3" aria-hidden />
            Act now
          </p>
          {pinned.map((c) => (
            <div key={c.code} className="mt-1.5">
              <p className="text-[12.5px] leading-snug font-medium text-red-900 dark:text-red-100">
                {c.display}
              </p>
              {c.confirmWith.length > 0 ? (
                <p className="mt-0.5 text-[10.5px] text-red-800/85 dark:text-red-200/80">
                  {c.confirmWith.map((t) => t.display).join(" · ")}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="border-border/60 flex items-center gap-2 border-b px-3 py-2">
        <p className={OVERLINE}>Consider</p>
        <span
          className={`ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium ring-1 ring-inset ${CONFIDENCE_CLS[result.confidence]}`}
        >
          {CONFIDENCE_WORD[result.confidence]}
        </span>
        <span className="text-muted-foreground font-mono text-[10px] tabular-nums">
          {result.answered.recorded}/{result.answered.applicable}
        </span>
      </div>

      <p className="text-muted-foreground border-border/60 border-b px-3 py-1.5 text-[11px] leading-snug">
        {result.confidenceReason}
      </p>

      <ul className="space-y-1.5 p-2">
        {result.conditions.map((c) => (
          <ConditionRow
            key={c.code}
            c={c}
            open={open === c.code}
            onToggle={() => setOpen(open === c.code ? null : c.code)}
          />
        ))}
      </ul>

      {result.checkNext.length > 0 ? (
        <div className="border-border/60 bg-muted/30 border-t px-3 py-2">
          <p className={`${OVERLINE} flex items-center gap-1.5`}>
            <SearchIcon className="size-3" aria-hidden />
            What to check next
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {result.checkNext.map((n) => (
              <li key={n.feature}>
                <p className="text-foreground text-[12px] leading-snug font-medium">{n.display}</p>
                <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">{n.because}</p>
                {n.elicitation ? (
                  <p className="text-muted-foreground/80 mt-0.5 text-[11px] leading-snug italic">
                    {n.elicitation}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/*
       * Persistent, and deliberately not dismissible. This is decision support:
       * a human confirms every conclusion, and a banner that can be closed is one
       * that stops being read after the second encounter.
       */}
      <p className="text-muted-foreground border-border/60 flex items-start gap-1.5 border-t px-3 py-2 text-[10.5px] leading-snug">
        <ShieldQuestionIcon className="mt-px size-3 shrink-0" aria-hidden />
        Suggestions only, from what has been recorded. Not a diagnosis — confirm every conclusion
        clinically.
      </p>
    </section>
  );
}
