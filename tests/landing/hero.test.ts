import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { HERO, HERO_LOCKED } from "@/content/hero";

/**
 * S1 Hero — the invariant suite from PROMPT-LANDING-S1-HERO §4, numbered as
 * the prompt numbers them. 2 (fold), 3 (LCP), 4-computed (reduced motion in a
 * browser), 7 (axe) and 10 (CLS) need a real browser and run at gate time.
 *
 * Source checks always run. Rendered checks read the HTML `next build`
 * pre-renders for `/` and skip when there is no build or it predates the hero
 * (as tests/landing/invariants.test.ts does).
 */

const ROOT = process.cwd();
const INDEX = resolve(ROOT, ".next/server/app/index.html");
const BUILD_ID = resolve(ROOT, ".next/BUILD_ID");
const HERO_DIR = resolve(ROOT, "components/landing/hero");
const CONTENT = resolve(ROOT, "content/hero.ts");

const DOSE = /\b\d+(\.\d+)?\s?(mg|mcg|µg|g|IU|units?|ml|mL)\b/i;
const DOSING_WORDS = /\b(BD|TDS|OD|nocte)\b|sliding scale|titrat/i;
const PROMISES = [
  "2 a.m.",
  "24/7",
  "instantly",
  "immediately",
  "real time",
  "real-time",
  "always",
  "never miss",
];
const RED =
  /(^|\s)[\w:-]*(bg|text|border|ring|fill|stroke|outline|decoration|shadow)-(red|rose)-\d|destructive|status-critical/;
const GRADIENT =
  /bg-gradient-|bg-linear-|bg-radial-|bg-conic-|linear-gradient|radial-gradient|conic-gradient/;
const OFF_PALETTE = /-(plum|pink|fuchsia|rose|violet|purple)\b/;
const AMBER = /amber-|status-caution/;

const heroFiles = readdirSync(HERO_DIR, { recursive: true, encoding: "utf8" })
  .map((f) => join(HERO_DIR, f))
  .filter((f) => statSync(f).isFile());

const promisesIn = (text: string) => PROMISES.filter((p) => text.toLowerCase().includes(p));

/** Every `animation` / `animation-name` declaration not nested in a no-preference motion query. */
function ungatedAnimations(css: string): { total: number; ungated: string[] } {
  const stack: string[] = [];
  const ungated: string[] = [];
  let total = 0;
  let buf = "";
  const check = () => {
    const decl = buf.trim();
    if (/^animation(-name)?\s*:/.test(decl)) {
      total++;
      if (!stack.some((p) => /prefers-reduced-motion\s*:\s*no-preference/.test(p)))
        ungated.push(decl);
    }
    buf = "";
  };
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (ch === "{") {
      stack.push(buf.trim());
      buf = "";
    } else if (ch === "}") {
      check();
      stack.pop();
    } else if (ch === ";") check();
    else buf += ch;
  }
  return { total, ungated };
}

// ─── Source checks (always run) ─────────────────────────────────────────────

