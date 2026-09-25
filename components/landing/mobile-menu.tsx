"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MenuIcon, XIcon } from "lucide-react";

import { CONTAINER } from "@/components/landing/primitives";
import { buttonVariants } from "@/components/ui/button";
import { NAV } from "@/content/landing";
import { cn } from "@/lib/utils";

/**
 * Phone and tablet menu for the landing header (below lg). A disclosure, not a dialog:
 * the panel drops under the sticky header, focus stays on the button and Tab
 * walks into the panel. Closes on a link, Escape (focus back to the button),
 * a tap outside, focus leaving it, or the viewport reaching lg. Emergency is never in here — it
 * stays visible in the header row.
 */
export function MobileMenu({ showApply = true }: { showApply?: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const mql = window.matchMedia("(min-width: 1024px)");
    const onMql = () => mql.matches && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // A disclosure must not keep the page locked once focus has moved on.
    const onFocus = (e: FocusEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    mql.addEventListener("change", onMql);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.body.style.overflow = prevOverflow;
      mql.removeEventListener("change", onMql);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const close = () => setOpen(false);
  const Icon = open ? XIcon : MenuIcon;

  // No `relative` here: the panel anchors to the sticky <header>, full width.
  return (
    <div ref={rootRef} className="-mr-3 lg:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="site-mobile-menu"
        aria-label={open ? NAV.menu.close : NAV.menu.open}
        onClick={() => setOpen((o) => !o)}
        className="text-foreground hover:bg-muted inline-flex size-11 items-center justify-center rounded-md transition-colors duration-150"
      >
        <Icon aria-hidden className="size-5" strokeWidth={1.5} />
      </button>

      {open ? (
        <div
          id="site-mobile-menu"
          className={cn(
            "bg-background border-border absolute inset-x-0 top-full max-h-[calc(100dvh-3.5rem)] overflow-y-auto overscroll-contain border-b shadow-lg",
            "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:ease-expo-out motion-safe:duration-150",
          )}
        >
          <nav aria-label="Primary" className={cn(CONTAINER, "flex flex-col gap-1 py-3")}>
            <ul role="list" className="flex flex-col">
              {NAV.links.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    onClick={close}
                    className="text-body-m text-foreground hover:bg-muted flex min-h-11 items-center rounded-md px-3 transition-colors duration-150"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="border-border mt-2 flex flex-col gap-2 border-t pt-3">
              <Link
                href={NAV.signIn.href}
                onClick={close}
                className="text-body-m text-muted-foreground hover:text-foreground hover:bg-muted flex min-h-11 items-center rounded-md px-3 transition-colors duration-150"
              >
                {NAV.signIn.label}
              </Link>
              {showApply ? (
                <Link
                  href={NAV.apply.href}
                  onClick={close}
                  className={cn(
                    buttonVariants({ variant: "primary", size: "lg" }),
                    "min-h-11 w-full",
                  )}
                >
                  {NAV.apply.label}
                </Link>
              ) : null}
            </div>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
