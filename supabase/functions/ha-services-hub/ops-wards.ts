/**
 * Ward builder ops (ADRs 0191–0196): the layout draft, publish (the reconcile, applied in one SQL
 * transaction), start from the register, discard a draft; and the live board's bed state, assign and
 * release. Same contract as the other hub ops: Zod → caller → role → plan() reads → audit → apply().
 *
 * Who: the layout ops need a hospital admin (or superadmin). The live ops also let the ward's in-charge
 * and the nurses assigned to the ward act (role "ward_staff", checked per ward in assertWardWorker).
 *
 * Admissions (0091, ADRs 0199–0200): ward staff allocate a bed to a patient on the waiting list, confirm
 * Arrived, and cancel an allocation or end a wait. Each is one SQL function (one transaction, row locks).
 */
import type { RegisterBed, WardLayout } from "../_shared/ward-layout.ts";
import type { Ctx, OpHandler } from "./common.ts";
import { z } from "npm:zod@4.4.3";

import { EU_SEND_FROM_VISIT, euObservationOn, euRefusal } from "../_shared/eu.ts";
import {
  blockingFailures,
  buildLayoutSchema,
  FLOOR_DEFAULT,
  itemCount,
  layoutChecks,
  layoutFromRegister,
  MAX_BEDS,
  mayWorkBeds,
  planSummary,
  publishPayload,
  reconcile,
  warningTexts,
} from "../_shared/ward-layout.ts";
import { HubError, must, reasonOr } from "./common.ts";

const uuid = z.string().uuid();
const reason = z.string().trim().max(500).optional();
const LayoutSchema = buildLayoutSchema(z);

export const WardOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("save_ward_layout_draft"),
    ward_id: uuid,
    document: z.unknown(),
    /** The draft revision the editor last saw; null when it started without a draft. */
    base_revision: z.number().int().min(1).nullable(),
    reason,
  }),
  z.object({
    op: z.literal("publish_ward_layout"),
    ward_id: uuid,
    /** The check texts the admin saw; the server recomputes them and refuses if they differ. */
    accepted_warnings: z.array(z.string().max(1000)).max(40),
    reason,
  }),
  z.object({ op: z.literal("start_layout_from_register"), ward_id: uuid, reason }),
  z.object({ op: z.literal("discard_ward_layout_draft"), ward_id: uuid, reason }),
  z.object({
    op: z.literal("set_bed_state"),
    bed_id: uuid,
    state: z.enum(["free", "cleaning", "reserved"]),
    reason: z.string().trim().max(200).optional(),
  }),
  z.object({
    op: z.literal("assign_bed"),
    bed_id: uuid,
    patient_user_id: uuid,
    encounter_id: uuid.nullable().optional(),
    reason,
  }),
  z.object({
    op: z.literal("release_bed"),
    assignment_id: uuid,
    reason: z.string().trim().min(3, "Say why the patient is leaving the bed.").max(200),
    /** Where the bed goes next: to be cleaned, or straight back to free. */
    next_state: z.enum(["cleaning", "free"]).optional(),
  }),
  z.object({
    op: z.literal("move_eu_space"),
    stay_id: uuid,
    ward_id: uuid.optional(),
    bed_id: uuid.optional(),
    space_wait_reason: z.enum(["no_free_bed", "extra_bed", "floor", "other"]).optional(),
    space_wait_note_ciphertext: z.string().max(4000).optional(),
    reason,
  }),
  z.object({
    op: z.literal("link_resus_bay"),
    bay_profile_id: uuid,
    bed_id: uuid.nullable(),
    reason,
  }),
  z.object({
    op: z.literal("link_care_unit"),
    care_unit_id: uuid,
    ward_id: uuid.nullable(),
    reason,
  }),
  z.object({ op: z.literal("allocate_admission_bed"), admission_id: uuid, bed_id: uuid, reason }),
  z.object({ op: z.literal("confirm_arrival"), assignment_id: uuid, reason }),
  z.object({
    op: z.literal("release_admission_bed"),
    admission_id: uuid,
    reason: z.string().trim().min(3, "Say why, in a few words.").max(200),
    /** Still needs a bed (back to the waiting list), or the admission ends. */
    outcome: z.enum(["wait", "end"]),
  }),
]);

/** The live ops a ward's in-charge and assigned nurses may run (ADR 0194 §3). */
export const WARD_STAFF_OPS = new Set([
  "set_bed_state",
  "assign_bed",
  "release_bed",
  "move_eu_space",
  "allocate_admission_bed",
  "confirm_arrival",
  "release_admission_bed",
]);

