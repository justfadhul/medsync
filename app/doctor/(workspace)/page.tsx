import type { Metadata } from "next";
import Link from "next/link";
import {
  ActivityIcon,
  ArrowRightIcon,
  CalendarClockIcon,
  CheckSquareIcon,
  ClipboardListIcon,
  GraduationCapIcon,
  ListChecksIcon,
  StethoscopeIcon,
  UsersIcon,
} from "lucide-react";

import { IncomingIntakesPanel } from "@/components/intake/incoming-panel";
import {
  getMySupervisor,
  listMyCosignRequests,
  listPendingCosignRequests,
} from "@/lib/doctor/cosign";
import { requireDoctorScope } from "@/lib/doctor/scope";
import { fetchHospitalIncomingIntakes } from "@/lib/intake/queries";
import { doctorWorkspace } from "@/lib/workspace/feature";
import { Workspace } from "../_components/workspace/workspace";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const scope = await requireDoctorScope();
  return {
    title: doctorWorkspace(scope.hospitalId)
      ? "Workspace · Doctor · MedSync"
      : "Overview · Doctor · MedSync",
  };
}

/**
 * /doctor — with DOCTOR_WORKSPACE on for this hospital, the Workspace (the one
 * board that replaces Triage, Assigned, Encounters and the Resus board); off,
 * the Overview exactly as before.
 */
export default async function DoctorHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const scope = await requireDoctorScope();
  if (!doctorWorkspace(scope.hospitalId)) return <DoctorOverview />;
  const { scope: scopeParam } = await searchParams;
  return (
    <Workspace scope={scope} scopeMode={scopeParam === "department" ? "department" : "mine"} />
  );
}

/**
 * Doctor workspace overview — different shapes per cadre:
 *
 *   Junior (intern / clinical officer):
 *     - Supervisor card (who supervises me)
 *     - My pending co-sign requests (decisions outstanding)
 *
 *   Senior (MO+):
 *     - Pending review queue count (drills into /doctor/cosign-queue)
 *
 *   Consultant (MOSG / Consultant / Senior Consultant):
 *     - Supervisees card + review queue
 *
 * The "directional" surface cards land for everyone (patient panel +
 * placeholders for engines that haven't shipped).
 */
/** The Overview, unchanged — what /doctor shows while the workspace flag is off. */
async function DoctorOverview() {
  const scope = await requireDoctorScope();
  const firstName = scope.fullName?.split(" ")[0];

  // Cadre-conditional fetches + the dept incoming-intake list.
  const [supervisor, myRequests, pendingForMe, incoming] = await Promise.all([
    scope.isJunior ? getMySupervisor({ superviseeAffiliationId: scope.affiliationId }) : null,
    scope.isJunior
      ? listMyCosignRequests({
          doctorUserId: scope.userId,
          hospitalId: scope.hospitalId,
          limit: 5,
        })
      : [],
    scope.isSenior ? listPendingCosignRequests({ hospitalId: scope.hospitalId }) : [],
    fetchHospitalIncomingIntakes({
      hospitalId: scope.hospitalId,
      departmentId: scope.departmentId,
      limit: 10,
    }),
  ]);

  return (
    <div className="relative">
      {/* Quiet teal atmosphere behind the header */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(90%_100%_at_50%_0%,rgba(159,47,126,0.05),transparent_70%)]"
      />

      <div className="stagger-children relative mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8 lg:py-10">
        <header className="flex flex-col gap-2">
          <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
            <span aria-hidden className="bg-iris-icon ring-iris-edge size-1 rounded-full ring-2" />
            {scope.hospitalName} · {scope.departmentName}
          </span>
          <h1 className="font-display text-display-s text-foreground text-balance">
            {firstName ? `Welcome, ${firstName}.` : "Welcome."}
          </h1>
          <p className="text-muted-foreground max-w-[60ch] text-[13.5px] leading-relaxed">
            Your clinical workspace, scoped to {scope.departmentName} at {scope.hospitalName}.
          </p>
        </header>

        {/* ── Cadre-specific top row ───────────────────────────── */}
        {scope.isJunior ? (
          <SupervisorCard
            supervisor={supervisor}
            myPendingCount={myRequests.filter((r) => r.state === "pending_review").length}
          />
        ) : null}

        {scope.isSenior ? <SeniorReviewCard pendingCount={pendingForMe.length} /> : null}

        {/* ── Incoming intakes for this department ─────────────── */}
        <IncomingIntakesPanel rows={incoming} departmentName={scope.departmentName} />

        {/* ── Directional surface cards ────────────────────────── */}
        <section className="grid gap-3 sm:grid-cols-2">
          <DirectionCard
            href="/doctor/patients"
            title="Patient panel"
            subtitle="Care-team, encounters, and your department"
            Icon={UsersIcon}
            tone="primary"
          />
          <DirectionCard
            href="/doctor/schedule"
            title="Schedule"
            subtitle="Today + upcoming · availability"
            Icon={CalendarClockIcon}
            tone="muted"
          />
          <PlaceholderCard
            title="Alerts"
            subtitle="Lands when the monitoring engine ships"
            Icon={ActivityIcon}
          />
          {/* Where visits are called and ended (ADR 0101 R3) — live whether or
              not the encounter engine is, so no longer a placeholder. */}
          <DirectionCard
            href="/doctor/schedule"
            title="Today's queue"
            subtitle="Call the next patient · end a visit"
            Icon={StethoscopeIcon}
            tone="muted"
          />
          <PlaceholderCard
            title="Care team"
            subtitle="Lands with the care-team workspace"
            Icon={ClipboardListIcon}
          />
          <PlaceholderCard
            title="Tasks"
            subtitle="Notes, mentions, follow-ups"
            Icon={CheckSquareIcon}
          />
        </section>
      </div>
    </div>
  );
}

