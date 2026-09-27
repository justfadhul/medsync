"use client";

import type { FeatureIconKey } from "../_lib/features";
import { useState } from "react";
import { MenuIcon } from "lucide-react";

import { Avatar } from "@/components/medsync/avatar";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { HospitalSidebarItem } from "./hospital-sidebar-item";

/**
 * Mobile-only sidebar trigger + sheet. The persistent sidebar is hidden
 * below `lg`; this slides the nav in from the left when the hamburger
 * is tapped, and auto-closes when a nav row is selected (via SheetClose
 * wrapping each row).
 */

export interface MobileHospitalNavItem {
  href: string;
  label: string;
  iconKey: FeatureIconKey;
  badgeCount?: number;
  badgeTone?: "brand" | "caution";
  badgeLabel?: string;
}

interface Props {
  items: ReadonlyArray<MobileHospitalNavItem>;
  hospitalName: string;
  adminEmail: string;
}

export function MobileSidebar({ items, hospitalName, adminEmail }: Props) {
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

        <div className="border-border flex flex-col gap-0.5 border-b px-5 py-3">
          <span className="font-display text-foreground text-body-m font-semibold">MedSync</span>
          <span
            className="text-muted-foreground truncate font-mono text-[10px] tracking-[0.12em] uppercase"
            title={hospitalName}
          >
            {hospitalName}
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          <ul className="flex flex-col gap-0.5">
            {items.map((item) => (
              <li key={item.href}>
                <SheetClose render={<div />}>
                  <HospitalSidebarItem
                    href={item.href}
                    label={item.label}
                    iconKey={item.iconKey}
                    badgeCount={item.badgeCount}
                    badgeTone={item.badgeTone}
                    badgeLabel={item.badgeLabel}
                  />
                </SheetClose>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-border border-t p-3">
          <div className="flex items-center gap-2.5 px-1 py-1.5">
            <Avatar name={adminEmail} hue="slate" size="md" />
            <p className="text-foreground text-label truncate">{adminEmail}</p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
