"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireReceptionScope } from "@/lib/reception/scope";
import { callEdge } from "@/lib/supabase/edge";

/**
 * The desk's cancel and move (ADR 0473): the same Edge Functions the patient
 * and the clinician use — `cancel-appointment` and `reschedule-appointment`
 * (its `to` input, through the booking core). Each checks, on the server,
 * that the caller is reception at the booking's own hospital.
 */
const Reason = z.string().trim().min(8, "Say why in at least 8 characters.").max(500);

const CancelArgs = z.object({ appointment_id: z.string().uuid(), reason: Reason });

const MoveArgs = z.object({
  appointment_id: z.string().uuid(),
  reason: Reason,
  idempotency_key: z.string().uuid(),
  to: z.union([
    z.object({ session_id: z.string().uuid() }),
    z.object({
      slot: z.object({
        clinician_user_id: z.string().uuid(),
        department_id: z.string().uuid(),
        service_line_id: z.string().uuid(),
        starts_at: z.string().datetime({ offset: true }),
        ends_at: z.string().datetime({ offset: true }),
      }),
    }),
  ]),
});

export type DeskChangeResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export interface MovedBooking {
  booking_code: string | null;
  position_number: number | null;
  arrival_window_start: string | null;
  arrival_window_end: string | null;
}

function refresh() {
  for (const p of ["/reception", "/reception/bookings", "/reception/expected", "/reception/flow"]) {
    revalidatePath(p);
  }
}

export async function cancelBookingAction(
  input: z.input<typeof CancelArgs>,
): Promise<DeskChangeResult> {
  const parsed = CancelArgs.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check it." };
  await requireReceptionScope();
  const r = await callEdge("cancel-appointment", parsed.data, "reception.bookings");
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, data: undefined };
}

export async function moveBookingAction(
  input: z.input<typeof MoveArgs>,
): Promise<DeskChangeResult<MovedBooking>> {
  const parsed = MoveArgs.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check it." };
  await requireReceptionScope();
  const r = await callEdge<{ data?: MovedBooking }>(
    "reschedule-appointment",
    parsed.data,
    "reception.bookings",
  );
  if (!r.ok) return { ok: false, error: r.error };
  // No revalidate here: the dialog shows the new code first and refreshes the
  // list when the clerk closes it (every reception page is dynamic anyway).
  const d = r.data.data;
  return {
    ok: true,
    data: {
      booking_code: d?.booking_code ?? null,
      position_number: d?.position_number ?? null,
      arrival_window_start: d?.arrival_window_start ?? null,
      arrival_window_end: d?.arrival_window_end ?? null,
    },
  };
}
