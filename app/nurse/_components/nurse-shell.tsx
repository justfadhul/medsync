import type { NurseScope } from "@/lib/nurse/scope";
import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldCheckIcon } from "lucide-react";

import { Avatar } from "@/components/medsync/avatar";
import { SIDEBAR_CLASS, SidebarSearch, SidebarWorkspace } from "@/components/medsync/sidebar-nav";
import { SignOutButton } from "@/components/medsync/sign-out-button";
import { Tag } from "@/components/medsync/tag";
import { NURSE_FEATURE_AREAS, nurseFeaturePath } from "../_lib/features";
import { NurseCommandBar, NurseSidebarItem } from "./nurse-sidebar-item";
import { SidebarGate } from "./sidebar-gate";

const CADRE_LABEL: Record<string, string> = {
  NURSE: "Nurse",
  MIDWIFE: "Midwife",
  SPECIALIST_NURSE: "Specialist Nurse",
};

const GRADE_LABEL: Record<string, string> = {
  ENROLLED: "Enrolled",
  REGISTERED: "Registered",
  SPECIALIST: "Specialist",
};

const LEVEL_LABEL: Record<string, string> = {
  national_referral: "National referral",
  regional: "Regional referral",
  district: "District / General",
  hc4: "Health Centre IV",
  hc3: "Health Centre III",
  private: "Private",
};

/**
 * Nurse workspace shell. Mirrors the doctor shell architecture (MedSync
 * Chroma, ADR 0162): 248px sidebar (lg+), 48px top bar with hospital + cadre/grade +
 * in-charge pills, persistent identity. The cadre + grade pills are
 * the operational anchor — a nurse must always know their scope.
 *
 * Sidebar filters features by:
 *   - 'in_charge'    visible only when scope.isInCharge
 *   - 'registered+'  visible when scope.isRegistered || scope.isSpecialist
 */
export function NurseShell({
  scope,
  flags = { wardBuilder: false },
  children,
}: {
  scope: NurseScope;
  /** Feature flags for this hospital (the Bed board is behind WARD_BUILDER). */
  flags?: { wardBuilder: boolean };
  children: ReactNode;
}) {
  const navItems = NURSE_FEATURE_AREAS.filter((f) => {
    if (f.flag === "ward_builder" && !flags.wardBuilder) return false;
    if (f.visibleTo === "in_charge") return scope.isInCharge;
    if (f.visibleTo === "registered+") return scope.isRegistered || scope.isSpecialist;
    return true;
  });

  const cadreLabel = CADRE_LABEL[scope.cadreCode] ?? scope.cadreCode;
  const gradeLabel = scope.cadreGradeCode ? GRADE_LABEL[scope.cadreGradeCode] : null;
  const cadrePill = gradeLabel ? `${gradeLabel} ${cadreLabel}` : cadreLabel;

  return (
    <div className="bg-background text-foreground flex min-h-svh w-full">
      <SidebarGate>
        <aside aria-label="Nurse workspace navigation" className={SIDEBAR_CLASS}>
          <div className="flex flex-col gap-1.5 p-2">
            <SidebarWorkspace name={scope.hospitalName} sub="Nursing workspace" href="/nurse" />
            <SidebarSearch />
          </div>

          <nav className="flex-1 overflow-y-auto px-2 pb-2">
            <ul className="flex flex-col gap-0.5">
              {navItems.map((item) => (
                <li key={item.slug}>
                  <NurseSidebarItem
                    href={nurseFeaturePath(item.slug)}
                    label={item.label}
                    iconKey={item.iconKey}
                    placeholder={item.placeholder}
                    exact={item.slug === ""}
                  />
                </li>
              ))}
            </ul>
          </nav>

          <div className="border-sidebar-border border-t p-2">
            <div className="flex items-center gap-2 px-1.5 py-1.5">
              <Avatar name={scope.fullName ?? scope.userEmail} hue="iris" size="md" />
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
      </SidebarGate>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border glass sticky top-0 z-30 flex h-12 items-center justify-between gap-3 border-b px-4 sm:px-6">
          <div className="flex items-center gap-2.5 lg:hidden">
            <Link href="/nurse" className="font-display text-foreground text-body-m font-semibold">
              MedSync
            </Link>
          </div>

          <div className="hidden min-w-0 items-center gap-2 lg:flex">
            <span
              aria-label={`Signed into ${scope.hospitalName} as ${cadrePill}`}
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
              <span className="truncate">{scope.departmentName}</span>
            </span>
            {/* Cadre and in-charge say who you are, not a clinical state: tags, never amber. */}
            <Tag hue="iris" className="ml-2" title={`Cadre: ${cadrePill}`}>
              {cadrePill}
            </Tag>
            {scope.isInCharge ? (
              <Tag hue="plum" title="You are currently ward in-charge">
                In-charge
              </Tag>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-3">
            <NurseCommandBar
              items={navItems.map((item) => ({
                href: nurseFeaturePath(item.slug),
                label: item.label,
                iconKey: item.iconKey,
              }))}
            />
            <Link
              href="/accounts"
              className="text-muted-foreground hover:text-foreground text-[12px] underline-offset-4 transition-colors hover:underline"
            >
              Switch account
            </Link>
            <SignOutButton className="text-muted-foreground hover:text-foreground text-[12px] underline-offset-4 transition-colors hover:underline" />
          </div>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
