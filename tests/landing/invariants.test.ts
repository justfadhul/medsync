import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { HERO_LOCKED } from "@/content/hero";
import { PATIENTS, PHONE_MOCK, WARD_MOCK } from "@/content/landing";
import { LOOP_LOCKED } from "@/content/loop";

/**
 * Landing v4 "Slim" — the brief's invariant suite (PROMPT-LANDING-v4-SLIM),
 * numbered as the brief numbers them.
 *
 * Two halves:
 *   - source checks over content/landing.ts and components/landing/mocks/ —
 *     always run, no build needed;
 *   - rendered checks over the HTML `next build` pre-renders for `/` and
 *     `/about` (.next/server/app/{index,about}.html), as tests/a11y does.
 *     Without a build, or with one older than the copy deck, they skip and say
 *     so — CI builds before it tests. A build with a page missing FAILS: a
 *     moved route is not a reason to skip.
 *
 * #5 (red is emergency-only) and #6 (Emergency persists) are static proxies:
 * the computed-style and scroll-position probes run in a browser at gate time.
 */

const ROOT = process.cwd();
const APP = resolve(ROOT, ".next/server/app");
const BUILD_ID = resolve(ROOT, ".next/BUILD_ID");
const MOCKS = resolve(ROOT, "components/landing/mocks");
const CANONICAL_ORIGIN = "https://medsync.health";

// Units are case-sensitive on purpose: "4G network" is not a dose.
const DOSE = /\b\d+(\.\d+)?\s?(mg|mcg|µg|g|IU|units?|ml|mL)\b/;
const DOSING_ABBR = /\b(BD|TDS|QDS|OD|PRN)\b|\bq\d+h\b/;
const DOSING_WORDS =
  /\b(nocte|mane)\b|\b(once|twice|three times)\s+(a\s+)?(day|daily)\b|\bevery\s+\d+\s+hours?\b|\btablets?\b|sliding scale|titrat/i;
/** Drug names: never in mocks or on `/` (a founder's own story on /about may name one — listed for the owner). */
const DRUGS =
  /\b(amlodipine|metformin|insulin|glibenclamide|bisoprolol|lisinopril|atorvastatin|furosemide|salbutamol)\b/i;
const INSTITUTIONS =
  /\b(Mulago|Mengo|Nsambya|Lubaga|IHK|MBN|Lancet|UAP|Jubilee|Liberty|NMS|JMS|NIRA)\b/;
const STALE =
  /Attio|supabase|\.sql\b|\blib\/|\.ts\b|last-write-wins|conflict-free|Open beta|active immediately|never logging into silence|Designed to comply with|compliance with the Uganda Data/i;
const RED =
  /(?:^|[\s:])!?(?:bg|text|border|ring|fill|stroke|outline|decoration|shadow|from|via|to|divide|accent|caret)-(?:red|rose)-\d|\[#(?:dc2626|ef4444|b91c1c)\]|destructive|status-critical|alert-(?:bg|fg|border)/i;
/** A class token that hides its element at some breakpoint (`hidden`, `md:hidden`, …). */
const HIDES = /(^|:)(hidden|invisible|sr-only|opacity-0|size-0|scale-0|collapse)$/;
const EMERGENCY_LINK = 'a[data-emergency][href="/emergency"]';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Body text a sighted reader sees: no script/style/hidden/sr-only, one space between text nodes. */
function visibleText(doc: Document): string {
  const body = doc.body.cloneNode(true) as HTMLElement;
  body
    .querySelectorAll("script, style, noscript, template, [hidden], [inert], .sr-only")
    .forEach((el) => el.remove());
  const walker = doc.createTreeWalker(body, doc.defaultView!.NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) parts.push(walker.currentNode.nodeValue ?? "");
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Text that reaches people through attributes: aria-label, alt, title, and every <meta content>. */
function attrText(doc: Document): string {
  const values: string[] = [];
  doc.querySelectorAll("[aria-label], [alt], [title]").forEach((el) => {
    for (const name of ["aria-label", "alt", "title"]) values.push(el.getAttribute(name) ?? "");
  });
  doc
    .querySelectorAll("meta[content]")
    .forEach((el) => values.push(el.getAttribute("content") ?? ""));
  return values.join(" ");
}

const classTokens = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
const describeEl = (el: Element) =>
  `<${el.tagName.toLowerCase()} class="${el.getAttribute("class") ?? ""}">`;

/** Every <x class> on the path from `el` up to (not including) <body> that hides it. */
function hidingAncestors(el: Element): string[] {
  const found: string[] = [];
  for (let at: Element | null = el; at && at.tagName !== "BODY"; at = at.parentElement) {
    if (
      at.hasAttribute("hidden") ||
      at.hasAttribute("inert") ||
      at.getAttribute("aria-hidden") === "true" ||
      classTokens(at).some((t) => HIDES.test(t))
    )
      found.push(describeEl(at));
  }
  return found;
}

const walk = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, encoding: "utf8" })
        .map((f) => join(dir, f))
        .filter((f) => statSync(f).isFile())
    : [];

