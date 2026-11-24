"use server";

import type { ActionResult } from "@/lib/emr/write/context";
import type { VisitSummaryContent } from "@/lib/patient/visit-summary";
import type { WardLayout } from "@/supabase/functions/_shared/ward-layout";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { HOLD_REASONS } from "@/db/schema/admissions";
import { encounters } from "@/db/schema/scheduling";
import { requireEmrActor } from "@/lib/emr/actor";
import { followUpDate } from "@/lib/emr/closure";
import { encounterCloseV2LiveFor, patientVisitSummaryLiveFor } from "@/lib/emr/feature";
import { actionError, withPatientWrite } from "@/lib/emr/write/context";
import { composeForEncounter, decideVisitSummary } from "@/lib/emr/write/visit-summary";
import { encrypt } from "@/lib/encryption";
import { fetchLines } from "@/lib/scheduling/booking-options";
import { callEdge } from "@/lib/supabase/edge";
import { loadBedBoard } from "@/lib/wards/board";
import { euObservationLiveFor, wardBuilderLiveFor } from "@/lib/wards/feature";
import { DEFAULT_TIME_ZONE, localDateKey } from "@/supabase/functions/_shared/slots";

/*
 * The close dialog's own reads and writes (ADRs 0197–0203): the follow-up slots around the Plan's interval and
 * the booking; one ward's beds for the picker (states only, never another patient's name); and the patient copy's
 * preview, share and hold. Every patient-bound call checks the access rule in the clinician's transaction.
 */

const surface = z.enum(["doctor", "clinician"]);
const uuid = z.uuid();
const serverTime = () => new Date().toISOString();
const off = (what: string) => ({
  ok: false as const,
  code: "config" as const,
  error: `${what} is not switched on at this hospital.`,
});
const invalid = (e: z.ZodError) => ({
  ok: false as const,
  code: "invalid" as const,
  error: e.issues[0]?.message ?? "Invalid input.",
});

/* ─── Follow-up: the slots and the booking (ADR 0202) ──────────────── */

export interface FollowUpSlot {
  lineId: string;
  clinicianUserId: string;
  departmentId: string;
  startsAt: string;
  endsAt: string;
}
export interface FollowUpOptions {
  /** The day the interval lands on (YYYY-MM-DD). */
  target: string;
  reason: "follow_up" | "post_discharge";
  clinics: {
    lineId: string;
    name: string;
    clinicians: { userId: string; name: string; you: boolean; slots: FollowUpSlot[] }[];
    sessions: { id: string; startsAt: string; clinicianName: string | null; placesLeft: number }[];
  }[];
}

const FollowUpArgs = z.object({
  surface,
  patientUserId: uuid,
  encounterId: uuid,
  when: z.enum(["1w", "2w", "4w", "3m"]),
});

/** The open slots and clinic days of this visit's department around the Plan's interval. */
export async function followUpOptions(raw: unknown): Promise<ActionResult<FollowUpOptions>> {
  const p = FollowUpArgs.safeParse(raw);
  if (!p.success) return invalid(p.error);
  const i = p.data;
  const actor = await requireEmrActor(i.surface);
  if (!encounterCloseV2LiveFor(actor.hospitalId)) return off("Closing the visit");
  try {
    const enc = await withPatientWrite(actor, i.patientUserId, async (ctx) => {
      const [e] = await ctx.tx
        .select({ departmentId: encounters.departmentId })
        .from(encounters)
        .where(
          and(eq(encounters.id, i.encounterId), eq(encounters.patientUserId, i.patientUserId)),
        );
      return e ?? null;
    });
    const now = new Date();
    const target = followUpDate(localDateKey(now, DEFAULT_TIME_ZONE), i.when)!;
    // ponytail: a 3-day lead before the date, then the booking app's 14-day window; the whole hospital is read
    // (fetchLines' own ceiling). Upgrade with fetchLines' per-line read.
    const start = new Date(
      Math.max(now.getTime(), Date.parse(`${target}T00:00:00Z`) - 3 * 86_400_000),
    );
    const lines = await fetchLines(actor.hospitalId, i.patientUserId, start, false);
    const usable = lines.filter(
      (l) =>
        (!enc?.departmentId || l.departmentId === enc.departmentId) &&
        (l.reasonCodes.includes("follow_up") || l.reasonCodes.includes("post_discharge")),
    );
    const reason = usable.some((l) => l.reasonCodes.includes("follow_up"))
      ? "follow_up"
      : "post_discharge";
    const clinics = usable
      .filter((l) => l.reasonCodes.includes(reason))
      .map((l) => ({
        lineId: l.id,
        name: l.name,
        clinicians: l.clinicians
          .map((c) => ({
            userId: c.userId,
            name: c.fullName,
            you: c.userId === actor.userId,
            slots: Object.values(c.slotsByDate)
              .flat()
              .slice(0, 6)
              .map((s) => ({
                lineId: l.id,
                clinicianUserId: c.userId,
                departmentId: l.departmentId,
                startsAt: s.startsAtIso,
                endsAt: s.endsAtIso,
              })),
          }))
          .filter((c) => c.slots.length)
          .sort((a, b) => Number(b.you) - Number(a.you)),
        sessions: l.sessions
          .filter((s) => s.clinicianUserId && s.placesLeft > 0)
          .slice(0, 6)
          .map((s) => ({
            id: s.id,
            startsAt: s.startsAtIso,
            clinicianName: s.clinicianName,
            placesLeft: s.placesLeft,
          })),
      }))
      .filter((c) => c.clinicians.length || c.sessions.length);
    return {
      ok: true,
      id: i.encounterId,
      serverTime: serverTime(),
      data: { target, reason, clinics },
    };
  } catch (e) {
    return actionError(e);
  }
}

