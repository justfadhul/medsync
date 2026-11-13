/**
 * Appendix C guards for the reception desk (RD2, RD3, RD12): static checks over the desk's copy, components and CSS.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DESK } from "@/content/reception/desk";

const DIR = "components/reception";
const files = readdirSync(DIR).map((f) => join(DIR, f));
const css = readFileSync(join(DIR, "desk.module.css"), "utf8");
const strings = (o: unknown): string[] =>
  typeof o === "string"
    ? [o]
    : Array.isArray(o)
      ? o.flatMap(strings)
      : o && typeof o === "object"
        ? Object.values(o).flatMap(strings)
        : [];

/** RD3: where red may appear (emergency controls, pre-alerts, danger-sign stops, errors). */
const RED_OK = new Set([
  ".agep.err, .err",
  ".btn.r",
  ".btn.ro",
  ".dangerbox",
  ".dangerq .chip.on, .wkSafe .chip.on:not(.none)",
  ".navEm",
  ".navEm em",
  ".navEm:hover",
  ".pcD b",
  ".pcH b",
  ".prepill",
  ".pulse",
  ".pulse::after",
  ".rail .navEm .dot",
  ".redText",
  ".stp.red",
  // Clinic floor (ADR 0491): L1 and the Step 0 life-threat signs are the emergencies.
  ".pri.l1, .pri.emerg",
  ".wk-safe .chip.on:not(.wk-none)",
  ".wk-safe.hot",
  ".tgr.em",
  ".tgr.em em",
  ".tile.red",
  ".trw.em .route",
  ".trw.em:hover",
  ".wkSafe.hot",
  ".precard",
]);

describe("reception desk guards", () => {
  it("red reserved: red tokens only on emergency, danger-stop and error rules", () => {
    const used = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => /var\(--(red|critbg|critfg)\)/.test(m[2]!))
      .map((m) =>
        m[1]!
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .split(/\s+/)
          .join(" ")
          .trim(),
      );
    expect(used.filter((s) => !RED_OK.has(s))).toEqual([]);
  });

  it("queue honesty: the slip and ticket promise no position or count ahead", () => {
    const bad = /\bposition\b|ahead of you|#\s?\d|\bNo\.\s?\d|number \d+ in/i;
    expect(strings([DESK.slip, DESK.ticket]).filter((s) => bad.test(s))).toEqual([]);
  });

  it("no dose in the desk copy", () => {
    const DOSE = /\b\d+(\.\d+)?\s?(mg|mcg|µg|g|IU|units?|ml|mL)\b/;
    expect(strings(DESK).filter((s) => DOSE.test(s))).toEqual([]);
  });

  it("raw colour: no hex, rgb or hsl in the desk's components and CSS", () => {
    const raw = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;
    const hits = files.flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => raw.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l))
        .map((l) => `${f}: ${l.trim()}`),
    );
    expect(hits).toEqual([]);
  });

  it("no left-edge accent bars: a left border is only the hairline divider", () => {
    const lefts = [...css.matchAll(/border-left(?:-color)?:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(lefts.filter((v) => v !== "0" && v !== "1px solid var(--line)")).toEqual([]);
  });
});