/* ─── helpers ───────────────────────────────────────────────────────── */

const nowIso = () => new Date().toISOString();

interface WardRow {
  id: string;
  name: string;
  ward_type: string | null;
  age_group: string | null;
  bed_count: number;
  archived_at: string | null;
}

async function loadWard(ctx: Ctx, id: string): Promise<WardRow> {
  const w = must(
    await ctx.sb
      .from("hospital_wards")
      .select("id, name, ward_type, age_group, bed_count, archived_at")
      .eq("id", id)
      .eq("hospital_id", ctx.hospitalId)
      .maybeSingle(),
    "ward",
  ) as WardRow | null;
  if (!w) throw new HubError("Ward not found at this hospital.");
  return w;
}

interface LayoutRow {
  id: string;
  version: number;
  revision: number;
  state: "draft" | "published";
  document: unknown;
}

/** The ward's draft and published layouts, and the highest version used. */
async function layoutsOf(ctx: Ctx, wardId: string) {
  const rows = must(
    await ctx.sb
      .from("ward_layouts")
      .select("id, version, revision, state, document")
      .eq("ward_id", wardId)
      .eq("hospital_id", ctx.hospitalId)
      .order("version", { ascending: false }),
    "layouts",
  ) as (LayoutRow | (Omit<LayoutRow, "state"> & { state: "superseded" }))[];
  return {
    draft: (rows.find((r) => r.state === "draft") as LayoutRow | undefined) ?? null,
    published: (rows.find((r) => r.state === "published") as LayoutRow | undefined) ?? null,
    maxVersion: rows[0]?.version ?? 0,
  };
}

function parseDocument(raw: unknown): WardLayout {
  const r = LayoutSchema.safeParse(raw);
  if (!r.success)
    throw new HubError(r.error.issues[0]?.message ?? "The layout doesn't fit its schema.");
  return r.data as WardLayout;
}

/** Every register bed of the ward (archived too), with its services. */
async function registerOf(ctx: Ctx, wardId: string): Promise<RegisterBed[]> {
  const beds = must(
    await ctx.sb
      .from("hospital_beds")
      .select(
        "id, label, bed_type, closed_at, closed_reason, archived_at, layout_x, layout_y, rotation, room_key",
      )
      .eq("ward_id", wardId)
      .eq("hospital_id", ctx.hospitalId),
    "beds",
  ) as {
    id: string;
    label: string;
    bed_type: string | null;
    closed_at: string | null;
    closed_reason: string | null;
    archived_at: string | null;
    layout_x: number | null;
    layout_y: number | null;
    rotation: number | null;
    room_key: string | null;
  }[];
  const ids = beds.map((b) => b.id);
  const services = ids.length
    ? (must(
        await ctx.sb.from("hospital_bed_services").select("bed_id, service_code").in("bed_id", ids),
        "bed services",
      ) as { bed_id: string; service_code: string }[])
    : [];
  return beds.map((b) => ({
    id: b.id,
    label: b.label,
    bedType: b.bed_type,
    closedAt: b.closed_at,
    closedReason: b.closed_reason,
    archivedAt: b.archived_at,
    layoutX: b.layout_x,
    layoutY: b.layout_y,
    rotation: b.rotation,
    roomKey: b.room_key,
    services: services.filter((s) => s.bed_id === b.id).map((s) => s.service_code),
  }));
}

async function occupiedIn(ctx: Ctx, wardId: string): Promise<string[]> {
  const rows = must(
    await ctx.sb
      .from("bed_assignments")
      .select("bed_id")
      .eq("ward_id", wardId)
      .eq("hospital_id", ctx.hospitalId)
      .is("ended_at", null),
    "open assignments",
  ) as { bed_id: string }[];
  return rows.map((r) => r.bed_id);
}

