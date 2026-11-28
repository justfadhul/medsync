import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ComponentProps } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button, IconButton, KitRoot, StatusTag, Tag } from "@/components/tether-kit";

/**
 * The Tether kit's guards (docs/tether-kit/gate-a-proposal.md, D-TK-05 and D-TK-07).
 * 1. Ratchets: raw `<button>` and `<select>` per Tether folder, from the 28 Nov 2026 baseline. Counts may only
 *    fall; each surface's migration sets its own to 0.
 * 2. The kit is tokens only: no hex, no Tailwind palette colours, so every colour is a `pw-*` Tide token.
 * 3. The laws the parts carry: a disabled button says why, a status is icon and word, an icon button is named.
 */

const count = (pattern: string, dir: string) =>
  Number(
    execSync(`grep -rhoE --include='*.tsx' '${pattern}' ${dir} | wc -l`, {
      encoding: "utf8",
    }).trim(),
  );

const BASELINE: Record<string, { button: number; select: number }> = {
  "components/reception": { button: 117, select: 0 },
  "components/clinics-schedule": { button: 138, select: 0 },
  "components/clinic-floor": { button: 57, select: 0 },
  "components/tide": { button: 49, select: 1 },
  "components/hospital-admin": { button: 27, select: 0 },
  "components/landing/tether": { button: 23, select: 0 },
  "app/tether": { button: 1, select: 0 },
};

describe("Tether kit ratchets: hand-made controls only fall", () => {
  for (const [dir, max] of Object.entries(BASELINE)) {
    it(`${dir}: raw <button> at most ${max.button}`, () =>
      expect(count("<button\\b", dir)).toBeLessThanOrEqual(max.button));
    it(`${dir}: raw <select> at most ${max.select}`, () =>
      expect(count("<select\\b", dir)).toBeLessThanOrEqual(max.select));
  }
});

describe("Tether kit is tokens only", () => {
  const KIT = "components/tether-kit";
  const files = readdirSync(KIT).filter((f) => /\.tsx?$/.test(f));
  const PALETTE =
    /\b(?:bg|text|border|ring|outline|fill|stroke|shadow|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b/;
  for (const f of files) {
    const src = readFileSync(join(KIT, f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    it(`${f}: no hex colours`, () => expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/));
    it(`${f}: no Tailwind palette colours`, () => expect(src).not.toMatch(PALETTE));
  }
});

describe("Tether kit carries the laws", () => {
  const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

  it("a disabled button shows its reason and is described by it", () => {
    const out = html(
      createElement(Button, { disabledReason: "Sign the summary first." }, "Discharge"),
    );
    expect(out).toContain("Sign the summary first.");
    const id = /<span id="([^"]+)"[^>]*>Sign the summary first\./.exec(out)?.[1];
    expect(id).toBeTruthy();
    expect(out).toContain(`aria-describedby="${id}"`);
  });

  it("a busy button says so", () =>
    expect(html(createElement(Button, { busy: true }, "Sending"))).toContain('aria-busy="true"'));

  it("a status tag is an icon and a word, never colour alone", () => {
    const out = html(
      createElement(
        StatusTag,
        { tone: "caution" } as ComponentProps<typeof StatusTag>,
        "Above your target",
      ),
    );
    expect(out).toContain("<svg");
    expect(out).toContain("Above your target");
  });

  it("red, amber and green live only in StatusTag and the danger button", () => {
    const clinical = /pw-(?:critical|caution|stable|emergency)/;
    for (const f of readdirSync("components/tether-kit").filter((n) => /\.tsx?$/.test(n))) {
      if (f === "tag.tsx" || f === "button.tsx") continue;
      expect(readFileSync(join("components/tether-kit", f), "utf8"), f).not.toMatch(clinical);
    }
    expect(html(createElement(Tag, {}, "Visits"))).not.toMatch(clinical);
  });

  it("an icon-only button is named", () => {
    const out = html(createElement(IconButton, { label: "Close", icon: createElement("svg") }));
    expect(out).toContain('aria-label="Close"');
  });

  it("KitRoot switches the Tide tokens on and sets the density", () => {
    const out = html(createElement(KitRoot, { density: "desk" }, "x"));
    expect(out).toContain('data-pw=""');
    expect(out).toContain('data-density="desk"');
  });
});
