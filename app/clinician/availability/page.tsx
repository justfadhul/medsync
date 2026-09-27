import type { AvailabilityKind } from "@/db/schema/scheduling";
import type { Metadata } from "next";
import { and, asc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";

import { db } from "@/db";
import {
  appointments,
  availabilityBlocks,
  clinicianSchedulingSettings,
  departmentSchedulingPolicy,
} from "@/db/schema/scheduling";
import { requireClinicianScope } from "@/lib/clinician/scope";
import {
  buildSlots,
  DEFAULT_TIME_ZONE,
  LIVE_APPOINTMENT_STATUSES,
  resolveSchedulingSettings,
  startOfLocalDay,
} from "@/supabase/functions/_shared/slots";
import { AvailabilityList } from "./_components/availability-list";
import { SettingsPanel } from "./_components/settings-panel";
import { SlotPreview } from "./_components/slot-preview";

export const metadata: Metadata = {
  title: "Availability · MedSync",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Same horizon `/patient/book` offers over. The preview claims to show what
 * a patient will be offered, so it has to be windowed the way the patient's
 * own query is — a different number of days would be a different claim.
 */
const LOOKAHEAD_DAYS = 14;

interface PageProps {
  searchParams: Promise<{ block?: string; new?: string }>;
}

export interface AvailabilityRow {
  id: string;
  kind: AvailabilityKind;
  startsAtIso: string;
  endsAtIso: string;
  recurrence: string;
  recurrenceWeekday: number | null;
  recurrenceUntilIso: string | null;
  location: string | null;
  notes: string | null;
  /** ADR 0095: the clinician's own name for a `custom` block; null otherwise. */
  label: string | null;
}

export interface SettingsRow {
  autoConfirm: boolean;
  defaultSlotMinutes: number;
  bufferMinutes: number;
  allowVirtual: boolean;
  allowOutOfHoursOverride: boolean;
}

const DEFAULT_SETTINGS: SettingsRow = {
  autoConfirm: false,
  defaultSlotMinutes: 15,
  bufferMinutes: 0,
  allowVirtual: false,
  allowOutOfHoursOverride: true,
};

export default async function AvailabilityPage({ searchParams }: PageProps) {
  const scope = await requireClinicianScope();
  const params = await searchParams;

  const now = new Date();
  const until = new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000);

  const [blocks, settingsRow, policyRow, liveAppointments] = await Promise.all([
    fetchAvailability(scope.userId, scope.hospitalId),
    fetchSettings(scope.userId, scope.hospitalId),
    fetchDepartmentPolicy(scope.departmentId),
    fetchLiveAppointments(scope.userId, now, until),
  ]);

  const settings: SettingsRow = settingsRow ?? DEFAULT_SETTINGS;

  // The engine's answer, derived from the same rows `pt-request-appointment`
  // derives from: every kind (leave and unavailable subtract, and every
  // overlapping window is needed to suppress a double offer), this
  // department's blocks plus the hospital-wide ones, and the clinician's
  // live appointments everywhere — they are one person.
  const slots = buildSlots({
    blocks: blocks.rows.filter(
      (b) => b.departmentId === null || b.departmentId === scope.departmentId,
    ),
    appointments: liveAppointments,
    clinicianSettings: settingsRow,
    departmentPolicy: policyRow,
    timeZone: DEFAULT_TIME_ZONE,
    now,
    rangeStart: now,
    rangeEnd: until,
  });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="reveal-up flex flex-col gap-2">
        <span className="text-muted-foreground text-overline inline-flex w-fit items-center gap-1.5 font-mono uppercase">
          <span aria-hidden className="bg-iris-icon ring-iris-edge size-1 rounded-full ring-2" />
          {scope.hospitalName} · {scope.departmentName}
        </span>
        <h1 className="font-display text-display-s text-foreground">Your availability</h1>
        <p className="text-muted-foreground text-body-s max-w-2xl leading-relaxed">
          Declare your bookable hours, mark out your teaching, ward rounds and admin, and choose
          whether requests confirm automatically or wait for your approval.
        </p>
        <div className="bg-ink-300 h-px w-10" aria-hidden />
      </header>

      <div className="reveal-up" style={{ animationDelay: "70ms" }}>
        <SettingsPanel settings={settings} usingDefaults={!settingsRow} />
      </div>

      <SlotPreview
        slots={slots}
        effective={resolveSchedulingSettings(settingsRow, policyRow)}
        source={settingsRow ? "clinician" : policyRow ? "department" : "hard-default"}
        policy={policyRow}
        departmentName={scope.departmentName}
        kindCounts={blocks.kindCounts}
        rangeStart={now}
        days={LOOKAHEAD_DAYS}
      />

      <AvailabilityList
        blocks={blocks.rows}
        selectedBlockId={params.block ?? null}
        isCreatingNew={params.new === "1"}
      />
    </div>
  );
}

