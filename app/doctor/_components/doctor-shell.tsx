import type { DoctorScope } from "@/lib/doctor/scope";
import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldCheckIcon } from "lucide-react";

import { Avatar } from "@/components/medsync/avatar";
import { SIDEBAR_CLASS, SidebarSearch, SidebarWorkspace } from "@/components/medsync/sidebar-nav";
import { SignOutButton } from "@/components/medsync/sign-out-button";
import { Tag } from "@/components/medsync/tag";
import { DOCTOR_FEATURE_AREAS, doctorFeaturePath, WORKSPACE_NAV } from "../_lib/features";
import { DoctorCommandBar, DoctorSidebarItem } from "./doctor-sidebar-item";
import { EmergencyInlineLink } from "./emergency-inline-link";
import { FullBleedGate } from "./full-bleed-gate";

/**
 * Doctor workspace shell — sidebar + top bar + main slot.
 *
 * MedSync Chroma shell (ADR 0162): the shared 248px sidebar with the
 * facility mark, ⌘K search and domain-tiled items, and a 48px top bar.
 * Differences worth noting:
 *
 *   - The top bar carries a CADRE pill alongside the hospital pill.
 *     A doctor must never be ambiguous about "who am I, where, and
 *     under what scope" — it gates every action they can take.
 *   - The sidebar filters features by cadre: the "Review queue" only
 *     appears for senior cadres (MO+); "Supervisees" only for
 *     consultant-level (MOSG / Consultant / Senior Consultant).
 *   - The shell stays server-rendered; only sidebar active-state is
 *     client (pathname).
 *
 * The mobile sidebar is intentionally NOT shipped in GATE B —
 * doctors work on desktops/laptops primarily. The responsive pass
 * adds a mobile drawer later if a doctor opens on a phone.
 */

const CADRE_LABEL: Record<string, string> = {
  INTERN_DOCTOR: "Intern Doctor",
  CLINICAL_OFFICER: "Clinical Officer",
  MEDICAL_OFFICER: "Medical Officer",
  MEDICAL_OFFICER_SG: "MO Special Grade",
  CONSULTANT: "Consultant",
  SENIOR_CONSULTANT: "Senior Consultant",
};

const LEVEL_LABEL: Record<string, string> = {
  national_referral: "National referral",
  regional: "Regional referral",
  district: "District / General",
  hc4: "Health Centre IV",
  hc3: "Health Centre III",
  private: "Private",
};

export function DoctorShell({
  scope,
  avatarUrl,
  workspace = false,
  children,
}: {
  scope: DoctorScope;
  /** Signed URL of the doctor's photo, or null → the initial disc. */
  avatarUrl: string | null;
  /** The doctor workspace is on for this hospital: three nav items, Emergency in the header. */
  workspace?: boolean;
  children: ReactNode;
}) {
  const navItems = workspace
    ? WORKSPACE_NAV
    : DOCTOR_FEATURE_AREAS.filter((f) => {
        if (f.visibleTo === "senior") return scope.isSenior;
        if (f.visibleTo === "consultant") return scope.isConsultantLevel;
        return true;
      });

  return (
    <div className="bg-background text-foreground flex min-h-svh w-full">
      {/* ── Sidebar (hidden full-bleed on the bedside desks) ─────────── */}
      <FullBleedGate>
        <aside aria-label="Doctor workspace navigation" className={SIDEBAR_CLASS}>
          <div className="flex flex-col gap-1.5 p-2">
            <SidebarWorkspace name={scope.hospitalName} sub="Doctor workspace" href="/doctor" />
            <SidebarSearch />
          </div>

          {/* Nav */}
          <nav className="flex-1 overflow-y-auto px-2 pb-2">
            <ul className="flex flex-col gap-0.5">
              {navItems.map((item) => (
                <li key={item.slug}>
                  <DoctorSidebarItem
                    href={doctorFeaturePath(item.slug)}
                    label={item.label}
                    iconKey={item.iconKey}
                    placeholder={item.placeholder}
                    exact={item.slug === ""}
                  />
                </li>
              ))}
            </ul>
          </nav>

          {/* Identity + cadre → /doctor/profile (photo lives there) */}
          <div className="border-sidebar-border border-t p-2">
            <Link
              href="/doctor/profile"
              aria-label="Your profile"
              className="hover:bg-ink-100 focus-visible:shadow-focus flex items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors duration-100 outline-none"
            >
              {avatarUrl ? (
                // Signed Storage URLs are not on next/image's allowlist.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt=""
                  className="ring-border size-8 shrink-0 rounded-full object-cover ring-1"
                />
              ) : (
                <Avatar name={scope.fullName ?? scope.userEmail} hue="iris" size="md" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-label truncate">
                  {scope.fullName ?? scope.userEmail}
                </p>
                <p className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
                  <ShieldCheckIcon className="size-3" aria-hidden />
                  MFA · AAL2
                </p>
              </div>
            </Link>
          </div>
        </aside>
      </FullBleedGate>

      {/* ── Main column ──────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar (hidden full-bleed on the bedside desks) */}
        <FullBleedGate>
          <header className="border-border glass sticky top-0 z-30 flex h-12 items-center justify-between gap-3 border-b px-4 sm:px-6">
            {/* Mobile: brand only (mobile drawer ships later) */}
            <div className="flex items-center gap-2.5 lg:hidden">
              <Link
                href="/doctor"
                className="font-display text-foreground text-body-m font-semibold"
              >
                MedSync
              </Link>
            </div>

            {/* Desktop: hospital + cadre identity pills */}
            <div className="hidden min-w-0 items-center gap-2 lg:flex">
              <span
                aria-label={`Signed into ${scope.hospitalName} as ${CADRE_LABEL[scope.cadreCode] ?? scope.cadreCode}`}
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
              {/* The cadre is who you are, not a clinical state: an iris tag, never amber. */}
              <Tag
                hue="iris"
                className="ml-2"
                title={`Cadre: ${CADRE_LABEL[scope.cadreCode] ?? scope.cadreCode}`}
              >
                {CADRE_LABEL[scope.cadreCode] ?? scope.cadreCode}
              </Tag>
            </div>

            <div className="flex items-center justify-end gap-3">
              <DoctorCommandBar
                items={navItems.map((item) => ({
                  href: doctorFeaturePath(item.slug),
                  label: item.label,
                  hint: item.hint,
                  iconKey: item.iconKey,
                }))}
              />
              {workspace ? <EmergencyInlineLink /> : null}
              <Link
                href="/accounts"
                className="text-muted-foreground hover:text-foreground decoration-border text-[12px] underline-offset-4 transition-colors hover:underline"
              >
                Switch account
              </Link>
              <SignOutButton className="text-muted-foreground hover:text-foreground decoration-border text-[12px] underline-offset-4 transition-colors hover:underline" />
            </div>
          </header>
        </FullBleedGate>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
