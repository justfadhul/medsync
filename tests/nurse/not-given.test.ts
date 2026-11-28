import { describe, expect, it } from "vitest";

import { notGivenReason } from "@/lib/nurse/not-given";

describe("standard reasons a dose was not given (ADR 0546)", () => {
  it("stores the code's words, with the note after them", () => {
    expect(notGivenReason("fasting", undefined)).toBe("Nil by mouth");
    expect(notGivenReason("refused", "says it makes her sick")).toBe(
      "Patient refused: says it makes her sick",
    );
  });
  it("needs a note for other and clinical reasons, and free text alone still works", () => {
    expect(notGivenReason("other", "")).toBeNull();
    expect(notGivenReason("clinical", "BP 85/50")).toBe("Withheld for a clinical reason: BP 85/50");
    expect(notGivenReason(undefined, "ok")).toBeNull();
    expect(notGivenReason(undefined, "patient asleep")).toBe("patient asleep");
  });
});