/* ─── Data fetchers ────────────────────────────────────────────────── */

/**
 * One row, two consumers: the `*Iso` fields render the list, the rest are
 * the shape `buildSlots` reads. Fetching twice would be two chances to
 * disagree about which blocks exist.
 */
type BlockRow = AvailabilityRow & {
  departmentId: string | null;
  state: string;
  startsAt: Date;
  endsAt: Date;
  recurrenceUntil: Date | null;
};

interface AvailabilityFetch {
  rows: BlockRow[];
  /** How many ACTIVE blocks of each kind — the preview explains itself with these. */
  kindCounts: Record<string, number>;
}

async function fetchAvailability(
  clinicianUserId: string,
  hospitalId: string,
): Promise<AvailabilityFetch> {
  // From the start of today — the hospital's, not the host's — so a block
  // finishing this morning is still editable, and every live weekly
  // template regardless of its anchor.
  const dayStart = startOfLocalDay(new Date(), DEFAULT_TIME_ZONE);

  const rows = await db
    .select({
      id: availabilityBlocks.id,
      departmentId: availabilityBlocks.departmentId,
      kind: availabilityBlocks.kind,
      state: availabilityBlocks.state,
      startsAt: availabilityBlocks.startsAt,
      endsAt: availabilityBlocks.endsAt,
      recurrence: availabilityBlocks.recurrence,
      recurrenceWeekday: availabilityBlocks.recurrenceWeekday,
      recurrenceUntil: availabilityBlocks.recurrenceUntil,
      location: availabilityBlocks.location,
      notes: availabilityBlocks.notes,
      label: availabilityBlocks.label,
    })
    .from(availabilityBlocks)
    .where(
      and(
        eq(availabilityBlocks.clinicianUserId, clinicianUserId),
        eq(availabilityBlocks.hospitalId, hospitalId),
        eq(availabilityBlocks.state, "active"),
        or(
          gte(availabilityBlocks.endsAt, dayStart),
          // A weekly block's own `starts_at` is the template — often months
          // back — so windowing on it hid live recurring series from this
          // list and from the derivation below. Window the SERIES instead.
          and(
            eq(availabilityBlocks.recurrence, "weekly"),
            or(
              isNull(availabilityBlocks.recurrenceUntil),
              gte(availabilityBlocks.recurrenceUntil, dayStart),
            ),
          ),
        ),
      ),
    )
    .orderBy(asc(availabilityBlocks.startsAt));

  const kindCounts: Record<string, number> = {};
  for (const r of rows) kindCounts[r.kind] = (kindCounts[r.kind] ?? 0) + 1;

  return {
    kindCounts,
    rows: rows.map((r) => ({
      id: r.id,
      departmentId: r.departmentId,
      kind: r.kind as AvailabilityKind,
      // `state` is carried for the engine, which does its own filtering.
      state: r.state,
      startsAtIso: r.startsAt.toISOString(),
      endsAtIso: r.endsAt.toISOString(),
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      recurrence: r.recurrence,
      recurrenceWeekday: r.recurrenceWeekday ?? null,
      recurrenceUntil: r.recurrenceUntil,
      recurrenceUntilIso: r.recurrenceUntil ? r.recurrenceUntil.toISOString() : null,
      location: r.location,
      notes: r.notes,
      label: r.label,
    })),
  };
}

async function fetchSettings(clinicianUserId: string, hospitalId: string) {
  // The whole row: `resolveSchedulingSettings` reads four columns and a
  // missing one would read as "no override" instead of as the bug it is.
  const [row] = await db
    .select()
    .from(clinicianSchedulingSettings)
    .where(
      and(
        eq(clinicianSchedulingSettings.clinicianUserId, clinicianUserId),
        eq(clinicianSchedulingSettings.hospitalId, hospitalId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function fetchDepartmentPolicy(departmentId: string) {
  const [row] = await db
    .select()
    .from(departmentSchedulingPolicy)
    .where(eq(departmentSchedulingPolicy.departmentId, departmentId))
    .limit(1);
  return row ?? null;
}

async function fetchLiveAppointments(clinicianUserId: string, from: Date, until: Date) {
  // Deliberately NOT scoped to the hospital, matching the write path: a
  // clinician booked at their other hospital is still one person, and a
  // preview that ignored those would offer time `checkSlot` refuses.
  return db
    .select({ startsAt: appointments.startsAt, endsAt: appointments.endsAt })
    .from(appointments)
    .where(
      and(
        eq(appointments.clinicianUserId, clinicianUserId),
        inArray(appointments.status, [...LIVE_APPOINTMENT_STATUSES]),
        gte(appointments.endsAt, from),
        lt(appointments.startsAt, until),
      ),
    );
}
