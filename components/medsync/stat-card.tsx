import type { Domain } from "@/lib/design/domains";
import type { ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";

import { DOMAIN_HUE, HUE } from "@/lib/design/domains";
import { cn } from "@/lib/utils";
import { DomainTile } from "./domain-tile";

interface StatProps {
  label: string;
  value: number | string;
  /** The denominator or the window: a number without its basis is a claim. */
  hint: string;
  icon: ReactNode;
  /** The domain the count belongs to: colours the tile and the bar. */
  domain?: Domain;
  /**
   * A real proportion (0–1) drawn as a thin bar in the domain's solid colour.
   * Only when the basis is known — never a decorative bar, and never red,
   * amber or green to judge the number.
   */
  share?: number;
}

/**
 * One count with its basis, a domain tile and an optional proportion bar —
 * the strip a console opens with (MedSync Chroma, ADR 0162).
 */
export function StatCard(stat: StatProps) {
  return (
    <div className="bg-card border-border flex min-w-0 flex-col gap-2.5 rounded-lg border px-4 py-3.5 shadow-xs">
      <StatBody {...stat} />
    </div>
  );
}

/**
 * The same card as a control: the number opens the list behind it. A chevron
 * says so, `tap` gives the press, and it is a real <button> so a client
 * dialog can be its trigger while the strip stays a Server Component.
 */
export function StatButton({
  onClick,
  expanded = false,
  ...stat
}: StatProps & { onClick: () => void; expanded?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      className="bg-card border-border tap hover:bg-ink-25 flex min-h-11 min-w-0 flex-col gap-2.5 rounded-lg border px-4 py-3.5 text-left shadow-xs"
    >
      <StatBody {...stat} chevron />
    </button>
  );
}

function StatBody({
  label,
  value,
  hint,
  icon,
  domain,
  share,
  chevron,
}: StatProps & { chevron?: boolean }) {
  return (
    <>
      <span className="text-ink-600 text-caption flex min-w-0 items-center gap-2">
        {domain ? (
          <DomainTile domain={domain} icon={icon} size="sm" />
        ) : (
          <span
            aria-hidden
            className="bg-ink-100 text-ink-600 grid size-5 shrink-0 place-items-center rounded-sm [&_svg]:size-3"
          >
            {icon}
          </span>
        )}
        <span className="truncate">{label}</span>
        {chevron ? (
          <ChevronRightIcon className="text-muted-foreground ml-auto size-4 shrink-0" aria-hidden />
        ) : null}
      </span>
      <span className="text-foreground text-stat font-mono tabular-nums">{value}</span>
      {share !== undefined ? (
        <span aria-hidden className="bg-ink-100 flex h-1.5 overflow-hidden rounded-full">
          <i
            className={cn("block h-full", HUE[domain ? DOMAIN_HUE[domain] : "slate"].bar)}
            style={{ width: `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%` }}
          />
        </span>
      ) : null}
      <span className="text-muted-foreground text-caption truncate font-normal">{hint}</span>
    </>
  );
}
