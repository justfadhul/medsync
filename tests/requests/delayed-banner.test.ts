// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { DelayedBanner } from "@/components/requests/delayed-banner";
import { dueWords } from "@/lib/requests/escalation";

/** The "escalations may be delayed" banner and the due words (ADR 0536). Synthetic times only. */

function render(show: boolean) {
  const el = document.createElement("div");
  act(() => createRoot(el).render(h(DelayedBanner, { show })));
  return el;
}

describe("DelayedBanner", () => {
  it("banner shows only when stale", () => {
    expect(render(false).textContent).toBe("");
    expect(render(true).textContent).toContain(
      "Escalations may be delayed. Phone the team for anything urgent.",
    );
  });

  it("the banner is never red", () => {
    expect(render(true).innerHTML).not.toMatch(/red|rose|destructive/);
  });
});

describe("dueWords", () => {
  const now = new Date("2026-11-24T11:00:00Z"); // 14:00 Kampala
  const asked = new Date("2026-11-24T10:20:00Z");
  const at = (iso: string) => new Date(iso);

  it("with nothing signed it says how long ago it was asked", () => {
    expect(dueWords({ signed: false, due: null, overdue: false, askedAt: asked, now })).toBe(
      "Asked 40 min ago",
    );
  });
  it("names the time it is due by, in Kampala time", () => {
    expect(
      dueWords({
        signed: true,
        due: at("2026-11-24T11:30:00Z"),
        overdue: false,
        askedAt: asked,
        now,
      }),
    ).toBe("Due by 14:30");
  });
  it("says how long it is overdue", () => {
    expect(
      dueWords({
        signed: true,
        due: at("2026-11-24T10:35:00Z"),
        overdue: true,
        askedAt: asked,
        now,
      }),
    ).toBe("Overdue by 25 min");
  });
  it("the day-end marker has no due time: just Overdue", () => {
    expect(dueWords({ signed: true, due: null, overdue: true, askedAt: asked, now })).toBe(
      "Overdue",
    );
  });
  it("signed, nothing due: no words", () => {
    expect(dueWords({ signed: true, due: null, overdue: false, askedAt: asked, now })).toBeNull();
  });

  it("overdue wins over a later due time: never Due by beside an Overdue tag", () => {
    expect(
      dueWords({
        signed: true,
        due: at("2026-11-24T22:00:00Z"),
        overdue: true,
        askedAt: asked,
        now,
      }),
    ).toBe("Overdue");
  });
  it("a due time on another Kampala day says tomorrow, or the date", () => {
    // 23:30 UTC is 02:30 on the 25th in Kampala
    expect(
      dueWords({
        signed: true,
        due: at("2026-11-24T23:30:00Z"),
        overdue: false,
        askedAt: asked,
        now,
      }),
    ).toBe("Due by tomorrow 02:30");
    expect(
      dueWords({
        signed: true,
        due: at("2026-11-27T11:30:00Z"),
        overdue: false,
        askedAt: asked,
        now,
      }),
    ).toBe("Due by 27 Nov 14:30");
  });
});
