import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AxeResults, RunOptions } from "axe-core";
import { source as AXE_SOURCE } from "axe-core";
import { JSDOM, VirtualConsole } from "jsdom";
import { assert, describe, expect, it } from "vitest";

/**
 * Gate H (ADR 0094, PRD §4.5) — axe-core over the pages `next build`
 * pre-renders to static HTML. Everything behind sign-in is dynamic and never
 * lands on disk, so this covers the public front door: the landing page, the
 * styleguide (the visual contract), sign-in/up, get-started, the emergency
 * page, the offline shell and the 404. The signed-in patient and reception
 * surfaces are held by jsx-a11y's strict set at lint time instead
 * (eslint.config.mjs) — a static pass cannot render them without a session.
 *
 * Runs against the build the orchestrator or CI just made; without one it
 * skips and says so rather than passing vacuously.
 *
 * /emergency left this list with ADR 0098: E1 now reads the session to name
 * the patient's own hospital (ruling 8's fallback number), and the crisis
 * and sexual-violence routes do the same, so none of them pre-renders.
 * tests/emergency/web-pathway.test.ts holds their source-level checks. The HTML is loaded into
 * jsdom with no stylesheet, so layout- and colour-dependent rules
 * (color-contrast, target-size) come back "incomplete", not as violations —
 * those are the design tokens' job and DESIGN-medsync.md's contrast table.
 */
const APP = resolve(process.cwd(), ".next/server/app");
const PAGES = [
  "index",
  "about",
  "styleguide",
  "sign-in",
  "sign-up",
  "get-started",
  "offline",
  "_not-found",
] as const;

/**
 * Rules switched off for ONE page, each with the reason. Empty today: every
 * finding of the first run was a real defect and was fixed at the source
 * (the landing mocks' inner landmarks, the styleguide's four breadcrumbs).
 * A false positive goes here as `{ page: rule }`, never in a global list.
 */
const DISABLED: Partial<Record<(typeof PAGES)[number], Record<string, string>>> = {};

const built = existsSync(APP);
if (!built) {
  console.warn(`tests/a11y: ${APP} not found — run \`next build\` first; axe pass skipped.`);
}

describe.skipIf(!built)("axe over the pre-rendered public pages", () => {
  it.each(PAGES)("%s.html has no violations", async (page) => {
    const file = resolve(APP, `${page}.html`);
    // A missing file is a moved route, not a reason to skip.
    expect(existsSync(file), `${file} — did the route move?`).toBe(true);

    // jsdom logs "not implemented" for layout APIs axe probes; keep it quiet.
    const { window } = new JSDOM(readFileSync(file, "utf8"), {
      runScripts: "outside-only",
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
    });
    window.eval(AXE_SOURCE);
    const { axe } = window as unknown as {
      axe: { run(context: Document, options: RunOptions): Promise<AxeResults> };
    };
    const rules = Object.fromEntries(
      Object.keys(DISABLED[page] ?? {}).map((id) => [id, { enabled: false }]),
    );
    const { violations } = await axe.run(window.document, {
      resultTypes: ["violations"],
      rules,
    });

    const report = violations.map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n` +
        v.nodes.map((n) => `    ${n.html.replace(/\s+/g, " ").slice(0, 160)}`).join("\n"),
    );
    if (report.length) assert.fail(`${page}.html\n${report.join("\n")}`);
  });
});