/** ADR 0194 §3: the admin, the ward's in-charge (or acting), or a nurse assigned on the ward. */
async function assertWardWorker(ctx: Ctx, wardId: string) {
  if (ctx.role === "hospital_admin" || ctx.role === "superadmin") return;
  const now = nowIso();
  const [aff, charges, assigned] = await Promise.all([
    ctx.sb
      .from("staff_affiliations")
      .select("id")
      .eq("user_id", ctx.callerId)
      .eq("hospital_id", ctx.hospitalId)
      .in("state", ["active", "approved"])
      .limit(1),
    ctx.sb
      .from("ward_in_charge_assignments")
      .select("ward_id, ends_at")
      .eq("nurse_user_id", ctx.callerId)
      .eq("hospital_id", ctx.hospitalId)
      .lte("starts_at", now),
    ctx.sb
      .from("nursing_assignments")
      .select("ward_id, ends_at")
      .eq("nurse_user_id", ctx.callerId)
      .eq("hospital_id", ctx.hospitalId)
      .lte("starts_at", now),
  ]);
  const open = (rows: { ward_id: string | null; ends_at: string | null }[] | null) =>
    (rows ?? [])
      .filter((r) => r.ward_id && (r.ends_at === null || r.ends_at > now))
      .map((r) => r.ward_id as string);
  const ok =
    (aff.data ?? []).length > 0 &&
    mayWorkBeds(
      { admin: false, inChargeWardIds: open(charges.data), assignedWardIds: open(assigned.data) },
      wardId,
    );
  if (!ok)
    throw new HubError(
      "Only the hospital admin, this ward's in-charge or a nurse assigned to this ward can do that.",
      403,
    );
}

interface BedRow {
  id: string;
  ward_id: string;
  label: string;
  closed_at: string | null;
  archived_at: string | null;
}

async function loadBed(ctx: Ctx, id: string): Promise<BedRow> {
  const b = must(
    await ctx.sb
      .from("hospital_beds")
      .select("id, ward_id, label, closed_at, archived_at")
      .eq("id", id)
      .eq("hospital_id", ctx.hospitalId)
      .maybeSingle(),
    "bed",
  ) as BedRow | null;
  if (!b || b.archived_at) throw new HubError("Bed not found at this hospital.");
  return b;
}

async function openAssignmentOn(ctx: Ctx, bedId: string) {
  return must(
    await ctx.sb
      .from("bed_assignments")
      .select("id")
      .eq("bed_id", bedId)
      .is("ended_at", null)
      .maybeSingle(),
    "open assignment",
  ) as { id: string } | null;
}

/** supabase-js errors from the publish function carry the SQL message ("WL409 …", "EU409 …"). */
function hubErrorFrom(e: { message: string; code?: string }): HubError | null {
  const m = /^(?:WL|AD|EU)(409|404|400) (.*)$/s.exec(e.message);
  if (m) return new HubError(m[2]!, m[1] === "409" ? 409 : 400);
  // A deadlock or serialization failure: the words say try again.
  const retry = euRefusal(e);
  if (retry) return new HubError(retry, 409);
  if (e.code === "23505")
    return new HubError("Someone changed this at the same moment. Look again, then retry.", 409);
  return null;
}

/* ─── layout ops (hospital admin) ───────────────────────────────────── */

const saveWardLayoutDraft: OpHandler = async (ctx, i) => {
  const w = await loadWard(ctx, i.ward_id);
  if (w.archived_at) throw new HubError("This ward is archived.", 409);
  const doc = parseDocument(i.document);
  const { draft, maxVersion } = await layoutsOf(ctx, w.id);
  if ((draft?.revision ?? null) !== i.base_revision) {
    throw new HubError(
      "This layout was saved from another window since you opened it. Reload to see it.",
      409,
    );
  }
  const row = {
    document: doc,
    floor_w_cells: doc.floor.w,
    floor_h_cells: doc.floor.h,
  };
  return {
    audit: {
      action: "save_ward_layout",
      reason: reasonOr(i.reason, `Draft layout saved for ${w.name}`),
      before: { ward_id: w.id, revision: draft?.revision ?? null },
      after: { beds: doc.beds.length, items: itemCount(doc) },
    },
    apply: async () => {
      if (draft) {
        const saved = must(
          await ctx.sb
            .from("ward_layouts")
            .update({ ...row, revision: draft.revision + 1 })
            .eq("id", draft.id)
            .eq("revision", draft.revision)
            .select("id, version, revision"),
          "save draft",
        ) as { id: string; version: number; revision: number }[];
        if (!saved.length)
          throw new HubError(
            "This layout was saved from another window since you opened it. Reload to see it.",
            409,
          );
        return {
          layout_id: saved[0]!.id,
          version: saved[0]!.version,
          revision: saved[0]!.revision,
        };
      }
      const r = await ctx.sb
        .from("ward_layouts")
        .insert({
          ...row,
          hospital_id: ctx.hospitalId,
          ward_id: w.id,
          version: maxVersion + 1,
          created_by: ctx.callerId,
        })
        .select("id, version, revision")
        .single();
      if (r.error) throw hubErrorFrom(r.error) ?? new Error(`insert draft: ${r.error.message}`);
      return { layout_id: r.data.id, version: r.data.version, revision: r.data.revision };
    },
  };
};

