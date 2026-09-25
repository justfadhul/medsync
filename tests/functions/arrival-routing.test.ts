import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ADR 0101 rulings R1 and R4 — where the desk sends an arrival, and the
 * hygiene the routing depends on. Source-level, like
 * tests/emergency/patient-functions: Deno functions do not run under Vitest,
 * and these rules are about what each function reads, which shared writer it
 * goes through, and the order of audit and mutation.
 */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const fn = (name: string) => read(`supabase/functions/${name}/index.ts`);

/** Comments explain the rule; they must not be mistaken for violations of it. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The source between two markers (the second searched after the first). */
const between = (src: string, from: string, to: string) => {
  const start = src.indexOf(from);
  expect(start, `missing: ${from}`).toBeGreaterThan(-1);
  const end = src.indexOf(to, start + from.length);
  expect(end, `missing after ${from}: ${to}`).toBeGreaterThan(-1);
  return src.slice(start, end);
};

describe("_shared/queue.ts — the route rule and the one queue writer", () => {
  const src = stripComments(read("supabase/functions/_shared/queue.ts"));

  it("an emergency is always triaged; otherwise the desk's choice stands", () => {
    expect(src).toContain('return isEmergency ? "triage" : requested;');
  });

  it("triage leaves awaiting_triage, clinic leaves arrived", () => {
    expect(src).toContain('return route === "triage" ? "awaiting_triage" : "arrived";');
  });

  it("numbers on the hospital's day, never UTC's", () => {
    expect(src).toContain("startOfLocalDay(new Date(), DEFAULT_TIME_ZONE)");
    expect(src).not.toMatch(/setUTCHours|setHours/);
  });

  it("reuses a booking's live row (moved to the chosen department) instead of a second one", () => {
    const reuse = between(src, "if (args.appointment_id) {", "const startOfDay");
    expect(reuse).toContain('.eq("appointment_id", args.appointment_id)');
    expect(reuse).toContain('.in("state", ["waiting", "being_seen"])');
    expect(reuse).toContain(".update({ department_id: args.department_id })");
    expect(reuse).toContain("return live.id as string;");
    // The reuse check runs before any insert.
    expect(src.indexOf("if (args.appointment_id) {")).toBeLessThan(src.indexOf(".insert({"));
  });
});

