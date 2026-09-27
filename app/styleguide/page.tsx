import type { ClinicalStatus } from "@/components/medsync/status-pill";
import type { Domain, Hue } from "@/lib/design/domains";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  BedIcon,
  CalendarIcon,
  ClockIcon,
  FlaskConicalIcon,
  HashIcon,
  LayoutGridIcon,
  MapPinIcon,
  PhoneIcon,
  PillIcon,
  PlusIcon,
  ShieldIcon,
  StethoscopeIcon,
  TagIcon,
  TriangleAlertIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";

import { MyHealthMock } from "@/components/landing/_my-health-mock";
import { AttributeList } from "@/components/medsync/attribute-list";
import { Avatar, AvatarStack } from "@/components/medsync/avatar";
import { ChromaBand } from "@/components/medsync/chroma-band";
import { ClinicalPath } from "@/components/medsync/clinical-path";
import { DomainTile } from "@/components/medsync/domain-tile";
import { EcgLoader } from "@/components/medsync/ecg-loader";
import { Panel } from "@/components/medsync/panel";
import { RecordHeader } from "@/components/medsync/record-header";
import { SectionNumber } from "@/components/medsync/section-number";
import { StatCard } from "@/components/medsync/stat-card";
import { StatusPill } from "@/components/medsync/status-pill";
import { Tag } from "@/components/medsync/tag";
import { VitalStat, VitalStrip } from "@/components/medsync/vital-stat";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { DOMAIN_HUE, DOMAIN_LABEL } from "@/lib/design/domains";
import { CalendarDemo } from "./_components/calendar-demo";
import {
  CommandBarDemo,
  RecordTableDemo,
  SidebarDemo,
  ViewSwitcherDemo,
} from "./_components/chroma-demos";
import { CHROMA_COLOURS } from "./_lib/chroma-tokens";

export const metadata: Metadata = {
  title: "Design system",
  description:
    "The visual contract for MedSync Chroma — colour that places, type, primitives and clinical patterns.",
};

// ─── Data ────────────────────────────────────────────────────────────────

