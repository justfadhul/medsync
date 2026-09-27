import type { ReactNode } from "react";

/**
 * Print layout (gate-a E.13, E9): print CSS only, no PDF engine. Black on white; both identifiers
 * in the header and the footer of EVERY page (CSS page-margin boxes, so they repeat) and "Page x
 * of y" from the page counters. On screen it is a preview sheet with its own identifier lines and
 * a screen-only toolbar; in print, everything outside the sheet is removed.
 *
 * The printout never says that anything was withheld: the restricted-items choice lives in the
 * screen-only `toolbar`.
 */

/** A CSS string literal: the name is patient data, so escape it rather than trust it. */
const cssString = (s: string) =>
  `"${s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ")}"`;

export function printCss(identity: string): string {
  const id = cssString(identity);
  return `@media print {
  @page {
    size: A4;
    margin: 18mm 14mm 20mm;
    @top-left { content: ${id}; font-family: sans-serif; font-size: 9pt; color: black; }
    @bottom-left { content: ${id}; font-family: sans-serif; font-size: 9pt; color: black; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font-family: sans-serif; font-size: 9pt; color: black; }
  }
  body *:not(:has([data-print-root])):not([data-print-root]):not([data-print-root] *) { display: none !important; }
  body *:has([data-print-root]) { margin: 0 !important; padding: 0 !important; border: 0 !important; box-shadow: none !important; position: static !important; overflow: visible !important; background: white !important; }
  [data-print-root], [data-print-root] * { color: black !important; background: white !important; box-shadow: none !important; }
  [data-print-root] { max-width: none !important; margin: 0 !important; padding: 0 !important; border: 0 !important; }
  [data-print-running] { display: none !important; }
}`;
}

export interface PrintIdentity {
  name: string;
  mrn: string;
  ageSex: string;
}

export function PrintLayout({
  title,
  hospital,
  patient,
  date,
  toolbar,
  children,
}: {
  title: string;
  hospital: string;
  patient: PrintIdentity;
  /** The document's date line, already formatted. */
  date: string;
  /** Screen-only controls (Print, include restricted items). */
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const identity = `${patient.name} — ${patient.mrn}`;
  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-4 px-4 py-6 md:px-8">
      <style>{printCss(identity)}</style>
      {toolbar ? (
        <div data-print-screen-only className="flex flex-wrap items-start gap-4 print:hidden">
          {toolbar}
        </div>
      ) : null}
      <article
        data-print-root
        className="text-body-s flex flex-col gap-5 rounded-lg border border-gray-200 bg-white p-8 text-black"
      >
        <header className="flex flex-col gap-1 border-b border-gray-300 pb-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6">
            <span className="font-medium">{hospital}</span>
            <h1 className="text-heading-s font-medium">{title}</h1>
          </div>
          <p className="flex flex-wrap gap-x-4">
            <span className="font-medium">{patient.name}</span>
            <span className="font-mono tabular-nums">{patient.mrn}</span>
            {patient.ageSex.split(" · ").map((p) => (
              <span key={p}>{p}</span>
            ))}
            <span>{date}</span>
          </p>
        </header>
        {children}
        {/* The on-screen footer; on paper the page-margin boxes repeat it on every page. */}
        <footer
          data-print-running
          className="flex flex-wrap justify-between gap-x-4 border-t border-gray-300 pt-3"
        >
          <span className="flex flex-wrap gap-x-4">
            <span>{patient.name}</span>
            <span className="font-mono tabular-nums">{patient.mrn}</span>
          </span>
        </footer>
      </article>
    </div>
  );
}

/** A labelled field of a printed form; an empty value leaves a line to write on. */
export function PrintField({ label, children }: { label: string; children?: ReactNode }) {
  const empty = children === undefined || children === null || children === "";
  return (
    <div className="grid break-inside-avoid grid-cols-[10rem_1fr] gap-x-4">
      <span className="text-black/70">{label}</span>
      {empty ? (
        <span className="min-h-6 border-b border-gray-400">
          <span className="sr-only">Blank</span>
        </span>
      ) : (
        <div>{children}</div>
      )}
    </div>
  );
}

/** Restricted items are printed only when the clinician includes them, item by item. */
export function printable<T extends { id: string; restricted: boolean }>(
  items: readonly T[],
  include: ReadonlySet<string>,
): { kept: T[]; withheld: T[] } {
  const kept: T[] = [];
  const withheld: T[] = [];
  for (const i of items) (i.restricted && !include.has(i.id) ? withheld : kept).push(i);
  return { kept, withheld };
}
