"use server";

import { z } from "zod";

import { requireReceptionScope } from "@/lib/reception/scope";
import { callEdge } from "@/lib/supabase/edge";

/**
 * The reception desk's writes (ADRs 0485–0489). Each validates with Zod, checks the reception scope, and calls
 * one Edge Function; the function re-checks the hospital and audits. Results are plain objects so a client island
 * (and the offline queue) can call them directly. No answer or PIN is ever returned or logged here.
 */
export type DeskResult<T = Record<string, unknown>> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function call<T>(fn: string, body: Record<string, unknown>): Promise<DeskResult<T>> {
  await requireReceptionScope();
  const r = await callEdge<{ data?: T }>(fn, body, "reception");
  return r.ok ? { ok: true, data: (r.data?.data ?? {}) as T } : { ok: false, error: r.error };
}

const uuid = z.string().uuid();

const CheckIn = z.object({
  appointment_id: uuid.optional(),
  intake_id: uuid.optional(),
  route: z.enum(["triage", "clinic"]),
  department_id: uuid.optional(),
  client_id: uuid,
  device_label: z.string().trim().min(1).max(60).optional(),
});
/** Idempotent by `client_id` (ADR 0488): the offline queue replays it safely. */
export async function deskCheckIn(input: z.input<typeof CheckIn>) {
  const p = CheckIn.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid check-in." } as const;
  return call<{ intake_id: string; route: "triage" | "clinic"; replayed?: boolean }>(
    "ha-check-in-patient",
    {
      ...p.data,
      reason: "Checked in at the reception desk.",
    },
  );
}

const Identity = z.object({
  appointment_id: uuid,
  method: z.enum(["yob", "phone3"]),
  answer: z
    .string()
    .trim()
    .regex(/^\d{3,4}$/),
});
export async function deskIdentityCheck(input: z.input<typeof Identity>) {
  const p = Identity.safeParse(input);
  if (!p.success) return { ok: false, error: "Type the digits they say." } as const;
  return call<{ matched: boolean; next: "done" | "phone3" | null }>("ha-reception-desk", {
    op: "identity_check",
    ...p.data,
  });
}

const CloseDay = z.object({ hospital_id: uuid, appointment_ids: z.array(uuid).max(2000) });
export async function deskCloseDay(input: z.input<typeof CloseDay>) {
  const p = CloseDay.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid day." } as const;
  return call<{ closure_id: string; count: number }>("ha-reception-desk", {
    op: "close_day",
    ...p.data,
  });
}

export async function deskUndoCloseDay(closureId: string) {
  if (!uuid.safeParse(closureId).success) return { ok: false, error: "Invalid day." } as const;
  return call<{ count: number }>("ha-reception-desk", {
    op: "undo_close_day",
    closure_id: closureId,
  });
}

const Pin = z.object({ device_id: uuid, pin: z.string().regex(/^\d{4}$/) });
export async function deskSetPin(input: z.input<typeof Pin>) {
  const p = Pin.safeParse(input);
  if (!p.success) return { ok: false, error: "Four digits." } as const;
  return call<{ set: boolean }>("ha-reception-desk", { op: "set_pin", ...p.data });
}
export async function deskUnlock(input: z.input<typeof Pin>) {
  const p = Pin.safeParse(input);
  if (!p.success) return { ok: false, error: "Four digits." } as const;
  return call<{ result: "ok" | "wrong" | "locked" | "no_pin" }>("ha-reception-desk", {
    op: "unlock",
    ...p.data,
  });
}

const Late = z.object({ session_id: uuid, delay_minutes: z.number().int().min(0).max(240) });
/** D-RD-11: lateness only; the engine texts the booked patients when the window shifts by 30 minutes or more. */
export async function deskRunningLate(input: z.input<typeof Late>) {
  const p = Late.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid lateness." } as const;
  return call("ha-set-session-delay", p.data);
}

// Cancel and move reuse app/reception/bookings/actions.ts (ADR 0473): cancelBookingAction, moveBookingAction.
