import type { TriageMetrics } from "@/lib/triage/worklist";

/**
 * Aggregate triage snippet for the hospital admin (kickoff §4).
 * Aggregate + scoped — counts only, no patient-level data. Acuity mix +
 * override/baseline counts today; over/under-triage rate arrives with
 * the outcome dataset (§6/§10). Renders nothing before the first triage.
 */

const TIER = [
  { level: 1 as const, label: "Red", cls: "text-rose-600 dark:text-rose-400" },
  { level: 2 as const, label: "Orange", cls: "text-orange-600 dark:text-orange-400" },
  { level: 3 as const, label: "Yellow", cls: "text-amber-600 dark:text-amber-400" },
  { level: 4 as const, label: "Green", cls: "text-mint-600 dark:text-mint-400" },
  { level: 5 as const, label: "Blue", cls: "text-slate-500 dark:text-slate-400" },
];

export function TriageAcuitySnippet({ metrics }: { metrics: TriageMetrics }) {
  if (metrics.total === 0) return null;

  return (
    <section
      aria-label="Triage acuity today"
      className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">
          Triage today · acuity mix
        </h2>
        <span className="text-muted-foreground text-caption font-mono tabular-nums">
          {metrics.total} triaged
        </span>
      </div>

      <div className="grid grid-cols-5 gap-2">
        {TIER.map((t) => (
          <div key={t.level} className="flex flex-col items-center gap-0.5">
            <span
              className={`font-display text-heading-m leading-none font-medium tabular-nums ${t.cls}`}
            >
              {metrics.byLevel[t.level]}
            </span>
            <span className="text-muted-foreground text-[10px]">
              L{t.level} {t.label}
            </span>
          </div>
        ))}
      </div>

      <p className="text-muted-foreground border-border text-caption border-t pt-2">
        {metrics.overrides} clinician override{metrics.overrides === 1 ? "" : "s"} ·{" "}
        {metrics.baselineAdjustments} baseline adjustment
        {metrics.baselineAdjustments === 1 ? "" : "s"} today. Over/under-triage rate becomes
        measurable once outcomes are captured.
      </p>
    </section>
  );
}
