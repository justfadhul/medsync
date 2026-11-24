/**
 * Structure ops (prompt §8 "Structure"): departments, heads, units, archive, wards, beds,
 * in-charges, places. Rules: STR-1…STR-6 in ../_shared/services-hub.ts.
 */
import type { DeptState } from "../_shared/services-hub.ts";
import type { Ctx, OpHandler } from "./common.ts";
import { z } from "npm:zod@4.4.3";

import {
  archiveVerdict,
  bedLabelsToAdd,
  CATALOGUE_DEPARTMENTS,
  departmentByCode,
  departmentSlug,
  headEligible,
  inChargeEligible,
  LAB_SECTIONS,
  liveChange,
  startChange,
} from "../_shared/services-hub.ts";
import { decideWardAttach, WARD_ATTACH_WORDS } from "../_shared/ward-layout.ts";
import { assertHeadOf, HubError, loadDepartment, must, reasonOr, slugify } from "./common.ts";
import { hasPublishedLayout, occupiedBedCount } from "./ops-wards.ts";

const uuid = z.string().uuid();
const reason = z.string().trim().max(500).optional();
const sensitiveReason = z.string().trim().min(8, "Say why in a few words (audited).").max(500);
const kind = z.enum(["clinical", "diagnostic", "support", "administrative"]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const StructureOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add_departments"),
    codes: z.array(z.string().max(40)).max(40).default([]),
    custom: z
      .array(z.object({ name: z.string().trim().min(2).max(80), kind }))
      .max(5)
      .default([]),
    /** Live on MedSync at once (the hub's default). Absent = the older "Not on MedSync yet". */
    live: z.boolean().default(false),
    reason,
  }),
  z.object({
    op: z.literal("update_department"),
    department_id: uuid,
    name: z.string().trim().min(2).max(80).optional(),
    kind: kind.optional(),
    place_id: uuid.nullable().optional(),
    service_hours: z.string().trim().max(60).nullable().optional(),
    reason,
  }),
  z.object({
    op: z.literal("set_department_live"),
    department_id: uuid,
    live: z.boolean(),
    reason,
  }),
  z.object({
    op: z.literal("set_departments_live"),
    department_ids: z.array(uuid).min(1).max(40),
    reason,
  }),
  z.object({ op: z.literal("set_start_department"), department_id: uuid, reason }),
  z.object({
    op: z.literal("assign_head"),
    department_id: uuid,
    user_id: uuid,
    acting: z.boolean(),
    ends_on: date.nullable().optional(),
    notes: z.string().trim().max(280).optional(),
    reason,
  }),
  z.object({ op: z.literal("end_head"), head_id: uuid, reason }),
  z.object({
    op: z.literal("add_unit"),
    department_id: uuid,
    name: z.string().trim().min(2).max(80).optional(),
    catalogue_code: z.string().max(40).optional(),
    reason,
  }),
  z.object({
    op: z.literal("set_dispensing_point"),
    department_id: uuid,
    serves: z.enum(["window", "wards", "emergency", "all"]),
    reason,
  }),
  z.object({
    op: z.literal("archive"),
    target: z.enum(["department", "ward", "place", "clinic", "bed"]),
    id: uuid,
    reason: sensitiveReason,
  }),
  z.object({
    op: z.literal("unarchive"),
    target: z.enum(["department", "ward", "place", "clinic", "bed"]),
    id: uuid,
    reason,
  }),
  z.object({
    op: z.literal("upsert_ward"),
    id: uuid.optional(),
    name: z.string().trim().min(2).max(80),
    department_id: uuid,
    ward_type: z
      .enum([
        "general",
        "hdu",
        "icu",
        "nicu",
        "maternity",
        "labour_suite",
        "isolation",
        "paediatric",
        "surgical",
        "emergency_observation",
        "private",
      ])
      .nullable()
      .optional(),
    sex: z.enum(["female", "male", "mixed"]).nullable().optional(),
    age_group: z.enum(["adult", "paediatric", "neonatal", "all"]).nullable().optional(),
    place_id: uuid.nullable().optional(),
    // An emergency unit's ordinary ward, for display (migration 0310). Omitted keeps the stored one.
    parent_ward_id: uuid.nullable().optional(),
    bed_count: z.number().int().min(0).max(2000),
    reason,
  }),
  z.object({
    op: z.literal("set_ward_closure"),
    ward_id: uuid,
    closed: z.boolean(),
    closed_reason: z.string().trim().min(3).max(200).optional(),
    expected_reopen_on: date.nullable().optional(),
    reason,
  }),
  z.object({ op: z.literal("generate_beds"), ward_id: uuid, reason }),
  z.object({
    op: z.literal("set_bed"),
    bed_id: uuid,
    label: z.string().trim().min(1).max(20).optional(),
    closed: z.boolean().optional(),
    closed_reason: z.string().trim().min(3).max(200).optional(),
    reason,
  }),
  z.object({
    op: z.literal("assign_ward_in_charge"),
    ward_id: uuid,
    user_id: uuid,
    acting: z.boolean(),
    ends_on: date.nullable().optional(),
    reason,
  }),
  z.object({ op: z.literal("end_ward_in_charge"), assignment_id: uuid, reason }),
  z.object({
    op: z.literal("upsert_place"),
    id: uuid.optional(),
    name: z.string().trim().min(1).max(80),
    building: z.string().trim().max(60).nullable().optional(),
    floor: z.string().trim().max(30).nullable().optional(),
    room: z.string().trim().max(30).nullable().optional(),
    directions: z.string().trim().max(140).nullable().optional(),
    reason,
  }),
]);

