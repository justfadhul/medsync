import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * STOP 3's coverage table as a test: every FW rule ID of the prompt (§6) has a
 * describe block in the rule suite, with at least one case in it.
 */

const RULES = Array.from({ length: 11 }, (_, i) => `FW-${i + 1}`);
const suite = readFileSync(resolve(process.cwd(), "tests/workspace/flow.test.ts"), "utf8");

describe("every flow rule has tests", () => {
  for (const id of RULES) {
    it(`${id} has a describe block with cases`, () => {
      const start = suite.indexOf(`describe("${id} `);
      expect(start, `${id} missing`).toBeGreaterThan(-1);
      const next = suite.indexOf('\ndescribe("', start + 1);
      const block = suite.slice(start, next < 0 ? undefined : next);
      expect((block.match(/\n {2}it\(/g) ?? []).length, `${id} has no cases`).toBeGreaterThan(0);
    });
  }
});
