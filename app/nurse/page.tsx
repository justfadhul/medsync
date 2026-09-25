import type { Metadata } from "next";
import Link from "next/link";
import {
  ActivityIcon,
  CalendarClockIcon,
  CheckSquareIcon,
  ClipboardPenIcon,
  HeartPulseIcon,
  PillIcon,
  ScrollTextIcon,
  UsersIcon,
} from "lucide-react";

import { IncomingIntakesPanel } from "@/components/intake/incoming-panel";
import { fetchHospitalIncomingIntakes } from "@/lib/intake/queries";
import { requireNurseScope } from "@/lib/nurse/scope";

export const metadata: Metadata = { title: "Overview · Nurse · MedSync" };
export const dynamic = "force-dynamic";

/**
 * Nurse overview. GATE B ships this as a calm landing page —
 * directional links into the real working surfaces (Patients, Record
 * vitals, Medications, Handover) + honest placeholders for the rest.
 */
export default async function NurseOverviewPage() {
  const scope = await requireNurseScope();
  const firstName = scope.fullName?.split(" ")[0];

  const incoming = await fetchHospitalIncomingIntakes({
    hospitalId: scope.hospitalId,
    departmentId: scope.departmentId,
    limit: 10,
  });

  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8 lg:py-10">
      {/* Quiet atmosphere — a 5% teal wash behind the header, nothing louder. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(80%_100%_at_50%_0%,rgba(159,47,126,0.05),transparent_70%)]"
      />

      <header className="reveal-up flex flex-col gap-2">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
          <span
            aria-hidden
            className="pulse-dot bg-brand-500 ring-brand-500/20 size-1 rounded-full ring-2"
          />
          {scope.hospitalName} · {scope.departmentName}
        </span>
        <h1 className="font-display text-foreground text-heading-l leading-[1.15] font-medium tracking-[-0.015em] lg:text-[32px]">
          {firstName ? `Welcome, ${firstName}.` : "Welcome."}
        </h1>
        <p className="text-muted-foreground max-w-[60ch] text-[13.5px] leading-relaxed">
          Your bedside workspace. Your patient panel + vitals recording + medication administration
          are live; the rest of the surfaces land as their supporting engines (monitoring,
          care-team, prescribing) ship.
        </p>
      </header>

      {/* Incoming intakes for this department */}
      <div className="reveal-up" style={{ animationDelay: "70ms" }}>
        <IncomingIntakesPanel
          rows={incoming}
          departmentName={scope.departmentName}
          triageHref="/nurse/triage"
        />
      </div>

      <section className="stagger-children grid gap-3 sm:grid-cols-2">
        <DirectionCard
          href="/nurse/patients"
          title="Patient panel"
          subtitle="Assigned patients + ward census"
          Icon={UsersIcon}
          tone="primary"
        />
        <DirectionCard
          href="/nurse/observations"
          title="Record vitals"
          subtitle="Quick obs for an assigned patient"
          Icon={HeartPulseIcon}
          tone="muted"
        />
        <DirectionCard
          href="/nurse/mar"
          title="Medications"
          subtitle="Administer + document, 5-rights"
          Icon={PillIcon}
          tone="muted"
        />
        <DirectionCard
          href="/nurse/handover"
          title="Handover"
          subtitle="Submit + read shift handover"
          Icon={ScrollTextIcon}
          tone="muted"
        />
        {scope.isInCharge ? (
          <DirectionCard
            href="/nurse/assignments"
            title="Assignment board"
            subtitle="Pair patients to nurses on shift"
            Icon={ClipboardPenIcon}
            tone="muted"
          />
        ) : null}
        <PlaceholderCard
          title="Alerts"
          subtitle="Lands when the monitoring engine ships"
          Icon={ActivityIcon}
        />
        <PlaceholderCard
          title="Schedule + queue"
          subtitle="Ward day view + queue arrives next gate"
          Icon={CalendarClockIcon}
        />
        <PlaceholderCard
          title="Tasks"
          subtitle="Due obs, due meds, mentions"
          Icon={CheckSquareIcon}
        />
      </section>
    </div>
  );
}

function DirectionCard({
  href,
  title,
  subtitle,
  Icon,
  tone,
}: {
  href: string;
  title: string;
  subtitle: string;
  Icon: typeof UsersIcon;
  tone: "primary" | "muted";
}) {
  return (
    <Link
      href={href}
      className={
        tone === "primary"
          ? "group card-lift tap bg-foreground text-background hover:bg-foreground/90 flex items-start gap-3 rounded-xl p-5 transition-colors"
          : "group card-lift tap border-border bg-card hover:bg-muted/30 flex items-start gap-3 rounded-xl border p-5 transition-colors"
      }
    >
      <span
        aria-hidden
        className={
          tone === "primary"
            ? "bg-background/15 text-background inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-transform duration-200 group-hover:scale-105"
            : "bg-muted text-foreground/80 group-hover:bg-brand-50 group-hover:text-brand-700 dark:group-hover:bg-brand-950/40 dark:group-hover:text-brand-300 inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-colors duration-200"
        }
      >
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[14.5px] font-medium">{title}</span>
        <span
          className={
            tone === "primary"
              ? "text-background/70 text-[12px]"
              : "text-muted-foreground text-[12px]"
          }
        >
          {subtitle}
        </span>
      </span>
      <span
        aria-hidden
        className={
          tone === "primary"
            ? "text-background/50 text-body-s self-center transition-transform duration-200 group-hover:translate-x-0.5"
            : "text-muted-foreground/50 group-hover:text-foreground/70 text-body-s self-center transition-all duration-200 group-hover:translate-x-0.5"
        }
      >
        →
      </span>
    </Link>
  );
}

function PlaceholderCard({
  title,
  subtitle,
  Icon,
}: {
  title: string;
  subtitle: string;
  Icon: typeof UsersIcon;
}) {
  return (
    <div className="border-border bg-card/40 text-muted-foreground flex items-start gap-3 rounded-xl border border-dashed p-5">
      <span
        aria-hidden
        className="bg-muted/60 text-muted-foreground inline-flex size-9 shrink-0 items-center justify-center rounded-full"
      >
        <Icon className="size-4" />
      </span>
      <span className="flex flex-col">
        <span className="text-foreground/80 text-[14.5px] font-medium">{title}</span>
        <span className="text-[12px]">{subtitle}</span>
      </span>
    </div>
  );
}