const publishWardLayout: OpHandler = async (ctx, i) => {
  const w = await loadWard(ctx, i.ward_id);
  if (w.archived_at) throw new HubError("This ward is archived.", 409);
  const { draft } = await layoutsOf(ctx, w.id);
  if (!draft) throw new HubError("There is no draft to publish. Save the layout first.", 409);
  const doc = parseDocument(draft.document);
  const checks = layoutChecks(doc, w.ward_type, w.age_group);
  const blocking = blockingFailures(checks);
  if (blocking.length) throw new HubError(blocking.map((c) => c.text).join(" · "), 409);
  const warnings = warningTexts(checks);
  const seen = new Set<string>(i.accepted_warnings);
  if (warnings.length !== seen.size || warnings.some((t) => !seen.has(t))) {
    throw new HubError(
      "The checks changed since you looked. Review them again, then publish.",
      409,
    );
  }
  const outcome = reconcile({
    doc,
    register: await registerOf(ctx, w.id),
    occupiedBedIds: await occupiedIn(ctx, w.id),
  });
  if (!outcome.ok) throw new HubError(outcome.refusal, 409);
  const summary = planSummary(outcome.plan);
  const payload = publishPayload(outcome.plan, {
    hospitalId: ctx.hospitalId,
    wardId: w.id,
    draftId: draft.id,
    draftRevision: draft.revision,
    actorId: ctx.callerId,
    warnings,
  });
  return {
    audit: {
      action: "publish_ward_layout",
      reason: reasonOr(i.reason, `Layout version ${draft.version} of ${w.name} published`),
      before: { ward_id: w.id, version: draft.version, bed_count: w.bed_count },
      after: { ...summary, warnings },
    },
    apply: async () => {
      const r = await ctx.sb.rpc("ward_layout_publish", { p: payload });
      if (r.error) throw hubErrorFrom(r.error) ?? new Error(`publish: ${r.error.message}`);
      return r.data as Record<string, unknown>;
    },
  };
};

const startLayoutFromRegister: OpHandler = async (ctx, i) => {
  const w = await loadWard(ctx, i.ward_id);
  if (w.archived_at) throw new HubError("This ward is archived.", 409);
  const { draft, published, maxVersion } = await layoutsOf(ctx, w.id);
  if (draft || published)
    throw new HubError("This ward already has a layout. Open it instead.", 409);
  const active = (await registerOf(ctx, w.id)).filter((b) => !b.archivedAt);
  if (!active.length) throw new HubError("This ward has no beds in its register yet.", 409);
  if (active.length > MAX_BEDS)
    throw new HubError(
      `A layout holds at most ${MAX_BEDS} beds; this register has ${active.length}.`,
    );
  const doc = parseDocument(layoutFromRegister(active, FLOOR_DEFAULT));
  return {
    audit: {
      action: "save_ward_layout",
      reason: reasonOr(i.reason, `Layout for ${w.name} started from its register`),
      after: { ward_id: w.id, beds: doc.beds.length },
    },
    apply: async () => {
      const r = await ctx.sb
        .from("ward_layouts")
        .insert({
          hospital_id: ctx.hospitalId,
          ward_id: w.id,
          version: maxVersion + 1,
          floor_w_cells: doc.floor.w,
          floor_h_cells: doc.floor.h,
          document: doc,
          created_by: ctx.callerId,
        })
        .select("id, version, revision")
        .single();
      if (r.error) throw hubErrorFrom(r.error) ?? new Error(`insert draft: ${r.error.message}`);
      return { layout_id: r.data.id, version: r.data.version, revision: r.data.revision };
    },
  };
};

const discardWardLayoutDraft: OpHandler = async (ctx, i) => {
  const w = await loadWard(ctx, i.ward_id);
  const { draft } = await layoutsOf(ctx, w.id);
  if (!draft) throw new HubError("There is no draft to discard.", 409);
  return {
    audit: {
      action: "save_ward_layout",
      reason: reasonOr(i.reason, `Draft layout of ${w.name} discarded`),
      before: { ward_id: w.id, version: draft.version, revision: draft.revision },
    },
    apply: async () => {
      must(
        await ctx.sb.from("ward_layouts").delete().eq("id", draft.id).eq("state", "draft"),
        "discard",
      );
    },
  };
};

/* ─── live ops (admin, in-charge, the ward's nurses) ─────────────────── */

