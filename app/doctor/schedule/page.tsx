import type { Metadata } from "next";

import { AutoRefresh } from "@/app/reception/_components/auto-refresh";
import { SectionRule } from "@/components/medsync/panel";
import { Pill } from "@/components/ui/data-table";
import { requireDoctorScope } from "@/lib/doctor/scope";
import { emrV1LiveFor } from "@/lib/emr/feature";
import { encounterEngineLive } from "@/lib/encounter/feature";
import { fetchClinicianCalendarEvents } from "@/lib/scheduling/calendar";
import {
  fetchClinicianAvailabilityBlocks,
  fetchDepartmentQueueToday,
  fetchEffectiveSchedulingSettings,
  fetchPendingApprovals,
  fetchSchedulingStats,
} from "@/lib/scheduling/doctor";
import { DEFAULT_TIME_ZONE, startOfLocalDay } from "@/supabase/functions/_shared/slots";
import { AvailabilitySheetButton } from "./_components/availability-sheet";
import { DoctorCalendar } from "./_components/doctor-calendar";
import { PendingApprovalsRail } from "./_components/pending-rail";
import { QueueRail } from "./_components/queue-rail";
import { SchedulingSettingsSheet } from "./_components/settings-sheet";
import { StatRail } from "./_components/stat-rail";

export const metadata: Metadata = { title: "Schedule · Doctor · MedSync" };
export const dynamic = "force-dynamic";

/** `rangeEnd` is exclusive everywhere below, so the label names the last day actually fetched. */
function formatWindowDate(d: Date, exclusiveEnd = false): string {
  const shown = exclusiveEnd ? new Date(d.getTime() - 86_400_000) : d;
  // The hospital's calendar, not the host's: on a UTC host these instants are
  // EAT midnights and would otherwise print the previous day.
  return shown.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: DEFAULT_TIME_ZONE,
  });
}

export default async function DoctorSchedulePage() {
  const scope = await requireDoctorScope();

  // Hospital-local midnights (not the host's), a week back and a fortnight on.
  const now = new Date().getTime();
  const rangeStart = startOfLocalDay(new Date(now - 7 * 86_400_000), DEFAULT_TIME_ZONE);
  const rangeEnd = startOfLocalDay(new Date(now + 14 * 86_400_000), DEFAULT_TIME_ZONE);

  const [events, stats, pending, queue, settings, availabilityBlocks] = await Promise.all([
    fetchClinicianCalendarEvents({
      clinicianUserId: scope.userId,
      hospitalId: scope.hospitalId,
      rangeStart,
      rangeEnd,
    }),
    fetchSchedulingStats({
      clinicianUserId: scope.userId,
      hospitalId: scope.hospitalId,
      rangeStart,
      rangeEnd,
    }),
    fetchPendingApprovals({
      clinicianUserId: scope.userId,
      hospitalId: scope.hospitalId,
      limit: 20,
    }),
    fetchDepartmentQueueToday({
      departmentId: scope.departmentId,
      viewer: { userId: scope.userId, hospitalId: scope.hospitalId },
    }),
    fetchEffectiveSchedulingSettings({
      clinicianUserId: scope.userId,
      hospitalId: scope.hospitalId,
      departmentId: scope.departmentId,
    }),
    fetchClinicianAvailabilityBlocks({
      clinicianUserId: scope.userId,
      hospitalId: scope.hospitalId,
      limit: 50,
    }),
  ]);

  const windowLabel = `${formatWindowDate(rangeStart)} – ${formatWindowDate(rangeEnd, true)}`;

  return (
    // The page flows: title, the strip, then the calendar at its fixed height
    // beside its two rails (xl+; under them below), each rail capped at that
    // height and scrolling inside. The shell's sidebar sits to the left on lg+.
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
            <span aria-hidden className="bg-iris-icon ring-iris-edge size-1 rounded-full ring-2" />
            {scope.hospitalName} · {scope.departmentName}
          </span>
          {/* The one setting that changes what the page does, said in a word. */}
          <Pill tone={settings.autoConfirm ? "stable" : "neutral"}>
            {settings.autoConfirm ? "Auto-confirm on" : "Manual approval"}
          </Pill>
          {/* Check-ins and calls show without a reload (ADR 0476): the reception boards' poll. */}
          <AutoRefresh everyMs={15_000} />
        </div>
        <SectionRule
          title="Your week"
          action={
            <SchedulingSettingsSheet
              defaults={{
                autoConfirm: settings.autoConfirm,
                defaultSlotMinutes: settings.defaultSlotMinutes,
                bufferMinutes: settings.bufferMinutes,
                allowVirtual: settings.allowVirtual,
                allowOutOfHoursOverride: settings.allowOutOfHoursOverride,
                usingDefaults: settings.usingDefaults,
              }}
            />
          }
        />
      </header>

      <StatRail stats={stats} windowLabel={windowLabel} />

      {/* The rails sit beside the calendar from 1280px, where the week keeps ~120px
          columns; below it they go underneath so the week's columns stay readable. */}
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <DoctorCalendar
          events={events}
          windowLabel={windowLabel}
          action={<AvailabilitySheetButton blocks={availabilityBlocks} />}
        />
        <div className="grid min-w-0 content-start gap-4 md:grid-cols-2 xl:flex xl:flex-col">
          {!settings.autoConfirm ? <PendingApprovalsRail rows={pending} /> : null}
          <QueueRail
            entries={queue}
            encounterEngineLive={encounterEngineLive()}
            emrLive={emrV1LiveFor(scope.hospitalId)}
            viewerUserId={scope.userId}
          />
        </div>
      </div>
    </div>
  );
}
