import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * postgres-js (prepare: false) cannot bind a raw Date inside a sql`` fragment: it has no column
 * type to infer, and throws at runtime. PGlite accepts it, so the lane never caught it; every note
 * save failed in production on 2026-09-27. Dates inside sql`` go in as ISO strings with a cast.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

describe("no raw Date in a sql`` fragment (EMR code)", () => {
  it("interpolates clocks as ISO strings with a ::timestamptz cast", () => {
    const offenders = ["lib/emr", "lib/facts", "lib/workspace"]
      .flatMap(files)
      .flatMap((f) =>
        [...readFileSync(f, "utf8").matchAll(/sql`[^`]*`/g)]
          .filter((m) => /\$\{\s*(ctx\.now|now|asOf|opts\.asOf|since|cutoff)\s*\}/.test(m[0]))
          .map(() => f),
      );
    expect(offenders).toEqual([]);
  });
});
