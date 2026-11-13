/**
 * The live desk's writes (Step 6): each DeskPort call goes to an existing server action, which re-checks the
 * reception scope and calls the Edge Function that audits. Nothing is written here that the old pages could not.
 */
import type { BookInput, DeskPort, PortResult, WalkInInput } from "./port";
import type { DeskData } from "@/lib/reception/desk/fixture";

import {
  deskCheckIn,
  deskCloseDay,
  deskIdentityCheck,
  deskRunningLate,
  deskUndoCloseDay,
  deskUnlock,
} from "@/app/reception/_desk/actions";
import { cancelIntakeAction } from "@/app/reception/actions";
import { bookOnBehalfAction } from "@/app/reception/book/actions";
import { cancelBookingAction, moveBookingAction } from "@/app/reception/bookings/actions";
import { markArrivedAction, updatePreArrivalAction } from "@/app/reception/incoming/actions";
import { receptionRegisterIntakeAction } from "@/app/reception/intake/actions";
import { DESK } from "@/content/reception/desk";

type Out<T = object> = Promise<PortResult<T>>;
const bad = (error: string) => ({ ok: false as const, error });
const form = (o: Record<string, string | undefined>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) if (v) f.set(k, v);
  return f;
};
const state = async (p: Promise<{ ok?: boolean; error?: string }>): Out => {
  const r = await p;
  return r.ok ? { ok: true } : bad(r.error ?? DESK.errors.generic);
};

/** One id per browser for the shared-desk PIN (ADR 0489); kept in this browser only. */
function deviceId() {
  try {
    const k = "medsync.desk.device";
    const v = localStorage.getItem(k) ?? crypto.randomUUID();
    localStorage.setItem(k, v);
    return v;
  } catch {
    return crypto.randomUUID();
  }
}

/** E.164 for a Ugandan number typed at the desk ("+256 772…" or "0772…"). */
const e164 = (p: string) => {
  const d = p.replace(/\D/g, "").replace(/^0/, "256");
  return d ? `+${d.startsWith("256") ? d : `256${d}`}` : "";
};

export function livePort(data: Pick<DeskData, "hospitalId" | "sessions">): DeskPort {
  const sessionId = (key: string) => data.sessions.find((s) => s.key === key)?.sessionId ?? null;
  return {
    async identityCheck(row, method, answer) {
      if (!row.appointmentId) return bad(DESK.errors.generic);
      const r = await deskIdentityCheck({ appointment_id: row.appointmentId, method, answer });
      return r.ok ? { ok: true, ...r.data } : r;
    },
    async checkIn(row, route, clientId) {
      const r = await deskCheckIn({
        appointment_id: row.appointmentId ?? undefined,
        intake_id: row.appointmentId ? undefined : (row.intakeId ?? undefined),
        route,
        client_id: clientId,
      });
      return r.ok ? { ok: true } : r;
    },
    async closeDay(rows) {
      const r = await deskCloseDay({
        hospital_id: data.hospitalId,
        appointment_ids: rows.flatMap((x) => (x.appointmentId ? [x.appointmentId] : [])),
      });
      return r.ok ? { ok: true, closureId: r.data.closure_id, count: r.data.count } : r;
    },
    async undoCloseDay(closureId) {
      const r = await deskUndoCloseDay(closureId);
      return r.ok ? { ok: true } : r;
    },
    async runningLate(sid, minutes) {
      if (!sid) return bad(DESK.errors.generic);
      const r = await deskRunningLate({ session_id: sid, delay_minutes: minutes });
      return r.ok ? { ok: true } : r;
    },
    async move(row, key, reason) {
      const sid = sessionId(key);
      if (!row.appointmentId || !sid) return bad(DESK.errors.generic);
      const r = await moveBookingAction({
        appointment_id: row.appointmentId,
        reason,
        idempotency_key: crypto.randomUUID(),
        to: { session_id: sid },
      });
      return r.ok ? { ok: true } : r;
    },
    async cancel(row, reason) {
      if (!row.appointmentId) return bad(DESK.errors.generic);
      const r = await cancelBookingAction({ appointment_id: row.appointmentId, reason });
      return r.ok ? { ok: true } : r;
    },
    async walkIn(v: WalkInInput) {
      const em = v.clinic === "em";
      const r = await receptionRegisterIntakeAction(
        {},
        form({
          entry_type_code: em ? "emergency_self_presentation" : "walk_in",
          receiving_department_id: em ? undefined : v.clinic,
          patient_user_id: v.pickId ?? undefined,
          // Someone with no record yet: the label carries the name; full registration stays its own step.
          patient_unknown_label: v.pickId ? undefined : v.name,
          presenting_complaint: v.reason,
          notes: v.note,
          priority_hint_override: em ? "urgent" : undefined,
        }),
      );
      return r.ok ? { ok: true, code: "", pno: "" } : bad(r.error ?? DESK.errors.generic);
    },
    async book(v: BookInput) {
      const sid = sessionId(v.sessionKey);
      if (!sid) return bad(DESK.errors.generic);
      const r = await bookOnBehalfAction({
        reason: "other",
        note: [v.reason, v.note].filter(Boolean).join(" · ").slice(0, 500),
        idempotency_key: crypto.randomUUID(),
        patient_user_id: v.personId ?? undefined,
        provisional: v.newCaller
          ? {
              declared_name: v.newCaller.name,
              phone_e164: e164(v.newCaller.phone),
              date_of_birth: v.newCaller.dateOfBirth ?? undefined,
              age_years: v.newCaller.ageOnly ?? undefined,
              phone_verified: false,
            }
          : undefined,
        session: { session_id: sid },
      });
      return r.ok ? { ok: true, code: r.receipt.booking_code ?? "" } : r;
    },
    async unlock(_userId, pin) {
      const r = await deskUnlock({ device_id: deviceId(), pin });
      return r.ok ? { ok: true, result: r.data.result } : r;
    },
    undoCheckIn(row) {
      if (!row.intakeId) return Promise.resolve(bad(DESK.errors.generic));
      return state(
        cancelIntakeAction(
          {},
          form({ intake_id: row.intakeId, reason: "Check-in undone at the reception desk." }),
        ),
      );
    },
    leftEarly(row) {
      if (!row.intakeId) return Promise.resolve(bad(DESK.errors.generic));
      return state(
        cancelIntakeAction(
          {},
          form({ intake_id: row.intakeId, reason: "Left before being seen (reception desk)." }),
        ),
      );
    },
    async preAlertSeen(ids) {
      for (const id of ids) {
        const r = await state(
          updatePreArrivalAction({}, form({ pre_arrival_id: id, status: "seen" })),
        );
        if (!r.ok) return r;
      }
      return { ok: true };
    },
    preAlertArrived(id) {
      return state(
        markArrivedAction(
          {},
          form({ pre_arrival_id: id, reason: "Arrived at the reception desk." }),
        ),
      );
    },
  };
}
