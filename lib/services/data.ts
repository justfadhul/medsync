import "server-only";

import type { Audience, ProfileInput } from "./profile";
import type {
  AvailabilityEvent,
  CapabilityRow,
  DepartmentKind,
  Offering,
  OpenProblem,
} from "@/supabase/functions/_shared/services-hub";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { clinicSessions, sessionTemplates } from "@/db/schema/clinic-sessions";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { testCatalogue } from "@/db/schema/emr";
import { hospitalApplications } from "@/db/schema/hospital-applications";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitalWards } from "@/db/schema/hospital-wards";
import { hospitals } from "@/db/schema/hospitals";
import { wardInChargeAssignments } from "@/db/schema/nurse-workspace";
import { cadres } from "@/db/schema/reference-data";
import { saAuditLog } from "@/db/schema/sa-audit-log";
import { serviceLines } from "@/db/schema/service-lines";
import {
  availabilityEvents,
  capabilityValues,
  departmentHeads,
  diagnosticOfferings,
  hospitalBeds,
  hospitalPlaces,
  hospitalServicesState,
  publicHolidays,
  serviceClosures,
} from "@/db/schema/services-hub";
import { users } from "@/db/schema/users";
import { sectionName } from "@/lib/lab/test-menu";
import { loadPointsForCapability } from "@/lib/pharmacy/dispensing-points";
import {
  CAPABILITY_KEYS,
  compareToPreset,
  derivedCapabilities,
  derivedPharmacy,
  IMAGING_ITEMS,
  NURSE_CADRE_CODES,
  orderingAvailability,
  projectAvailability,
  signedPresetFor,
  verificationState,
} from "@/supabase/functions/_shared/services-hub";
import { buildCapabilityProfile } from "./profile";

/*
 * Read side of the Departments & services hub. Owner-role Drizzle (bypasses RLS), so EVERY query
 * carries `hospitalId` — the scope the page got from requireHospitalAdminScope (contract §2).
 * Numbers come only from rows (Law 5); nothing here computes occupancy.
 */

const LIVE_AFFILIATION = ["active", "approved"] as const;
const now = () => new Date();

/* ─── departments ───────────────────────────────────────────────────── */

export interface DepartmentRow {
  id: string;
  parentId: string | null;
  name: string;
  kind: DepartmentKind;
  catalogueCode: string | null;
  live: boolean;
  archived: boolean;
  isStart: boolean;
  placeId: string | null;
  serviceHours: string | null;
}

export async function loadDepartments(hospitalId: string): Promise<DepartmentRow[]> {
  const rows = await db
    .select()
    .from(hospitalDepartments)
    .where(eq(hospitalDepartments.hospitalId, hospitalId))
    .orderBy(asc(hospitalDepartments.name));
  return rows.map((d) => ({
    id: d.id,
    parentId: d.parentId,
    name: d.name,
    kind: d.kind as DepartmentKind,
    catalogueCode: d.catalogueCode,
    live: d.medsyncLiveAt !== null,
    archived: d.archivedAt !== null,
    isStart: d.isStart,
    placeId: d.placeId,
    serviceHours: d.serviceHours,
  }));
}

export interface PersonOption {
  userId: string;
  name: string;
  departmentId: string;
  cadre: string | null;
}

/** Approved staff at the hospital, with their department — the pool heads and in-charges come from. */
export async function loadStaffPool(
  hospitalId: string,
): Promise<(PersonOption & { cadreCode: string | null })[]> {
  const rows = await db
    .select({
      userId: staffAffiliations.userId,
      name: users.fullName,
      departmentId: staffAffiliations.departmentId,
      cadre: cadres.name,
      cadreCode: cadres.code,
    })
    .from(staffAffiliations)
    .innerJoin(users, eq(users.id, staffAffiliations.userId))
    .leftJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
    .where(
      and(
        eq(staffAffiliations.hospitalId, hospitalId),
        inArray(staffAffiliations.state, [...LIVE_AFFILIATION]),
      ),
    )
    .orderBy(asc(users.fullName));
  return rows;
}

export interface HeadRow {
  id: string;
  departmentId: string;
  userId: string;
  name: string;
  acting: boolean;
  startsAt: string;
  endsAt: string | null;
}

