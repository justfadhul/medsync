"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MenuIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Landing v2 — sticky wayfinding nav.
 *
 * Replaces the original §02 nav for the navigability refactor. The
 * goals here are different from the old nav:
 *
 *   - A persistent header at the top so the visitor always has somewhere
 *     to go and never gets lost on a long page.
 *   - Anchor links to the major sections, with the link for the section
 *     currently in view highlighted (scroll-spy).
 *   - Smooth-scroll anchor jumps that respect prefers-reduced-motion.
 *   - Sticky-shrink on scroll: subtle density drop after the first
 *     viewport, via an IntersectionObserver sentinel (no scroll listener).
 *   - Mobile: hamburger opens a sheet with the same anchor list.
 *
 * Visual language is unchanged from the rest of the landing — borrows the
 * existing eyebrow + glassy backdrop + teal-accent treatment so it reads
 * as part of the same design system.
 */

export interface SectionLink {
  /** DOM id of the target section (e.g. "loop"). */
  id: string;
  /** Short label shown in the nav. */
  label: string;
}

export const DEFAULT_LANDING_SECTIONS: ReadonlyArray<SectionLink> = [
  { id: "problem", label: "The gap" },
  { id: "loop", label: "The loop" },
  { id: "patients", label: "For patients" },
  { id: "hospitals", label: "For hospitals" },
  { id: "trust", label: "Trust" },
  { id: "about", label: "About" },
];

export interface V2SiteNavProps {
  sections?: ReadonlyArray<SectionLink>;
}

