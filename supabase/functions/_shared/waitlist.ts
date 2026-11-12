/**
 * Release-and-refill (Gate E, ADR 0090; PRD §3.2.5, §3.3.3).
 *
 * `releaseCapacity(sb, appointmentId, log)` is THE release hook: every
 * function that frees a place — `cancel-appointment`,
 * `ha-decline-appointment-request`, `reschedule-appointment` (the old row)
 * — calls it after its own status flip, and a test greps for that. The cron
 * calls the same SQL for the expiry cascade and the unconfirmed release.
 *
 * What it does: ONE call to `offer_released_capacity(p_appointment)`
 * (migration 0061 — the FIFO claim as a single statement, FOR UPDATE SKIP
 * LOCKED, zero rows when nobody is waiting or the place is already gone),
 * then ONE insert of the `waitlist_offer` dispatch rows (`dispatchRows()`),
 * ON CONFLICT DO NOTHING on the idempotency key.
 *
 * An offer is a NOTIFICATION, never a hold (C12): the offeree books through
 * the core in `pt-accept-waitlist-offer`, and a 409 there puts them back to
 * `waiting` with their original place in the line.
 *
 * Best-effort by design: the caller's own mutation has already landed, so a
 * failure here is logged (no PHI — ids only) and swallowed. The next
 * release, or the cron's cascade, gets the next chance.
 */

import type { DispatchRecipient } from "./dispatches.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.106.1";

import { dispatchRows } from "./dispatches.ts";

type LogFn = (msg: string, ctx?: Record<string, unknown>) => void;

/** The row `offer_released_capacity` returns. */
interface OfferRow {
  entry_id: string;
  patient_user_id: string | null;
  provisional_patient_id: string | null;
  phone_encrypted: string | null;
  hospital_id: string;
  service_line_id: string;
  offered_session_id: string | null;
  offered_starts_at: string;
  offer_expires_at: string;
}

/**
 * Offer the capacity `appointmentId` just freed to the head of the line.
 * Returns the offered entry's id, or null when nobody was offered.
 */
export async function releaseCapacity(
  sb: SupabaseClient,
  appointmentId: string,
  log: { warn: LogFn; info: LogFn },
  requestId?: string,
): Promise<string | null> {
  const { data, error } = await sb.rpc("offer_released_capacity", {
    p_appointment: appointmentId,
  });
  if (error) {
    log.warn("releaseCapacity: offer lookup failed (continuing)", {
      requestId,
      appointment_id: appointmentId,
      reason: error.message,
    });
    return null;
  }
  const offer = (data as OfferRow[] | null)?.[0];
  if (!offer) return null;

  const recipient = offer.patient_user_id
    ? { userId: offer.patient_user_id }
    : offer.phone_encrypted
      ? { phoneEncrypted: offer.phone_encrypted }
      : null;
  if (!recipient) {
    log.warn("releaseCapacity: offered entry has no reachable recipient", {
      requestId,
      waitlist_entry_id: offer.entry_id,
    });
    return offer.entry_id;
  }

  const rows = dispatchRows({
    kind: "waitlist_offer",
    hospitalId: offer.hospital_id,
    recipient,
    nowIso: new Date().toISOString(),
    waitlistEntryId: offer.entry_id,
    offeredSessionId: offer.offered_session_id,
  });
  const { error: insertError } = await sb
    .from("notification_dispatches")
    .upsert(rows, { onConflict: "idempotency_key", ignoreDuplicates: true });
  if (insertError) {
    log.warn("releaseCapacity: offer dispatch insert failed (continuing)", {
      requestId,
      waitlist_entry_id: offer.entry_id,
      reason: insertError.message,
    });
  } else {
    log.info("waitlist offer queued", {
      requestId,
      waitlist_entry_id: offer.entry_id,
      appointment_id: appointmentId,
    });
  }
  return offer.entry_id;
}

/**
 * Reap every not-yet-sent dispatch about an appointment that just stopped
 * being live (cancel / decline / reschedule). The planner would reap them
 * anyway on the next run; doing it here keeps the queue honest at once.
 */
export async function cancelPendingDispatches(
  sb: SupabaseClient,
  relatedKind: "appointment" | "waitlist_entry",
  relatedId: string,
  reason: string,
): Promise<void> {
  await sb
    .from("notification_dispatches")
    .update({ state: "cancelled", failure_reason: reason })
    .eq("related_kind", relatedKind)
    .eq("related_id", relatedId)
    .in("state", ["queued", "held"]);
}

/**
 * Who hears about a booking: the account, or a provisional caller's phone
 * ciphertext (never decrypted here). Null when the booking names neither.
 */
export async function bookingRecipient(
  sb: SupabaseClient,
  appt: { patient_user_id: string | null; provisional_patient_id: string | null },
): Promise<DispatchRecipient | null> {
  if (appt.patient_user_id) return { userId: appt.patient_user_id };
  if (!appt.provisional_patient_id) return null;
  const { data: prov } = await sb
    .from("provisional_patients")
    .select("phone_encrypted")
    .eq("id", appt.provisional_patient_id)
    .maybeSingle();
  return prov?.phone_encrypted ? { phoneEncrypted: prov.phone_encrypted as string } : null;
}
