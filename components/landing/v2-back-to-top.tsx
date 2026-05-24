"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Floating "back to top" button that appears once the visitor has
 * scrolled past the first viewport.
 *
 * Visibility trigger is an IntersectionObserver on an invisible
 * sentinel placed one viewport height down from the top — no scroll
 * listener, no per-frame work. When the sentinel scrolls out of view
 * (above the viewport), the button fades in.
 *
 * Click scrolls back to top using window.scrollTo with smooth
 * behaviour; reduced-motion users get an instant jump (the browser
 * respects prefers-reduced-motion natively for behavior: "smooth"
 * when the document's CSS opts in via scroll-behavior, but since we
 * call window.scrollTo directly we check the media query first).
 */
export function V2BackToTop() {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry) setVisible(!entry.isIntersecting);
      },
      { threshold: 0 },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, []);

  const onClick = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <>
      {/* Sentinel — sits ~one viewport down from the top. When it
          scrolls above the viewport, the button fades in. Stays in
          the DOM tree under the page wrapper so it doesn't affect
          page layout (h-px). */}
      <div
        ref={sentinelRef}
        aria-hidden
        className="pointer-events-none absolute top-[100svh] h-px w-px"
      />

      <button
        type="button"
        onClick={onClick}
        aria-label="Back to top"
        // Hide from the tab order entirely when not visible so SR
        // users don't land on an invisible button on first load.
        tabIndex={visible ? 0 : -1}
        aria-hidden={!visible}
        className={cn(
          "fixed right-5 bottom-5 z-30 sm:right-8 sm:bottom-8",
          "inline-flex size-11 items-center justify-center rounded-full",
          "border-border bg-card text-foreground border shadow-lg",
          "hover:border-teal-300 hover:text-teal-700 dark:hover:text-teal-300",
          "transition-[opacity,transform,background-color,border-color] duration-200 ease-out",
          "motion-reduce:transition-none",
          visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
        )}
      >
        <ArrowUpIcon className="size-4" strokeWidth={2} />
      </button>
    </>
  );
}
