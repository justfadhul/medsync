import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { ArrowUpRightIcon, BuildingIcon, StethoscopeIcon, UserIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Single source of truth for the three audience doors. Edit copy here and
 * every CTA on the page updates: hero, mid-band, final CTA band, footer.
 *
 * Routes to the per-path signup stubs at /signup/{patient,clinical,
 * hospital} (GATE A scaffold). The real multi-step forms ship in
 * gates C / D / E. The intent selector at /get-started exists for
 * users who arrive without a chosen audience.
 */
export const ONBOARDING_DOORS: ReadonlyArray<{
  audience: "patient" | "clinical" | "hospital";
  label: string;
  sub: string;
  href: string;
  Icon: LucideIcon;
}> = [
  {
    audience: "patient",
    label: "I'm a patient",
    sub: "Sign up — active immediately",
    href: "/signup/patient",
    Icon: UserIcon,
  },
  {
    audience: "clinical",
    label: "I'm a clinician",
    sub: "Sign up — approval-gated",
    href: "/signup/clinical",
    Icon: StethoscopeIcon,
  },
  {
    audience: "hospital",
    label: "I represent a hospital",
    sub: "Apply for a pilot",
    href: "/signup/hospital",
    Icon: BuildingIcon,
  },
];

type Tone = "light" | "dark";
type Layout = "doors" | "inline" | "pills";

interface OnboardingCtaClusterProps {
  layout?: Layout;
  tone?: Tone;
  className?: string;
}

/**
 * Three equal-weight audience doors. No primary — the spec forbids
 * picking a hero CTA. Variants:
 *
 *   - "doors":  hero / mid-band / final — large card-style buttons,
 *     icon + label + sub, animated arrow on hover
 *   - "inline": compact button row, e.g. in the sub-banner
 *   - "pills":  the smallest variant, e.g. footer
 */
export function OnboardingCtaCluster({
  layout = "doors",
  tone = "light",
  className,
}: OnboardingCtaClusterProps) {
  if (layout === "doors") {
    return (
      <ul role="list" className={cn("grid w-full gap-3 sm:grid-cols-3 sm:gap-4", className)}>
        {ONBOARDING_DOORS.map(({ audience, label, sub, href, Icon }) => (
          <li key={audience}>
            <Link
              href={href}
              className={cn(
                "group relative flex h-full flex-col gap-3 overflow-hidden rounded-lg p-4 sm:p-5",
                "ease-expo-out transition-all duration-200",
                tone === "light"
                  ? "border-border bg-card border hover:border-teal-300 hover:bg-teal-50/50 dark:hover:bg-teal-50/20"
                  : "border border-teal-300/20 bg-white/[0.03] backdrop-blur hover:border-teal-200/60 hover:bg-teal-300/10",
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "flex size-9 items-center justify-center rounded-md",
                    tone === "light"
                      ? "bg-teal-50 text-teal-700 group-hover:bg-teal-100 group-hover:text-teal-800"
                      : "bg-white/5 text-teal-200 group-hover:bg-teal-300/15 group-hover:text-teal-100",
                  )}
                >
                  <Icon className="size-4" strokeWidth={1.75} />
                </span>
                <ArrowUpRightIcon
                  className={cn(
                    "ease-expo-out size-4 transition-transform duration-200",
                    "group-hover:translate-x-0.5 group-hover:-translate-y-0.5",
                    tone === "light"
                      ? "text-muted-foreground group-hover:text-teal-700"
                      : "text-teal-200/60 group-hover:text-teal-100",
                  )}
                  strokeWidth={1.5}
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <span
                  className={cn(
                    "font-display text-[18px] leading-tight font-medium",
                    tone === "light" ? "text-foreground" : "text-white",
                  )}
                >
                  {label}
                </span>
                <span
                  className={cn(
                    "text-[13px]",
                    tone === "light" ? "text-muted-foreground" : "text-teal-100/70",
                  )}
                >
                  {sub}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  if (layout === "inline") {
    return (
      <div className={cn("inline-flex flex-wrap items-center justify-center gap-1.5", className)}>
        {ONBOARDING_DOORS.map(({ audience, label, href, Icon }) => (
          <Link
            key={audience}
            href={href}
            className={cn(
              "group inline-flex items-center gap-1.5 rounded-full px-3 py-1.5",
              "text-[13px] transition-colors duration-150",
              tone === "light"
                ? "border-border bg-background border hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800"
                : "border border-white/10 bg-white/[0.04] text-white/80 hover:border-teal-300/50 hover:bg-white/[0.08] hover:text-white",
            )}
          >
            <Icon className="size-3.5" strokeWidth={1.75} />
            <span>{label}</span>
          </Link>
        ))}
      </div>
    );
  }

  return (
    <ul role="list" className={cn("flex flex-wrap items-center gap-x-5 gap-y-2", className)}>
      {ONBOARDING_DOORS.map(({ audience, label, href }) => (
        <li key={audience}>
          <Link
            href={href}
            className={cn(
              "text-[13px] transition-colors duration-150",
              tone === "light"
                ? "text-muted-foreground hover:text-foreground"
                : "text-white/60 hover:text-white",
            )}
          >
            {label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
