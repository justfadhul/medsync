import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface Attribute {
  label: string;
  /** A 14px Lucide glyph for the attribute's type. */
  icon: ReactNode;
  /** Empty → "Add a value" in `ink-400`. */
  value?: ReactNode;
  /** IDs and timestamps: mono. */
  mono?: boolean;
}

/**
 * A record's fields as two columns (MedSync Chroma): an icon and label on the
 * left in `caption` `muted-foreground`, the value on the right at `body-s`,
 * rows at least 34px, hover `ink-50`.
 */
export function AttributeList({
  items,
  className,
}: {
  items: ReadonlyArray<Attribute>;
  className?: string;
}) {
  return (
    <dl className={cn("grid grid-cols-[minmax(120px,160px)_1fr] gap-x-3", className)}>
      {items.map((a) => (
        <div key={a.label} className="contents">
          <dt className="text-muted-foreground text-caption [&_svg]:text-ink-500 flex min-h-[34px] items-center gap-2 [&_svg]:size-3.5">
            {a.icon}
            {a.label}
          </dt>
          <dd
            className={cn(
              "text-body-s hover:bg-ink-50 -mx-2 flex min-h-[34px] flex-wrap items-center gap-1.5 rounded-sm px-2",
              a.mono && "text-ink-600 font-mono text-[12px] tracking-[0.02em] tabular-nums",
              a.value == null && "text-ink-400",
            )}
          >
            {a.value ?? "Add a value"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
