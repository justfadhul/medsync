import { chartWords, diamond } from "@/features/care/week-chart";

describe("chartWords", () => {
  it("reads real values with their days, the unit and the target", () => {
    expect(
      chartWords(
        "Blood pressure over the last seven days",
        [128, null, 141],
        [82, null, 90],
        ["Monday 24", "Tuesday 25", "Today"],
        "mmHg",
        { lo: 90, hi: 135 },
      ),
    ).toBe(
      "Blood pressure over the last seven days, in mmHg. Your target 90 to 135. Monday 24: 128 over 82. Today: 141 over 90.",
    );
  });
  it("says so when there is nothing", () => {
    expect(chartWords("Sugar", [null, null], undefined, ["Mon", "Tue"])).toBe(
      "Sugar. No readings yet.",
    );
  });
});

it("draws a diamond around its centre", () => {
  expect(diamond(10, 10, 5)).toBe("M10 5 L15 10 L10 15 L5 10 Z");
});
