import type { HistoryRow, View } from "./_lib/model";
import type { EmrDb } from "@/lib/emr/db";
import type { Metadata } from "next";

import { DEPTS } from "@/content/hospital-admin/departments";
import { db } from "@/db";
import { requireHospitalAdminScope } from "@/lib/hospital-admin/scope";
import { isDemoHospital } from "@/lib/lab/demo";
import { loadDispensingServes } from "@/lib/pharmacy/dispensing-points";
import { pharmacyDispensingLiveFor } from "@/lib/pharmacy/feature";
import { dutyRotaLiveFor } from "@/lib/rota/feature";
import {
  availabilityNow,
  loadAvailabilityEvents,
  loadCapabilities,
  loadClinics,
  loadDepartmentCounts,
  loadDepartments,
  loadHeads,
  loadHolidays,
  loadHubState,
  loadLegacyAnswers,
  loadPlaces,
  loadStaffPool,
  loadTestCatalogue,
  loadWards,
} from "@/lib/services/data";
import {
  CAPABILITY_KEYS,
  IMAGING_ITEMS,
  planLegacyImport,
  planPreset,
  signedPresetFor,
} from "@/supabase/functions/_shared/services-hub";
import { DepartmentsDesk } from "./_components/departments-desk";
import { loadBookingRules, loadClinicSessions } from "./_lib/booking";

export const metadata: Metadata = { title: DEPTS.title };
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/**
 * Departments (ADR 0520 phase 2), in the Tether desk: the counts, the department cards and one department's panel
 * (overview, booking rules, clinics and wards), "Unavailable now" (was Availability) and "Hours and places" (was
 * Hours & places; closures moved to Clinics & schedule). Deep links: `?open=<id>`, `?assign=head`, `?add=1`,
 * `?view=unavailable|hours`, `?report=1`.
 */