/* ─── helpers ───────────────────────────────────────────────────────── */

async function allDepartments(ctx: Ctx) {
  return must(
    await ctx.sb
      .from("hospital_departments")
      .select(
        "id, parent_id, name, slug, kind, catalogue_code, medsync_live_at, archived_at, is_start",
      )
      .eq("hospital_id", ctx.hospitalId),
    "departments",
  ) as {
    id: string;
    parent_id: string | null;
    name: string;
    slug: string;
    kind: string;
    catalogue_code: string | null;
    medsync_live_at: string | null;
    archived_at: string | null;
    is_start: boolean;
  }[];
}

const toState = (d: Awaited<ReturnType<typeof allDepartments>>[number]): DeptState => ({
  id: d.id,
  parentId: d.parent_id,
  live: d.medsync_live_at !== null,
  archived: d.archived_at !== null,
  isStart: d.is_start,
});

async function assertPlace(ctx: Ctx, placeId: string | null | undefined) {
  if (!placeId) return;
  const p = must(
    await ctx.sb
      .from("hospital_places")
      .select("id")
      .eq("id", placeId)
      .eq("hospital_id", ctx.hospitalId)
      .maybeSingle(),
    "place lookup",
  );
  if (!p) throw new HubError("That place isn't at this hospital.");
}

async function affiliationsAt(ctx: Ctx, userId: string) {
  const rows = must(
    await ctx.sb
      .from("staff_affiliations")
      .select("user_id, department_id, state, cadres(code)")
      .eq("hospital_id", ctx.hospitalId)
      .eq("user_id", userId),
    "affiliations",
  ) as { user_id: string; department_id: string; state: string; cadres: { code: string } | null }[];
  return rows.map((r) => ({
    userId: r.user_id,
    departmentId: r.department_id,
    state: r.state,
    cadreCode: r.cadres?.code ?? null,
  }));
}

const nowIso = () => new Date().toISOString();
const endOfDay = (d: string) => `${d}T23:59:59+03:00`;

/* ─── ops ───────────────────────────────────────────────────────────── */

const addDepartments: OpHandler = async (ctx, i) => {
  const existing = await allDepartments(ctx);
  const top = existing.filter((d) => d.parent_id === null);
  const haveSlugs = new Set(top.map((d) => d.slug.replace(/_/g, "-")));
  const unknown = (i.codes as string[]).filter((c) => !departmentByCode(c));
  if (unknown.length) throw new HubError(`Not in the catalogue: ${unknown.join(", ")}`);
  const rows: Record<string, unknown>[] = [];
  const skipped: string[] = [];
  for (const code of i.codes as string[]) {
    const d = departmentByCode(code)!;
    const slug = departmentSlug(code);
    if (haveSlugs.has(slug)) {
      skipped.push(d.label);
      continue;
    }
    haveSlugs.add(slug);
    rows.push({
      hospital_id: ctx.hospitalId,
      name: d.label,
      slug,
      kind: d.kind,
      catalogue_code: code,
    });
  }
  for (const c of i.custom as { name: string; kind: string }[]) {
    const slug = slugify(c.name) || "department";
    if (haveSlugs.has(slug)) {
      skipped.push(c.name);
      continue;
    }
    haveSlugs.add(slug);
    rows.push({
      hospital_id: ctx.hospitalId,
      name: c.name,
      slug,
      kind: c.kind,
      catalogue_code: null,
    });
  }
  if (!rows.length) throw new HubError("Those departments are already set up.", 409);
  // Live on add: the first live department a hospital has is where it starts (as liveChange does).
  let start: string | null = null;
  if (i.live) {
    const at = nowIso();
    // Every row carries both keys: a multi-row insert fills a missing key with NULL, not its default.
    for (const r of rows) Object.assign(r, { medsync_live_at: at, is_start: false });
    if (!existing.some((d) => d.is_start)) {
      const first = rows.find((r) => r.kind === "clinical") ?? rows[0]!;
      first.is_start = true;
      start = first.name as string;
    }
  }
  const names = rows.map((r) => r.name as string);
  return {
    audit: {
      action: "update_department",
      reason: reasonOr(
        i.reason,
        `Added ${rows.length} department(s): ${names.join(", ")}`.slice(0, 480),
      ),
      after: { added: names, skipped, live: i.live, start },
    },
    apply: async () => {
      must(await ctx.sb.from("hospital_departments").insert(rows), "insert departments");
      return { added: names.length, skipped, start };
    },
  };
};