export async function loadHeads(
  hospitalId: string,
): Promise<{ current: HeadRow[]; history: HeadRow[] }> {
  const rows = await db
    .select({
      id: departmentHeads.id,
      departmentId: departmentHeads.departmentId,
      userId: departmentHeads.userId,
      name: users.fullName,
      acting: departmentHeads.acting,
      startsAt: departmentHeads.startsAt,
      endsAt: departmentHeads.endsAt,
    })
    .from(departmentHeads)
    .leftJoin(users, eq(users.id, departmentHeads.userId))
    .where(eq(departmentHeads.hospitalId, hospitalId))
    .orderBy(desc(departmentHeads.startsAt));
  const t = now().getTime();
  const all = rows.map((r) => ({
    id: r.id,
    departmentId: r.departmentId,
    userId: r.userId,
    name: r.name ?? "Former staff member",
    acting: r.acting,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt?.toISOString() ?? null,
  }));
  const isCurrent = (h: HeadRow) =>
    Date.parse(h.startsAt) <= t && (!h.endsAt || Date.parse(h.endsAt) > t);
  return { current: all.filter(isCurrent), history: all };
}

/** STR-4 counts per department: staff, wards, clinics, future booked sessions. */
export async function loadDepartmentCounts(hospitalId: string) {
  const [staff, wards, clinics, booked] = await Promise.all([
    db
      .select({ id: staffAffiliations.departmentId, n: sql<number>`count(*)::int` })
      .from(staffAffiliations)
      .where(
        and(
          eq(staffAffiliations.hospitalId, hospitalId),
          inArray(staffAffiliations.state, [...LIVE_AFFILIATION, "pending_approval"]),
        ),
      )
      .groupBy(staffAffiliations.departmentId),
    db
      .select({ id: hospitalWards.departmentId, n: sql<number>`count(*)::int` })
      .from(hospitalWards)
      .where(and(eq(hospitalWards.hospitalId, hospitalId), isNull(hospitalWards.archivedAt)))
      .groupBy(hospitalWards.departmentId),
    db
      .select({ id: serviceLines.departmentId, n: sql<number>`count(*)::int` })
      .from(serviceLines)
      .where(and(eq(serviceLines.hospitalId, hospitalId), isNull(serviceLines.archivedAt)))
      .groupBy(serviceLines.departmentId),
    db
      .select({ id: clinicSessions.departmentId, n: sql<number>`count(*)::int` })
      .from(clinicSessions)
      .where(
        and(
          eq(clinicSessions.hospitalId, hospitalId),
          eq(clinicSessions.status, "published"),
          gte(clinicSessions.startsAt, now()),
          sql`${clinicSessions.bookedCount} > 0`,
        ),
      )
      .groupBy(clinicSessions.departmentId),
  ]);
  const toMap = (rows: { id: string | null; n: number }[]) =>
    new Map(rows.filter((r) => r.id).map((r) => [r.id as string, r.n]));
  return {
    staff: toMap(staff),
    wards: toMap(wards),
    clinics: toMap(clinics),
    bookedSessions: toMap(booked),
  };
}

/* ─── places ────────────────────────────────────────────────────────── */

export interface PlaceRow {
  id: string;
  name: string;
  building: string | null;
  floor: string | null;
  room: string | null;
  directions: string | null;
  archived: boolean;
}

export async function loadPlaces(hospitalId: string): Promise<PlaceRow[]> {
  const rows = await db
    .select()
    .from(hospitalPlaces)
    .where(eq(hospitalPlaces.hospitalId, hospitalId))
    .orderBy(asc(hospitalPlaces.name));
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    building: p.building,
    floor: p.floor,
    room: p.room,
    directions: p.directions,
    archived: p.archivedAt !== null,
  }));
}

/* ─── wards & beds ──────────────────────────────────────────────────── */

export interface WardRow {
  id: string;
  name: string;
  departmentId: string | null;
  wardType: string | null;
  sex: string | null;
  ageGroup: string | null;
  placeId: string | null;
  parentWardId: string | null;
  bedCount: number;
  closed: { reason: string; since: string; expectedReopenOn: string | null } | null;
  archived: boolean;
  beds: { id: string; label: string; closedReason: string | null; archived: boolean }[];
  inCharge: { id: string; userId: string; name: string; acting: boolean; since: string }[];
}

