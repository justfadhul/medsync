"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

export type StaffTab = "pending" | "directory" | "invites";

interface StaffTabsProps {
  activeTab: StaffTab;
  pendingCount: number;
}

const TABS: ReadonlyArray<{ id: StaffTab; label: string }> = [
  { id: "pending", label: "Pending approvals" },
  { id: "directory", label: "Directory" },
  { id: "invites", label: "Invitations" },
];

/**
 * Tabs for the Staff page. Each tab is a URL state (?tab=…) so the
 * admin can deep-link and the back button works naturally.
 *
 * The Pending tab carries a count chip so the operator sees the queue
 * depth before clicking. The chip mirrors the sidebar badge — same
 * data source, same look.
 */
export function StaffTabs({ activeTab, pendingCount }: StaffTabsProps) {
  // We preserve any unrelated search params (e.g. ?aff=… for a panel)
  // when switching tabs, but reset them when actually changing tab so
  // the panel doesn't open against an item that doesn't exist in the
  // new tab.
  const searchParams = useSearchParams();

  return (
    <div
      role="tablist"
      aria-label="Staff sections"
      className="border-border flex w-full items-center gap-1 border-b"
    >
      {TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        const href = `/hospital-admin/staff?tab=${tab.id}`;
        const isPending = tab.id === "pending";

        return (
          <Link
            key={tab.id}
            href={href}
            role="tab"
            aria-selected={isActive}
            aria-current={isActive ? "page" : undefined}
            replace
            scroll={false}
            className={cn(
              "tap text-body-s relative inline-flex items-center gap-2 rounded-t-md px-3 py-2.5 font-medium transition-colors outline-none",
              "focus-visible:ring-ring focus-visible:ring-2",
              "hover:bg-muted/50",
              isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            // Preserve other params silently.
            data-search-params={searchParams.toString()}
          >
            <span>{tab.label}</span>
            {isPending && pendingCount > 0 ? (
              <span
                aria-label={`${pendingCount} pending`}
                className={cn(
                  "scale-in rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums",
                  isActive
                    ? "bg-brand-100 text-brand-800 dark:bg-brand-900/60 dark:text-brand-200"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {pendingCount}
              </span>
            ) : null}
            {/* Always-mounted underline — scales in/out so the active
                indicator animates instead of popping. */}
            <span
              aria-hidden
              className={cn(
                "ease-expo-out bg-brand-500 dark:bg-brand-400 absolute right-0 -bottom-px left-0 h-0.5 origin-center rounded-t-md transition-transform duration-200",
                isActive ? "scale-x-100" : "scale-x-0",
              )}
            />
          </Link>
        );
      })}
    </div>
  );
}
