import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FAQ } from "@/content/landing";
import { CLAIMS } from "@/content/trust-claims";
import { legalConfig, signupsClosedHere, signupsOpen, signupsOwnerOverride } from "@/lib/legal";

/**
 * Landing v4 S8 (PROMPT-LANDING-S8 §6) — the FAQ, the closing band, the footer
 * and the production sign-up guard. Source checks always run; rendered checks
 * read the prerendered `/` like tests/landing/invariants.test.ts and skip when
 * the build is older than the landing sources (CI builds first). #7 (band
 * contrast) and #11 (rhythm) need a browser — probed at gate time.
 */

const ROOT = process.cwd();
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const INDEX = resolve(ROOT, ".next/server/app/index.html");
const BUILD_ID = resolve(ROOT, ".next/BUILD_ID");
const SOURCES = [
  "components/landing/faq.tsx",
  "components/landing/site-footer.tsx",
  "content/landing.ts",
  "lib/legal.ts",
];
const fresh =
  existsSync(BUILD_ID) &&
  SOURCES.every((f) => statSync(BUILD_ID).mtimeMs >= statSync(join(ROOT, f)).mtimeMs);
const page = () => new JSDOM(readFileSync(INDEX, "utf8")).window.document;

describe("source", () => {
  it('1 native FAQ: <details name="faq"> + <summary>, no client JavaScript', () => {
    const src = read("components/landing/faq.tsx");
    expect(src).toMatch(/<details[^>]*name="faq"/);
    expect(src).toContain("<summary");
    expect(src).not.toMatch(/["']use client["']/);
  });

  it("2 the security answer can only name built claims (and there is at least one)", () => {
    expect(CLAIMS.filter((c) => c.status === "built").length).toBeGreaterThan(0);
    expect(read("components/landing/faq.tsx")).toMatch(/status === "built"/);
  });

  it("3 the live answer has both variants and neither promises open registration while closed", () => {
    expect(FAQ.live.closed).toMatch(/Registration opens once our privacy notice is published/);
    expect(FAQ.live.open).toMatch(/register now/);
    expect(signupsOpen).toBe(
      signupsOwnerOverride || (legalConfig.privacyPublished && legalConfig.pdpoRegistered),
    );
  });

  // S8 #5 asked for light-only; the owner kept dark mode and the switch (2026-09-23).
  it("5 the landing carries the floating theme switch", () => {
    expect(read("components/landing/site-footer.tsx")).toContain("<ThemeToggle");
  });

  it("8 no dead legal links: Privacy/Terms are plain text until both pages exist", () => {
    const published = legalConfig.privacyPublished && legalConfig.termsPublished;
    for (const route of ["privacy", "terms"]) {
      const exists = existsSync(join(ROOT, "app", route, "page.tsx"));
      if (published) expect(exists, `/${route} is published but has no page`).toBe(true);
    }
  });

  describe("9 production sign-up guard", () => {
    afterEach(() => vi.unstubAllEnvs());
    it("closes /signup/* in production while signups are closed, and only there", () => {
      vi.stubEnv("VERCEL_ENV", "production");
      expect(signupsClosedHere()).toBe(!signupsOpen);
      vi.stubEnv("VERCEL_ENV", "preview");
      expect(signupsClosedHere()).toBe(false);
    });
    it("the signup layout swaps the form for the holding page, and every submit action refuses", () => {
      expect(read("app/signup/layout.tsx")).toMatch(
        /signupsClosedHere\(\)\s*\?\s*\(\s*<SignupUnavailable/,
      );
      for (const door of ["patient", "clinical", "non-clinical", "hospital"]) {
        const src = read(`app/signup/${door}/actions.ts`);
        const submits = src.match(/export async function submit\w+/g) ?? [];
        expect(submits.length, door).toBeGreaterThan(0);
        expect(src.match(/assertSignupsOpen\(\);/g)?.length, door).toBe(submits.length);
      }
    });
  });
});

describe.skipIf(!fresh)("rendered: /", () => {
  it("1 five native FAQ items, each a keyboard-operable <summary>", () => {
    const items = page().querySelectorAll('#faq details[name="faq"]');
    expect(items).toHaveLength(5);
    items.forEach((d) => expect(d.firstElementChild?.tagName).toBe("SUMMARY"));
  });

  it("2 the security answer names only built claims", () => {
    const answer = [...page().querySelectorAll("#faq details")].find((d) =>
      d.querySelector("summary")?.textContent?.includes(FAQ.safe.q),
    )!.textContent!;
    for (const c of CLAIMS) {
      if (c.status === "built") expect(answer).toContain(c.title);
      else expect(answer).not.toContain(c.title);
    }
  });

  it("3 the live answer matches the signupsOpen variant", () => {
    expect(page().querySelector("#faq")!.textContent).toContain(
      signupsOpen ? FAQ.live.open : FAQ.live.closed,
    );
  });

  it("4 one Emergency, in the header, none in the footer", () => {
    const doc = page();
    expect(doc.querySelectorAll("[data-emergency]")).toHaveLength(1);
    expect(doc.querySelector("header [data-emergency]")).not.toBeNull();
    expect(doc.querySelector("footer [data-emergency]")).toBeNull();
  });

  it("5 one theme switch on /", () => {
    expect(page().querySelectorAll('button[role="switch"]')).toHaveLength(1);
  });

  it("6 no CSS gradient backgrounds anywhere on /", () => {
    const hits = [...page().querySelectorAll("[class], [style]")]
      .map((el) => `${el.getAttribute("class") ?? ""} ${el.getAttribute("style") ?? ""}`)
      .filter((c) => /bg-gradient|bg-linear|bg-radial|linear-gradient|radial-gradient/.test(c));
    expect(hits).toEqual([]);
  });

  it("8 no anchor to an unpublished legal page", () => {
    const doc = page();
    if (!legalConfig.privacyPublished) expect(doc.querySelector('a[href="/privacy"]')).toBeNull();
    if (!legalConfig.termsPublished) expect(doc.querySelector('a[href="/terms"]')).toBeNull();
  });

  it("10 every tertiary arrow link ends in a space + an aria-hidden arrow", () => {
    const arrows = [...page().querySelectorAll("a")].filter((a) =>
      a.textContent?.trim().endsWith("→"),
    );
    expect(arrows.length).toBeGreaterThan(0);
    for (const a of arrows) {
      expect(a.textContent, a.outerHTML.slice(0, 120)).toMatch(/\s→$/);
      expect(a.querySelector('span[aria-hidden="true"]')?.textContent?.trim()).toBe("→");
    }
  });
});