export async function loadWards(hospitalId: string): Promise<WardRow[]> {
  const [wards, beds, charges] = await Promise.all([
    db
      .select()
      .from(hospitalWards)
      .where(eq(hospitalWards.hospitalId, hospitalId))
      .orderBy(asc(hospitalWards.name)),
    // Named columns: 0090's layout columns may not exist yet (ADR 0191 §6).
    db
      .select({
        id: hospitalBeds.id,
        wardId: hospitalBeds.wardId,
        label: hospitalBeds.label,
        closedAt: hospitalBeds.closedAt,
        closedReason: hospitalBeds.closedReason,
        archivedAt: hospitalBeds.archivedAt,
      })
      .from(hospitalBeds)
      .where(eq(hospitalBeds.hospitalId, hospitalId))
      .orderBy(asc(hospitalBeds.createdAt)),
    db
      .select({
        id: wardInChargeAssignments.id,
        wardId: wardInChargeAssignments.wardId,
        userId: wardInChargeAssignments.nurseUserId,
        name: users.fullName,
        acting: wardInChargeAssignments.acting,
        startsAt: wardInChargeAssignments.startsAt,
        endsAt: wardInChargeAssignments.endsAt,
      })
      .from(wardInChargeAssignments)
      .leftJoin(users, eq(users.id, wardInChargeAssignments.nurseUserId))
      .where(
        and(
          eq(wardInChargeAssignments.hospitalId, hospitalId),
          or(isNull(wardInChargeAssignments.endsAt), gte(wardInChargeAssignments.endsAt, now())),
        ),
      ),
  ]);
  return wards.map((w) => ({
    id: w.id,
    name: w.name,
    departmentId: w.departmentId,
    wardType: w.wardType,
    sex: w.sex,
    ageGroup: w.ageGroup,
    placeId: w.placeId,
    parentWardId: w.parentWardId,
    bedCount: w.bedCount,
    closed: w.closedAt
      ? {
          reason: w.closedReason ?? "",
          since: w.closedAt.toISOString(),
          expectedReopenOn: w.expectedReopenOn,
        }
      : null,
    archived: w.archivedAt !== null,
    beds: beds
      .filter((b) => b.wardId === w.id)
      .map((b) => ({
        id: b.id,
        label: b.label,
        closedReason: b.closedAt ? b.closedReason : null,
        archived: b.archivedAt !== null,
      })),
    inCharge: charges
      .filter((c) => c.wardId === w.id)
      .map((c) => ({
        id: c.id,
        userId: c.userId,
        name: c.name ?? "Former staff member",
        acting: c.acting,
        since: c.startsAt.toISOString(),
      })),
  }));
}

export const nursingPool = (pool: Awaited<ReturnType<typeof loadStaffPool>>) =>
  pool.filter((p) => (NURSE_CADRE_CODES as readonly string[]).includes(p.cadreCode ?? ""));

/* ─── clinics ───────────────────────────────────────────────────────── */

export interface ClinicRow {
  id: string;
  name: string;
  catalogueCode: string | null;
  departmentId: string;
  unitId: string | null;
  placeId: string | null;
  audience: "patients" | "referral" | "staff";
  confidential: boolean;
  capacityMode: string;
  status: "live" | "planned" | "archived";
  templates: TemplateRow[];
}

export interface TemplateRow {
  id: string;
  weekday: number;
  startMinutesLocal: number;
  durationMinutes: number;
  capacityTotal: number;
  capacityBooked: number;
  validFrom: string;
  validUntil: string | null;
  active: boolean;
  repeatEveryWeeks: number;
  nthWeekday: number | null;
  runsOnHolidays: boolean;
  placeId: string | null;
  venue: string | null;
  clinicianUserId: string | null;
}

export async function loadClinics(hospitalId: string): Promise<ClinicRow[]> {
  const [lines, templates] = await Promise.all([
    db
      .select()
      .from(serviceLines)
      .where(eq(serviceLines.hospitalId, hospitalId))
      .orderBy(asc(serviceLines.name)),
    db
      .select()
      .from(sessionTemplates)
      .where(eq(sessionTemplates.hospitalId, hospitalId))
      .orderBy(asc(sessionTemplates.weekday), asc(sessionTemplates.startMinutesLocal)),
  ]);
  return lines.map((l) => ({
    id: l.id,
    name: l.name,
    catalogueCode: l.catalogueCode,
    departmentId: l.departmentId,
    unitId: l.unitId,
    placeId: l.placeId,
    audience: l.audience as ClinicRow["audience"],
    confidential: l.confidential,
    capacityMode: l.capacityMode,
    status: l.archivedAt ? "archived" : l.active ? "live" : "planned",
    templates: templates
      .filter((t) => t.serviceLineId === l.id)
      .map((t) => ({
        id: t.id,
        weekday: t.weekday,
        startMinutesLocal: t.startMinutesLocal,
        durationMinutes: t.durationMinutes,
        capacityTotal: t.capacityTotal,
        capacityBooked: t.capacityBooked,
        validFrom: t.validFrom,
        validUntil: t.validUntil,
        active: t.active,
        repeatEveryWeeks: t.repeatEveryWeeks,
        nthWeekday: t.nthWeekday,
        runsOnHolidays: t.runsOnHolidays,
        placeId: t.placeId,
        venue: t.venue,
        clinicianUserId: t.clinicianUserId,
      })),
  }));
}

