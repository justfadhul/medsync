import type { ClinicalStatus } from "@/components/medsync/clinical-badge";
import type { Metadata } from "next";
import Link from "next/link";

import { MyHealthMock } from "@/components/landing/_my-health-mock";
import { ClinicalBadge } from "@/components/medsync/clinical-badge";
import { ClinicalPath } from "@/components/medsync/clinical-path";
import { SectionNumber } from "@/components/medsync/section-number";
import { VitalStat } from "@/components/medsync/vital-stat";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { CalendarDemo } from "./_components/calendar-demo";

export const metadata: Metadata = {
  title: "Design system",
  description:
    "Visual contract for MedSync — colors, typography, primitives, and clinical patterns.",
};

// ─── Data ────────────────────────────────────────────────────────────────

type SwatchSpec = {
  name: string;
  hex: string;
  /** Whether to use dark text on this swatch (true = bg is light enough). */
  textOnLight: boolean;
};

const lightNeutralScale: ReadonlyArray<SwatchSpec> = [
  { name: "black", hex: "#000000", textOnLight: false },
  { name: "gray-950", hex: "#0A0A0A", textOnLight: false },
  { name: "gray-900", hex: "#171717", textOnLight: false },
  { name: "gray-800", hex: "#262626", textOnLight: false },
  { name: "gray-700", hex: "#404040", textOnLight: false },
  { name: "gray-600", hex: "#525252", textOnLight: false },
  { name: "gray-500", hex: "#737373", textOnLight: false },
  { name: "gray-400", hex: "#A3A3A3", textOnLight: true },
  { name: "gray-300", hex: "#D4D4D4", textOnLight: true },
  { name: "gray-200", hex: "#E5E5E5", textOnLight: true },
  { name: "gray-150", hex: "#EFEFEF", textOnLight: true },
  { name: "gray-100", hex: "#F5F5F5", textOnLight: true },
  { name: "gray-50", hex: "#FAFAFA", textOnLight: true },
  { name: "white", hex: "#FFFFFF", textOnLight: true },
];

const darkNeutralScale: ReadonlyArray<SwatchSpec> = [
  { name: "neutral-0", hex: "#0A0A0A", textOnLight: false },
  { name: "neutral-50", hex: "#111111", textOnLight: false },
  { name: "neutral-100", hex: "#171717", textOnLight: false },
  { name: "neutral-150", hex: "#1E1E1E", textOnLight: false },
  { name: "neutral-200", hex: "#262626", textOnLight: false },
  { name: "neutral-300", hex: "#404040", textOnLight: false },
  { name: "neutral-400", hex: "#525252", textOnLight: false },
  { name: "neutral-500", hex: "#737373", textOnLight: false },
  { name: "neutral-600", hex: "#A3A3A3", textOnLight: true },
  { name: "neutral-700", hex: "#D4D4D4", textOnLight: true },
  { name: "neutral-800", hex: "#E5E5E5", textOnLight: true },
  { name: "neutral-900", hex: "#F5F5F5", textOnLight: true },
  { name: "neutral-950", hex: "#FAFAFA", textOnLight: true },
];

const lightBrandScale: ReadonlyArray<SwatchSpec> = [
  { name: "brand-50", hex: "#F0FDFA", textOnLight: true },
  { name: "brand-100", hex: "#CCFBF1", textOnLight: true },
  { name: "brand-200", hex: "#99F6E4", textOnLight: true },
  { name: "brand-300", hex: "#5EEAD4", textOnLight: true },
  { name: "brand-400", hex: "#2DD4BF", textOnLight: true },
  { name: "brand-500", hex: "#14B8A6", textOnLight: false },
  { name: "brand-600", hex: "#0D9488", textOnLight: false },
  { name: "brand-700", hex: "#0F766E", textOnLight: false },
  { name: "brand-800", hex: "#115E59", textOnLight: false },
  { name: "brand-900", hex: "#134E4A", textOnLight: false },
  { name: "brand-950", hex: "#042F2E", textOnLight: false },
];

