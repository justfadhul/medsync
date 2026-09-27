import type { HTMLAttributes, ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface VitalStatProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: string | number;
  unit?: string;
  /**
   * `normal` (default): primary text colour.
   * `critical`: out of range — 700 in the AA critical text with an arrow,
   *   and the label must name it ("SpO₂ · low"). Never colour alone.
   * `success`: stable green for an explicitly confirmed normal result
   *   (pair with a word, never colour alone).
   */
  tone?: "normal" | "critical" | "success";
  /** Which way an out-of-range value is out (draws the arrow). */
  direction?: "high" | "low";
  /** Optional trailing context (time taken, source). */
  meta?: string;
}

const valueTone: Record<Required<VitalStatProps>["tone"], string> = {
  normal: "text-foreground",
  critical: "text-status-critical-fg-aa font-bold",
  success: "text-status-stable-fg",
};

/**
 * One cell of a VitalStrip (MedSync Chroma): overline label, a 22px mono
 * value, a smaller unit, the time taken. No tinted cell, no flashing, no
 * place hue on vitals.
 */
export function VitalStat({
  label,
  value,
  unit,
  tone = "normal",
  direction,
  meta,
  className,
  ...props
}: VitalStatProps) {
  return (
    <div
      data-slot="vital-stat"
      data-tone={tone}
      className={cn("flex flex-col gap-1", className)}
      {...props}
    >
      <span className="text-overline text-muted-foreground uppercase">{label}</span>
      <span
        className={cn(
          "text-vital inline-flex items-baseline gap-1 font-mono tabular-nums",
          valueTone[tone],
        )}
      >
        {tone === "critical" && direction ? (
          direction === "high" ? (
            <ArrowUpIcon aria-hidden className="size-3.5 self-center stroke-[2.25]" />
          ) : (
            <ArrowDownIcon aria-hidden className="size-3.5 self-center stroke-[2.25]" />
          )
        ) : null}
        {value}
        {unit ? (
          <small className="text-muted-foreground font-sans text-[11px] font-normal">{unit}</small>
        ) : null}
      </span>
      {meta ? <span className="text-muted-foreground font-mono text-[11px]">{meta}</span> : null}
    </div>
  );
}

/** The bordered strip of vitals: cells split by `ink-150` rules. */
export function VitalStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-slot="vital-strip"
      className={cn(
        "bg-card border-border grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] overflow-hidden rounded-lg border",
        "[&>*]:border-ink-150 [&>*]:border-r [&>*]:px-3.5 [&>*]:py-3 [&>*:last-child]:border-r-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