/* ─── calendar ──────────────────────────────────────────────────────── */

export async function loadHolidays(from: string, to: string) {
  return db
    .select()
    .from(publicHolidays)
    .where(and(gte(publicHolidays.holidayDate, from), sql`${publicHolidays.holidayDate} <= ${to}`))
    .orderBy(asc(publicHolidays.holidayDate));
}

export interface ClosureRow {
  id: string;
  scope: "hospital" | "department" | "ward" | "clinic";
  departmentId: string | null;
  wardId: string | null;
  serviceLineId: string | null;
  startsOn: string;
  endsOn: string;
  reason: string;
  lifted: boolean;
}

export async function loadClosures(hospitalId: string): Promise<ClosureRow[]> {
  const rows = await db
    .select()
    .from(serviceClosures)
    .where(eq(serviceClosures.hospitalId, hospitalId))
    .orderBy(desc(serviceClosures.startsOn));
  return rows.map((c) => ({
    id: c.id,
    scope: c.scope as ClosureRow["scope"],
    departmentId: c.departmentId,
    wardId: c.wardId,
    serviceLineId: c.serviceLineId,
    startsOn: c.startsOn,
    endsOn: c.endsOn,
    reason: c.reason,
    lifted: c.liftedAt !== null,
  }));
}

/** Published sessions a closure would cancel, and the bookings they hold (preview before confirm). */
export async function closureImpact(
  hospitalId: string,
  scope: "hospital" | "department" | "ward" | "clinic",
  targetId: string | null,
  startsOn: string,
  endsOn: string,
): Promise<{ sessionIds: string[]; sessions: number; bookings: number }> {
  if (scope === "ward") return { sessionIds: [], sessions: 0, bookings: 0 }; // wards hold no sessions
  const startLocal = sql`(${startsOn}::date)::timestamp AT TIME ZONE 'Africa/Kampala'`;
  const endLocal = sql`((${endsOn}::date) + 1)::timestamp AT TIME ZONE 'Africa/Kampala'`;
  let target = sql`true`;
  if (scope === "clinic" && targetId) target = sql`${clinicSessions.serviceLineId} = ${targetId}`;
  if (scope === "department" && targetId) {
    target = sql`${clinicSessions.departmentId} IN (SELECT id FROM hospital_departments WHERE id = ${targetId} OR parent_id = ${targetId})
      OR ${clinicSessions.serviceLineId} IN (SELECT id FROM service_lines WHERE unit_id IN (SELECT id FROM hospital_departments WHERE parent_id = ${targetId}))`;
  }
  const rows = await db
    .select({ id: clinicSessions.id, booked: clinicSessions.bookedCount })
    .from(clinicSessions)
    .where(
      and(
        eq(clinicSessions.hospitalId, hospitalId),
        eq(clinicSessions.status, "published"),
        sql`${clinicSessions.startsAt} >= ${startLocal}`,
        sql`${clinicSessions.startsAt} < ${endLocal}`,
        sql`(${target})`,
      ),
    );
  return {
    sessionIds: rows.map((r) => r.id),
    sessions: rows.length,
    bookings: rows.reduce((n, r) => n + r.booked, 0),
  };
}

/* ─── diagnostics ───────────────────────────────────────────────────── */

export interface OfferingRow extends Offering {
  sectionId: string | null;
  machines: number | null;
}

export async function loadOfferings(hospitalId: string): Promise<OfferingRow[]> {
  const rows = await db
    .select()
    .from(diagnosticOfferings)
    .where(eq(diagnosticOfferings.hospitalId, hospitalId));
  return rows.map((o) => ({
    kind: o.kind as Offering["kind"],
    code: o.code,
    provision: o.provision as Offering["provision"],
    hours: o.hours as Offering["hours"],
    hoursNote: o.hoursNote,
    statedTat: o.statedTat,
    referredTo: o.referredTo,
    confirmedAt: o.confirmedAt?.toISOString() ?? null,
    sectionId: o.sectionId,
    machines: o.machines,
  }));
}

/**
 * The catalogue tests a hub row names (Lab test menu v2, DX-1, ADR 0350): code = the test id, category = its
 * catalogue section. `loinc_codes` is a code reference, never a menu (ADR 0355). The hub's viewers have no access
 * to restricted names, so those read "Restricted test" (Law 6).
 */
