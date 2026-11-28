"use server";

import type { EmrTx } from "@/lib/emr/db";
import type { NurseScope } from "@/lib/nurse/scope";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";

import { nursingAssignments } from "@/db/schema/nurse-workspace";
import {
  handoverPatientNotes,
  handoverReceipts,
  safetyIncidents,
  staffLeaveRequests,
  wardCalendarAttendance,
  wardCalendarEvents,
} from "@/db/schema/ward-desk";
import { asClinicalWriter } from "@/lib/emr/db";
import { nurseWardV2LiveFor } from "@/lib/nurse/feature";
import { resolveNursePatientAccess } from "@/lib/nurse/patient-access";
import { requireNurseScope } from "@/lib/nurse/scope";
import { CAL_KINDS, HARM, INCIDENT_KINDS, LEAVE_KINDS } from "@/lib/ward-desk/fold";

/**
 * Running the ward (ADR 0546 Phase 4, migration 0315). Each action: the nurse's scope → NURSE_WARD_V2 → its own rule
 * (in-charge, own request, patient access) → one insert as the owner under the clinical writer (the audit row names
 * the author). Append-only: a decision or a withdrawal is a new row. On a refusal the page shows why.
 */
type Fail = (msg: string) => never;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (path: string, msg: string): never =>
  redirect(`${path}?msg=${encodeURIComponent(msg)}`);
const isMissingTable = (e: unknown): boolean =>
  typeof e === "object" &&
  e !== null &&
  (("code" in e && e.code === "42P01") || ("cause" in e && isMissingTable(e.cause)));

async function run(
  path: string,
  fn: (scope: NurseScope, tx: EmrTx, fail: Fail) => Promise<string>,
) {
  const scope = await requireNurseScope();
  if (!nurseWardV2LiveFor(scope.hospitalId)) back(path, "The ward desk is not switched on here.");
  let msg: string;
  try {
    msg = await asClinicalWriter({ userId: scope.userId, hospitalId: scope.hospitalId }, (tx) =>
      fn(scope, tx, (m) => {
        throw new Refusal(m);
      }),
    );
  } catch (e) {
    if (e instanceof Refusal) return back(path, e.message);
    if (isMissingTable(e)) return back(path, "Not set up at this hospital yet (migration 0315).");
    throw e;
  }
  revalidatePath(path);
  back(path, msg);
}
class Refusal extends Error {}

async function myWard(scope: NurseScope, tx: EmrTx): Promise<string | null> {
  if (scope.inChargeWardIds[0]) return scope.inChargeWardIds[0];
  const [a] = await tx
    .select({ wardId: nursingAssignments.wardId })
    .from(nursingAssignments)
    .where(
      and(
        eq(nursingAssignments.nurseUserId, scope.userId),
        eq(nursingAssignments.hospitalId, scope.hospitalId),
        or(isNull(nursingAssignments.endsAt), gt(nursingAssignments.endsAt, new Date())),
      ),
    )
    .orderBy(desc(nursingAssignments.startsAt))
    .limit(1);
  return a?.wardId ?? null;
}

/* ─── Calendar ─────────────────────────────────────────────────────── */

export async function addCalendarEvent(f: FormData) {
  await run("/nurse/calendar", async (scope, tx, fail) => {
    if (!scope.isInCharge) fail("Only the in-charge adds to the ward calendar.");
    const kind = str(f, "kind");
    if (!(kind in CAL_KINDS)) fail("Choose what it is.");
    const title = str(f, "title");
    if (!title || title.length > 200) fail("Write a short title.");
    const starts = new Date(`${str(f, "date")}T${str(f, "start")}:00+03:00`);
    const minutes = Number(str(f, "minutes") || "60");
    if (Number.isNaN(starts.getTime()) || !(minutes > 0 && minutes <= 600))
      fail("Choose a date, a start and how long.");
    const audiences = f
      .getAll("audiences")
      .map(String)
      .filter((a) => ["all_nurses", "day_shift", "night_shift", "all_doctors"].includes(a));
    await tx.insert(wardCalendarEvents).values({
      hospitalId: scope.hospitalId,
      departmentId: scope.departmentId,
      wardId: scope.inChargeWardIds[0] ?? null,
      kind,
      title,
      place: str(f, "place").slice(0, 120) || null,
      startsAt: starts,
      endsAt: new Date(starts.getTime() + minutes * 60_000),
      leadName: scope.fullName,
      audiences: audiences.length ? audiences : ["all_nurses"],
      sharedWithDepartment: f.get("share") === "1",
      createdByUserId: scope.userId,
    });
    return `Added: ${title}.`;
  });
}

export async function cancelCalendarEvent(f: FormData) {
  await run("/nurse/calendar", async (scope, tx, fail) => {
    if (!scope.isInCharge) fail("Only the in-charge cancels a ward activity.");
    const [e] = await tx
      .select()
      .from(wardCalendarEvents)
      .where(
        and(
          eq(wardCalendarEvents.id, str(f, "eventId")),
          eq(wardCalendarEvents.hospitalId, scope.hospitalId),
        ),
      );
    if (!e || e.state !== "active") fail("That activity is not on the calendar.");
    await tx
      .insert(wardCalendarEvents)
      .values({
        ...e!,
        id: undefined,
        state: "cancelled",
        replacesId: e!.id,
        createdByUserId: scope.userId,
        createdAt: new Date(),
        clientKey: null,
      });
    return `Cancelled: ${e!.title}.`;
  });
}

export async function askToGo(f: FormData) {
  await run("/nurse/calendar", async (scope, tx) => {
    await tx
      .insert(wardCalendarAttendance)
      .values({
        hospitalId: scope.hospitalId,
        eventId: str(f, "eventId"),
        userId: scope.userId,
        kind: "asked",
        recordedByUserId: scope.userId,
      });
    return "Asked. The in-charge decides, so the ward stays covered.";
  });
}

