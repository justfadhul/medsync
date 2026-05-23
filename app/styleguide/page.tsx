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

const lightTealScale: ReadonlyArray<SwatchSpec> = [
  { name: "teal-50", hex: "#F0FDFA", textOnLight: true },
  { name: "teal-100", hex: "#CCFBF1", textOnLight: true },
  { name: "teal-200", hex: "#99F6E4", textOnLight: true },
  { name: "teal-300", hex: "#5EEAD4", textOnLight: true },
  { name: "teal-400", hex: "#2DD4BF", textOnLight: true },
  { name: "teal-500", hex: "#14B8A6", textOnLight: false },
  { name: "teal-600", hex: "#0D9488", textOnLight: false },
  { name: "teal-700", hex: "#0F766E", textOnLight: false },
  { name: "teal-800", hex: "#115E59", textOnLight: false },
  { name: "teal-900", hex: "#134E4A", textOnLight: false },
];

const darkTealScale: ReadonlyArray<SwatchSpec> = [
  { name: "teal-50", hex: "#042F2E", textOnLight: false },
  { name: "teal-100", hex: "#064E45", textOnLight: false },
  { name: "teal-200", hex: "#0F766E", textOnLight: false },
  { name: "teal-300", hex: "#0D9488", textOnLight: false },
  { name: "teal-400", hex: "#14B8A6", textOnLight: false },
  { name: "teal-500", hex: "#2DD4BF", textOnLight: true },
  { name: "teal-600", hex: "#5EEAD4", textOnLight: true },
  { name: "teal-700", hex: "#99F6E4", textOnLight: true },
  { name: "teal-800", hex: "#CCFBF1", textOnLight: true },
  { name: "teal-900", hex: "#F0FDFA", textOnLight: true },
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
          <span className="text-caption text-muted-foreground font-mono uppercase dark:text-teal-500">
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
      <span className="text-muted-foreground font-mono text-[11px]">{name}</span>
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
            <span className="text-muted-foreground font-mono text-[11px] tracking-wider uppercase">
              Design system
            </span>
          </Link>
          <div className="flex items-center gap-5">
            <Link
              href="/"
              className="text-muted-foreground hover:text-foreground text-[13px] transition-colors duration-150"
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
            subtitle="Light anchor is teal-600 (#0D9488); dark anchor brightens to teal-500 (#2DD4BF). Both scales shown."
          >
            <div className="flex flex-col gap-6">
              <div>
                <span className="text-caption text-muted-foreground mb-3 inline-block font-mono uppercase">
                  Light
                </span>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 lg:grid-cols-10">
                  {lightTealScale.map((s) => (
                    <Swatch key={`lt-${s.name}`} {...s} />
                  ))}
                </div>
              </div>
              <div>
                <span className="text-caption text-muted-foreground mb-3 inline-block font-mono uppercase">
                  Dark
                </span>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 lg:grid-cols-10">
                  {darkTealScale.map((s) => (
                    <Swatch key={`dt-${s.name}`} {...s} />
                  ))}
                </div>
              </div>
            </div>
          </Section>

          {/* 04 — Clinical status (auto-flips) */}
          <Section
            n={4}
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

          {/* 05 — Typography */}
          <Section
            n={5}
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
                    <code className="text-muted-foreground font-mono text-[11px]">{t.spec}</code>
                    <code className="text-primary font-mono text-[11px]">
                      .{t.className.split(" ")[0]}
                    </code>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* 06 — Buttons */}
          <Section
            n={6}
            title="Buttons"
            subtitle="Six variants, three sizes. Primary teal flips its anchor across modes; emergency softens its red palette in dark."
          >
            <div className="flex flex-col gap-12">
              {(["primary", "secondary", "ghost", "tealSoft", "emergency", "alert"] as const).map(
                (variant) => (
                  <div
                    key={variant}
                    className="border-gray-150 grid grid-cols-1 items-center gap-6 border-b pb-8 last:border-b-0 last:pb-0 sm:grid-cols-[120px_1fr]"
                  >
                    <code className="text-muted-foreground font-mono text-[11px]">{variant}</code>
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
                ),
              )}
            </div>
          </Section>

          {/* 07 — Inputs */}
          <Section
            n={7}
            title="Inputs"
            subtitle="Compact for data density. Focus ring is teal-tinted; error state pulls the alert palette."
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

          {/* 08 — Cards */}
          <Section
            n={8}
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

          {/* 09 — Vital stat strip */}
          <Section
            n={9}
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

          {/* 10 — Section numbers + clinical paths */}
          <Section
            n={10}
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
                    <ClinicalPath segments={["patient", "vitals"]} separator="→" />
                    <ClinicalPath segments={["ward", "bed 12"]} separator="⋮" />
                    <ClinicalPath segments={["labs", "hematology"]} separator="·" />
                  </div>
                </CardContent>
              </Card>
            </div>
          </Section>

          {/* 11 — Spacing */}
          <Section
            n={11}
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

          {/* 12 — Radii */}
          <Section
            n={12}
            title="Radii"
            subtitle="Six steps. xs for badges, sm for inputs, md for buttons, lg for cards."
          >
            <div className="flex flex-wrap items-center gap-6">
              {radiiScale.map((r) => (
                <div key={r.name} className="flex flex-col items-center gap-2">
                  <div
                    className={`bg-accent size-20 border border-teal-100 ${r.className}`}
                    aria-hidden
                  />
                  <div className="flex flex-col items-center">
                    <code className="text-foreground font-mono text-[11px]">{r.name}</code>
                    <code className="text-muted-foreground font-mono text-[10px]">{r.value}</code>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* 13 — Shadows */}
          <Section
            n={13}
            title="Shadows"
            subtitle="Restrained elevation. Dark mode adds a faint white inner edge for definition."
          >
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
              {shadowsScale.map((s) => (
                <div key={s.name} className="flex flex-col items-center gap-3">
                  <div className={`bg-card size-24 rounded-lg ${s.className}`} aria-hidden />
                  <code className="text-muted-foreground font-mono text-[11px]">{s.name}</code>
                </div>
              ))}
            </div>
          </Section>

          {/* 14 — Landing patient mock (addendum GATE PA review) */}
          <Section
            n={14}
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

        <footer className="border-gray-150 text-muted-foreground mt-32 flex items-center justify-between border-t pt-8 text-[11px]">
          <span>
            Source of truth: <code className="text-primary font-mono">DESIGN-medsync.md</code>
          </span>
          <span>Phase 0.2-dark · 2026-05-21</span>
        </footer>
      </main>
    </div>
  );
}
