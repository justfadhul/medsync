import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { composeDispatchSms } from "@/lib/notifications/dispatches";

/*
 * Departments & services hub — the laws held at source level, like tests/functions/*: Deno
 * functions don't run under Vitest, and these rules are about what each file writes, reads and in
 * which order. Comments are stripped so a file may explain a rule without "violating" it.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(resolve(process.cwd(), dir))) {
    const p = join(dir, name);
    if (statSync(resolve(process.cwd(), p)).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
};

const HUB = "supabase/functions/ha-services-hub";
const index = strip(read(`${HUB}/index.ts`));
const ops = strip(
  read(`${HUB}/ops-structure.ts`) + read(`${HUB}/ops-services.ts`) + read(`${HUB}/ops-wards.ts`),
);

describe("ha-services-hub — the contract's action pattern (Law 10)", () => {
  it("audit FIRST, then the mutation; a failed audit returns before apply()", () => {
    const audit = index.indexOf("await recordSaAudit(");
    const apply = index.indexOf("await plan.apply()");
    expect(audit).toBeGreaterThan(-1);
    expect(apply).toBeGreaterThan(audit);
    expect(index.slice(audit, apply)).toMatch(/return serverError\("audit write failed"/);
  });
  it("Zod → auth → role/scope, in that order", () => {
    const zod = index.indexOf("InputSchema.safeParse(");
    const auth = index.indexOf("await getCaller(");
    const scope = index.indexOf("requireHospitalAdminScope(");
    expect(zod).toBeGreaterThan(-1);
    expect(auth).toBeGreaterThan(zod);
    expect(scope).toBeGreaterThan(auth);
  });
  it("plan() only reads: no insert/update/upsert/delete outside apply()", () => {
    // Every write sits inside an `apply: async () => { … }` body.
    const writes = [...ops.matchAll(/\.(insert|update|upsert|delete)\(/g)].map((m) => m.index!);
    const applies = [...ops.matchAll(/apply: async \(\) => \{/g)].map((m) => m.index!);
    for (const w of writes) {
      const opener = applies.filter((a) => a < w).pop();
      expect(opener, `write at ${w} outside apply()`).toBeDefined();
    }
  });
  it("D-SVC-16: a head may run exactly the department-scoped ops", () => {
    const m = index.match(/const HEAD_OPS = new Set\(\[([\s\S]*?)\]\)/);
    const headOps = [...(m?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort();
    expect(headOps).toEqual([
      "add_unit",
      "confirm_still_down",
      "report_problem",
      "resolve_problem",
      "update_department",
      "update_problem",
    ]);
  });
  it("every op the schemas accept has a handler, and vice versa", () => {
    const declared = [...ops.matchAll(/op: z\.literal\("([a-z_]+)"\)/g)].map((m) => m[1]).sort();
    const maps = [
      ...ops.matchAll(/export const [A-Z]+_OPS: Record<string, OpHandler> = \{([\s\S]*?)\};/g),
    ]
      .map((m) => m[1])
      .join("\n");
    const handled = [...maps.matchAll(/^\s*([a-z_]+)(?::\s*[a-zA-Z]+)?,$/gm)]
      .map((m) => m[1])
      .sort();
    // 31 hub ops + the ward builder's 7 (ADRs 0191–0196) + the admission's 3 (ADRs 0199–0200)
    // + the pharmacy's dispensing point (ADR 0236) + the EU's move between spaces (ADR 0541).
    expect(declared.length).toBe(43);
    expect(handled).toEqual(declared);
  });
});

describe("one store per fact (Law 2)", () => {
  it("the hub never writes clinic days or sessions — the booking engine does", () => {
    expect(ops).not.toMatch(/from\("session_templates"\)/);
    expect(ops).not.toMatch(/from\("clinic_sessions"\)\.(insert|update|upsert|delete)/);
  });
  // ADR 0508: the Clinics & schedule workspace owns clinic days; its publish is the one writer.
  it("clinic days are saved only through cs_publish; closures cancel through ha-cancel-session", () => {
    const actions = strip(read("app/hospital-admin/departments/actions.ts"));
    expect(actions).not.toMatch(/"ha-upsert-session-template"/);
    expect(actions).toMatch(/"ha-cancel-session"/);
    expect(strip(read("lib/clinics-schedule/publish.ts"))).toMatch(/public\.cs_publish\(/);
  });
  it("both expansion paths use the one skip rule (CLN-4)", () => {
    expect(read("supabase/functions/ha-upsert-session-template/index.ts")).toMatch(/skipDayFor\(/);
    expect(read("lib/scheduling/materialise-sessions.ts")).toMatch(/skipDayFor\(/);
  });
});

describe("CAP-5 — no routing value changes without a second person", () => {
  it("the old one-person path refuses routing fields", () => {
    const src = strip(read("supabase/functions/ha-set-hospital-emergency-settings/index.ts"));
    expect(src).toMatch(/const ROUTING_KEYS = \[/);
    for (const k of [
      "emergency_capability",
      "pre_alert_enabled",
      "board_owner_note",
      "emergency_entrance_directions",
      "emergency_sms_number",
      "ambulance_number",
    ]) {
      expect(src.match(/const ROUTING_KEYS = \[([\s\S]*?)\]/)?.[1]).toContain(`"${k}"`);
    }
    expect(src).toMatch(/if \(changedRouting\.length > 0\)[\s\S]*?return conflict\(/);
  });
  it("the hub's set only ever writes pending_* for a routing key; verify refuses the author", () => {
    expect(ops).toMatch(/outcome\.kind === "pending"\s*\?\s*\{\s*\.\.\.base,\s*pending_value/);
    expect(ops).toMatch(/verifyVerdict\(row, ctx\.callerId\)/);
  });
});

describe("AV-4 — availability informs; nothing clinical blocks on it", () => {
  const clinical = [
    ...walk("lib/encounter"),
    ...walk("lib/triage"),
    ...walk("lib/scheduling"),
    ...walk("lib/lab-tech"),
    ...walk("app/doctor"),
    ...walk("app/nurse"),
    ...walk("app/reception"),
    "supabase/functions/_shared/book.ts",
    "supabase/functions/ha-start-encounter/index.ts",
  ];
  it("ordering, booking and triage never read the availability store", () => {
    const offenders = clinical.filter((p) =>
      /availability_events|availabilityEvents|lib\/services\/data/.test(strip(read(p))),
    );
    expect(offenders).toEqual([]);
  });
});

describe("consumers read live departments (D-SVC-02) and the right clinics (§5.5)", () => {
  it("sign-up lists and validators: live, not archived", () => {
    expect(read("lib/reference-data.ts")).toMatch(
      /isNotNull\(hospitalDepartments\.medsyncLiveAt\)/,
    );
    for (const p of ["app/signup/clinical/actions.ts", "app/signup/non-clinical/actions.ts"]) {
      expect(read(p)).toMatch(/\.not\("medsync_live_at", "is", null\)/);
    }
  });
  it("intake and the patient queue: live, not archived", () => {
    expect(read("lib/intake/queries.ts")).toMatch(/medsyncLiveAt\} IS NOT NULL/);
    expect(read("app/patient/queue/page.tsx")).toMatch(/medsyncLiveAt\} IS NOT NULL/);
  });
  it("patient booking sees patient-bookable clinics; the Desk sees every audience", () => {
    const src = read("lib/scheduling/booking-options.ts");
    expect(src).toMatch(/forPatients \? eq\(serviceLines\.audience, "patients"\) : undefined/);
    expect(read("app/reception/book/page.tsx")).toMatch(/fetchLines\([^)]*now, false\)/);
  });
  it("USSD never lists a confidential clinic", () => {
    expect(read("lib/channels/ussd-data.ts")).toMatch(/eq\(serviceLines\.confidential, false\)/);
  });
});

describe("CLN-5 — a confidential clinic is never named in a patient message", () => {
  const base = {
    hospitalName: "Test Hospital 5",
    serviceName: "HIV / ART clinic",
    startsAtIso: "2026-10-13T05:00:00Z",
    bookingCode: "ab12",
    positionNumber: 3,
    arrivalWindowStartIso: "2026-10-13T05:00:00Z",
    arrivalWindowEndIso: "2026-10-13T06:00:00Z",
    offeredStartsAtIso: "2026-10-14T05:00:00Z",
    offerExpiresAtIso: "2026-10-13T12:00:00Z",
    nextSessionStartsAtIso: "2026-10-20T05:00:00Z",
    delayMinutes: 30,
    replyKey: null,
  };
  it("no message kind but the receipt renders the service name at all …", () => {
    for (const kind of [
      "confirmation_request",
      "arrival_window",
      "waitlist_offer",
      "session_cancelled",
      "unconfirmed_release",
      "window_shifted",
    ]) {
      const body = composeDispatchSms({ ...base, kind } as Parameters<
        typeof composeDispatchSms
      >[0]);
      expect(body, kind).not.toMatch(/HIV|ART/);
    }
  });
  it("… and the receipt's name is masked to 'Appointment' in SQL for a confidential line", () => {
    expect(read("app/api/cron/dispatch-reminders/route.ts")).toMatch(
      /case when \$\{serviceLines\.confidential\}[\s\S]{0,200}then 'Appointment'/,
    );
  });
});

describe("H10 — honest numbers: no occupancy figure without its engine", () => {
  it("the engine is the bed board (ADR 0194): bed_assignments, read in lib/wards", () => {
    expect(read("supabase/migrations/0090_ward_builder.sql")).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.bed_assignments/,
    );
    expect(strip(read("lib/wards/board.ts"))).toMatch(/bedAssignments/);
  });
  it("no hub route or reader computes occupancy", () => {
    const files = [...walk("app/hospital-admin/departments"), ...walk("lib/services")];
    for (const p of files) {
      const src = strip(read(p));
      expect(src, p).not.toMatch(/occupan\w*\s*[:=]\s*[^"'`]/i);
      expect(src, p).not.toMatch(/occupiedBeds\s*[:=]\s*[1-9a-z]/);
    }
  });
});

describe("sign-up sees the hub at once, and pop-ups are centred (ADR 0161)", () => {
  it("listDepartments is not behind the hour-long reference-data cache", () => {
    const src = read("lib/reference-data.ts");
    expect(src).toMatch(/export async function listDepartments\(/);
    expect(src).not.toMatch(/cached\(\s*"listDepartments"/);
  });

  it("a failed department lookup never reads as 'no departments'", () => {
    const src = read("app/signup/_components/staff-work.tsx");
    expect(src).toMatch(/failed: true/);
    expect(src).toMatch(/STAFF\.departmentFailed/);
  });

  it("nothing in the hub slides in from an edge: every pop-up is a centred dialog", () => {
    for (const f of walk("app/hospital-admin/departments").filter((p) => p.endsWith(".tsx")))
      expect(read(f), f).not.toMatch(/<SheetContent|<Sheet\b/);
  });
});