export async function decideAttendance(f: FormData) {
  await run("/nurse/calendar", async (scope, tx, fail) => {
    if (!scope.isInCharge) fail("Only the in-charge decides who goes.");
    const kind = str(f, "kind");
    if (kind !== "going" && kind !== "declined") fail("Choose going or not.");
    await tx
      .insert(wardCalendarAttendance)
      .values({
        hospitalId: scope.hospitalId,
        eventId: str(f, "eventId"),
        userId: str(f, "userId"),
        kind,
        recordedByUserId: scope.userId,
      });
    return kind === "going" ? "On the list the department sees." : "Marked as not going.";
  });
}

/* ─── Leave ────────────────────────────────────────────────────────── */

export async function requestLeave(f: FormData) {
  await run("/nurse/leave", async (scope, tx, fail) => {
    const kind = str(f, "kind");
    if (!(kind in LEAVE_KINDS)) fail("Choose the kind of leave.");
    const from = str(f, "from");
    const to = str(f, "to");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from)
      fail("Choose the first and last day.");
    await tx
      .insert(staffLeaveRequests)
      .values({
        hospitalId: scope.hospitalId,
        departmentId: scope.departmentId,
        userId: scope.userId,
        kind,
        startsOn: from,
        endsOn: to,
        note: str(f, "note").slice(0, 300) || null,
        recordedByUserId: scope.userId,
      });
    return "Leave asked. The in-charge sees it.";
  });
}

export async function decideLeave(f: FormData) {
  await run("/nurse/leave", async (scope, tx, fail) => {
    const state = str(f, "state");
    const [r] = await tx
      .select()
      .from(staffLeaveRequests)
      .where(
        and(
          eq(staffLeaveRequests.id, str(f, "requestId")),
          eq(staffLeaveRequests.hospitalId, scope.hospitalId),
        ),
      );
    if (!r || r.state !== "asked") fail("That request is not waiting.");
    const own = r!.userId === scope.userId;
    if (
      state === "withdrawn"
        ? !own
        : !scope.isInCharge || own || r!.departmentId !== scope.departmentId
    )
      fail(
        state === "withdrawn"
          ? "Only the person who asked can withdraw."
          : "Only the in-charge of the department decides, and not on their own leave.",
      );
    if (!["approved", "declined", "withdrawn"].includes(state)) fail("Choose a decision.");
    await tx
      .insert(staffLeaveRequests)
      .values({
        ...r!,
        id: undefined,
        state,
        replacesId: r!.id,
        recordedByUserId: scope.userId,
        recordedAt: new Date(),
        clientKey: null,
      });
    return state === "approved"
      ? "Leave approved."
      : state === "declined"
        ? "Leave declined."
        : "Request withdrawn.";
  });
}

/* ─── Incidents ────────────────────────────────────────────────────── */

export async function reportIncident(f: FormData) {
  await run("/nurse/incidents", async (scope, tx, fail) => {
    const kind = str(f, "kind");
    const harm = str(f, "harm");
    if (!(kind in INCIDENT_KINDS) || !(harm in HARM)) fail("Choose what happened and the harm.");
    const description = str(f, "description");
    if (description.length < 5 || description.length > 1000) fail("Say briefly what happened.");
    const at = new Date(`${str(f, "date")}T${str(f, "time") || "00:00"}:00+03:00`);
    if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 300_000)
      fail("Choose when it happened.");
    await tx
      .insert(safetyIncidents)
      .values({
        hospitalId: scope.hospitalId,
        wardId: await myWard(scope, tx),
        kind,
        harm,
        occurredAt: at,
        description,
        reportedByUserId: scope.userId,
      });
    return "Reported. The in-charge sees it in the month's figures.";
  });
}

/* ─── SBAR handover ────────────────────────────────────────────────── */

export async function writeSbar(f: FormData) {
  await run("/nurse/handover/sbar", async (scope, tx, fail) => {
    const patientUserId = str(f, "patientUserId");
    const access = await resolveNursePatientAccess({
      nurseUserId: scope.userId,
      hospitalId: scope.hospitalId,
      patientUserId,
      inChargeWardIds: scope.inChargeWardIds,
    });
    if (!access.allowed) fail("This patient is not on your list.");
    const situation = str(f, "situation");
    if (situation.length < 3) fail("Write the situation.");
    const tasks = str(f, "tasks")
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20);
    await tx.insert(handoverPatientNotes).values({
      hospitalId: scope.hospitalId,
      wardId: await myWard(scope, tx),
      patientUserId,
      situation: situation.slice(0, 1000),
      background: str(f, "background").slice(0, 1000) || null,
      assessment: str(f, "assessment").slice(0, 1000) || null,
      recommendation: str(f, "recommendation").slice(0, 1000) || null,
      tasks,
      writtenByUserId: scope.userId,
    });
    return "Handover written.";
  });
}

export async function receiveSbar(f: FormData) {
  await run("/nurse/handover/sbar", async (scope, tx, fail) => {
    const [n] = await tx
      .select()
      .from(handoverPatientNotes)
      .where(
        and(
          eq(handoverPatientNotes.id, str(f, "noteId")),
          eq(handoverPatientNotes.hospitalId, scope.hospitalId),
        ),
      );
    if (!n) fail("That handover is not here.");
    if (n!.writtenByUserId === scope.userId)
      fail("The next nurse receives the patient, not the one handing over.");
    await tx
      .insert(handoverReceipts)
      .values({
        hospitalId: scope.hospitalId,
        noteId: n!.id,
        patientUserId: n!.patientUserId,
        receivedByUserId: scope.userId,
      });
    return "Received at the bedside.";
  });
}