const BookArgs = z.object({
  surface,
  patientUserId: uuid,
  encounterId: uuid,
  reason: z.enum(["follow_up", "post_discharge"]),
  slot: z
    .object({
      lineId: uuid,
      clinicianUserId: uuid,
      departmentId: uuid,
      startsAt: z.iso.datetime({ offset: true }),
      endsAt: z.iso.datetime({ offset: true }),
    })
    .optional(),
  sessionId: uuid.optional(),
});

/** Book the follow-up through ha-book-on-behalf (`origin: 'clinician'`); the patient gets the usual receipt. */
export async function bookFollowUp(
  raw: unknown,
): Promise<ActionResult<{ appointmentId: string; startsAt: string }>> {
  const p = BookArgs.safeParse(raw);
  if (!p.success) return invalid(p.error);
  const i = p.data;
  if (!i.slot === !i.sessionId) return { ok: false, code: "invalid", error: "Choose one time." };
  const actor = await requireEmrActor(i.surface);
  if (!encounterCloseV2LiveFor(actor.hospitalId)) return off("Closing the visit");
  try {
    // The access rule, as for any write about this patient.
    await withPatientWrite(actor, i.patientUserId, async () => null);
    const startsAt = i.slot?.startsAt ?? null;
    const r = await callEdge<{ data?: { appointment_id?: string } }>(
      "ha-book-on-behalf",
      {
        hospital_id: actor.hospitalId,
        idempotency_key: `follow-up:${i.encounterId}:${i.slot?.startsAt ?? i.sessionId}`,
        channel: "desk",
        origin: "clinician",
        reason: i.reason,
        patient_user_id: i.patientUserId,
        ...(i.slot
          ? {
              slot: {
                clinician_user_id: i.slot.clinicianUserId,
                department_id: i.slot.departmentId,
                starts_at: i.slot.startsAt,
                ends_at: i.slot.endsAt,
                type: "in_person",
                service_line_id: i.slot.lineId,
              },
            }
          : { session: { session_id: i.sessionId } }),
      },
      `${i.surface}.close`,
    );
    if (!r.ok) return { ok: false, code: "conflict", error: r.error };
    const appointmentId = r.data?.data?.appointment_id;
    if (!appointmentId)
      return {
        ok: false,
        code: "conflict",
        error: "The booking service answered, but not with a booking.",
      };
    revalidatePath("/reception/expected");
    return {
      ok: true,
      id: appointmentId,
      serverTime: serverTime(),
      data: { appointmentId, startsAt: startsAt ?? serverTime() },
    };
  } catch (e) {
    return actionError(e);
  }
}

/* ─── One ward's beds, for the picker (ADR 0199 §7) ───────────────── */

export interface PickerBed {
  key: string;
  bedId: string;
  label: string;
  state: string;
  services: string[];
  roomName: string | null;
}

const BedArgs = z.object({ surface, wardId: uuid });

/** The ward's published plan and every bed's state: never a patient (the board read with `patients: "none"`). */
export async function wardBeds(
  raw: unknown,
): Promise<ActionResult<{ doc: WardLayout | null; beds: PickerBed[] } | null>> {
  const p = BedArgs.safeParse(raw);
  if (!p.success) return invalid(p.error);
  const actor = await requireEmrActor(p.data.surface);
  if (!encounterCloseV2LiveFor(actor.hospitalId) || !wardBuilderLiveFor(actor.hospitalId))
    return off("The bed board");
  const board = await loadBedBoard(actor.hospitalId, p.data.wardId, { patients: "none" });
  return {
    ok: true,
    id: p.data.wardId,
    serverTime: serverTime(),
    data: board
      ? {
          doc: board.doc,
          beds: board.beds.map((b) => ({
            key: b.key,
            bedId: b.bedId,
            label: b.label,
            state: b.state,
            services: b.services,
            roomName: b.roomName,
          })),
        }
      : null,
  };
}

