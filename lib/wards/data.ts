import "server-only";

import type { RegisterBed } from "./reconcile";
import type { WardLayout } from "@/supabase/functions/_shared/ward-layout";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";

import { db } from "@/db";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitalWards } from "@/db/schema/hospital-wards";
import { nursingAssignments, wardInChargeAssignments } from "@/db/schema/nurse-workspace";
import { hospitalBeds } from "@/db/schema/services-hub";
import { bedAssignments, hospitalBedServices, wardLayouts } from "@/db/schema/ward-builder";
import { parseLayout } from "./layout-schema";
import { syncWithRegister } from "./reconcile";

/*
 * Server reads for the ward builder and the bed board (ADRs 0191–0194). Every read is scoped by the
 * hospital the caller's scope resolved; nothing here trusts an id from the page on its own. Only called
 * behind WARD_BUILDER (migration 0090's tables).
 */

export interface WardTab {
  id: string;
  name: string;
  sex: string | null;
  bedCount: number;
  laidOut: boolean;
}

export interface LayoutEditorData {
  ward: {
    id: string;
    name: string;
    departmentId: string | null;
    wardType: string | null;
    sex: string | null;
    ageGroup: string | null;
    placeId: string | null;
    bedCount: number;
  };
  tabs: WardTab[];
  departments: { id: string; name: string }[];
  /** The document the editor opens: the draft, else the published layout brought up to date. */
  doc: WardLayout | null;
  draft: { id: string; version: number; revision: number; savedAt: string } | null;
  published: { version: number; publishedAt: string } | null;
  register: RegisterBed[];
  occupiedBedIds: string[];
  /** EU_OBSERVATION is live for this hospital (set by the page). */
  euLive?: boolean;
}

/** The ward's tabs: active wards, with whether each has a published layout. */
export async function wardTabs(hospitalId: string): Promise<WardTab[]> {
  const [wards, published] = await Promise.all([
    db
      .select({
        id: hospitalWards.id,
        name: hospitalWards.name,
        sex: hospitalWards.sex,
        bedCount: hospitalWards.bedCount,
      })
      .from(hospitalWards)
      .where(and(eq(hospitalWards.hospitalId, hospitalId), isNull(hospitalWards.archivedAt)))
      .orderBy(asc(hospitalWards.name)),
    db
      .select({ wardId: wardLayouts.wardId })
      .from(wardLayouts)
      .where(and(eq(wardLayouts.hospitalId, hospitalId), eq(wardLayouts.state, "published"))),
  ]);
  const laid = new Set(published.map((p) => p.wardId));
  return wards.map((w) => ({ ...w, laidOut: laid.has(w.id) }));
}

/** Which wards have a published layout or a draft (the wards list and panel). */
export async function layoutStatusByWard(
  hospitalId: string,
): Promise<Record<string, { published: boolean; draft: boolean }>> {
  const rows = await db
    .select({ wardId: wardLayouts.wardId, state: wardLayouts.state })
    .from(wardLayouts)
    .where(
      and(
        eq(wardLayouts.hospitalId, hospitalId),
        inArray(wardLayouts.state, ["draft", "published"]),
      ),
    );
  const out: Record<string, { published: boolean; draft: boolean }> = {};
  for (const r of rows) {
    out[r.wardId] ??= { published: false, draft: false };
    if (r.state === "published") out[r.wardId]!.published = true;
    else out[r.wardId]!.draft = true;
  }
  return out;
}

/** Every register bed of the ward (archived too) with its services. */
export async function loadRegister(hospitalId: string, wardId: string): Promise<RegisterBed[]> {
  const beds = await db
    .select({
      id: hospitalBeds.id,
      label: hospitalBeds.label,
      bedType: hospitalBeds.bedType,
      closedAt: hospitalBeds.closedAt,
      closedReason: hospitalBeds.closedReason,
      archivedAt: hospitalBeds.archivedAt,
      layoutX: hospitalBeds.layoutX,
      layoutY: hospitalBeds.layoutY,
      rotation: hospitalBeds.rotation,
      roomKey: hospitalBeds.roomKey,
    })
    .from(hospitalBeds)
    .where(and(eq(hospitalBeds.hospitalId, hospitalId), eq(hospitalBeds.wardId, wardId)))
    .orderBy(asc(hospitalBeds.createdAt), asc(hospitalBeds.label));
  const services = beds.length
    ? await db
        .select({ bedId: hospitalBedServices.bedId, code: hospitalBedServices.serviceCode })
        .from(hospitalBedServices)
        .where(
          inArray(
            hospitalBedServices.bedId,
            beds.map((b) => b.id),
          ),
        )
    : [];
  return beds.map((b) => ({
    ...b,
    closedAt: b.closedAt?.toISOString() ?? null,
    archivedAt: b.archivedAt?.toISOString() ?? null,
    services: services.filter((s) => s.bedId === b.id).map((s) => s.code),
  }));
}

export async function openAssignments(hospitalId: string, wardId: string) {
  return db
    .select({
      id: bedAssignments.id,
      bedId: bedAssignments.bedId,
      patientUserId: bedAssignments.patientUserId,
      startedAt: bedAssignments.startedAt,
      admissionId: bedAssignments.admissionId,
      euStayId: bedAssignments.euStayId,
      arrivedAt: bedAssignments.arrivedAt,
    })
    .from(bedAssignments)
    .where(
      and(
        eq(bedAssignments.hospitalId, hospitalId),
        eq(bedAssignments.wardId, wardId),
        isNull(bedAssignments.endedAt),
      ),
    );
}

