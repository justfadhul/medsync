import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { euRefusal } from "@/supabase/functions/_shared/eu";

/** ADR 0541 — ward staff move a patient between EU spaces; release and assign are guarded. Source-level. */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const hub = strip(read("supabase/functions/ha-services-hub/ops-wards.ts"));
const nurse = strip(read("app/nurse/beds/actions.ts"));
const admin = strip(read("app/hospital-admin/departments/wards/[wardId]/actions.ts"));
const guard = strip(read("lib/wards/eu-guard.ts"));
const SEND = "In an emergency unit, send the patient from their visit (Send to EU).";

describe("ops-wards: move_eu_space", () => {
  it("is a ward-staff op with the brief's schema", () => {
    expect(hub).toMatch(/WARD_STAFF_OPS = new Set\(\[[^\]]*"move_eu_space"/s);
    expect(hub).toContain('op: z.literal("move_eu_space")');
    expect(hub).toContain("stay_id: uuid");
    expect(hub).toContain('z.enum(["no_free_bed", "extra_bed", "floor", "other"])');
    expect(hub).toContain("space_wait_note_ciphertext");
    expect(hub).toContain("move_eu_space: moveEuSpace");
  });
  it("checks the stay's ward and the target ward, audits, and calls the function", () => {
    const h = hub.slice(hub.indexOf("const moveEuSpace"));
    expect(h).toContain("assertWardWorker(ctx, stay.ward_id)");
    expect(h).toContain("assertWardWorker(ctx, i.ward_id)");
    expect(h).toContain('action: "move_eu_space"');
    expect(h).toContain('rpc(ctx, "move_eu_space"');
  });
  it("rpc sends the caller as actor and refusals go through euRefusal; no raw message", () => {
    expect(hub).toContain("{ ...p, hospital_id: ctx.hospitalId, actor: ctx.callerId }");
    expect(hub).toContain("euRefusal");
    expect(hub).not.toContain("${fn}: ${r.error.message}");
  });
  it("missing-table check accepts 42P01 and PGRST205", () => {
    expect(hub).toMatch(/"42P01"[\s\S]{0,40}"PGRST205"/);
  });
  it("release_bed refuses an EU stay's bed", () => {
    const r = hub.slice(hub.indexOf("const releaseBed"), hub.indexOf("const allocateAdmissionBed"));
    expect(r).toContain("eu_stay_id");
    expect(r).toContain("Use Move to change the space; the stay ends when the visit closes.");
  });
});

describe("R60 hardening", () => {
  it("hub assign_bed refuses an EU ward server-side when the EU is on", () => {
    const h = hub.slice(hub.indexOf("const assignBed"), hub.indexOf("const releaseBed"));
    expect(h).toContain('euObservationOn(Deno.env.get("EU_OBSERVATION"), ctx.hospitalId)');
    expect(h).toContain("EU_SEND_FROM_VISIT");
  });
  it("adminAssignBed validates the bed id before the guard query", () => {
    const a = admin.slice(admin.indexOf("export async function adminAssignBed"));
    expect(a.indexOf("uuid.safeParse(bedId)")).toBeGreaterThan(-1);
    expect(a.indexOf("uuid.safeParse(bedId)")).toBeLessThan(a.indexOf("euAssignRefusal"));
  });
  it("both move actions cap the note before encrypting", () => {
    for (const src of [nurse, admin]) {
      expect(src.indexOf("note.length > WAIT_NOTE_MAX")).toBeGreaterThan(-1);
      expect(src.indexOf("note.length > WAIT_NOTE_MAX")).toBeLessThan(src.indexOf("encrypt(note)"));
    }
    expect(read("content/eu/words.ts")).toContain("waitNoteTooLong");
  });
  it("moveEuSpace handles a missing table and logs SQLSTATE only", () => {
    const h = hub.slice(hub.indexOf("const moveEuSpace"));
    expect(h).toContain("missing(sr.error)");
    expect(h).toContain("sr.error.code");
    expect(h).not.toContain("sr.error.message");
  });
});

describe("R61: boarders hold two open rows", () => {
  it("hub assign_bed reads the patient's open rows as a list, never maybeSingle", () => {
    const h = hub.slice(hub.indexOf("const assignBed"), hub.indexOf("const releaseBed"));
    const q = h.slice(
      h.indexOf('.eq("patient_user_id", i.patient_user_id)'),
      h.indexOf('"patient\'s bed"'),
    );
    expect(q).toContain(".limit(1)");
    expect(q).not.toContain("maybeSingle");
  });
});

describe("euRefusal in the hub", () => {
  it("maps deadlocks to try again", () => {
    expect(euRefusal({ message: "x", code: "40P01" })).toBe(
      "Someone changed this patient just now. Try again.",
    );
  });
});

describe("server actions", () => {
  it("nurse and admin move actions send move_eu_space and encrypt the note", () => {
    for (const [src, name] of [
      [nurse, "nurseMoveEuSpace"],
      [admin, "adminMoveEuSpace"],
    ] as const) {
      expect(src).toContain(`export async function ${name}(`);
      expect(src).toContain('op: "move_eu_space"');
      expect(src).toContain("encrypt(");
    }
  });
  it("both assign actions use the EU guard, whose refusal is the brief's words", () => {
    expect(nurse).toMatch(/nurseAssignBed[\s\S]*euAssignRefusal/);
    expect(admin).toMatch(/adminAssignBed[\s\S]*euAssignRefusal/);
    expect(read("supabase/functions/_shared/eu.ts")).toContain(SEND);
    expect(guard).toContain("euObservationLiveFor");
    expect(guard).toContain("emergency_observation");
  });
});
