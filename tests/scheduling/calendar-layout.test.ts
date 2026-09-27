import { describe, expect, it } from "vitest";

import { bandChipOffset, nextCardIndex, packLanes } from "@/components/scheduling/calendar/helpers";

describe("packLanes", () => {
  it("a lone card keeps the whole column", () => {
    expect(packLanes([{ start: 0, end: 76 }])).toEqual([{ lane: 0, lanes: 1 }]);
  });

  it("back-to-back cards share a lane", () => {
    expect(
      packLanes([
        { start: 0, end: 44 },
        { start: 44, end: 88 },
      ]),
    ).toEqual([
      { lane: 0, lanes: 1 },
      { lane: 0, lanes: 1 },
    ]);
  });

  it("two overlapping cards split the column, whatever order they arrive in", () => {
    expect(
      packLanes([
        { start: 19, end: 76 },
        { start: 0, end: 44 },
      ]),
    ).toEqual([
      { lane: 1, lanes: 2 },
      { lane: 0, lanes: 2 },
    ]);
  });

  it("a freed lane is reused, and the cluster's width is its widest moment", () => {
    // A: long, B overlaps A, C overlaps A after B ended → C reuses lane 1.
    const out = packLanes([
      { start: 0, end: 200 },
      { start: 10, end: 60 },
      { start: 80, end: 120 },
      { start: 300, end: 340 },
    ]);
    expect(out).toEqual([
      { lane: 0, lanes: 2 },
      { lane: 1, lanes: 2 },
      { lane: 1, lanes: 2 },
      { lane: 0, lanes: 1 },
    ]);
  });

  it("three at once make three lanes", () => {
    const out = packLanes([
      { start: 0, end: 50 },
      { start: 0, end: 50 },
      { start: 0, end: 50 },
    ]);
    expect(out.map((o) => o.lane).sort()).toEqual([0, 1, 2]);
    expect(new Set(out.map((o) => o.lanes))).toEqual(new Set([3]));
  });
});

describe("nextCardIndex", () => {
  const cards = [
    { col: 0, top: 0 },
    { col: 0, top: 100 },
    { col: 2, top: 90 },
    { col: 2, top: 10 },
  ];

  it("up and down walk one day by time", () => {
    expect(nextCardIndex(cards, 0, "ArrowDown")).toBe(1);
    expect(nextCardIndex(cards, 1, "ArrowUp")).toBe(0);
    expect(nextCardIndex(cards, 1, "ArrowDown")).toBeNull();
    expect(nextCardIndex(cards, 3, "ArrowDown")).toBe(2);
  });

  it("left and right skip empty days to the nearest card in time", () => {
    expect(nextCardIndex(cards, 1, "ArrowRight")).toBe(2);
    expect(nextCardIndex(cards, 0, "ArrowRight")).toBe(3);
    expect(nextCardIndex(cards, 3, "ArrowLeft")).toBe(0);
    expect(nextCardIndex(cards, 0, "ArrowLeft")).toBeNull();
  });
});

describe("bandChipOffset", () => {
  const band = { top: 100, height: 300 };

  it("sits at the band's top when nothing covers it", () => {
    expect(bandChipOffset(band, [], 28)).toBe(0);
    expect(bandChipOffset(band, [{ top: 0, height: 50 }], 28)).toBe(0);
  });

  it("drops below a card that starts with the band, and past a run of them", () => {
    expect(bandChipOffset(band, [{ top: 100, height: 44 }], 28)).toBe(44);
    expect(
      bandChipOffset(
        band,
        [
          { top: 150, height: 44 },
          { top: 100, height: 60 },
        ],
        28,
      ),
    ).toBe(94);
  });

  it("is null when cards leave no chip-sized gap", () => {
    expect(bandChipOffset(band, [{ top: 90, height: 300 }], 28)).toBeNull();
  });
});
