import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { AVAILABILITY_KIND_LABEL } from "@/components/scheduling/calendar/helpers";
import {
  HUE,
  KIND_TONE,
  STATUS_KEY,
  STATUS_TONE,
  statusKeyFor,
} from "@/components/scheduling/calendar/tones";

/**
 * Schedule reskin §3: red, amber and green are clinical signals. No kind and
 * no booking status may spend them; the one exception is an urgent,
 * alert-triggered appointment, which takes the critical pair.
 */
const CLINICAL =
  /\b(?:bg|text|border|ring)-(?:red|rose|amber|orange|yellow|green|emerald|lime)-|status-(?:critical|caution|stable|admitted)|destructive|alert-/;

const CAL = resolve(process.cwd(), "components/scheduling/calendar");

describe("the calendar's colour map", () => {
  it("no hue spends a clinical colour", () => {
    for (const [hue, classes] of Object.entries(HUE)) {
      for (const cls of Object.values(classes)) expect(cls, hue).not.toMatch(CLINICAL);
    }
  });

  it("no kind maps to a clinical pill tone", () => {
    for (const [kind, tone] of Object.entries(KIND_TONE)) {
      expect(["neutral", "info", "notice", "custom"], kind).toContain(tone.pill);
    }
  });

  it("only `urgent` spends the critical pair; no status is amber or green", () => {
    for (const [key, tone] of Object.entries(STATUS_TONE)) {
      if (key === "urgent") expect(tone.pill).toContain("status-critical");
      else expect(tone.pill, key).not.toMatch(CLINICAL);
    }
  });

  it("every availability kind and the clinic day have a tone", () => {
    for (const kind of [...Object.keys(AVAILABILITY_KIND_LABEL), "session"]) {
      expect(KIND_TONE[kind], kind).toBeTruthy();
    }
  });

  it("a cancelled or completed urgent booking is not an alarm", () => {
    expect(statusKeyFor("requested", "urgent")).toBe("urgent");
    expect(statusKeyFor("confirmed", "urgent")).toBe("urgent");
    expect(statusKeyFor("cancelled", "urgent")).toBe("cancelled");
    expect(statusKeyFor("no_show", "urgent")).toBe("missed");
    expect(statusKeyFor("completed", "urgent")).toBe("completed");
    expect(statusKeyFor("confirmed", "routine")).toBe("confirmed");
  });

  it("every status the database writes has a pill", () => {
    for (const s of [
      "requested",
      "pending_approval",
      "confirmed",
      "arrived",
      "in_progress",
      "completed",
      "cancelled",
      "declined",
      "no_show",
      "rescheduled",
    ]) {
      expect(STATUS_KEY[s], s).toBeTruthy();
    }
  });

  it("the calendar components name no hex, no clinical colour and no Tailwind ramp", () => {
    // tones.ts holds the one sanctioned critical pair (urgent), checked above.
    for (const f of readdirSync(CAL).filter((n) => /\.tsx?$/.test(n) && n !== "tones.ts")) {
      const src = readFileSync(resolve(CAL, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src, f).not.toMatch(CLINICAL);
      expect(src, f).not.toMatch(/\b(?:bg|text|border|ring)-(?:blue|violet|purple|pink)-\d/);
    }
  });
});
