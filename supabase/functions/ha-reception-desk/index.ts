/**
 * ha-reception-desk — the reception desk's own writes (migration 0294; ADRs 0486, 0489; D-RD-12, D-RD-13).
 * Callable by reception at the hospital the row belongs to (`isReceptionAt`), nobody else.
 *
 *   identity_check  ask a booking's second identifier (year of birth, else last 3 phone digits). The answer is
 *                   compared here and never stored or logged; the attempt row and the audit row carry method and
 *                   result only. A match clears the patient's "identity to confirm".
 *   close_day       mark the chosen bookings of today, still expected, as no-show (no penalty); one closure row.
 *   undo_close_day  the same day only: those still no-show go back to expected.
 *   set_pin         the caller's own 4-digit PIN on a desk device (hashed in the database).
 *   unlock          the caller's PIN on a desk device: ok, wrong, or locked (5 tries → full sign-in).
 */
import type { IdentityMethod } from "../_shared/desk-identity.ts";
import { z } from "npm:zod@4.4.3";

import { getCaller, serviceClient } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { identityMatches, nextIdentityStep } from "../_shared/desk-identity.ts";
import { decrypt } from "../_shared/encryption.ts";
import {
  badRequest,
  conflict,
  forbidden,
  methodNotAllowed,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "../_shared/errors.ts";
import { isReceptionAt } from "../_shared/hospital-admin-scope.ts";
import { makeLogger } from "../_shared/logger.ts";
import { networkContext, recordSaAudit } from "../_shared/sa-audit.ts";
import { DEFAULT_TIME_ZONE, localDateKey } from "../_shared/slots.ts";

const log = makeLogger("ha-reception-desk");

const Input = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("identity_check"),
    appointment_id: z.string().uuid(),
    method: z.enum(["yob", "phone3"]),
    answer: z.string().trim().min(1).max(8),
  }),
  z.object({
    op: z.literal("close_day"),
    hospital_id: z.string().uuid(),
    appointment_ids: z.array(z.string().uuid()).max(2000),
  }),
  z.object({ op: z.literal("undo_close_day"), closure_id: z.string().uuid() }),
  z.object({
    op: z.literal("set_pin"),
    device_id: z.string().uuid(),
    pin: z.string().regex(/^\d{4}$/),
  }),
  z.object({
    op: z.literal("unlock"),
    device_id: z.string().uuid(),
    pin: z.string().regex(/^\d{4}$/),
  }),
]);

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const init = { origin, requestId };
  const pre = preflight(request);
  if (pre) return pre;
  if (request.method !== "POST") return methodNotAllowed(init);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Body must be JSON", init);
  }
  const parsed = Input.safeParse(body);
  // Never echo the input back: it may hold an identity answer or a PIN.
  if (!parsed.success) return badRequest("Invalid input", init);
  const input = parsed.data;

  const caller = await getCaller(request);
  if (!caller) return unauthorized(init);
  const sb = serviceClient();
  const { ipAddress, userAgent } = networkContext(request);
  const audit = (
    a: Omit<
      Parameters<typeof recordSaAudit>[0],
      "actorId" | "requestId" | "ipAddress" | "userAgent"
    >,
  ) => recordSaAudit({ actorId: caller.id, requestId, ipAddress, userAgent, ...a });
  const deskAt = async (hospitalId: string) => isReceptionAt(caller.id, hospitalId);

  try {
    /* ─── identity_check ─────────────────────────────────────────── */
    if (input.op === "identity_check") {
      const { data: appt, error } = await sb
        .from("appointments")
        .select("id, hospital_id, patient_user_id, status")
        .eq("id", input.appointment_id)
        .maybeSingle();
      if (error) return serverError(error.message, init);
      if (!appt) return notFound(init, "booking not found");
      if (!(await deskAt(appt.hospital_id)))
        return forbidden(init, "reception at this hospital only");
      if (!appt.patient_user_id) return conflict("Confirm who this booking is for first.", init);

      const since = new Date(Date.now() - 30 * 60_000).toISOString();
      const { data: tries, error: tErr } = await sb
        .from("desk_identity_attempts")
        .select("method, matched")
        .eq("appointment_id", appt.id)
        .gte("created_at", since)
        .order("created_at", { ascending: true });
      if (tErr) return serverError(tErr.message, init);
      const step = nextIdentityStep(
        (tries ?? []) as { method: IdentityMethod; matched: boolean }[],
      );
      if (step === "done") return ok({ matched: true, next: "done" }, init);
      if (step !== input.method) {
        return conflict(
          step === null ? "Still no match. Do not check them in." : "Ask the other question.",
          init,
        );
      }

      const { data: prof, error: pErr } = await sb
        .from("patient_profiles")
        .select("date_of_birth, phone_encrypted, identity_to_confirm")
        .eq("id", appt.patient_user_id)
        .maybeSingle();
      if (pErr) return serverError(pErr.message, init);
      let phone: string | null = null;
      if (input.method === "phone3" && prof?.phone_encrypted) {
        const key = Deno.env.get("MEDSYNC_PHI_KEY");
        if (!key) return serverError("MEDSYNC_PHI_KEY is not configured for Functions.", init);
        phone = await decrypt(prof.phone_encrypted as string, key);
      }
      const matched = identityMatches(input.method, input.answer, {
        dateOfBirth: (prof?.date_of_birth as string | null) ?? null,
        phone,
      });

      await audit({
        action: "desk_identity_check",
        targetKind: "appointment",
        targetId: appt.id,
        reason: `Second identifier asked at the desk (${input.method}).`,
        afterData: { method: input.method, matched },
      });
      const { error: insErr } = await sb.from("desk_identity_attempts").insert({
        hospital_id: appt.hospital_id,
        appointment_id: appt.id,
        patient_user_id: appt.patient_user_id,
        method: input.method,
        matched,
        attempt_no: (tries?.length ?? 0) + 1,
        by_user_id: caller.id,
      });
      if (insErr) return serverError(insErr.message, init);
      if (matched && prof?.identity_to_confirm) {
        await sb
          .from("patient_profiles")
          .update({ identity_to_confirm: false })
          .eq("id", appt.patient_user_id);
      }
      const next = matched
        ? "done"
        : nextIdentityStep([...(tries ?? []), { method: input.method, matched }] as never);
      return ok({ matched, next }, init);
    }

    /* ─── close_day ──────────────────────────────────────────────── */
    if (input.op === "close_day") {
      if (!(await deskAt(input.hospital_id)))
        return forbidden(init, "reception at this hospital only");
      const today = localDateKey(new Date(), DEFAULT_TIME_ZONE);
      const ids = [...new Set(input.appointment_ids)];
      const { data: rows, error } = ids.length
        ? await sb
            .from("appointments")
            .select("id, starts_at")
            .in("id", ids)
            .eq("hospital_id", input.hospital_id)
            .eq("status", "confirmed")
        : { data: [], error: null };
      if (error) return serverError(error.message, init);
      const todays = ((rows ?? []) as { id: string; starts_at: string }[])
        .filter((r) => localDateKey(r.starts_at as string, DEFAULT_TIME_ZONE) === today)
        .map((r) => r.id as string);
      const { data: closure, error: cErr } = await sb
        .from("desk_day_closures")
        .insert({
          hospital_id: input.hospital_id,
          service_date: today,
          appointment_ids: todays,
          closed_by: caller.id,
        })
        .select("id")
        .single();
      if (cErr) return serverError(cErr.message, init);
      await audit({
        action: "close_day",
        targetKind: "hospital",
        targetId: input.hospital_id,
        reason: "Close the day at the desk: expected bookings marked not seen.",
        afterData: { closure_id: closure.id, count: todays.length },
      });
      if (todays.length) {
        const { error: uErr } = await sb
          .from("appointments")
          .update({ status: "no_show" })
          .in("id", todays)
          .eq("status", "confirmed");
        if (uErr) return serverError(uErr.message, init);
      }
      return ok({ closure_id: closure.id, count: todays.length }, init);
    }

    /* ─── undo_close_day ─────────────────────────────────────────── */
    if (input.op === "undo_close_day") {
      const { data: c, error } = await sb
        .from("desk_day_closures")
        .select("id, hospital_id, service_date, appointment_ids, undone_at")
        .eq("id", input.closure_id)
        .maybeSingle();
      if (error) return serverError(error.message, init);
      if (!c) return notFound(init, "closure not found");
      if (!(await deskAt(c.hospital_id))) return forbidden(init, "reception at this hospital only");
      if (c.undone_at) return conflict("Already undone.", init);
      if (c.service_date !== localDateKey(new Date(), DEFAULT_TIME_ZONE)) {
        return conflict("A day can be reopened only on the same day.", init);
      }
      await audit({
        action: "undo_close_day",
        targetKind: "hospital",
        targetId: c.hospital_id,
        reason: "Close the day undone at the desk, same day.",
        afterData: { closure_id: c.id },
      });
      const ids = (c.appointment_ids ?? []) as string[];
      if (ids.length) {
        const { error: uErr } = await sb
          .from("appointments")
          .update({ status: "confirmed" })
          .in("id", ids)
          .eq("status", "no_show");
        if (uErr) return serverError(uErr.message, init);
      }
      await sb
        .from("desk_day_closures")
        .update({ undone_at: new Date().toISOString(), undone_by: caller.id })
        .eq("id", c.id);
      return ok({ closure_id: c.id, count: ids.length }, init);
    }

    /* ─── set_pin / unlock ───────────────────────────────────────── */
    const { data: device, error: dErr } = await sb
      .from("desk_devices")
      .select("id, hospital_id")
      .eq("id", input.device_id)
      .maybeSingle();
    if (dErr) return serverError(dErr.message, init);
    if (!device) return notFound(init, "desk device not found");
    if (!(await deskAt(device.hospital_id)))
      return forbidden(init, "reception at this hospital only");

    if (input.op === "set_pin") {
      const { error } = await sb.rpc("desk_pin_set", {
        p_device_id: device.id,
        p_user_id: caller.id,
        p_pin: input.pin,
      });
      if (error) return serverError(error.message, init);
      await audit({
        action: "desk_set_pin",
        targetKind: "user",
        targetId: caller.id,
        reason: "Desk PIN set on a shared device.",
        afterData: { device_id: device.id },
      });
      return ok({ set: true }, init);
    }

    const { data: result, error: rErr } = await sb.rpc("desk_pin_check", {
      p_device_id: device.id,
      p_user_id: caller.id,
      p_pin: input.pin,
    });
    if (rErr) return serverError(rErr.message, init);
    if (result === "ok" || result === "locked") {
      await audit({
        action: result === "ok" ? "desk_switch_user" : "desk_pin_locked",
        targetKind: "user",
        targetId: caller.id,
        reason:
          result === "ok" ? "Desk unlocked with PIN." : "Desk PIN locked after 5 wrong tries.",
        afterData: { device_id: device.id },
      });
    }
    return ok({ result }, init);
  } catch (e) {
    log.error("desk op failed", { requestId, op: input.op, reason: String(e) });
    return serverError("That did not save. Try again.", init);
  }
});
