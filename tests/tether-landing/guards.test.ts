import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { EXAMPLE, TICKET } from "@/content/tether-landing/copy";
import { landingTetherOn } from "@/lib/landing/feature";

/**
 * The Tether landing page's guards (PROMPT-LANDING-TETHER Appendix B, laws LP1–LP10) as source scans over the
 * page, its components and its copy. Rendered checks (the Help crawl at three widths, axe, the auto-motion stop)
 * run in scripts/landing/scenarios.mjs. The gallery is a harness, so its labels are not visitor copy.
 */
const ROOT = process.cwd();
const DIRS = ["components/landing/tether", "app/tether", "content/tether-landing"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(n) ? [relative(ROOT, p)] : [];
  });
}
const FILES = DIRS.flatMap((d) => walk(join(ROOT, d)));
/** The page's UI; the server action (app/tether/actions.ts) writes the store and is checked in clinic-leads.test.ts. */
const UI = FILES.filter((f) => !f.startsWith("content/") && !f.endsWith("/actions.ts"));
const COPY = FILES.filter((f) => f.startsWith("content/"));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
/** Code without comments, so a rule's own explanation never trips it. */
const code = (f: string) =>
  read(f)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
/** Every string literal in a copy file (comments dropped). */
const strings = (f: string) =>
  [...code(f).matchAll(/"((?:[^"\\]|\\.)*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2]);

/** Files that may paint red (LP4): Help, the Help dialog, and later the emergency headline line and answer. */
const RED_ALLOWED = [
  "components/landing/tether/chrome.tsx",
  "components/landing/tether/hero.tsx",
  "components/landing/tether/questions.tsx",
];

describe("Tether landing guards", () => {
  it("scans something", () => {
    expect(UI.length).toBeGreaterThan(2);
    expect(COPY.length).toBeGreaterThan(2);
  });

  it("raw colour: no hex, rgb, hsl or named colour; no font family outside the tokens (LP10)", () => {
    for (const f of FILES) {
      const m =
        /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch)\(|\b(?:bg|text|ring|border|fill|stroke)-(?:red|amber|green|blue|slate|gray|white|black)\b|font-\[|fontFamily|font-family/.exec(
          code(f),
        );
      expect(m, `${f}: ${m?.[0]}`).toBeNull();
    }
  });

  it("red is reserved (LP4)", () => {
    for (const f of UI.filter((f) => !RED_ALLOWED.includes(f))) {
      expect(code(f), f).not.toMatch(/pw-emergency|pw-critical|"danger"|destructive/);
    }
  });

  it("no green or amber on the page (LP5)", () => {
    for (const f of UI)
      expect(code(f), f).not.toMatch(/pw-stable|pw-caution|status-(stable|caution)|StatusPill/);
  });

  it("no left-edge accent bars", () => {
    for (const f of UI) expect(code(f), f).not.toMatch(/border-l-(?:\[|\d|pw|accent)|border-left/);
  });

  it("no dose, no queue number, no invented claim in any string (LP3, LP6, LP9)", () => {
    for (const f of COPY)
      for (const s of strings(f)) {
        expect(s, f).not.toMatch(/\b\d+(\.\d+)?\s?(mg|mcg|µg|g|IU|units?|mL|ml)\b/);
        expect(s, f).not.toMatch(/\b\d+\s?(tablets?|tabs?|capsules?|puffs?|drops?)\b/i);
        expect(s, f).not.toMatch(/\bposition\b|ahead of you|in line\s*(no\.?\s*)?\d|#\d+/i);
        expect(s, f).not.toMatch(/\d[\d,.]*\s*(\+\s*)?(patients|clinics|users|%|★)/i);
      }
  });

  it("every example says so (LP1) and no real name ships without consent (LP2)", () => {
    expect(TICKET.frontName("Thursday at 10:40")).toMatch(/^Example /);
    expect(TICKET.modeName).toMatch(/^Example /);
    expect(EXAMPLE.doctors).toHaveLength(0);
    for (const f of UI) expect(code(f), f).not.toMatch(/@\/lib\/supabase|from "@supabase/);
  });

  it("components hold no visitor text (LP8): JSX text comes from content/tether-landing", () => {
    for (const f of UI.filter((f) => f.endsWith(".tsx") && !f.startsWith("app/tether/gallery/"))) {
      const m = />\s*([A-Za-z][^<>{}();=:]*[A-Za-z])\s*</.exec(code(f));
      expect(m, `${f}: ${m?.[1]}`).toBeNull();
    }
  });
});

describe("LANDING_TETHER", () => {
  it("is off unless set to 1", () => {
    expect(landingTetherOn(undefined, undefined)).toBe(false);
    expect(landingTetherOn("0", "preview")).toBe(false);
    expect(landingTetherOn("1", "preview")).toBe(true);
  });
  it("stays off in production while the copy is draft", () => {
    expect(landingTetherOn("1", "production")).toBe(false);
  });
});
