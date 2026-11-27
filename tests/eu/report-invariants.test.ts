import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const LOAD = "lib/eu/report-load.ts";

describe("the EU report read is numbers only", () => {
  it("selects no name, phone, patient code, patient id or booking code", () => {
    const src = strip(read(LOAD));
    for (const f of ["fullName", "phone", "patientCode", "patientUserId", "bookingCode"])
      expect(src).not.toContain(f);
    for (const f of ["arrivedAt", "decidedAt", "endedAt", "endKind"]) expect(src).toContain(f);
  });

  it("is scoped by hospital, gated by the flag, and survives a missing table", () => {
    const src = strip(read(LOAD));
    expect(src).toContain("euObservationLiveFor(hospitalId)");
    expect(src).toContain("eq(euStays.hospitalId, hospitalId)");
    expect(src).toMatch(/42P01/);
    expect(src).toMatch(/PGRST205/);
  });

  it("is not imported by lib/emr or app/doctor", () => {
    for (const f of [...walk("lib/emr"), ...walk("app/doctor")])
      expect(readFileSync(f, "utf8"), f).not.toMatch(/eu\/report-load/);
  });

  it("the section says its basis in words", () => {
    const w = read("content/eu/words.ts");
    expect(w).toContain("no usable arrival time");
    expect(w).toContain("finished stays");
    expect(w).toContain("nothing here is a target");
    expect(w).toContain("too few to report");
  });
});
