import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { CLAIMS, STATUS_LABEL, TRUST_SECTION, trustConfig } from "@/content/trust-claims";

/**
 * S6 "Built for Uganda · Trust" — the prompt's invariants (PROMPT S6 §5),
 * numbered as it numbers them. Source checks always run; rendered checks read
 * the HTML `next build` pre-renders for `/` and skip when that build is older
 * than the S6 sources. #6 (anchor offset) and #7 (height) need a browser.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const DIR = "components/landing/trust";
const SOURCES = [
  "content/trust-claims.ts",
  ...readdirSync(resolve(ROOT, DIR), { recursive: true, encoding: "utf8" })
    .map((f) => join(DIR, f))
    .filter((f) => statSync(resolve(ROOT, f)).isFile()),
];

const TEST_PATH = /tests\/[\w./-]+\.test\.ts/g;
const HAS_TEST = /\b(?:it|test)(?:\.each)?\(/;
const DISABLED = /\.(skip|todo|only)\(/;
const BANNED_UNBUILT = /\b(ready|live|today|now)\b/i;
/** Case-insensitive words, plus ISO and SOC as whole uppercase words. */
const overclaim = (s: string) =>
  s.match(/compliant|compliance with|certified|HIPAA/i)?.[0] ?? s.match(/\b(ISO|SOC)\b/)?.[0];
const OFF_TOKEN =
  /#[0-9a-f]{3,8}\b|\[#|\b(red|rose|pink|fuchsia|purple|violet|plum|green|emerald|amber|yellow|orange)-\d{2,3}\b|destructive|status-(critical|caution|stable)/;
const TESTS_RUN = /\bnpm (run )?test\b|\bvitest\b/;
const DEPLOYS = /vercel (deploy|--prod)|vercel\s[^\n]*--prod/;

describe("source: the claims ledger", () => {
  it("1 earned status — every built claim names a real, enabled test file", () => {
    for (const c of CLAIMS.filter((c) => c.status === "built")) {
      expect(c.evidence, `${c.id} is built without evidence`).toBeDefined();
      const files = [c.evidence!.testFile, ...(c.evidence!.note.match(TEST_PATH) ?? [])];
      for (const f of files) {
        expect(existsSync(resolve(ROOT, f)), `${c.id}: ${f} does not exist`).toBe(true);
        const src = read(f);
        expect(src, `${c.id}: ${f} has no test`).toMatch(HAS_TEST);
        expect(src.match(DISABLED)?.[0], `${c.id}: ${f} disables a test`).toBeUndefined();
        // `.skipIf(` is conditional gating on a live test database, not a disabled
        // test — allowed, but the evidence must say so rather than imply CI proves it.
        if (/\.skipIf\(/.test(src)) {
          expect(c.evidence!.note, `${c.id}: ${f} is DB-gated`).toMatch(/live test database/i);
        }
      }
    }
  });

  it("3 no unbuilt claim says ready, live, today or now", () => {
    const hits = CLAIMS.filter((c) => c.status !== "built").flatMap((c) =>
      [c.title, c.description].filter((s) => BANNED_UNBUILT.test(s)).map((s) => `${c.id}: ${s}`),
    );
    expect(hits).toEqual([]);
  });

  it("4 the callout names the Act, and no string claims compliance or a certificate", () => {
    expect(TRUST_SECTION.callout.statement).toContain("Data Protection and Privacy Act 2019");
    const strings = JSON.stringify({
      TRUST_SECTION,
      copy: CLAIMS.map((c) => [c.title, c.description]),
    });
    expect(overclaim(strings)).toBeUndefined();
  });

  it("5 tokens only — no raw colour and no clinical red, green or amber in the S6 sources", () => {
    const hits = SOURCES.flatMap((f) => {
      const m = read(f).match(OFF_TOKEN);
      return m ? [`${f}: ${m[0]}`] : [];
    });
    expect(hits).toEqual([]);
  });

  it("9 the 'Tested on every release' flag stays off unless a workflow tests before it deploys", () => {
    const dir = resolve(ROOT, ".github/workflows");
    const gating = readdirSync(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .some((src) => {
        const t = src.search(TESTS_RUN);
        const d = src.search(DEPLOYS);
        return t >= 0 && d > t;
      });
    expect(trustConfig.ciGatesDeploy && !gating).toBe(false);
  });
});

// ─── Rendered (the pre-rendered `/`) ────────────────────────────────────────

const BUILD_ID = resolve(ROOT, ".next/BUILD_ID");
const INDEX = resolve(ROOT, ".next/server/app/index.html");
const fresh =
  existsSync(BUILD_ID) &&
  SOURCES.every((f) => statSync(BUILD_ID).mtimeMs >= statSync(resolve(ROOT, f)).mtimeMs);
if (!fresh) {
  console.warn(
    "tests/landing/trust: no build, or it predates the S6 sources — run `next build`; rendered checks skipped.",
  );
}

describe.skipIf(!fresh)("rendered: #trust on /", () => {
  const section = () => {
    const doc = new JSDOM(readFileSync(INDEX, "utf8")).window.document;
    const s = doc.getElementById("trust");
    expect(s, "no #trust").not.toBeNull();
    return s!;
  };

  it("2 every claim shows its status as text; the glyph is aria-hidden", () => {
    const s = section();
    const rows = [...s.querySelectorAll("li[data-claim]")];
    expect(rows.map((li) => li.getAttribute("data-claim"))).toEqual(CLAIMS.map((c) => c.id));
    for (const c of CLAIMS) {
      const li = s.querySelector(`li[data-claim="${c.id}"]`)!;
      expect(li.textContent, c.id).toContain(STATUS_LABEL[c.status]);
      const glyph = li.querySelector("svg[data-status-glyph]");
      expect(glyph?.getAttribute("aria-hidden"), c.id).toBe("true");
    }
  });

  it("4 the section names the Act and claims no compliance or certificate", () => {
    const text = section().textContent ?? "";
    expect(text).toContain("Data Protection and Privacy Act 2019");
    expect(overclaim(text)).toBeUndefined();
  });

  it("8 group labels are h3 after the section's h2; claims are list items", () => {
    const s = section();
    const h2 = s.querySelector("h2#trust-title");
    expect(h2).not.toBeNull();
    const h3s = [...s.querySelectorAll("h3")];
    for (const label of Object.values(TRUST_SECTION.groups)) {
      const h3 = h3s.find((h) => h.textContent?.trim() === label);
      expect(h3, label).toBeDefined();
      expect(h2!.compareDocumentPosition(h3!) & 4, `${label} precedes the h2`).toBe(4);
    }
    for (const row of s.querySelectorAll("[data-claim]")) expect(row.tagName).toBe("LI");
  });

  it("9 the release caption renders only while the flag is on", () => {
    expect((section().textContent ?? "").includes(TRUST_SECTION.testedCaption)).toBe(
      trustConfig.ciGatesDeploy,
    );
  });
});