const updateDepartment: OpHandler = async (ctx, i) => {
  await assertHeadOf(ctx, i.department_id);
  const d = await loadDepartment(ctx, i.department_id);
  if (ctx.role === "head" && (i.name !== undefined || i.kind !== undefined)) {
    throw new HubError("A head can change the place and hours; a hospital admin renames.", 403);
  }
  await assertPlace(ctx, i.place_id);
  const patch: Record<string, unknown> = {};
  if (i.name !== undefined) patch.name = i.name;
  if (i.kind !== undefined) patch.kind = i.kind;
  if (i.place_id !== undefined) patch.place_id = i.place_id;
  if (i.service_hours !== undefined) patch.service_hours = i.service_hours || null;
  if (!Object.keys(patch).length) throw new HubError("Nothing to change.");
  return {
    audit: {
      action: "update_department",
      reason: reasonOr(i.reason, `Updated ${d.name}`),
      before: {
        department_id: d.id,
        name: d.name,
        kind: d.kind,
        place_id: d.place_id,
        service_hours: d.service_hours,
      },
      after: patch,
    },
    apply: async () => {
      must(
        await ctx.sb.from("hospital_departments").update(patch).eq("id", d.id),
        "update department",
      );
      // A unit follows its department's kind.
      if (patch.kind)
        must(
          await ctx.sb
            .from("hospital_departments")
            .update({ kind: patch.kind })
            .eq("parent_id", d.id),
          "units kind",
        );
    },
  };
};

const setDepartmentLive: OpHandler = async (ctx, i) => {
  const all = await allDepartments(ctx);
  const d = all.find((x) => x.id === i.department_id);
  if (!d) throw new HubError("Department not found at this hospital.");
  const verdict = liveChange(all.map(toState), d.id, i.live);
  if (!verdict.ok) throw new HubError(verdict.reason, 409);
  const unitIds = all.filter((x) => x.parent_id === d.id).map((x) => x.id);
  return {
    audit: {
      action: "set_department_live",
      reason: reasonOr(
        i.reason,
        `${d.name} ${i.live ? "is now live on MedSync" : "is no longer live on MedSync"}`,
      ),
      before: { department_id: d.id, live: d.medsync_live_at !== null },
      after: { live: i.live, became_start: verdict.makeStart },
    },
    apply: async () => {
      const at = i.live ? nowIso() : null;
      must(
        await ctx.sb
          .from("hospital_departments")
          .update({ medsync_live_at: at })
          .in("id", [d.id, ...unitIds]),
        "live",
      );
      if (verdict.makeStart) {
        must(
          await ctx.sb.from("hospital_departments").update({ is_start: true }).eq("id", d.id),
          "start",
        );
      }
      return { live: i.live, became_start: verdict.makeStart };
    },
  };
};

/** "Set them live" for the departments still Not on MedSync yet: one audit row, the same start rule. */
const setDepartmentsLive: OpHandler = async (ctx, i) => {
  const all = await allDepartments(ctx);
  const picked = (i.department_ids as string[]).map((id) => all.find((d) => d.id === id));
  if (picked.some((d) => !d || d.parent_id !== null || d.archived_at !== null))
    throw new HubError("Only this hospital's current top-level departments can be set live here.");
  const off = picked.filter((d) => d!.medsync_live_at === null).map((d) => d!);
  if (!off.length) throw new HubError("Those departments are already live.", 409);
  const start = all.some((d) => d.is_start)
    ? null
    : (off.find((d) => d.kind === "clinical") ?? off[0]!);
  const ids = off.flatMap((d) => [
    d.id,
    ...all.filter((u) => u.parent_id === d.id).map((u) => u.id),
  ]);
  const names = off.map((d) => d.name);
  return {
    audit: {
      action: "set_department_live",
      reason: reasonOr(i.reason, `Set live on MedSync: ${names.join(", ")}`.slice(0, 480)),
      before: { department_ids: off.map((d) => d.id), live: false },
      after: { live: true, start: start?.name ?? null },
    },
    apply: async () => {
      must(
        await ctx.sb
          .from("hospital_departments")
          .update({ medsync_live_at: nowIso() })
          .in("id", ids),
        "live",
      );
      if (start) {
        must(
          await ctx.sb.from("hospital_departments").update({ is_start: true }).eq("id", start.id),
          "start",
        );
      }
      return { live: names.length, start: start?.name ?? null };
    },
  };
};

const setStartDepartment: OpHandler = async (ctx, i) => {
  const all = await allDepartments(ctx);
  const verdict = startChange(all.map(toState), i.department_id);
  if (!verdict.ok) throw new HubError(verdict.reason, 409);
  const d = all.find((x) => x.id === i.department_id)!;
  const prev = all.find((x) => x.is_start) ?? null;
  return {
    audit: {
      action: "set_start_department",
      reason: reasonOr(i.reason, `MedSync starts in ${d.name}`),
      before: { start: prev?.name ?? null },
      after: { start: d.name },
    },
    apply: async () => {
      if (prev && prev.id !== d.id) {
        must(
          await ctx.sb.from("hospital_departments").update({ is_start: false }).eq("id", prev.id),
          "clear start",
        );
      }
      must(
        await ctx.sb.from("hospital_departments").update({ is_start: true }).eq("id", d.id),
        "set start",
      );
    },
  };
};