/** Everything that renders mock or public copy on `/` (founders' stories excepted). */
function sourceFiles(): Array<[string, string]> {
  const files = [
    ...["landing.ts", "hero.ts", "loop.ts", "trust-claims.ts"].map((f) => join(ROOT, "content", f)),
    ...walk(MOCKS),
    ...walk(join(ROOT, "components/landing/hero")),
    ...walk(join(ROOT, "components/landing/loop")),
    join(ROOT, "app/opengraph-image.tsx"),
    join(ROOT, "components/landing/_my-health-mock.tsx"), // public via /styleguide
  ].filter((f) => existsSync(f));
  return files.map((f) => [f.slice(ROOT.length + 1), readFileSync(f, "utf8")]);
}

// A build older than any landing source renders someone else's page: skip it
// locally, don't judge it — and never in CI, which builds right before testing.
const SOURCES = [
  ...walk(join(ROOT, "content")),
  ...walk(join(ROOT, "components/landing")),
  ...walk(join(ROOT, "app/about")),
  join(ROOT, "app/page.tsx"),
  join(ROOT, "app/layout.tsx"),
];
const newestSource = Math.max(...SOURCES.map((f) => statSync(f).mtimeMs));
const fresh = existsSync(BUILD_ID) && statSync(BUILD_ID).mtimeMs >= newestSource;
if (!fresh) {
  if (process.env.CI) throw new Error("tests/landing: the build is missing or stale in CI");
  console.warn(
    `tests/landing: no build at ${APP}, or it predates a landing source — run \`next build\` first; rendered invariants skipped.`,
  );
}

const cache = new Map<string, Document>();
/** The pre-rendered page, parsed once. A missing file fails the test that asked. */
function page(name: "index" | "about"): Document {
  const file = resolve(APP, `${name}.html`);
  expect(existsSync(file), `${file} — did the route move?`).toBe(true);
  if (!cache.has(name)) cache.set(name, new JSDOM(readFileSync(file, "utf8")).window.document);
  return cache.get(name)!;
}

// ─── Source checks (always run) ─────────────────────────────────────────────

describe("source: the copy deck and the mocks", () => {
  it("1 no dosing — content/landing.ts and components/landing/mocks/", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(1);
    const hits = files.flatMap(([file, src]) =>
      [
        src.match(DOSE)?.[0],
        src.match(DOSING_ABBR)?.[0],
        src.match(DOSING_WORDS)?.[0],
        src.match(DRUGS)?.[0],
      ]
        .filter(Boolean)
        .map((m) => `${file}: "${m}"`),
    );
    expect(hits).toEqual([]);
  });

  it("2 no named clinicians in mocks — mock files and mock strings", () => {
    const hits = sourceFiles()
      .filter(([file, src]) => file.startsWith("components/") && src.includes("Dr."))
      .map(([file]) => file);
    for (const [name, strings] of Object.entries({
      HERO_LOCKED,
      LOOP_LOCKED,
      PHONE_MOCK,
      WARD_MOCK,
    })) {
      if (JSON.stringify(strings).includes("Dr.")) hits.push(`content/landing.ts ${name}`);
    }
    expect(hits).toEqual([]);
  });
});

// ─── Rendered checks shared by / and /about ─────────────────────────────────

function sharedInvariants(name: "index" | "about") {
  it("1 no dosing", () => {
    const text = `${visibleText(page(name))} ${attrText(page(name))}`;
    expect(text.match(DOSE)?.[0]).toBeUndefined();
    expect(text.match(DOSING_ABBR)?.[0]).toBeUndefined();
    expect(text.match(DOSING_WORDS)?.[0]).toBeUndefined();
  });

  it("og:image and og:url", () => {
    const doc = page(name);
    const og = (p: string) =>
      doc.querySelector(`meta[property="og:${p}"]`)?.getAttribute("content");
    expect(og("image"), "no og:image").toBeTruthy();
    expect(new URL(og("url")!).href).toBe(
      `${CANONICAL_ORIGIN}${name === "index" ? "/" : "/about"}`,
    );
  });

  it("4 no internal or stale strings", () => {
    const text = `${visibleText(page(name))} ${attrText(page(name))}`;
    expect(text.match(STALE)?.[0]).toBeUndefined();
  });

  it("5 red is emergency-only", () => {
    const doc = page(name);
    const offenders = [...doc.querySelectorAll("[class]")]
      .filter((el) => RED.test(el.getAttribute("class") ?? "") && !el.closest("[data-emergency]"))
      .map(describeEl);
    expect(offenders).toEqual([]);
    expect(doc.querySelector(EMERGENCY_LINK)).not.toBeNull();
  });

  it("6 Emergency persists — one, in the sticky header, never hidden", () => {
    const doc = page(name);
    const header = doc.body.querySelector("header");
    expect(header, "no <header>").not.toBeNull();
    const tokens = classTokens(header!);
    expect(
      tokens.some((t) => t === "sticky" || t === "fixed"),
      describeEl(header!),
    ).toBe(true);
    // …and no breakpoint un-sticks it (e.g. "md:static").
    expect(tokens.filter((t) => /(^|:)(static|relative)$/.test(t))).toEqual([]);

    const links = [...header!.querySelectorAll(EMERGENCY_LINK)];
    expect(links.length, "no Emergency link in the header").toBeGreaterThan(0);
    // At least one header Emergency link is shown at every breakpoint.
    const hidden = links.map(hidingAncestors);
    expect(
      hidden.some((h) => h.length === 0),
      `every header Emergency link is hidden somewhere:\n${hidden.flat().join("\n")}`,
    ).toBe(true);

    // One Emergency per page (S8): the header's, never a second one in the footer.
    expect(doc.querySelectorAll(EMERGENCY_LINK)).toHaveLength(1);
    expect(doc.querySelector("footer [data-emergency]"), "Emergency in the footer").toBeNull();
  });

  it("one h1 and no heading-level skips", () => {
    const levels = [...page(name).querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) =>
      Number(h.tagName[1]),
    );
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    const skips = levels.flatMap((l, i) => {
      const prev = levels[i - 1] ?? 0;
      return l > prev + 1 ? [`h${prev} → h${l} (heading ${i + 1})`] : [];
    });
    expect(skips).toEqual([]);
  });
}

