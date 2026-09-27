"use client";

import type { Domain } from "@/lib/design/domains";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SearchIcon, TriangleAlertIcon } from "lucide-react";

import { Kbd } from "@/components/ui/kbd";
import { DOMAIN_HUE, HUE } from "@/lib/design/domains";
import { cn } from "@/lib/utils";
import { DomainTile } from "./domain-tile";

/** Opens the workspace command bar from anywhere (the sidebar's search row). */
export const OPEN_COMMAND_EVENT = "medsync:open-command";

/**
 * One row of a workspace sidebar (MedSync Chroma, ADR 0162): 30px, `label`
 * 13/500. A domain item carries its coloured tile and, when active, takes
 * its domain's tint; a neutral item (Home, Inbox) uses a plain `ink-500`
 * glyph and `sidebar-accent`. Counts are mono `muted-foreground`, never a
 * coloured badge; a `caution` count (something unavailable) keeps its
 * warning icon and says what it counts. No left-edge accent bar.
 */
export function SidebarNavItem({
  href,
  label,
  icon: Icon,
  domain,
  exact,
  count,
  countLabel,
  countTone = "neutral",
  trailing,
  dimmed,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  domain?: Domain;
  /** Match active on the exact href only (index routes). */
  exact?: boolean;
  count?: number;
  countLabel?: string;
  countTone?: "neutral" | "caution";
  /** Extra marker after the label (e.g. "soon"). */
  trailing?: ReactNode;
  dimmed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const hue = domain ? DOMAIN_HUE[domain] : undefined;

  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "text-label flex h-[30px] items-center gap-2 rounded-md px-1.5 transition-colors duration-100 outline-none",
        "focus-visible:shadow-focus",
        active
          ? hue && hue !== "slate"
            ? HUE[hue].navActive
            : "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-ink-100 hover:text-foreground",
        dimmed && !active && "opacity-70",
      )}
    >
      {domain ? (
        <DomainTile domain={domain} icon={<Icon />} size="sm" />
      ) : (
        <span aria-hidden className="text-ink-500 grid w-5 shrink-0 place-items-center">
          <Icon className="size-[15px] stroke-[1.75]" />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
      {count !== undefined && count > 0 ? (
        countTone === "caution" ? (
          <span
            aria-label={countLabel ?? `${count} need attention`}
            className="text-status-caution-fg-aa inline-flex items-center gap-0.5 font-mono text-[11px] font-medium tabular-nums"
          >
            <TriangleAlertIcon aria-hidden className="size-3" />
            {count}
          </span>
        ) : (
          <span
            aria-label={countLabel ?? `${count} pending`}
            className="text-muted-foreground font-mono text-[11px] font-medium tabular-nums"
          >
            {count > 99 ? "99+" : count.toLocaleString("en-GB")}
          </span>
        )
      ) : null}
    </Link>
  );
}

/** ALL-CAPS group label between sidebar sections. */
export function SidebarGroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-overline text-muted-foreground px-2 pt-3 pb-1 uppercase">{children}</div>
  );
}

/**
 * The facility mark: a 22px `ink-950` square with the initial in the display
 * face, then the workspace or facility name.
 */
export function SidebarWorkspace({
  name,
  sub,
  href = "/",
}: {
  name: string;
  sub?: string;
  href?: string;
}) {
  return (
    <Link
      href={href}
      className="hover:bg-ink-100 focus-visible:shadow-focus flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors outline-none"
    >
      <span
        aria-hidden
        className="bg-ink-950 text-background text-caption grid size-[22px] shrink-0 place-items-center rounded-sm font-semibold"
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-[13px] font-semibold tracking-[-0.01em]">
          {name}
        </span>
        {sub ? (
          <span className="text-muted-foreground block truncate text-[11px]">{sub}</span>
        ) : null}
      </span>
    </Link>
  );
}

/** The sidebar's search row: opens the command bar (⌘K). */
export function SidebarSearch({ label = "Search" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_EVENT))}
      className="border-ink-200 bg-card text-muted-foreground text-body-s hover:border-ink-300 focus-visible:shadow-focus flex h-[30px] w-full items-center gap-2 rounded-md border px-2 transition-colors outline-none"
    >
      <SearchIcon aria-hidden className="size-3.5" />
      <span className="flex-1 text-left">{label}</span>
      <Kbd>⌘K</Kbd>
    </button>
  );
}

/** The sidebar column itself: `sidebar` ground, 248px, hairline right edge. */
export const SIDEBAR_CLASS =
  "bg-sidebar border-sidebar-border hidden w-[248px] shrink-0 flex-col border-r lg:flex";