const setBedState: OpHandler = async (ctx, i) => {
  const b = await loadBed(ctx, i.bed_id);
  await assertWardWorker(ctx, b.ward_id);
  if (b.closed_at)
    throw new HubError(
      `Bed ${b.label} is out of service. The admin reopens it in the layout.`,
      409,
    );
  if (await openAssignmentOn(ctx, b.id))
    throw new HubError(`Bed ${b.label} has a patient in it. Release the patient first.`, 409);
  const why = i.reason?.trim() || null;
  if (i.state === "reserved" && (!why || why.length < 3))
    throw new HubError("Say who or what the bed is held for.");
  return {
    audit: {
      action: "set_bed_state",
      reason: reasonOr(undefined, `Bed ${b.label} set to ${i.state}`),
      after: { bed_id: b.id, ward_id: b.ward_id, state: i.state },
    },
    apply: async () => {
      must(
        await ctx.sb.from("bed_state_events").insert({
          hospital_id: ctx.hospitalId,
          bed_id: b.id,
          state: i.state,
          reason: why,
          set_by: ctx.callerId,
        }),
        "state event",
      );
    },
  };
};

/** Intake statuses that still wait for a place (the board offers these; ADR 0194 §4). */
const WAITING_INTAKE = ["arrived", "awaiting_triage", "triaged"];

const assignBed: OpHandler = async (ctx, i) => {
  const b = await loadBed(ctx, i.bed_id);
  await assertWardWorker(ctx, b.ward_id);
  // Server-side twin of the app's guard: a direct hub call cannot bypass it.
  if (euObservationOn(Deno.env.get("EU_OBSERVATION"), ctx.hospitalId)) {
    const w = await loadWard(ctx, b.ward_id);
    if (w.ward_type === "emergency_observation") throw new HubError(EU_SEND_FROM_VISIT, 409);
  }
  if (b.closed_at) throw new HubError(`Bed ${b.label} is out of service.`, 409);
  if (await openAssignmentOn(ctx, b.id))
    throw new HubError(`Bed ${b.label} already has a patient.`, 409);
  // A boarder holds two open rows (EU space + ward bed, ADR 0542); any open row refuses a direct bed.
  const [elsewhere] = must(
    await ctx.sb
      .from("bed_assignments")
      .select("id, hospital_beds(label)")
      .eq("patient_user_id", i.patient_user_id)
      .is("ended_at", null)
      .limit(1),
    "patient's bed",
  ) as { id: string; hospital_beds: { label: string } | null }[];
  if (elsewhere)
    throw new HubError(
      `This patient is already in bed ${elsewhere.hospital_beds?.label ?? "elsewhere"}. Release them there first.`,
      409,
    );
  const intakes = must(
    await ctx.sb
      .from("patient_intakes")
      .select("id, encounter_id")
      .eq("hospital_id", ctx.hospitalId)
      .eq("receiving_ward_id", b.ward_id)
      .eq("patient_user_id", i.patient_user_id)
      .in("status", WAITING_INTAKE)
      .order("arrived_at", { ascending: false })
      .limit(1),
    "receiving intake",
  ) as { id: string; encounter_id: string | null }[];
  if (!intakes.length)
    throw new HubError("Only a patient sent to this ward can be given a bed here.", 409);
  let encounterId: string | null = intakes[0]!.encounter_id;
  if (i.encounter_id) {
    const e = must(
      await ctx.sb
        .from("encounters")
        .select("id")
        .eq("id", i.encounter_id)
        .eq("hospital_id", ctx.hospitalId)
        .eq("patient_user_id", i.patient_user_id)
        .maybeSingle(),
      "encounter",
    );
    if (!e) throw new HubError("That visit isn't this patient's at this hospital.");
    encounterId = i.encounter_id;
  }
  return {
    audit: {
      action: "assign_bed",
      reason: reasonOr(i.reason, `Patient given bed ${b.label}`),
      after: {
        bed_id: b.id,
        ward_id: b.ward_id,
        patient_user_id: i.patient_user_id,
        encounter_id: encounterId,
      },
    },
    apply: async () => {
      const r = await ctx.sb
        .from("bed_assignments")
        .insert({
          hospital_id: ctx.hospitalId,
          ward_id: b.ward_id,
          bed_id: b.id,
          patient_user_id: i.patient_user_id,
          encounter_id: encounterId,
          started_by: ctx.callerId,
        })
        .select("id")
        .single();
      if (r.error) throw hubErrorFrom(r.error) ?? new Error(`assign: ${r.error.message}`);
      return { assignment_id: r.data.id };
    },
  };
};

