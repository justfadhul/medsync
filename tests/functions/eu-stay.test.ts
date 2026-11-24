import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { euObservationOn, euRefusal } from "@/supabase/functions/_shared/eu";

/**
 * ADR 0541 — sending to the EU, and the close that ends the stay. Source-level, as
 * encounter-lifecycle.test.ts: Deno functions do not run under Vitest. The SQL behind them is
 * proven on the PGlite lane (tests/emr-db/eu-stays.test.ts).
 */
const fn = (name: string) =>
  readFileSync(resolve(process.cwd(), `supabase/functions/${name}/index.ts`), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const RETRY = "Someone changed this patient just now. Try again.";

describe("ha-eu-stay — send to the EU", () => {
  const src = stripComments(fn("ha-eu-stay"));

  // R58: sending to the EU is a clinical decision, the encounter's own clinician's.
  it("an admin or superadmin caller is forbidden: no admin arm", () => {
    expect(src).not.toContain("hospital_admin");
    expect(src).not.toContain("superadmin");
    expect(src).not.toContain("requireHospitalAdminScope");
    expect(src).not.toContain("hasRole");
  });

  it("another clinician is forbidden: only the encounter's clinician", () => {
    expect(src).toContain("if (caller.id !== enc.clinician_user_id) return forbidden(init);");
  });

  it("the owner is allowed only with a live clinical affiliation at the encounter's hospital", () => {
    const own = src.slice(src.indexOf("if (caller.id !== enc.clinician_user_id)"));
    const aff = own.slice(
      own.indexOf('.from("staff_affiliations")'),
      own.indexOf("recordSaAudit({"),
    );
    expect(aff).toContain('.eq("user_id", caller.id)');
    expect(aff).toContain('.eq("hospital_id", enc.hospital_id)');
    expect(aff).toContain('.in("state", ["active", "approved"])');
    expect(aff).toContain('.eq("cadres.is_clinical", true)');
    expect(aff).toContain("code: affErr.code");
    expect(aff).toContain("if (!aff) return forbidden(init);");
  });

  it("refuses when the flag is off, before anything is written", () => {
    const flag = src.indexOf('euObservationOn(Deno.env.get("EU_OBSERVATION"), enc.hospital_id)');
    expect(flag).toBeGreaterThan(-1);
    expect(flag).toBeLessThan(src.indexOf("recordSaAudit({"));
  });

  it("audits send_to_eu before observe_in_eu", () => {
    const audit = src.indexOf('action: "send_to_eu"');
    const rpc = src.indexOf('rpc("observe_in_eu"');
    expect(audit).toBeGreaterThan(-1);
    expect(rpc).toBeGreaterThan(audit);
  });

  it("the actor and encounter are the authorised caller's, set after the input; the body has no actor", () => {
    expect(src).not.toMatch(/\bactor:\s*z\./);
    expect(src).toContain("p: { ...payload, encounter_id: enc.id, actor: caller.id }");
  });

  it("never reads a patient's name", () => {
    for (const col of ["full_name", "first_name", "surname"]) expect(src).not.toContain(col);
  });

  it("a floor visit sent to the EU ends as Observed in EU: after the start, non-fatal, no name, room or note", () => {
    const after = src.slice(src.indexOf('rpc("observe_in_eu"'));
    const call = after.indexOf("floorFinishEu(");
    expect(call).toBeGreaterThan(after.indexOf("r.data?.intake_id"));
    expect(call).toBeLessThan(after.indexOf("return ok({ stay: r.data }, init)"));
    const floor = src.slice(src.indexOf("async function floorFinishEu("));
    expect(floor).toContain('.from("clinic_floor_events")');
    expect(floor).toContain('.eq("intake_id", intakeId)');
    expect(floor).toContain('kind: "finish"');
    expect(floor).toContain('detail: "eu"');
    expect(floor).toContain("client_id: crypto.randomUUID()");
    expect(floor).toContain("by_user_id: byUserId");
    expect(floor).toContain("(non-fatal)");
    const insert = floor.slice(
      floor.indexOf(".insert({"),
      floor.indexOf("})", floor.indexOf(".insert({")),
    );
    for (const col of ["room", "note", "name"]) expect(insert).not.toContain(col);
  });

  it("returns words, never a raw database message", () => {
    expect(src).toContain("euRefusal(r.error)");
    expect(src).not.toMatch(/badRequest\(r\.error\.message/);
    expect(src).not.toMatch(/serverError\([^)]*\.message/);
    expect(src).toContain("return ok({ stay: r.data }, init)");
  });
});

describe("ha-eu-stay — triage sends a Level 1–2 patient to EU resus (D4)", () => {
  const src = stripComments(fn("ha-eu-stay"));
  const op = src.slice(src.indexOf("async function sendToEuResus("));

  it("is its own op, routed before the encounter path", () => {
    expect(src).toContain('op: z.literal("send_to_eu_resus")');
    expect(src).toMatch(/if \(parsed\.data\.op === "send_to_eu_resus"\)\s*return sendToEuResus\(/);
    expect(src.indexOf('parsed.data.op === "send_to_eu_resus"')).toBeLessThan(
      src.indexOf('.from("encounters")'),
    );
  });

  it("the caller is triage-capable clinical staff at the body's hospital (as requireTriageScope)", () => {
    const auth = op.slice(0, op.indexOf("recordSaAudit({"));
    expect(auth).toContain('.from("staff_affiliations")');
    expect(auth).toContain('.eq("user_id", callerId)');
    expect(auth).toContain('.eq("hospital_id", p.hospital_id)');
    expect(auth).toContain('.in("state", ["active", "approved"])');
    expect(auth).toContain('.eq("cadres.is_clinical", true)');
    expect(auth).toContain('.from("clinical_cosign_policies")');
    expect(auth).toContain('.eq("action_kind", "triage_patient")');
    expect(auth).toContain('.eq("requirement", "allowed")');
    expect(auth.match(/return forbidden\(init\);/g)?.length).toBe(2);
    expect(auth).not.toContain("hospital_admin");
  });

  it("refuses with the flag off, before the audit", () => {
    const flag = op.indexOf('euObservationOn(Deno.env.get("EU_OBSERVATION"), p.hospital_id)');
    expect(flag).toBeGreaterThan(-1);
    expect(flag).toBeLessThan(op.indexOf("recordSaAudit({"));
  });

  it("audits send_to_eu_resus on the intake, then the rpc with the actor set after the spread", () => {
    expect(op).toContain('action: "send_to_eu_resus"');
    expect(op).toContain('targetKind: "patient_intake"');
    expect(op.indexOf('action: "send_to_eu_resus"')).toBeLessThan(
      op.indexOf('rpc("send_to_eu_resus"'),
    );
    expect(op).toContain("p: { ...p, actor: callerId }");
  });

  it("returns words for a refusal, never the database's", () => {
    expect(op).toContain("euRefusal(r.error)");
    expect(op).not.toMatch(/serverError\([^)]*\.message/);
  });

  it("the floor's visit ends as Observed in EU, after the start, through the same writer", () => {
    expect(op.indexOf("floorFinishEu(")).toBeGreaterThan(op.indexOf('rpc("send_to_eu_resus"'));
  });
});

describe("ha-complete-encounter — the close ends the EU stay", () => {
  const src = stripComments(fn("ha-complete-encounter"));

  it("finds the open stay this visit may end, and treats a missing table as none", () => {
    expect(src).toContain('.from("eu_stays")');
    expect(src).toContain('.eq("patient_user_id", enc.patient_user_id)');
    expect(src).toContain('.neq("status", "ended")');
    // R65: a triage stay (no encounter) is this visit's only when its intake is this encounter's visit.
    expect(src).not.toContain("encounter_id.eq.${enc.id},encounter_id.is.null");
    expect(src).toContain(
      '"id, hospital_id, patient_user_id, clinician_user_id, state, appointment_id, department_id, triage_record_id, visit_id"',
    );
    expect(src).toContain(
      "triageStayId ? `encounter_id.eq.${enc.id},id.eq.${triageStayId}` : `encounter_id.eq.${enc.id}`",
    );
  });

  it("R65: a triage stay is this visit's by visit_id, its triage's intake, or the intake naming this encounter", () => {
    const eu = src.slice(src.indexOf("let triageStayId"), src.indexOf("let euLookup"));
    // Looked for only when the patient has an open triage stay here: a non-EU close gains no query and no failure.
    expect(eu).toContain('.is("encounter_id", null)');
    expect(eu.indexOf("if (triageStay.data) {")).toBeLessThan(
      eu.indexOf('.from("triage_records")'),
    );
    expect(eu).toContain(
      '.select("id, intake_id, intake:patient_intakes!intake_id(encounter_id)")',
    );
    expect(eu).toContain(
      "let mine = enc.visit_id === triageStay.data.intake_id || named?.encounter_id === enc.id;",
    );
    expect(eu).toContain("if (!mine && !enc.visit_id && enc.triage_record_id) {");
    expect(eu).toContain('.eq("intake_id", triageStay.data.intake_id)');
    // A failed link lookup fails the close visibly, never leaving a resus space silently held.
    expect(src).toMatch(
      /const euFail = \(code\?: string\) => \{\s*log\.error\([^)]*\);\s*return serverError\("encounter update failed", init\);/,
    );
    expect(eu.match(/return euFail\(/g)?.length).toBe(2);
    // The intake close (step 3) keeps its own non-fatal triage lookup.
    const step3 = src.slice(src.indexOf("let triageIntakeId"), src.indexOf("const intakeLinks"));
    expect(step3).toContain('.from("triage_records")');
    expect(step3).not.toContain("serverError");
  });

  it("finds a missing table as none", () => {
    expect(src).toContain(
      'const missingTable = (code?: string) => code === "42P01" || code === "PGRST205";',
    );
    expect(src.match(/missingTable\(euLookup\.error/g)?.length).toBe(2);
    // The boarder lookup runs only when the first finds nothing, and its failure never fails a close.
    expect(src).toContain("if (!euLookup.error && !euLookup.data) {");
    expect(src).toContain("admission lookup failed (non-fatal)");
  });

  it("a close refused by the database's EU guard returns its words (R59)", () => {
    const update = src.slice(src.indexOf('.update({\n        state: "completed"'));
    expect(update).toMatch(
      /if \(e1\) \{\s*const words = euRefusal\(e1\);\s*if \(words\) return badRequest\(words, init\);/,
    );
  });

  it("refuses a non-clinical close while the patient is in the EU, before the audit; an admission is allowed (boarding)", () => {
    const a = src.indexOf(
      "This patient is in the emergency unit. Close the visit with an outcome; that ends the EU stay.",
    );
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(src.indexOf("recordSaAudit({"));
    expect(src).not.toContain("comes with boarding");
    expect(src).not.toContain("euStayId && admission");
  });

  it("the stay lookup has the boarder arm: the admission whose inpatient encounter is this one", () => {
    expect(src).toContain('.from("admissions")');
    expect(src).toContain('.eq("inpatient_encounter_id", enc.id)');
    expect(src).toContain("admission_id.eq.");
    expect(src).toContain("PGRST205");
  });

  it("an admission never reaches end_eu_stay: the stay stays open as a boarder", () => {
    expect(src).toContain("if (euStayId && clinical && !admission) {");
    // admit_from_encounter (1a) comes before, and the only end_eu_stay call is behind that guard.
    expect(src.indexOf('rpc("admit_from_encounter"')).toBeLessThan(
      src.indexOf('rpc("end_eu_stay"'),
    );
    expect(src.match(/rpc\("end_eu_stay"/g)?.length).toBe(1);
  });

  it("ends the stay with the close, after the audit, end_kind and disposition from one input", () => {
    const rpc = src.indexOf('sb.rpc("end_eu_stay"');
    expect(rpc).toBeGreaterThan(src.indexOf("recordSaAudit({"));
    expect(src).toContain("end_kind: input.disposition");
    expect(src).toContain("disposition: storedDisposition");
    expect(src).toContain("actor: caller.id");
    expect(src).toContain('action: "end_eu_stay"');
    expect(src).toContain("euRefusal(r.error)");
  });

  it("an ended stay skips the encounter update and its event; the cascade still runs", () => {
    expect(src).toContain("if (!admitted && !euEnded) {");
    expect(src).toContain("if (!admitted && !euEnded && (clinical || administrative)) {");
    // Nursing ends for an EU close (only an admission keeps it).
    expect(src).toContain('.from("nursing_assignments")');
    expect(src).toMatch(/let naCount: number \| null = 0;\s*if \(!admitted\) \{/);
  });
});

describe("euRefusal — words, never the database's", () => {
  it("returns the words after an EU or AD code", () => {
    expect(euRefusal({ message: "EU409 This patient is already in the EU.", code: "23514" })).toBe(
      "This patient is already in the EU.",
    );
    expect(euRefusal({ message: "AD409 That bed was just taken.", code: "P0001" })).toBe(
      "That bed was just taken.",
    );
  });

  it("a deadlock or serialization failure asks to try again", () => {
    expect(euRefusal({ message: "deadlock detected", code: "40P01" })).toBe(RETRY);
    expect(euRefusal({ message: "could not serialize access", code: "40001" })).toBe(RETRY);
  });

  it("anything else is not for the user", () => {
    expect(euRefusal({ message: 'relation "eu_stays" does not exist', code: "42P01" })).toBeNull();
    expect(euRefusal({ message: "EU500 nope" })).toBeNull();
  });
});

describe("euObservationOn — EU_OBSERVATION in the function's environment", () => {
  const h = "11111111-1111-1111-1111-111111111111";
  it("is off unless 1 or the hospital is listed", () => {
    expect(euObservationOn(undefined, h)).toBe(false);
    expect(euObservationOn("", h)).toBe(false);
    expect(euObservationOn("0", h)).toBe(false);
    expect(euObservationOn("1", h)).toBe(true);
    expect(euObservationOn(` other, ${h} `, h)).toBe(true);
    expect(euObservationOn("other", h)).toBe(false);
  });
});
