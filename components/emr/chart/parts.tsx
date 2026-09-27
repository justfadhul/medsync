import type { Provenance } from "../provenance";
import type { EnteredInErrorItem } from "@/lib/emr/chart";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { RestrictedMark } from "../chips";
import { formatters, parts } from "../format";

/** Small pieces every chart section shares. Pure. */

export function SectionHeading({
  id,
  children,
  right,
}: {
  id?: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 id={id} tabIndex={-1} className="text-heading-s text-foreground font-medium outline-none">
        {children}
      </h2>
      {right}
    </div>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-body-s text-muted-foreground font-medium">{children}</h3>;
}

/** An instant in the hospital's zone, 24-hour, mono. */
export function Time({ iso, children }: { iso: string; children: ReactNode }) {
  return (
    <time dateTime={iso} className="text-muted-foreground text-body-s font-mono tabular-nums">
      {children}
    </time>
  );
}

/** "12 Mar 2026 · OPD" as separate spans. */
export function Parts({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("inline-flex flex-wrap gap-x-3", className)}>
      {parts(text).map((p, i) => (
        <span key={`${i}:${p}`}>{p}</span>
      ))}
    </span>
  );
}

/** A section's voided entries (Law 4): withdrawn, never vanished. Struck through, the reason in
 *  words, newest first; nothing when there are none. */
export function EnteredInErrorList({
  items,
  timeZone,
}: {
  items: readonly EnteredInErrorItem[];
  timeZone?: string;
}) {
  if (items.length === 0) return null;
  const fmt = formatters(timeZone);
  return (
    <section className="flex flex-col gap-2">
      <SubHeading>Entered in error</SubHeading>
      <ul className="flex flex-col">
        {items.map((i) => (
          <li
            key={i.id}
            className="border-border/60 text-body-s flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b py-2 last:border-0"
          >
            <Time iso={i.at}>{fmt.dateTime(i.at)}</Time>
            <s className="text-muted-foreground decoration-1">
              <span className="sr-only">Entered in error: </span>
              {i.title}
            </s>
            <span className="text-muted-foreground">{`Reason: ${i.reason}`}</span>
            {i.restricted ? <RestrictedMark /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The laboratory's own flag, always as text; short on screen, the full words for a screen reader. */
const FLAG_SHORT: Record<string, string> = {
  "Lab flag: low": "L (lab)",
  "Lab flag: high": "H (lab)",
  "Lab flag: critical (low)": "LL (lab)",
  "Lab flag: critical (high)": "HH (lab)",
  "Lab flag: normal": "N (lab)",
  "Lab flag: abnormal": "A (lab)",
  "Low (laboratory range)": "L (lab range)",
  "High (laboratory range)": "H (lab range)",
  "Within laboratory range": "In lab range",
};
export function LabFlag({ text }: { text: string | null }) {
  if (!text) return null;
  const short = FLAG_SHORT[text];
  if (!short) return <span className="text-caption text-muted-foreground">{text}</span>;
  return (
    <span className="text-caption text-muted-foreground whitespace-nowrap">
      <span aria-hidden>{short}</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}

/** Where the chart's direct actions go. Each is optional: a surface passes what it has. */
export interface ChartLinks {
  /** The allergy editor (on the clerking desk). */
  allergies?: string | null;
  /** Order a test. */
  order?: string | null;
  /** The open encounter's clerking desk. */
  desk?: string | null;
}

/** What every section view needs beside its slice of the payload. */
export interface ChartContext {
  patient: { name: string; mrn: string };
  provenance: Readonly<Record<string, Provenance>>;
  timeZone?: string;
  links: ChartLinks;
}