const assignHead: OpHandler = async (ctx, i) => {
  const all = await allDepartments(ctx);
  const d = all.find((x) => x.id === i.department_id);
  if (!d) throw new HubError("Department not found at this hospital.");
  // STR-3: affiliated to this department, one of its units, or (for a unit) its parent.
  const scopeIds = [
    d.id,
    ...all.filter((x) => x.parent_id === d.id).map((x) => x.id),
    ...(d.parent_id ? [d.parent_id] : []),
  ];
  if (!headEligible(await affiliationsAt(ctx, i.user_id), i.user_id, scopeIds)) {
    throw new HubError("Heads come from approved staff affiliated to this department.");
  }
  const open = must(
    await ctx.sb
      .from("department_heads")
      .select("id, user_id, acting, ends_at")
      .eq("department_id", d.id)
      .or(`ends_at.is.null,ends_at.gt.${nowIso()}`),
    "current heads",
  ) as { id: string; user_id: string; acting: boolean; ends_at: string | null }[];
  const replacing = open.filter((h) => h.acting === i.acting);
  return {
    audit: {
      action: "assign_department_head",
      reason: reasonOr(i.reason, `${i.acting ? "Acting head" : "Head"} of ${d.name} assigned`),
      before: { department_id: d.id, previous: replacing.map((h) => h.user_id) },
      after: { user_id: i.user_id, acting: i.acting, ends_on: i.ends_on ?? null },
    },
    apply: async () => {
      if (replacing.length) {
        must(
          await ctx.sb
            .from("department_heads")
            .update({ ends_at: nowIso() })
            .in(
              "id",
              replacing.map((h) => h.id),
            ),
          "end previous",
        );
      }
      must(
        await ctx.sb.from("department_heads").insert({
          hospital_id: ctx.hospitalId,
          department_id: d.id,
          user_id: i.user_id,
          acting: i.acting,
          ends_at: i.acting && i.ends_on ? endOfDay(i.ends_on) : null,
          set_by_user_id: ctx.callerId,
          notes: i.notes ?? null,
        }),
        "insert head",
      );
    },
  };
};

const endHead: OpHandler = async (ctx, i) => {
  const h = must(
    await ctx.sb
      .from("department_heads")
      .select("id, department_id, user_id, ends_at")
      .eq("id", i.head_id)
      .eq("hospital_id", ctx.hospitalId)
      .maybeSingle(),
    "head lookup",
  ) as { id: string; department_id: string; user_id: string; ends_at: string | null } | null;
  if (!h) throw new HubError("That assignment isn't at this hospital.");
  if (h.ends_at && h.ends_at <= nowIso())
    throw new HubError("That assignment has already ended.", 409);
  return {
    audit: {
      action: "end_department_head",
      reason: reasonOr(i.reason, "Head of department assignment ended"),
      before: { head_id: h.id, user_id: h.user_id, department_id: h.department_id },
    },
    apply: async () => {
      must(
        await ctx.sb.from("department_heads").update({ ends_at: nowIso() }).eq("id", h.id),
        "end head",
      );
    },
  };
};

/**
 * A dispensing point (Pharmacy Phase 0, DP-1, ADR 0236): what a unit of the Pharmacy department
 * serves. It only picks the lane its staff's queue opens on; it routes and holds nothing.
 */
const setDispensingPoint: OpHandler = async (ctx, i) => {
  const unit = await loadDepartment(ctx, i.department_id);
  if (!unit.parent_id)
    throw new HubError("A dispensing point is a unit of the Pharmacy department.");
  const parent = await loadDepartment(ctx, unit.parent_id);
  if (parent.catalogue_code !== "PHARMACY")
    throw new HubError("A dispensing point is a unit of the Pharmacy department.");
  if (unit.archived_at) throw new HubError("That unit is archived.");
  const before = must(
    await ctx.sb
      .from("pharmacy_dispensing_points")
      .select("serves")
      .eq("department_id", unit.id)
      .maybeSingle(),
    "dispensing point lookup",
  ) as { serves: string } | null;
  return {
    audit: {
      action: "update_department",
      reason: reasonOr(i.reason, `${unit.name} serves ${i.serves}`),
      before: { unit: unit.name, serves: before?.serves ?? null },
      after: { unit: unit.name, serves: i.serves },
    },
    apply: async () => {
      must(
        await ctx.sb.from("pharmacy_dispensing_points").upsert({
          department_id: unit.id,
          hospital_id: ctx.hospitalId,
          serves: i.serves,
          updated_at: nowIso(),
          updated_by_user_id: ctx.callerId,
        }),
        "upsert dispensing point",
      );
      return { id: unit.id };
    },
  };
};