const releaseBed: OpHandler = async (ctx, i) => {
  const a = must(
    await ctx.sb
      .from("bed_assignments")
      .select(
        "id, bed_id, ward_id, patient_user_id, ended_at, admission_id, arrived_at, eu_stay_id, hospital_beds(label)",
      )
      .eq("id", i.assignment_id)
      .eq("hospital_id", ctx.hospitalId)
      .maybeSingle(),
    "assignment",
  ) as {
    id: string;
    bed_id: string;
    ward_id: string;
    patient_user_id: string;
    ended_at: string | null;
    admission_id: string | null;
    arrived_at: string | null;
    eu_stay_id: string | null;
    hospital_beds: { label: string } | null;
  } | null;
  if (!a) throw new HubError("That bed assignment isn't at this hospital.");
  if (a.ended_at) throw new HubError("The patient has already left this bed.", 409);
  if (a.eu_stay_id)
    throw new HubError("Use Move to change the space; the stay ends when the visit closes.", 409);
  // An arriving patient's bed is cancelled with its admission (ADR 0199 §5), never released alone.
  if (a.admission_id && !a.arrived_at)
    throw new HubError("This patient hasn't arrived yet. Use Cancel on the arriving bed.", 409);
  await assertWardWorker(ctx, a.ward_id);
  const label = a.hospital_beds?.label ?? "the bed";
  return {
    audit: {
      action: "release_bed",
      reason: reasonOr(i.reason, `Patient released from bed ${label}`),
      before: { assignment_id: a.id, bed_id: a.bed_id, patient_user_id: a.patient_user_id },
      after: { next_state: i.next_state ?? null },
    },
    apply: async () => {
      const ended = must(
        await ctx.sb
          .from("bed_assignments")
          .update({ ended_at: nowIso(), ended_by: ctx.callerId, reason: i.reason })
          .eq("id", a.id)
          .is("ended_at", null)
          .select("id"),
        "release",
      ) as { id: string }[];
      if (!ended.length) throw new HubError("The patient has already left this bed.", 409);
      if (i.next_state) {
        must(
          await ctx.sb.from("bed_state_events").insert({
            hospital_id: ctx.hospitalId,
            bed_id: a.bed_id,
            state: i.next_state,
            reason: null,
            set_by: ctx.callerId,
          }),
          "state after release",
        );
      }
    },
  };
};

/* ─── admissions (0091): the waiting list, Arrived, cancel ─────────── */

interface AdmissionRow {
  id: string;
  ward_id: string;
  patient_user_id: string;
  status: string;
}

async function loadAdmission(ctx: Ctx, id: string): Promise<AdmissionRow> {
  const a = must(
    await ctx.sb
      .from("admissions")
      .select("id, ward_id, patient_user_id, status")
      .eq("id", id)
      .eq("hospital_id", ctx.hospitalId)
      .maybeSingle(),
    "admission",
  ) as AdmissionRow | null;
  if (!a) throw new HubError("That admission isn't at this hospital.");
  return a;
}

/** One admission function, its refusals as the words after the code. */
async function rpc(ctx: Ctx, fn: string, p: Record<string, unknown>) {
  const r = await ctx.sb.rpc(fn, {
    p: { ...p, hospital_id: ctx.hospitalId, actor: ctx.callerId },
  });
  // Never the raw DB message: the name and SQLSTATE only.
  if (r.error) throw hubErrorFrom(r.error) ?? new Error(`${fn}: ${r.error.code ?? "error"}`);
  return r.data as Record<string, unknown>;
}

const moveEuSpace: OpHandler = async (ctx, i) => {
  const sr = await ctx.sb
    .from("eu_stays")
    .select("id, ward_id, patient_user_id, status")
    .eq("id", i.stay_id)
    .eq("hospital_id", ctx.hospitalId)
    .maybeSingle();
  if (missing(sr.error)) throw new HubError("The emergency unit is not set up yet.", 409);
  if (sr.error) throw new Error(`eu stay: ${sr.error.code ?? "error"}`);
  const stay = sr.data as {
    id: string;
    ward_id: string;
    patient_user_id: string;
    status: string;
  } | null;
  if (!stay) throw new HubError("That stay isn't at this hospital.");
  await assertWardWorker(ctx, stay.ward_id);
  if (i.ward_id && i.ward_id !== stay.ward_id) await assertWardWorker(ctx, i.ward_id);
  return {
    audit: {
      action: "move_eu_space",
      reason: reasonOr(i.reason, "Patient moved to another space in the emergency unit"),
      before: { stay_id: stay.id, ward_id: stay.ward_id, patient_user_id: stay.patient_user_id },
      after: {
        ward_id: i.ward_id ?? stay.ward_id,
        bed_id: i.bed_id ?? null,
        space_wait_reason: i.space_wait_reason ?? null,
      },
    },
    apply: () =>
      rpc(ctx, "move_eu_space", {
        stay_id: stay.id,
        ward_id: i.ward_id,
        bed_id: i.bed_id,
        space_wait_reason: i.space_wait_reason,
        space_wait_note_ciphertext: i.space_wait_note_ciphertext,
      }),
  };
};

