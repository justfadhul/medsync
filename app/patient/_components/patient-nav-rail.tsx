"use client";

import type { PatientNavItem } from "../_lib/nav";
import type { MobileTabIconKey } from "@/components/responsive/mobile-tab-bar";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ActivityIcon,
  ChevronRightIcon,
  FileTextIcon,
  HomeIcon,
  HospitalIcon,
  MenuIcon,
  PillIcon,
} from "lucide-react";

import { activeNavHref } from "@/components/responsive/mobile-tab-bar";
import { cn } from "@/lib/utils";
import { PATIENT_NAV } from "../_lib/nav";

/**
 * Local resolver, keyed by the same strings as PATIENT_NAV. The rail is
 * rendered by a Server Component, so the icon cannot arrive as a prop —
 * a lucide icon is a function. Same contract as MobileTabBar's map.
 */
const ICONS: Record<MobileTabIconKey, LucideIcon> = {
  home: HomeIcon,
  activity: ActivityIcon,
  pill: PillIcon,
  "file-text": FileTextIcon,
  menu: MenuIcon,
};

/**
 * Persistent left nav for the patient workspace, `md:` and up — the
 * counterpart to MobileTabBar, over the same PATIENT_NAV array and the
 * same matcher. Icon-only at `md`, labelled at `lg`.
 *
 * Client only because it needs `usePathname`.
 *
 * The top bar stays at every width, so `top-13` (52px) is the one
 * sticky offset in the workspace and the global
 * `[data-section-anchor] { scroll-margin-top: 80px }` stays true.
 */
export function PatientNavRail({
  hospitalName,
  items = PATIENT_NAV,
}: {
  hospitalName: string | null;
  items?: ReadonlyArray<PatientNavItem>;
}) {
  const pathname = usePathname();
  const activeHref = activeNavHref(items, pathname);

  return (
    // A plain <div>, not an <aside>: the <nav> inside is already the
    // landmark and it already has a name. Wrapping it in an unnamed
    // complementary landmark gives assistive tech two entries for one rail.
    <div className="border-sidebar-border bg-sidebar sticky top-13 hidden h-[calc(100svh-52px)] w-14 shrink-0 flex-col border-r p-2 md:flex lg:w-60 lg:p-3">
      {/* The hospital link at the foot is navigation too, so it sits inside
          the landmark — outside it, it was content in no region at all. */}
      <nav aria-label="Patient navigation" className="flex min-w-0 flex-1 flex-col">
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => {
            const isActive = item.href === activeHref;
            const Icon = ICONS[item.iconKey];
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  // Plum says "you are here" (ADR 0097); the attribute is what
                  // the colour-role checks look for.
                  data-place={isActive ? "" : undefined}
                  // The label is invisible between md and lg, so it has to
                  // exist for screen readers and for the pointer tooltip.
                  aria-label={item.label}
                  title={item.label}
                  className={cn(
                    "tap flex min-h-11 items-center justify-center gap-3 rounded-md px-2.5 outline-none lg:justify-start",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    // Sub-routes read as sub-routes by indentation alone —
                    // no left accent bar.
                    item.indent && "lg:pl-7",
                  )}
                >
                  <Icon aria-hidden className="size-5 shrink-0 stroke-[1.5]" />
                  <span className="text-body-s hidden truncate font-medium lg:inline">
                    {item.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        {hospitalName ? (
          // Not a second copy of the header chip: that one is static text,
          // this one is the way into the hospital picker.
          <div className="border-sidebar-border mt-auto border-t pt-2">
            <Link
              href="/patient/hospitals"
              aria-label={`Your hospital: ${hospitalName}. Change hospital`}
              title={hospitalName}
              className="tap text-muted-foreground hover:bg-muted hover:text-foreground flex min-h-11 items-center justify-center gap-2 rounded-md px-2.5 outline-none lg:justify-start"
            >
              <HospitalIcon aria-hidden className="size-5 shrink-0 stroke-[1.5]" />
              <span className="text-body-s hidden min-w-0 flex-1 truncate lg:block">
                {hospitalName}
              </span>
              <ChevronRightIcon aria-hidden className="hidden size-3.5 shrink-0 lg:block" />
            </Link>
          </div>
        ) : null}
      </nav>
    </div>
  );
}
