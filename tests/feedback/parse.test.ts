import type { Draft } from "@/app/feedback/_lib/parse";
import { describe, expect, it } from "vitest";

import { parseFeedback, sectionAnswers, statusOf } from "@/app/feedback/_lib/parse";
import { FEEDBACK_SECTIONS } from "@/content/feedback";

describe("parseFeedback", () => {
  it("keeps valid answers and drops everything else", () => {
    expect(
      parseFeedback({
        respondent: "ahabwe-alvin",
        answers: {
          "landing.understand": 4,
          "landing.trust": 9, // out of range
          "landing.design": 2.5, // not an integer
          "hospital.tried": "Partly",
          "setup.device": "Fax machine", // not an option
          "overall.other": "  fine  ",
          "overall.best": "   ", // blank
          "made.up": "x", // unknown id
        },
      }),
    ).toEqual({
      respondent: "ahabwe-alvin",
      answers: { "landing.understand": 4, "hospital.tried": "Partly", "overall.other": "fine" },
    });
  });

  it("refuses an unknown respondent or an empty form", () => {
    expect(
      parseFeedback({ respondent: "usama-fadhul", answers: { "landing.understand": 3 } }),
    ).toBe(null);
    expect(parseFeedback({ respondent: "ahabwe-alvin", answers: {} })).toBe(null);
    expect(parseFeedback(null)).toBe(null);
  });

  it("has unique question ids, and every gated section opens with 'tried'", () => {
    const ids = FEEDBACK_SECTIONS.flatMap((s) => s.questions.map((q) => q.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of FEEDBACK_SECTIONS.filter((s) => s.gated))
      expect(s.questions[0]?.id).toBe(`${s.id}.tried`);
  });
});

describe("per-section sending", () => {
  const hospital = FEEDBACK_SECTIONS.find((s) => s.id === "hospital")!;

  it("sends only 'tried' when the tester didn't try the flow, and drops blanks", () => {
    expect(
      sectionAnswers(hospital, {
        "hospital.tried": "Didn't try",
        "hospital.find": 3,
        "landing.understand": 5,
      }),
    ).toEqual({ "hospital.tried": "Didn't try" });
    expect(
      sectionAnswers(hospital, {
        "hospital.tried": "Partly",
        "hospital.stuck": "  ",
        "hospital.find": 2,
      }),
    ).toEqual({ "hospital.tried": "Partly", "hospital.find": 2 });
  });

  it("tracks empty → not sent → sent → changed", () => {
    const d = { respondent: "ahabwe-alvin", answers: {}, sent: {} } as Draft;
    expect(statusOf(hospital, d)).toBe("empty");
    d.answers = { "hospital.find": 4 };
    expect(statusOf(hospital, d)).toBe("draft");
    d.sent = { hospital: JSON.stringify(sectionAnswers(hospital, d.answers)) };
    expect(statusOf(hospital, d)).toBe("sent");
    d.answers = { "hospital.find": 5 };
    expect(statusOf(hospital, d)).toBe("changed");
  });
});
