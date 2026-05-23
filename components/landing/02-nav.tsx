"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, MenuIcon, XIcon } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

/**
 * §02 — Top navigation.
 *
 *   - Sticky-shrink: a 1px sentinel above <main> drives an IntersectionObserver.
 *     No scroll listener, so we don't pay an event-loop tax per frame.
 *   - Mega menus on Platform + Care, hover/focus revealed. Reduced-motion just
 *     fades them in.
 *   - Mobile (<md): hamburger opens a full-height drawer with the same items.
 *
 * Per GATE A: every audience-facing route uses /onboarding/{patient,clinical,
 * hospital} so the nav links stay aligned with the hero/mid-band/final CTAs.
 */

interface MegaSection {
  heading: string;
  links: Array<{ label: string; href: string; description?: string }>;
}

const PLATFORM_MENU: MegaSection[] = [
  {
    heading: "The closed-loop record",
    links: [
      {
        label: "Patient record",
        href: "/#enrichment",
        description: "One adaptive record per patient.",
      },
      {
        label: "Care coordination",
        href: "/#ecosystem",
        description: "Ward, clinic, and home in one loop.",
      },
      {
        label: "Specialty views",
        href: "/#adaptive-model",
        description: "Diabetology · Cardiology · Nephrology · Pulmonology.",
      },
    ],
  },
  {
    heading: "Uganda-built capabilities",
    links: [
      { label: "Offline-first wards", href: "/#uganda" },
      { label: "SMS · USSD reach", href: "/#uganda" },
      { label: "Audit + Uganda DPA", href: "/#trust" },
    ],
  },
];

const CARE_MENU: MegaSection[] = [
  {
    heading: "For audiences",
    links: [
      { label: "For patients", href: "/onboarding/patient", description: "Join the waitlist." },
      { label: "For clinicians", href: "/onboarding/clinical", description: "Request access." },
      { label: "For hospitals", href: "/onboarding/hospital", description: "Request a pilot." },
    ],
  },
];

export function Nav() {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [shrunk, setShrunk] = useState(false);
  const [openMenu, setOpenMenu] = useState<"platform" | "care" | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Sticky-shrink via IntersectionObserver (no scroll listener).
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setShrunk(!entry.isIntersecting);
      },
      { rootMargin: "0px 0px 0px 0px", threshold: 0 },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, []);

  // Close drawer when route changes shape (resize past md).
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (mql.matches) setDrawerOpen(false);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return (
    <>
      {/* 1px sentinel — when it scrolls out, nav shrinks. */}
      <div ref={sentinelRef} aria-hidden className="h-px w-full" />

      <header
        className={cn(
          "sticky top-0 z-40 w-full",
          "bg-background/70 backdrop-blur-md backdrop-saturate-150",
          "ease-expo-out transition-[padding,border-color,background] duration-200",
          shrunk ? "border-border border-b py-2" : "border-b border-transparent py-3.5",
        )}
        onMouseLeave={() => setOpenMenu(null)}
      >
        <div className="mx-auto flex w-full max-w-300 items-center justify-between gap-4 px-5 sm:px-8">
          {/* Brand */}
          <Link
            href="/"
            className="flex items-baseline gap-0.5 transition-opacity hover:opacity-80"
            aria-label="MedSync — home"
          >
            <span className="font-display text-[20px] leading-none font-medium tracking-tight">
              MedSync
            </span>
            <span className="size-1.5 translate-y-[-2px] rounded-full bg-teal-500 dark:bg-teal-400" />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            <NavTrigger
              label="Platform"
              open={openMenu === "platform"}
              onOpen={() => setOpenMenu("platform")}
            />
            <NavTrigger
              label="Care doors"
              open={openMenu === "care"}
              onOpen={() => setOpenMenu("care")}
            />
            <Link
              href="/#trust"
              className="text-muted-foreground hover:text-foreground rounded px-3 py-1.5 text-[13px] transition-colors"
              onMouseEnter={() => setOpenMenu(null)}
            >
              Trust
            </Link>
            <Link
              href="/#founding-story"
              className="text-muted-foreground hover:text-foreground rounded px-3 py-1.5 text-[13px] transition-colors"
              onMouseEnter={() => setOpenMenu(null)}
            >
              About
            </Link>
          </nav>

          {/* Right cluster */}
          <div className="flex items-center gap-1.5">
            <Link
              href="/sign-in"
              className="text-muted-foreground hover:text-foreground hidden rounded px-3 py-1.5 text-[13px] transition-colors md:inline"
            >
              Sign in
            </Link>
            <ThemeToggle />
            <Link
              href="mailto:hello@medsync.health?subject=MedSync%20%E2%80%94%20early%20access"
              className={cn(
                "hidden items-center gap-1 rounded-md px-3 py-1.5 text-[13px] font-medium md:inline-flex",
                "bg-foreground text-background hover:bg-foreground/90",
                "transition-colors duration-150",
              )}
            >
              Email a founder
            </Link>
            <button
              type="button"
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              className="text-foreground rounded p-1.5 md:hidden"
            >
              <MenuIcon className="size-5" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Mega-menu panel — shared region under the nav bar */}
        <MegaMenuPanel
          open={openMenu !== null}
          sections={openMenu === "platform" ? PLATFORM_MENU : openMenu === "care" ? CARE_MENU : []}
          onClose={() => setOpenMenu(null)}
        />
      </header>

      {/* Mobile drawer */}
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}

