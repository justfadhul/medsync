import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { SCREENS } from "@/content/sensor";
import { cn } from "@/lib/cn";
import { bracketCode } from "@/lib/content";
import { useReducedMotion } from "@/lib/use-reduced-motion";

export interface ScreenNavProps {
  /** rail: the vertical column at the large breakpoint and wider.
   *  tabs: the strip that scrolls sideways below it. */
  variant: "rail" | "tabs";
  className?: string;
  /** Called after a link is followed, so the narrow layout can tidy up. */
  onNavigate?: () => void;
}

/**
 * The nine screens, in order, as real router links. Both variants list every
 * screen with its bracket code and full title: nothing is truncated, and at
 * 390 pixels wide the strip scrolls sideways rather than clipping a title.
 *
 * Only one variant is displayed at a time (the other is set to display none,
 * which also takes it out of the accessibility tree), so the page never
 * carries two navigation landmarks at once.
 */
export function ScreenNav({ variant, className, onNavigate }: ScreenNavProps) {
  const isRail = variant === "rail";
  const listRef = useRef<HTMLUListElement | null>(null);
  const reducedMotion = useReducedMotion();
  const { pathname } = useLocation();

  // Keep the current screen in view in the narrow strip.
  useEffect(() => {
    if (isRail) return;
    const active = listRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (typeof active?.scrollIntoView !== "function") return;
    active.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      inline: "nearest",
      block: "nearest",
    });
  }, [isRail, pathname, reducedMotion]);

  return (
    <nav aria-label="Screens" className={className}>
      <ul
        ref={listRef}
        className={cn(
          isRail
            ? "flex flex-col gap-0.5 p-3"
            : "flex snap-x snap-proximity scroll-px-3 gap-1.5 overflow-x-auto px-3 py-2",
        )}
      >
        {SCREENS.map((screen) => (
          <li key={screen.path} className={isRail ? undefined : "snap-start"}>
            <NavLink
              to={screen.path}
              end={screen.path === "/"}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "tap flex items-center rounded-md border border-transparent",
                  isRail ? "gap-2.5 px-3 py-2" : "gap-2 px-2.5 py-1.5 whitespace-nowrap",
                  isActive
                    ? "border-teal-100 bg-teal-50 text-teal-800"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      "text-caption tabular font-mono",
                      isActive ? "text-teal-800" : "text-gray-500",
                    )}
                  >
                    {bracketCode(screen.code)}
                  </span>
                  <span className="text-body-s font-medium">{screen.title}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