/* ─── Send to the emergency unit (ADR 0541) ───────────────────────── */

const SendToEuArgs = z.object({
  surface,
  patientUserId: uuid,
  encounterId: uuid,
  wardId: uuid,
  bedId: uuid.optional(),
  waitReason: z.enum(["no_free_bed", "extra_bed", "floor", "other"]).optional(),
  waitNote: z.string().trim().max(500, "Keep the note under 500 characters.").optional(),
});

/** The doctor sends the patient to an EU from the close; the visit stays open. Only the encounter's own clinician (the function checks). */
export async function sendToEu(
  raw: unknown,
): Promise<ActionResult<{ stayId: string; bed: string | null }>> {
  const p = SendToEuArgs.safeParse(raw);
  if (!p.success) return invalid(p.error);
  const i = p.data;
  const actor = await requireEmrActor(i.surface);
  if (!euObservationLiveFor(actor.hospitalId)) return off("Sending to the EU");
  if (!i.bedId === !i.waitReason)
    return { ok: false, code: "invalid", error: "Choose a space, or say why the patient waits." };
  if (!i.bedId && i.waitReason === "other" && !i.waitNote)
    return { ok: false, code: "invalid", error: "Say why the patient waits." };
  try {
    await withPatientWrite(actor, i.patientUserId, async () => null);
    const r = await callEdge<{ data?: { stay?: { stay_id?: string; bed?: string | null } } }>(
      "ha-eu-stay",
      {
        op: "send_to_eu",
        encounter_id: i.encounterId,
        ward_id: i.wardId,
        ...(i.bedId ? { bed_id: i.bedId } : { space_wait_reason: i.waitReason }),
        ...(!i.bedId && i.waitReason === "other"
          ? { space_wait_note_ciphertext: encrypt(i.waitNote!) }
          : {}),
        reason: "Sent to the emergency unit from the close of the visit.",
      },
      `${i.surface}.eu`,
    );
    if (!r.ok) return { ok: false, code: "conflict", error: r.error };
    const stayId = r.data?.data?.stay?.stay_id;
    if (!stayId)
      return {
        ok: false,
        code: "conflict",
        error: "The EU service answered, but not with a stay.",
      };
    revalidatePath(`/doctor/encounters/${i.encounterId}`);
    return {
      ok: true,
      id: stayId,
      serverTime: serverTime(),
      data: { stayId, bed: r.data?.data?.stay?.bed ?? null },
    };
  } catch (e) {
    return actionError(e);
  }
}

/* ─── The patient copy (ADR 0203) ─────────────────────────────────── */

const CopyArgs = z.object({ surface, patientUserId: uuid, encounterId: uuid });

/** The copy as the patient would read it, composed from the record, with the restricted count. */
export async function visitSummaryPreview(
  raw: unknown,
): Promise<ActionResult<{ content: VisitSummaryContent; restrictedCount: number }>> {
  const p = CopyArgs.safeParse(raw);
  if (!p.success) return invalid(p.error);
  const i = p.data;
  const actor = await requireEmrActor(i.surface);
  if (!patientVisitSummaryLiveFor(actor.hospitalId)) return off("The patient copy");
  try {
    const data = await withPatientWrite(actor, i.patientUserId, (ctx) =>
      composeForEncounter(ctx, i),
    );
    return { ok: true, id: i.encounterId, serverTime: serverTime(), data };
  } catch (e) {
    return actionError(e);
  }
}

const DecideArgs = CopyArgs.extend({
  decision: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("share"), removedIds: z.array(z.string().max(80)).max(200) }),
    z.object({
      kind: z.literal("hold"),
      reason: z.enum(HOLD_REASONS),
      note: z.string().trim().max(500).optional(),
    }),
  ]),
});

/** Share the copy with the patient, or hold it with a reason: a new version, kept as made. */
export async function decideVisitSummaryAction(
  raw: unknown,
): Promise<ActionResult<{ version: number }>> {
  const p = DecideArgs.safeParse(raw);
  if (!p.success) return invalid(p.error);
  const i = p.data;
  const actor = await requireEmrActor(i.surface);
  if (!patientVisitSummaryLiveFor(actor.hospitalId)) return off("The patient copy");
  try {
    const r = await withPatientWrite(actor, i.patientUserId, (ctx) => decideVisitSummary(ctx, i));
    revalidatePath(`/doctor/encounters/${i.encounterId}`);
    revalidatePath("/patient/care");
    return { ok: true, id: r.id, serverTime: serverTime(), data: { version: r.version } };
  } catch (e) {
    return actionError(e);
  }
}
