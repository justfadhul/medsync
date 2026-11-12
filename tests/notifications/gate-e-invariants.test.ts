import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Gate E (ADR 0090) — the invariants a reviewer would otherwise grep for by
 * hand. Source-level on purpose: migration 0061 is GATED, so the dev DB may
 * not carry it, and these rules are about WHO writes WHERE.
 */
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const fn = (name: string) => read(`supabase/functions/${name}/index.ts`);
const SQL = read("supabase/migrations/0061_notifications_and_waitlist.sql");

describe("one release hook (PRD §3.2.5 — a freed place is offered at once)", () => {
  it("all three release paths call releaseCapacity() from _shared/waitlist.ts", () => {
    for (const name of [
      "cancel-appointment",
      "ha-decline-appointment-request",
      "reschedule-appointment",
    ]) {
      const src = fn(name);
      expect(src, name).toMatch(
        /import \{[^}]*releaseCapacity[^}]*\} from "\.\.\/_shared\/waitlist\.ts"/,
      );
      expect(src, name).toMatch(/await releaseCapacity\(sb, appt\.id, log, requestId\)/);
    }
  });

  it("who is offered is decided in ONE place: offer_released_capacity(), FIFO, SKIP LOCKED", () => {
    expect(read("supabase/functions/_shared/waitlist.ts")).toContain(
      'rpc("offer_released_capacity"',
    );
    expect(read("app/api/cron/dispatch-reminders/route.ts")).toContain(
      "public.offer_released_capacity(",
    );
    const body = SQL.slice(
      SQL.indexOf("CREATE OR REPLACE FUNCTION public.offer_released_capacity"),
    );
    expect(body).toMatch(/ORDER BY c\.created_at\s+LIMIT 1\s+FOR UPDATE SKIP LOCKED/);
    // Never offered back to the patient who just freed it.
    expect(body).toContain("c.patient_user_id IS DISTINCT FROM a.patient_user_id");
    // Service-role only.
    expect(body).toMatch(
      /REVOKE ALL ON FUNCTION public\.offer_released_capacity\(uuid\) FROM PUBLIC, anon, authenticated/,
    );
  });

  it("the cron cascades an expired offer to the next in line", () => {
    const route = read("app/api/cron/dispatch-reminders/route.ts");
    expect(route).toMatch(/set\(\{ state: "expired" \}\)/);
    expect(route).toMatch(
      /if \(e\.releasedAppointmentId && \(await offerToNext\(e\.releasedAppointmentId, now\)\)\)/,
    );
  });
});

describe("accepting goes through the booking core", () => {
  it("pt-accept-waitlist-offer books with bookAppointment and the ENTRY ID as idempotency", () => {
    const src = fn("pt-accept-waitlist-offer");
    expect(src).toMatch(/import \{[^}]*bookAppointment[^}]*\} from "\.\.\/_shared\/book\.ts"/);
    expect(src).toContain("idempotencyKey: entry.id,");
    // A 409 puts them back in line; nothing is deleted.
    expect(src).toMatch(/result\.response\.status === 409[\s\S]*?state: "waiting"/);
    expect(src).not.toContain('.from("appointments")\n    .insert(');
  });

  it("pt-accept-rebooking books one rebooking per cancelled visit", () => {
    const src = fn("pt-accept-rebooking");
    expect(src).toMatch(/import \{[^}]*bookAppointment[^}]*\} from "\.\.\/_shared\/book\.ts"/);
    expect(src).toContain("idempotencyKey: `rebook:${old.id}`");
    expect(src).toContain('old.cancelled_reason !== "session_cancelled"');
  });
});

describe("nobody is dropped silently (PRD §3.2.6)", () => {
  it("ha-cancel-session answers the count on dry_run before changing anything, and writes one dispatch per patient", () => {
    const src = fn("ha-cancel-session");
    const dry = src.indexOf("if (input.dry_run)");
    const audit = src.indexOf('action: "cancel_session"');
    // The session flip — not the early "already cancelled" replay check.
    const flip = src.indexOf("cancelled_reason: input.reason");
    expect(dry).toBeGreaterThan(0);
    expect(dry).toBeLessThan(audit);
    expect(audit).toBeLessThan(flip);
    expect(src).toContain('kind: "session_cancelled"');
    expect(src).toContain("nextSessionId: next?.id ?? null");
  });

  it("session_cancelled is exempt from the per-run cap and from quiet hours; the receipt from consent", () => {
    const shared = read("supabase/functions/_shared/dispatches.ts");
    expect(shared).toMatch(/CAP_EXEMPT[^=]*=\s*new Set\(\["session_cancelled"\]\)/);
    expect(shared).toMatch(/SMS_WITHOUT_CONSENT[^=]*=\s*new Set\(\["booking_receipt"\]\)/);
    const held = shared.slice(
      shared.indexOf("HELD_IN_QUIET_HOURS"),
      shared.indexOf("]);", shared.indexOf("HELD_IN_QUIET_HOURS")),
    );
    expect(held).not.toContain("session_cancelled");
    expect(held).not.toContain("booking_receipt");
  });
});

