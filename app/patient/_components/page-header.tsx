import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface PatientPageHeaderProps {
  /**
   * The mono uppercase overline — "MedSync · Tracking". This component is the
   * only sanctioned home for that treatment at page level; section headings
   * inside a page are real `h2`s at `text-heading-s`. Only home goes without
   * one: its greeting sits under the wordmark, and "MedSync · Your space"
   * said the wordmark twice.
   */
  eyebrow?: string;
  title: string;
  /** A sentence; home's names its hospital as a link, hence a node. */
  description?: ReactNode;
  backHref?: string;
  backLabel?: string;
  /** At most one control, right-aligned beside the title. */
  action?: ReactNode;
  className?: string;
}

/**
 * The one page header for the patient workspace. It replaces the eyebrow +
 * `font-display` h1 + muted sub-line that was hand-rolled in seven files at
 * five different h1 sizes — this is where that size is decided once.
 */
export function PatientPageHeader({
  eyebrow,
  title,
  description,
  backHref,
  backLabel = "Back",
  action,
  className,
}: PatientPageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-1.5", className)}>
      {backHref ? (
        // Negative margins keep the 44px touch target from opening a visual
        // gap the design doesn't ask for.
        <Link
          href={backHref}
          className="text-muted-foreground hover:text-foreground text-body-s duration-fast ease-expo-out -mx-1 -mt-2 -mb-1 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-md px-1 transition-colors"
        >
          <ArrowLeftIcon className="size-3.5" aria-hidden />
          {backLabel}
        </Link>
      ) : null}

      {eyebrow ? (
        <span className="text-muted-foreground text-caption inline-flex items-center gap-1.5 font-mono tracking-[0.16em] uppercase">
          <span
            aria-hidden
            data-place
            className="bg-sky-icon ring-sky-edge size-1 rounded-full ring-2"
          />
          {eyebrow}
        </span>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <h1 className="font-display text-display-s text-foreground text-balance">{title}</h1>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>

      {description ? (
        <p className="text-muted-foreground text-body-s max-w-[60ch] leading-relaxed text-pretty">
          {description}
        </p>
      ) : null}
    </header>
  );
}
