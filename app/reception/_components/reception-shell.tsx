import type { ReceptionScope } from "@/lib/reception/scope";
import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldCheckIcon } from "lucide-react";

import { Avatar } from "@/components/medsync/avatar";
import { SIDEBAR_CLASS, SidebarSearch, SidebarWorkspace } from "@/components/medsync/sidebar-nav";
import { Tag } from "@/components/medsync/tag";
import { RECEPTION_FEATURE_AREAS, receptionFeaturePath } from "../_lib/features";
import { ReceptionCommandBar, ReceptionSidebarItem } from "./reception-sidebar-item";

const LEVEL_LABEL: Record<string, string> = {
  national_referral: "National referral",
  regional: "Regional referral",
  district: "District / General",
  hc4: "Health Centre IV",
  hc3: "Health Centre III",
  private: "Private",
};

/**
 * Reception workspace shell. Mirrors the doctor + nurse shell shape
 * with one important visual difference: the cadre pill says
 * "Reception" as a slate tag (NOT teal). The whole point of
 * this role is that it's non-clinical — the chrome reflects that.
 */
export function ReceptionShell({
  scope,
  children,
}: {
  scope: ReceptionScope;
  children: ReactNode;
}) {
  const navItems = RECEPTION_FEATURE_AREAS;

  return (
    <div className="bg-background text-foreground flex min-h-svh w-full">
      <aside aria-label="Reception workspace navigation" className={SIDEBAR_CLASS}>
        <div className="flex flex-col gap-1.5 p-2">
          <SidebarWorkspace name={scope.hospitalName} sub="Front desk" href="/reception" />
          <SidebarSearch />
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          <ul className="flex flex-col gap-0.5">
            {navItems.map((item) => (
              <li key={item.slug}>
                <ReceptionSidebarItem
                  href={receptionFeaturePath(item.slug)}
                  label={item.label}
                  iconKey={item.iconKey}
                  exact={item.slug === ""}
                />
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-sidebar-border border-t p-2">
          <div className="flex items-center gap-2 px-1.5 py-1.5">
            <Avatar name={scope.fullName ?? scope.userEmail} hue="plum" size="md" />
            <div className="min-w-0 flex-1">
              <p className="text-foreground text-label truncate">
                {scope.fullName ?? scope.userEmail}
              </p>
              <p className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
                <ShieldCheckIcon className="size-3" aria-hidden />
                MFA · AAL2
              </p>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border glass sticky top-0 z-30 flex h-12 items-center justify-between gap-3 border-b px-4 sm:px-6">
          <div className="flex items-center gap-2.5 lg:hidden">
            <Link
              href="/reception"
              className="font-display text-foreground text-body-m font-semibold"
            >
              MedSync
            </Link>
          </div>

          <div className="hidden min-w-0 items-center gap-2 lg:flex">
            <span
              aria-label={`Signed into ${scope.hospitalName} as Reception`}
              className="text-muted-foreground text-caption inline-flex min-w-0 items-center gap-1.5 font-normal"
            >
              <span className="text-foreground truncate font-medium" title={scope.hospitalName}>
                {scope.hospitalName}
              </span>
              <span className="text-muted-foreground/70" aria-hidden>
                ·
              </span>
              <span>{LEVEL_LABEL[scope.hospitalLevel] ?? scope.hospitalLevel}</span>
              <span className="text-muted-foreground/70" aria-hidden>
                ·
              </span>
              <span>Front desk</span>
            </span>
            {/* Reception cadre pill — muted on purpose: this role is
                administrative, not clinical. The chrome carries that
                signal so the staff member knows their scope at a glance. */}
            <Tag hue="slate" className="ml-2" title="Reception / Records — non-clinical scope">
              Reception · non-clinical
            </Tag>
          </div>

          <div className="flex items-center justify-end gap-3">
            <ReceptionCommandBar
              items={navItems.map((item) => ({
                href: receptionFeaturePath(item.slug),
                label: item.label,
                hint: item.hint,
                iconKey: item.iconKey,
              }))}
            />
            <Link
              href="/sign-out"
              className="text-muted-foreground hover:text-foreground text-body-s ease-expo-out underline-offset-4 transition-colors duration-150 hover:underline"
            >
              Sign out
            </Link>
          </div>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
