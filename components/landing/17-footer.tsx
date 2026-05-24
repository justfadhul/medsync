import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * §17 — Footer.
 *
 * Fat multi-column footer: brand + about · audience doors · platform
 * anchors · trust + governance · legal. NO social-media handles (none
 * to claim yet — we'll add when we make real accounts). Legal links
 * point to clearly-marked placeholders until we have lawyer-reviewed
 * pages. Standards chips repeated from §06 as a closing trust signal.
 */

interface FooterColumn {
  label: string;
  links: Array<{ label: string; href: string; note?: string; external?: boolean }>;
}

const COLUMNS: FooterColumn[] = [
  {
    label: "Audience doors",
    links: [
      { label: "For patients", href: "/onboarding/patient" },
      { label: "For clinicians", href: "/onboarding/clinical" },
      { label: "For hospitals", href: "/onboarding/hospital" },
      { label: "Sign in", href: "/sign-in" },
    ],
  },
  {
    label: "Platform",
    links: [
      { label: "The closed-loop record", href: "/#adaptive-model" },
      { label: "Five-step care loop", href: "/#platform-showcase" },
      { label: "Patient record", href: "/#enrichment" },
      { label: "Uganda care ecosystem", href: "/#ecosystem" },
    ],
  },
  {
    label: "Built for Uganda",
    links: [
      { label: "Capabilities", href: "/#uganda" },
      { label: "Trust + governance", href: "/#trust" },
      { label: "Founding story", href: "/#founding-story" },
      { label: "Vision · horizons", href: "/#vision" },
    ],
  },
  {
    label: "Legal & status",
    links: [
      { label: "FAQ", href: "/#faq" },
      { label: "Privacy", href: "#", note: "in legal review" },
      { label: "Terms", href: "#", note: "in legal review" },
      { label: "Status", href: "#", note: "coming soon" },
    ],
  },
];

// Pharmacy regulator: National Pharmacy Board (statutory). The
// previously-listed PSU is a professional association, not the
// regulator — kept here as a historical note so the correction
// doesn't get reverted by autocomplete.
const STANDARDS = [
  { abbr: "UMDPC", full: "Uganda Medical and Dental Practitioners Council" },
  { abbr: "UNMC", full: "Uganda Nurses and Midwives Council" },
  { abbr: "AHPC", full: "Allied Health Professionals Council" },
  { abbr: "Pharmacy Board", full: "National Pharmacy Board" },
] as const;

export function Footer() {
  return (
    <footer aria-label="Site footer" className="border-border bg-muted/30 relative w-full border-t">
      <div className="mx-auto w-full max-w-300 px-5 py-14 sm:px-8 sm:py-20">
        {/* Top — brand + columns */}
        <div className="grid gap-10 md:grid-cols-12 md:gap-12">
          {/* Brand */}
          <div className="flex flex-col gap-4 md:col-span-4">
            <Link
              href="/"
              className="flex items-baseline gap-0.5 transition-opacity hover:opacity-80"
              aria-label="MedSync — home"
            >
              <span className="font-display text-foreground text-[22px] leading-none font-medium tracking-tight">
                MedSync
              </span>
              <span className="size-1.5 translate-y-[-2px] rounded-full bg-teal-500 dark:bg-teal-400" />
            </Link>
            <p className="text-muted-foreground max-w-[44ch] text-[13px] leading-[1.55]">
              A digital hospital operating system for Uganda. Built for hospitals up to
              national-referral scale, and to keep care going after patients leave the gate.
            </p>
            <p className="text-muted-foreground tabular inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase">
              <span className="size-1 rounded-full bg-teal-500" />
              Kampala &middot; Uganda
            </p>
          </div>

          {/* Link columns */}
          <nav className="grid grid-cols-2 gap-8 md:col-span-8 md:grid-cols-4" aria-label="Footer">
            {COLUMNS.map((col) => (
              <div key={col.label} className="flex flex-col gap-2.5">
                <span className="text-muted-foreground font-mono text-[10px] tracking-[0.18em] uppercase">
                  {col.label}
                </span>
                <ul role="list" className="flex flex-col gap-1.5">
                  {col.links.map((link) => (
                    <li key={link.label + link.href}>
                      <Link
                        href={link.href}
                        className={cn(
                          "text-foreground/85 hover:text-foreground inline-flex items-center gap-1.5 text-[12.5px] transition-colors",
                          link.note ? "pointer-events-none opacity-70" : "",
                        )}
                      >
                        {link.label}
                        {link.note ? (
                          <span className="text-muted-foreground font-mono text-[9.5px] tracking-[0.15em] uppercase italic">
                            ({link.note})
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* Standards strip */}
        <div className="border-border mt-12 flex flex-wrap items-center gap-3 border-t pt-6">
          <span className="text-muted-foreground font-mono text-[10px] tracking-[0.18em] uppercase">
            Designed to comply with
          </span>
          <ul role="list" className="flex flex-wrap items-center gap-1.5">
            {STANDARDS.map((s) => (
              <li key={s.abbr}>
                <span
                  title={s.full}
                  className="border-border bg-card text-foreground/85 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]"
                >
                  <span className="size-1 rounded-full bg-teal-500" />
                  <span className="font-mono tracking-[0.12em]">{s.abbr}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Bottom — copyright + DPA */}
        <div className="border-border mt-6 flex flex-wrap items-baseline justify-between gap-3 border-t pt-5 text-[11px]">
          <p className="text-muted-foreground">&copy; 2026 MedSync. All rights reserved.</p>
          <p className="text-muted-foreground/80 italic">
            Sample data on this page is fictional. No real patients, no real identifiers. Built in
            compliance with the{" "}
            <span className="text-foreground/80 not-italic">
              Uganda Data Protection and Privacy Act 2019
            </span>
            .
          </p>
        </div>
      </div>
    </footer>
  );
}
