import type { AllergyLine, SafetyBar } from "@/lib/emr/chart";
import type { ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { RestrictedMark } from "./chips";
import { parts, withoutNameOnly } from "./format";
import { StatusWord } from "./status-word";

/**
 * The safety bar (gate-a E.1, PROMPT §5.1): the EMR's one bold element. Sticky under the shell's
 * top bar, never scrolled away. The patient name is Fraunces; everything else Geist with tabular
 * numerals. It states in words: two identifiers, age and sex; the allergy line (worst first);
 * pregnancy only when the payload has a line; Died as a neutral chip; the top three problems;
 * critical results awaiting acknowledgement (amber — the red lives on the value in Results);
 * a lock and "Restricted". The screen-reader sentence is read first.
 *
 * Deceased: the bar's clinical actions are removed (`actionsAllowed`). On a phone pregnancy and
 * problems fold into Details; allergies and the critical line never fold.
 */
export interface SafetyBarLinks {
  /** The allergy editor (the clerking desk); absent → the line has no action. */
  allergies?: string | null;
  /** Where "+N more" and the critical line's Review go (the chart's own sections). */
  problems?: string;
  results?: string;
}

const ALLERGY_ACTION: Record<AllergyLine["state"], string> = {
  listed: "Edit",
  no_known_drug_allergies: "Re-confirm",
  not_recorded: "Record allergies",
  unable_to_assess: "Update",
};

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-baseline gap-x-3 sm:grid-cols-[6.5rem_1fr]">
      <span className="text-caption text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">{children}</div>
    </div>
  );
}

function Action({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="text-body-s tap inline-flex min-h-11 items-center rounded-sm font-medium text-teal-700 underline-offset-4 hover:underline sm:min-h-0"
    >
      {children}
    </Link>
  );
}

function AllergyValue({ line }: { line: AllergyLine }) {
  if (line.state !== "listed")
    return line.tone === "neutral" ? (
      <span className="text-body-s text-foreground">{line.text}</span>
    ) : (
      <StatusWord tone={line.tone}>{line.text}</StatusWord>
    );
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Allergies, worst first">
      {line.items.map((a) => (
        <li
          key={a.id}
          className="border-border text-body-s text-foreground inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2 py-0.5"
        >
          <span>{withoutNameOnly(a.text)}</span>
          {a.byNameOnly ? <StatusWord tone="caution">by name only</StatusWord> : null}
          {a.restricted ? <RestrictedMark /> : null}
        </li>
      ))}
    </ul>
  );
}

export function SafetyBarView({
  bar,
  links = {},
  headingLevel = "h1",
  className,
}: {
  bar: SafetyBar;
  links?: SafetyBarLinks;
  headingLevel?: "h1" | "h2";
  className?: string;
}) {
  const Heading = headingLevel;
  const act = bar.actionsAllowed;
  const pregnancy = bar.pregnancy ? (
    <Line label="Pregnancy">
      {bar.pregnancy.tone === "neutral" ? (
        <span className="text-body-s text-foreground">{bar.pregnancy.text}</span>
      ) : (
        <StatusWord tone={bar.pregnancy.tone}>{bar.pregnancy.text}</StatusWord>
      )}
      {bar.pregnancy.restricted ? <RestrictedMark /> : null}
    </Line>
  ) : null;
  const problems = (
    <Line label="Active problems">
      {bar.problems.length === 0 ? (
        <span className="text-body-s text-muted-foreground">None recorded</span>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {bar.problems.map((p) => (
            <li
              key={p.id}
              className="border-border text-body-s text-foreground inline-flex items-center gap-2 rounded-md border px-2 py-0.5"
            >
              {p.display}
              {p.restricted ? <RestrictedMark /> : null}
            </li>
          ))}
        </ul>
      )}
      {bar.moreProblems > 0 && links.problems ? (
        <Action href={links.problems}>{`${bar.moreProblems} more`}</Action>
      ) : bar.moreProblems > 0 ? (
        <span className="text-body-s text-muted-foreground">{`${bar.moreProblems} more`}</span>
      ) : null}
    </Line>
  );

  return (
    <section
      aria-labelledby="safety-bar-name"
      aria-describedby="safety-bar-summary"
      data-slot="safety-bar"
      className={cn(
        "bg-background border-border sticky top-13 z-20 border-b print:static",
        className,
      )}
    >
      <p id="safety-bar-summary" className="sr-only">
        {bar.accessibleSummary}
      </p>
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-2 px-4 py-3 md:px-8">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <Heading
            id="safety-bar-name"
            className="font-display text-heading-m text-foreground font-medium"
          >
            {bar.name}
          </Heading>
          <span className="text-body-s text-muted-foreground flex flex-wrap gap-x-3 tabular-nums">
            {parts(bar.ageSex).map((p) => (
              <span key={p}>{p}</span>
            ))}
            <span className="font-mono tracking-[0.02em] tabular-nums">{bar.mrn}</span>
          </span>
          {bar.deceased ? <StatusWord tone="neutral">{bar.deceased.text}</StatusWord> : null}
          {bar.restricted ? <RestrictedMark className="text-body-s sm:ml-auto" /> : null}
        </div>

        <Line label="Allergies">
          <AllergyValue line={bar.allergy} />
          {act && links.allergies ? (
            <Action href={links.allergies}>{ALLERGY_ACTION[bar.allergy.state]}</Action>
          ) : null}
        </Line>

        <div className="hidden flex-col gap-2 sm:flex">
          {pregnancy}
          {problems}
        </div>
        {pregnancy || bar.problems.length > 0 ? (
          <details className="group sm:hidden">
            <summary className="text-body-s tap inline-flex min-h-11 cursor-pointer list-none items-center rounded-sm font-medium text-teal-700">
              Details
            </summary>
            <div className="flex flex-col gap-2 pt-1">
              {pregnancy}
              {problems}
            </div>
          </details>
        ) : null}

        {bar.criticalText ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusWord tone="caution">{bar.criticalText}</StatusWord>
            <span className="text-body-s text-foreground flex flex-wrap gap-x-2">
              {bar.criticalUnacknowledged.map((c) => (
                <span key={c.id} className="inline-flex items-center gap-1">
                  {c.display}
                  {c.restricted ? <RestrictedMark /> : null}
                </span>
              ))}
            </span>
            {act && links.results ? <Action href={links.results}>Review</Action> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
