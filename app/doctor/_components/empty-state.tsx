import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Quiet empty-state for the doctor workspace — a hand-drawn clipboard
 * with a flatlined-then-blipping trace, plus one honest sentence.
 * Pure presentation; callers own the (unchanged) copy.
 */
export function DoctorEmptyState({
  title,
  body,
  className,
}: {
  title: string;
  body: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-border bg-card/40 flex flex-col items-center gap-4 rounded-lg border border-dashed px-6 py-10 text-center",
        className,
      )}
    >
      <EmptyClipboardGlyph />
      <div className="flex flex-col gap-1">
        <span className="text-foreground/80 text-[14px] font-medium">{title}</span>
        <p className="text-muted-foreground mx-auto max-w-[52ch] text-[12px] leading-relaxed">
          {body}
        </p>
      </div>
    </div>
  );
}

function EmptyClipboardGlyph() {
  return (
    <svg
      viewBox="0 0 120 76"
      fill="none"
      aria-hidden
      className="text-muted-foreground/35 h-16 w-auto"
    >
      {/* clipboard body */}
      <rect x="32" y="10" width="56" height="58" rx="7" stroke="currentColor" strokeWidth="1.5" />
      {/* clip */}
      <rect
        x="49"
        y="5"
        width="22"
        height="10"
        rx="3.5"
        className="fill-background"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {/* resting trace — one small beat, mostly baseline */}
      <path
        d="M40 44 H52 L56 36 L61 52 L65 41 L67 44 H80"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* teal blip — the single clinical accent */}
      <circle cx="80" cy="44" r="2.5" fill="#14b8a6" fillOpacity="0.8" />
      {/* faint chart lines */}
      <path
        d="M40 56 H72"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeOpacity="0.5"
      />
      <path
        d="M40 61 H60"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeOpacity="0.35"
      />
    </svg>
  );
}
