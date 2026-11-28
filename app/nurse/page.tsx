import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
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
import { CautionNotice } from "@/components/medsync/caution-notice";
import { StaffNotices } from "@/components/medsync/staff-notices";
import { Kpis, NextUp, PatientRows } from "@/components/nurse-ward/screens";
import { WardPage } from "@/components/nurse-ward/ui";
import { NURSE_TASKS_COPY } from "@/content/nurse-tasks";
import { WARDS } from "@/content/pharmacy-stores-wards";
import { nurseTasksLiveFor } from "@/lib/emr/feature";
import { fetchHospitalIncomingIntakes } from "@/lib/intake/queries";
import { isTetherHost } from "@/lib/landing/feature";
import { myNotices } from "@/lib/notices/read";
import { loadDeskFrame } from "@/lib/nurse/desk-frame";
import { nurseWardV2LiveFor } from "@/lib/nurse/feature";
import { requireNurseScope } from "@/lib/nurse/scope";
import { isWardNurse } from "@/lib/nurse/ward-desk";
import { loadWardOverview } from "@/lib/nurse/ward-overview";
import { nurseWardNotices } from "@/lib/nurse/ward-stock";
import { careRequestsLiveFor } from "@/lib/requests/feature";
import { WardFiguresPanel } from "./_components/ward-figures";

export const metadata: Metadata = { title: "Overview · Nurse · MedSync" };
export const dynamic = "force-dynamic";

/**
 * Nurse overview. GATE B ships this as a calm landing page —
 * directional links into the real working surfaces (Patients, Record
 * vitals, Medications, Handover) + honest placeholders for the rest.
 */
export default async function NurseOverviewPage() {
  const scope = await requireNurseScope();
  // ADR 0547: on Tether only a ward nurse of a hospital with the ward desk on stays; the rest work the clinic floor.
  if (
    isTetherHost((await headers()).get("host")) &&
    !(nurseWardV2LiveFor(scope.hospitalId) && (await isWardNurse(scope)))
  )
    redirect("/clinic");
  if (nurseWardV2LiveFor(scope.hospitalId)) return <WardOverview />;
  const firstName = scope.fullName?.split(" ")[0];

  const incoming = await fetchHospitalIncomingIntakes({
    hospitalId: scope.hospitalId,
    departmentId: scope.departmentId,
    limit: 10,
  });
  // Pharmacy Phase 2 (5.7): recall notices for the nurse's wards; staff-facing, never a patient.
  const notices = await nurseWardNotices(scope);
  // ADR 0546 Phase 1: the in-charge's ward figures, with the ward desk on.
  const wardFigures = await loadWardOverview(scope);
  // Care requests (ADR 0533): the nurse in charge's admission notices; flag off, none are read.
  const incomingNotices = careRequestsLiveFor(scope.hospitalId)
    ? await myNotices(scope.userId, ["ward_incoming"])
    : [];

  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8 lg:py-10">
      {/* Quiet atmosphere — a 5% teal wash behind the header, nothing louder. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(80%_100%_at_50%_0%,rgba(159,47,126,0.05),transparent_70%)]"
      />

      <header className="reveal-up flex flex-col gap-2">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
          <span aria-hidden className="bg-iris-icon ring-iris-edge size-1 rounded-full ring-2" />
          {scope.hospitalName} · {scope.departmentName}
        </span>
        <h1 className="font-display text-display-s text-foreground">
          {firstName ? `Welcome, ${firstName}.` : "Welcome."}
        </h1>
        <p className="text-muted-foreground max-w-[60ch] text-[13.5px] leading-relaxed">
          Your bedside workspace. Your patient panel + vitals recording + medication administration
          are live; the rest of the surfaces land as their supporting engines (monitoring,
          care-team, prescribing) ship.
        </p>
      </header>

      <WardFiguresPanel wards={wardFigures} />
      {nurseWardV2LiveFor(scope.hospitalId) ? (
        <nav aria-label="Ward desk" className="flex flex-wrap gap-2">
          {(
            [
              ["/nurse/tasks", "To do"],
              ["/nurse/cosign-queue", "Round and co-sign"],
              ["/nurse/handover/sbar", "SBAR handover"],
              ["/nurse/calendar", "Calendar"],
              ["/nurse/leave", "Leave"],
              ["/nurse/incidents", "Report an incident"],
            ] as const
          ).map(([href, text]) => (
            <Link
              key={href}
              href={href}
              className="border-border bg-card hover:bg-muted text-body-s text-foreground rounded-full border px-3 py-1.5"
            >
              {text}
            </Link>
          ))}
        </nav>
      ) : null}

      {notices.length ? (
        <CautionNotice lead={WARDS.notices.title}>
          <ul className="flex flex-col gap-1">
            {notices.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/nurse/ward-stock?location=${n.locationId}`}
                  className="underline-offset-4 hover:underline"
                >
                  {n.ward}
                </Link>
                : {WARDS.notices.line(n.product, n.batchNumber)}
              </li>
            ))}
          </ul>
        </CautionNotice>
      ) : null}

      <StaffNotices notices={incomingNotices} />

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
        {nurseTasksLiveFor(scope.hospitalId) ? (
          <DirectionCard
            href="/nurse/tasks"
            title={NURSE_TASKS_COPY.title}
            subtitle={NURSE_TASKS_COPY.kicker}
            Icon={CheckSquareIcon}
            tone="muted"
          />
        ) : (
          <PlaceholderCard
            title="Tasks"
            subtitle="Due obs, due meds, mentions"
            Icon={CheckSquareIcon}
          />
        )}
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
          : "group card-lift tap border-border bg-card hover:bg-muted/30 flex items-start gap-3 rounded-lg border p-5 transition-colors"
      }
    >
      <span
        aria-hidden
        className={
          tone === "primary"
            ? "bg-background/15 text-background inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-transform duration-200 group-hover:scale-105"
            : "bg-muted text-foreground/80 group-hover:bg-iris-tint group-hover:text-iris-icon inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-colors duration-200"
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
    <div className="border-border bg-card/40 text-muted-foreground flex items-start gap-3 rounded-lg border border-dashed p-5">
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

/** ADR 0546: prototype v82's Ward overview, the in-charge's home; any other nurse's home is My patients. */
async function WardOverview() {
  const f = await loadDeskFrame();
  if (!f.inCharge) redirect("/nurse/patients");
  const wards = await loadWardOverview(await requireNurseScope());
  const now = new Date();
  const w = wards[0];
  const em = f.list.filter((p) => p.news.emergency);
  return (
    <WardPage
      title={f.wardName}
      now={now}
      stats={[
        [w?.beds ? `${w.beds.occupied}/${w.beds.usable}` : "—", "beds full"],
        [f.overdue, "overdue"],
        [em.length, "need emergency review"],
        [w?.waitingForBed ?? "—", "waiting for a bed"],
      ]}
    >
      {wards.map((x) => (
        <Kpis key={x.wardId} f={x} />
      ))}
      <NextUp items={f.todo} now={now} />
      <PatientRows
        now={now}
        empty="No patients on the ward list."
        groups={[
          ["Emergency review", "the signed emergency band", em],
          ["Everyone else", "sickest first", f.list.filter((p) => !p.news.emergency)],
        ]}
      />
    </WardPage>
  );
}