export async function loadTestCatalogue() {
  const rows = await db
    .select({
      code: testCatalogue.code,
      name: testCatalogue.display,
      section: testCatalogue.section,
      restricted: testCatalogue.restrictedClass,
    })
    .from(testCatalogue)
    .where(
      and(
        isNull(testCatalogue.hospitalId),
        eq(testCatalogue.kind, "lab"),
        isNotNull(testCatalogue.section),
      ),
    )
    .orderBy(asc(testCatalogue.section), asc(testCatalogue.display));
  return rows.map((r) => ({
    code: r.code,
    name: r.restricted ? "Restricted test" : r.name,
    category: sectionName(r.section),
  }));
}

/* ─── availability ──────────────────────────────────────────────────── */

export async function loadAvailabilityEvents(
  hospitalId: string,
  sinceDays = 365,
): Promise<AvailabilityEvent[]> {
  const since = new Date(now().getTime() - sinceDays * 86_400_000);
  const rows = await db
    .select()
    .from(availabilityEvents)
    .where(and(eq(availabilityEvents.hospitalId, hospitalId), gte(availabilityEvents.at, since)))
    .orderBy(asc(availabilityEvents.at));
  return rows.map((e) => ({
    problemId: e.problemId,
    subjectKind: e.subjectKind,
    subjectRef: e.subjectRef,
    subjectLabel: e.subjectLabel,
    event: e.event as AvailabilityEvent["event"],
    state: e.state as AvailabilityEvent["state"],
    reason: e.reason,
    note: e.note,
    expectedBackAt: e.expectedBackAt?.toISOString() ?? null,
    actorUserId: e.actorUserId,
    at: e.at.toISOString(),
  }));
}

export async function loadOpenProblems(hospitalId: string): Promise<OpenProblem[]> {
  return projectAvailability(await loadAvailabilityEvents(hospitalId), now());
}

/**
 * AV-3: one "Availability now" — reported problems plus temporarily closed wards and closures that
 * cover today. The header count and the nav badge read this.
 */
export async function availabilityNow(hospitalId: string) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Kampala" });
  const [problems, closedWards, closures] = await Promise.all([
    loadOpenProblems(hospitalId),
    db
      .select({
        id: hospitalWards.id,
        name: hospitalWards.name,
        closedAt: hospitalWards.closedAt,
        reason: hospitalWards.closedReason,
        back: hospitalWards.expectedReopenOn,
      })
      .from(hospitalWards)
      .where(
        and(
          eq(hospitalWards.hospitalId, hospitalId),
          isNull(hospitalWards.archivedAt),
          sql`${hospitalWards.closedAt} IS NOT NULL`,
        ),
      ),
    db
      .select()
      .from(serviceClosures)
      .where(
        and(
          eq(serviceClosures.hospitalId, hospitalId),
          isNull(serviceClosures.liftedAt),
          sql`${serviceClosures.startsOn} <= ${today}`,
          sql`${serviceClosures.endsOn} >= ${today}`,
        ),
      ),
  ]);
  return {
    problems,
    closedWards,
    closures,
    count: problems.length + closedWards.length + closures.length,
  };
}

/** Best-effort for the nav badge: failure is 0, never a broken shell (the staff badge's rule). */
export async function availabilityCount(hospitalId: string): Promise<number> {
  try {
    return (await availabilityNow(hospitalId)).count;
  } catch {
    return 0;
  }
}

/* ─── capabilities ──────────────────────────────────────────────────── */

export interface CapabilityView {
  key: string;
  value: unknown;
  pendingValue: unknown;
  pending: { byName: string; byUserId: string; at: string } | null;
  verified: { byName: string; at: string } | null;
  derived: boolean;
  /** Where a derived value comes from: Wards & beds, or the pharmacy's dispensing points. */
  derivedFrom: "wards" | "dispensing_points" | null;
}

