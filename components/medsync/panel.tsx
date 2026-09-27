import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A dashboard panel: a title row with the count beside it and the one action
 * at the far end, then the body. The count is a small mono disc on `ink-100` —
 * a number read at a glance, never a coloured badge. Panels crop their own content (a
 * table scrolls under its sticky header) so the page never grows with the
 * data.
 */
export function Panel({
  title,
  count,
  action,
  children,
  className,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "border-border bg-card flex min-h-0 flex-col overflow-hidden rounded-lg border shadow-xs",
        className,
      )}
    >
      <header className="flex min-h-12 items-center gap-2.5 px-4">
        <h2 className="text-foreground text-heading-s">{title}</h2>
        {count !== undefined ? <CountDisc n={count} /> : null}
        {action ? <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div> : null}
      </header>
      <div className="border-border flex min-h-0 flex-1 flex-col border-t">{children}</div>
    </section>
  );
}

export function CountDisc({ n }: { n: number }) {
  return (
    <span className="bg-ink-100 text-ink-700 inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 font-mono text-[11px] font-medium tabular-nums">
      {n}
    </span>
  );
}

/** A section title with the rule running out to its action — the reference's "Accommodation ———— [Add]". */
export function SectionRule({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <h2 className="text-foreground text-heading-s">{title}</h2>
      <div className="bg-border h-px flex-1" aria-hidden />
      {action}
    </div>
  );
}
