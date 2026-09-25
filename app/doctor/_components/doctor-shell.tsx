import type { DoctorScope } from "@/lib/doctor/scope";
import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldCheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { DOCTOR_FEATURE_AREAS, doctorFeaturePath, WORKSPACE_NAV } from "../_lib/features";
import { DoctorSidebarItem } from "./doctor-sidebar-item";
import { EmergencyInlineLink } from "./emergency-inline-link";
import { FullBleedGate } from "./full-bleed-gate";

/**
 * Doctor workspace shell — sidebar + top bar + main slot.
 *
 * Modelled on the hospital-admin shell (same 240px sidebar + 52px
 * top bar). Differences worth noting:
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

  const initial = (scope.fullName ?? scope.userEmail).slice(0, 1).toUpperCase();

  return (
    <div className="bg-background text-foreground flex min-h-svh w-full">
      {/* ── Sidebar (hidden full-bleed on the bedside desks) ─────────── */}
      <FullBleedGate>
        <aside
          aria-label="Doctor workspace navigation"
          className="bg-muted/40 border-border relative hidden w-[240px] shrink-0 flex-col border-r lg:flex"
        >
          {/* Quiet plum atmosphere at the top of the rail — place, not state */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-[radial-gradient(120%_100%_at_50%_0%,rgba(159,47,126,0.07),transparent_70%)]"
          />

          {/* Brand + hospital identity */}
          <div className="border-border relative flex flex-col gap-1 border-b px-5 py-3.5">
            <Link
              href="/"
              className="group inline-flex w-fit items-center gap-2 transition-opacity hover:opacity-90"
            >
              <BrandMark />
              <span className="font-display text-foreground text-body-m font-medium tracking-[-0.01em]">
                MedSync
              </span>
            </Link>
            <span
              className="text-muted-foreground truncate pl-6.5 font-mono text-[10px] tracking-[0.12em] uppercase"
              title={scope.hospitalName}
            >
              {scope.hospitalName}
            </span>
          </div>

          {/* Nav */}
          <nav className="relative flex-1 overflow-y-auto p-2">
            <ul className="stagger-children flex flex-col gap-px">
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
          <div className="border-border relative border-t p-3">
            <Link
              href="/doctor/profile"
              aria-label="Your profile"
              className="hover:bg-muted/60 focus-visible:shadow-focus flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors duration-200 outline-none"
            >
              {avatarUrl ? (
                // Signed Storage URLs are not on next/image's allowlist.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt=""
                  className="ring-border size-7 shrink-0 rounded-full object-cover ring-1"
                />
              ) : (
                <div
                  aria-hidden
                  className="bg-plum-100 text-caption text-plum-800 ring-plum-200/70 flex size-7 shrink-0 items-center justify-center rounded-full font-mono font-semibold ring-1"
                >
                  {initial}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-[12px] font-medium">
                  {scope.fullName ?? scope.userEmail}
                </p>
                <p className="text-muted-foreground inline-flex items-center gap-1 font-mono text-[10px] tracking-widest uppercase">
                  <ShieldCheckIcon
                    className="text-brand-600 dark:text-brand-400 size-3"
                    aria-hidden
                  />
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
          <header className="border-border glass sticky top-0 z-30 flex h-13 items-center justify-between gap-3 border-b px-4 sm:px-6">
            {/* Mobile: brand only (mobile drawer ships later) */}
            <div className="flex items-center gap-2.5 lg:hidden">
              <Link href="/doctor" className="inline-flex items-center gap-2">
                <BrandMark />
                <span className="font-display text-foreground text-body-m font-medium tracking-[-0.01em]">
                  MedSync
                </span>
              </Link>
            </div>

            {/* Desktop: hospital + cadre identity pills */}
            <div className="hidden min-w-0 items-center gap-2 lg:flex">
              <span
                aria-label={`Signed into ${scope.hospitalName} as ${CADRE_LABEL[scope.cadreCode] ?? scope.cadreCode}`}
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
                  "ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] tracking-[0.12em] uppercase",
                  scope.isJunior
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                    : "bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200",
                )}
                title={`Cadre: ${CADRE_LABEL[scope.cadreCode] ?? scope.cadreCode}`}
              >
                {CADRE_LABEL[scope.cadreCode] ?? scope.cadreCode}
              </span>
            </div>

            <div className="flex items-center justify-end gap-3">
              {workspace ? <EmergencyInlineLink /> : null}
              <Link
                href="/sign-out"
                className="text-muted-foreground hover:text-foreground decoration-border text-[12px] underline-offset-4 transition-colors hover:underline"
              >
                Sign out
              </Link>
            </div>
          </header>
        </FullBleedGate>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

/**
 * The MedSync brand mark — a teal tile carrying a single drawn pulse.
 * `medsync-forced-dark` pins the teal scale so the white trace stays
 * readable when the theme inverts.
 */
function BrandMark() {
  return (
    <span
      aria-hidden
      className="medsync-forced-dark ease-spring bg-brand-600 grid size-4.5 shrink-0 place-items-center rounded-[5px] text-white shadow-sm transition-transform duration-200 group-hover:scale-110"
    >
      <svg viewBox="0 0 16 16" fill="none" className="size-3">
        <path
          d="M1.5 8.5h3l1.5-4 2.5 7 2-5 1 2h3"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
