import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The staff patient card's reveal (ADR 0095). Source-level, like
 * tests/reception/expected-invariants.test.ts: the rules are about what the
 * code may do — audit before it names, fail closed, stay out of the
 * non-clinical surfaces, never rank on what the patient said — and a
 * stubbed database would only prove the stub.
 */
const ROOT = process.cwd();
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** The text between the `(` at `open` and its balanced `)`. */
function callArgs(src: string, open: number): string {
  let depth = 0;
  let i = open;
  do {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") depth--;
    i++;
  } while (depth > 0 && i < src.length);
  return src.slice(open + 1, i - 1);
}

describe("revealPatientIdentities", () => {
  const src = read("lib/scheduling/patient-identity.ts");
  const fn = src.slice(
    src.indexOf("export async function revealPatientIdentities("),
    src.indexOf("\n}\n", src.indexOf("export async function revealPatientIdentities(")),
  );

  it("is server-only and writes clinical_phi_access_log rows before naming anyone", () => {
    expect(src.startsWith('import "server-only";')).toBe(true);
    expect(fn).toMatch(/db\s*\.insert\(clinicalPhiAccessLog\)/);
    expect(fn).toContain('accessBasis: "department_recent"');
    // Operational by default; the doctor workspace's clinical list (`clinical: true`)
    // logs its own surface without the suffix — the audit-first order is the same.
    expect(fn).toMatch(
      /surface: args\.clinical \? args\.surface : `\$\{args\.surface\}\$\{OPERATIONAL_BASIS_SUFFIX\}`/,
    );
    // The insert precedes the assignment of the name and the photo.
    expect(fn.indexOf(".insert(")).toBeLessThan(fn.indexOf("row.displayName ="));
    expect(fn.indexOf(".insert(")).toBeLessThan(fn.indexOf("row.photoUrl ="));
  });

  it("fails closed on the name AND the photo when the audit insert throws", () => {
    const tryStart = fn.indexOf("try {");
    const catchStart = fn.indexOf("} catch (e) {", tryStart);
    const catchEnd = fn.indexOf("\n  }\n", catchStart);
    const catchBody = fn.slice(catchStart, catchEnd);
    expect(catchBody).toContain("logger.error(");
    expect(catchBody).toMatch(/return out;/);
    // `out` is seeded with null name + null photo before the try; nothing
    // inside the catch may fill either.
    const seed = fn.slice(0, tryStart);
    expect(seed).toMatch(/displayName: null,\s*photoUrl: null,/);
    expect(catchBody).not.toMatch(/displayName\s*=|photoUrl\s*=|signedAvatarUrl/);
  });

  it("signs photos only after the audit succeeded", () => {
    expect(fn.indexOf("signedAvatarUrl(")).toBeGreaterThan(fn.indexOf("} catch (e) {"));
  });
});

describe("who calls the reveal", () => {
  it("the calendar, the doctor's rails and the clinician's list all go through it", () => {
    for (const f of [
      "lib/scheduling/calendar.ts",
      "lib/scheduling/doctor.ts",
      "app/clinician/schedule/page.tsx",
    ]) {
      expect(read(f), f).toMatch(/revealPatientIdentities\(/);
    }
    // The clinician page's old unaudited name: gone.
    expect(read("app/clinician/schedule/page.tsx")).not.toMatch(/users\.fullName/);
  });

  it("the hospital-admin surface stays code-only (ADR 0032) — it never imports the reveal", () => {
    for (const f of walk(resolve(ROOT, "lib/hospital-admin"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/scheduling\/patient-identity/);
    }
  });
});

describe("the complaint is words, not a key (PRD §5.4 as amended by ADR 0095)", () => {
  it("nothing under lib/scheduling or app/doctor sorts or filters on complaint or symptoms", () => {
    const files = [
      ...walk(resolve(ROOT, "lib/scheduling")),
      ...walk(resolve(ROOT, "app/doctor")),
      ...walk(resolve(ROOT, "components/scheduling")),
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\.(sort|filter|orderBy|where)\(/g)) {
        expect(callArgs(src, m.index + m[0].length - 1), `${f}: ${m[0]}`).not.toMatch(
          /\b(complaint|symptoms)\b/,
        );
      }
    }
  });
});