export async function loadCapabilities(hospitalId: string): Promise<CapabilityView[]> {
  const [rows, [h], wards, points] = await Promise.all([
    db.select().from(capabilityValues).where(eq(capabilityValues.hospitalId, hospitalId)),
    db
      .select({
        emergencyCapability: hospitals.emergencyCapability,
        preAlertEnabled: hospitals.preAlertEnabled,
        boardOwnerNote: hospitals.boardOwnerNote,
        emergencySmsNumber: hospitals.emergencySmsNumber,
        ambulanceNumber: hospitals.ambulanceNumber,
        directions: hospitals.emergencyEntranceDirections,
      })
      .from(hospitals)
      .where(eq(hospitals.id, hospitalId)),
    db
      .select({
        wardType: hospitalWards.wardType,
        bedCount: hospitalWards.bedCount,
        archivedAt: hospitalWards.archivedAt,
      })
      .from(hospitalWards)
      .where(eq(hospitalWards.hospitalId, hospitalId)),
    loadPointsForCapability(hospitalId),
  ]);
  // DP-2: with a dispensing point, the pharmacy's two values are worked out from the points.
  const pharmacy = derivedPharmacy(points);
  const people = new Set(
    rows.flatMap((r) => [r.pendingBy, r.verifiedBy]).filter((x): x is string => !!x),
  );
  const names = people.size
    ? new Map(
        (
          await db
            .select({ id: users.id, name: users.fullName })
            .from(users)
            .where(inArray(users.id, [...people]))
        ).map((u) => [u.id, u.name]),
      )
    : new Map<string, string>();
  const derived = derivedCapabilities(
    wards.map((w) => ({
      wardType: w.wardType,
      bedCount: w.bedCount,
      archived: w.archivedAt !== null,
    })),
  );
  const pathway: Record<string, unknown> = {
    emergency_capability: h?.emergencyCapability ?? "none",
    accepts_pre_alerts: { enabled: h?.preAlertEnabled ?? false, owner: h?.boardOwnerNote ?? null },
    emergency_sms_number: h?.emergencySmsNumber ?? null,
    ambulance_line: h?.ambulanceNumber ?? null,
    arrival_directions: h?.directions ?? null,
  };
  return CAPABILITY_KEYS.map((k) => {
    const r = rows.find((x) => x.key === k.key);
    const fromPoints = pharmacy && k.key in pharmacy;
    const value = fromPoints
      ? pharmacy[k.key as keyof typeof pharmacy]
      : k.derived
        ? derived[k.key as keyof typeof derived]
        : k.pathway
          ? pathway[k.key]
          : (r?.value ?? null);
    return {
      key: k.key,
      value,
      pendingValue: r?.pendingAt ? r.pendingValue : null,
      pending:
        r?.pendingAt && r.pendingBy
          ? {
              byName: names.get(r.pendingBy) ?? "An admin",
              byUserId: r.pendingBy,
              at: r.pendingAt.toISOString(),
            }
          : null,
      verified:
        r?.verifiedAt && r.verifiedBy
          ? { byName: names.get(r.verifiedBy) ?? "An admin", at: r.verifiedAt.toISOString() }
          : null,
      derived: !!k.derived || !!fromPoints,
      derivedFrom: fromPoints ? "dispensing_points" : k.derived ? "wards" : null,
    };
  });
}

const toCapabilityRow = (v: CapabilityView): CapabilityRow => ({
  key: v.key,
  value: v.value,
  authoredBy: null,
  verifiedBy: v.verified ? "x" : null,
  verifiedAt: v.verified?.at ?? null,
  pendingValue: v.pendingValue,
  pendingBy: v.pending?.byUserId ?? null,
  pendingAt: v.pending?.at ?? null,
});

/* ─── hub state, summary, comparison ────────────────────────────────── */

export async function loadHubState(hospitalId: string) {
  const [[state], [app], [h]] = await Promise.all([
    db.select().from(hospitalServicesState).where(eq(hospitalServicesState.hospitalId, hospitalId)),
    db
      .select({
        id: hospitalApplications.id,
        // Only the old form left answers to bring in (v2 applications carry none).
        hasLegacy: sql<boolean>`(cardinality(${hospitalApplications.specialisedClinics}) + cardinality(${hospitalApplications.specialisedClinicsOther})
          + cardinality(${hospitalApplications.diagnosticServices}) + cardinality(${hospitalApplications.supportServices})
          + cardinality(${hospitalApplications.servicesOffered})) > 0 OR ${hospitalApplications.hasOnsitePharmacy} IS TRUE`,
      })
      .from(hospitalApplications)
      .where(eq(hospitalApplications.approvedHospitalId, hospitalId))
      .limit(1),
    db.select({ level: hospitals.level }).from(hospitals).where(eq(hospitals.id, hospitalId)),
  ]);
  const preset = signedPresetFor(h?.level ?? "");
  return {
    legacy: (app?.hasLegacy
      ? ((state?.legacyImport as "accepted" | "declined" | null) ?? "offered")
      : "none") as "offered" | "accepted" | "declined" | "none",
    preset: preset
      ? {
          levelLabel: preset.levelLabel,
          version: preset.version,
          section: preset.section,
          items: preset.items.length,
        }
      : null,
    level: h?.level ?? null,
  };
}

