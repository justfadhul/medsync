import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DispatchRow } from "@/lib/notifications/dispatches";
import type { CallerAffiliation, MoveFrom } from "@/supabase/functions/_shared/booking-change";
import { describe, expect, it } from "vitest";

import { composeDispatchSms, dispatchRows, planDispatch } from "@/lib/notifications/dispatches";
import { isGsmSafe, SMS_MAX_BODY_CHARS } from "@/lib/notifications/sink";
import { moveRefusal, receptionAt } from "@/supabase/functions/_shared/booking-change";

/**
 * ADR 0473 — reception cancels and moves a booking at its own hospital,
 * through the same two Edge Functions the patient and clinician use.
 * The rules are pure (`_shared/booking-change.ts`) and checked here as
 * behaviour; the wiring is checked at the source, like the other Gate tests
 * (Deno functions do not run under Vitest).
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const fn = (name: string) => stripComments(read(`supabase/functions/${name}/index.ts`));

const HERE = "hosp-here";
const ELSEWHERE = "hosp-elsewhere";
const aff = (over: Partial<CallerAffiliation> = {}): CallerAffiliation => ({
  hospitalId: HERE,
  state: "active",
  cadreCode: "RECEPTION",
  hospitalState: "active",
  ...over,
});

describe("receptionAt — who counts as reception for THIS booking", () => {
  it("reception at the booking's hospital may", () => {
    expect(receptionAt([aff()], HERE)).toBe(true);
    expect(receptionAt([aff({ state: "approved", hospitalState: "provisioning" })], HERE)).toBe(
      true,
    );
  });

  it("reception at another hospital is refused", () => {
    expect(receptionAt([aff({ hospitalId: ELSEWHERE })], HERE)).toBe(false);
  });

  it("another staff role at the same hospital is refused", () => {
    for (const cadreCode of ["NURSE", "MEDICAL_OFFICER", "LAB_TECH", null]) {
      expect(receptionAt([aff({ cadreCode })], HERE), String(cadreCode)).toBe(false);
    }
  });

  it("a nurse here who is reception elsewhere is still refused here", () => {
    expect(receptionAt([aff({ cadreCode: "NURSE" }), aff({ hospitalId: ELSEWHERE })], HERE)).toBe(
      false,
    );
  });

  it("an affiliation not yet approved, suspended, or at a frozen hospital is refused", () => {
    for (const state of ["pending_approval", "suspended", "deactivated", "rejected"]) {
      expect(receptionAt([aff({ state })], HERE), state).toBe(false);
    }
    for (const hospitalState of ["suspended", "offboarded", null]) {
      expect(receptionAt([aff({ hospitalState })], HERE), String(hospitalState)).toBe(false);
    }
  });
});

describe("moveRefusal — a move stays in the same clinic", () => {
  const dayBooking: MoveFrom = {
    status: "confirmed",
    hospitalId: HERE,
    departmentId: "dept-1",
    sessionLineId: "line-1",
  };
  const timedBooking: MoveFrom = { ...dayBooking, sessionLineId: null };

  it("a clinic-day booking moves to another day of the same line", () => {
    expect(
      moveRefusal(dayBooking, { kind: "session", hospitalId: HERE, serviceLineId: "line-1" }),
    ).toBeNull();
  });

  it("…not to another line, another hospital, or a timed slot", () => {
    expect(
      moveRefusal(dayBooking, { kind: "session", hospitalId: HERE, serviceLineId: "line-2" }),
    ).toMatch(/same clinic/);
    expect(
      moveRefusal(dayBooking, { kind: "session", hospitalId: ELSEWHERE, serviceLineId: "line-1" }),
    ).toMatch(/same clinic/);
    expect(moveRefusal(dayBooking, { kind: "slot", departmentId: "dept-1" })).toMatch(
      /same clinic/,
    );
  });

  it("a timed booking moves to another time in the same department, not to a clinic day", () => {
    expect(moveRefusal(timedBooking, { kind: "slot", departmentId: "dept-1" })).toBeNull();
    expect(moveRefusal(timedBooking, { kind: "slot", departmentId: "dept-2" })).toMatch(
      /same clinic/,
    );
    expect(
      moveRefusal(timedBooking, { kind: "session", hospitalId: HERE, serviceLineId: "line-1" }),
    ).toMatch(/same clinic/);
  });

  it("only a booking that is still ahead may move", () => {
    for (const status of ["requested", "pending_approval", "confirmed"]) {
      expect(
        moveRefusal({ ...timedBooking, status }, { kind: "slot", departmentId: "dept-1" }),
      ).toBeNull();
    }
    for (const status of [
      "arrived",
      "in_progress",
      "completed",
      "cancelled",
      "rescheduled",
      "no_show",
    ]) {
      expect(
        moveRefusal({ ...timedBooking, status }, { kind: "slot", departmentId: "dept-1" }),
        status,
      ).toMatch(/no longer be moved/);
    }
  });
});

describe("the two Edge Functions — reception allowed at its own hospital, nobody else", () => {
  for (const name of ["cancel-appointment", "reschedule-appointment"]) {
    const src = fn(name);

    it(`${name}: reception is checked against the BOOKING's hospital, after the MFA-checked caller`, () => {
      expect(src).toContain("const caller = await getCaller(request);");
      expect(src).toContain("isReceptionAt(caller.id, appt.hospital_id)");
      expect(src.indexOf("getCaller(request)")).toBeLessThan(src.indexOf("isReceptionAt("));
      // Anyone else falls through to forbidden.
      expect(src).toMatch(
        /else if \(!\(await isReceptionAt\(caller\.id, appt\.hospital_id\)\)\) \{\s*return forbidden\(/,
      );
    });

    it(`${name}: never deletes a booking — history is kept by status and new rows`, () => {
      expect(src).not.toMatch(/from\("appointments"\)\s*\.delete\(/);
      expect(src).toContain("recordSaAudit(");
    });
  }

  it("getCaller refuses a caller without MFA (review perimeter, 0288)", () => {
    expect(read("supabase/functions/_shared/auth.ts")).toContain('rpc("caller_mfa_ok")');
  });

  it("isReceptionAt reads the caller's affiliations and lets the pure rule pick", () => {
    const scope = stripComments(read("supabase/functions/_shared/hospital-admin-scope.ts"));
    expect(scope).toContain('.select("hospital_id, state, cadres(code), hospitals(state)")');
    expect(scope).toContain("return receptionAt(");
  });
});

describe("reschedule-appointment `to` — the desk's move goes through the booking core", () => {
  const src = fn("reschedule-appointment");
  const to = src.slice(
    src.indexOf("if (input.to) {"),
    src.indexOf("if (appt.session_id) {\n    return badRequest"),
  );

  it("the move rules run before anything is written", () => {
    expect(to).toContain("const refusal = moveRefusal(");
    expect(to.indexOf("moveRefusal(")).toBeLessThan(to.indexOf("bookAppointment("));
  });

  it("capacity, hours and the clinic-day number are the core's: session or slot, never a hand-made row", () => {
    expect(to).toContain("bookAppointment(");
    expect(to).toContain("{ session: { sessionId: to.session_id } }");
    expect(to).toContain("{ slot: { ...to.slot, type: appt.type");
    expect(to).not.toContain('.from("appointments")\n      .insert(');
    // The core is where allocate_session_position, checkSlot and the receipt live.
    const core = read("supabase/functions/_shared/book.ts");
    for (const needle of [
      'rpc("allocate_session_position"',
      "checkSlot({",
      "bookingDispatchRows(",
    ]) {
      expect(core).toContain(needle);
    }
  });

  it("the new row links back and carries the old quote verbatim (ADR 0092)", () => {
    expect(to).toContain("movedFrom: {");
    expect(to).toContain("quotedFeeUgx: appt.quoted_fee_ugx ?? null");
    const core = read("supabase/functions/_shared/book.ts");
    expect(core).toContain("row.rescheduled_from_appointment_id = input.movedFrom.appointmentId;");
    expect(core).toContain("row.quoted_fee_ugx = input.movedFrom.quotedFeeUgx;");
  });

  it("the old row is flipped once, gives its clinic-day place back, and is audited", () => {
    const retire = src.slice(src.indexOf("const retire = async"), src.indexOf("if (input.to) {"));
    expect(retire).toContain('status: "rescheduled"');
    expect(retire).toContain('.in("status", [...RESCHEDULABLE])');
    expect(retire).toContain('rpc("release_session_position"');
    expect(retire).toContain("await releaseCapacity(sb, appt.id, log, requestId);");
    expect(to).toContain('action: "reschedule_appointment"');
    expect(to.indexOf("bookAppointment(")).toBeLessThan(
      to.indexOf('action: "reschedule_appointment"'),
    );
  });
});

describe("cancel-appointment — the patient is told when the clinic cancels", () => {
  const src = fn("cancel-appointment");

  it("one visit_cancelled message, only when someone else cancelled, after the reap", () => {
    expect(src).toContain("if (flipped && !isPatient) {");
    expect(src).toContain('kind: "visit_cancelled"');
    expect(src.indexOf("cancelPendingDispatches(")).toBeLessThan(
      src.indexOf('kind: "visit_cancelled"'),
    );
  });

  it("the row still carries a closed code, never staff words (ADR 0094)", () => {
    expect(src).toContain("cancelled_reason: cancelledReason,");
    expect(src).not.toContain("cancelled_reason: input.reason");
  });
});

describe("visit_cancelled — built, worded and sent like the other endings", () => {
  const now = "2026-11-12T09:00:00.000Z";

  it("push and SMS for an account; SMS alone for a new caller", () => {
    const account = dispatchRows({
      kind: "visit_cancelled",
      hospitalId: "h",
      recipient: { userId: "u" },
      appointmentId: "a",
      nowIso: now,
    });
    expect(account.map((r) => r.channel).sort()).toEqual(["push", "sms"]);
    const caller = dispatchRows({
      kind: "visit_cancelled",
      hospitalId: "h",
      recipient: { phoneEncrypted: "cipher" },
      appointmentId: "a",
      nowIso: now,
    });
    expect(caller.map((r) => r.channel)).toEqual(["sms"]);
  });

  it("one GSM-7 SMS, no staff reason, no punitive word", () => {
    const body = composeDispatchSms({
      kind: "visit_cancelled",
      hospitalName: "Test Hospital-1",
      serviceName: "General Clinic",
      startsAtIso: "2026-11-16T06:00:00.000Z",
      bookingCode: "abc123",
      positionNumber: 4,
      arrivalWindowStartIso: null,
      arrivalWindowEndIso: null,
      offerExpiresAtIso: null,
      offeredStartsAtIso: null,
      nextSessionStartsAtIso: null,
      delayMinutes: null,
    });
    expect(body).toContain("has cancelled your visit on");
    expect(body).toContain("Code ABC123.");
    expect(body.length).toBeLessThanOrEqual(SMS_MAX_BODY_CHARS);
    expect(isGsmSafe(body)).toBe(true);
  });

  const ended = (kind: string): DispatchRow => ({
    id: `d-${kind}`,
    hospitalId: "h",
    kind,
    channel: "push",
    state: "queued",
    scheduledAtIso: "2026-11-12T08:55:00.000Z",
    fallbackChannel: null,
    fallbackAfterIso: null,
    acknowledgedAtIso: null,
    recipientUserId: "u",
    hasPhone: true,
    idempotencyKey: `${kind}:appointment:a:push`,
    relatedKind: "appointment",
    relatedId: "a",
    payload: {},
    related: { live: false, status: "cancelled", startsAtIso: "2026-11-16T06:00:00.000Z" },
  });
  const run = (rows: DispatchRow[]) =>
    planDispatch({
      rows,
      now: new Date(now),
      quietHoursByHospital: new Map(),
      consentByUser: new Map([["u", true]]),
      tokensByUser: new Map([["u", ["tok"]]]),
    });

  it("a message ABOUT the cancellation is sent although its visit is cancelled (it was reaped before)", () => {
    for (const kind of ["visit_cancelled", "session_cancelled", "unconfirmed_release"]) {
      const p = run([ended(kind)]);
      expect(p.reaps, kind).toEqual([]);
      expect(p.pushSends, kind).toHaveLength(1);
    }
  });

  it("any other message about a cancelled visit is still reaped", () => {
    const p = run([{ ...ended("confirmation_request") }]);
    expect(p.pushSends).toHaveLength(0);
    expect(p.reaps[0]?.reason).toBe("related_cancelled");
  });
});

describe("the desk's page reads only its own hospital, codes only", () => {
  it("findDeskBookings filters by the scope's hospital and reveals no name", () => {
    const q = stripComments(read("lib/reception/bookings.ts"));
    expect(q).toContain("eq(appointments.hospitalId, args.hospitalId)");
    expect(q).not.toMatch(/decrypt|NameEncrypted/);
    const page = read("app/reception/bookings/page.tsx");
    expect(page).toContain("findDeskBookings({ hospitalId: scope.hospitalId, query })");
    expect(page).toContain("await requireReceptionScope()");
  });

  it("its actions call the shared functions, never a second path", () => {
    const actions = read("app/reception/bookings/actions.ts");
    expect(actions).toContain('callEdge("cancel-appointment"');
    expect(actions).toContain('"reschedule-appointment"');
    expect(actions).not.toMatch(/db\.(update|insert|delete)\(/);
  });
});
