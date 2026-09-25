import {
  CheckIcon,
  ClockIcon,
  LockIcon,
  MessageSquareIcon,
  PauseIcon,
  PlusIcon,
  ShieldIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * MedSync — My Health (patient surfaces, floating-card composition).
 *
 * The patient view of the care loop, shown on /styleguide. Public, so it
 * carries no names, drug names, doses or clock times — neutral labels
 * only (landing v4 clinical-safety rule).
 *
 * Renders as a vertical stack of floating cards. Earlier iteration framed
 * the cards inside a phone bezel — dropped because the bezel made the
 * patient surfaces feel grafted on rather than belonging.
 *
 * Static composition. No interactivity, no client JS, single
 * motion-safe pulse on the "due now" med icon (Lighthouse-perf-safe).
 *
 * Tone rules (addendum §C): encouraging never shaming, calm never
 * alarming, no diagnosis, no overpromised privacy. Adherence text is
 * "X days on track" — not "X% compliant"; the held medication is
 * shown as a care-team decision, not a patient failure.
 */

export type MyHealthFragment =
  | "full"
  | "log-reading"
  | "today-meds"
  | "report-concern"
  | "sms-offline";

interface MyHealthMockProps {
  /** Default `full` shows every card. Fragment variants render only one
   * card for embedding in narrower contexts (e.g. inline in §07 scenes
   * or the new patient chapter sub-points). */
  fragment?: MyHealthFragment;
  /** When true (default `full` only), shows the "Patient view"
   * header label above the cards. Set false to drop the header when the
   * embedding context already labels the surface. */
  withHeader?: boolean;
  className?: string;
}

export function MyHealthMock({ fragment = "full", withHeader, className }: MyHealthMockProps) {
  const showHeader = withHeader ?? fragment === "full";
  return (
    <div className={cn("mx-auto flex w-full max-w-[320px] flex-col gap-3", className)}>
      {showHeader ? <PatientHeader /> : null}
      {fragment === "full" || fragment === "log-reading" ? <LogReadingCard /> : null}
      {fragment === "full" || fragment === "today-meds" ? <TodayMedsCard /> : null}
      {fragment === "full" ? <AdherenceStrip /> : null}
      {fragment === "full" || fragment === "sms-offline" ? <SmsReminderChip /> : null}
      {fragment === "full" || fragment === "report-concern" ? <ReportConcernCard /> : null}
      {fragment === "full" || fragment === "report-concern" ? <ReassuranceLine /> : null}
    </div>
  );
}

/* Individual card primitives — exposed so the new §07b PatientChapter
   can compose custom card combinations per sub-point without forcing
   new fragment enum values into MyHealthMock. Additive export, no
   behaviour change. */
export {
  LogReadingCard as MyHealthLogReadingCard,
  TodayMedsCard as MyHealthTodayMedsCard,
  AdherenceStrip as MyHealthAdherenceStrip,
  SmsReminderChip as MyHealthSmsReminderChip,
  ReportConcernCard as MyHealthReportConcernCard,
  ReassuranceLine as MyHealthReassuranceLine,
};

/* ─── Patient view header (replaces the old phone-bezel + status bar) ── */

function PatientHeader() {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex flex-col">
        <span className="text-muted-foreground font-mono text-[9.5px] tracking-[0.18em] uppercase">
          Patient view
        </span>
        <span className="font-display text-foreground text-[14px] leading-tight font-medium">
          Good morning.
        </span>
      </div>
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5",
          "border-brand-300 bg-brand-50 text-brand-800 border font-mono text-[8.5px] tracking-[0.15em] uppercase",
          "dark:border-brand-700 dark:bg-brand-50/10 dark:text-brand-200",
        )}
      >
        <span className="bg-brand-500 size-1 rounded-full" />
        Illustrative
      </span>
    </div>
  );
}

/* ─── Log a reading ───────────────────────────────────────────────────── */

