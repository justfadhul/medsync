import type { MouseEvent, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A section index (gate-a E.2): a `<nav>` of anchors, the current one marked with `aria-current`
 * and plum — a fill and a dot, never a left bar (plum = place, ADR 0097). Switching is instant:
 * a section switch is a keyboard-reachable navigation, and navigation never animates here.
 * `badge` carries a count or a marker with its words (never colour alone).
 */
export interface IndexItem {
  id: string;
  label: string;
  href: string;
  badge?: ReactNode;
}

export function SectionIndexView({
  label,
  items,
  current,
  onSelect,
  className,
}: {
  label: string;
  items: readonly IndexItem[];
  current: string;
  onSelect?: (id: string, e: MouseEvent<HTMLAnchorElement>) => void;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex flex-col gap-0.5">
        {items.map((it) => {
          const on = it.id === current;
          return (
            <li key={it.id}>
              <a
                href={it.href}
                aria-current={on ? "page" : undefined}
                onClick={onSelect ? (e) => onSelect(it.id, e) : undefined}
                className={cn(
                  "text-body-s focus-visible:shadow-focus flex min-h-11 items-center gap-2 rounded-md px-3 outline-none md:min-h-9",
                  on
                    ? "bg-plum-50 text-plum-800 font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    on ? "bg-plum-500" : "bg-transparent",
                  )}
                />
                <span className="flex-1">{it.label}</span>
                {it.badge}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** A neutral count with its words for a screen reader ("2 open orders"). */
export function CountBadge({ count, words }: { count: number; words: string }) {
  if (count === 0) return null;
  return (
    <span className="text-caption inline-flex min-w-5 items-center justify-center rounded-full bg-gray-100 px-1.5 font-mono text-gray-700 tabular-nums">
      <span aria-hidden>{count}</span>
      <span className="sr-only">{words}</span>
    </span>
  );
}