export function V2SiteNav({ sections = DEFAULT_LANDING_SECTIONS }: V2SiteNavProps) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [shrunk, setShrunk] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? "");

  // Sticky-shrink — flip when the sentinel scrolls out of view. No
  // scroll listener so we don't run JS every frame.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry) setShrunk(!entry.isIntersecting);
      },
      { threshold: 0 },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, []);

  // Scroll-spy — track which section is most prominently in view. We
  // observe every section element and pick the one whose center is
  // closest to the viewport center. Avoids the edge-case where two
  // sections overlap the middle band.
  useEffect(() => {
    const sectionEls = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sectionEls.length === 0) return;

    let frame = 0;
    const compute = () => {
      const viewportCenter = window.innerHeight / 2;
      let best: { id: string; distance: number } | null = null;
      for (const el of sectionEls) {
        const rect = el.getBoundingClientRect();
        const sectionCenter = rect.top + rect.height / 2;
        const distance = Math.abs(sectionCenter - viewportCenter);
        // Skip sections that are fully off-screen.
        if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
        if (!best || distance < best.distance) {
          best = { id: el.id, distance };
        }
      }
      if (best) setActiveId((prev) => (prev === best.id ? prev : best.id));
    };

    const io = new IntersectionObserver(
      () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(compute);
      },
      // Wide observation band so we catch entries earlier than the
      // viewport edges; the compute step picks the actual winner.
      { rootMargin: "-20% 0px -20% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    sectionEls.forEach((el) => io.observe(el));
    compute();
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [sections]);

  // Close mobile drawer when crossing the md breakpoint.
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (mql.matches) setDrawerOpen(false);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  return (
    <>
      {/* Sentinel: when this scrolls out of view we know we've passed
          the page top and can switch to the dense variant. */}
      <div ref={sentinelRef} aria-hidden className="absolute top-0 h-px w-px" />

      <header
        data-shrunk={shrunk || undefined}
        className={cn(
          "sticky top-0 z-40 w-full",
          "supports-[backdrop-filter]:bg-background/80 bg-background/95 backdrop-blur",
          "border-border/60 border-b",
          "ease-expo-out transition-all duration-200",
        )}
      >
        <div
          className={cn(
            "mx-auto flex w-full max-w-300 items-center justify-between gap-6 px-5 sm:px-8",
            // Subtle density drop after the first viewport. The
            // wordmark + CTA shrink together with the nav padding.
            "py-3.5 data-[shrunk]:py-2.5",
          )}
        >
          {/* Wordmark */}
          <Link
            href="/"
            className="font-display text-foreground text-[18px] tracking-tight transition-opacity hover:opacity-80"
          >
            MedSync
          </Link>

          {/* Anchor list — center */}
          <nav aria-label="Page sections" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {sections.map((s) => {
                const isActive = activeId === s.id;
                return (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      aria-current={isActive ? "true" : undefined}
                      className={cn(
                        "relative rounded-md px-3 py-1.5 text-[12.5px] tracking-[0.01em] transition-colors",
                        isActive
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground/90",
                      )}
                    >
                      {s.label}
                      {/* Active underline */}
                      <span
                        aria-hidden
                        className={cn(
                          "absolute right-3 bottom-0 left-3 h-[1.5px] rounded-full bg-teal-500 transition-opacity duration-200 dark:bg-teal-400",
                          isActive ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* CTA + Sign in — right */}
          <div className="flex items-center gap-3">
            <Link
              href="/sign-in"
              className="text-muted-foreground hover:text-foreground hidden text-[12.5px] transition-colors sm:inline-flex"
            >
              Sign in
            </Link>
            <Link
              href="/get-started"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12.5px] font-medium",
                "bg-teal-600 text-white shadow-sm transition-colors hover:bg-teal-700",
                "dark:bg-teal-500 dark:hover:bg-teal-600",
              )}
            >
              Get started
            </Link>
            <button
              type="button"
              aria-label="Open navigation menu"
              aria-expanded={drawerOpen}
              aria-controls="v2-nav-drawer"
              onClick={() => setDrawerOpen(true)}
              className="text-foreground hover:bg-muted inline-flex size-9 items-center justify-center rounded-md md:hidden"
            >
              <MenuIcon className="size-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div
          id="v2-nav-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Page navigation"
          className="fixed inset-0 z-50 md:hidden"
        >
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="bg-background/60 absolute inset-0 backdrop-blur-sm"
          />
          <div className="bg-background border-border absolute inset-y-0 right-0 flex w-[78%] max-w-xs flex-col border-l shadow-xl">
            <div className="border-border/60 flex items-center justify-between border-b px-5 py-3.5">
              <span className="font-display text-foreground text-[16px] tracking-tight">
                MedSync
              </span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setDrawerOpen(false)}
                className="text-foreground hover:bg-muted inline-flex size-9 items-center justify-center rounded-md"
              >
                <XIcon className="size-4" strokeWidth={2} />
              </button>
            </div>
            <nav aria-label="Page sections" className="flex flex-col gap-1 p-3">
              {sections.map((s) => {
                const isActive = activeId === s.id;
                return (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    onClick={() => setDrawerOpen(false)}
                    aria-current={isActive ? "true" : undefined}
                    className={cn(
                      "flex items-center justify-between rounded-md px-3 py-2.5 text-[14px]",
                      isActive
                        ? "text-foreground bg-teal-50/60 dark:bg-teal-50/10"
                        : "text-foreground/85 hover:bg-muted",
                    )}
                  >
                    <span>{s.label}</span>
                    {isActive ? (
                      <span
                        aria-hidden
                        className="size-1.5 rounded-full bg-teal-500 dark:bg-teal-400"
                      />
                    ) : null}
                  </a>
                );
              })}
              <div className="border-border/60 mt-3 flex flex-col gap-1 border-t pt-3">
                <Link
                  href="/sign-in"
                  onClick={() => setDrawerOpen(false)}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-md px-3 py-2.5 text-[14px]"
                >
                  Sign in
                </Link>
                <Link
                  href="/get-started"
                  onClick={() => setDrawerOpen(false)}
                  className="inline-flex items-center justify-center rounded-md bg-teal-600 px-3 py-2.5 text-[14px] font-medium text-white dark:bg-teal-500"
                >
                  Get started
                </Link>
              </div>
            </nav>
          </div>
        </div>
      ) : null}
    </>
  );
}
