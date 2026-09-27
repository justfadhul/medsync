import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

/**
 * ADR 0162: every `--text-*` style in app/globals.css must be registered with
 * tailwind-merge, or `cn()` files it as a colour and drops the size (or the
 * colour) whenever the two meet — the Chroma sidebar lost its 13px labels
 * that way before this test existed.
 */
describe("cn() knows every MedSync type style", () => {
  const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
  const styles = [...css.matchAll(/--text-([a-z0-9-]+?): \d+px;/g)].map((m) => m[1]!);

  it("finds the Chroma scale in globals.css", () => {
    expect(styles).toEqual(
      expect.arrayContaining(["label", "caption", "heading-m", "vital", "kbd"]),
    );
  });

  it.each(styles)("text-%s survives next to a text colour", (style) => {
    expect(cn(`text-${style}`, "text-primary-foreground").split(" ")).toEqual([
      `text-${style}`,
      "text-primary-foreground",
    ]);
  });
});
