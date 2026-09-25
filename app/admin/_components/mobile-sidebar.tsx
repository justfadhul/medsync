"use client";

import type { SidebarIconKey } from "./admin-sidebar-active";
import { useState } from "react";
import { MenuIcon } from "lucide-react";

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
          "border-border bg-background text-muted-foreground inline-flex items-center justify-center rounded-md border p-1.5 transition-colors outline-none lg:hidden",
          "hover:bg-muted hover:text-foreground",
          "focus-visible:ring-brand-500/40 focus-visible:ring-2",
        )}
      >
        <MenuIcon className="size-4" aria-hidden />
      </button>

      <SheetContent side="left" widthClassName="w-[280px]" showCloseButton={false}>
        <SheetTitle className="sr-only">Workspace navigation</SheetTitle>

        <div className="border-border flex h-[52px] items-center gap-2.5 border-b px-5">
          <span className="font-display text-foreground text-body-m font-medium tracking-[-0.01em]">
            MedSync
          </span>
          <span className="text-muted-foreground font-mono text-[9.5px] tracking-[0.16em] uppercase">
            Console
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          <ul className="flex flex-col gap-px">
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
            <div
              aria-hidden
              className="bg-plum-100 text-caption text-plum-800 flex size-7 shrink-0 items-center justify-center rounded-full font-mono font-semibold"
            >
              {operatorEmail.slice(0, 1).toUpperCase()}
            </div>
            <p className="text-foreground truncate text-[12px] font-medium">{operatorEmail}</p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