/* ── Cadre-specific cards ─────────────────────────────────────── */

function SupervisorCard({
  supervisor,
  myPendingCount,
}: {
  supervisor: Awaited<ReturnType<typeof getMySupervisor>>;
  myPendingCount: number;
}) {
  return (
    <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-5">
      <h2 className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">
        Your supervisor
      </h2>

      {supervisor ? (
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="bg-iris-tint text-iris-icon ring-iris-edge inline-flex size-10 items-center justify-center rounded-full ring-1"
          >
            <GraduationCapIcon className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="text-foreground text-[14px] font-medium">
              {supervisor.supervisorName ?? "Supervisor"}
            </span>
            <span className="text-muted-foreground text-[12px]">{supervisor.cadreName}</span>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground max-w-[56ch] text-[12.5px] leading-relaxed">
          No primary supervisor paired yet — your flagged actions will route to any consultant in
          your department until your hospital admin assigns one.
        </p>
      )}

      {myPendingCount > 0 ? (
        <p className="text-muted-foreground text-[12px] leading-relaxed">
          <span className="text-foreground font-medium">{myPendingCount}</span>{" "}
          {myPendingCount === 1 ? "request" : "requests"} you&rsquo;ve sent are awaiting review.
        </p>
      ) : null}
    </section>
  );
}

function SeniorReviewCard({ pendingCount }: { pendingCount: number }) {
  return (
    <Link
      href="/doctor/cosign-queue"
      className={
        pendingCount > 0
          ? "group card-lift border-teal-edge bg-teal-tint flex items-center gap-3 rounded-lg border p-5 hover:border-teal-200"
          : "group card-lift border-border bg-card flex items-center gap-3 rounded-lg border p-5"
      }
    >
      <span
        aria-hidden
        className={
          pendingCount > 0
            ? "ease-spring bg-brand-100 text-brand-700 ring-brand-200/70 dark:bg-brand-900/40 dark:text-brand-300 dark:ring-brand-800/40 inline-flex size-10 items-center justify-center rounded-full ring-1 transition-transform duration-200 group-hover:scale-105"
            : "bg-muted text-foreground/80 ease-spring inline-flex size-10 items-center justify-center rounded-full transition-transform duration-200 group-hover:scale-105"
        }
      >
        <ListChecksIcon className="size-5" />
      </span>
      <div className="flex flex-1 flex-col">
        <span className="text-foreground text-[14.5px] font-medium">Review queue</span>
        <span className="text-muted-foreground text-[12px]">
          {pendingCount === 0
            ? "Nothing waiting for your review"
            : `${pendingCount} junior action${pendingCount === 1 ? "" : "s"} awaiting your co-sign`}
        </span>
      </div>
      {pendingCount > 0 ? (
        <span className="scale-in bg-brand-600/10 text-brand-700 dark:text-brand-300 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 font-mono text-[12px] font-semibold tabular-nums">
          {pendingCount}
        </span>
      ) : null}
      <ArrowRightIcon
        aria-hidden
        className="text-muted-foreground size-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5"
      />
    </Link>
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
          ? "group card-lift bg-foreground text-background hover:bg-foreground/90 flex items-start gap-3 rounded-xl p-5 transition-colors"
          : "group card-lift border-border bg-card flex items-start gap-3 rounded-lg border p-5"
      }
    >
      <span
        aria-hidden
        className={
          tone === "primary"
            ? "bg-background/15 text-background ease-spring inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-transform duration-200 group-hover:scale-105"
            : "bg-muted text-foreground/80 ease-spring inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-transform duration-200 group-hover:scale-105"
        }
      >
        <Icon className="size-4" />
      </span>
      <span className="flex flex-1 flex-col">
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
      <ArrowRightIcon
        aria-hidden
        className={
          tone === "primary"
            ? "text-background/60 size-4 shrink-0 -translate-x-1 self-center opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100"
            : "text-muted-foreground size-4 shrink-0 -translate-x-1 self-center opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100"
        }
      />
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
