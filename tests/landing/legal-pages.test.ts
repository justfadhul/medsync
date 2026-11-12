import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PRIVACY, TERMS } from "@/content/legal";

/** /privacy and /terms: public, Tide, a Draft until lib/legal.ts publishes them, never indexed as a draft. */
const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

describe("legal pages", () => {
  it("are public without signing in", () => {
    const exact = read("proxy.ts").match(/const PUBLIC_EXACT = new Set\(\[([^\]]*)\]\)/)?.[1] ?? "";
    expect(exact).toContain('"/privacy"');
    expect(exact).toContain('"/terms"');
  });

  it("render in the public Tide group", () => {
    for (const p of ["privacy", "terms"]) {
      expect(read(`app/${p}/layout.tsx`)).toContain('<TideScope group="public">');
    }
  });

  it("follow the publish flags for the Draft notice, robots and sitemap", () => {
    expect(read("app/privacy/page.tsx")).toContain("legalConfig.privacyPublished");
    expect(read("app/terms/page.tsx")).toContain("legalConfig.termsPublished");
    const page = read("components/legal/legal-page.tsx");
    expect(page).toMatch(/published \? null : \(/);
    expect(page).toMatch(/robots: published \? undefined : \{ index: false/);
    expect(read("app/sitemap.ts")).toMatch(/legalConfig\.privacyPublished \? \[\["\/privacy"/);
  });

  it("have no empty sections and tell people MedSync is not an emergency service", () => {
    for (const doc of [PRIVACY, TERMS]) {
      for (const s of doc.sections)
        expect(s.body.length + (s.list?.length ?? 0)).toBeGreaterThan(0);
    }
    expect(TERMS.sections[0]?.heading).toMatch(/not an emergency service/i);
  });

  it("name the processors by company (review H-7)", () => {
    const text = JSON.stringify(PRIVACY);
    for (const p of ["Supabase", "Vercel", "Africa's Talking", "Expo", "Sentry"])
      expect(text).toContain(p);
  });

  it("name the Act and the regulator, and claim no registration number", () => {
    const text = JSON.stringify(PRIVACY);
    expect(text).toContain("Data Protection and Privacy Act, 2019");
    expect(text).toContain("Personal Data Protection Office");
    expect(text).not.toMatch(/registration (no|number)/i);
  });
});
