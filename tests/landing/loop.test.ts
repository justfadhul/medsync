import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { Loop } from "@/components/landing/loop/loop";
import { LOOP, LOOP_LOCKED } from "@/content/loop";

/**
 * S3 "The loop" — the invariant suite from PROMPT-LANDING-S3-LOOP §3,
 * numbered as the prompt numbers them. 2 (height), 9 (reduced motion, computed)
 * and 10 (word count / CLS in a browser) run at gate time.
 *
 * Source checks always run. Rendered checks run twice: against <Loop />
 * server-rendered here (always), and against the HTML `next build` pre-renders
 * for `/` — skipped when there is no build or it predates content/ or
 * components/landing/ (as tests/landing/invariants.test.ts does).
 */

const ROOT = process.cwd();
const INDEX = resolve(ROOT, ".next/server/app/index.html");
const BUILD_ID = resolve(ROOT, ".next/BUILD_ID");
const LOOP_DIR = resolve(ROOT, "components/landing/loop");
const CONTENT = resolve(ROOT, "content/loop.ts");

const DOSE = /\b\d+(\.\d+)?\s?(mg|mcg|µg|g|IU|units?|ml|mL)\b/i;
const DOSING_WORDS = /\b(BD|TDS|OD|nocte)\b|sliding scale|titrat/i;
const HERO_STORY = ["Review booked", "3 of the last 5", "Acknowledged"];
const RED =
  /(^|\s)[\w:-]*(bg|text|border|ring|fill|stroke|outline|decoration|shadow)-(red|rose)-\d|destructive|status-critical|(^|\s)[\w:-]*alert-(bg|fg|border)/;
const AMBER = /amber-|caution/;
const GRADIENT =
  /bg-gradient-|bg-linear-|bg-radial-|bg-conic-|linear-gradient|radial-gradient|conic-gradient/;