const INK = [
  "0",
  "25",
  "50",
  "100",
  "150",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
  "950",
];
const RAMP = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
const ROLES = ["solid", "on-solid", "tint", "edge", "text", "icon"] as const;
const PLACE_HUES: ReadonlyArray<Exclude<Hue, "teal">> = ["sky", "iris", "grape", "plum", "slate"];
const DOMAINS: ReadonlyArray<{ domain: Domain; icon: ReactNode; meta: string }> = [
  { domain: "patients", icon: <UsersIcon />, meta: "Records · the patient app" },
  { domain: "clinical", icon: <StethoscopeIcon />, meta: "Triage · encounters · notes" },
  { domain: "pharmacy", icon: <PillIcon />, meta: "Prescribing · lab orders" },
  { domain: "operations", icon: <BedIcon />, meta: "Wards · scheduling · queue" },
  { domain: "admin", icon: <ShieldIcon />, meta: "Staff · setup · audit" },
];
const STATUSES: ReadonlyArray<{ status: ClinicalStatus; usage: string }> = [
  { status: "stable", usage: "Patient stable, vitals normal" },
  { status: "caution", usage: "Borderline vitals, warning" },
  { status: "critical", usage: "Emergency, critical vitals" },
  { status: "admitted", usage: "Currently admitted" },
  { status: "discharged", usage: "Discharged" },
  { status: "pending", usage: "Awaiting action, unconfirmed" },
];
const TYPE = [
  {
    cls: "font-display text-display-xl",
    name: "display-xl",
    spec: "72 / 0.98 / −0.045em / 600 · Bricolage",
    sample: "The ward, in colour.",
  },
  {
    cls: "font-display text-display-l",
    name: "display-l",
    spec: "56 / 1.02 / −0.04em / 600",
    sample: "Every patient, placed.",
  },
  {
    cls: "font-display text-display-m",
    name: "display-m",
    spec: "40 / 1.08 / −0.035em / 600",
    sample: "Follow them home",
  },
  {
    cls: "font-display text-display-s",
    name: "display-s",
    spec: "30 / 1.12 / −0.03em / 600 · page titles",
    sample: "Ward 4B",
  },
  {
    cls: "text-heading-l",
    name: "heading-l",
    spec: "22 / 1.25 / −0.02em / 600 · Geist",
    sample: "MRN-2026-00184",
  },
  {
    cls: "text-heading-m",
    name: "heading-m",
    spec: "17 / 1.35 / −0.015em / 600",
    sample: "Admit patient",
  },
  {
    cls: "text-heading-s",
    name: "heading-s",
    spec: "14 / 1.4 / −0.01em / 600",
    sample: "Awaiting review",
  },
  {
    cls: "text-body-l",
    name: "body-l",
    spec: "16 / 1.6 / 400",
    sample: "Your care team saw your readings this morning.",
  },
  {
    cls: "text-body-m",
    name: "body-m",
    spec: "14 / 1.5 / 400 · default staff text",
    sample: "3 of the last 5 fasting readings above target",
  },
  {
    cls: "text-body-s",
    name: "body-s",
    spec: "13 / 1.45 / 400 · tables, inputs",
    sample: "Acknowledged by the on-call doctor · 07:40",
  },
  {
    cls: "text-label",
    name: "label",
    spec: "13 / 1.4 / 500 · buttons, nav",
    sample: "Add finding",
  },
  { cls: "text-caption", name: "caption", spec: "12 / 1.35 / 500", sample: "Last reviewed" },
  {
    cls: "text-overline uppercase",
    name: "overline",
    spec: "11 / 1.3 / 0.06em / 600",
    sample: "Fasting glucose",
  },
  {
    cls: "text-stat font-mono tabular-nums",
    name: "stat",
    spec: "28 mono · Geist Mono",
    sample: "41 / 48",
  },
  { cls: "text-vital font-mono tabular-nums", name: "vital", spec: "22 mono", sample: "14.2" },
  {
    cls: "text-mono-s font-mono",
    name: "mono-s",
    spec: "12 mono · MRNs, beds",
    sample: "MRN-2026-00184",
  },
];
const SPACING = [2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 56, 64, 80, 96, 120, 160];
const RADII = [
  { cls: "rounded-xs", name: "xs", v: "4" },
  { cls: "rounded-sm", name: "sm", v: "6" },
  { cls: "rounded-md", name: "md", v: "8" },
  { cls: "rounded-lg", name: "lg", v: "12" },
  { cls: "rounded-xl", name: "xl", v: "16" },
  { cls: "rounded-2xl", name: "2xl", v: "24" },
  { cls: "rounded-full", name: "full", v: "9999" },
];
const SHADOWS = [
  "shadow-xs",
  "shadow-control",
  "shadow-primary",
  "shadow-card",
  "shadow-popover",
  "shadow-focus",
];

// ─── Pieces ──────────────────────────────────────────────────────────────