function LogReadingCard() {
  return (
    <div className="border-border bg-card flex flex-col gap-3.5 rounded-xl border p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.18em] uppercase">
          Fasting glucose
        </span>
        <span className="text-muted-foreground tabular font-mono text-[10px]">mmol/L</span>
      </div>

      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col">
          <span className="font-display text-foreground tabular text-[34px] leading-none font-medium">
            11.6
          </span>
          <span className="text-muted-foreground mt-1.5 text-[10.5px]">Yesterday</span>
        </div>
        <ReadingSparkline />
      </div>

      <button
        type="button"
        tabIndex={-1}
        className={cn(
          "inline-flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-[12px] font-medium",
          "border-border bg-background text-foreground hover:border-brand-300 hover:bg-brand-50/40 border",
          "dark:hover:bg-brand-50/[0.04]",
          "transition-colors duration-150",
        )}
      >
        <PlusIcon className="text-brand-600 dark:text-brand-400 size-3.5" strokeWidth={1.75} />
        Log this morning&rsquo;s reading
      </button>
    </div>
  );
}

function ReadingSparkline() {
  const values = [6.1, 7.4, 8.0, 9.3, 11.6];
  const min = 4;
  const max = 14;
  const width = 80;
  const height = 28;
  const step = width / (values.length - 1);
  const pts = values
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / (max - min)) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${width} ${height + 2}`}
      className="text-foreground/70 h-7 w-20"
      role="img"
      aria-label="Glucose trend, last 5 readings, climbing."
    >
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={width}
        cy={height - ((11.6 - min) / (max - min)) * height}
        r={2.5}
        className="fill-brand-500"
      />
    </svg>
  );
}

/* ─── Today's medications ──────────────────────────────────────────────── */

function TodayMedsCard() {
  const meds = [
    { name: "Morning medicine", note: "taken", state: "taken" as const },
    { name: "Midday medicine", note: "due now", state: "due" as const },
    { name: "Evening medicine", note: "due this evening", state: "due" as const },
    {
      name: "One medicine paused by your care team",
      note: "held by your care team",
      state: "held" as const,
    },
  ];
  return (
    <div className="border-border bg-card flex flex-col gap-2 rounded-xl border p-3 shadow-sm">
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground font-mono text-[9.5px] tracking-[0.16em] uppercase">
          Today&rsquo;s medications
        </span>
        <span className="text-muted-foreground tabular font-mono text-[9.5px]">1 / 4</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {meds.map((med) => (
          <li
            key={med.name}
            className={cn(
              "border-border bg-muted/30 flex items-start gap-2 rounded-md border p-2",
              med.state === "due" &&
                "border-brand-300 bg-brand-50/40 dark:border-brand-700 dark:bg-brand-50/[0.04]",
              med.state === "held" && "border-status-caution-bg",
            )}
          >
            <MedStateIcon state={med.state} />
            <div className="flex flex-1 flex-col gap-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-foreground text-[11.5px] leading-tight font-medium">
                  {med.name}
                </span>
              </div>
              <span className="text-muted-foreground text-[10px] leading-tight">
                {med.state === "taken" ? (
                  <span>{med.note}</span>
                ) : med.state === "held" ? (
                  <span className="text-status-caution-fg">{med.note}</span>
                ) : (
                  <span className="text-brand-700 dark:text-brand-300">{med.note}</span>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground/80 text-[10px] italic">Tap a card to confirm a dose.</p>
    </div>
  );
}

function MedStateIcon({ state }: { state: "taken" | "due" | "held" }) {
  const cls = "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full";
  if (state === "taken") {
    return (
      <span className={cn(cls, "bg-status-stable-bg text-status-stable-fg")} aria-hidden>
        <CheckIcon className="size-2.5" strokeWidth={2.5} />
      </span>
    );
  }
  if (state === "due") {
    return (
      <span
        className={cn(cls, "bg-brand-100 text-brand-800 dark:bg-brand-50/15 dark:text-brand-200")}
        aria-hidden
      >
        <ClockIcon
          className="size-2.5 motion-safe:animate-pulse motion-reduce:animate-none"
          strokeWidth={2}
        />
      </span>
    );
  }
  return (
    <span className={cn(cls, "bg-status-caution-bg text-status-caution-fg")} aria-hidden>
      <PauseIcon className="size-2.5" strokeWidth={2.5} />
    </span>
  );
}

/* ─── Adherence streak ────────────────────────────────────────────────── */

function AdherenceStrip() {
  const days: Array<{ label: string; state: "done" | "today" | "future" }> = [
    { label: "T", state: "done" },
    { label: "F", state: "done" },
    { label: "S", state: "done" },
    { label: "S", state: "done" },
    { label: "M", state: "done" },
    { label: "T", state: "today" },
    { label: "W", state: "future" },
  ];
  return (
    <div className="border-border bg-card flex flex-col gap-2 rounded-xl border p-3 shadow-sm">
      <div className="flex items-baseline justify-between">
        <span className="text-foreground text-[12px] font-medium">5 days on track</span>
        <span className="text-muted-foreground text-[10.5px]">Keep going.</span>
      </div>
      <div className="flex items-center justify-between">
        {days.map((d, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <span
              aria-hidden
              className={cn(
                "inline-flex size-3.5 items-center justify-center rounded-full text-[8px]",
                d.state === "done" && "bg-brand-500 text-white",
                d.state === "today" && "bg-background text-foreground ring-brand-500 ring-2",
                d.state === "future" && "bg-muted text-muted-foreground",
              )}
            >
              {d.state === "done" ? "✓" : null}
            </span>
            <span className="text-muted-foreground font-mono text-[8.5px] tracking-wide">
              {d.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── SMS reminder chip ───────────────────────────────────────────────── */

function SmsReminderChip() {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl px-3 py-2.5",
        "border-border bg-card border shadow-sm",
      )}
    >
      <span className="bg-plum-50 text-plum-700 inline-flex size-7 items-center justify-center rounded-full">
        <MessageSquareIcon className="size-3.5" strokeWidth={1.75} />
      </span>
      <div className="flex flex-1 flex-col">
        <span className="text-foreground text-[11.5px] leading-tight">
          We&rsquo;ll text you a reminder too.
        </span>
        <span className="text-muted-foreground text-[10px] leading-tight">
          Reply <span className="font-mono">1</span> to confirm &middot; works on basic phones.
        </span>
      </div>
    </div>
  );
}

/* ─── Report a concern ────────────────────────────────────────────────── */

function ReportConcernCard() {
  return (
    <button
      type="button"
      tabIndex={-1}
      className={cn(
        "border-border bg-card flex w-full items-start gap-2.5 rounded-xl border p-3 text-left shadow-sm",
        "hover:border-brand-300 transition-colors duration-150",
      )}
    >
      <span className="bg-plum-50 text-plum-700 inline-flex size-7 shrink-0 items-center justify-center rounded-md">
        <ShieldIcon className="size-3.5" strokeWidth={1.75} />
      </span>
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-foreground text-[12.5px] leading-tight font-medium">
          Something feels off?
        </span>
        <span className="text-muted-foreground text-[10.5px] leading-tight">
          Tell your care team &mdash; they&rsquo;ll review and reply.
        </span>
      </div>
    </button>
  );
}

/* ─── Reassurance line (privacy + who reviews) ────────────────────────── */

function ReassuranceLine() {
  return (
    <div className="flex items-center justify-between gap-2 px-1 pt-1">
      <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[10px]">
        <LockIcon className="size-2.5" strokeWidth={1.75} />
        Your care team can see this.
      </span>
      <span className="text-muted-foreground tabular font-mono text-[9.5px]">Your care team</span>
    </div>
  );
}