const darkBrandScale: ReadonlyArray<SwatchSpec> = [
  { name: "brand-50", hex: "#042F2E", textOnLight: false },
  { name: "brand-100", hex: "#064E45", textOnLight: false },
  { name: "brand-200", hex: "#0F766E", textOnLight: false },
  { name: "brand-300", hex: "#0D9488", textOnLight: false },
  { name: "brand-400", hex: "#14B8A6", textOnLight: false },
  { name: "brand-500", hex: "#2DD4BF", textOnLight: true },
  { name: "brand-600", hex: "#5EEAD4", textOnLight: true },
  { name: "brand-700", hex: "#99F6E4", textOnLight: true },
  { name: "brand-800", hex: "#CCFBF1", textOnLight: true },
  { name: "brand-900", hex: "#F0FDFA", textOnLight: true },
  { name: "brand-950", hex: "#F0FDFA", textOnLight: true },
];

/** Plum — the secondary accent (ADR 0097). Place, never state. */
const lightPlumScale: ReadonlyArray<SwatchSpec> = [
  { name: "plum-50", hex: "#FDF3F9", textOnLight: true },
  { name: "plum-100", hex: "#FEE4F3", textOnLight: true },
  { name: "plum-200", hex: "#FECBE9", textOnLight: true },
  { name: "plum-300", hex: "#FEA2DC", textOnLight: true },
  { name: "plum-400", hex: "#EA7BC4", textOnLight: true },
  { name: "plum-500", hex: "#C953A3", textOnLight: false },
  { name: "plum-600", hex: "#9F2F7E", textOnLight: false },
  { name: "plum-700", hex: "#87236A", textOnLight: false },
  { name: "plum-800", hex: "#6A1952", textOnLight: false },
  { name: "plum-900", hex: "#4E113C", textOnLight: false },
  { name: "plum-950", hex: "#321227", textOnLight: false },
];

const darkPlumScale: ReadonlyArray<SwatchSpec> = [
  { name: "plum-50", hex: "#321227", textOnLight: false },
  { name: "plum-100", hex: "#4A173A", textOnLight: false },
  { name: "plum-200", hex: "#671E51", textOnLight: false },
  { name: "plum-300", hex: "#862E6B", textOnLight: false },
  { name: "plum-400", hex: "#A94088", textOnLight: false },
  { name: "plum-500", hex: "#CB58A6", textOnLight: true },
  { name: "plum-600", hex: "#ED85C8", textOnLight: true },
  { name: "plum-700", hex: "#FDA8DD", textOnLight: true },
  { name: "plum-800", hex: "#FFCDEB", textOnLight: true },
  { name: "plum-900", hex: "#FDE7F4", textOnLight: true },
  { name: "plum-950", hex: "#FDF3F9", textOnLight: true },
];

/** `mint-*` aliases the same teal ramp — one hue, two names the components use. */
const lightMintScale: ReadonlyArray<SwatchSpec> = lightBrandScale.map((s) => ({
  ...s,
  name: s.name.replace("brand", "mint"),
}));

const gradientSpecs: ReadonlyArray<{ name: string; className: string; usage: string }> = [
  { name: "gradient-hero", className: "bg-gradient-hero", usage: "Full-bleed hero and final CTA" },
  { name: "gradient-band", className: "bg-gradient-band", usage: "Mid-page always-dark band" },
  { name: "gradient-wash", className: "bg-gradient-wash", usage: "Page background wash" },
  { name: "gradient-accent", className: "bg-gradient-accent", usage: "Stat / highlight card" },
  {
    name: "gradient-signature",
    className: "bg-gradient-signature",
    usage: "Teal → plum diagonal",
  },
  { name: "gradient-card", className: "bg-gradient-card", usage: "Raised card surface" },
];

const clinicalStatuses: Array<{ status: ClinicalStatus; label: string; usage: string }> = [
  { status: "stable", label: "Stable", usage: "Patient stable, vitals normal" },
  { status: "critical", label: "Critical", usage: "Emergency, critical vitals" },
  { status: "caution", label: "Caution", usage: "Borderline vitals, warning" },
  { status: "admitted", label: "Admitted", usage: "Currently admitted" },
  { status: "discharged", label: "Discharged", usage: "Discharged patients" },
  { status: "pending", label: "Pending", usage: "Awaiting action" },
];

