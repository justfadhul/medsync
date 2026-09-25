import type { ClientHospitalScope } from "./scope-provider";
import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldCheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { FEATURE_AREAS, featurePath } from "../_lib/features";
import { HospitalCommandPalette } from "./hospital-command-palette";
import { HospitalSidebarItem } from "./hospital-sidebar-item";
import { MobileSidebar } from "./mobile-sidebar";
import { HospitalScopeProvider } from "./scope-provider";

/**
 * Hospital-admin workspace shell — sidebar + top bar + main slot.
 *
 * Layout primitives match the superadmin shell so muscle memory is
 * shared (240px sidebar, 52px top bar, 32px desktop page padding).
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
  children,
}: HospitalShellProps) {
  const navItems = FEATURE_AREAS.map((f) => ({
    href: featurePath(f.slug),
    label: f.label,
    iconKey: f.iconKey,
    badgeCount: f.slug === "staff" ? staffPendingCount : undefined,
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
        <aside
          aria-label="Workspace navigation"
          className="bg-muted/40 border-border hidden w-[240px] shrink-0 flex-col border-r lg:flex"
        >
          {/* Brand + hospital identity badge */}
          <div className="border-border flex flex-col gap-0.5 border-b px-5 py-3">
            <Link
              href="/"
              className="font-display text-foreground text-body-m font-medium tracking-[-0.01em] transition-opacity hover:opacity-80"
            >
              MedSync
            </Link>
            <span
              className="text-muted-foreground truncate font-mono text-[10px] tracking-[0.12em] uppercase"
              title={scope.hospitalName}
            >
              {scope.hospitalName}
            </span>
          </div>

          {/* Nav items */}
          <nav className="flex-1 overflow-y-auto p-2">
            <ul className="stagger-children flex flex-col gap-px">
              {navItems.map((item) => (
                <li key={item.href}>
                  <HospitalSidebarItem
                    href={item.href}
                    label={item.label}
                    iconKey={item.iconKey}
                    badgeCount={item.badgeCount}
                  />
                </li>
              ))}
            </ul>
          </nav>

          {/* Admin identity + secure-session marker */}
          <div className="border-border border-t p-3">
            <div className="flex items-center gap-2.5 px-1 py-1.5">
              <div
                aria-hidden
                className="bg-plum-100 text-caption text-plum-800 flex size-7 shrink-0 items-center justify-center rounded-full font-mono font-semibold"
              >
                {adminEmail.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-[12px] font-medium">{adminEmail}</p>
                <p
                  className={cn(
                    "inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.1em] uppercase",
                    mfaActive
                      ? "text-brand-700 dark:text-brand-300"
                      : "text-amber-700 dark:text-amber-400",
                  )}
                >
                  <ShieldCheckIcon
                    className={cn(
                      "size-3",
                      mfaActive
                        ? "text-brand-600 dark:text-brand-400"
                        : "text-amber-600 dark:text-amber-400",
                    )}
                    aria-hidden
                  />
                  {mfaActive ? "MFA · AAL2" : "MFA inactive"}
                  {scope.designation ? (
                    <>
                      <span aria-hidden>·</span>
                      <span>{scope.designation}</span>
                    </>
                  ) : null}
                </p>
              </div>
            </div>
          </div>
        </aside>

        {/* ── Main column ──────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="border-border glass sticky top-0 z-30 flex h-13 items-center justify-between gap-3 border-b px-4 sm:px-6">
            {/* Mobile: hamburger → sidebar sheet + brand */}
            <div className="flex items-center gap-2.5 lg:hidden">
              <MobileSidebar
                items={navItems}
                hospitalName={scope.hospitalName}
                adminEmail={adminEmail}
              />
              <Link
                href="/hospital-admin"
                className="font-display text-foreground text-body-m font-medium tracking-[-0.01em]"
              >
                MedSync
              </Link>
            </div>

            {/* Desktop: ever-present hospital identity strip */}
            <div className="hidden min-w-0 items-center gap-2 lg:flex">
              <span
                aria-label={`Signed into the ${scope.hospitalName} admin workspace`}
                className="text-muted-foreground inline-flex min-w-0 items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] uppercase"
              >
                <span
                  aria-hidden
                  className="bg-brand-500 ring-brand-500/20 size-1.5 shrink-0 rounded-full ring-2"
                />
                <span className="truncate" title={scope.hospitalName}>
                  {scope.hospitalName}
                </span>
                <span className="text-muted-foreground/70" aria-hidden>
                  ·
                </span>
                <span className="text-muted-foreground/70">{formatLevel(scope.level)}</span>
                {scope.state !== "active" ? (
                  <>
                    <span className="text-muted-foreground/70" aria-hidden>
                      ·
                    </span>
                    <span className="text-amber-700 dark:text-amber-400">{scope.state}</span>
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
