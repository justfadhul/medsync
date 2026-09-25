import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import * as copy from "@/content/onboarding";
import * as hospitalCopy from "@/content/onboarding-hospital";
import * as setupCopy from "@/content/onboarding-setup";
import * as staffCopy from "@/content/onboarding-staff";

/*
 * Onboarding v2 invariants (§10, Law 9, Law 13, Q11):
 *  - no copy promises an email or SMS the system does not send;
 *  - no internal words ("cadre", "affiliation", "tenant") on public v2 surfaces;
 *  - patient copy reads at grade 8 or lower (Flesch–Kincaid);
 *  - red appears only in the Emergency affordance: v2 files carry no red tokens.
 */

const ROOT = process.cwd();
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (typeof v === "function") {
    const r = (v as (...a: unknown[]) => unknown)("X", "Y");
    if (typeof r === "string") out.push(r);
  } else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
}
function files(dir: string, out: string[] = []): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(tsx?|css)$/.test(e)) out.push(p);
  }
  return out;
}

const ALL = strings([copy, staffCopy, hospitalCopy, setupCopy]);

describe("copy", () => {
  it("Q11: nothing promises an email or SMS the system doesn't send", () => {
    const promises =
      /(we'?ll|we will|you'?ll be|will be)\s+(email|text|sms|notif|message)|emailed|notify you|by email|by sms/i;
    expect(ALL.filter((s) => promises.test(s))).toEqual([]);
  });

  it("§10: public v2 copy never says cadre, affiliation or tenant", () => {
    expect(ALL.filter((s) => /\b(cadre|affiliation|tenant)s?\b/i.test(s))).toEqual([]);
  });

  it("§10: patient copy reads at grade 8 or lower (Flesch–Kincaid)", () => {
    const text = strings([
      copy.PATIENT,
      copy.CONSENT,
      copy.LOCATION,
      copy.PROFILE,
      copy.KIT,
      copy.DOCUMENTS,
    ])
      .map((s) => (/[.!?]$/.test(s.trim()) ? s : `${s}.`))
      .join(" ");
    const sentences = text.split(/[.!?]+\s/).filter((s) => /[a-z]/i.test(s)).length;
    const words = text.match(/[A-Za-z']+/g) ?? [];
    const syllables = words.reduce((n, w) => {
      const g = w
        .toLowerCase()
        .replace(/e$/, "")
        .match(/[aeiouy]+/g);
      return n + Math.max(1, g?.length ?? 1);
    }, 0);
    const grade = 0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59;
    expect(grade).toBeLessThanOrEqual(8);
  });

  it("D19: the consent summary restates the notice — three lines, nothing added", () => {
    expect(copy.CONSENT.lines).toHaveLength(3);
  });
});

describe("colour", () => {
  const V2 = [
    ...files(join(ROOT, "components/onboarding")),
    ...["patient", "clinical", "non-clinical", "hospital"].flatMap((f) =>
      files(join(ROOT, "app/signup", f, "_components")),
    ),
    ...files(join(ROOT, "app/onboarding/clinical-pending/_components")),
    ...files(join(ROOT, "app/onboarding/hospital-pending/_components")),
    ...files(join(ROOT, "app/admin/setup")),
    join(ROOT, "app/signup/_components/staff-work.tsx"),
    join(ROOT, "app/patient/profile/_components/complete-profile.tsx"),
  ];
  const RED =
    /\b(?:bg|text|border|ring|from|to|fill|stroke|outline|decoration)-(?:red|rose)-\d|destructive|#dc2626|status-critical|variant="(?:emergency|destructive|alert)"/i;

  it("Law 9: no v2 file paints red — validation is amber, the only red is the header Emergency button", () => {
    expect(V2.length).toBeGreaterThan(8);
    const offenders = V2.filter((f) => RED.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.replace(ROOT + "/", ""))).toEqual([]);
  });

  it("Law 9: completion ticks are ink, never green; no required asterisk", () => {
    for (const f of V2) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/\b(?:text|bg)-(?:green|emerald)-\d/);
      expect(src, f).not.toMatch(/>\s*\*\s*</);
    }
  });

  it("no left-edge accent bars in the kit", () => {
    for (const f of V2) expect(readFileSync(f, "utf8"), f).not.toMatch(/border-l-(?:2|4|\[)/);
  });
});
