"use server";

import type {
  PublishResult,
  SaveDraftResult,
  SimpleResult,
} from "@/components/wards/editor/ward-editor";
import type { WaitReason } from "@/lib/wards/eu-guard";
import type { WardLayout } from "@/lib/wards/layout-schema";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { EU_WARD } from "@/content/eu/words";
import { encrypt } from "@/lib/encryption";
import { requireHospitalAdminScope } from "@/lib/hospital-admin/scope";
import { callEdge } from "@/lib/supabase/edge";
import { euAssignRefusal, WAIT_NOTE_MAX } from "@/lib/wards/eu-guard";
import { wardBuilderLiveFor } from "@/lib/wards/feature";
import { WardLayoutSchema } from "@/lib/wards/layout-schema";

/*
 * The ward builder's server actions (ADRs 0191–0194). The scope ALWAYS comes from
 * requireHospitalAdminScope(); ha-services-hub owns Zod, the role check, the audit and the write. A
 * draft save does not revalidate (the editor keeps its own state); publish, start and discard do.
 */

const HUB = "/hospital-admin/departments";
const uuid = z.string().uuid();

async function scope() {
  const s = await requireHospitalAdminScope();
  if (!wardBuilderLiveFor(s.hospitalId))
    throw new Error("The ward builder is not on for this hospital.");
  return s;
}

const refresh = (wardId: string) => {
  revalidatePath(HUB, "layout");
  revalidatePath(`${HUB}/wards/${wardId}/layout`);
  revalidatePath(`${HUB}/wards/${wardId}/board`);
};

export async function saveLayoutDraft(
  wardId: string,
  document: WardLayout,
  baseRevision: number | null,
): Promise<SaveDraftResult> {
  if (!uuid.safeParse(wardId).success)
    return { ok: false, error: "Unknown ward.", conflict: false };
  const parsed = WardLayoutSchema.safeParse(document);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "The layout doesn't fit.",
      conflict: false,
    };
  const s = await scope();
  const r = await callEdge<{ data?: { revision?: number } }>(
    "ha-services-hub",
    {
      op: "save_ward_layout_draft",
      hospital_id: s.hospitalId,
      ward_id: wardId,
      document: parsed.data,
      base_revision: baseRevision,
    },
    "hospital-admin.wards",
  );
  if (!r.ok) return { ok: false, error: r.error, conflict: /another window/.test(r.error) };
  const revision = r.data?.data?.revision;
  return typeof revision === "number"
    ? { ok: true, revision }
    : { ok: false, error: "The draft was saved without a revision; reload.", conflict: true };
}

export async function publishLayout(
  wardId: string,
  acceptedWarnings: string[],
): Promise<PublishResult> {
  if (!uuid.safeParse(wardId).success) return { ok: false, error: "Unknown ward." };
  const s = await scope();
  const r = await callEdge<{ data?: { bed_count?: number; version?: number } }>(
    "ha-services-hub",
    {
      op: "publish_ward_layout",
      hospital_id: s.hospitalId,
      ward_id: wardId,
      accepted_warnings: acceptedWarnings.slice(0, 40),
    },
    "hospital-admin.wards",
  );
  if (!r.ok) return { ok: false, error: r.error };
  refresh(wardId);
  return {
    ok: true,
    bedCount: Number(r.data?.data?.bed_count ?? 0),
    version: Number(r.data?.data?.version ?? 0),
  };
}

async function simple(op: string, wardId: string): Promise<SimpleResult> {
  if (!uuid.safeParse(wardId).success) return { ok: false, error: "Unknown ward." };
  const s = await scope();
  const r = await callEdge(
    "ha-services-hub",
    { op, hospital_id: s.hospitalId, ward_id: wardId },
    "hospital-admin.wards",
  );
  if (!r.ok) return { ok: false, error: r.error };
  refresh(wardId);
  return { ok: true };
}

export async function startLayoutFromRegister(wardId: string): Promise<SimpleResult> {
  return simple("start_layout_from_register", wardId);
}

export async function discardLayoutDraft(wardId: string): Promise<SimpleResult> {
  return simple("discard_ward_layout_draft", wardId);
}

const WardFields = z.object({
  name: z.string().trim().min(2).max(80),
  department_id: uuid,
  ward_type: z.string().nullable(),
  sex: z.string().nullable(),
  age_group: z.string().nullable(),
  place_id: uuid.nullable(),
  bed_count: z.number().int().min(0).max(2000),
});

/** The ward's own fields, through the hub's existing upsert_ward (the count stays the layout's). */
export async function saveWardFromLayout(
  wardId: string,
  fields: z.input<typeof WardFields>,
): Promise<SimpleResult> {
  const parsed = WardFields.safeParse(fields);
  if (!parsed.success || !uuid.safeParse(wardId).success)
    return {
      ok: false,
      error: parsed.success
        ? "Unknown ward."
        : (parsed.error.issues[0]?.message ?? "Check the ward."),
    };
  const s = await scope();
  const r = await callEdge(
    "ha-services-hub",
    { op: "upsert_ward", hospital_id: s.hospitalId, id: wardId, ...parsed.data },
    "hospital-admin.wards",
  );
  if (!r.ok) return { ok: false, error: r.error };
  refresh(wardId);
  return { ok: true };
}