export async function loadLayoutEditor(
  hospitalId: string,
  wardId: string,
): Promise<LayoutEditorData | null> {
  const [ward] = await db
    .select({
      id: hospitalWards.id,
      name: hospitalWards.name,
      departmentId: hospitalWards.departmentId,
      wardType: hospitalWards.wardType,
      sex: hospitalWards.sex,
      ageGroup: hospitalWards.ageGroup,
      placeId: hospitalWards.placeId,
      bedCount: hospitalWards.bedCount,
      archivedAt: hospitalWards.archivedAt,
    })
    .from(hospitalWards)
    .where(and(eq(hospitalWards.id, wardId), eq(hospitalWards.hospitalId, hospitalId)));
  if (!ward || ward.archivedAt) return null;
  const [tabs, departments, layouts, register, open] = await Promise.all([
    wardTabs(hospitalId),
    db
      .select({ id: hospitalDepartments.id, name: hospitalDepartments.name })
      .from(hospitalDepartments)
      .where(
        and(
          eq(hospitalDepartments.hospitalId, hospitalId),
          isNull(hospitalDepartments.parentId),
          isNull(hospitalDepartments.archivedAt),
        ),
      )
      .orderBy(asc(hospitalDepartments.name)),
    db
      .select({
        id: wardLayouts.id,
        version: wardLayouts.version,
        revision: wardLayouts.revision,
        state: wardLayouts.state,
        document: wardLayouts.document,
        updatedAt: wardLayouts.updatedAt,
        publishedAt: wardLayouts.publishedAt,
      })
      .from(wardLayouts)
      .where(
        and(
          eq(wardLayouts.hospitalId, hospitalId),
          eq(wardLayouts.wardId, wardId),
          inArray(wardLayouts.state, ["draft", "published"]),
        ),
      ),
    loadRegister(hospitalId, wardId),
    openAssignments(hospitalId, wardId),
  ]);
  const draftRow = layouts.find((l) => l.state === "draft") ?? null;
  const pubRow = layouts.find((l) => l.state === "published") ?? null;
  const parse = (raw: unknown) => {
    const r = parseLayout(raw);
    return r.ok ? r.doc : null;
  };
  let doc: WardLayout | null = null;
  if (draftRow) doc = parse(draftRow.document);
  else if (pubRow) {
    const published = parse(pubRow.document);
    doc = published
      ? syncWithRegister(
          published,
          register.map((r) => ({
            id: r.id,
            label: r.label,
            closedReason: r.closedAt ? r.closedReason : null,
            archived: r.archivedAt !== null,
          })),
        )
      : null;
  }
  const { archivedAt: _a, ...w } = ward;
  void _a;
  return {
    ward: w,
    tabs,
    departments,
    doc,
    draft: draftRow
      ? {
          id: draftRow.id,
          version: draftRow.version,
          revision: draftRow.revision,
          savedAt: draftRow.updatedAt.toISOString(),
        }
      : null,
    published: pubRow
      ? {
          version: pubRow.version,
          publishedAt: (pubRow.publishedAt ?? pubRow.updatedAt).toISOString(),
        }
      : null,
    register,
    occupiedBedIds: open.map((a) => a.bedId),
  };
}

/* ─── The nurse's wards ──────────────────────────────────────────────── */

/**
 * The wards a nurse works on now (ADR 0194 §3): in-charge (or acting) of, or with an open nursing
 * assignment on. Those are the wards whose bed board they see and may act on.
 */
export async function nurseWardIds(hospitalId: string, userId: string): Promise<string[]> {
  const now = new Date();
  const [charges, assigned] = await Promise.all([
    db
      .select({ wardId: wardInChargeAssignments.wardId })
      .from(wardInChargeAssignments)
      .where(
        and(
          eq(wardInChargeAssignments.hospitalId, hospitalId),
          eq(wardInChargeAssignments.nurseUserId, userId),
          lte(wardInChargeAssignments.startsAt, now),
          or(isNull(wardInChargeAssignments.endsAt), gt(wardInChargeAssignments.endsAt, now)),
        ),
      ),
    db
      .select({ wardId: nursingAssignments.wardId })
      .from(nursingAssignments)
      .where(
        and(
          eq(nursingAssignments.hospitalId, hospitalId),
          eq(nursingAssignments.nurseUserId, userId),
          isNotNull(nursingAssignments.wardId),
          lte(nursingAssignments.startsAt, now),
          or(isNull(nursingAssignments.endsAt), gt(nursingAssignments.endsAt, now)),
        ),
      ),
  ]);
  return [
    ...new Set([...charges, ...assigned].map((r) => r.wardId).filter((x): x is string => !!x)),
  ];
}

/** Tabs for the nurse's wards only. */
export async function nurseWardTabs(hospitalId: string, wardIds: string[]): Promise<WardTab[]> {
  if (!wardIds.length) return [];
  const all = await wardTabs(hospitalId);
  return all.filter((t) => wardIds.includes(t.id));
}