describe("the dispatcher (at-most-once, cost, consent, DLR)", () => {
  const route = read("app/api/cron/dispatch-reminders/route.ts");

  it("claims before it sends, on both queues, only rows no other run has claimed", () => {
    // The conditional WHERE is what makes an overlapping 15-minute run a no-op.
    const claims = route
      .split('.set({ state: "sent", sentAt: now, failureReason: null, updatedAt: now })')
      .slice(1)
      .map((c) => c.slice(0, c.indexOf(".returning(")));
    expect(claims).toHaveLength(2);
    expect(claims[0]).toContain('eq(appointmentReminders.state, "queued")');
    expect(claims[1]).toContain('inArray(notificationDispatches.state, ["queued", "held"])');
  });

  it("records the provider id and cost per SMS row", () => {
    expect(route).toContain("providerMessageId: o.providerMessageId ?? null");
    expect(route).toContain("costAmount: o.cost?.amount ?? null");
    expect(route).toContain("costCurrency: o.cost?.currency ?? null");
  });

  it("reads only LIVE sms_communication consent (revoked_at IS NULL)", () => {
    expect(route).toMatch(
      /eq\(consentRecords\.consentType, "sms_communication"\),\s*isNull\(consentRecords\.revokedAt\)/,
    );
  });

  it("unconfirmed-release runs only where the policy is SET, and the column defaults to NULL", () => {
    expect(route).toContain("isNotNull(departmentSchedulingPolicy.releaseUnconfirmedHours)");
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS release_unconfirmed_hours smallint;/);
    expect(SQL).not.toMatch(/release_unconfirmed_hours smallint (NOT NULL|DEFAULT)/);
  });

  it("the DLR webhook is idempotent (conditional on state) and never logs the phone", () => {
    const dlr = read("app/api/sms/dlr/[secret]/route.ts");
    expect(dlr).toMatch(/eq\(notificationDispatches\.state, "sent"\)/);
    expect(dlr).toMatch(/inArray\(notificationDispatches\.state, \["sent", "delivered"\]\)/);
    // The form field is named in the doc comment only; the code never reads it.
    const code = dlr.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/phoneNumber/);
    expect(dlr).toContain("webhookAuthorised(request, secret, env.SMS_WEBHOOK_SECRET)");
    expect(read("lib/channels/webhook-auth.ts")).toContain("timingSafeEqual(a, b)");
  });
});

describe("migration 0061 — RLS as written", () => {
  const policies = [...SQL.matchAll(/CREATE POLICY (\w+) ON public\.(\w+)\s+FOR (\w+)/g)].map(
    (m) => ({ name: m[1], table: m[2], cmd: m[3] }),
  );

  it("notification_dispatches: recipient and staff SELECT only — no writes for authenticated", () => {
    const own = policies.filter((p) => p.table === "notification_dispatches");
    expect(own.map((p) => p.cmd)).toEqual(["SELECT", "SELECT"]);
    expect(SQL).toMatch(
      /notification_dispatches_select_recipient[\s\S]*?USING \(recipient_user_id = auth\.uid\(\)\)/,
    );
  });

  it("push_tokens: own-row for every verb", () => {
    const own = policies.filter((p) => p.table === "push_tokens");
    expect(own.map((p) => p.cmd).sort()).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
    for (const p of own) {
      const body = SQL.slice(SQL.indexOf(`CREATE POLICY ${p.name}`));
      expect(body.slice(0, body.indexOf(";"))).toContain("user_id = auth.uid()");
    }
  });

  it("waitlist_entries: patient own / agent created / staff at hospital, SELECT only", () => {
    const own = policies.filter((p) => p.table === "waitlist_entries");
    expect(own.every((p) => p.cmd === "SELECT")).toBe(true);
    expect(SQL).toMatch(
      /waitlist_entries_select_patient[\s\S]*?USING \(patient_user_id = auth\.uid\(\)\)/,
    );
    expect(SQL).toMatch(
      /waitlist_entries_select_agent[\s\S]*?USING \(created_by_user_id = auth\.uid\(\)\)/,
    );
  });

  it("no PHI column beyond the ciphertext: no name, no plaintext phone", () => {
    const table = SQL.slice(
      SQL.indexOf("CREATE TABLE IF NOT EXISTS public.notification_dispatches"),
      SQL.indexOf("CREATE INDEX IF NOT EXISTS notification_dispatches_dispatcher_idx"),
    );
    expect(table).not.toMatch(/\bname\b|body|message text|phone_e164|phone text/);
    expect(table).toContain("recipient_phone_encrypted text");
  });
});