const typeScale = [
  { name: "Display XL", className: "text-display-xl", spec: "72/1.0/-0.04em/500" },
  { name: "Display L", className: "text-display-l", spec: "56/1.05/-0.035em/500" },
  { name: "Display M", className: "text-display-m", spec: "44/1.1/-0.03em/500" },
  { name: "Display S", className: "text-display-s", spec: "36/1.15/-0.025em/500" },
  { name: "Heading L", className: "text-heading-l", spec: "28/1.2/-0.02em/500" },
  { name: "Heading M", className: "text-heading-m", spec: "22/1.3/-0.015em/500" },
  { name: "Heading S", className: "text-heading-s", spec: "18/1.4/-0.01em/500" },
  { name: "Body L", className: "text-body-l", spec: "17/1.6/-0.006em/400" },
  { name: "Body M", className: "text-body-m", spec: "15/1.6/-0.004em/400" },
  { name: "Body S", className: "text-body-s", spec: "13/1.5/0/400" },
  { name: "Caption", className: "text-caption", spec: "11/1.4/0.02em/500" },
  { name: "Overline", className: "text-overline uppercase", spec: "11/1.4/0.08em/600" },
] as const;

const spacingScale = [
  2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 56, 64, 80, 96, 120, 160,
] as const;

const radiiScale = [
  { name: "xs", className: "rounded-xs", value: "4px" },
  { name: "sm", className: "rounded-sm", value: "6px" },
  { name: "md", className: "rounded-md", value: "8px" },
  { name: "lg", className: "rounded-lg", value: "12px" },
  { name: "xl", className: "rounded-xl", value: "16px" },
  { name: "2xl", className: "rounded-2xl", value: "20px" },
  { name: "full", className: "rounded-full", value: "9999px" },
] as const;

const shadowsScale = [
  { name: "xs", className: "shadow-xs" },
  { name: "sm", className: "shadow-sm" },
  { name: "md", className: "shadow-md" },
  { name: "lg", className: "shadow-lg" },
  { name: "card", className: "shadow-card" },
  { name: "popover", className: "shadow-popover" },
] as const;

// ─── Components ──────────────────────────────────────────────────────────

interface SectionProps {
  n: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

function Section({ n, title, subtitle, children }: SectionProps) {
  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <SectionNumber n={n} />
          <span className="text-caption text-muted-foreground dark:text-brand-500 font-mono uppercase">
            {title}
          </span>
        </div>
        {subtitle ? (
          <p className="text-body-m text-muted-foreground max-w-2xl">{subtitle}</p>
        ) : null}
      </div>
      <div>{children}</div>
    </section>
  );
}

/**
 * Static palette swatch — uses inline style so the rendered hex always
 * matches the spec, regardless of which theme is active.
 */