function NavTrigger({ label, open, onOpen }: { label: string; open: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onMouseEnter={onOpen}
      onFocus={onOpen}
      aria-expanded={open}
      className={cn(
        "inline-flex items-center gap-1 rounded px-3 py-1.5 text-[13px] transition-colors",
        open ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      <ChevronDownIcon
        className={cn("size-3 transition-transform duration-200", open ? "rotate-180" : "rotate-0")}
        strokeWidth={2}
      />
    </button>
  );
}

function MegaMenuPanel({
  open,
  sections,
  onClose,
}: {
  open: boolean;
  sections: MegaSection[];
  onClose: () => void;
}) {
  return (
    <div
      aria-hidden={!open}
      className={cn(
        "ease-expo-out pointer-events-none absolute inset-x-0 top-full transition-all duration-200",
        open ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0",
      )}
    >
      <div
        className={cn(
          "pointer-events-auto mx-auto max-w-300 px-5 sm:px-8",
          open ? "" : "pointer-events-none",
        )}
        onMouseLeave={onClose}
      >
        <div className="border-border bg-popover shadow-popover overflow-hidden rounded-lg border">
          <div className="grid gap-6 p-5 sm:grid-cols-2 sm:gap-8 sm:p-6">
            {sections.map((section) => (
              <div key={section.heading} className="flex flex-col gap-2">
                <span className="text-muted-foreground font-mono text-[10px] tracking-[0.16em] uppercase">
                  {section.heading}
                </span>
                <ul className="flex flex-col gap-0.5">
                  {section.links.map((link) => (
                    <li key={link.href + link.label}>
                      <Link
                        href={link.href}
                        onClick={onClose}
                        className="hover:bg-accent group flex flex-col gap-0.5 rounded-md px-2 py-1.5 transition-colors"
                      >
                        <span className="text-foreground text-[13.5px] font-medium">
                          {link.label}
                        </span>
                        {link.description ? (
                          <span className="text-muted-foreground text-[12px]">
                            {link.description}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-hidden={!open}
      className={cn(
        "fixed inset-0 z-50 md:hidden",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0",
        )}
      />
      {/* Panel */}
      <div
        className={cn(
          "bg-background absolute inset-y-0 right-0 flex w-[88%] max-w-sm flex-col gap-4 p-6 shadow-2xl",
          "ease-expo-out transition-transform duration-300",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between">
          <span className="font-display text-[18px] font-medium">Menu</span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground rounded p-1.5"
          >
            <XIcon className="size-5" strokeWidth={1.75} />
          </button>
        </div>

        <nav className="flex flex-col gap-1 pt-2">
          {[
            { label: "Platform", href: "/#platform-showcase" },
            { label: "The closed-loop record", href: "/#adaptive-model" },
            { label: "Patient card", href: "/#enrichment" },
            { label: "Uganda capabilities", href: "/#uganda" },
            { label: "Trust + governance", href: "/#trust" },
            { label: "About + founding story", href: "/#founding-story" },
            { label: "FAQ", href: "/#faq" },
          ].map((link) => (
            <Link
              key={link.href + link.label}
              href={link.href}
              onClick={onClose}
              className="hover:bg-accent text-foreground rounded-md px-3 py-2 text-[15px]"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-2 pt-4">
          <Link
            href="mailto:hello@medsync.health?subject=MedSync%20%E2%80%94%20early%20access"
            onClick={onClose}
            className="bg-foreground text-background rounded-md px-4 py-2.5 text-center text-[14px] font-medium"
          >
            Email a founder
          </Link>
          <Link
            href="/sign-in"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-center text-[13px] underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