const addUnit: OpHandler = async (ctx, i) => {
  await assertHeadOf(ctx, i.department_id);
  const parent = await loadDepartment(ctx, i.department_id);
  if (parent.parent_id) throw new HubError("Units hang off a department, not another unit.");
  let name = i.name as string | undefined;
  let code: string | null = null;
  if (i.catalogue_code) {
    const section = LAB_SECTIONS.find((s) => s.code === i.catalogue_code);
    if (!section) throw new HubError("That section isn't in the catalogue.");
    if (parent.catalogue_code !== "LABORATORY")
      throw new HubError("Lab sections are units of the Laboratory.");
    name = section.label;
    code = section.code;
  }
  if (!name) throw new HubError("Name the unit.");
  const slug = code ?? slugify(name);
  const clash = must(
    await ctx.sb
      .from("hospital_departments")
      .select("id")
      .eq("hospital_id", ctx.hospitalId)
      .eq("parent_id", parent.id)
      .eq("slug", slug)
      .maybeSingle(),
    "unit lookup",
  );
  if (clash) throw new HubError(`${name} is already a unit here.`, 409);
  return {
    audit: {
      action: "update_department",
      reason: reasonOr(i.reason, `Unit ${name} added to ${parent.name}`),
      after: { parent: parent.name, unit: name },
    },
    apply: async () => {
      const row = must(
        await ctx.sb
          .from("hospital_departments")
          .insert({
            hospital_id: ctx.hospitalId,
            parent_id: parent.id,
            name,
            slug,
            kind: parent.kind,
            catalogue_code: code,
            medsync_live_at: parent.medsync_live_at,
          })
          .select("id")
          .single(),
        "insert unit",
      ) as { id: string };
      return { id: row.id };
    },
  };
};

/** STR-4 counts for a department (and its units). */
async function departmentInUse(ctx: Ctx, ids: string[]) {
  const count = async (
    q: PromiseLike<{ count: number | null; error: { message: string } | null }>,
    what: string,
  ) => {
    const r = await q;
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.count ?? 0;
  };
  const [staff, bookedSessions, wards] = await Promise.all([
    count(
      ctx.sb
        .from("staff_affiliations")
        .select("id", { count: "exact", head: true })
        .in("department_id", ids)
        .in("state", ["active", "approved", "pending_approval"]),
      "staff count",
    ),
    count(
      ctx.sb
        .from("clinic_sessions")
        .select("id", { count: "exact", head: true })
        .in("department_id", ids)
        .eq("status", "published")
        .gt("starts_at", nowIso())
        .gt("booked_count", 0),
      "session count",
    ),
    count(
      ctx.sb
        .from("hospital_wards")
        .select("id", { count: "exact", head: true })
        .in("department_id", ids)
        .is("archived_at", null),
      "ward count",
    ),
  ]);
  return { staff, bookedSessions, wards, units: 0, occupiedBeds: 0 };
}

const TABLE = {
  department: "hospital_departments",
  ward: "hospital_wards",
  place: "hospital_places",
  clinic: "service_lines",
  bed: "hospital_beds",
} as const;

const archive: OpHandler = async (ctx, i) => {
  const table = TABLE[i.target as keyof typeof TABLE];
  const row = must(
    await ctx.sb
      .from(table)
      .select("id, archived_at")
      .eq("id", i.id)
      .eq("hospital_id", ctx.hospitalId)
      .maybeSingle(),
    "lookup",
  ) as { id: string; archived_at: string | null } | null;
  if (!row) throw new HubError("Not found at this hospital.");
  if (row.archived_at) throw new HubError("Already archived.", 409);
  let extraIds: string[] = [];
  let inUse = { staff: 0, bookedSessions: 0, wards: 0, units: 0, occupiedBeds: 0 };
  if (i.target === "department") {
    const d = await loadDepartment(ctx, i.id);
    if (d.is_start)
      throw new HubError(
        "This is where you start with MedSync. Choose another start department first.",
        409,
      );
    const all = await allDepartments(ctx);
    extraIds = all.filter((x) => x.parent_id === d.id && !x.archived_at).map((x) => x.id);
    inUse = await departmentInUse(ctx, [d.id, ...extraIds]);
  } else if (i.target === "ward") {
    // ADR 0194: a ward with a patient in a bed can't be archived.
    inUse.occupiedBeds = await occupiedBedCount(ctx, { wardIds: [i.id] });
  } else if (i.target === "bed") {
    inUse.occupiedBeds = await occupiedBedCount(ctx, { bedIds: [i.id] });
  } else if (i.target === "clinic") {
    const r = await ctx.sb
      .from("clinic_sessions")
      .select("id", { count: "exact", head: true })
      .eq("service_line_id", i.id)
      .eq("status", "published")
      .gt("starts_at", nowIso())
      .gt("booked_count", 0);
    if (r.error) throw new Error(r.error.message);
    inUse.bookedSessions = r.count ?? 0;
  }
  const verdict = archiveVerdict(inUse);
  if (!verdict.ok) throw new HubError(verdict.reason, 409);
  return {
    audit: {
      action: "archive_structure",
      reason: i.reason,
      before: { target: i.target, id: i.id, units_archived_with_it: extraIds.length },
    },
    apply: async () => {
      const at = nowIso();
      const patch: Record<string, unknown> = { archived_at: at };
      if (i.target === "clinic") patch.active = false;
      if (i.target === "ward") patch.state = "inactive"; // 0022 readers keep working
      must(
        await ctx.sb
          .from(table)
          .update(patch)
          .in("id", [i.id, ...extraIds]),
        "archive",
      );
      if (i.target === "department") {
        // Its clinics stop too (none has bookings — STR-4 checked).
        must(
          await ctx.sb
            .from("service_lines")
            .update({ active: false, archived_at: at })
            .in("department_id", [i.id, ...extraIds])
            .is("archived_at", null),
          "archive clinics",
        );
      }
    },
  };
};

