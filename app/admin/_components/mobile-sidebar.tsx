"use client";

import type { SidebarIconKey } from "./admin-sidebar-active";
import { useState } from "react";
import { MenuIcon } from "lucide-react";

import { Avatar } from "@/components/medsync/avatar";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { AdminSidebarItem } from "./admin-sidebar-active";

/**
 * Mobile-only sidebar trigger + sheet. The persistent left sidebar
 * is hidden below `lg`; this component renders a hamburger in the
 * top bar and slides the nav in from the left when tapped.
 *
 * Takes the same primitive props as the desktop sidebar (string keys,
 * counts) — no icon components cross the server/client boundary.
 */

export interface MobileSidebarItem {
  href: string;
  label: string;
  iconKey: SidebarIconKey;
  sensitive?: boolean;
  badgeCount?: number;
}

interface Props {
  items: ReadonlyArray<MobileSidebarItem>;
  operatorEmail: string;
}

export function MobileSidebar({ items, operatorEmail }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className={cn(
          "border-ink-300 bg-card text-ink-600 shadow-control inline-flex size-8 items-center justify-center rounded-md border transition-colors outline-none lg:hidden",
          "hover:bg-ink-50 hover:text-foreground",
          "focus-visible:shadow-focus",
        )}
      >
        <MenuIcon className="size-4" aria-hidden />
      </button>

      <SheetContent side="left" widthClassName="w-[280px]" showCloseButton={false}>
        <SheetTitle className="sr-only">Workspace navigation</SheetTitle>

        <div className="border-border flex h-[52px] items-center gap-2.5 border-b px-5">
          <span className="font-display text-foreground text-body-m font-semibold">MedSync</span>
          <span className="text-muted-foreground font-mono text-[9.5px] tracking-[0.16em] uppercase">
            Console
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          <ul className="flex flex-col gap-0.5">
            {items.map((item) => (
              <li key={item.href}>
                {/* SheetClose wraps the row so navigating closes the sheet. */}
                <SheetClose render={<div />}>
                  <AdminSidebarItem
                    href={item.href}
                    label={item.label}
                    iconKey={item.iconKey}
                    sensitive={item.sensitive}
                    badgeCount={item.badgeCount}
                  />
                </SheetClose>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-border border-t p-3">
          <div className="flex items-center gap-2.5 px-1 py-1.5">
            <Avatar name={operatorEmail} hue="slate" size="md" />
            <p className="text-foreground text-label truncate">{operatorEmail}</p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