// ─── / ──────────────────────────────────────────────────────────────────────

describe.skipIf(!fresh)("rendered: /", () => {
  sharedInvariants("index");

  it("2 no named clinicians in mocks", () => {
    const doc = page("index");
    const mocks = [...doc.querySelectorAll('[data-testid^="mock-"]')];
    expect(mocks.length).toBeGreaterThan(0);
    for (const mock of mocks) {
      const labels = [mock, ...mock.querySelectorAll("[aria-label]")].map(
        (el) => el.getAttribute("aria-label") ?? "",
      );
      expect(
        `${mock.textContent} ${labels.join(" ")}`,
        mock.getAttribute("data-testid")!,
      ).not.toMatch(/\bDr\.?\s/);
    }
    // A "Dr." anywhere else on the page belongs to the founders' own words: S2 or S7.
    const stray = [...doc.body.querySelectorAll("*")]
      .filter((el) => !el.closest("script, style, template"))
      .filter((el) =>
        [...el.childNodes].some(
          (n) => n.nodeType === n.TEXT_NODE && (n.nodeValue ?? "").includes("Dr."),
        ),
      )
      .filter((el) => !el.closest("#gap, #about"))
      .map((el) => `${describeEl(el)} ${el.textContent?.slice(0, 80)}`);
    expect(stray).toEqual([]);
  });

  it("3 no named institutions (and no drug names)", () => {
    const doc = page("index");
    const text = `${visibleText(doc)} ${attrText(doc)}`;
    expect(text.match(INSTITUTIONS)?.[0]).toBeUndefined();
    expect(text.match(DRUGS)?.[0]).toBeUndefined();
  });

  it("the S4 honesty line is on the page, and each mock has one above-target signal", () => {
    expect(visibleText(page("index"))).toContain(PATIENTS.honesty);
    expect(WARD_MOCK.rows.filter((r) => r.chip.tone === "caution")).toHaveLength(1);
  });

  it("7 every mock renders once", () => {
    const ids = [...page("index").querySelectorAll("[data-testid]")].map(
      (el) => el.getAttribute("data-testid")!,
    );
    for (const id of ["mock-loop-card", "mock-phone", "mock-ward-dashboard"]) {
      expect(
        ids.filter((x) => x === id),
        id,
      ).toHaveLength(1);
    }
    expect(
      ids.filter((id, i) => ids.indexOf(id) !== i),
      "repeated data-testid",
    ).toEqual([]);
  });

  it("8 exactly 8 sections, in order", () => {
    const ids = [...page("index").querySelectorAll("section")].map((s) => s.id);
    expect(ids).toEqual(["top", "gap", "loop", "patients", "hospitals", "trust", "about", "faq"]);
  });

  it("9 word budget ≤ 1,300", () => {
    const words = visibleText(page("index"))
      .split(" ")
      .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    console.warn(`tests/landing: / has ${words} visible words`);
    expect(words).toBeLessThanOrEqual(1300);
  });

  it("10 canonical", () => {
    const doc = page("index");
    const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute("href");
    expect(canonical, "no canonical").toBeTruthy();
    expect(new URL(canonical!).href).toBe(`${CANONICAL_ORIGIN}/`);
    const ogUrl = doc.querySelector('meta[property="og:url"]')?.getAttribute("content");
    expect(ogUrl, "no og:url").toBeTruthy();
    expect(new URL(ogUrl!).origin).toBe(CANONICAL_ORIGIN);
  });
});

// ─── /about ─────────────────────────────────────────────────────────────────

describe.skipIf(!fresh)("rendered: /about", () => {
  sharedInvariants("about");

  it("10 canonical", () => {
    const canonical = page("about").querySelector('link[rel="canonical"]')?.getAttribute("href");
    expect(canonical, "no canonical").toBeTruthy();
    expect(new URL(canonical!).href).toBe(`${CANONICAL_ORIGIN}/about`);
  });
});