const unarchive: OpHandler = async (ctx, i) => {
  const table = TABLE[i.target as keyof typeof TABLE];
  const row = must(
    await ctx.sb
      .from(table)
      .select("id, archived_at")
      .eq("id", i.id)
      .eq("hospital_id", ctx.hospitalId)
      .maybeSingle(),
    "lookup",
  ) as { id: string; archived_at: string | null } | null;
  if (!row) throw new HubError("Not found at this hospital.");
  if (!row.archived_at) throw new HubError("It isn't archived.", 409);
  if (i.target === "bed") {
    const bed = must(
      await ctx.sb.from("hospital_beds").select("ward_id").eq("id", i.id).maybeSingle(),
      "bed ward",
    ) as { ward_id: string } | null;
    if (bed && (await hasPublishedLayout(ctx, bed.ward_id)))
      throw new HubError(
        "This ward's beds come from its layout. Put the bed back on the plan.",
        409,
      );
  }
  return {
    audit: {
      action: "unarchive_structure",
      reason: reasonOr(i.reason, `Restored a ${i.target} from the archive`),
      before: { target: i.target, id: i.id },
    },
    apply: async () => {
      const patch: Record<string, unknown> = { archived_at: null };
      if (i.target === "ward") patch.state = "active";
      must(await ctx.sb.from(table).update(patch).eq("id", i.id), "unarchive");
      if (i.target === "department") {
        must(
          await ctx.sb
            .from("hospital_departments")
            .update({ archived_at: null })
            .eq("parent_id", i.id)
            .eq("archived_at", row.archived_at),
          "units",
        );
      }
    },
  };
};

/** The database guard (migration 0310) backs the checks above for the race of two saves; its hints become words. */
function wardWrite<T>(
  r: { data: T; error: { message: string; hint?: string | null } | null },
  what: string,
): T {
  const hint = r.error?.hint ?? "";
  if (hint === "ward_parent_not_ordinary")
    throw new HubError(WARD_ATTACH_WORDS.ordinaryParent, 409);
  if (hint === "ward_has_units") throw new HubError(WARD_ATTACH_WORDS.detachFirst, 409);
  return must(r, what);
}

const upsertWard: OpHandler = async (ctx, i) => {
  const dept = await loadDepartment(ctx, i.department_id);
  await assertPlace(ctx, i.place_id);
  const slug = slugify(i.name) || "ward";
  const clash = must(
    await ctx.sb
      .from("hospital_wards")
      .select("id")
      .eq("hospital_id", ctx.hospitalId)
      .eq("slug", slug)
      .maybeSingle(),
    "ward lookup",
  ) as { id: string } | null;
  if (clash && clash.id !== i.id)
    throw new HubError(`A ward called ${i.name} already exists.`, 409);
  const wardType = i.ward_type ?? null;
  // Wording is DRAFT for the CSO (content/eu/words.ts); the raw CHECK error never reaches the admin.
  let parentRow: { id: string; type: string | null; archived: boolean } | null = null;
  if (i.parent_ward_id) {
    const r = must(
      await ctx.sb
        .from("hospital_wards")
        .select("id, ward_type, archived_at")
        .eq("id", i.parent_ward_id)
        .eq("hospital_id", ctx.hospitalId)
        .maybeSingle(),
      "parent ward",
    ) as { id: string; ward_type: string | null; archived_at: string | null } | null;
    if (r) parentRow = { id: r.id, type: r.ward_type, archived: r.archived_at !== null };
  }
  let before: Record<string, unknown> | undefined;
  let bedCount: number = i.bed_count;
  let stored: { type: string | null } | null = null;
  if (i.id) {
    const w = must(
      await ctx.sb
        .from("hospital_wards")
        .select("id, name, bed_count, department_id, ward_type, parent_ward_id")
        .eq("id", i.id)
        .eq("hospital_id", ctx.hospitalId)
        .maybeSingle(),
      "ward",
    ) as (Record<string, unknown> & { bed_count: number; ward_type: string | null }) | null;
    if (!w) throw new HubError("Ward not found at this hospital.");
    before = w;
    stored = { type: w.ward_type };
  }
  const units = i.id
    ? await ctx.sb
        .from("hospital_wards")
        .select("id", { count: "exact", head: true })
        .eq("hospital_id", ctx.hospitalId)
        .eq("parent_ward_id", i.id)
        .is("archived_at", null)
    : null;
  if (units?.error) throw new Error(`ward units: ${units.error.message}`);
  const verdict = decideWardAttach({
    type: wardType,
    parentId: i.parent_ward_id,
    wardId: i.id ?? null,
    stored,
    parent: parentRow,
    units: units?.count ?? 0,
    occupied: i.id ? await occupiedBedCount(ctx, { wardIds: [i.id] }) : 0,
  });
  if (!verdict.ok) throw new HubError(verdict.message, verdict.status);
  if (i.id && before) {
    const w = before as { bed_count: number };
    if (await hasPublishedLayout(ctx, i.id)) {
      // ADR 0192 §6: a laid-out ward's count is its published layout's; the form can't change it.
      bedCount = w.bed_count;
    } else {
      const beds = await ctx.sb
        .from("hospital_beds")
        .select("id", { count: "exact", head: true })
        .eq("ward_id", i.id)
        .is("archived_at", null);
      if ((beds.count ?? 0) > i.bed_count) {
        throw new HubError(
          `The register holds ${beds.count} beds. Archive some before lowering the count.`,
          409,
        );
      }
    }
  }
  const row = {
    hospital_id: ctx.hospitalId,
    name: i.name,
    slug,
    department_id: dept.id,
    ward_type: wardType,
    sex: i.sex ?? null,
    age_group: i.age_group ?? null,
    place_id: i.place_id ?? null,
    bed_count: bedCount,
    ...(verdict.parent !== undefined ? { parent_ward_id: verdict.parent } : {}),
  };
  return {
    audit: {
      action: "update_ward",
      reason: reasonOr(i.reason, `${i.id ? "Updated" : "Added"} ward ${i.name}`),
      before,
      after: row,
    },
    apply: async () => {
      if (i.id) {
        wardWrite(await ctx.sb.from("hospital_wards").update(row).eq("id", i.id), "update ward");
        return { id: i.id };
      }
      const w = wardWrite(
        await ctx.sb.from("hospital_wards").insert(row).select("id").single(),
        "insert ward",
      ) as { id: string };
      return { id: w.id };
    },
  };
};

