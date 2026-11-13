/**
 * Pure mapping from the reception reads to the desk's shapes (Step 6). No I/O: lib/reception/desk/load.ts fetches,
 * this file decides. Nothing here invents a value: a field the engine does not hold stays empty.
 */
import type { DeskClinic, DeskRow, DeskSession, PreAlert, Stage } from "./model";

import { DESK } from "@/content/reception/desk";
import { hhmm, kampala } from "./model";

const HUES = ["iris", "sky", "grape", "plum", "slate"] as const;

export const clinicOf = (d: { id: string; name: string }, i: number): DeskClinic => ({
  id: d.id,
  name: d.name,
  short: d.name.replace(/\s+clinic$/i, ""),
  hue: `var(--${HUES[i % HUES.length]}-${i < HUES.length ? 600 : 800})`,
  pattern: "",
  // ponytail: no appointment fee model yet (Step 0 Q2); the quoted fee rides on each booking, not the clinic.
  fee: 0,
});

const STAGE: Record<string, Stage> = {
  requested: "expected",
  pending_approval: "expected",
  confirmed: "expected",
  arrived: "here",
  in_progress: "doctor",
  completed: "done",
  no_show: "notseen",
};

export const sexOf = (s: string | null | undefined): DeskRow["sex"] =>
  /^f/i.test(s ?? "") ? "F" : /^m/i.test(s ?? "") ? "M" : "?";

const clock = (iso: string | null | undefined) => (iso ? hhmm(kampala(new Date(iso)).hour) : "");

export function bookingRow(b: {
  id: string;
  status: string;
  startsAtIso: string;
  arrivalWindowStartIso: string | null;
  hereSinceIso: string | null;
  seen: boolean;
  departmentId: string | null;
  clinicianName: string | null;
  patientCode: string | null;
  bookingCode: string | null;
  confirmedByPatient: boolean;
  identity: {
    displayName: string | null;
    ageYears: number | null;
    sex: string | null;
    complaint: string | null;
    photoUrl: string | null;
  };
  provisional: { declaredName: string | null } | null;
}): DeskRow | null {
  const stage = b.seen ? "done" : STAGE[b.status];
  if (!stage) return null; // cancelled, declined, void: not on the desk
  return {
    id: b.id,
    appointmentId: b.id,
    intakeId: null,
    clinic: b.departmentId ?? "",
    name: b.identity.displayName ?? b.provisional?.declaredName ?? DESK.row.noName,
    sex: sexOf(b.identity.sex),
    age: b.identity.ageYears,
    pno: b.patientCode ?? "",
    code: b.bookingCode ?? "",
    time: clock(b.arrivalWindowStartIso ?? b.startsAtIso),
    doc: b.clinicianName ?? "",
    stage,
    arr: clock(b.hereSinceIso) || undefined,
    reason: b.identity.complaint ?? "",
    ownWords: false,
    fee: 0,
    paid: false,
    go:
      stage === "here"
        ? { st: "here" }
        : stage === "expected" && b.confirmedByPatient
          ? { st: "coming" }
          : { st: "none" },
    photoUrl: b.identity.photoUrl,
  };
}

/** A same-day ticket from home (`declared` intake): expected, no booking code. */
export function declaredRow(d: {
  id: string;
  declaredAtIso: string;
  departmentId: string | null;
  patientCode: string | null;
  displayName: string | null;
  presentingComplaint: string | null;
  identity: {
    displayName: string | null;
    ageYears: number | null;
    sex: string | null;
    photoUrl: string | null;
  };
}): DeskRow {
  return {
    id: d.id,
    appointmentId: null,
    intakeId: d.id,
    clinic: d.departmentId ?? "",
    name: d.identity.displayName ?? d.displayName ?? DESK.row.noName,
    sex: sexOf(d.identity.sex),
    age: d.identity.ageYears,
    pno: d.patientCode ?? "",
    code: "",
    time: clock(d.declaredAtIso),
    doc: "",
    stage: "expected",
    flag: "says",
    reason: d.presentingComplaint ?? "",
    ownWords: !!d.presentingComplaint,
    fee: 0,
    paid: false,
    go: { st: "coming" },
    photoUrl: d.identity.photoUrl,
  };
}

/** An emergency in the building (intake, no booking): pinned at the top of Arrivals. */
export function emergencyRow(i: {
  id: string;
  arrivedAtIso: string;
  receivingDepartmentId: string | null;
  patientCode: string | null;
  patientUnknownLabel: string | null;
  presentingComplaint: string | null;
}): DeskRow {
  return {
    id: i.id,
    appointmentId: null,
    intakeId: i.id,
    clinic: i.receivingDepartmentId ?? "",
    name: i.patientUnknownLabel ?? DESK.row.noName,
    sex: "?",
    age: null,
    pno: i.patientCode ?? "",
    code: "",
    time: clock(i.arrivedAtIso),
    doc: "",
    stage: "here",
    route: "emergency",
    flag: "emerg",
    arr: clock(i.arrivedAtIso),
    reason: i.presentingComplaint ?? "",
    ownWords: false,
    fee: 0,
    paid: false,
    go: { st: "here" },
  };
}

/**
 * One desk session per clinic per day. ponytail: a second session of the same clinic on the same day is dropped
 * (the desk keys sessions by `date|clinic`); key by session id when a hospital runs two.
 */
export function deskSessions(
  rows: {
    id: string;
    departmentId: string | null;
    startsAt: Date;
    endsAt: Date;
    capacityTotal: number;
    bookedCount: number;
    delayMinutes: number;
    clinician: string | null;
  }[],
): DeskSession[] {
  const out = new Map<string, DeskSession>();
  for (const r of rows) {
    if (!r.departmentId) continue;
    const s = kampala(r.startsAt);
    const key = `${s.key}|${r.departmentId}`;
    if (out.has(key)) continue;
    out.set(key, {
      key,
      id: r.departmentId,
      sessionId: r.id,
      date: s.key,
      kind: "clinic",
      st: s.hour,
      en: kampala(r.endsAt).hour,
      cap: r.capacityTotal,
      booked: r.bookedCount,
      docs: r.clinician ? [r.clinician] : [],
      late: r.delayMinutes,
    });
  }
  return [...out.values()];
}

export function preAlertOf(p: {
  id: string;
  subject: { ageBand?: string | null; sex?: string | null };
  redFlags: { lay: string }[];
  etaBand: string;
  acknowledgedAt: Date | null;
  etaLabel: string;
}): PreAlert {
  const sex = sexOf(p.subject.sex);
  return {
    id: p.id,
    // The reporter gives no name; the desk says who is coming in words.
    name: DESK.row.noName,
    who: [sex === "F" ? "Female" : sex === "M" ? "Male" : null, p.subject.ageBand]
      .filter(Boolean)
      .join(" · "),
    what: p.redFlags.map((f) => f.lay).join(", "),
    km: null,
    eta: p.etaLabel,
    acknowledged: p.acknowledgedAt !== null,
  };
}
