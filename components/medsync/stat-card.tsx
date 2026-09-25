import type { ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface StatProps {
  label: string;
  value: number | string;
  hint: string;
  icon: ReactNode;
}

/**
 * One number with its basis and an icon tile — the strip a console opens
 * with. `tinted` marks the one card a desk reads first. The hint is the
 * denominator or the window: a number without its basis is a claim.
 */
export function StatCard({ tinted = false, ...stat }: StatProps & { tinted?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border px-4 py-3 shadow-xs",
        tinted ? "bg-plum-50 border-plum-200" : "bg-card border-border",
      )}
    >
      <StatBody {...stat} tinted={tinted} />
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
      className="bg-card border-border tap hover:border-brand-300 flex min-h-11 items-center gap-3 rounded-xl border px-4 py-3 text-left shadow-xs"
    >
      <StatBody {...stat} tinted={false} />
      <ChevronRightIcon className="text-muted-foreground -ml-1 size-4 shrink-0" aria-hidden />
    </button>
  );
}

function StatBody({ label, value, hint, icon, tinted }: StatProps & { tinted: boolean }) {
  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-muted-foreground text-caption truncate">{label}</span>
        <span className="text-foreground font-mono text-[22px] leading-7 font-medium tabular-nums">
          {value}
        </span>
        <span className="text-muted-foreground text-caption truncate">{hint}</span>
      </div>
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg",
          tinted ? "bg-card text-plum-700" : "bg-muted text-plum-700",
        )}
      >
        {icon}
      </span>
    </>
  );
}