const OFF_PALETTE = /-(plum|pink|fuchsia|rose|violet|purple)\b/;
/** teal-600 is a ring/stroke accent only: as text it fails AA (3.7:1 on white). */
const TEAL_600_TEXT = /(^|[\s:])text-(teal-600|primary)\b/;
/** Text colours under 4.5:1 on white. */
const LOW_CONTRAST_TEXT = /(^|[\s:])text-(gray-(50|[1-4]\d\d)|teal-(50|[1-5]00))\b/;
const STICKY =
  /(^|[\s:"'])sticky\b|position:\s*sticky|min-h-(screen|svh|dvh|lvh)|min-h-\[100|100(vh|svh|dvh|lvh)/;

const filesUnder = (dir: string) =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((f) => join(dir, f))
    .filter((f) => statSync(f).isFile());

const loopFiles = filesUnder(LOOP_DIR);
const sources = [CONTENT, ...loopFiles].map((f): [string, string] => [
  f.slice(ROOT.length + 1),
  readFileSync(f, "utf8"),
]);
const copy = JSON.stringify({ LOOP, LOOP_LOCKED });

// ─── Source checks (always run) ─────────────────────────────────────────────

describe("S3 loop: source", () => {
  it("1 zero client JavaScript — and the sticky scroll-story is gone", () => {
    expect(loopFiles.length).toBeGreaterThan(0);
    const hits = loopFiles.filter((f) =>
      /["']use client["']|IntersectionObserver|addEventListener\(\s*["'](scroll|wheel)|onScroll/.test(
        readFileSync(f, "utf8"),
      ),
    );
    expect(hits).toEqual([]);
    for (const old of [
      "components/landing/loop.tsx",
      "components/landing/loop-story.tsx",
      "components/landing/mocks/record-mock.tsx",
    ]) {
      expect(existsSync(resolve(ROOT, old)), old).toBe(false);
    }
  });

  it("3 no sticky layout, no full-viewport min-height", () => {
    const hits = loopFiles.filter((f) => STICKY.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("4 no overlap with the hero's alert story", () => {
    expect(HERO_STORY.filter((s) => copy.toLowerCase().includes(s.toLowerCase()))).toEqual([]);
  });

  it("5 CSO lock — the 🔒 fragments match the signed-off snapshot", () => {
    expect(LOOP_LOCKED).toMatchInlineSnapshot(`
      [
        [
          {
            "label": "Triage",
            "value": "Recorded",
          },
          {
            "label": "Record",
            "value": "Opened once",
          },
        ],
        [
          {
            "label": "Allergy check",
            "value": "No conflict",
          },
          {
            "label": "Ward stock",
            "value": "Available",
          },
          {
            "check": true,
            "label": "Order",
            "value": "Signed",
          },
        ],
        [
          {
            "check": true,
            "label": "Follow-up",
            "value": "Booked",
          },
          {
            "check": true,
            "label": "Reminders",
            "value": "App and SMS",
          },
        ],
        [
          {
            "label": "Home readings",
            "value": "On the record",
          },
          {
            "label": "Review",
            "value": "Starts from them",
          },
        ],
      ]
    `);
  });

  it("6 clinical hygiene — no dosing, no 'Dr.', the allergy check never reads 'No match'", () => {
    for (const [file, src] of sources) {
      expect(src.match(DOSE)?.[0], file).toBeUndefined();
      expect(src.match(DOSING_WORDS)?.[0], file).toBeUndefined();
    }
    expect(copy).not.toMatch(/\bDr\./);
    expect(copy).not.toMatch(/no match/i);
    const allergy = LOOP_LOCKED.flat().filter((p) => /allerg/i.test(p.label));
    expect(allergy.map((p) => p.value)).toEqual(["No conflict"]);
  });

  it("6b one fragment per step; exactly three values carry a check: Order, Follow-up, Reminders", () => {
    expect(LOOP_LOCKED).toHaveLength(LOOP.steps.length);
    const checked = LOOP_LOCKED.flat()
      .filter((p) => "check" in p && p.check)
      .map((p) => p.label);
    expect(checked).toEqual(["Order", "Follow-up", "Reminders"]);
  });

  it("7 colour — no red, amber, gradients, plum/pink, hex; no teal-600 or sub-AA text", () => {
    for (const [file, src] of sources.filter(([f]) => f.startsWith("components/"))) {
      for (const re of [RED, AMBER, GRADIENT, OFF_PALETTE, TEAL_600_TEXT, LOW_CONTRAST_TEXT]) {
        expect(src.match(re)?.[0], `${file} ${re}`).toBeUndefined();
      }
      expect(src.match(/#[0-9a-f]{3,8}\b/i)?.[0], `${file} raw hex`).toBeUndefined();
    }
  });
});

// ─── Rendered checks ────────────────────────────────────────────────────────

const describeEl = (el: Element) =>
  `<${el.tagName.toLowerCase()} class="${el.getAttribute("class") ?? ""}">`;

function renderedInvariants(section: () => Element) {
  const all = () => [section(), ...section().querySelectorAll("*")];
  const cls = (el: Element) => el.getAttribute("class") ?? "";
  const text = () => section().textContent ?? "";

  it("3 no sticky layout, no full-viewport min-height", () => {
    const hits = all().filter(
      (el) => STICKY.test(cls(el)) || STICKY.test(el.getAttribute("style") ?? ""),
    );
    expect(hits.map(describeEl)).toEqual([]);
  });

  it("4 no overlap with the hero's alert story", () => {
    expect(HERO_STORY.filter((s) => text().toLowerCase().includes(s.toLowerCase()))).toEqual([]);
  });

  it("6 clinical hygiene — no dosing, no 'Dr.', no 'No match'", () => {
    expect(text().match(DOSE)?.[0]).toBeUndefined();
    expect(text().match(DOSING_WORDS)?.[0]).toBeUndefined();
    expect(text()).not.toMatch(/\bDr\./);
    expect(text()).not.toMatch(/no match/i);
  });

  it("7 colour — no red, amber, gradients, plum/pink; step numbers teal-700", () => {
    for (const re of [RED, AMBER, GRADIENT, OFF_PALETTE, TEAL_600_TEXT, LOW_CONTRAST_TEXT]) {
      expect(
        all()
          .filter((el) => re.test(cls(el)))
          .map(describeEl),
        String(re),
      ).toEqual([]);
    }
    expect(
      all()
        .filter((el) => GRADIENT.test(el.getAttribute("style") ?? ""))
        .map(describeEl),
    ).toEqual([]);
    const nodes = [...section().querySelectorAll("[data-loop-node]")];
    expect(nodes).toHaveLength(4);
    for (const n of nodes) expect(cls(n)).toMatch(/(^|\s)text-teal-700(\s|$)/);
  });

  it("8 semantics — one <ol> of four <li> (title, sentence, fragment); drawing aria-hidden; sr-only summary", () => {
    const lists = section().querySelectorAll("ol");
    expect(lists).toHaveLength(1);
    const items = [...lists[0]!.children];
    expect(items.map((el) => el.tagName)).toEqual(["LI", "LI", "LI", "LI"]);
    items.forEach((li, i) => {
      expect(li.querySelector("h3")?.textContent).toBe(LOOP.steps[i]?.title);
      expect(li.querySelector("p")?.textContent).toBe(LOOP.steps[i]?.body);
      expect(li.querySelectorAll("dl dt")).toHaveLength(LOOP_LOCKED[i]?.length ?? -1);
    });

    const drawing = section().querySelectorAll("[data-loop-drawing]");
    expect(drawing).toHaveLength(1);
    expect(drawing[0]!.getAttribute("aria-hidden")).toBe("true");
    for (const n of section().querySelectorAll("[data-loop-node]")) {
      expect(n.getAttribute("aria-hidden")).toBe("true");
    }

    const srOnly = [...section().querySelectorAll(".sr-only")].map((el) => el.textContent);
    expect(srOnly).toContain(LOOP.summary);
    expect(section().getAttribute("aria-labelledby")).toBe("loop-title");
    expect(section().querySelector("h2#loop-title")).not.toBeNull();
  });
}

const sectionIn = (html: string) => {
  const el = new JSDOM(html).window.document.getElementById("loop");
  expect(el, "no #loop section").not.toBeNull();
  return el!;
};

let ssr: Element | undefined;
describe("S3 loop: rendered <Loop />", () => {
  renderedInvariants(() => (ssr ??= sectionIn(renderToStaticMarkup(createElement(Loop)))));
});

const newest = Math.max(
  ...[
    ...filesUnder(resolve(ROOT, "content")),
    ...filesUnder(resolve(ROOT, "components/landing")),
  ].map((f) => statSync(f).mtimeMs),
);
const fresh = existsSync(BUILD_ID) && statSync(BUILD_ID).mtimeMs >= newest;
if (!fresh) {
  console.warn(
    "tests/landing/loop: no build, or it predates content/ or components/landing/ — run `next build` first; built-page S3 checks skipped.",
  );
}

let built: Element | undefined;
describe.skipIf(!fresh)("S3 loop: rendered / (next build)", () => {
  renderedInvariants(() => {
    expect(existsSync(INDEX), `${INDEX} — did the route move?`).toBe(true);
    return (built ??= sectionIn(readFileSync(INDEX, "utf8")));
  });
});
