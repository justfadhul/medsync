import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { FOUNDERS, FOUNDERS_SECTION } from "@/content/founders";
import { GAP } from "@/content/landing";

/**
 * S7 "Founders" — the prompt's invariants (PROMPT-LANDING-S7-FOUNDERS §4),
 * numbered as it numbers them. Source checks always run; #5 reads the HTML
 * `next build` pre-renders for `/` and skips when that build is older than the
 * S7 sources. #2, #6, #7 and #11 need a browser (probed at gate time).
 */

const ROOT = process.cwd();
const DIR = "components/landing/founders";
const SOURCES = readdirSync(resolve(ROOT, DIR), { recursive: true, encoding: "utf8" })
  .map((f) => join(DIR, f))
  .filter((f) => statSync(resolve(ROOT, f)).isFile())
  .map((f) => [f, readFileSync(resolve(ROOT, f), "utf8")] as const);

const words = (s: string) => s.trim().split(/\s+/).length;
const sentences = (s: string) =>
  s
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

describe("S7 founders — source", () => {
  it("1 no off-token colour, no red", () => {
    const bad = SOURCES.flatMap(([file, src]) =>
      [
        /#[0-9a-f]{3,8}\b/i,
        /\[#/,
        /\b(pink|fuchsia|purple|rose|violet|plum)-\d/,
        /\b(bg|text|border|ring|fill|stroke|outline|decoration|shadow)-red-\d|destructive|status-critical/,
      ]
        .filter((re) => re.test(src))
        .map((re) => `${file}: ${re}`),
    );
    expect(bad).toEqual([]);
  });

  it("3 every portrait is exactly 1200 × 1500 with no metadata", async () => {
    for (const f of FOUNDERS.filter((f) => f.portrait)) {
      const file = resolve(ROOT, "public", f.portrait!.src.replace(/^\//, ""));
      expect(existsSync(file), file).toBe(true);
      const m = await sharp(file).metadata();
      expect([m.width, m.height, m.format], f.slug).toEqual([1200, 1500, "jpeg"]);
      expect([m.exif, m.xmp, m.iptc, m.icc], f.slug).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
    }
  });

  it("4 production build refuses a missing portrait; preview allows it", () => {
    const run = (env: string) =>
      spawnSync(process.execPath, ["scripts/check-founder-portraits.mjs"], {
        cwd: ROOT,
        env: { ...process.env, VERCEL_ENV: env },
        encoding: "utf8",
      });
    const missing = FOUNDERS.filter((f) => !f.portrait);
    const prod = run("production");
    expect(prod.status).toBe(missing.length > 0 ? 1 : 0);
    for (const f of missing) expect(prod.stderr).toContain(f.displayName);
    expect(run("preview").status).toBe(0);
  });

  it("8 no timers", () => {
    const timers = SOURCES.filter(([, src]) => /\bset(Interval|Timeout)\b/.test(src));
    expect(timers.map(([f]) => f)).toEqual([]);
  });

  it("9 excerpts are verbatim from the story and ≤ 45 words", () => {
    for (const f of FOUNDERS) {
      expect(
        f.story.some((p) => p.includes(f.excerpt)),
        f.slug,
      ).toBe(true);
      expect(words(f.excerpt), f.slug).toBeLessThanOrEqual(45);
    }
  });

  it("10 no sentence is shared with S2", () => {
    const s7 = [FOUNDERS_SECTION.intro, ...FOUNDERS.flatMap((f) => [f.storyTitle, f.excerpt])];
    const s2 = [GAP.title.text, GAP.quote, ...GAP.points.flatMap((p) => [p.title, p.body])];
    const shared = [
      ...s7.flatMap(sentences).filter((x) => s2.some((t) => t.includes(x))),
      ...s2.flatMap(sentences).filter((x) => s7.some((t) => t.includes(x))),
    ];
    expect(shared).toEqual([]);
  });
});

// A build older than the S7 sources renders someone else's section: skip it, don't judge it.
const HTML = resolve(ROOT, ".next/server/app/index.html");
const BUILD_ID = resolve(ROOT, ".next/BUILD_ID");
const fresh =
  existsSync(HTML) &&
  existsSync(BUILD_ID) &&
  ["content/founders.ts", ...SOURCES.map(([f]) => f)].every(
    (f) => statSync(BUILD_ID).mtimeMs >= statSync(resolve(ROOT, f)).mtimeMs,
  );
if (!fresh) {
  console.warn("tests/landing/founders: no build, or it predates S7 — rendered check skipped.");
}

describe.skipIf(!fresh)("S7 founders — rendered /", () => {
  it("5 tablist with five tabs and a panel, first founder selected", () => {
    const doc = new JSDOM(readFileSync(HTML, "utf8")).window.document;
    const section = doc.querySelector("section#about")!;
    const list = section.querySelector('[role="tablist"]');
    expect(list?.getAttribute("aria-label")).toBe(FOUNDERS_SECTION.tablistLabel);
    const tabs = [...section.querySelectorAll('[role="tab"]')];
    // Accessible name = the text outside aria-hidden (the "Photo pending" tile is hidden).
    const name = (t: Element) => {
      const c = t.cloneNode(true) as Element;
      c.querySelectorAll("[aria-hidden='true']").forEach((x) => x.remove());
      return c.textContent?.trim();
    };
    expect(tabs.map(name)).toEqual(FOUNDERS.map((f) => f.displayName));
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs.every((t) => t.querySelector("img:not([alt=''])") === null)).toBe(true);
    const panels = section.querySelectorAll('[role="tabpanel"]');
    expect(panels.length).toBeGreaterThanOrEqual(1);
    // Inactive panels stay in layout (zero shift) but inert — out of focus and the a11y tree.
    expect([...panels].filter((p) => !p.hasAttribute("inert")).length).toBe(1);
  });
});