describe("ha-check-in-patient — the desk routes every arrival (R1)", () => {
  const src = stripComments(fn("ha-check-in-patient"));
  const modeA = between(src, "if (input.appointment_id) {", "const intakeId = input.intake_id!");
  const modeB = src.slice(src.indexOf("const intakeId = input.intake_id!"));

  it("route defaults to triage; a department is optional", () => {
    expect(src).toContain('route: z.enum(["triage", "clinic"]).default("triage")');
    expect(src).toContain("department_id: z.string().uuid().optional()");
  });

  it("uses the shared queue writer and route helpers — no local copy", () => {
    expect(src).toContain(
      'import { effectiveRoute, insertQueueRow, intakeStatusFor } from "../_shared/queue.ts";',
    );
    expect(src).not.toMatch(/async function insertQueueRow/);
    expect(src).not.toMatch(/from\("queue_entries"\)\s*\.insert\(/);
  });

  it("a chosen department must belong to the row's hospital", () => {
    expect(src).toContain('.eq("id", departmentId)');
    expect(src).toContain('.eq("hospital_id", hospitalId)');
    expect(modeA).toContain("departmentAtHospital(sb, input.department_id, appt.hospital_id)");
    expect(modeB).toContain("departmentAtHospital(sb, input.department_id, intake.hospital_id)");
  });

  it("clinic without a department is refused in both modes", () => {
    for (const mode of [modeA, modeB]) {
      expect(mode).toContain('if (route === "clinic" && !departmentId)');
    }
  });

  describe("mode A — a booking", () => {
    it("accepts confirmed, or arrived with no intake yet (the patient's own 'I have arrived')", () => {
      expect(modeA).toContain('if (appt.status === "arrived")');
      expect(modeA).toContain('.eq("appointment_id", appt.id)');
      expect(modeA).toContain("selfArrived = !existing;");
      expect(modeA).toContain('if (appt.status !== "confirmed" && !selfArrived)');
    });

    it("never flips a self-arrived booking a second time", () => {
      const flip = between(modeA, "if (!selfArrived) {", "const queueEntryId");
      expect(flip).toContain('.update({ status: "arrived" })');
    });

    it("refuses a booking that is not for today, on the hospital's day", () => {
      expect(modeA).toContain("localDateKey(new Date(), DEFAULT_TIME_ZONE)");
      expect(modeA).toContain(
        "localDateKey(appt.starts_at as string, DEFAULT_TIME_ZONE) !== today",
      );
      expect(modeA.indexOf("!== today")).toBeLessThan(modeA.indexOf("recordSaAudit({"));
    });

    it("keeps the provisional-identity 409 and the desk's authorisation", () => {
      expect(modeA).toContain("authoriseAtHospital(caller.id, appt.hospital_id)");
      expect(modeA).toContain('conflict("Confirm who this booking is for before checking in."');
    });

    it("writes the route on the intake: status by route, routed_to, the chosen department", () => {
      const insert = between(modeA, '.from("patient_intakes")\n      .insert({', "})");
      expect(insert).toContain('entry_type_code: "booked_arrival"');
      expect(insert).toContain("receiving_department_id: departmentId");
      expect(insert).toContain("status: intakeStatusFor(route)");
      expect(insert).toContain("routed_to: route");
    });

    it("queues the booking in the chosen department", () => {
      const queue = between(modeA, "await insertQueueRow(sb, {", "});");
      expect(queue).toContain("department_id: departmentId");
      expect(queue).toContain('kind: "scheduled_arrival"');
    });
  });

  describe("mode B — a declared 'coming today' ticket", () => {
    it("only a declared ticket checks in", () => {
      expect(modeB).toContain('if (intake.status !== "declared")');
    });

    it("an emergency entry type is forced to triage", () => {
      expect(modeB).toContain("lookupEntryType(sb, intake.entry_type_code)");
      expect(modeB).toContain("const route = effectiveRoute(input.route, isEmergency);");
      expect(modeB).toContain("const status = intakeStatusFor(route);");
    });

    it("updates status, routed_to, checked_in_at and the department together", () => {
      const update = between(modeB, '.from("patient_intakes")\n    .update({', "})");
      for (const field of [
        "status,",
        "routed_to: route",
        "checked_in_at: checkedInAt",
        "receiving_department_id: departmentId",
      ]) {
        expect(update).toContain(field);
      }
    });

    it("queues a walk_in in the chosen department", () => {
      const queue = between(modeB, "await insertQueueRow(sb, {", "});");
      expect(queue).toContain("department_id: departmentId");
      expect(queue).toContain('kind: "walk_in"');
    });
  });

  it("audits first, with the route and the department, in both modes", () => {
    for (const mode of [modeA, modeB]) {
      const audit = mode.indexOf("recordSaAudit({");
      expect(audit).toBeGreaterThan(-1);
      expect(audit).toBeLessThan(mode.indexOf('.from("patient_intakes")\n', audit));
      expect(mode.slice(audit)).toMatch(
        /afterData: \{ status[^}]*route, department_id: departmentId \}/,
      );
    }
    expect(modeA).toContain('action: "check_in_patient"');
    expect(modeB).toContain('action: "check_in_patient"');
  });
});

describe("registerIntake — a desk walk-in joins the clinic line (R4)", () => {
  const src = stripComments(read("supabase/functions/_shared/intake.ts"));

  it("inserts the queue row through the shared writer, after the intake", () => {
    expect(src).toContain('import { insertQueueRow } from "./queue.ts";');
    const queue = src.indexOf("await insertQueueRow(sb, {");
    expect(queue).toBeGreaterThan(src.indexOf('.from("patient_intakes")'));
    const call = between(src, "await insertQueueRow(sb, {", "});");
    expect(call).toContain("department_id: input.receivingDepartmentId ?? null");
    expect(call).toContain("patient_user_id: input.patientUserId ?? null");
    expect(call).toContain('kind: entryType.is_emergency ? "urgent_walk_in" : "walk_in"');
  });
});

describe("ha-register-intake — one live ticket per patient per hospital day (R4)", () => {
  const src = stripComments(fn("ha-register-intake"));
  const guard = between(
    src,
    "if (input.patient_user_id && !entryType.is_emergency) {",
    "const { ipAddress",
  );

  it("looks for a live intake at this hospital today, on the hospital's day", () => {
    expect(guard).toContain('.eq("hospital_id", input.hospital_id)');
    expect(guard).toContain('.eq("patient_user_id", input.patient_user_id)');
    expect(guard).toContain('.in("status", ["declared", "arrived", "awaiting_triage", "triaged"])');
    expect(guard).toContain("startOfLocalDay(new Date(), DEFAULT_TIME_ZONE)");
  });

  it("refuses with a 409 that points at the existing ticket", () => {
    expect(guard).toContain("return conflict(");
    expect(guard).toContain("check in their existing ticket instead");
    expect(guard).toContain("{ intake_id: live.id, status: live.status }");
  });

  it("refuses before anything is written, and never blocks an emergency", () => {
    expect(src.indexOf("return conflict(")).toBeLessThan(src.indexOf("await registerIntake("));
    expect(src).toContain("!entryType.is_emergency");
  });
});
