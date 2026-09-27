"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * The hub's seven tabs as sub-routes (URL state, §5.1). The current one carries the plum underline:
 * these are navigation — "where you are" — like the phone tab bar's current tab (ADR 0097), not
 * filters. A `tablist` of links; on a phone, one native select.
 */
export const HUB_TABS = [
  { href: "/hospital-admin/departments", label: "Departments" },
  { href: "/hospital-admin/departments/wards", label: "Wards & beds" },
  { href: "/hospital-admin/departments/clinics", label: "Clinics" },
  { href: "/hospital-admin/departments/diagnostics", label: "Diagnostics" },
  { href: "/hospital-admin/departments/emergency", label: "Emergency & support" },
  { href: "/hospital-admin/departments/availability", label: "Availability" },
  { href: "/hospital-admin/departments/hours", label: "Hours & places" },
] as const;

function currentTab(pathname: string) {
  return (
    [...HUB_TABS].reverse().find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))
      ?.href ?? HUB_TABS[0].href
  );
}

export function HubTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const current = currentTab(pathname);
  return (
    <>
      <nav
        aria-label="Departments & services"
        className="border-border hidden border-b md:block print:hidden"
      >
        <ul role="tablist" className="-mb-px flex gap-5 overflow-x-auto">
          {HUB_TABS.map((t) => {
            const active = t.href === current;
            return (
              <li key={t.href} role="presentation">
                <Link
                  role="tab"
                  href={t.href}
                  aria-selected={active}
                  aria-current={active ? "page" : undefined}
                  prefetch
                  className={cn(
                    "text-body-s relative inline-flex items-center pb-2.5 whitespace-nowrap transition-colors duration-100",
                    "focus-visible:ring-ring rounded-xs focus-visible:ring-2 focus-visible:outline-none",
                    active
                      ? "text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-x-0 -bottom-px h-0.5 rounded-full",
                      active ? "bg-foreground" : "bg-transparent",
                    )}
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <label className="flex flex-col gap-1 md:hidden print:hidden">
        <span className="text-muted-foreground text-caption">Section</span>
        <select
          value={current}
          onChange={(e) => router.push(e.target.value)}
          className="border-input bg-card text-body-s rounded-sm border px-2.5 py-2"
        >
          {HUB_TABS.map((t) => (
            <option key={t.href} value={t.href}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
