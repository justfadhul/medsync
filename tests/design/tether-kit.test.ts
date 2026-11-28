import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ComponentProps } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Band,
  Button,
  buttonClass,
  Card,
  CardButton,
  Field,
  IconButton,
  Input,
  KitRoot,
  NumberInput,
  StatusTag,
  Tag,
  Textarea,
} from "@/components/tether-kit";

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

describe("Set 1.1: the state system and its fixes", () => {
  const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
  const tones = ["primary", "accent", "soft", "outline", "quiet", "danger"] as const;
  const kitSrc = readdirSync("components/tether-kit")
    .filter((n) => /\.tsx?$/.test(n))
    .map((f) => readFileSync(join("components/tether-kit", f), "utf8"))
    .join("\n");

  it("a disabled button does not press: no scale, no state layer", () => {
    const c = buttonClass("primary", "l", true);
    expect(c).toContain("pointer-fine:active:scale-100");
    expect(c).toContain("after:hidden");
    expect(c).toContain("cursor-not-allowed");
  });

  it("every tone shares the state layer, so hover is visible in both themes (danger keeps a darker red)", () => {
    for (const t of tones.filter((x) => x !== "danger")) {
      const c = buttonClass(t);
      expect(c, t).toContain("hover:after:opacity-[0.08]");
      expect(c, t).toContain("active:after:opacity-[0.14]");
      expect(c, t).not.toMatch(/hover:brightness/);
    }
    expect(buttonClass("danger")).toContain("hover:bg-pw-emergency-band");
  });

  it("on a navy band, the tokens point at their band forms, so buttons and the focus ring adapt", () => {
    const out = html(createElement(Band, null, "x"));
    expect(out).toContain('data-surface="band"');
    for (const remap of [
      "[--pw-act:var(--pw-on-band)]",
      "[--pw-focus:var(--pw-on-band-accent)]",
      "[--pw-surface-3:var(--pw-band-glass)]",
    ])
      expect(out, remap).toContain(remap);
  });

  it("long labels wrap instead of overflowing; nothing in the kit forbids wrapping", () => {
    for (const t of tones) {
      expect(buttonClass(t), t).toMatch(/min-h-/);
      expect(buttonClass(t), t).not.toMatch(/(^|\s)h-\[?\d/);
    }
    expect(kitSrc).not.toMatch(/whitespace-nowrap/);
  });

  it("every control and surface keeps an edge in forced-colours mode", () => {
    for (const t of tones) expect(buttonClass(t), t).toMatch(/(^|\s)border(\s|$)/);
    expect(html(createElement(Card, null, "x"))).toMatch(/class="[^"]*\bborder\b/);
    expect(html(createElement(Tag, null, "x"))).toMatch(/class="[^"]*\bborder\b/);
  });

  it("busy is spoken through a polite live region", () => {
    const out = html(createElement(Button, { busy: true, busyLabel: "Saving" }, "Save"));
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain("Saving");
  });

  it("type is in rem, so it follows the reader's text size", () =>
    expect(kitSrc).not.toMatch(/text-\[\d+(\.\d+)?px\]/));

  it("an icon button can be disabled with a reason, and busy", () => {
    const off = html(
      createElement(IconButton, {
        label: "Add",
        icon: createElement("svg"),
        disabledReason: "Full.",
      }),
    );
    const id = /<span id="([^"]+)" class="sr-only">Full\./.exec(off)?.[1];
    expect(id).toBeTruthy();
    expect(off).toContain(`aria-describedby="${id}"`);
    expect(
      html(createElement(IconButton, { label: "Add", icon: createElement("svg"), busy: true })),
    ).toContain('aria-busy="true"');
  });

  it("a wide button fills its container", () =>
    expect(html(createElement(Button, { wide: true }, "Book a visit"))).toMatch(
      /class="[^"]*\bw-full\b/,
    ));

  it("a pressable card is one button with one focus ring", () => {
    const out = html(createElement(CardButton, null, "Outpatients"));
    expect(out).toMatch(/^<button[^>]*type="button"/);
    expect(out).toContain("focus-visible:outline-2");
    expect(out).toContain("hover:shadow-pw-float");
  });
});

describe("Set 2 · Typing: fields carry the laws", () => {
  const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
  const field = (props: object, control: Parameters<typeof renderToStaticMarkup>[0]) =>
    html(
      createElement(Field, { label: "Weight", ...props } as ComponentProps<typeof Field>, control),
    );

  it("the label is wired to the control", () => {
    const out = field({}, createElement(Input));
    const forId = /<label[^>]*for="([^"]+)"/.exec(out)?.[1];
    expect(forId).toBeTruthy();
    expect(out).toContain(`id="${forId}"`);
  });

  it("the hint and the error are descriptions, and the error comes before the control", () => {
    // Base UI joins their ids into the control's aria-describedby in the browser; the kit's browser probe checks it.
    const out = field(
      { hint: "Between 2 and 250 kg.", error: "Enter a weight between 2 and 250 kg." },
      createElement(Input),
    );
    expect(out).toMatch(/<p[^>]*id="[^"]+"[^>]*>Between 2 and 250 kg\./);
    expect(out).toContain('aria-invalid="true"');
    expect(out.indexOf("Enter a weight")).toBeLessThan(out.indexOf("<input"));
  });

  it("an error is an icon and a word, says Error to a screen reader, and is never red", () => {
    const out = field({ error: "Enter a weight." }, createElement(Input));
    expect(out).toContain("<svg");
    expect(out).toContain('<span class="sr-only">Error: </span>');
    expect(out).toContain('data-invalid="true"');
    expect(readFileSync("components/tether-kit/field.tsx", "utf8")).not.toMatch(
      /pw-(?:critical|caution|stable|emergency)/,
    );
  });

  it("optional is marked in words; required is the default", () =>
    expect(field({ optional: true }, createElement(Input))).toContain("(optional)"));

  it("patient fields use 16 px or more, so a phone never zooms on focus", () =>
    expect(readFileSync("components/tether-kit/core.ts", "utf8")).toContain(
      "min-h-12 rounded-pw-field text-[1.0625rem]",
    ));

  it("a password field offers Show as a word, and says what it does", () => {
    const out = field({}, createElement(Input, { type: "password" }));
    expect(out).toContain('aria-label="Show password"');
    expect(out).toContain('aria-pressed="false"');
    expect(out).toContain(">Show</button>");
  });

  it("a textarea with a limit counts as a description, and stays quiet until typing nears the limit", () => {
    const out = field({}, createElement(Textarea, { maxLength: 9 }));
    expect(out).toMatch(/<p[^>]*id="[^"]+"[^>]*>0 of 9 characters/);
    expect(out).toContain('aria-live="polite"></span>');
  });

  it("a number field names its steppers and shows its unit", () => {
    const out = field({}, createElement(NumberInput, { unit: "kg", defaultValue: 64 }));
    expect(out).toContain('aria-label="Less"');
    expect(out).toContain('aria-label="More"');
    expect(out).toContain(">kg</span>");
  });
});