/* ─── the bed board (ADR 0194) ─────────────────────────────────────── */

export async function adminSetBedState(
  wardId: string,
  bedId: string,
  state: "free" | "cleaning" | "reserved",
  reason: string | null,
): Promise<SimpleResult> {
  const s = await scope();
  const r = await callEdge(
    "ha-services-hub",
    {
      op: "set_bed_state",
      hospital_id: s.hospitalId,
      bed_id: bedId,
      state,
      ...(reason ? { reason } : {}),
    },
    "hospital-admin.beds",
  );
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath(`${HUB}/wards/${wardId}/board`);
  return { ok: true };
}

export async function adminAssignBed(
  wardId: string,
  bedId: string,
  patientUserId: string,
): Promise<SimpleResult> {
  if (!uuid.safeParse(bedId).success) return { ok: false, error: "Unknown bed." };
  const s = await scope();
  const refused = await euAssignRefusal(s.hospitalId, bedId);
  if (refused) return { ok: false, error: refused };
  const r = await callEdge(
    "ha-services-hub",
    { op: "assign_bed", hospital_id: s.hospitalId, bed_id: bedId, patient_user_id: patientUserId },
    "hospital-admin.beds",
  );
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath(`${HUB}/wards/${wardId}/board`);
  return { ok: true };
}

export async function adminReleaseBed(
  wardId: string,
  assignmentId: string,
  reason: string,
  nextState: "cleaning" | "free" | null,
): Promise<SimpleResult> {
  const s = await scope();
  const r = await callEdge(
    "ha-services-hub",
    {
      op: "release_bed",
      hospital_id: s.hospitalId,
      assignment_id: assignmentId,
      reason,
      ...(nextState ? { next_state: nextState } : {}),
    },
    "hospital-admin.beds",
  );
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath(`${HUB}/wards/${wardId}/board`);
  return { ok: true };
}

/* ─── admissions (ADR 0199): allocate from the waiting list, Arrived, cancel ─── */

async function adminHub(wardId: string, body: Record<string, unknown>): Promise<SimpleResult> {
  const s = await scope();
  const r = await callEdge(
    "ha-services-hub",
    { ...body, hospital_id: s.hospitalId },
    "hospital-admin.beds",
  );
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath(`${HUB}/wards/${wardId}/board`);
  return { ok: true };
}

export async function adminAllocateAdmissionBed(
  wardId: string,
  admissionId: string,
  bedId: string,
): Promise<SimpleResult> {
  if (![wardId, admissionId, bedId].every((x) => uuid.safeParse(x).success))
    return { ok: false, error: "Unknown admission or bed." };
  return adminHub(wardId, {
    op: "allocate_admission_bed",
    admission_id: admissionId,
    bed_id: bedId,
  });
}

export async function adminConfirmArrival(
  wardId: string,
  assignmentId: string,
): Promise<SimpleResult> {
  if (!uuid.safeParse(wardId).success || !uuid.safeParse(assignmentId).success)
    return { ok: false, error: "Unknown bed assignment." };
  return adminHub(wardId, { op: "confirm_arrival", assignment_id: assignmentId });
}

export async function adminReleaseAdmissionBed(
  wardId: string,
  admissionId: string,
  reason: string,
  outcome: "wait" | "end",
): Promise<SimpleResult> {
  if (!uuid.safeParse(wardId).success || !uuid.safeParse(admissionId).success)
    return { ok: false, error: "Unknown admission." };
  return adminHub(wardId, {
    op: "release_admission_bed",
    admission_id: admissionId,
    reason,
    outcome,
  });
}

export async function adminMoveEuSpace(
  wardId: string,
  stayId: string,
  target: { wardId?: string; bedId?: string; waitReason?: WaitReason; waitNote?: string },
): Promise<SimpleResult> {
  if (
    ![wardId, stayId, target.wardId ?? stayId, target.bedId ?? stayId].every(
      (x) => uuid.safeParse(x).success,
    )
  )
    return { ok: false, error: "Unknown stay, ward or space." };
  const note = target.waitNote?.trim();
  if (note && note.length > WAIT_NOTE_MAX) return { ok: false, error: EU_WARD.waitNoteTooLong };
  return adminHub(wardId, {
    op: "move_eu_space",
    stay_id: stayId,
    ...(target.wardId ? { ward_id: target.wardId } : {}),
    ...(target.bedId ? { bed_id: target.bedId } : {}),
    ...(!target.bedId && target.waitReason ? { space_wait_reason: target.waitReason } : {}),
    ...(!target.bedId && note ? { space_wait_note_ciphertext: encrypt(note) } : {}),
  });
}