/** Admin ops (not in WARD_STAFF_OPS): a resus bay points at a resus space of an EU, a care unit at a ward (D7). */
const linkResusBay: OpHandler = async (ctx, i) => {
  const bay = must(
    await ctx.sb
      .from("resus_bay_profiles")
      .select("id, bay_label")
      .eq("id", i.bay_profile_id)
      .eq("hospital_id", ctx.hospitalId)
      .maybeSingle(),
    "resus bay",
  ) as { id: string; bay_label: string } | null;
  if (!bay) throw new HubError("That resus bay isn't at this hospital.");
  if (i.bed_id) {
    const b = must(
      await ctx.sb
        .from("hospital_beds")
        .select("id, bed_type, archived_at, hospital_wards(ward_type)")
        .eq("id", i.bed_id)
        .eq("hospital_id", ctx.hospitalId)
        .maybeSingle(),
      "bed",
    ) as {
      bed_type: string | null;
      archived_at: string | null;
      hospital_wards: { ward_type: string | null } | null;
    } | null;
    if (
      !b ||
      b.bed_type !== "resus" ||
      b.archived_at ||
      b.hospital_wards?.ward_type !== "emergency_observation"
    )
      throw new HubError("Choose a resus space of an emergency unit.");
    const used = await ctx.sb
      .from("resus_bay_profiles")
      .select("id")
      .eq("bed_id", i.bed_id)
      .neq("id", bay.id)
      .limit(1);
    if (used.error) throw new Error(`bay link: ${used.error.code ?? "error"}`);
    if ((used.data ?? []).length > 0)
      throw new HubError("Another resus bay already uses that space.", 409);
  }
  return {
    audit: {
      action: "link_resus_bay",
      reason: reasonOr(
        i.reason,
        i.bed_id ? "Resus bay linked to an emergency unit space" : "Resus bay link removed",
      ),
      after: { bay_profile_id: bay.id, bed_id: i.bed_id },
    },
    apply: async () => {
      const r = await ctx.sb
        .from("resus_bay_profiles")
        .update({ bed_id: i.bed_id })
        .eq("id", bay.id)
        .eq("hospital_id", ctx.hospitalId);
      if (r.error) throw hubErrorFrom(r.error) ?? new Error(`link bay: ${r.error.code ?? "error"}`);
      return { bay_profile_id: bay.id, bed_id: i.bed_id };
    },
  };
};

const linkCareUnit: OpHandler = async (ctx, i) => {
  const u = must(
    await ctx.sb
      .from("hospital_care_units")
      .select("id")
      .eq("id", i.care_unit_id)
      .eq("hospital_id", ctx.hospitalId)
      .maybeSingle(),
    "care unit",
  ) as { id: string } | null;
  if (!u) throw new HubError("That care unit isn't at this hospital.");
  if (i.ward_id) {
    const w = await loadWard(ctx, i.ward_id).catch(() => null);
    if (!w || w.archived_at) throw new HubError("Choose a ward of this hospital.");
  }
  return {
    audit: {
      action: "link_care_unit",
      reason: reasonOr(
        i.reason,
        i.ward_id ? "Care unit linked to a ward" : "Care unit link removed",
      ),
      after: { care_unit_id: u.id, ward_id: i.ward_id },
    },
    apply: async () => {
      const r = await ctx.sb
        .from("hospital_care_units")
        .update({ ward_id: i.ward_id })
        .eq("id", u.id)
        .eq("hospital_id", ctx.hospitalId);
      if (r.error)
        throw hubErrorFrom(r.error) ?? new Error(`link unit: ${r.error.code ?? "error"}`);
      return { care_unit_id: u.id, ward_id: i.ward_id };
    },
  };
};

