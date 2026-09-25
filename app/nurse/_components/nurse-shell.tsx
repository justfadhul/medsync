import type { NurseScope } from "@/lib/nurse/scope";
import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldCheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { NURSE_FEATURE_AREAS, nurseFeaturePath } from "../_lib/features";
import { NurseSidebarItem } from "./nurse-sidebar-item";
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
 * Nurse workspace shell. Mirrors the doctor shell architecture:
 * 240px sidebar (lg+), 52px top bar with hospital + cadre/grade +
 * in-charge pills, persistent identity. The cadre + grade pills are
 * the operational anchor — a nurse must always know their scope.
 *
 * Sidebar filters features by:
 *   - 'in_charge'    visible only when scope.isInCharge
 *   - 'registered+'  visible when scope.isRegistered || scope.isSpecialist
 */
export function NurseShell({ scope, children }: { scope: NurseScope; children: ReactNode }) {
  const navItems = NURSE_FEATURE_AREAS.filter((f) => {
    if (f.visibleTo === "in_charge") return scope.isInCharge;
    if (f.visibleTo === "registered+") return scope.isRegistered || scope.isSpecialist;
    return true;
  });

  const initial = (scope.fullName ?? scope.userEmail).slice(0, 1).toUpperCase();
  const cadreLabel = CADRE_LABEL[scope.cadreCode] ?? scope.cadreCode;
  const gradeLabel = scope.cadreGradeCode ? GRADE_LABEL[scope.cadreGradeCode] : null;
  const cadrePill = gradeLabel ? `${gradeLabel} ${cadreLabel}` : cadreLabel;

  return (
    <div className="bg-background text-foreground flex min-h-svh w-full">
      <SidebarGate>
        <aside
          aria-label="Nurse workspace navigation"
          className="bg-muted/40 border-border hidden w-[240px] shrink-0 flex-col border-r lg:flex"
        >
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

          <nav className="flex-1 overflow-y-auto p-2">
            <ul className="flex flex-col gap-px">
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

          <div className="border-border border-t p-3">
            <div className="flex items-center gap-2.5 px-1 py-1.5">
              <div
                aria-hidden
                className="bg-plum-100 text-caption text-plum-800 flex size-7 shrink-0 items-center justify-center rounded-full font-mono font-semibold"
              >
                {initial}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-[12px] font-medium">
                  {scope.fullName ?? scope.userEmail}
                </p>
                <p className="text-muted-foreground inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.1em] uppercase">
                  <ShieldCheckIcon
                    className="text-brand-600 dark:text-brand-400 size-3"
                    aria-hidden
                  />
                  MFA · AAL2
                </p>
              </div>
            </div>
          </div>
        </aside>
      </SidebarGate>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border glass sticky top-0 z-30 flex h-[52px] items-center justify-between gap-3 border-b px-4 sm:px-6">
          <div className="flex items-center gap-2.5 lg:hidden">
            <Link
              href="/nurse"
              className="font-display text-foreground text-body-m font-medium tracking-[-0.01em]"
            >
              MedSync
            </Link>
          </div>

          <div className="hidden min-w-0 items-center gap-2 lg:flex">
            <span
              aria-label={`Signed into ${scope.hospitalName} as ${cadrePill}`}
              className="text-muted-foreground inline-flex min-w-0 items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] uppercase"
            >
              <span
                aria-hidden
                className="pulse-dot bg-brand-500 ring-brand-500/20 size-1.5 shrink-0 rounded-full ring-2"
              />
              <span className="truncate" title={scope.hospitalName}>
                {scope.hospitalName}
              </span>
              <span className="text-muted-foreground/70" aria-hidden>
                ·
              </span>
              <span className="text-muted-foreground/70">
                {LEVEL_LABEL[scope.hospitalLevel] ?? scope.hospitalLevel}
              </span>
              <span className="text-muted-foreground/70" aria-hidden>
                ·
              </span>
              <span className="truncate">{scope.departmentName}</span>
            </span>
            <span
              className={cn(
                "scale-in ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] tracking-[0.12em] uppercase",
                scope.isEnrolled
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                  : "bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200",
              )}
              title={`Cadre: ${cadrePill}`}
            >
              {cadrePill}
            </span>
            {scope.isInCharge ? (
              <span
                className="scale-in inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 font-mono text-[10px] tracking-[0.12em] text-blue-800 uppercase dark:bg-blue-900/40 dark:text-blue-200"
                style={{ animationDelay: "80ms" }}
                title="You are currently ward in-charge"
              >
                In-charge
              </span>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-3">
            <Link
              href="/sign-out"
              className="text-muted-foreground hover:text-foreground text-[12px] underline-offset-4 transition-colors hover:underline"
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