export default async function DepartmentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const scope = await requireHospitalAdminScope();
  const h = scope.hospitalId;
  const year = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Kampala" }).slice(0, 4);
  const [
    departments,
    heads,
    counts,
    pool,
    places,
    hub,
    clinics,
    wards,
    points,
    rules,
    sessions,
    now,
    events,
    tests,
    caps,
    holidays,
  ] = await Promise.all([
    loadDepartments(h),
    loadHeads(h),
    loadDepartmentCounts(h),
    loadStaffPool(h),
    loadPlaces(h),
    loadHubState(h),
    loadClinics(h),
    loadWards(h),
    loadDispensingServes(h),
    loadBookingRules(h),
    loadClinicSessions(h),
    availabilityNow(h),
    loadAvailabilityEvents(h, 90),
    loadTestCatalogue(),
    loadCapabilities(h),
    loadHolidays(`${year}-01-01`, `${Number(year) + 1}-12-31`),
  ]);

  // First run (§5.2): the signed MoH standard for this level, and the application's old answers.
  const top = departments.filter((d) => d.parentId === null && !d.archived);
  const lab = top.find((d) => d.catalogueCode === "LABORATORY");
  const have = {
    departmentCodes: new Set(
      top.filter((d) => d.catalogueCode).map((d) => d.catalogueCode as string),
    ),
    labSectionCodes: new Set(
      departments
        .filter((d) => lab && d.parentId === lab.id && d.catalogueCode)
        .map((d) => d.catalogueCode as string),
    ),
    clinicCodes: new Set(
      clinics.filter((c) => c.catalogueCode).map((c) => c.catalogueCode as string),
    ),
    imagingCodes: new Set<string>(),
  };
  const preset = signedPresetFor(scope.level);
  const presetPlan = preset ? planPreset(preset, have) : null;
  const legacy =
    hub.legacy === "offered" || hub.legacy === "declined" ? await loadLegacyAnswers(h) : null;
  const legacyPlan = legacy
    ? planLegacyImport({
        specialisedClinics: legacy.specialisedClinics,
        specialisedClinicsOther: legacy.specialisedClinicsOther,
        diagnosticServices: legacy.diagnosticServices,
        supportServices: legacy.supportServices,
        servicesOffered: legacy.servicesOffered,
        hasOnsitePharmacy: legacy.hasOnsitePharmacy,
      })
    : null;

  const goLive = pharmacyDispensingLiveFor(h);
  // ADR 0450: a demo hospital reaches the pharmacy demo from here, before it has any pharmacy units.
  const pharmacyDemo = goLive && (await isDemoHospital(db as unknown as EmrDb, h));

  // Resolved in the last 90 days (AV-1 keeps the history).
  const byProblem = new Map<string, typeof events>();
  for (const e of events) byProblem.set(e.problemId, [...(byProblem.get(e.problemId) ?? []), e]);
  const history: HistoryRow[] = [...byProblem.values()]
    .filter((list) => list.at(-1)?.event === "resolved")
    .map((list) => {
      const first = list[0]!;
      const last = list.at(-1)!;
      return {
        problemId: first.problemId,
        kind: first.subjectKind,
        label: first.subjectLabel,
        state: list.find((e) => e.state)?.state ?? "unavailable",
        reason: list.find((e) => e.reason)?.reason ?? null,
        since: first.at,
        resolvedAt: last.at,
        days: Math.max(1, Math.round((Date.parse(last.at) - Date.parse(first.at)) / 86_400_000)),
      };
    })
    .sort((a, b) => b.resolvedAt.localeCompare(a.resolvedAt));

  const obj = (m: Map<string, number>) => Object.fromEntries(m);
  const v = one(sp.view);
  const view: View = v === "unavailable" || v === "hours" ? v : "cards";
  const wardRows = wards.map((w) => ({
    id: w.id,
    name: w.name,
    departmentId: w.departmentId,
    bedCount: w.bedCount,
    closed: w.closed !== null,
    archived: w.archived,
  }));

  return (
    <DepartmentsDesk
      view={view}
      openId={one(sp.open)}
      assign={one(sp.assign) === "head"}
      adding={one(sp.add) === "1"}
      reporting={one(sp.report) === "1"}
      data={{
        departments,
        heads,
        counts: {
          staff: obj(counts.staff),
          wards: obj(counts.wards),
          clinics: obj(counts.clinics),
          bookedSessions: obj(counts.bookedSessions),
        },
        pool: pool.map((p) => ({
          userId: p.userId,
          name: p.name,
          departmentId: p.departmentId,
          cadre: p.cadre,
        })),
        places,
        clinics: clinics.map((c) => ({
          id: c.id,
          name: c.name,
          departmentId: c.departmentId,
          unitId: c.unitId,
          status: c.status,
        })),
        wards: wardRows,
        points,
        goLive,
        pharmacyDemo,
        rotaLive: dutyRotaLiveFor(h),
        rules,
        sessions,
        firstRun: {
          preset: preset
            ? {
                levelLabel: preset.levelLabel,
                version: preset.version,
                section: preset.section,
                source: preset.source,
                add: presetPlan?.add ?? [],
                skip: presetPlan?.skip.length ?? 0,
              }
            : null,
          legacy: hub.legacy,
          legacyPlan,
        },
        problems: now.problems,
        closedWards: now.closedWards.map((w) => ({
          id: w.id,
          name: w.name,
          departmentId: wards.find((x) => x.id === w.id)?.departmentId ?? null,
          reason: w.reason,
          since: w.closedAt!.toISOString(),
          back: w.back,
        })),
        closures: now.closures.map((c) => ({
          id: c.id,
          scope: c.scope,
          departmentId: c.departmentId,
          startsOn: c.startsOn,
          endsOn: c.endsOn,
          reason: c.reason,
        })),
        history,
        subjects: {
          department: top.map((d) => ({ ref: d.id, label: d.name })),
          ward: wards.filter((w) => !w.archived).map((w) => ({ ref: w.id, label: w.name })),
          clinic: clinics
            .filter((c) => c.status !== "archived")
            .map((c) => ({ ref: c.id, label: c.name })),
          test: tests.map((t) => ({ ref: t.code, label: t.name })),
          lab_section: lab
            ? departments
                .filter((d) => d.parentId === lab.id && !d.archived)
                .map((d) => ({ ref: d.id, label: d.name }))
            : [],
          imaging: IMAGING_ITEMS.map((i) => ({ ref: i.code, label: i.label })),
          capability: CAPABILITY_KEYS.filter((k) => !k.derived && k.key !== "opd_hours").map(
            (k) => ({ ref: k.key, label: k.label }),
          ),
        },
        opdHours:
          (caps.find((c) => c.key === "opd_hours")?.value as Record<
            string,
            { from: string; to: string }[]
          > | null) ?? null,
        holidays: holidays.map((x) => ({
          date: x.holidayDate,
          name: x.name,
          provisional: x.provisional,
          source: x.source,
        })),
      }}
    />
  );
}
