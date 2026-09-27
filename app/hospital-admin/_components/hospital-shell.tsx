import type { ClientHospitalScope } from "./scope-provider";
import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";

import { Avatar } from "@/components/medsync/avatar";
import { SIDEBAR_CLASS, SidebarSearch, SidebarWorkspace } from "@/components/medsync/sidebar-nav";
import { FEATURE_AREAS, featurePath } from "../_lib/features";
import { HospitalCommandPalette } from "./hospital-command-palette";
import { HospitalSidebarItem } from "./hospital-sidebar-item";
import { MobileSidebar } from "./mobile-sidebar";
import { HospitalScopeProvider } from "./scope-provider";

/**
 * Hospital-admin workspace shell — sidebar + top bar + main slot.
 *
 * Layout primitives match the superadmin shell so muscle memory is
 * shared (the Chroma 248px sidebar, 48px top bar, 32px desktop page padding).
 * What's intentionally different:
 *
 *   - the top-bar identity strip names THIS HOSPITAL, not "Superadmin
 *     console". The admin can't forget which tenant they're in.
 *   - the sidebar is built from FEATURE_AREAS — the single registry
 *     that feature prompts edit. Adding a feature is a one-line entry,
 *     not a shell edit.
 *   - everything inside is wrapped in <HospitalScopeProvider> so
 *     client components don't re-fetch (or worse, re-derive) scope.
 *
 * The shell stays server-rendered; only the sidebar item active state
 * and the command palette need to be client (pathname + keyboard).
 */

interface HospitalShellProps {
  scope: ClientHospitalScope;
  adminEmail: string;
  mfaActive: boolean;
  /** Live count for the Staff badge (pending affiliations for THIS hospital). */
  staffPendingCount: number;
  /** Departments & services: things unavailable right now (amber badge; ADR 0157). */
  servicesProblemCount?: number;
  children: ReactNode;
}

/** Friendly display string for hospitals.level. */
function formatLevel(level: string): string {
  const map: Record<string, string> = {
    national_referral: "National referral",
    regional: "Regional referral",
    district: "District / General",
    hc4: "Health Centre IV",
    hc3: "Health Centre III",
    private: "Private",
  };
  return map[level] ?? level;
}

export function HospitalShell({
  scope,
  adminEmail,
  mfaActive,
  staffPendingCount,
  servicesProblemCount = 0,
  children,
}: HospitalShellProps) {
  const navItems = FEATURE_AREAS.map((f) => ({
    href: featurePath(f.slug),
    label: f.label,
    iconKey: f.iconKey,
    badgeCount:
      f.slug === "staff"
        ? staffPendingCount
        : f.slug === "departments"
          ? servicesProblemCount
          : undefined,
    badgeTone: f.slug === "departments" ? ("caution" as const) : ("brand" as const),
    badgeLabel:
      f.slug === "departments" && servicesProblemCount > 0
        ? `${servicesProblemCount} ${servicesProblemCount === 1 ? "thing" : "things"} unavailable`
        : undefined,
  }));

  const paletteEntries = FEATURE_AREAS.map((f) => ({
    id: `nav-${f.slug || "overview"}`,
    label: f.label,
    hint: f.hint,
    href: featurePath(f.slug),
    iconKey: f.iconKey,
  }));

  return (
    <HospitalScopeProvider scope={scope}>
      <div className="bg-background text-foreground flex min-h-svh w-full">
        {/* ── Sidebar ──────────────────────────────────────────────── */}
        <aside aria-label="Workspace navigation" className={SIDEBAR_CLASS}>
          <div className="flex flex-col gap-1.5 p-2">
            <SidebarWorkspace
              name={scope.hospitalName}
              sub={formatLevel(scope.level)}
              href="/hospital-admin"
            />
            <SidebarSearch />
          </div>

          <nav className="flex-1 overflow-y-auto px-2 pb-2">
            <ul className="flex flex-col gap-0.5">
              {navItems.map((item) => (
                <li key={item.href}>
                  <HospitalSidebarItem
                    href={item.href}
                    label={item.label}
                    iconKey={item.iconKey}
                    badgeCount={item.badgeCount}
                    badgeTone={item.badgeTone}
                    badgeLabel={item.badgeLabel}
                  />
                </li>
              ))}
            </ul>
          </nav>

          <div className="border-sidebar-border border-t p-2">
            <div className="flex items-center gap-2 px-1.5 py-1.5">
              <Avatar name={adminEmail} hue="slate" size="md" />
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-label truncate">{adminEmail}</p>
                <p className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
                  {mfaActive ? (
                    <ShieldCheckIcon className="size-3" aria-hidden />
                  ) : (
                    <ShieldAlertIcon className="size-3" aria-hidden />
                  )}
                  <span className={mfaActive ? undefined : "text-foreground font-medium"}>
                    {mfaActive ? "MFA · AAL2" : "MFA inactive"}
                  </span>
                  {scope.designation ? <span>· {scope.designation}</span> : null}
                </p>
              </div>
            </div>
          </div>
        </aside>

        {/* ── Main column ──────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="border-border glass sticky top-0 z-30 flex h-12 items-center justify-between gap-3 border-b px-4 sm:px-6">
            {/* Mobile: hamburger → sidebar sheet + brand */}
            <div className="flex items-center gap-2.5 lg:hidden">
              <MobileSidebar
                items={navItems}
                hospitalName={scope.hospitalName}
                adminEmail={adminEmail}
              />
              <Link
                href="/hospital-admin"
                className="font-display text-foreground text-body-m font-semibold"
              >
                MedSync
              </Link>
            </div>

            {/* Desktop: ever-present hospital identity strip */}
            <div className="hidden min-w-0 items-center gap-2 lg:flex">
              <span
                aria-label={`Signed into the ${scope.hospitalName} admin workspace`}
                className="text-muted-foreground text-caption inline-flex min-w-0 items-center gap-1.5 font-normal"
              >
                <span className="text-foreground truncate font-medium" title={scope.hospitalName}>
                  {scope.hospitalName}
                </span>
                <span className="text-muted-foreground/70" aria-hidden>
                  ·
                </span>
                <span className="text-muted-foreground">{formatLevel(scope.level)}</span>
                {scope.state !== "active" ? (
                  <>
                    <span className="text-muted-foreground/70" aria-hidden>
                      ·
                    </span>
                    <span className="text-foreground font-medium">{scope.state}</span>
                  </>
                ) : null}
              </span>
            </div>

            {/* ⌘K + sign out */}
            <div className="flex flex-1 items-center justify-end gap-3">
              <HospitalCommandPalette navEntries={paletteEntries} />
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
    </HospitalScopeProvider>
  );
}
