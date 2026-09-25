"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ActivityIcon, FileTextIcon, HomeIcon, MenuIcon, PillIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Why string keys for icons (not component refs):
 *
 * The patient layout is a Server Component. Passing a function
 * reference (a lucide icon IS a function) from server → client tripped
 * React's "Functions cannot be passed directly to Client Components"
 * error. The string-key + ICONS-map pattern is the same one the
 * Attio shell sidebars use. To add a new icon: import it above, add
 * its key to the union, add the value to the map.
 */
export type MobileTabIconKey = "home" | "activity" | "pill" | "file-text" | "menu";

const ICONS: Record<MobileTabIconKey, LucideIcon> = {
  home: HomeIcon,
  activity: ActivityIcon,
  pill: PillIcon,
  "file-text": FileTextIcon,
  menu: MenuIcon,
};

/**
 * Bottom tab bar for patient surfaces on phones.
 *
 *   - Below `md:`: pinned to the viewport bottom, thumb-reachable.
 *   - `md:` and up: hidden — the desktop equivalent is a sidebar
 *     (which we render separately in the patient layout).
 *
 * Active state derives from the longest matching href (see
 * `activeNavHref`), so exactly one slot lights at a time. Safe-area-
 * padded on iOS so the bar sits above the home indicator.
 */

export interface MobileTabBarItem {
  href: string;
  label: string;
  /** Resolves to a lucide icon via the ICONS map. Passing a
   * component reference here would break the server→client boundary. */
  iconKey: MobileTabIconKey;
  /** Optional badge count (small chip on top-right of the icon). */
  badgeCount?: number;
  /** Match the active state on exact href only, not prefix. Useful
   * for the index tab so /book doesn't light it up. */
  exact?: boolean;
  /** Extra paths that also light this item, beyond `href` itself —
   * for routes that belong to a tab without living under it. */
  matchPrefixes?: readonly string[];
}

/**
 * Which item is "here", by longest matching href.
 *
 * A bare `pathname.startsWith(href)` lit the wrong tab, or none: it
 * would have matched /patient/tracking against /patient/track, and a
 * child route that owns its own tab lit its parent as well. The
 * `=== p || startsWith(p + "/")` guard kills the first; taking the
 * longest winner kills the second, so declaration order carries no
 * meaning and adding a nested tab can't silently steal a sibling.
 *
 * Exported because the patient desktop rail renders the same array —
 * two renderers deriving "active" differently is the bug this replaces.
 */
export function activeNavHref(
  items: ReadonlyArray<MobileTabBarItem>,
  pathname: string,
): string | undefined {
  const matches = (item: MobileTabBarItem) =>
    item.exact
      ? pathname === item.href
      : (item.matchPrefixes ?? [item.href]).some(
          (p) => pathname === p || pathname.startsWith(`${p}/`),
        );

  return items.filter(matches).sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

export function MobileTabBar({
  items,
  className,
}: {
  items: ReadonlyArray<MobileTabBarItem>;
  className?: string;
}) {
  const pathname = usePathname();
  const activeHref = activeNavHref(items, pathname);

  return (
    <nav
      aria-label="Patient navigation"
      className={cn(
        // Opaque, not frosted: behind an 80% bar the idle labels' contrast
        // fell with whatever scrolled underneath (axe, light theme).
        "border-border bg-background fixed inset-x-0 bottom-0 z-30 border-t",
        "pt-1.5 pb-[max(env(safe-area-inset-bottom),0.5rem)]",
        "md:hidden",
        className,
      )}
    >
      <ul className="mx-auto flex w-full max-w-xl items-stretch justify-around gap-1 px-2">
        {items.map((item) => {
          const isActive = item.href === activeHref;
          const Icon = ICONS[item.iconKey];
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                data-place={isActive ? "" : undefined}
                className={cn(
                  // min-h-11 is the 44px touch target; px-2 py-1.5 was ~32px.
                  "group relative flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1.5 transition-colors outline-none",
                  "focus-visible:ring-brand-500/40 focus-visible:ring-2",
                  // No dark: override. `.dark` swaps --brand-700 to #99f6e4,
                  // which reads at 14:1 on the dark bar; the override this
                  // carried pinned brand-300 (#0d9488 in dark) at 4.8:1 —
                  // the same contrast failure the badge below had.
                  isActive ? "text-plum-700" : "text-muted-foreground",
                )}
              >
                {/* The non-colour half of "you are here": a mark that is
                    present on one slot and absent on the other four. Hue
                    alone fails the universal rule, and the label can't
                    carry the state because every slot has one. Absolutely
                    positioned, so it costs the 44px target no height — the
                    tab bar's box is the constant BottomActionBar clears. */}
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-0 top-0 mx-auto h-0.5 w-5 rounded-full bg-current"
                  />
                ) : null}
                <span className="relative">
                  {/* No scale on the active glyph: the indicator above,
                      the label weight and aria-current carry the state,
                      and a 5% nudge is decoration the system doesn't
                      want. */}
                  <Icon aria-hidden className="size-5" />
                  {item.badgeCount && item.badgeCount > 0 ? (
                    <span
                      aria-label={`${item.badgeCount} new`}
                      // bg-primary, not bg-brand-600: brand-600 is #5eead4 in
                      // dark and white on it fails contrast.
                      className="bg-primary text-primary-foreground text-caption absolute -top-1 -right-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono tabular-nums"
                    >
                      {item.badgeCount > 9 ? "9+" : item.badgeCount}
                    </span>
                  ) : null}
                </span>
                {/* text-caption carries weight 500, so the idle label has to
                    step down for weight to read as the second cue. */}
                <span
                  className={cn(
                    "text-caption tracking-tight",
                    isActive ? "font-medium" : "font-normal",
                  )}
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Spacer to drop into the page so its last row of content doesn't
 * land underneath the tab bar on mobile.
 */
export function MobileTabBarSpacer() {
  return <div className="h-16 md:hidden" aria-hidden />;
}
