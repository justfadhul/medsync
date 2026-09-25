import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The one page header for the doctor workspace (W9): an overline naming the
 * place (hospital · department), a Fraunces H1 at weight 500, an optional
 * subline, and a right-hand slot for the page's own controls.
 */
export function PageHeader({
  place,
  title,
  subline,
  right,
  placeInTopBar = false,
}: {
  place: string;
  title: string;
  subline?: ReactNode;
  right?: ReactNode;
  /** The shell's top bar already names the place from `lg` up: say it once. */
  placeInTopBar?: boolean;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <p
          className={cn(
            "text-overline text-muted-foreground truncate uppercase",
            placeInTopBar && "lg:hidden",
          )}
        >
          {place}
        </p>
        <h1 className="font-display text-foreground text-heading-l font-medium">{title}</h1>
        {subline ? <p className="text-body-s text-muted-foreground">{subline}</p> : null}
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </header>
  );
}
