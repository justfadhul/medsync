import type { SidebarIconKey } from "./admin-sidebar-active";
import type { PaletteHospitalProp, PalettePersonProp } from "./command-palette";
import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";

import { Avatar } from "@/components/medsync/avatar";
import { SIDEBAR_CLASS, SidebarSearch, SidebarWorkspace } from "@/components/medsync/sidebar-nav";
import { AdminSidebarItem } from "./admin-sidebar-active";
import { CommandPaletteRoot } from "./command-palette";
import { MobileSidebar } from "./mobile-sidebar";

/**
 * Admin shell — persistent sidebar + top bar + main region.
 *
 * Layout primitives (per DESIGN-medsync.md):
 *   - Sidebar width 240px (collapses to icons < lg)
 *   - Top bar 52px
 *   - Page padding 32px desktop, 16px mobile
 *
 * The shell is server-rendered; only the active-state highlight and
 * the command palette are client. The palette listens for ⌘K globally
 * once mounted, so it must be present on every admin route.
 *
 * Sidebar items mirror the kickoff's six capability areas plus
 * Break-glass (the single PHI-bearing path — surfaced directly so
 * it's never invoked by accident from a routine flow).
 */

interface AdminShellProps {
  isSuperadmin: boolean;
  operatorEmail: string;
  mfaActive: boolean;
  /** Live count of items waiting for the operator. Rendered as a chip on Approvals. */
  approvalsCount: number;
  /** Pre-fetched palette entities for ⌘K entity search. */
  paletteHospitals: ReadonlyArray<PaletteHospitalProp>;
  palettePeople: ReadonlyArray<PalettePersonProp>;
  children: ReactNode;
}

interface NavItem {
  href: string;
  label: string;
  /** Resolved by the client AdminSidebarItem's icon map. Strings cross
   * the server/client boundary cleanly; component refs do not. */
  iconKey: SidebarIconKey;
  /** Hidden from non-superadmins (hospital_admin lite view). */
  superadminOnly?: boolean;
  /** Marks the item as a sensitive surface — distinct chip + colour. */
  sensitive?: boolean;
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: "/admin", label: "Approvals", iconKey: "approvals" },
  { href: "/admin/tenants", label: "Tenants", iconKey: "tenants", superadminOnly: true },
  { href: "/admin/people", label: "People", iconKey: "people", superadminOnly: true },
  {
    href: "/admin/staff-rollup",
    label: "Staff rollup",
    iconKey: "staff-rollup",
    superadminOnly: true,
  },
  {
    href: "/admin/scheduling-rollup",
    label: "Scheduling rollup",
    iconKey: "scheduling-rollup",
    superadminOnly: true,
  },
  { href: "/admin/catalog", label: "Catalog", iconKey: "catalog", superadminOnly: true },
  { href: "/admin/emergency", label: "Emergency", iconKey: "emergency", superadminOnly: true },
  { href: "/admin/audit", label: "Audit", iconKey: "audit", superadminOnly: true },
  { href: "/admin/health", label: "Health", iconKey: "health" },
  { href: "/admin/feedback", label: "Tester feedback", iconKey: "feedback", superadminOnly: true },
  {
    href: "/admin/break-glass",
    label: "Break-glass",
    iconKey: "break-glass",
    superadminOnly: true,
    sensitive: true,
  },
];

export function AdminShell({
  isSuperadmin,
  operatorEmail,
  mfaActive,
  approvalsCount,
  paletteHospitals,
  palettePeople,
  children,
}: AdminShellProps) {
  const items = NAV_ITEMS.filter((item) => !item.superadminOnly || isSuperadmin);

  return (
    <div className="bg-background text-foreground flex min-h-svh w-full">
      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <aside aria-label="Workspace navigation" className={SIDEBAR_CLASS}>
        <div className="flex flex-col gap-1.5 p-2">
          <SidebarWorkspace
            name="MedSync"
            sub={isSuperadmin ? "Superadmin console" : "Admin console"}
            href="/admin"
          />
          <SidebarSearch />
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          <ul className="flex flex-col gap-0.5">
            {items.map((item) => (
              <li key={item.href}>
                <AdminSidebarItem
                  href={item.href}
                  label={item.label}
                  iconKey={item.iconKey}
                  sensitive={item.sensitive}
                  badgeCount={item.href === "/admin" ? approvalsCount : undefined}
                />
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-sidebar-border border-t p-2">
          <div className="flex items-center gap-2 px-1.5 py-1.5">
            <Avatar name={operatorEmail} hue="slate" size="md" />
            <div className="min-w-0 flex-1">
              <p className="text-foreground text-label truncate">{operatorEmail}</p>
              <p className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
                {mfaActive ? (
                  <ShieldCheckIcon className="size-3" aria-hidden />
                ) : (
                  <ShieldAlertIcon className="size-3" aria-hidden />
                )}
                <span className={mfaActive ? undefined : "text-foreground font-medium"}>
                  {mfaActive ? "MFA · AAL2" : "MFA inactive"}
                </span>
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main column ──────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="border-border glass sticky top-0 z-30 flex h-12 items-center justify-between gap-3 border-b px-4 sm:px-6">
          {/* Mobile-only: hamburger → sidebar sheet + brand mark */}
          <div className="flex items-center gap-2.5 lg:hidden">
            <MobileSidebar
              items={items.map((item) => ({
                href: item.href,
                label: item.label,
                iconKey: item.iconKey,
                sensitive: item.sensitive,
                badgeCount: item.href === "/admin" ? approvalsCount : undefined,
              }))}
              operatorEmail={operatorEmail}
            />
            <Link href="/admin" className="font-display text-foreground text-body-m font-semibold">
              MedSync
            </Link>
          </div>

          {/* Environment / god-mode indicator — operator always knows */}
          <div className="hidden items-center gap-2 lg:flex">
            <span
              aria-label="You are signed into the superadmin console"
              className="text-muted-foreground text-caption inline-flex items-center gap-1.5 font-normal"
            >
              {isSuperadmin ? "Superadmin console" : "Admin console"} · Production
            </span>
          </div>

          {/* ⌘K trigger + palette (single root — owns its open state) */}
          <div className="flex flex-1 items-center justify-end gap-3">
            <CommandPaletteRoot
              isSuperadmin={isSuperadmin}
              hospitals={paletteHospitals}
              people={palettePeople}
            />
            <Link
              href="/sign-out"
              className="text-muted-foreground hover:text-foreground text-[12px] transition-colors"
            >
              Sign out
            </Link>
          </div>
        </header>

        {/* Main region */}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