function Swatch({ name, hex, textOnLight }: SwatchSpec) {
  const isWhite = hex.toUpperCase() === "#FFFFFF";
  return (
    <div className="flex flex-col gap-1.5">
      <div
        style={{ backgroundColor: hex }}
        className={`flex h-16 w-full items-end justify-between rounded-md p-2 transition-shadow duration-150 hover:shadow-md ${isWhite ? "border border-gray-200" : ""}`}
      >
        <span
          style={{ color: textOnLight ? "#404040" : "rgba(255,255,255,0.8)" }}
          className="font-mono text-[10px]"
        >
          {hex}
        </span>
      </div>
      <span className="text-muted-foreground text-caption font-mono">{name}</span>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function StyleguidePage() {
  return (
    <div className="bg-background min-h-svh">
      {/* Header */}
      <header className="border-gray-150 border-b">
        <div className="mx-auto flex w-full max-w-300 items-center justify-between px-8 py-4">
          <Link href="/" className="flex items-center gap-3">
            <span className="font-display text-heading-s text-foreground tracking-tight">
              MedSync
            </span>
            <span className="text-muted-foreground text-overline font-mono tracking-wider uppercase">
              Design system
            </span>
          </Link>
          <div className="flex items-center gap-5">
            <Link
              href="/"
              className="text-muted-foreground hover:text-foreground text-body-s transition-colors duration-150"
            >
              ← Back home
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-300 px-8 py-16">
        {/* Title block */}
        <div className="mb-20 flex flex-col gap-6">
          <ClinicalPath segments={["docs", "design system"]} />
          <h1 className="font-display text-display-l text-foreground">The visual contract.</h1>
          <p className="text-body-l text-muted-foreground max-w-2xl">
            Every token, primitive, and clinical pattern that defines MedSync. Toggle the theme in
            the header — components flip automatically; palette swatches stay static so you can read
            both scales at once. Disagreements with{" "}
            <code className="text-body-s text-primary font-mono">DESIGN-medsync.md</code> are
            resolved by the document.
          </p>
        </div>

        <div className="flex flex-col gap-24">
          {/* 01 — Neutrals (light) */}
          <Section
            n={1}
            title="Neutrals (light mode)"
            subtitle="Light palette. 90% of UI lives here when the theme is light."
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {lightNeutralScale.map((s) => (
                <Swatch key={`l-${s.name}`} {...s} />
              ))}
            </div>
          </Section>

          {/* 02 — Neutrals (dark) */}
          <Section
            n={2}
            title="Neutrals (dark mode)"
            subtitle="Dark palette — surfaces layer rather than invert. Never pure black; cap at #0A0A0A."
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {darkNeutralScale.map((s) => (
                <Swatch key={`d-${s.name}`} {...s} />
              ))}
            </div>
          </Section>

          {/* 03 — Teal scales */}
          <Section
            n={3}
            title="Teal — clinical accent"
            subtitle="Light anchor is teal-600 (#0D9488); dark anchor brightens to teal-500 (#2DD4BF). `brand-*` and `mint-*` are aliases of this one ramp."
          >
            <div className="flex flex-col gap-6">
              <div>
                <span className="text-caption text-muted-foreground mb-3 inline-block font-mono uppercase">
                  Light
                </span>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 lg:grid-cols-10">
                  {lightBrandScale.map((s) => (
                    <Swatch key={`lt-${s.name}`} {...s} />
                  ))}
                </div>
              </div>
              <div>
                <span className="text-caption text-muted-foreground mb-3 inline-block font-mono uppercase">
                  Dark
                </span>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 lg:grid-cols-10">
                  {darkBrandScale.map((s) => (
                    <Swatch key={`dt-${s.name}`} {...s} />
                  ))}
                </div>
              </div>
              <div>
                <span className="text-caption text-muted-foreground mb-3 inline-block font-mono uppercase">
                  Mint (alias)
                </span>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 lg:grid-cols-10">
                  {lightMintScale.map((s) => (
                    <Swatch key={`mt-${s.name}`} {...s} />
                  ))}
                </div>
              </div>
            </div>
          </Section>

          {/* 04 — Plum (secondary accent) */}
          <Section
            n={4}
            title="Plum — secondary accent"
            subtitle="Colour as place, never state. Light anchor is plum-600 (#9F2F7E); dark brightens to #ED85C8. It lives on the hero glow, active nav, avatar monograms and chart series 2 — never on a button (teal is the only action colour) and never on a status chip."
          >
            <div className="flex flex-col gap-6">
              <div>
                <span className="text-caption text-muted-foreground mb-3 inline-block font-mono uppercase">
                  Light
                </span>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 lg:grid-cols-11">
                  {lightPlumScale.map((s) => (
                    <Swatch key={`lp-${s.name}`} {...s} />
                  ))}
                </div>
              </div>
              <div>
                <span className="text-caption text-muted-foreground mb-3 inline-block font-mono uppercase">
                  Dark
                </span>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 lg:grid-cols-11">
                  {darkPlumScale.map((s) => (
                    <Swatch key={`dp-${s.name}`} {...s} />
                  ))}
                </div>
              </div>
              <div>
                <span className="text-caption text-muted-foreground mb-3 inline-block font-mono uppercase">
                  In use (flips with the theme)
                </span>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="bg-plum-50 text-plum-800 ring-plum-600/10 inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium ring-1 ring-inset">
                    Active nav item
                  </span>
                  <span
                    aria-hidden
                    className="bg-plum-100 text-plum-800 ring-plum-200/70 text-caption inline-flex size-7 items-center justify-center rounded-full font-mono font-semibold ring-1"
                  >
                    N
                  </span>
                  <span className="text-plum-700 font-display text-heading-s italic">Emphasis</span>
                  <span className="bg-plum-600 h-2 w-24 rounded-full" aria-label="Chart series 2" />
                </div>
              </div>
            </div>
          </Section>

          {/* 05 — Gradients */}
          <Section
            n={5}
            title="Gradients"
            subtitle="Large-area, low-contrast washes: the shift is a lightness step inside one hue, never a rainbow. Each flips with the theme."
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {gradientSpecs.map(({ name, className, usage }) => (
                <div key={name} className="border-border overflow-hidden rounded-lg border">
                  <div className={`${className} h-24 w-full`} aria-hidden />
                  <div className="bg-card flex flex-col gap-0.5 p-3">
                    <code className="text-primary text-caption font-mono">.{className}</code>
                    <span className="text-muted-foreground text-body-s">{usage}</span>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* 06 — Clinical status (auto-flips) */}
          <Section
            n={6}
            title="Clinical status (auto-flips)"
            subtitle="Six states with mode-aware bg/fg pairs. Red softens to #FCA5A5 in dark — visible without being retina-searing at 3am."
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {clinicalStatuses.map(({ status, label, usage }) => (
                <div
                  key={status}
                  className="border-border bg-card flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="flex flex-col gap-1.5">
                    <ClinicalBadge status={status}>{label}</ClinicalBadge>
                    <span className="text-body-s text-muted-foreground">{usage}</span>
                  </div>
                  <code className="text-muted-foreground font-mono text-[10px]">{status}</code>
                </div>
              ))}
            </div>
          </Section>

          {/* 07 — Typography */}
          <Section
            n={7}
            title="Typography"
            subtitle="Neue Haas Grotesk for UI, fallback chain through Helvetica Neue. SF Mono / Fira Code for clinical data."
          >
            <div className="flex flex-col">
              {typeScale.map((t) => (
                <div
                  key={t.name}
                  className="border-gray-150 flex flex-wrap items-baseline justify-between gap-4 border-b py-5 last:border-b-0"
                >
                  <div className={`${t.className} text-foreground`}>{t.name}</div>
                  <div className="flex items-baseline gap-3">
                    <code className="text-muted-foreground text-caption font-mono">{t.spec}</code>
                    <code className="text-primary text-caption font-mono">
                      .{t.className.split(" ")[0]}
                    </code>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* 08 — Buttons */}
          <Section
            n={8}
            title="Buttons"
            subtitle="Six variants, three sizes. Primary teal flips its anchor across modes; emergency softens its red palette in dark."
          >
            <div className="flex flex-col gap-12">
              {(
                [
                  "primary",
                  "mint",
                  "secondary",
                  "ghost",
                  "brandSoft",
                  "emergency",
                  "alert",
                ] as const
              ).map((variant) => (
                <div
                  key={variant}
                  className="border-gray-150 grid grid-cols-1 items-center gap-6 border-b pb-8 last:border-b-0 last:pb-0 sm:grid-cols-[120px_1fr]"
                >
                  <code className="text-muted-foreground text-caption font-mono">{variant}</code>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant={variant} size="sm">
                      Small
                    </Button>
                    <Button variant={variant} size="md">
                      Medium action
                    </Button>
                    <Button variant={variant} size="lg">
                      Large action
                    </Button>
                    <Button variant={variant} size="md" disabled>
                      Disabled
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* 09 — Inputs */}
          <Section
            n={9}
            title="Inputs"
            subtitle="Compact for data density. Focus ring is brand-tinted; error state pulls the alert palette."
          >
            <div className="grid max-w-2xl grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <Label htmlFor="patient-name">Patient name</Label>
                <Input id="patient-name" placeholder="Last, First" defaultValue="Mukasa, Joseph" />
              </div>
              <div>
                <Label htmlFor="mrn">MRN</Label>
                <Input id="mrn" placeholder="MRN-2026-00000" className="font-mono tracking-wider" />
              </div>
              <div>
                <Label htmlFor="dose">Dose</Label>
                <Input id="dose" placeholder="—" disabled defaultValue="500 mg" />
              </div>
              <div>
                <Label htmlFor="dob">Date of birth</Label>
                <Input id="dob" placeholder="DD MMM YYYY" aria-invalid defaultValue="32 Feb 1990" />
              </div>
            </div>
          </Section>

          {/* 10 — Cards */}
          <Section
            n={10}
            title="Cards"
            subtitle="Three tones flip surfaces and borders per mode automatically."
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Card tone="standard">
                <CardHeader>
                  <CardTitle>Standard</CardTitle>
                  <CardDescription>
                    Card surface (#FFFFFF / #171717) with default border + card shadow.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-body-s text-muted-foreground">
                    Default container for forms, modules, and most layouts.
                  </p>
                </CardContent>
              </Card>
              <Card tone="muted">
                <CardHeader>
                  <CardTitle>Muted</CardTitle>
                  <CardDescription>
                    Muted surface (#FAFAFA / #111111), no shadow. For grouped sub-sections.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-body-s text-muted-foreground">
                    Reduces visual weight when nested inside a standard card.
                  </p>
                </CardContent>
              </Card>
              <Card tone="tealTinted">
                <CardHeader>
                  <CardTitle>Teal-tinted</CardTitle>
                  <CardDescription>Clinical highlight surface (#F0FDFA / #042F2E).</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-body-s text-muted-foreground">
                    Pair with a clinical-bracket label, never used decoratively.
                  </p>
                </CardContent>
              </Card>
            </div>
          </Section>

          {/* 11 — Vital stat strip */}
          <Section
            n={11}
            title="Vital stat strip"
            subtitle="The clinical primitive. Monospace, tabular-nums, large. Critical vitals snap to red + bold (softened in dark)."
          >
            <Card tone="standard">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-1">
                    <CardTitle>Mukasa, Joseph</CardTitle>
                    <CardDescription className="font-mono">
                      MRN-2026-00481 · 47y · M · Ward 4-B
                    </CardDescription>
                  </div>
                  <ClinicalBadge status="critical">Critical</ClinicalBadge>
                </div>
              </CardHeader>
              <Separator className="-mx-6 my-2 w-auto" />
              <CardContent>
                <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
                  <VitalStat label="HR" value="142" unit="bpm" tone="critical" meta="14:32" />
                  <VitalStat label="BP" value="186/112" unit="mmHg" tone="critical" meta="14:32" />
                  <VitalStat label="SpO₂" value="89" unit="%" tone="critical" meta="14:32" />
                  <VitalStat label="Temp" value="38.4" unit="°C" tone="normal" meta="14:30" />
                </div>
              </CardContent>
            </Card>
          </Section>

          {/* 12 — Section numbers + clinical paths */}
          <Section
            n={12}
            title="Section numbers & clinical paths"
            subtitle="Bracket numbers anchor the eye through dense layouts. Path notation locates the clinician in the IA."
          >
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
              <Card tone="muted">
                <CardHeader>
                  <CardTitle className="text-body-m">Section numbers</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap items-center gap-3">
                    {[1, 2, 3, 4, 12].map((n) => (
                      <SectionNumber key={n} n={n} />
                    ))}
                  </div>
                </CardContent>
              </Card>
              <Card tone="muted">
                <CardHeader>
                  <CardTitle className="text-body-m">Clinical paths</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-3">
                    <ClinicalPath
                      aria-label="Path, arrow"
                      segments={["patient", "vitals"]}
                      separator="→"
                    />
                    <ClinicalPath
                      aria-label="Path, dots"
                      segments={["ward", "bed 12"]}
                      separator="⋮"
                    />
                    <ClinicalPath
                      aria-label="Path, middot"
                      segments={["labs", "hematology"]}
                      separator="·"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </Section>

          {/* 13 — Spacing */}
          <Section
            n={13}
            title="Spacing"
            subtitle="4px base grid. Tailwind utilities map 1-to-1 (8px = p-2, 16px = p-4, …)."
          >
            <div className="flex flex-wrap items-end gap-6">
              {spacingScale.map((px) => (
                <div key={px} className="flex flex-col items-center gap-2">
                  <div
                    className="bg-primary"
                    style={{ width: `${px}px`, height: `${px}px` }}
                    aria-hidden
                  />
                  <code className="text-muted-foreground font-mono text-[10px]">{px}</code>
                </div>
              ))}
            </div>
          </Section>

          {/* 14 — Radii */}
          <Section
            n={14}
            title="Radii"
            subtitle="Six steps. xs for badges, sm for inputs, md for buttons, lg for cards."
          >
            <div className="flex flex-wrap items-center gap-6">
              {radiiScale.map((r) => (
                <div key={r.name} className="flex flex-col items-center gap-2">
                  <div
                    className={`bg-accent border-brand-100 size-20 border ${r.className}`}
                    aria-hidden
                  />
                  <div className="flex flex-col items-center">
                    <code className="text-foreground text-caption font-mono">{r.name}</code>
                    <code className="text-muted-foreground font-mono text-[10px]">{r.value}</code>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* 15 — Shadows */}
          <Section
            n={15}
            title="Shadows"
            subtitle="Restrained elevation. Dark mode adds a faint white inner edge for definition."
          >
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
              {shadowsScale.map((s) => (
                <div key={s.name} className="flex flex-col items-center gap-3">
                  <div className={`bg-card size-24 rounded-lg ${s.className}`} aria-hidden />
                  <code className="text-muted-foreground text-caption font-mono">{s.name}</code>
                </div>
              ))}
            </div>
          </Section>

          {/* 16 — Scheduling calendar (addendum GATE A) */}
          <Section
            n={16}
            title="Scheduling calendar — month · week · day · agenda"
            subtitle="Reusable MedSync calendar (see components/scheduling/calendar/). Week is the workhorse for clinicians; current-time indicator on today; availability blocks render as hatched / muted background; urgent appointments carry the red ring (clinical-emergency colour only). Click any appointment to open the existing AppointmentDetailSheet."
          >
            <CalendarDemo />
          </Section>

          {/* 17 — Landing patient mock (addendum GATE PA review) */}
          <Section
            n={17}
            title="Patient-experience mock — “MedSync · My Health”"
            subtitle="Patient-end twin of the §05b Clinician Home. Static composition; same Amina N. (MS-00184), same date/time, same medications, same glucose values. Renderable as the full device or as fragments for embedding inside §07 scenes and the new patient chapter."
          >
            <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
              {/* Full device */}
              <div className="lg:col-span-5">
                <p className="text-muted-foreground mb-3 font-mono text-[10px] tracking-[0.18em] uppercase">
                  fragment = full
                </p>
                <MyHealthMock />
              </div>

              {/* Fragments column */}
              <div className="flex flex-col gap-10 lg:col-span-7">
                {[
                  { label: "fragment = log-reading", value: "log-reading" as const },
                  { label: "fragment = today-meds", value: "today-meds" as const },
                  { label: "fragment = sms-offline", value: "sms-offline" as const },
                  { label: "fragment = report-concern", value: "report-concern" as const },
                ].map((f) => (
                  <div key={f.value}>
                    <p className="text-muted-foreground mb-3 font-mono text-[10px] tracking-[0.18em] uppercase">
                      {f.label}
                    </p>
                    <MyHealthMock fragment={f.value} />
                  </div>
                ))}
              </div>
            </div>
            <p className="text-muted-foreground mt-8 max-w-prose text-[12px] italic">
              Tone (addendum §C): encouraging never shaming, calm never alarming. The held
              medication is labelled “held by your care team” — never a patient failure. Streak text
              is “X days on track” (not “% compliant”). “Something feels off?” is a calm channel,
              not an emergency button.
            </p>
          </Section>
        </div>

        <footer className="border-gray-150 text-muted-foreground text-caption mt-32 flex items-center justify-between border-t pt-8">
          <span>
            Source of truth: <code className="text-primary font-mono">DESIGN-medsync.md</code>
          </span>
          <span>Phase 0.2-dark · 2026-05-21</span>
        </footer>
      </main>
    </div>
  );
}