export async function standardsComparison(hospitalId: string) {
  const [[h], departments, clinics, offerings] = await Promise.all([
    db.select({ level: hospitals.level }).from(hospitals).where(eq(hospitals.id, hospitalId)),
    loadDepartments(hospitalId),
    loadClinics(hospitalId),
    loadOfferings(hospitalId),
  ]);
  const preset = signedPresetFor(h?.level ?? "");
  if (!preset) return null;
  const lab = departments.find(
    (d) => d.parentId === null && d.catalogueCode === "LABORATORY" && !d.archived,
  );
  const have = {
    departmentCodes: new Set(
      departments
        .filter((d) => d.parentId === null && !d.archived && d.catalogueCode)
        .map((d) => d.catalogueCode as string),
    ),
    labSectionCodes: new Set(
      departments
        .filter((d) => lab && d.parentId === lab.id && !d.archived && d.catalogueCode)
        .map((d) => d.catalogueCode as string),
    ),
    clinicCodes: new Set(
      clinics
        .filter((c) => c.status !== "archived" && c.catalogueCode)
        .map((c) => c.catalogueCode as string),
    ),
    imagingCodes: new Set(
      offerings
        .filter((o) => o.kind === "imaging" && o.provision !== "not_offered")
        .map((o) => o.code),
    ),
  };
  return {
    preset: {
      levelLabel: preset.levelLabel,
      version: preset.version,
      section: preset.section,
      source: preset.source,
    },
    rows: compareToPreset(preset, have),
  };
}

export async function hubSummary(hospitalId: string) {
  const [departments, wards, clinics, offerings] = await Promise.all([
    loadDepartments(hospitalId),
    db
      .select({ bedCount: hospitalWards.bedCount })
      .from(hospitalWards)
      .where(and(eq(hospitalWards.hospitalId, hospitalId), isNull(hospitalWards.archivedAt))),
    db
      .select({ id: serviceLines.id })
      .from(serviceLines)
      .where(and(eq(serviceLines.hospitalId, hospitalId), isNull(serviceLines.archivedAt))),
    db
      .select({ kind: diagnosticOfferings.kind })
      .from(diagnosticOfferings)
      .where(
        and(
          eq(diagnosticOfferings.hospitalId, hospitalId),
          eq(diagnosticOfferings.provision, "in_house"),
          sql`${diagnosticOfferings.confirmedAt} IS NOT NULL`,
        ),
      ),
  ]);
  const top = departments.filter((d) => d.parentId === null && !d.archived);
  return {
    departments: top.length,
    live: top.filter((d) => d.live).length,
    wards: wards.length,
    beds: wards.reduce((n, w) => n + w.bedCount, 0),
    clinics: clinics.length,
    testsInHouse: offerings.filter((o) => o.kind === "lab").length,
  };
}

/* ─── contracts other surfaces read ─────────────────────────────────── */

/** DX-4 — the ordering contract. Informs; nothing may block on it (AV-4). No personal data. */
export async function getOrderingAvailability(hospitalId: string, code: string) {
  const [offerings, problems] = await Promise.all([
    loadOfferings(hospitalId),
    loadOpenProblems(hospitalId),
  ]);
  const offering = offerings.find((o) => o.code === code) ?? null;
  return orderingAvailability(code, offering, problems);
}

