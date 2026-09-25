import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ADR 0101 ruling R3 — starting and ending a visit. Source-level, like
 * tests/emergency/patient-functions: Deno functions do not run under Vitest,
 * and these rules are about which rows each write may touch.
 */
const fn = (name: string) =>
  readFileSync(resolve(process.cwd(), `supabase/functions/${name}/index.ts`), "utf8");

/** Comments explain the rule; they must not be mistaken for violations of it. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const between = (src: string, from: string, to: string) => {
  const start = src.indexOf(from);
  expect(start, `missing: ${from}`).toBeGreaterThan(-1);
  const end = src.indexOf(to, start + from.length);
  expect(end, `missing after ${from}: ${to}`).toBeGreaterThan(-1);
  return src.slice(start, end);
};

describe("ha-complete-encounter — the cascade is this encounter's, not the patient's day", () => {
  const src = stripComments(fn("ha-complete-encounter"));
  const queue = between(src, '.from("queue_entries")', '.from("patient_intakes")');
  const intake = between(src, '.from("patient_intakes")', '.from("nursing_assignments")');

  it("reads the encounter's department and triage record", () => {
    expect(src).toMatch(/\.select\(\s*"[^"]*department_id, triage_record_id"/);
  });

  it("closes the encounter's own queue row by encounter_id", () => {
    expect(queue).toContain('.eq("encounter_id", enc.id)');
  });

  it("closes only a waiting row in the encounter's department today — never another department", () => {
    expect(queue).toContain('.eq("department_id", enc.department_id)');
    expect(queue).toContain('.eq("state", "waiting")');
    expect(queue).toContain('.gte("arrived_at", startOfDay.toISOString())');
    // Every patient-wide queue update is pinned to the department.
    const patientWide = queue
      .split(".update(")
      .slice(1)
      .filter((u) => u.includes("patient_user_id"));
    expect(patientWide.length).toBeGreaterThan(0);
    for (const u of patientWide) expect(u).toContain('.eq("department_id", enc.department_id)');
  });

  it("closes the visit's intake by linkage, without an arrived_at >= today filter", () => {
    expect(intake).not.toContain("arrived_at");
    expect(intake).toContain('.in("status", ["arrived", "awaiting_triage", "triaged"])');
    expect(intake).toContain('.or(intakeLinks.join(","))');
    expect(src).toContain("const intakeLinks = [`encounter_id.eq.${enc.id}`];");
    expect(src).toContain("intakeLinks.push(`id.eq.${triageIntakeId}`)");
  });

  it("the booking links the intake when there is one, else the encounter's department", () => {
    expect(src).toMatch(
      /if \(enc\.appointment_id\) intakeLinks\.push\(`appointment_id\.eq\.\$\{enc\.appointment_id\}`\);\s*else if \(enc\.department_id\)\s*intakeLinks\.push\(`receiving_department_id\.eq\.\$\{enc\.department_id\}`\);/,
    );
  });

  it("keeps its auth, audit-first, and the appointment step", () => {
    expect(src).toContain("caller.id === enc.clinician_user_id");
    expect(src).toContain('hasRole(caller.id, "hospital_admin", enc.hospital_id)');
    expect(src).toContain("requireHospitalAdminScope(caller.id, enc.hospital_id)");
    expect(src.indexOf("recordSaAudit({")).toBeLessThan(
      src.indexOf('.from("encounters")\n    .update('),
    );
    expect(src).toContain('.update({ status: "completed" })');
    expect(src).toContain('.in("status", ["arrived", "in_progress"])');
  });
});

describe("ha-start-encounter — a queue row with no appointment can be started", () => {
  const src = stripComments(fn("ha-start-encounter"));
  const walkIn = src.slice(src.indexOf("async function startFromQueueRow("));

  it("no longer 404s an appointment-less row; it starts from the row", () => {
    expect(src).not.toContain("queue entry has no linked appointment");
    expect(src).toContain("if (!qe.appointment_id) {");
    expect(src).toContain("return await startFromQueueRow(");
  });

  it("authorises a nurse, a clinical cadre at the hospital, or a scoped admin / superadmin", () => {
    expect(walkIn).toContain('hasRole(callerId, "superadmin")');
    expect(walkIn).toContain('hasRole(callerId, "nurse", qe.hospital_id)');
    expect(walkIn).toContain('.eq("cadres.is_clinical", true)');
    expect(walkIn).toContain('.eq("hospital_id", qe.hospital_id)');
    expect(walkIn).toContain("requireHospitalAdminScope(callerId, qe.hospital_id)");
  });

  it("audits first, then claims the waiting row before creating the encounter", () => {
    const audit = walkIn.indexOf("recordSaAudit({");
    const claim = walkIn.indexOf('.eq("state", "waiting")');
    const insert = walkIn.indexOf('.from("encounters")');
    expect(audit).toBeGreaterThan(-1);
    expect(audit).toBeLessThan(claim);
    expect(claim).toBeLessThan(insert);
    expect(walkIn).toContain('return conflict("This patient has already been called."');
  });

  it("creates an OPD encounter from the row with the caller as clinician", () => {
    const insert = between(walkIn, '.from("encounters")', ".select(");
    for (const field of [
      "hospital_id: qe.hospital_id",
      "appointment_id: null",
      "patient_user_id: qe.patient_user_id",
      "clinician_user_id: callerId",
      "department_id: qe.department_id",
      'encounter_type: "opd"',
      'state: "in_progress"',
    ]) {
      expect(insert).toContain(field);
    }
  });

  it("marks the row being_seen with who called it, and links the encounter", () => {
    expect(walkIn).toContain(
      '.update({ state: "being_seen", called_at: nowIso, called_by_user_id: callerId })',
    );
    expect(walkIn).toContain('.update({ encounter_id: encounter.id }).eq("id", qe.id)');
  });

  it("links the patient's open intake in that department today", () => {
    const link = between(walkIn, '.from("patient_intakes")', ";");
    expect(link).toContain(".update({ encounter_id: encounter.id })");
    expect(link).toContain('.eq("receiving_department_id", qe.department_id)');
    expect(link).toContain('.in("status", ["arrived", "awaiting_triage", "triaged"])');
    expect(walkIn).toContain("startOfLocalDay(new Date(), DEFAULT_TIME_ZONE)");
  });

  it("booked rows keep today's behaviour", () => {
    expect(src).toContain("clinician_user_id: appt.clinician_user_id");
    expect(src).toContain('.update({ status: "in_progress" })');
  });
});