const allocateAdmissionBed: OpHandler = async (ctx, i) => {
  const a = await loadAdmission(ctx, i.admission_id);
  await assertWardWorker(ctx, a.ward_id);
  const b = await loadBed(ctx, i.bed_id);
  if (b.ward_id !== a.ward_id) throw new HubError("That bed is on another ward.", 409);
  return {
    audit: {
      action: "allocate_bed",
      reason: reasonOr(i.reason, `Bed ${b.label} allocated to an admitted patient`),
      after: { admission_id: a.id, bed_id: b.id, patient_user_id: a.patient_user_id },
    },
    apply: () => rpc(ctx, "allocate_admission_bed", { admission_id: a.id, bed_id: b.id }),
  };
};

const confirmArrival: OpHandler = async (ctx, i) => {
  const a = must(
    await ctx.sb
      .from("bed_assignments")
      .select("id, ward_id, admission_id, patient_user_id, hospital_beds(label)")
      .eq("id", i.assignment_id)
      .eq("hospital_id", ctx.hospitalId)
      .maybeSingle(),
    "assignment",
  ) as {
    id: string;
    ward_id: string;
    admission_id: string | null;
    patient_user_id: string;
    hospital_beds: { label: string } | null;
  } | null;
  if (!a) throw new HubError("That bed assignment isn't at this hospital.");
  await assertWardWorker(ctx, a.ward_id);
  return {
    audit: {
      action: "confirm_arrival",
      reason: reasonOr(i.reason, `Patient arrived in bed ${a.hospital_beds?.label ?? ""}`.trim()),
      after: {
        assignment_id: a.id,
        admission_id: a.admission_id,
        patient_user_id: a.patient_user_id,
      },
    },
    apply: () => rpc(ctx, "confirm_bed_arrival", { assignment_id: a.id }),
  };
};

const releaseAdmissionBed: OpHandler = async (ctx, i) => {
  const a = await loadAdmission(ctx, i.admission_id);
  await assertWardWorker(ctx, a.ward_id);
  return {
    audit: {
      action: "cancel_allocation",
      reason: reasonOr(i.reason, "Admission bed allocation cancelled"),
      before: { admission_id: a.id, status: a.status, patient_user_id: a.patient_user_id },
      after: { outcome: i.outcome },
    },
    apply: () =>
      rpc(ctx, "release_admission_bed", {
        admission_id: a.id,
        reason: i.reason,
        outcome: i.outcome,
      }),
  };
};

export const WARD_OPS: Record<string, OpHandler> = {
  save_ward_layout_draft: saveWardLayoutDraft,
  publish_ward_layout: publishWardLayout,
  start_layout_from_register: startLayoutFromRegister,
  discard_ward_layout_draft: discardWardLayoutDraft,
  set_bed_state: setBedState,
  assign_bed: assignBed,
  release_bed: releaseBed,
  move_eu_space: moveEuSpace,
  link_resus_bay: linkResusBay,
  link_care_unit: linkCareUnit,
  allocate_admission_bed: allocateAdmissionBed,
  confirm_arrival: confirmArrival,
  release_admission_bed: releaseAdmissionBed,
};

/* ─── seams for the structure ops (0090 may not be applied yet) ─────── */

/** Postgres "relation does not exist": the ward builder's tables before 0090 is applied. */
const missing = (e: { code?: string } | null) => e?.code === "42P01" || e?.code === "PGRST205";

/** True when the ward has a published layout (its beds then come from the layout, ADR 0192 §6). */
export async function hasPublishedLayout(ctx: Ctx, wardId: string): Promise<boolean> {
  const r = await ctx.sb
    .from("ward_layouts")
    .select("id")
    .eq("ward_id", wardId)
    .eq("state", "published")
    .limit(1);
  if (missing(r.error)) return false;
  if (r.error) throw new Error(`layout lookup: ${r.error.message}`);
  return (r.data ?? []).length > 0;
}

/** Open bed assignments in these wards, or on these beds (0 before 0090 is applied). */
export async function occupiedBedCount(
  ctx: Ctx,
  where: { wardIds?: string[]; bedIds?: string[] },
): Promise<number> {
  let q = ctx.sb
    .from("bed_assignments")
    .select("id", { count: "exact", head: true })
    .eq("hospital_id", ctx.hospitalId)
    .is("ended_at", null);
  if (where.wardIds) q = q.in("ward_id", where.wardIds);
  if (where.bedIds) q = q.in("bed_id", where.bedIds);
  const r = await q;
  if (missing(r.error)) return 0;
  if (r.error) throw new Error(`occupancy: ${r.error.message}`);
  return r.count ?? 0;
}