async function loadWard(ctx: Ctx, id: string) {
  const w = must(
    await ctx.sb
      .from("hospital_wards")
      .select("id, name, bed_count, closed_at, archived_at")
      .eq("id", id)
      .eq("hospital_id", ctx.hospitalId)
      .maybeSingle(),
    "ward",
  ) as {
    id: string;
    name: string;
    bed_count: number;
    closed_at: string | null;
    archived_at: string | null;
  } | null;
  if (!w) throw new HubError("Ward not found at this hospital.");
  return w;
}

const setWardClosure: OpHandler = async (ctx, i) => {
  const w = await loadWard(ctx, i.ward_id);
  if (i.closed && !i.closed_reason) throw new HubError("Say why the ward is closed.");
  const patch = i.closed
    ? {
        closed_at: nowIso(),
        closed_reason: i.closed_reason,
        expected_reopen_on: i.expected_reopen_on ?? null,
      }
    : { closed_at: null, closed_reason: null, expected_reopen_on: null };
  return {
    audit: {
      action: "update_ward",
      reason: reasonOr(i.reason, `${w.name} ${i.closed ? "temporarily closed" : "reopened"}`),
      before: { ward_id: w.id, closed: w.closed_at !== null },
      after: patch,
    },
    apply: async () => {
      must(await ctx.sb.from("hospital_wards").update(patch).eq("id", w.id), "ward closure");
    },
  };
};

const generateBeds: OpHandler = async (ctx, i) => {
  const w = await loadWard(ctx, i.ward_id);
  if (await hasPublishedLayout(ctx, w.id))
    throw new HubError("This ward's beds come from its layout. Add beds on the plan.", 409);
  const beds = must(
    await ctx.sb.from("hospital_beds").select("label, archived_at").eq("ward_id", w.id),
    "beds",
  ) as {
    label: string;
    archived_at: string | null;
  }[];
  const labels = bedLabelsToAdd(
    w.bed_count,
    beds.filter((b) => !b.archived_at).length,
    beds.map((b) => b.label),
  );
  if (!labels.length) throw new HubError("The register already matches the bed count.", 409);
  return {
    audit: {
      action: "update_beds",
      reason: reasonOr(i.reason, `Generated ${labels.length} bed(s) for ${w.name}`),
      after: { ward_id: w.id, labels },
    },
    apply: async () => {
      must(
        await ctx.sb
          .from("hospital_beds")
          .insert(labels.map((label) => ({ hospital_id: ctx.hospitalId, ward_id: w.id, label }))),
        "insert beds",
      );
      return { added: labels.length };
    },
  };
};

const setBed: OpHandler = async (ctx, i) => {
  const b = must(
    await ctx.sb
      .from("hospital_beds")
      .select("id, label, closed_at")
      .eq("id", i.bed_id)
      .eq("hospital_id", ctx.hospitalId)
      .maybeSingle(),
    "bed",
  ) as { id: string; label: string; closed_at: string | null } | null;
  if (!b) throw new HubError("Bed not found at this hospital.");
  const patch: Record<string, unknown> = {};
  if (i.label !== undefined) patch.label = i.label;
  if (i.closed === true) {
    if (!i.closed_reason) throw new HubError("Say why the bed is closed.");
    if ((await occupiedBedCount(ctx, { bedIds: [b.id] })) > 0)
      throw new HubError(`Bed ${b.label} has a patient in it. Release the patient first.`, 409);
    patch.closed_at = nowIso();
    patch.closed_reason = i.closed_reason;
  } else if (i.closed === false) {
    patch.closed_at = null;
    patch.closed_reason = null;
  }
  if (!Object.keys(patch).length) throw new HubError("Nothing to change.");
  return {
    audit: {
      action: "update_beds",
      reason: reasonOr(i.reason, `Bed ${b.label} updated`),
      before: { bed_id: b.id, label: b.label, closed: b.closed_at !== null },
      after: patch,
    },
    apply: async () => {
      must(await ctx.sb.from("hospital_beds").update(patch).eq("id", b.id), "update bed");
    },
  };
};