function Section({
  n,
  id,
  title,
  subtitle,
  children,
}: {
  n: number;
  id?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <SectionNumber n={n} />
          <h2 className="text-heading-m text-foreground">{title}</h2>
        </div>
        {subtitle ? (
          <p className="text-body-m text-muted-foreground max-w-3xl">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** A live swatch: painted with the token itself, labelled with both themes' exact hex. */
function Swatch({ token }: { token: string }) {
  const c = CHROMA_COLOURS[token];
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div
        aria-hidden
        className="border-border h-12 rounded-md border"
        style={{ background: `var(--${token})` }}
      />
      <code className="text-foreground truncate font-mono text-[11px]">{token}</code>
      {c ? (
        <span className="text-muted-foreground font-mono text-[10px] tabular-nums">
          {c.light} · {c.dark}
        </span>
      ) : null}
    </div>
  );
}

function SwatchRow({ tokens }: { tokens: ReadonlyArray<string> }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3">
      {tokens.map((t) => (
        <Swatch key={t} token={t} />
      ))}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function StyleguidePage() {
  return (
    <div className="bg-background min-h-svh">
      <header className="border-border glass sticky top-0 z-30 border-b">
        <div className="mx-auto flex h-12 w-full max-w-320 items-center justify-between gap-4 px-4 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="font-display text-foreground text-body-m font-semibold">MedSync</span>
            <Tag hue="slate">Chroma design system</Tag>
          </Link>
          <div className="flex items-center gap-3">
            <CommandBarDemo />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-320 flex-col gap-20 px-4 py-12 sm:px-8">
        <div className="flex max-w-3xl flex-col gap-4">
          <p className="text-overline text-muted-foreground uppercase">
            DESIGN-medsync.md · ADR 0162
          </p>
          <h1 className="font-display text-display-l text-foreground text-balance">
            Colour tells staff where they are.
          </h1>
          <p className="text-body-l text-muted-foreground">
            MedSync Chroma: crisp cool ink, dense record views, a ⌘K command bar, and one cool hue
            for each part of the hospital. Teal still acts, red still means emergency, and the
            clinical status system still belongs to the patient.
          </p>
        </div>

        <Section
          n={1}
          id="colour"
          title="Ink — the ground"
          subtitle="About 85% of any screen. A slight cool bias; ink-400 is for placeholders and disabled glyphs only."
        >
          <SwatchRow tokens={INK.map((s) => `ink-${s}`)} />
        </Section>

        <Section
          n={2}
          title="Teal — the one action colour"
          subtitle="Primary and soft buttons, links, focus, checked and selected controls. Never a place, never decoration."
        >
          <SwatchRow tokens={RAMP.map((s) => `teal-${s}`)} />
          <SwatchRow tokens={ROLES.map((r) => `teal-${r}`)} />
        </Section>

        <Section
          n={3}
          id="domains"
          title="Place — one hue per domain"
          subtitle="Hues mark location: tiles, sidebar items, tags, avatars, record bands, chart series. They never go on a button, a link, a focus ring, a count or a status."
        >
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
            {DOMAINS.map((d) => (
              <div
                key={d.domain}
                className="border-border bg-card hover:bg-ink-50 flex items-center gap-2.5 rounded-lg border p-2.5"
              >
                <DomainTile domain={d.domain} icon={d.icon} size="lg" />
                <div className="min-w-0">
                  <p className="text-heading-s text-foreground">{DOMAIN_LABEL[d.domain]}</p>
                  <p className="text-caption text-muted-foreground truncate font-normal">
                    {d.meta}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {(["solid", "soft"] as const).map((tone) => (
              <span key={tone} className="flex items-center gap-1.5">
                {DOMAINS.map((d) => (
                  <DomainTile key={d.domain} domain={d.domain} icon={d.icon} tone={tone} />
                ))}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              {DOMAINS.map((d) => (
                <DomainTile key={d.domain} domain={d.domain} icon={d.icon} size="sm" />
              ))}
            </span>
          </div>
          <div className="flex flex-col gap-6">
            {PLACE_HUES.map((h) => (
              <div key={h} className="flex flex-col gap-2">
                <p className="text-label text-foreground">
                  {h}
                  <span className="text-muted-foreground font-normal">
                    {" · "}
                    {(Object.keys(DOMAIN_HUE) as Domain[])
                      .filter((d) => DOMAIN_HUE[d] === h)
                      .map((d) => DOMAIN_LABEL[d])
                      .join(", ") || "—"}
                  </span>
                </p>
                <SwatchRow
                  tokens={[
                    ...(h === "slate" ? [] : RAMP.map((s) => `${h}-${s}`)),
                    ...ROLES.map((r) => `${h}-${r}`),
                  ]}
                />
              </div>
            ))}
          </div>
        </Section>

        <Section
          n={4}
          title="Clinical signal — the patient's colours"
          subtitle="Red, amber and green belong to the patient. Six states, CSO-owned; critical and caution text use the AA pair. A status is round with an icon; a tag is square with a dot."
        >
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <StatusPill key={s.status} status={s.status} />
            ))}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {STATUSES.map((s) => (
              <div
                key={s.status}
                className="border-border bg-card flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
              >
                <StatusPill status={s.status} />
                <span className="text-caption text-muted-foreground text-right font-normal">
                  {s.usage}
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Tag hue="grape">Insulin</Tag>
            <StatusPill status="discharged" />
            <span className="text-caption text-muted-foreground font-normal">
              Tag = square, dot. Status = round, icon.
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Tag hue="sky">Diabetes clinic</Tag>
            <Tag hue="iris">Follow-up</Tag>
            <Tag hue="grape">Insulin</Tag>
            <Tag hue="plum">Ward 4B</Tag>
            <Tag hue="slate">Self-pay</Tag>
            <Tag hue="teal">Enrolled</Tag>
          </div>
        </Section>

        <Section
          n={5}
          title="Type"
          subtitle="Bricolage Grotesque for marketing headlines and workspace page titles only; Geist for every product surface, headings at 600; Geist Mono for vitals, labs, MRNs and key hints."
        >
          <div className="border-border divide-ink-150 bg-card divide-y rounded-lg border">
            {TYPE.map((t) => (
              <div
                key={t.name}
                className="grid gap-2 px-4 py-3 sm:grid-cols-[180px_1fr] sm:items-baseline"
              >
                <div>
                  <code className="text-foreground font-mono text-[12px]">{t.name}</code>
                  <p className="text-muted-foreground font-mono text-[10px]">{t.spec}</p>
                </div>
                <p className={`${t.cls} text-foreground truncate`}>{t.sample}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section
          n={6}
          title="Buttons"
          subtitle="32px default, label 13/500, radius-md. One teal primary per view; the red emergency button for clinical emergencies only."
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button>
                <PlusIcon aria-hidden />
                Admit patient <Kbd>A</Kbd>
              </Button>
              <Button variant="secondary">Filter</Button>
              <Button variant="ghost">Cancel</Button>
              <Button variant="soft">
                <PlusIcon aria-hidden />
                Add finding
              </Button>
              <Button variant="link">View chart</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="emergency">
                <TriangleAlertIcon aria-hidden />
                Start resus
              </Button>
              <Button variant="alert">Flag allergy</Button>
              <Button variant="secondary" size="icon" aria-label="More">
                <LayoutGridIcon aria-hidden />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm">Small</Button>
              <Button>Default</Button>
              <Button size="lg">Large</Button>
              <Button disabled>Disabled</Button>
            </div>
          </div>
        </Section>

        <Section
          n={7}
          title="Inputs"
          subtitle="34px, radius-md, an ink-300 edge with shadow-control. Focus: ring border plus a teal-tint halo. Errors say what to type."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col">
              <Label htmlFor="sg-parish">Parish</Label>
              <Input id="sg-parish" placeholder="Start typing a parish" />
              <span className="text-caption text-muted-foreground mt-1.5 font-normal">
                Village not listed? Type it in.
              </span>
            </div>
            <div className="flex flex-col">
              <Label htmlFor="sg-council">Council number</Label>
              <Input
                id="sg-council"
                className="font-mono tracking-[0.03em]"
                defaultValue="UMDPC/2024/1187"
              />
              <span className="text-caption text-muted-foreground mt-1.5 font-normal">
                Checked against the register.
              </span>
            </div>
            <div className="flex flex-col">
              <Label htmlFor="sg-phone">Phone</Label>
              <Input
                id="sg-phone"
                aria-invalid
                defaultValue="0773 99"
                aria-describedby="sg-phone-err"
              />
              <span
                id="sg-phone-err"
                className="text-caption text-status-critical-fg-aa mt-1.5 inline-flex items-center gap-1 font-normal"
              >
                <TriangleAlertIcon aria-hidden className="size-3" />
                Enter all 10 digits, e.g. 0773 992 314.
              </span>
            </div>
          </div>
        </Section>

        <Section
          n={8}
          title="Navigation"
          subtitle="The workspace sidebar: an ink-25 column, 30px items, a domain tile on each domain item, and the active item in its domain's tint. Counts are mono, never a coloured badge."
        >
          <div className="flex flex-wrap items-start gap-8">
            <SidebarDemo />
            <ViewSwitcherDemo />
          </div>
        </Section>

        <Section
          n={9}
          id="records"
          title="Records"
          subtitle="Record header, attribute list and the dense record table. Illustrative — no real patients."
        >
          <RecordHeader
            domain="patients"
            icon={<UsersIcon />}
            crumb="Diabetes clinic"
            title="MRN-2026-00184"
            monogram="A N"
            actions={
              <>
                <Button variant="secondary">
                  <CalendarIcon aria-hidden />
                  Book review
                </Button>
                <Button>Open encounter</Button>
              </>
            }
            meta={
              <>
                <StatusPill status="caution">Borderline</StatusPill>
                <Tag hue="sky">Diabetes clinic</Tag>
                <Tag hue="grape">Insulin</Tag>
                <span className="text-ink-600 font-mono text-[12px] tracking-[0.02em]">
                  F · 54 y · Bed 4B-12
                </span>
              </>
            }
          />
          <div className="border-border bg-card max-w-xl rounded-lg border p-4">
            <AttributeList
              items={[
                { label: "MRN", icon: <HashIcon />, value: "MRN-2026-00184", mono: true },
                {
                  label: "Programmes",
                  icon: <TagIcon />,
                  value: (
                    <>
                      <Tag hue="sky">Diabetes clinic</Tag>
                      <Tag hue="iris">Follow-up</Tag>
                    </>
                  ),
                },
                {
                  label: "Care team",
                  icon: <UserIcon />,
                  value: (
                    <>
                      <AvatarStack>
                        <Avatar name="K M" hue="iris" />
                        <Avatar name="S W" hue="teal" />
                      </AvatarStack>
                      Medical officer, nurse
                    </>
                  ),
                },
                { label: "Parish", icon: <MapPinIcon />, value: "Kisenyi II · Kampala Central" },
                {
                  label: "Last reviewed",
                  icon: <ClockIcon />,
                  value: "14 SEP 2026 · 10:20",
                  mono: true,
                },
                { label: "Next of kin", icon: <PhoneIcon /> },
              ]}
            />
          </div>
          <RecordTableDemo />
        </Section>

        <Section
          n={10}
          title="Dashboard"
          subtitle="Every count carries its basis; the bar is a real proportion in the domain's solid colour, never red, amber or green."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              domain="operations"
              icon={<BedIcon />}
              label="Beds occupied"
              value="41 / 48"
              share={41 / 48}
              hint="Ward 4B · 7 free"
            />
            <StatCard
              domain="clinical"
              icon={<StethoscopeIcon />}
              label="Awaiting review"
              value={7}
              share={7 / 23}
              hint="of 23 arrivals today"
            />
            <StatCard
              domain="pharmacy"
              icon={<FlaskConicalIcon />}
              label="Results back"
              value={12}
              hint="since 06:00"
            />
          </div>
          <VitalStrip>
            <VitalStat label="Heart rate" value="88" unit="bpm" meta="06:12" />
            <VitalStat label="Blood pressure" value="128/82" unit="mmHg" meta="06:12" />
            <VitalStat
              label="SpO₂ · low"
              value="89"
              unit="%"
              tone="critical"
              direction="low"
              meta="06:12"
            />
            <VitalStat
              label="Fasting glucose · high"
              value="14.2"
              unit="mmol/L"
              tone="critical"
              direction="high"
              meta="Above target"
            />
          </VitalStrip>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              title="Awaiting review"
              count={3}
              action={
                <Button size="sm" variant="secondary">
                  View all
                </Button>
              }
            >
              <p className="text-body-s text-muted-foreground p-4">
                Panels crop their own content; tables scroll under a sticky header.
              </p>
            </Panel>
            <div className="grid gap-3">
              <Card>
                <CardHeader>
                  <CardTitle>Standard card</CardTitle>
                  <CardDescription>White, a 1px border, shadow-card.</CardDescription>
                </CardHeader>
              </Card>
              <Card tone="muted">
                <CardHeader>
                  <CardTitle>Muted card</CardTitle>
                  <CardDescription>For a secondary grouping.</CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <span className="flex items-center gap-2">
              {[1, 2, 3].map((n) => (
                <SectionNumber key={n} n={n} />
              ))}
            </span>
            <ClinicalPath segments={["ward", "bed 12"]} separator="⋮" />
            <EcgLoader />
          </div>
        </Section>

        <Section
          n={11}
          title="Scale"
          subtitle="4px grid; radii by role; crisp layered shadows — a 1px ring plus a short drop."
        >
          <div className="flex flex-wrap items-end gap-3">
            {SPACING.map((px) => (
              <div key={px} className="flex flex-col items-center gap-1.5">
                <div
                  aria-hidden
                  className="bg-teal-solid rounded-xs"
                  style={{ width: 12, height: px }}
                />
                <code className="text-muted-foreground font-mono text-[10px]">{px}</code>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-4">
            {RADII.map((r) => (
              <div key={r.name} className="flex flex-col items-center gap-1.5">
                <div aria-hidden className={`border-ink-300 bg-ink-50 size-16 border ${r.cls}`} />
                <code className="text-muted-foreground font-mono text-[10px]">
                  {r.name} · {r.v}
                </code>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
            {SHADOWS.map((s) => (
              <div key={s} className="flex flex-col items-center gap-2">
                <div aria-hidden className={`bg-card size-20 rounded-lg ${s}`} />
                <code className="text-muted-foreground font-mono text-[10px]">{s}</code>
              </div>
            ))}
          </div>
        </Section>

        <Section
          n={12}
          title="Marketing band"
          subtitle="The loudest colour in the system, on public pages only: one solid place hue, then the spectrum strip as flat blocks. Never a gradient."
        >
          <ChromaBand hue="iris" title="Every patient, placed.">
            Triage, the ward, the pharmacy and the follow-up at home, each in its own colour, so
            staff always know where they are.
          </ChromaBand>
        </Section>

        <Section
          n={13}
          title="Scheduling calendar"
          subtitle="The reusable calendar (components/scheduling/calendar). Urgent appointments carry the red ring — clinical-emergency colour only."
        >
          <CalendarDemo />
        </Section>

        <Section
          n={14}
          title="Patient app mock"
          subtitle="The patient-end composition in the Patients hue (sky). Illustrative — no real patients."
        >
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <MyHealthMock />
            </div>
            <div className="flex flex-col gap-8 lg:col-span-7">
              <MyHealthMock fragment="log-reading" />
              <MyHealthMock fragment="today-meds" />
            </div>
          </div>
        </Section>

        <footer className="border-border text-muted-foreground text-caption flex flex-wrap items-center justify-between gap-2 border-t pt-6 font-normal">
          <span>
            Source of truth: <code className="text-foreground font-mono">DESIGN-medsync.md</code> ·
            tokens in <code className="text-foreground font-mono">app/globals.css</code>
          </span>
          <span>MedSync Chroma · ADR 0162 · 2026-09-26</span>
        </footer>
      </main>
    </div>
  );
}
