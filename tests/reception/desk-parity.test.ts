/** Prompt §7: every old reception route maps to a desk place, and nothing is listed as lost. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const map = JSON.parse(readFileSync("tests/parity/reception/renames.json", "utf8")) as {
  routes: Record<string, { desk: string; lost: string[] }>;
};

describe("reception parity", () => {
  it("covers every old route and loses nothing", () => {
    const routes = readdirSync("app/reception")
      .filter((d) => !d.startsWith("_") && statSync(`app/reception/${d}`).isDirectory())
      .map((d) => `/reception/${d}`);
    expect(routes.filter((r) => !map.routes[r])).toEqual([]);
    expect(Object.values(map.routes).flatMap((r) => r.lost)).toEqual([]);
  });
});