const assignWardInCharge: OpHandler = async (ctx, i) => {
  const w = await loadWard(ctx, i.ward_id);
  if (!inChargeEligible(await affiliationsAt(ctx, i.user_id), i.user_id)) {
    throw new HubError("Ward in-charges come from approved nursing staff at this hospital.");
  }
  const open = must(
    await ctx.sb
      .from("ward_in_charge_assignments")
      .select("id, nurse_user_id, acting")
      .eq("ward_id", w.id)
      .is("ends_at", null),
    "current in-charge",
  ) as { id: string; nurse_user_id: string; acting: boolean }[];
  const replacing = open.filter((a) => a.acting === i.acting);
  return {
    audit: {
      action: "assign_ward_in_charge",
      reason: reasonOr(
        i.reason,
        `${i.acting ? "Acting in-charge" : "In-charge"} of ${w.name} assigned`,
      ),
      before: { ward_id: w.id, previous: replacing.map((a) => a.nurse_user_id) },
      after: { user_id: i.user_id, acting: i.acting },
    },
    apply: async () => {
      if (replacing.length) {
        must(
          await ctx.sb
            .from("ward_in_charge_assignments")
            .update({ ends_at: nowIso() })
            .in(
              "id",
              replacing.map((a) => a.id),
            ),
          "end previous",
        );
      }
      must(
        await ctx.sb.from("ward_in_charge_assignments").insert({
          hospital_id: ctx.hospitalId,
          ward_id: w.id,
          nurse_user_id: i.user_id,
          acting: i.acting,
          ends_at: i.acting && i.ends_on ? endOfDay(i.ends_on) : null,
          set_by_user_id: ctx.callerId,
        }),
        "insert in-charge",
      );
    },
  };
};

const endWardInCharge: OpHandler = async (ctx, i) => {
  const a = must(
    await ctx.sb
      .from("ward_in_charge_assignments")
      .select("id, ward_id, nurse_user_id, ends_at")
      .eq("id", i.assignment_id)
      .eq("hospital_id", ctx.hospitalId)
      .maybeSingle(),
    "assignment",
  ) as { id: string; ward_id: string; nurse_user_id: string; ends_at: string | null } | null;
  if (!a) throw new HubError("That assignment isn't at this hospital.");
  if (a.ends_at && a.ends_at <= nowIso())
    throw new HubError("That assignment has already ended.", 409);
  return {
    audit: {
      action: "end_ward_in_charge",
      reason: reasonOr(i.reason, "Ward in-charge assignment ended"),
      before: { assignment_id: a.id, ward_id: a.ward_id, user_id: a.nurse_user_id },
    },
    apply: async () => {
      must(
        await ctx.sb
          .from("ward_in_charge_assignments")
          .update({ ends_at: nowIso() })
          .eq("id", a.id),
        "end in-charge",
      );
    },
  };
};

const upsertPlace: OpHandler = async (ctx, i) => {
  if (i.id) {
    const p = must(
      await ctx.sb
        .from("hospital_places")
        .select("id")
        .eq("id", i.id)
        .eq("hospital_id", ctx.hospitalId)
        .maybeSingle(),
      "place",
    );
    if (!p) throw new HubError("Place not found at this hospital.");
  }
  const row = {
    hospital_id: ctx.hospitalId,
    name: i.name,
    building: i.building || null,
    floor: i.floor || null,
    room: i.room || null,
    directions: i.directions || null,
  };
  return {
    audit: {
      action: "update_place",
      reason: reasonOr(i.reason, `${i.id ? "Updated" : "Added"} place ${i.name}`),
      after: row,
    },
    apply: async () => {
      if (i.id) {
        must(await ctx.sb.from("hospital_places").update(row).eq("id", i.id), "update place");
        return { id: i.id };
      }
      const p = must(
        await ctx.sb.from("hospital_places").insert(row).select("id").single(),
        "insert place",
      ) as { id: string };
      return { id: p.id };
    },
  };
};

export const STRUCTURE_OPS: Record<string, OpHandler> = {
  add_departments: addDepartments,
  update_department: updateDepartment,
  set_department_live: setDepartmentLive,
  set_departments_live: setDepartmentsLive,
  set_start_department: setStartDepartment,
  assign_head: assignHead,
  end_head: endHead,
  add_unit: addUnit,
  set_dispensing_point: setDispensingPoint,
  archive,
  unarchive,
  upsert_ward: upsertWard,
  set_ward_closure: setWardClosure,
  generate_beds: generateBeds,
  set_bed: setBed,
  assign_ward_in_charge: assignWardInCharge,
  end_ward_in_charge: endWardInCharge,
  upsert_place: upsertPlace,
};

/** Kept for tests: every catalogue code the add op accepts. */
export const ADDABLE_DEPARTMENT_CODES = CATALOGUE_DEPARTMENTS.map((d) => d.code);