describe("S1 hero: source", () => {
  it("1 zero client JavaScript — no 'use client' under components/landing/hero/", () => {
    expect(heroFiles.length).toBeGreaterThan(0);
    const hits = heroFiles.filter((f) => /["']use client["']/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("4 reduced motion — every animation sits inside prefers-reduced-motion: no-preference", () => {
    const css = readFileSync(join(HERO_DIR, "hero.module.css"), "utf8");
    const { total, ungated } = ungatedAnimations(css);
    expect(total).toBeGreaterThan(0);
    expect(ungated).toEqual([]);
  });

  it("5 no promises of speed or availability — content/hero.ts", () => {
    expect(promisesIn(JSON.stringify({ HERO, HERO_LOCKED }))).toEqual([]);
  });

  it("9 clinical hygiene — no dosing, no 'Dr.' in the hero's copy", () => {
    const src = readFileSync(CONTENT, "utf8");
    expect(src.match(DOSE)?.[0]).toBeUndefined();
    expect(src.match(DOSING_WORDS)?.[0]).toBeUndefined();
    expect(JSON.stringify({ HERO, HERO_LOCKED })).not.toMatch(/\bDr\./);
  });

  it("8 CSO lock — the 🔒 strings match the signed-off snapshot", () => {
    expect(HERO_LOCKED).toMatchInlineSnapshot(`
      {
        "hospital": {
          "acknowledged": "Acknowledged by the on-call doctor · 07:40",
          "booked": "Review booked · today 14:00",
          "label": "At the hospital · Care team",
          "patient": "Amina N. · home readings",
          "pattern": "3 of the last 5 fasting readings above target",
        },
        "phone": {
          "flag": "Above target",
          "reading": "Fasting glucose",
          "time": "06:12",
          "unit": "mmol/L",
          "value": "14.2",
        },
        "reply": {
          "detail": "Review booked today at 14:00.",
          "lead": "Your care team saw your readings.",
        },
      }
    `);
  });
});

// ─── Rendered checks (need a build newer than the hero) ─────────────────────

const newest = Math.max(...[CONTENT, ...heroFiles].map((f) => statSync(f).mtimeMs));
const fresh = existsSync(BUILD_ID) && statSync(BUILD_ID).mtimeMs >= newest;
if (!fresh) {
  console.warn(
    "tests/landing/hero: no build, or it predates the hero — run `next build` first; rendered hero checks skipped.",
  );
}

let doc: Document | undefined;
function top(): HTMLElement {
  expect(existsSync(INDEX), `${INDEX} — did the route move?`).toBe(true);
  doc ??= new JSDOM(readFileSync(INDEX, "utf8")).window.document;
  const el = doc.getElementById("top");
  expect(el, "no #top section").not.toBeNull();
  return el!;
}

const describeEl = (el: Element) =>
  `<${el.tagName.toLowerCase()} class="${el.getAttribute("class") ?? ""}">`;

describe.skipIf(!fresh)("S1 hero: rendered /", () => {
  it("5 no promises of speed or availability", () => {
    expect(promisesIn(top().textContent ?? "")).toEqual([]);
  });

  it("6 colour — no red, no gradients, no plum/pink; amber only on the above-target signal", () => {
    const els = [top(), ...top().querySelectorAll("*")];
    const cls = (el: Element) => el.getAttribute("class") ?? "";
    const style = (el: Element) => el.getAttribute("style") ?? "";

    const red = els.filter(
      (el) => RED.test(cls(el)) || /\bred\b|#dc2626|destructive|status-critical/i.test(style(el)),
    );
    expect(red.map(describeEl)).toEqual([]);

    const gradients = els.filter((el) => GRADIENT.test(cls(el)) || GRADIENT.test(style(el)));
    expect(gradients.map(describeEl)).toEqual([]);

    const offPalette = els.filter((el) => OFF_PALETTE.test(cls(el)));
    expect(offPalette.map(describeEl)).toEqual([]);

    const amber = els.filter((el) => AMBER.test(cls(el)));
    expect(amber.length, "the above-target signal is missing").toBeGreaterThan(0);
    const stray = amber.filter((el) => !el.closest('[data-signal="above-target"]'));
    expect(stray.map(describeEl)).toEqual([]);
  });

  it("9 clinical hygiene — no dosing, no 'Dr.' in the figure, exactly one h1", () => {
    const text = top().textContent ?? "";
    expect(text.match(DOSE)?.[0]).toBeUndefined();
    expect(text.match(DOSING_WORDS)?.[0]).toBeUndefined();

    const figure = top().querySelector('figure[data-testid="mock-loop-card"]');
    expect(figure, "no hero figure").not.toBeNull();
    expect(figure!.textContent).not.toMatch(/\bDr\./);

    expect(doc!.querySelectorAll("h1")).toHaveLength(1);
    expect(top().querySelector("h1")?.id).toBe("top-title");
  });
});
