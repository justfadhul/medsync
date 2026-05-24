"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Thin scroll-progress bar pinned to the very top of the viewport.
 *
 * Answers the visitor's "how much more is there?" question on a long
 * landing page. 2px tall, teal, sits above the sticky nav.
 *
 * Implementation:
 *   - Tracks document scroll position vs. (scrollHeight − viewport).
 *   - Throttled with requestAnimationFrame so we don't update state per
 *     pixel of scroll.
 *   - Single scroll listener (passive). The IntersectionObserver pattern
 *     used elsewhere doesn't apply here — we need a continuous fraction,
 *     not a discrete in/out event.
 *   - Reduced-motion: the bar still renders, but the width transition is
 *     dropped so it snaps rather than animates.
 */
export function V2ScrollProgress() {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    let frame = 0;
    const compute = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      if (max <= 0) {
        setPct(0);
        return;
      }
      const fraction = Math.min(1, Math.max(0, window.scrollY / max));
      setPct(fraction * 100);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(compute);
    };

    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div
      role="progressbar"
      aria-label="Page scroll progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[2px]"
    >
      <div
        className={cn(
          "h-full bg-teal-500 dark:bg-teal-400",
          // 100ms keeps the bar feeling tightly linked to scroll without
          // jittering. Reduced-motion users get an instant update.
          "transition-[width] duration-100 ease-linear motion-reduce:transition-none",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