const HHMM = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** PRF-1 — the capability profile for an audience. */
export async function computeCapabilityProfile(hospitalId: string, audience: Audience) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Kampala" });
  const in60 = new Date(Date.now() + 60 * 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "Africa/Kampala",
  });
  const [departments, clinics, offerings, tests, capabilities, now_, places, holidays] =
    await Promise.all([
      loadDepartments(hospitalId),
      loadClinics(hospitalId),
      loadOfferings(hospitalId),
      loadTestCatalogue(),
      loadCapabilities(hospitalId),
      availabilityNow(hospitalId),
      loadPlaces(hospitalId),
      loadHolidays(today, in60),
    ]);
  const byId = new Map(departments.map((d) => [d.id, d]));
  const placeById = new Map(places.map((p) => [p.id, p]));
  const input: ProfileInput = {
    hospitalId,
    generatedAt: new Date().toISOString(),
    departments: departments
      .filter((d) => d.parentId === null)
      .map((d) => ({
        code: d.catalogueCode,
        name: d.name,
        kind: d.kind,
        live: d.live,
        archived: d.archived,
        isStart: d.isStart,
        units: departments.filter((u) => u.parentId === d.id && !u.archived).map((u) => u.name),
      })),
    clinics: clinics
      .filter(
        (c) =>
          c.status !== "archived" &&
          byId.get(c.departmentId)?.live &&
          !byId.get(c.departmentId)?.archived,
      )
      .map((c) => {
        const place = c.placeId ? placeById.get(c.placeId) : undefined;
        return {
          code: c.catalogueCode,
          name: c.name,
          department: byId.get(c.departmentId)?.name ?? "",
          audience: c.audience,
          confidential: c.confidential,
          live: c.status === "live",
          place: place ? { name: place.name, directions: place.directions } : null,
          days: c.templates
            .filter((t) => t.active)
            .map((t) => ({
              weekday: t.weekday,
              start: HHMM(t.startMinutesLocal),
              end: HHMM(t.startMinutesLocal + t.durationMinutes),
              pattern: t.nthWeekday
                ? `nth:${t.nthWeekday}`
                : t.repeatEveryWeeks > 1
                  ? `every:${t.repeatEveryWeeks}w`
                  : "weekly",
            })),
        };
      }),
    diagnostics: offerings.map((o) => ({
      kind: o.kind,
      code: o.code,
      name:
        o.kind === "lab"
          ? (tests.find((t) => t.code === o.code)?.name ?? o.code)
          : (IMAGING_ITEMS.find((i) => i.code === o.code)?.label ?? o.code),
      where: o.provision,
      hours: o.hours === "24h" ? "24 h" : o.hoursNote,
      statedTurnaround: o.statedTat,
      referredTo: o.referredTo,
      confirmed: o.confirmedAt !== null,
    })),
    capabilities: capabilities
      .filter((c) => c.key !== "opd_hours" && (c.value !== null || c.pending))
      .map((c) => {
        const key = CAPABILITY_KEYS.find((k) => k.key === c.key)!;
        return {
          key: c.key,
          // CAP-5: the profile carries the VERIFIED value; a pending change is only a state.
          value: c.value,
          derived: c.derived,
          verification: key.routing && !key.derived ? verificationState(toCapabilityRow(c)) : null,
        };
      }),
    availability: [
      ...now_.problems.map((p) => ({
        kind: p.subjectKind,
        label: p.subjectLabel,
        state: p.unconfirmed ? ("unconfirmed" as const) : p.state,
        since: p.since,
        lastConfirmedAt: p.lastConfirmedAt,
      })),
      ...now_.closedWards.map((w) => ({
        kind: "ward",
        label: w.name,
        state: "unavailable" as const,
        since: w.closedAt!.toISOString(),
        lastConfirmedAt: w.closedAt!.toISOString(),
      })),
    ],
    opdHours:
      (capabilities.find((c) => c.key === "opd_hours")?.value as ProfileInput["opdHours"]) ?? null,
    places: places
      .filter((p) => !p.archived)
      .map((p) => ({ name: p.name, directions: p.directions })),
    holidays: holidays.map((h) => ({ date: h.holidayDate, name: h.name })),
  };
  return buildCapabilityProfile(input, audience);
}

/* ─── history (the audit rows that name an item) ────────────────────── */

/** Audited hub changes that mention this item's id (before or after) — the panel's History tab. */
export async function loadItemHistory(hospitalId: string, itemId: string, limit = 25) {
  const rows = await db
    .select({
      at: saAuditLog.timestamp,
      action: saAuditLog.action,
      reason: saAuditLog.reason,
      actor: users.fullName,
    })
    .from(saAuditLog)
    .leftJoin(users, eq(users.id, saAuditLog.actorId))
    .where(
      and(
        eq(saAuditLog.targetId, hospitalId),
        sql`(${saAuditLog.beforeData}::text LIKE ${`%${itemId}%`} OR ${saAuditLog.afterData}::text LIKE ${`%${itemId}%`})`,
      ),
    )
    .orderBy(desc(saAuditLog.timestamp))
    .limit(limit);
  return rows.map((r) => ({
    at: r.at.toISOString(),
    action: r.action,
    reason: r.reason,
    actor: r.actor ?? "An admin",
  }));
}

/** The application's legacy answers, for the one-time import preview (S2). */
export async function loadLegacyAnswers(hospitalId: string) {
  const [a] = await db
    .select({
      specialisedClinics: hospitalApplications.specialisedClinics,
      specialisedClinicsOther: hospitalApplications.specialisedClinicsOther,
      diagnosticServices: hospitalApplications.diagnosticServices,
      supportServices: hospitalApplications.supportServices,
      servicesOffered: hospitalApplications.servicesOffered,
      hasOnsitePharmacy: hospitalApplications.hasOnsitePharmacy,
    })
    .from(hospitalApplications)
    .where(eq(hospitalApplications.approvedHospitalId, hospitalId))
    .orderBy(desc(hospitalApplications.createdAt))
    .limit(1);
  return a ?? null;
}
